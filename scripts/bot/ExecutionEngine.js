const { ethers } = require('ethers');
const IUniswapV3PoolABI = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json').abi;
const ISwapRouterABI = require('@uniswap/v3-periphery/artifacts/contracts/interfaces/ISwapRouter.sol/ISwapRouter.json').abi;

/**
 * ExecutionEngine - Handles flash loan arbitrage execution
 * Supports Uniswap V3 flash loans and Aave flash loans
 */
class ExecutionEngine {
    constructor(provider, wallet, config) {
        this.provider = provider;
        this.wallet = wallet;
        this.config = config;
        this.nonce = null;
        this.pendingTxs = new Map();
    }

    /**
     * Initialize the execution engine
     */
    async initialize() {
        console.log('🔧 Initializing ExecutionEngine...');
        
        // Get initial nonce
        this.nonce = await this.wallet.getTransactionCount('pending');
        
        // Load contract ABIs
        this.router = new ethers.Contract(
            this.config.routerAddress,
            ISwapRouterABI,
            this.wallet
        );
        
        console.log(`  ✓ Wallet: ${this.wallet.address}`);
        console.log(`  ✓ Router: ${this.config.routerAddress}`);
        console.log(`  ✓ Initial nonce: ${this.nonce}`);
    }

    /**
     * Execute arbitrage opportunity
     */
    async execute(opportunity, gasConfig) {
        const startTime = Date.now();
        
        try {
            // Determine execution strategy
            if (opportunity.isGold) {
                return await this.executeGoldArbitrage(opportunity, gasConfig);
            } else if (opportunity.useAave) {
                return await this._executeAaveFlashLoan(opportunity, gasConfig);
            } else {
                return await this._executeUniswapFlashLoan(opportunity, gasConfig);
            }
        } catch (error) {
            console.error('Execution failed:', error.message);
            throw error;
        }
    }

