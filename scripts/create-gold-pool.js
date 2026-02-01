const { ethers } = require('ethers');

// Uniswap V3 Position Manager on Arbitrum
const POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

// Real Arbitrum addresses
const TOKENS = {
  PAXG: "0x2BA8349123de45E941a136e6D766c90b288B3D09",
  XAUT: "0x0C5566c8BA86d03A5cE419132D8BD4b35E8381A2",
  USDC: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
};

/**
 * Convert price to sqrtPriceX96
 * sqrtPriceX96 = sqrt(price) * 2^96
 */
function priceToSqrtPriceX96(price) {
    const sqrtPrice = Math.sqrt(price);
    const Q96 = ethers.BigNumber.from(2).pow(96);
    return ethers.BigNumber.from(Math.floor(sqrtPrice * 2**96));
}

/**
 * Create and initialize a Uniswap V3 pool if it doesn't exist
 */
async function createPool(wallet, token0, token1, fee, initialPrice, symbol0, symbol1) {
    const positionManager = new ethers.Contract(
        POSITION_MANAGER,
        [
            'function createAndInitializePoolIfNecessary(address,address,uint24,uint160) external payable returns (address)',
            'function mint(tuple(address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) external payable returns (uint256,uint128,uint256,uint256)'
        ],
        wallet
    );
    
    // Ensure correct token order
    if (token0.toLowerCase() > token1.toLowerCase()) {
        [token0, token1] = [token1, token0];
        [symbol0, symbol1] = [symbol1, symbol0];
        initialPrice = 1 / initialPrice; // Invert price
    }
    
    const sqrtPriceX96 = priceToSqrtPriceX96(initialPrice);
    
    console.log(`\n🚀 Creating pool for ${symbol0}/${symbol1}`);
    console.log(`   Fee: ${fee/10000}%`);
    console.log(`   Initial price: 1 ${symbol0} = ${initialPrice} ${symbol1}`);
    console.log(`   sqrtPriceX96: ${sqrtPriceX96.toString()}`);
    
    try {
        const tx = await positionManager.createAndInitializePoolIfNecessary(
            token0,
            token1,
            fee,
            sqrtPriceX96,
            { 
                gasLimit: 500000,
                value: ethers.utils.parseEther('0.01') // Small ETH for gas
            }
        );
        
        console.log(`   ⏳ Transaction sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`   ✅ Pool created! Gas used: ${receipt.gasUsed}`);
        
        // Get pool address from factory
        const factory = new ethers.Contract(
            FACTORY,
            ['function getPool(address,address,uint24) view returns (address)'],
            wallet.provider
        );
        
        const poolAddress = await factory.getPool(token0, token1, fee);
        console.log(`   📍 Pool address: ${poolAddress}`);
        
        return poolAddress;
    } catch (error) {
        console.error(`   ❌ Failed to create pool: ${error.message}`);
        throw error;
    }
}

/**
 * Add initial liquidity to a pool
 */
async function addLiquidity(wallet, token0, token1, fee, amount0, amount1, symbol0, symbol1) {
    const positionManager = new ethers.Contract(
        POSITION_MANAGER,
        [
            'function mint(tuple(address,address,uint24,int24,int24,uint256,uint256,uint256,uint256,address,uint256)) external payable returns (uint256,uint128,uint256,uint256)',
            'function approve(address,uint256) external returns (bool)'
        ],
        wallet
    );
    
    console.log(`\n💧 Adding liquidity to ${symbol0}/${symbol1}`);
    console.log(`   ${symbol0}: ${ethers.utils.formatUnits(amount0, 18)}`);
    console.log(`   ${symbol1}: ${ethers.utils.formatUnits(amount1, 18)}`);
    
    // Approve tokens
    const token0Contract = new ethers.Contract(
        token0,
        ['function approve(address,uint256) external returns (bool)'],
        wallet
    );
    const token1Contract = new ethers.Contract(
        token1,
        ['function approve(address,uint256) external returns (bool)'],
        wallet
    );
    
    console.log(`   Approving ${symbol0}...`);
    await (await token0Contract.approve(POSITION_MANAGER, amount0)).wait();
    
    console.log(`   Approving ${symbol1}...`);
    await (await token1Contract.approve(POSITION_MANAGER, amount1)).wait();
    
    // Calculate tick range (wide range for skewed pool)
    // For gold, we want a 48.5/51.5 split, so we skew the range
    const tickLower = -887220; // Full range lower
    const tickUpper = 887220;  // Full range upper
    
    const mintParams = {
        token0: token0,
        token1: token1,
        fee: fee,
        tickLower: tickLower,
        tickUpper: tickUpper,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0,
        amount1Min: 0,
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 3600
    };
    
    try {
        const tx = await positionManager.mint(mintParams, {
            gasLimit: 1000000,
            value: ethers.utils.parseEther('0.01')
        });
        
        console.log(`   ⏳ Liquidity addition sent: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`   ✅ Liquidity added! Gas used: ${receipt.gasUsed}`);
        
        return receipt;
    } catch (error) {
        console.error(`   ❌ Failed to add liquidity: ${error.message}`);
        throw error;
    }
}

