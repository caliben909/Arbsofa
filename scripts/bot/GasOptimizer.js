const { ethers } = require('ethers');

/**
 * Optimizes gas pricing for Arbitrum transactions
 */
class GasOptimizer {
    constructor(provider, config) {
        this.provider = provider;
        this.config = config;
        this.priceHistory = [];
        this.maxHistory = 100;
    }

    /**
     * Get optimal gas pricing for transaction
     */
    async getOptimalGasPrice(urgency = 'normal') {
        const currentGas = await this.provider.getGasPrice();
        const block = await this.provider.getBlock('latest');
        
        // Track history
        this.priceHistory.push({
            price: currentGas,
            timestamp: Date.now(),
            block: block.number
        });
        
        if (this.priceHistory.length > this.maxHistory) {
            this.priceHistory.shift();
        }
        
        // Calculate percentiles
        const sorted = [...this.priceHistory].sort((a, b) => a.price.sub(b.price));
        const median = sorted[Math.floor(sorted.length / 2)]?.price || currentGas;
        const p75 = sorted[Math.floor(sorted.length * 0.75)]?.price || currentGas;
        
        let maxFee, priorityFee;
        
        switch (urgency) {
            case 'high': // Execute immediately
                maxFee = currentGas.mul(150).div(100); // 50% above current
                priorityFee = ethers.utils.parseUnits('0.5', 'gwei');
                break;
                
            case 'low': // Wait for cheaper gas
                maxFee = median.mul(110).div(100); // 10% above median
                priorityFee = ethers.utils.parseUnits('0.05', 'gwei');
                break;
                
            case 'normal':
            default:
                maxFee = p75.mul(120).div(100); // 20% above 75th percentile
                priorityFee = ethers.utils.parseUnits('0.1', 'gwei');
                break;
        }
        
        // Enforce absolute maximums
        const absoluteMax = ethers.BigNumber.from(this.config.bundle?.maxGasPrice || '1500000000');
        if (maxFee.gt(absoluteMax)) {
            maxFee = absoluteMax;
        }
        
        return {
            maxFeePerGas: maxFee,
            maxPriorityFeePerGas: priorityFee,
            estimatedCost: maxFee.mul(500000), // 500k gas
            urgency
        };
    }

    /**
     * Check if current gas price is favorable
     */
    async isGasFavorable() {
        const current = await this.provider.getGasPrice();
        const median = this._getMedianPrice();
        
        // Favorable if current <= median
        return current.lte(median);
    }

    _getMedianPrice() {
        if (this.priceHistory.length === 0) {
            return ethers.utils.parseUnits('0.1', 'gwei');
        }
        
        const sorted = [...this.priceHistory].sort((a, b) => a.price.sub(b.price));
        return sorted[Math.floor(sorted.length / 2)].price;
    }

    /**
     * Get gas price trend
     */
    getTrend() {
        if (this.priceHistory.length < 10) return 'stable';
        
        const recent = this.priceHistory.slice(-10);
        const older = this.priceHistory.slice(0, 10);
        
        const recentAvg = recent.reduce((a, b) => a.add(b.price), ethers.BigNumber.from(0))
            .div(recent.length);
        const olderAvg = older.reduce((a, b) => a.add(b.price), ethers.BigNumber.from(0))
            .div(older.length);
        
        const diff = recentAvg.sub(olderAvg).mul(100).div(olderAvg).toNumber();
        
        if (diff > 20) return 'rising';
        if (diff < -20) return 'falling';
        return 'stable';
    }
}

module.exports = GasOptimizer;
