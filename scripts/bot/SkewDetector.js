const { ethers } = require('ethers');
const IUniswapV3PoolABI = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json').abi;
const IQuoterABI = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/IQuoter.sol/IQuoter.json').abi;

class SkewDetector {
    constructor(provider, config) {
        this.provider = provider;
        this.config = config;
        this.pools = new Map();
        this.erc20Cache = new Map();
        this.opportunityHistory = [];
        this.lastBlockProcessed = 0;
    }

    /**
     * Initialize pool monitoring
     */
    async initialize() {
        console.log('🔧 Initializing SkewDetector...');
        
        for (const [poolName, poolAddress] of Object.entries(this.config.pools)) {
            if (poolAddress === '0x0000000000000000000000000000000000000000') continue;
            if (!poolAddress) continue;
            
            try {
                const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, this.provider);
                
                // Get pool tokens
                const [token0, token1, fee] = await Promise.all([
                    poolContract.token0(),
                    poolContract.token1(),
                    poolContract.fee()
                ]);
                
                // Get token metadata
                const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
                    this._getTokenSymbol(token0),
                    this._getTokenSymbol(token1),
                    this._getTokenDecimals(token0),
                    this._getTokenDecimals(token1)
                ]);
                
                // Get skew config if available
                const skewConfig = this.config.skewConfig?.[poolName] || {
                    targetRatio0: 4950,  // Default 49.5%
                    targetRatio1: 5050,  // Default 50.5%
                    minDeviation: 30,     // 0.3% minimum
                    maxFlashSize: ethers.utils.parseUnits('500000', 6)
                };
                
                this.pools.set(poolAddress, {
                    name: poolName,
                    contract: poolContract,
                    address: poolAddress,
                    token0: { 
                        address: token0, 
                        symbol: symbol0, 
                        decimals: decimals0 
                    },
                    token1: { 
                        address: token1, 
                        symbol: symbol1, 
                        decimals: decimals1 
                    },
                    fee: fee,
                    targetRatio0: skewConfig.targetRatio0,
                    targetRatio1: skewConfig.targetRatio1,
                    minDeviation: skewConfig.minDeviation,
                    maxFlashSize: skewConfig.maxFlashSize,
                    lastCheck: 0,
                    checkCount: 0,
                    opportunityCount: 0
                });
                
