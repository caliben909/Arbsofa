const { ethers } = require('ethers');

/**
 * Validates arbitrage opportunities before execution
 * Prevents failed transactions and wasted gas
 */
class OpportunityValidator {
    constructor(provider, config) {
        this.provider = provider;
        this.config = config;
        this.recentFailures = new Map(); // Track recent failed attempts
    }

    /**
     * Validate an opportunity before execution
     */
    async validate(opportunity) {
        const checks = await Promise.all([
            this._checkPoolStillSkewed(opportunity),
            this._checkSufficientLiquidity(opportunity),
            this._checkGasPriceReasonable(),
            this._checkNotRecentlyFailed(opportunity),
            this._checkProfitStillValid(opportunity)
        ]);

        const failures = checks.filter(c => !c.passed);
        
        if (failures.length > 0) {
            return {
                valid: false,
                reasons: failures.map(f => f.reason)
            };
        }

        return { valid: true };
    }

    /**
     * Check if pool is still skewed (state hasn't changed)
     */
    async _checkPoolStillSkewed(opp) {
        try {
            const poolContract = new ethers.Contract(
                opp.poolAddress,
                ['function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)'],
                this.provider
            );
            
            const slot0 = await poolContract.slot0();
            const currentSqrtPrice = slot0.sqrtPriceX96.toString();
            
            // If price moved significantly, opportunity may be gone
            if (currentSqrtPrice !== opp.sqrtPriceX96) {
                // Allow small deviation (0.1%)
                const oldPrice = ethers.BigNumber.from(opp.sqrtPriceX96);
                const newPrice = slot0.sqrtPriceX96;
                const diff = newPrice.sub(oldPrice).abs();
                const diffPercent = diff.mul(10000).div(oldPrice);
                
                if (diffPercent.gt(10)) { // > 0.1% change
                    return {
                        passed: false,
                        reason: `Price moved ${(diffPercent.toNumber()/100).toFixed(2)}%`
                    };
                }
            }
            
            return { passed: true };
        } catch (error) {
            return { passed: false, reason: `Pool check failed: ${error.message}` };
        }
    }

    /**
     * Check if there's sufficient liquidity for the trade
     */
    async _checkSufficientLiquidity(opp) {
        // Flash amount should be < 10% of liquidity
        const liquidity = ethers.BigNumber.from(opp.liquidity);
        const maxTrade = liquidity.div(10);
        
        if (opp.flashAmount.gt(maxTrade)) {
            return {
                passed: false,
                reason: `Flash amount ${ethers.utils.formatUnits(opp.flashAmount, opp.flashToken.decimals)} exceeds 10% of liquidity`
            };
        }
        
        return { passed: true };
    }

    /**
     * Check if gas price is reasonable
     */
    async _checkGasPriceReasonable() {
        const gasPrice = await this.provider.getGasPrice();
        const maxGas = ethers.BigNumber.from(this.config.bundle?.maxGasPrice || '1500000000');
        
        if (gasPrice.gt(maxGas)) {
            return {
                passed: false,
                reason: `Gas price ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei exceeds max ${ethers.utils.formatUnits(maxGas, 'gwei')} gwei`
            };
        }
        
        return { passed: true };
    }

    /**
     * Check if we recently failed on this opportunity (avoid retry spam)
     */
    _checkNotRecentlyFailed(opp) {
        const key = `${opp.poolAddress}_${opp.flashToken.symbol}_${opp.targetToken.symbol}`;
        const lastFailure = this.recentFailures.get(key);
        
        if (lastFailure && Date.now() - lastFailure < 60000) { // 1 minute cooldown
            return {
                passed: false,
                reason: 'Recent failure cooldown'
            };
        }
        
        return { passed: true };
    }

    /**
     * Check if profit estimate is still valid
     */
    async _checkProfitStillValid(opp) {
        // Recalculate with current gas
        const gasPrice = await this.provider.getGasPrice();
        const gasCost = gasPrice.mul(500000);
        
        if (opp.estimatedProfit.lte(gasCost)) {
            return {
                passed: false,
                reason: `Profit ${ethers.utils.formatEther(opp.estimatedProfit)} ETH <= gas ${ethers.utils.formatEther(gasCost)} ETH`
            };
        }
        
        return { passed: true };
    }

    /**
     * Record a failure for cooldown tracking
     */
    recordFailure(opportunity, reason) {
        const key = `${opportunity.poolAddress}_${opportunity.flashToken.symbol}_${opportunity.targetToken.symbol}`;
        this.recentFailures.set(key, Date.now());
        
        // Clean up old entries
        for (const [k, v] of this.recentFailures) {
            if (Date.now() - v > 300000) { // 5 minutes
                this.recentFailures.delete(k);
            }
        }
    }
}

module.exports = OpportunityValidator;