async function main() {
    // Setup provider and wallet
    const provider = new ethers.providers.JsonRpcProvider(process.env.ARB_RPC);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log("============================================");
    console.log("🥇 GOLD POOL CREATION ON ARBITRUM");
    console.log("============================================");
    console.log(`Wallet: ${wallet.address}`);
    
    // Check ETH balance
    const balance = await wallet.getBalance();
    console.log(`ETH Balance: ${ethers.utils.formatEther(balance)} ETH`);
    
    if (balance.lt(ethers.utils.parseEther('0.1'))) {
        console.error("❌ Insufficient ETH for gas. Need at least 0.1 ETH");
        process.exit(1);
    }
    
    // Pool configurations
    const poolsToCreate = [
        {
            symbol0: "PAXG",
            symbol1: "USDC",
            token0: TOKENS.PAXG,
            token1: TOKENS.USDC,
            fee: 3000, // 0.3%
            initialPrice: 2600, // 1 PAXG = 2600 USDC (approximate)
            amount0: ethers.utils.parseUnits('10', 18),   // 10 PAXG
            amount1: ethers.utils.parseUnits('26000', 6)  // 26,000 USDC
        },
        {
            symbol0: "PAXG",
            symbol1: "WETH",
            token0: TOKENS.PAXG,
            token1: TOKENS.WETH,
            fee: 3000,
            initialPrice: 0.85, // 1 PAXG = 0.85 WETH
            amount0: ethers.utils.parseUnits('10', 18),
            amount1: ethers.utils.parseUnits('8.5', 18)
        },
        {
            symbol0: "PAXG",
            symbol1: "USDT",
            token0: TOKENS.PAXG,
            token1: TOKENS.USDT,
            fee: 3000,
            initialPrice: 2600,
            amount0: ethers.utils.parseUnits('10', 18),
            amount1: ethers.utils.parseUnits('26000', 6)
        }
    ];
    
    const createdPools = [];
    
    for (const poolConfig of poolsToCreate) {
        try {
            console.log("\n--------------------------------------------");
            
            // Create pool
            const poolAddress = await createPool(
                wallet,
                poolConfig.token0,
                poolConfig.token1,
                poolConfig.fee,
                poolConfig.initialPrice,
                poolConfig.symbol0,
                poolConfig.symbol1
            );
            
            // Add liquidity
            await addLiquidity(
                wallet,
                poolConfig.token0,
                poolConfig.token1,
                poolConfig.fee,
                poolConfig.amount0,
                poolConfig.amount1,
                poolConfig.symbol0,
                poolConfig.symbol1
            );
            
            createdPools.push({
                pair: `${poolConfig.symbol0}/${poolConfig.symbol1}`,
                address: poolAddress,
                fee: poolConfig.fee
            });
            
        } catch (error) {
            console.error(`\n❌ Failed to create ${poolConfig.symbol0}/${poolConfig.symbol1} pool:`, error.message);
        }
    }
    
    // Summary
    console.log("\n============================================");
    console.log("📋 CREATED POOLS SUMMARY");
    console.log("============================================");
    
    if (createdPools.length === 0) {
        console.log("❌ No pools were created");
    } else {
        console.log(`✅ Successfully created ${createdPools.length} pools:\n`);
        createdPools.forEach(pool => {
            console.log(`  ${pool.pair}:`);
            console.log(`    Address: ${pool.address}`);
            console.log(`    Fee: ${pool.fee/10000}%`);
            console.log();
        });
        
        console.log("📄 Add these to your config.js:");
        console.log("goldPools: {");
        createdPools.forEach(pool => {
            console.log(`  "${pool.pair}": {`);
            console.log(`    address: "${pool.address}",`);
            console.log(`    fee: ${pool.fee},`);
            console.log(`    targetRatio0: 4850, // 48.5%`);
            console.log(`    targetRatio1: 5150, // 51.5%`);
            console.log(`    minDeviation: 50,`);
            console.log(`    maxFlashSize: ethers.utils.parseUnits('50', 18),`);
            console.log(`    isGold: true,`);
            console.log(`    goldType: 'PAXG'`);
            console.log(`  },`);
        });
        console.log("}");
    }
}

main().catch(error => {
    console.error("\nFatal error:", error);
    process.exit(1);
});
