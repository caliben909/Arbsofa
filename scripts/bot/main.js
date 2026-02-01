require('dotenv').config();
const { ethers } = require('ethers');
const config = require('../../config');
const SkewDetector = require('./SkewDetector');
const OpportunityValidator = require('./OpportunityValidator');
const ExecutionEngine = require('./ExecutionEngine');
const GasOptimizer = require('./GasOptimizer');

async function main() {
    // Setup provider with fallback
    const providers = [
        new ethers.providers.JsonRpcProvider(config.rpc.primary),
        new ethers.providers.JsonRpcProvider(config.rpc.fallback)
    ];
    const provider = new ethers.providers.FallbackProvider(providers);
    
    const wallet = new ethers.Wallet(config.privateKey, provider);
    
    console.log(`🚀 Skew Arbitrage Bot Starting...`);
    console.log(`📍 Address: ${wallet.address}`);
    console.log(`⛓️  Chain: Arbitrum (${config.chainId})`);
    console.log(`💰 Min Profit: ${config.minProfitBP || 0.15}%`);
    
    // Initialize components
    const detector = new SkewDetector(provider, config);
    const validator = new OpportunityValidator(provider, config);
    const gasOptimizer = new GasOptimizer(provider, config);
    const engine = new ExecutionEngine(provider, wallet, config);
    
    await detector.initialize();
    await engine.initialize();
    
    // Register intentionally skewed pools
    for (const [poolName, poolAddress] of Object.entries(config.pools)) {
        if (poolAddress === '0x0000000000000000000000000000000000000000') continue;
        
        const skewConfig = config.skewConfig?.[poolName];
        if (skewConfig) {
            detector.setPoolTargetRatio(
                poolAddress,
                skewConfig.targetRatio0,
                skewConfig.targetRatio1,
                skewConfig.minDeviation
            );
        }
    }
    
    console.log(`\n🎯 Monitoring ${detector.pools.size} pools for skew arbitrage...`);
    
    // Stats reporting interval
    setInterval(() => {
        const stats = detector.getStats();
        console.log('\n📊 STATS:');
        console.log(`   Opportunities: ${stats.totalOpportunities} total, ${stats.executedOpportunities} executed`);
        console.log(`   Success Rate: ${stats.successRate}`);
        console.log(`   Est. Profit: ${stats.totalEstimatedProfit} ETH`);
        console.log(`   Uptime: ${Math.floor(stats.uptime / 60)}m`);
    }, 60000); // Every minute
    
    // Main loop
    while (true) {
        try {
            // Check gas prices first
            const gasTrend = gasOptimizer.getTrend();
            const gasFavorable = await gasOptimizer.isGasFavorable();
            
            if (!gasFavorable && gasTrend === 'rising') {
                console.log('⛽ Gas prices rising, waiting...');
                await new Promise(resolve => setTimeout(resolve, 10000));
                continue;
            }
            
            // Scan for opportunities
            const opportunities = await detector.scanForOpportunities();
            
            if (opportunities.length > 0) {
                console.log(`\n🔍 Found ${opportunities.length} opportunities at block ${await provider.getBlockNumber()}`);
                
                // Process top opportunities
                for (const opp of opportunities.slice(0, config.bundleSize || 2)) {
                    console.log(`\n  📊 ${opp.poolName}`);
                    console.log(`     Skew: ${opp.currentRatio0.toFixed(2)}%/${opp.currentRatio1.toFixed(2)}% (target: ${opp.targetRatio0}%)`);
                    console.log(`     Deviation: ${opp.deviation.toFixed(2)}%`);
                    console.log(`     Flash: ${ethers.utils.formatUnits(opp.flashAmount, opp.flashToken.decimals)} ${opp.flashToken.symbol}`);
                    console.log(`     Est. Profit: ${ethers.utils.formatEther(opp.netProfit)} ETH (${opp.profitPercent.toFixed(3)}%)`);
                    
                    // Validate opportunity
                    const validation = await validator.validate(opp);
                    
                    if (!validation.valid) {
                        console.log(`     ⏭️  VALIDATION FAILED: ${validation.reasons.join(', ')}`);
                        validator.recordFailure(opp, 'validation_failed');
                        continue;
                    }
                    
                    console.log(`     ✅ VALIDATED - Executing...`);
                    
                    // Get optimal gas
                    const gasConfig = await gasOptimizer.getOptimalGasPrice('high');
                    
                    try {
                        const result = await engine.execute(opp, gasConfig);
                        console.log(`     🎉 SUCCESS: ${result.method} - ${result.hash}`);
                        detector.markExecuted(opp.id, result);
                    } catch (error) {
                        console.log(`     ❌ FAILED: ${error.message}`);
                        validator.recordFailure(opp, error.message);
                    }
                }
            } else {
                process.stdout.write('.');
            }
            
            // Dynamic delay based on activity
            const delay = opportunities.length > 0 ? 1000 : 2000;
            await new Promise(resolve => setTimeout(resolve, delay));
            
        } catch (error) {
            console.error('\n❌ Main loop error:', error);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutting down gracefully...');
    process.exit(0);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

main().catch(console.error);
