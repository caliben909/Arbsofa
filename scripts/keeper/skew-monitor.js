/**
 * SkewArbitrageEngine Monitor & Executor
 * Monitors registered pools for skew deviations and executes arbitrage when profitable
 */

const { ethers } = require("hardhat");
const axios = require("axios");

// Configuration
const CONFIG = {
  // Minimum profit in basis points to execute
  minProfitBP: 20, // 0.2%
  
  // Maximum slippage tolerance
  maxSlippageBP: 50, // 0.5%
  
  // Gas price multiplier
  gasMultiplier: 1.1,
  
  // Check interval in ms
  checkInterval: 5000,
  
  // Batch size for pool checking
  batchSize: 10,
};

// Pool configurations with target ratios
const SKEW_POOLS = [
  {
    name: "WETH/USDC 49.5/50.5",
    address: "0x...", // Replace with actual pool
    token0: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    token1: "0xA0b86a33E6441E6C7D3D4B4f6c7e8f9a0b1c2d3e", // USDC
    fee: 500,
    targetRatio0: 4950, // 49.5%
    targetRatio1: 5050, // 50.5%
    minDeviation: 50,   // 0.5% deviation to trigger
    maxFlashSize: ethers.parseEther("100"), // 100 ETH max
    exitPool: "0x...", // Balanced pool for exit
  },
  // Add more pools as needed
];

class SkewArbitrageMonitor {
  constructor(engineAddress, provider) {
    this.engineAddress = engineAddress;
    this.provider = provider;
    this.running = false;
    this.stats = {
      checks: 0,
      opportunities: 0,
      executed: 0,
      failed: 0,
      totalProfit: 0n,
    };
  }

  async initialize() {
    // Load contract
    const SkewArbitrageEngine = await ethers.getContractFactory("SkewArbitrageEngine");
    this.engine = SkewArbitrageEngine.attach(this.engineAddress);
    
    // Get signer
    const [signer] = await ethers.getSigners();
    this.engine = this.engine.connect(signer);
    
    console.log("SkewArbitrageMonitor initialized");
    console.log("Engine:", this.engineAddress);
    console.log("Executor:", signer.address);
  }

  /**
   * Calculate current pool skew
   */
  async getPoolSkew(poolConfig) {
    try {
      const token0 = await ethers.getContractAt("IERC20", poolConfig.token0);
      const token1 = await ethers.getContractAt("IERC20", poolConfig.token1);
      
      const balance0 = await token0.balanceOf(poolConfig.address);
      const balance1 = await token1.balanceOf(poolConfig.address);
      
      // Get decimals
      const decimals0 = await token0.decimals();
      const decimals1 = await token1.decimals();
      
      // Normalize to 18 decimals
      const norm0 = balance0 * (10n ** (18n - BigInt(decimals0)));
      const norm1 = balance1 * (10n ** (18n - BigInt(decimals1)));
      
      const total = norm0 + norm1;
      const currentRatio0 = Number((norm0 * 10000n) / total);
      const currentRatio1 = 10000 - currentRatio0;
      
      // Calculate deviation from target
      const deviation0 = Math.abs(currentRatio0 - poolConfig.targetRatio0);
      const deviation1 = Math.abs(currentRatio1 - poolConfig.targetRatio1);
      
      return {
        balance0,
        balance1,
        currentRatio0,
        currentRatio1,
        deviation0,
        deviation1,
        isSkewed: deviation0 >= poolConfig.minDeviation || deviation1 >= poolConfig.minDeviation,
        overweightedToken: currentRatio0 > poolConfig.targetRatio0 ? 0 : 1,
      };
    } catch (error) {
      console.error(`Error getting skew for ${poolConfig.name}:`, error.message);
      return null;
    }
  }

  /**
   * Estimate arbitrage profit
   */
  async estimateProfit(poolConfig, flashAmount, flashToken0) {
    try {
      const result = await this.engine.estimateProfit(
        poolConfig.address,
        poolConfig.exitPool,
        flashAmount,
        flashToken0
      );
      
      return {
        estimatedProfit: result[0],
        profitBP: Number(result[1]),
        isProfitable: result[2],
      };
    } catch (error) {
      console.error("Error estimating profit:", error.message);
      return null;
    }
  }