    /**
     * Execute via Uniswap V3 flash loan
     */
    async _executeUniswapFlashLoan(opp, gasConfig) {
        const poolContract = new ethers.Contract(
            opp.poolAddress,
            IUniswapV3PoolABI,
            this.wallet
        );

        // Prepare flash loan parameters
        const flashAmount0 = opp.flashToken0 ? opp.flashAmount : 0;
        const flashAmount1 = opp.flashToken0 ? 0 : opp.flashAmount;

        // Encode callback data
        const callbackData = ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'uint256', 'uint256', 'bool'],
            [
                opp.flashToken.address,
                opp.targetToken.address,
                opp.flashAmount,
                opp.minProfit || 0,
                false // not Aave
            ]
        );

        // Estimate gas
        const gasLimit = await poolContract.estimateGas.flash(
            this.wallet.address,
            flashAmount0,
            flashAmount1,
            callbackData
        );

        // Execute flash loan
        const tx = await poolContract.flash(
            this.wallet.address,
            flashAmount0,
            flashAmount1,
            callbackData,
            {
                gasLimit: gasLimit.mul(120).div(100), // 20% buffer
                maxFeePerGas: gasConfig.maxFeePerGas,
                maxPriorityFeePerGas: gasConfig.maxPriorityFeePerGas,
                nonce: this._getNonce()
            }
        );

        console.log(`  📤 Flash loan tx sent: ${tx.hash}`);

        // Wait for confirmation
        const receipt = await tx.wait();

        if (receipt.status === 1) {
            return {
                success: true,
                method: 'uniswap_flash',
                hash: tx.hash,
                gasUsed: receipt.gasUsed.toString(),
                blockNumber: receipt.blockNumber,
                duration: Date.now() - startTime
            };
        } else {
            throw new Error('Transaction failed');
        }
    }

    /**
     * Execute via Aave flash loan (for larger amounts)
     */
    async _executeAaveFlashLoan(opp, gasConfig) {
        const aavePool = new ethers.Contract(
            this.config.aavePool,
            [
                'function flashLoan(address receiver, address[] calldata assets, uint256[] calldata amounts, uint256[] calldata modes, address onBehalfOf, bytes calldata params, uint16 referralCode) external'
            ],
            this.wallet
        );

        const assets = [opp.flashToken.address];
        const amounts = [opp.flashAmount];
        const modes = [0]; // 0 = no debt

        // Encode params
        const params = ethers.utils.defaultAbiCoder.encode(
            ['address', 'address', 'uint256', 'uint256'],
            [
                opp.targetToken.address,
                opp.poolAddress, // skewed pool for swap
                opp.flashAmount,
                opp.minProfit || 0
            ]
        );

        const tx = await aavePool.flashLoan(
            this.wallet.address,
            assets,
            amounts,
            modes,
            this.wallet.address,
            params,
            0,
            {
                gasLimit: 800000,
                maxFeePerGas: gasConfig.maxFeePerGas,
                maxPriorityFeePerGas: gasConfig.maxPriorityFeePerGas,
                nonce: this._getNonce()
            }
        );

        console.log(`  📤 Aave flash loan tx sent: ${tx.hash}`);

        const receipt = await tx.wait();

        if (receipt.status === 1) {
            return {
                success: true,
                method: 'aave_flash',
                hash: tx.hash,
                gasUsed: receipt.gasUsed.toString(),
                blockNumber: receipt.blockNumber,
                duration: Date.now() - startTime
            };
        } else {
            throw new Error('Transaction failed');
        }
    }

    /**
     * Execute direct swap (no flash loan, for testing)
     */
    async _executeDirectSwap(opp, gasConfig) {
        const params = {
            tokenIn: opp.flashToken.address,
            tokenOut: opp.targetToken.address,
            fee: opp.fee,
            recipient: this.wallet.address,
            deadline: Math.floor(Date.now() / 1000) + 300,
            amountIn: opp.flashAmount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        };

        const tx = await this.router.exactInputSingle(params, {
            gasLimit: 300000,
            maxFeePerGas: gasConfig.maxFeePerGas,
            maxPriorityFeePerGas: gasConfig.maxPriorityFeePerGas,
            nonce: this._getNonce()
        });

        const receipt = await tx.wait();

        return {
            success: receipt.status === 1,
            method: 'direct_swap',
            hash: tx.hash,
            gasUsed: receipt.gasUsed.toString(),
            blockNumber: receipt.blockNumber
        };
    }

    /**
     * Get next nonce with pending tracking
     */
    _getNonce() {
        const nonce = this.nonce;
        this.nonce++;
        return nonce;
    }

    /**
     * Sync nonce with chain
     */
    async syncNonce() {
        this.nonce = await this.wallet.getTransactionCount('pending');
        console.log(`  🔄 Nonce synced: ${this.nonce}`);
    }

    /**
     * Execute gold arbitrage with special handling
     */
    async executeGoldArbitrage(opportunity, gasConfig) {
        const startTime = Date.now();
        
        console.log(`🥇 Executing GOLD arbitrage: ${opportunity.poolName}`);
        console.log(`   Gold Price: $${opportunity.goldPrice || 'fetching...'}`);
        console.log(`   Volatility: ${opportunity.goldVolatility}`);
        console.log(`   Near London Fix: ${opportunity.nearLondonFix ? 'YES ⚠️' : 'No'}`);
        
        // Use higher gas for gold (priority execution)
        const priorityGas = {
            ...gasConfig,
            maxFeePerGas: gasConfig.maxFeePerGas.mul(120).div(100), // 20% higher
            maxPriorityFeePerGas: gasConfig.maxPriorityFeePerGas.mul(150).div(100) // 50% higher priority
        };
        
        // Add extra confirmation for gold during volatile periods
        if (opportunity.nearLondonFix || opportunity.goldVolatility === 'extreme') {
            console.log('   ⚠️  HIGH VOLATILITY PERIOD - Extra confirmation required');
            
            // Re-validate opportunity one more time
            const slot0 = await opportunity.poolContract.slot0().catch(() => null);
            if (slot0 && slot0.sqrtPriceX96.toString() !== opportunity.sqrtPriceX96) {
                console.log('   ❌ Price changed during validation - aborting');
                return { success: false, reason: 'price_changed' };
            }
        }
        
        // Build and send transaction
        const tx = await this._buildGoldTransaction(opportunity, priorityGas);
        
        console.log(`   📤 Gold arbitrage tx sent: ${tx.hash}`);
        
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
            return {
                success: true,
                method: 'gold_arbitrage',
                hash: tx.hash,
                gasUsed: receipt.gasUsed.toString(),
                blockNumber: receipt.blockNumber,
                duration: Date.now() - startTime,
                goldVolatility: opportunity.goldVolatility,
                nearLondonFix: opportunity.nearLondonFix
            };
        } else {
            throw new Error('Gold arbitrage transaction failed');
        }
    }

    /**
     * Build gold arbitrage transaction
     */
    async _buildGoldTransaction(opportunity, gasConfig) {
        const contract = new ethers.Contract(
            this.config.executorAddress,
            [
                'function executeGoldArbitrage(tuple(address,address,uint256,uint256,uint256),uint256) external',
                'function getGoldPrice() view returns (uint256)',
                'function isNearLondonFix() view returns (bool)'
            ],
            this.wallet
        );

        const params = {
            skewedPool: opportunity.poolAddress,
            exitPool: opportunity.exitPool || opportunity.poolAddress,
            flashAmount: opportunity.flashAmount,
            minProfitBP: Math.floor((opportunity.minProfitRequired || this.config.goldMinProfitBP) * 100),
            deadline: Math.floor(Date.now() / 1000) + 60
        };

        // Higher slippage tolerance near London Fix
        const maxSlippage = opportunity.nearLondonFix ? 150 : 100; // 1.5% near fix, 1% normal

        const tx = await contract.executeGoldArbitrage(params, maxSlippage, {
            gasLimit: ethers.BigNumber.from(600000), // Higher gas limit for gold
            maxFeePerGas: gasConfig.maxFeePerGas,
            maxPriorityFeePerGas: gasConfig.maxPriorityFeePerGas,
            nonce: this._getNonce()
        });

        return tx;
    }

    /**
     * Cancel stuck transaction with higher gas
     */
    async cancelTransaction(nonce, gasPrice) {
        const tx = {
            to: this.wallet.address,
            value: 0,
            nonce: nonce,
            gasLimit: 21000,
            maxFeePerGas: gasPrice.mul(150).div(100), // 50% higher
            maxPriorityFeePerGas: gasPrice.mul(150).div(100)
        };

        const response = await this.wallet.sendTransaction(tx);
        console.log(`  🚫 Cancel tx sent: ${response.hash}`);
        return response;
    }

    /**
     * Get wallet balance
     */
    async getBalance() {
        const ethBalance = await this.provider.getBalance(this.wallet.address);
        return {
            eth: ethers.utils.formatEther(ethBalance),
            wei: ethBalance.toString()
        };
    }
}

module.exports = ExecutionEngine;
