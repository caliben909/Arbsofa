const { ethers } = require('ethers');

const UNISWAP_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// Real Arbitrum addresses
const TOKENS = {
  PAXG: "0x2BA8349123de45E941a136e6D766c90b288B3D09",
  XAUT: "0x0C5566c8BA86d03A5cE419132D8BD4b35E8381A2",
  USDC: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  USDT: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  WETH: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  WBTC: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
};

async function discoverPools(provider, tokenA, tokenB, symbolA, symbolB) {
    const factory = new ethers.Contract(
        UNISWAP_V3_FACTORY,
        ['function getPool(address,address,uint24) view returns (address)'],
        provider
    );
    
    console.log(`\n🔍 Discovering pools for ${symbolA} / ${symbolB}...`);
    console.log(`   ${tokenA}`);
    console.log(`   ${tokenB}`);
    
    const pools = [];
    
    for (const fee of FEE_TIERS) {
        try {
            const pool = await factory.getPool(tokenA, tokenB, fee);
            
            if (pool !== '0x0000000000000000000000000000000000000000') {
                // Verify pool has liquidity
                const poolContract = new ethers.Contract(
                    pool,
                    [
                        'function liquidity() view returns (uint128)',
                        'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'
                    ],
                    provider
                );
                
                const [liquidity, slot0] = await Promise.all([
                    poolContract.liquidity(),
                    poolContract.slot0()
                ]);
                
                const liquidityEth = ethers.utils.formatEther(liquidity.toString());
                
                console.log(`  ✅ Fee ${fee/10000}%: ${pool}`);
                console.log(`     Liquidity: ${liquidityEth} ETH`);
                console.log(`     Tick: ${slot0[1]}`);
                
                pools.push({
                    address: pool,
                    fee: fee,
                    liquidity: liquidity.toString(),
                    tick: slot0[1]
                });
            } else {
                console.log(`  ❌ Fee ${fee/10000}%: No pool exists`);
            }
        } catch (error) {
            console.log(`  ⚠️  Fee ${fee/10000}%: Error checking pool - ${error.message}`);
        }
    }
    
    return pools;
}

async function main() {
    const provider = new ethers.providers.JsonRpcProvider(
        process.env.ARB_RPC || "https://arb-mainnet.g.alchemy.com/v2/demo"
    );
    
    console.log("============================================");
    console.log("🥇 GOLD POOL DISCOVERY ON ARBITRUM");
    console.log("============================================");
    
    // Check PAXG pairs
    console.log("\n📊 PAXG (PAX Gold) Pools:");
    console.log("   Token:", TOKENS.PAXG);
    
    const paxgUsdc = await discoverPools(provider, TOKENS.PAXG, TOKENS.USDC, "PAXG", "USDC");
    const paxgWeth = await discoverPools(provider, TOKENS.PAXG, TOKENS.WETH, "PAXG", "WETH");
    const paxgUsdt = await discoverPools(provider, TOKENS.PAXG, TOKENS.USDT, "PAXG", "USDT");
    const paxgWbtc = await discoverPools(provider, TOKENS.PAXG, TOKENS.WBTC, "PAXG", "WBTC");
    
    // Check XAUT pairs
    console.log("\n📊 XAUT (Tether Gold) Pools:");
    console.log("   Token:", TOKENS.XAUT);
    
    const xautUsdc = await discoverPools(provider, TOKENS.XAUT, TOKENS.USDC, "XAUT", "USDC");
    const xautWeth = await discoverPools(provider, TOKENS.XAUT, TOKENS.WETH, "XAUT", "WETH");
    
    // Summary
    console.log("\n============================================");
    console.log("📋 SUMMARY");
    console.log("============================================");
    
    const allPools = {
        "PAXG/USDC": paxgUsdc,
        "PAXG/WETH": paxgWeth,
        "PAXG/USDT": paxgUsdt,
        "PAXG/WBTC": paxgWbtc,
        "XAUT/USDC": xautUsdc,
        "XAUT/WETH": xautWeth,
    };
    
    let foundCount = 0;
    let missingCount = 0;
    
    for (const [pair, pools] of Object.entries(allPools)) {
        if (pools.length > 0) {
            console.log(`✅ ${pair}: ${pools.length} pool(s) found`);
            foundCount++;
        } else {
            console.log(`❌ ${pair}: No pools exist - NEED TO CREATE`);
            missingCount++;
        }
    }
    
    console.log("\n============================================");
    console.log(`Found: ${foundCount} pairs with pools`);
    console.log(`Missing: ${missingCount} pairs need pool creation`);
    console.log("============================================");
    
    // Output config-ready format
    console.log("\n📄 CONFIG.JS FORMAT:");
    console.log("goldPools: {");
    for (const [pair, pools] of Object.entries(allPools)) {
        if (pools.length > 0) {
            // Use the pool with highest liquidity
            const bestPool = pools.reduce((a, b) => 
                ethers.BigNumber.from(a.liquidity).gt(b.liquidity) ? a : b
            );
            console.log(`  "${pair}": {`);
            console.log(`    address: "${bestPool.address}",`);
            console.log(`    fee: ${bestPool.fee},`);
            console.log(`    targetRatio0: 4950,`);
            console.log(`    targetRatio1: 5050,`);
            console.log(`    minDeviation: 50,`);
            console.log(`    maxFlashSize: ethers.utils.parseUnits('50', 18),`);
            console.log(`    isGold: true,`);
            console.log(`    goldType: '${pair.split('/')[0]}'`);
            console.log(`  },`);
        }
    }
    console.log("}");
}

main().catch(error => {
    console.error("Error:", error);
    process.exit(1);
});
