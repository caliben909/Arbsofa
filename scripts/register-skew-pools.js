/**
 * Register skew pools with the SkewArbitrageEngine
 * Run: npx hardhat run scripts/register-skew-pools.js --network <network>
 */

const hre = require("hardhat");

// Pool configurations with intentional skews
const POOLS_TO_REGISTER = [
  {
    name: "WETH/USDC 49.5/50.5 Skew",
    address: "0x...", // Replace with actual pool address
    token0: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    token1: "0xA0b86a33E6441E6C7D3D4B4f6c7e8f9a0b1c2d3e", // USDC
    fee: 500, // 0.05%
    targetRatio0: 4950, // 49.5%
    targetRatio1: 5050, // 50.5%
    minDeviation: 50,   // 0.5% deviation triggers arb
    maxFlashSize: hre.ethers.parseEther("50"), // 50 ETH
  },
  {
    name: "WBTC/WETH 48/52 Skew",
    address: "0x...", // Replace with actual pool address
    token0: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", // WBTC
    token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    fee: 3000, // 0.3%
    targetRatio0: 4800, // 48%
    targetRatio1: 5200, // 52%
    minDeviation: 100,  // 1% deviation triggers arb
    maxFlashSize: hre.ethers.parseUnits("2", 8), // 2 WBTC
  },
  {
    name: "LINK/ETH 51/49 Skew",
    address: "0x...", // Replace with actual pool address
    token0: "0x514910771AF9Ca656af840dff83E8264EcF986CA", // LINK
    token1: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    fee: 3000, // 0.3%
    targetRatio0: 5100, // 51%
    targetRatio1: 4900, // 49%
    minDeviation: 75,   // 0.75% deviation triggers arb
    maxFlashSize: hre.ethers.parseEther("1000"), // 1000 LINK
  },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Registering pools with account:", deployer.address);

  // Get engine address from deployment file or env
  const network = hre.network.name;
  const fs = require("fs");
  
  let engineAddress = process.env.ENGINE_ADDRESS;
  
  if (!engineAddress) {
    try {
      const deployment = JSON.parse(
        fs.readFileSync(`deployments/skew-arbitrage-${network}.json`)
      );
      engineAddress = deployment.engineAddress;
    } catch (error) {
      console.error("Could not find deployment file. Set ENGINE_ADDRESS env var.");
      process.exit(1);
    }
  }

  console.log("Engine address:", engineAddress);

  // Attach to contract
  const SkewArbitrageEngine = await hre.ethers.getContractFactory("SkewArbitrageEngine");
  const engine = SkewArbitrageEngine.attach(engineAddress).connect(deployer);

  // Register each pool
  for (const pool of POOLS_TO_REGISTER) {
    try {
      console.log(`\n📋 Registering: ${pool.name}`);
      console.log(`   Address: ${pool.address}`);
      console.log(`   Target Ratio: ${pool.targetRatio0 / 100}% / ${pool.targetRatio1 / 100}%`);
      console.log(`   Min Deviation: ${pool.minDeviation / 100}%`);

      // Check if pool already registered
      const existing = await engine.skewPools(pool.address);
      if (existing.pool !== "0x0000000000000000000000000000000000000000") {
        console.log(`   ⚠️ Pool already registered, updating...`);
        
        const tx = await engine.updateSkewPool(
          pool.address,
          true, // active
          pool.minDeviation,
          pool.maxFlashSize
        );
        await tx.wait();
        console.log(`   ✅ Pool updated`);
      } else {
        const tx = await engine.registerSkewPool(
          pool.address,
          pool.token0,
          pool.token1,
          pool.fee,
          pool.targetRatio0,
          pool.targetRatio1,
          pool.minDeviation,
          pool.maxFlashSize
        );
        await tx.wait();
        console.log(`   ✅ Pool registered`);
      }
    } catch (error) {
      console.error(`   ❌ Error registering ${pool.name}:`, error.message);
    }
  }

  // Set up executors
  console.log("\n👤 Setting up executors...");
  
  const executors = [
    deployer.address,
    // Add bot addresses here
  ];

  for (const executor of executors) {
    try {
      const isAuthorized = await engine.executors(executor);
      if (!isAuthorized) {
        const tx = await engine.setExecutor(executor, true);
        await tx.wait();
        console.log(`   ✅ Executor authorized: ${executor}`);
      } else {
        console.log(`   ℹ️ Already authorized: ${executor}`);
      }
    } catch (error) {
      console.error(`   ❌ Error authorizing ${executor}:`, error.message);
    }
  }

  // Print summary
  console.log("\n📊 Registration Summary:");
  const poolList = await engine.getActivePools();
  console.log(`   Active pools: ${poolList.length}`);
  
  for (const poolAddress of poolList) {
    const pool = await engine.skewPools(poolAddress);
    console.log(`   - ${poolAddress}`);
    console.log(`     Token0: ${pool.token0}`);
    console.log(`     Target: ${pool.targetRatio0 / 100}% / ${pool.targetRatio1 / 100}%`);
  }

  console.log("\n✨ Setup complete!");
  console.log("Next: Run the monitor with: npx hardhat run scripts/keeper/skew-monitor.js --network", network);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