  /**
   * Execute arbitrage transaction
   */
  async executeArbitrage(poolConfig, flashAmount, isToken0Overweight) {
    try {
      const params = {
        skewedPool: poolConfig.address,
        exitPool: poolConfig.exitPool,
        flashAmount: flashAmount,
        minProfitBP: CONFIG.minProfitBP,
        deadline: Math.floor(Date.now() / 1000) + 300, // 5 min deadline
      };

      console.log(`\n🚀 Executing arbitrage on ${poolConfig.name}`);
      console.log(`   Flash Amount: ${ethers.formatEther(flashAmount)} ETH`);
      console.log(`   Flash Token: ${isToken0Overweight ? 'token0' : 'token1'}`);

      const tx = await this.engine.executeSkewArbitrage(params, {
        gasLimit: 500000,
        maxFeePerGas: await this.getGasPrice(),
      });

      console.log(`   Tx Hash: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        console.log(`   ✅ Success! Gas used: ${receipt.gasUsed}`);
        this.stats.executed++;
        
        // Parse event for profit
        const event = receipt.logs.find(
          log => log.topics[0] === ethers.id("ArbitrageExecuted(address,address,address,uint256,uint256,uint256,uint256,uint256)")
        );
        
        if (event) {
          const decoded = this.engine.interface.parseLog(event);
          const profit = decoded.args.grossProfit;
          this.stats.totalProfit += profit;
          console.log(`   💰 Profit: ${ethers.formatUnits(profit, 6)} USDC`);
        }
        
        return true;
      } else {
        console.log(`   ❌ Transaction failed`);
        this.stats.failed++;
        return false;
      }
    } catch (error) {
      console.error(`   ❌ Execution error:`, error.message);
      this.stats.failed++;
      return false;
    }
  }

  /**
   * Get current gas price with multiplier
   */
  async getGasPrice() {
    const feeData = await this.provider.getFeeData();
    return (feeData.maxFeePerGas * BigInt(Math.floor(CONFIG.gasMultiplier * 100))) / 100n;
  }

  /**
   * Check a single pool for arbitrage opportunity
   */
  async checkPool(poolConfig) {
    this.stats.checks++;
    
    const skew = await this.getPoolSkew(poolConfig);
    if (!skew || !skew.isSkewed) {
      return;
    }

    console.log(`\n📊 ${poolConfig.name} - Skew detected!`);
    console.log(`   Current Ratio: ${(skew.currentRatio0 / 100).toFixed(2)}% / ${(skew.currentRatio1 / 100).toFixed(2)}%`);
    console.log(`   Target Ratio: ${(poolConfig.targetRatio0 / 100).toFixed(2)}% / ${(poolConfig.targetRatio1 / 100).toFixed(2)}%`);
    console.log(`   Deviation: ${(skew.deviation0 / 100).toFixed(2)}%`);

    // Determine optimal flash amount (start with smaller amount)
    const flashAmounts = [
      poolConfig.maxFlashSize / 10n,  // 10%
      poolConfig.maxFlashSize / 4n,   // 25%
      poolConfig.maxFlashSize / 2n,   // 50%
      poolConfig.maxFlashSize,        // 100%
    ];

    for (const flashAmount of flashAmounts) {
      const profitEstimate = await this.estimateProfit(
        poolConfig,
        flashAmount,
        skew.overweightedToken === 0
      );

      if (!profitEstimate) continue;

      console.log(`   💡 Flash ${ethers.formatEther(flashAmount)} ETH -> Profit: ${(profitEstimate.profitBP / 100).toFixed(2)}%`);

      if (profitEstimate.isProfitable && profitEstimate.profitBP >= CONFIG.minProfitBP) {
        this.stats.opportunities++;
        
        // Execute the arbitrage
        const success = await this.executeArbitrage(
          poolConfig,
          flashAmount,
          skew.overweightedToken === 0
        );

        if (success) {
          break; // Move to next pool after successful execution
        }
      }
    }
  }

  /**
   * Main monitoring loop
   */
  async start() {
    this.running = true;
    console.log("\n🔍 Starting Skew Arbitrage Monitor...");
    console.log(`   Check Interval: ${CONFIG.checkInterval}ms`);
    console.log(`   Min Profit: ${CONFIG.minProfitBP / 100}%`);
    console.log(`   Pools: ${SKEW_POOLS.length}`);

    while (this.running) {
      try {
        for (const pool of SKEW_POOLS) {
          if (!this.running) break;
          await this.checkPool(pool);
          await this.sleep(1000); // Small delay between pools
        }

        // Print stats every 10 cycles
        if (this.stats.checks % (SKEW_POOLS.length * 10) === 0) {
          this.printStats();
        }

        await this.sleep(CONFIG.checkInterval);
      } catch (error) {
        console.error("Monitor error:", error);
        await this.sleep(CONFIG.checkInterval);
      }
    }
  }

  /**
   * Stop the monitor
   */
  stop() {
    this.running = false;
    console.log("\n🛑 Monitor stopped");
    this.printStats();
  }

  /**
   * Print current statistics
   */
  printStats() {
    console.log("\n📈 Statistics:");
    console.log(`   Checks: ${this.stats.checks}`);
    console.log(`   Opportunities Found: ${this.stats.opportunities}`);
    console.log(`   Executed: ${this.stats.executed}`);
    console.log(`   Failed: ${this.stats.failed}`);
    console.log(`   Total Profit: ${ethers.formatUnits(this.stats.totalProfit, 6)} USDC`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI interface
async function main() {
  const engineAddress = process.env.ENGINE_ADDRESS;
  if (!engineAddress) {
    console.error("Please set ENGINE_ADDRESS environment variable");
    process.exit(1);
  }

  const provider = ethers.provider;
  const monitor = new SkewArbitrageMonitor(engineAddress, provider);
  
  await monitor.initialize();

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n\nReceived SIGINT, shutting down...");
    monitor.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n\nReceived SIGTERM, shutting down...");
    monitor.stop();
    process.exit(0);
  });

  await monitor.start();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

module.exports = { SkewArbitrageMonitor };