                console.log(`  ✓ ${poolName}: ${symbol0}/${symbol1} (${fee/10000}%)`);
                
            } catch (error) {
                console.error(`  ✗ Failed to initialize ${poolName}:`, error.message);
            }
        }
        
        // Initialize Quoter for accurate price quotes
        if (this.config.quoterAddress) {
            this.quoter = new ethers.Contract(
                this.config.quoterAddress,
                IQuoterABI,
                this.provider
            );
        }
        
        console.log(`\n📊 Monitoring ${this.pools.size} pools for skew arbitrage\n`);
    }

    /**
     * Main scan function - check all pools for opportunities
     */
    async scanForOpportunities() {
        const currentBlock = await this.provider.getBlockNumber();
        
        if (currentBlock <= this.lastBlockProcessed) {
            return []; // Already processed this block
        }
        
        this.lastBlockProcessed = currentBlock;
        const opportunities = [];
        
        // Process pools in parallel with concurrency limit
        const batchSize = 5;
        const poolEntries = Array.from(this.pools.entries());
        
        for (let i = 0; i < poolEntries.length; i += batchSize) {
            const batch = poolEntries.slice(i, i + batchSize);
            
            const batchResults = await Promise.all(
                batch.map(async ([poolAddress, poolData]) => {
                    try {
                        return await this._checkPool(poolAddress, poolData);
                    } catch (error) {
                        console.error(`Error checking ${poolData.name}:`, error.message);
                        return null;
                    }
                })
            );
            
            batchResults.forEach(result => {
                if (result && result.isProfitable) {
                    opportunities.push(result);
                }
            });
            
            // Small delay between batches to avoid rate limiting
            if (i + batchSize < poolEntries.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        // Sort by profit potential (highest first)
        opportunities.sort((a, b) => b.profitPercent - a.profitPercent);
        
        // Log summary
        if (opportunities.length > 0) {
            console.log(`\n🎯 Block ${currentBlock}: Found ${opportunities.length} profitable opportunities`);
        }
        
        return opportunities;
    }

    /**
     * Check a single pool for skew arbitrage opportunity
     */
    async _checkPool(poolAddress, poolData) {
        poolData.checkCount++;
        
        // Get current pool state
        const [slot0, liquidity] = await Promise.all([
            poolData.contract.slot0(),
            poolData.contract.liquidity()
        ]);
        
        // Get token balances (reserves)
        const [balance0, balance1] = await this._getPoolBalances(
            poolAddress,
            poolData.token0.address,
            poolData.token1.address
        );
        
        // Normalize balances to 18 decimals for accurate ratio calculation
        const normalized0 = this._normalizeDecimals(balance0, poolData.token0.decimals);
        const normalized1 = this._normalizeDecimals(balance1, poolData.token1.decimals);
        
        const total = normalized0.add(normalized1);
        
        // Avoid division by zero
        if (total.isZero()) {
            return null;
        }
        
        // Calculate current ratios in basis points (10000 = 100%)
        const currentRatio0 = normalized0.mul(10000).div(total);
        const currentRatio1 = normalized1.mul(10000).div(total);
        
        // Calculate deviation from target
        const deviation0 = currentRatio0.gt(poolData.targetRatio0) 
            ? currentRatio0.sub(poolData.targetRatio0) 
            : poolData.targetRatio0.sub(currentRatio0);
        
        // Check if deviation is significant enough to act
        if (deviation0.lt(poolData.minDeviation)) {
            return null; // Not skewed enough
        }
        
        // Determine which token is overweighted (the one to flash loan)
        const isToken0Overweight = currentRatio0.gt(poolData.targetRatio0);
        const flashToken = isToken0Overweight ? poolData.token0 : poolData.token1;
        const targetToken = isToken0Overweight ? poolData.token1 : poolData.token0;
        
        // Calculate optimal flash amount based on skew size
        const flashAmount = this._calculateOptimalFlashAmount(
            deviation0,
            poolData.maxFlashSize,
            liquidity
        );
        
        // Skip if flash amount is too small
        if (flashAmount.lt(ethers.utils.parseUnits('1000', flashToken.decimals))) {
            return null;
        }
        
        // Estimate profit using Quoter or calculation
        const profitEstimate = await this._estimateProfitAccurate(
            poolAddress,
            flashToken,
            targetToken,
            flashAmount,
            poolData.fee,
            slot0.sqrtPriceX96
        );
        
        // Get gas cost estimate
        const gasCost = await this._estimateGasCost();
        
        // Calculate net profit
        const netProfit = profitEstimate.sub(gasCost);
        const isProfitable = netProfit.gt(0);
        
        // Calculate profit percentage
        const profitPercent = profitEstimate.mul(10000).div(flashAmount).toNumber() / 100;
        
        // Build opportunity object
        const opportunity = {
            id: `${poolData.name}_${Date.now()}`,
            poolName: poolData.name,
            poolAddress,
            token0: poolData.token0,
            token1: poolData.token1,
            flashToken,
            targetToken,
            flashToken0: isToken0Overweight,
            flashAmount,
            currentRatio0: this._formatPercent(currentRatio0),
            currentRatio1: this._formatPercent(currentRatio1),
            targetRatio0: poolData.targetRatio0 / 100,
            targetRatio1: poolData.targetRatio1 / 100,
            deviation: deviation0.toNumber() / 100,
            estimatedProfit: profitEstimate,
            gasCost,
            netProfit,
            profitPercent,
            isProfitable,
            liquidity: liquidity.toString(),
            sqrtPriceX96: slot0.sqrtPriceX96.toString(),
            tick: slot0.tick,
            fee: poolData.fee,
            timestamp: Date.now(),
            blockNumber: this.lastBlockProcessed
        };
        
        // Track opportunity if profitable
        if (isProfitable) {
            poolData.opportunityCount++;
            this._trackOpportunity(opportunity);
        }
        
        poolData.lastCheck = Date.now();
        
        return opportunity;
    }

    /**
     * Get pool token balances
     */
    async _getPoolBalances(poolAddress, token0Address, token1Address) {
        const token0Contract = new ethers.Contract(
            token0Address,
            ['function balanceOf(address) view returns (uint256)'],
            this.provider
        );
        const token1Contract = new ethers.Contract(
            token1Address,
            ['function balanceOf(address) view returns (uint256)'],
            this.provider
        );
        
        const [balance0, balance1] = await Promise.all([
            token0Contract.balanceOf(poolAddress),
            token1Contract.balanceOf(poolAddress)
        ]);
        
        return [balance0, balance1];
    }

    /**
     * Normalize token amount to 18 decimals
     */
    _normalizeDecimals(amount, decimals) {
        if (decimals === 18) return amount;
        if (decimals < 18) {
            return amount.mul(ethers.utils.parseUnits('1', 18 - decimals));
        }
        return amount.div(ethers.utils.parseUnits('1', decimals - 18));
    }

    /**
     * Calculate optimal flash amount based on skew
     */
    _calculateOptimalFlashAmount(deviation, maxFlashSize, liquidity) {
        // Base amount: scale with deviation
        // More deviation = larger flash = more profit potential
        const baseMultiplier = deviation.div(10); // 1% deviation = 10x base
        
        // Start with base flash size
        let flashAmount = ethers.utils.parseUnits('50000', 6); // 50k base
        
        // Scale by deviation
        flashAmount = flashAmount.mul(baseMultiplier).div(100);
        
        // Cap at max flash size
        if (flashAmount.gt(maxFlashSize)) {
            flashAmount = maxFlashSize;
        }
        
        // Also cap at 10% of pool liquidity to avoid excessive slippage
        const liquidityCap = liquidity.div(10);
        if (flashAmount.gt(liquidityCap)) {
            flashAmount = liquidityCap;
        }
        
        // Ensure minimum size
        const minFlash = ethers.utils.parseUnits('10000', 6); // 10k minimum
        if (flashAmount.lt(minFlash)) {
            flashAmount = minFlash;
        }
        
        return flashAmount;
    }

    /**
     * Accurate profit estimation using Quoter or calculation
     */
    async _estimateProfitAccurate(poolAddress, flashToken, targetToken, flashAmount, fee, sqrtPriceX96) {
        try {
            // Try to use Quoter for accurate estimate
            if (this.quoter) {
                const amountOutFromSkew = await this.quoter.callStatic.quoteExactInputSingle(
                    flashToken.address,
                    targetToken.address,
                    fee,
                    flashAmount,
                    0
                );
                
                // For exit, assume we get 0.3% less due to fees/slippage on balanced pool
                const exitAmount = amountOutFromSkew.mul(997).div(1000);
                
                // Convert back to flash token through balanced price
                const price = this._sqrtPriceX96ToPrice(sqrtPriceX96);
                const finalAmount = exitAmount.mul(ethers.utils.parseUnits('1', 18)).div(price);
                
                // Calculate flash fee
                const flashFee = flashAmount.mul(fee).div(1e6);
                
                if (finalAmount.gt(flashAmount.add(flashFee))) {
                    return finalAmount.sub(flashAmount).sub(flashFee);
                }
                
                return ethers.BigNumber.from(0);
            }
        } catch (error) {
            // Quoter failed, use calculation method
        }
        
        // Fallback calculation method
        return this._estimateProfitCalculated(
            flashAmount,
            fee,
            sqrtPriceX96,
            flashToken.decimals
        );
    }

    /**
     * Calculate profit from sqrtPriceX96
     */
    _estimateProfitCalculated(flashAmount, fee, sqrtPriceX96, decimals) {
        // Price = (sqrtPriceX96 / 2^96)^2
        const price = this._sqrtPriceX96ToPrice(sqrtPriceX96);
        
        // Estimated output from skewed pool (we get slight improvement)
        // Assume 0.4% improvement from skew per 1% deviation
        const skewImprovement = 40; // 0.4% in basis points
        const improvedPrice = price.mul(10000 + skewImprovement).div(10000);
        
        // Calculate output
        const amountOut = flashAmount.mul(improvedPrice).div(ethers.utils.parseUnits('1', decimals));
        
        // Subtract flash fee
        const flashFee = flashAmount.mul(fee).div(1e6);
        
        // Subtract exit costs (0.3% for balanced pool)
        const exitCost = amountOut.mul(30).div(10000);
        const finalAmount = amountOut.sub(exitCost);
        
        // Calculate profit
        const totalCost = flashAmount.add(flashFee);
        
        if (finalAmount.gt(totalCost)) {
            return finalAmount.sub(totalCost);
        }
        
        return ethers.BigNumber.from(0);
    }

    /**
     * Convert sqrtPriceX96 to price
     */
    _sqrtPriceX96ToPrice(sqrtPriceX96) {
        // price = (sqrtPriceX96 / 2^96)^2
        const Q96 = ethers.BigNumber.from(2).pow(96);
        const sqrtPrice = sqrtPriceX96.mul(ethers.utils.parseUnits('1', 18)).div(Q96);
        return sqrtPrice.mul(sqrtPrice).div(ethers.utils.parseUnits('1', 18));
    }

    /**
     * Estimate gas cost in ETH
     */
    async _estimateGasCost() {
        try {
            const gasPrice = await this.provider.getGasPrice();
            const estimatedGas = ethers.BigNumber.from(500000); // 500k gas for skew arb
            
            // Arbitrum: L2 gas + L1 data fee (simplified)
            const l2Cost = gasPrice.mul(estimatedGas);
            
            // Add ~20% for L1 data fee
            return l2Cost.mul(120).div(100);
        } catch (error) {
            // Fallback: assume $5 at current prices
            return ethers.utils.parseEther('0.0015');
        }
    }

    /**
     * Format basis points to percentage
     */
    _formatPercent(basisPoints) {
        return basisPoints.toNumber() / 100;
    }

    /**
     * Track opportunity for analytics
     */
    _trackOpportunity(opportunity) {
        this.opportunityHistory.push({
            ...opportunity,
            executed: false,
            executionResult: null
        });
        
        // Keep only last 1000 opportunities
        if (this.opportunityHistory.length > 1000) {
            this.opportunityHistory.shift();
        }
    }

    /**
     * Mark opportunity as executed
     */
    markExecuted(opportunityId, result) {
        const opp = this.opportunityHistory.find(o => o.id === opportunityId);
        if (opp) {
            opp.executed = true;
            opp.executionResult = result;
            opp.executedAt = Date.now();
        }
    }

    /**
     * Get performance statistics
     */
    getStats() {
        const totalOpportunities = this.opportunityHistory.length;
        const executedOpportunities = this.opportunityHistory.filter(o => o.executed).length;
        const totalEstimatedProfit = this.opportunityHistory
            .filter(o => o.executed)
            .reduce((sum, o) => sum.add(o.netProfit), ethers.BigNumber.from(0));
        
        const poolStats = [];
        for (const [address, data] of this.pools) {
            poolStats.push({
                name: data.name,
                checks: data.checkCount,
                opportunities: data.opportunityCount,
                hitRate: data.checkCount > 0 
                    ? ((data.opportunityCount / data.checkCount) * 100).toFixed(2) + '%'
                    : '0%'
            });
        }
        
        return {
            totalOpportunities,
            executedOpportunities,
            successRate: totalOpportunities > 0 
                ? ((executedOpportunities / totalOpportunities) * 100).toFixed(2) + '%'
                : '0%',
            totalEstimatedProfit: ethers.utils.formatEther(totalEstimatedProfit),
            poolStats,
            uptime: process.uptime()
        };
    }

    /**
     * Get token symbol with caching
     */
    async _getTokenSymbol(address) {
        if (this.erc20Cache.has(address)) {
            return this.erc20Cache.get(address).symbol;
        }
        
        const contract = new ethers.Contract(
            address,
            ['function symbol() view returns (string)'],
            this.provider
        );
        
        try {
            const symbol = await contract.symbol();
            this.erc20Cache.set(address, { symbol, decimals: null });
            return symbol;
        } catch {
            // Try bytes32 symbol (MKR, etc)
            try {
                const bytesContract = new ethers.Contract(
                    address,
                    ['function symbol() view returns (bytes32)'],
                    this.provider
                );
                const bytes = await bytesContract.symbol();
                const symbol = ethers.utils.parseBytes32String(bytes);
                this.erc20Cache.set(address, { symbol, decimals: null });
                return symbol;
            } catch {
                return 'UNKNOWN';
            }
        }
    }

    /**
     * Get token decimals with caching
     */
    async _getTokenDecimals(address) {
        const cached = this.erc20Cache.get(address);
        if (cached?.decimals) {
            return cached.decimals;
        }
        
        const contract = new ethers.Contract(
            address,
            ['function decimals() view returns (uint8)'],
            this.provider
        );
        
        try {
            const decimals = await contract.decimals();
            const current = this.erc20Cache.get(address) || {};
            current.decimals = decimals;
            this.erc20Cache.set(address, current);
            return decimals;
        } catch {
            return 18;
        }
    }

    /**
     * Update target ratios for a pool (for intentionally skewed pools)
     */
    setPoolTargetRatio(poolAddress, targetRatio0, targetRatio1, minDeviation) {
        const pool = this.pools.get(poolAddress);
        if (pool) {
            pool.targetRatio0 = targetRatio0;
            pool.targetRatio1 = targetRatio1;
            pool.minDeviation = minDeviation;
            console.log(`Updated ${pool.name}: ${targetRatio0/100}%/${targetRatio1/100}% (min dev: ${minDeviation/100}%)`);
        }
    }

    /**
     * Add a new pool dynamically
     */
    addPool(poolName, poolAddress, config = {}) {
        if (this.pools.has(poolAddress)) {
            console.log(`Pool ${poolName} already exists`);
            return;
        }
        
        const poolContract = new ethers.Contract(poolAddress, IUniswapV3PoolABI, this.provider);
        
        this.pools.set(poolAddress, {
            name: poolName,
            contract: poolContract,
            address: poolAddress,
            token0: { address: null, symbol: 'TBD', decimals: 18 },
            token1: { address: null, symbol: 'TBD', decimals: 18 },
            fee: config.fee || 500,
            targetRatio0: config.targetRatio0 || 4950,
            targetRatio1: config.targetRatio1 || 5050,
            minDeviation: config.minDeviation || 30,
            maxFlashSize: config.maxFlashSize || ethers.utils.parseUnits('500000', 6),
            lastCheck: 0,
            checkCount: 0,
            opportunityCount: 0
        });
        
        // Async initialization of token data
        this._initializePoolTokens(poolAddress);
    }

    /**
     * Initialize token data for dynamically added pool
     */
    async _initializePoolTokens(poolAddress) {
        const pool = this.pools.get(poolAddress);
        if (!pool) return;
        
        try {
            const [token0, token1, fee] = await Promise.all([
                pool.contract.token0(),
                pool.contract.token1(),
                pool.contract.fee()
            ]);
            
            const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
                this._getTokenSymbol(token0),
                this._getTokenSymbol(token1),
                this._getTokenDecimals(token0),
                this._getTokenDecimals(token1)
            ]);
            
            pool.token0 = { address: token0, symbol: symbol0, decimals: decimals0 };
            pool.token1 = { address: token1, symbol: symbol1, decimals: decimals1 };
            pool.fee = fee;
            
            console.log(`✓ Initialized ${pool.name}: ${symbol0}/${symbol1}`);
        } catch (error) {
            console.error(`Failed to initialize ${pool.name}:`, error.message);
        }
    }

    /**
     * Get current pool state (for monitoring)
     */
    async getPoolState(poolAddress) {
        const pool = this.pools.get(poolAddress);
        if (!pool) return null;
        
        try {
            const [slot0, liquidity] = await Promise.all([
                pool.contract.slot0(),
                pool.contract.liquidity()
            ]);
            
            const [balance0, balance1] = await this._getPoolBalances(
                poolAddress,
                pool.token0.address,
                pool.token1.address
            );
            
            const normalized0 = this._normalizeDecimals(balance0, pool.token0.decimals);
            const normalized1 = this._normalizeDecimals(balance1, pool.token1.decimals);
            const total = normalized0.add(normalized1);
            
            return {
                name: pool.name,
                address: poolAddress,
                token0: pool.token0,
                token1: pool.token1,
                balance0: balance0.toString(),
                balance1: balance1.toString(),
                ratio0: total.isZero() ? 0 : normalized0.mul(10000).div(total).toNumber() / 100,
                ratio1: total.isZero() ? 0 : normalized1.mul(10000).div(total).toNumber() / 100,
                target0: pool.targetRatio0 / 100,
                target1: pool.targetRatio1 / 100,
                liquidity: liquidity.toString(),
                sqrtPriceX96: slot0.sqrtPriceX96.toString(),
                tick: slot0.tick,
                fee: pool.fee,
                lastCheck: pool.lastCheck
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * Get all pool states
     */
    async getAllPoolStates() {
        const states = [];
        for (const [address, pool] of this.pools) {
            const state = await this.getPoolState(address);
            if (state) states.push(state);
        }
        return states;
    }
}

module.exports = SkewDetector;
