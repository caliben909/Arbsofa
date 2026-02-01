// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";

/**
 * @title SkewArbitrageEngine
 * @notice Executes arbitrage on skewed (imbalanced) liquidity pools
 * @dev Designed for 49.5/50.5, 48/52, or any intentionally imbalanced ratios
 */
contract SkewArbitrageEngine is 
    ReentrancyGuard, 
    Ownable, 
    IUniswapV3FlashCallback 
{
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                               STRUCTS
    //////////////////////////////////////////////////////////////*/

    struct SkewPool {
        address pool;           // The skewed pool address
        address token0;         // Token 0 address
        address token1;         // Token 1 address
        uint24 fee;             // Pool fee tier
        uint256 targetRatio0;   // Target ratio for token0 (e.g., 4950 for 49.5%)
        uint256 targetRatio1;   // Target ratio for token1 (e.g., 5050 for 50.5%)
        uint256 minDeviation;   // Min deviation from target to trigger (basis points)
        uint256 maxFlashSize;   // Maximum flash loan size for this pool
        bool active;            // Whether this pool is active
    }

    struct FlashCallbackData {
        address skewedPool;     // Pool we flash loaned from
        address exitPool;       // Balanced pool/DEX for exit
        address flashToken;     // Token we flash loaned
        address targetToken;    // Token we swap into
        uint256 flashAmount;    // Amount flash loaned
        uint256 minProfit;      // Minimum profit required (basis points)
        bool useAave;           // Whether we used Aave for flash loan
    }

    struct ArbitrageParams {
        address skewedPool;     // Primary imbalanced pool
        address exitPool;       // Secondary balanced pool (can be same DEX different pool, or different DEX)
        uint256 flashAmount;    // Amount to flash loan
        uint256 minProfitBP;    // Minimum profit in basis points
        uint256 deadline;       // Transaction deadline
    }

    /*//////////////////////////////////////////////////////////////
                               STATE
    //////////////////////////////////////////////////////////////*/

    // Protocol addresses
    address public immutable uniswapV3Factory;
    address public immutable swapRouter;
    address public immutable quoter;
    address public immutable aavePool;
    address public treasury;
    
    // Pool registry
    mapping(address => SkewPool) public skewPools;
    address[] public poolList;
    
    // Authorized executors (bots)
    mapping(address => bool) public executors;
    
    // Emergency controls
    bool public paused;
    
    // Profit tracking
    uint256 public totalProfits;
    uint256 public totalVolume;
    uint256 public successfulArbs;
    uint256 public failedArbs;
    
    // Constants
    uint256 public constant MIN_PROFIT_BP = 15;      // 0.15% absolute minimum
    uint256 public constant MAX_SLIPPAGE_BP = 100;   // 1% max slippage
    uint256 public constant TREASURY_FEE_BP = 2000;  // 20% of profits to treasury
    uint256 public constant DEV_FEE_BP = 500;        // 5% of profits to dev

    /*//////////////////////////////////////////////////////////////
                               EVENTS
    //////////////////////////////////////////////////////////////*/

    event SkewPoolRegistered(
        address indexed pool,
        uint256 targetRatio0,
        uint256 targetRatio1,
        uint256 minDeviation
    );
    event SkewPoolUpdated(address indexed pool, bool active);
    event ArbitrageExecuted(
        address indexed skewedPool,
        address indexed exitPool,
        address indexed flashToken,
        uint256 flashAmount,
        uint256 grossProfit,
        uint256 netProfit,
        uint256 treasuryFee,
        uint256 timestamp
    );
    event ArbitrageFailed(
        address indexed skewedPool,
        string reason,
        uint256 timestamp
    );
    event ExecutorAuthorized(address indexed executor, bool authorized);
    event ProfitsDistributed(address indexed token, uint256 treasuryAmount, uint256 devAmount, uint256 ownerAmount);

    /*//////////////////////////////////////////////////////////////
                             MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier whenNotPaused() {
        require(!paused, "Contract paused");
        _;
    }

    modifier onlyExecutor() {
        require(executors[msg.sender] || msg.sender == owner(), "Not authorized");
        _;
    }

    /*//////////////////////////////////////////////////////////////
                            CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    constructor(
        address _uniswapV3Factory,
        address _swapRouter,
        address _quoter,
        address _aavePool,
        address _treasury
    ) {
        uniswapV3Factory = _uniswapV3Factory;
        swapRouter = _swapRouter;
        quoter = _quoter;
        aavePool = _aavePool;
        treasury = _treasury;
        
        // Authorize deployer
        executors[msg.sender] = true;
    }

    /*//////////////////////////////////////////////////////////////
                         ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    function registerSkewPool(
        address pool,
        address token0,
        address token1,
        uint24 fee,
        uint256 targetRatio0,
        uint256 targetRatio1,
        uint256 minDeviation,
        uint256 maxFlashSize
    ) external onlyOwner {
        require(targetRatio0 + targetRatio1 == 10000, "Ratios must sum to 100%");
        require(minDeviation >= 10, "Min deviation too low"); // At least 0.1%
        require(maxFlashSize > 0, "Max flash must be > 0");
        
        // Verify it's a valid Uniswap V3 pool
        require(
            IUniswapV3Pool(pool).factory() == uniswapV3Factory,
            "Invalid Uniswap V3 pool"
        );
        
        skewPools[pool] = SkewPool({
            pool: pool,
            token0: token0,
            token1: token1,
            fee: fee,
            targetRatio0: targetRatio0,
            targetRatio1: targetRatio1,
            minDeviation: minDeviation,
            maxFlashSize: maxFlashSize,
            active: true
        });
        
        poolList.push(pool);
        
        emit SkewPoolRegistered(pool, targetRatio0, targetRatio1, minDeviation);
    }

    function updateSkewPool(
        address pool,
        bool active,
        uint256 newMinDeviation,
        uint256 newMaxFlashSize
    ) external onlyOwner {
        SkewPool storage sp = skewPools[pool];
        require(sp.pool != address(0), "Pool not registered");
        
        sp.active = active;
        sp.minDeviation = newMinDeviation;
        sp.maxFlashSize = newMaxFlashSize;
        
        emit SkewPoolUpdated(pool, active);
    }

    function setExecutor(address executor, bool authorized) external onlyOwner {
        executors[executor] = authorized;
        emit ExecutorAuthorized(executor, authorized);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        treasury = newTreasury;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    function emergencyWithdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(owner(), balance);
    }

    /*//////////////////////////////////////////////////////////////
                    CORE ARBITRAGE FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Execute skew arbitrage using Uniswap V3 flash loan
     * @param params Arbitrage parameters
     */
    function executeSkewArbitrage(ArbitrageParams calldata params) 
        external 
        onlyExecutor 
        whenNotPaused 
        nonReentrant 
    {
        require(block.timestamp <= params.deadline, "Deadline expired");
        
        SkewPool memory skewPool = skewPools[params.skewedPool];
        require(skewPool.active, "Pool not active");
        
        // Determine which token to flash loan (the overweighted one)
        (address flashToken, address targetToken, bool isToken0Overweight) = 
            _determineFlashToken(params.skewedPool, skewPool);
        
        // Verify flash amount is within limits
        require(params.flashAmount <= skewPool.maxFlashSize, "Flash amount too large");
        require(params.flashAmount > 0, "Flash amount must be > 0");
        
        // Encode callback data
        FlashCallbackData memory callbackData = FlashCallbackData({
            skewedPool: params.skewedPool,
            exitPool: params.exitPool,
            flashToken: flashToken,
            targetToken: targetToken,
            flashAmount: params.flashAmount,
            minProfit: params.minProfitBP,
            useAave: false
        });
        
        // Initiate flash loan from skewed pool
        if (isToken0Overweight) {
            IUniswapV3Pool(params.skewedPool).flash(
                address(this),
                params.flashAmount, // flash token0
                0,
                abi.encode(callbackData)
            );
        } else {
            IUniswapV3Pool(params.skewedPool).flash(
                address(this),
                0,
                params.flashAmount, // flash token1
                abi.encode(callbackData)
            );
        }
    }

    /**
     * @notice Execute skew arbitrage using Aave flash loan (for larger sizes)
     */
    function executeSkewArbitrageAave(
        ArbitrageParams calldata params,
        address flashAsset
    ) external onlyExecutor whenNotPaused nonReentrant {
        require(block.timestamp <= params.deadline, "Deadline expired");
        
        SkewPool memory skewPool = skewPools[params.skewedPool];
        require(skewPool.active, "Pool not active");
        
        // Encode params for Aave callback
        FlashCallbackData memory callbackData = FlashCallbackData({
            skewedPool: params.skewedPool,
            exitPool: params.exitPool,
            flashToken: flashAsset,
            targetToken: flashAsset == skewPool.token0 ? skewPool.token1 : skewPool.token0,
            flashAmount: params.flashAmount,
            minProfit: params.minProfitBP,
            useAave: true
        });
        
        // Execute Aave flash loan
        address[] memory assets = new address[](1);
        assets[0] = flashAsset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.flashAmount;
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0; // No debt
        
        IPool(aavePool).flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            abi.encode(callbackData),
            0
        );
    }

    /**
     * @notice Batch execute multiple arbitrages (gas optimization)
     */
    function executeBatchSkewArbitrage(
        ArbitrageParams[] calldata paramsArray
    ) external onlyExecutor whenNotPaused nonReentrant {
        require(paramsArray.length <= 5, "Batch too large");
        
        for (uint i = 0; i < paramsArray.length; i++) {
            // Execute each arbitrage
            // Note: Each must be independent as flash loans can't be nested
            this.executeSkewArbitrage(paramsArray[i]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                     FLASH LOAN CALLBACKS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Uniswap V3 flash callback
     */
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override nonReentrant {
        FlashCallbackData memory params = abi.decode(data, (FlashCallbackData));
        
        // Verify caller is the skewed pool
        require(msg.sender == params.skewedPool, "Invalid callback sender");
        
        // Calculate flash fee
        uint256 flashFee = (msg.sender == params.skewedPool && fee0 > 0) ? fee0 : fee1;
        
        // Execute the arbitrage logic
        _executeArbitrageLogic(params, flashFee);
    }

    /**
     * @notice Aave flash loan callback
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == aavePool, "Invalid sender");
        require(initiator == address(this), "Invalid initiator");
        
        FlashCallbackData memory callbackData = abi.decode(params, (FlashCallbackData));
        
        uint256 flashFee = premiums[0];
        
        _executeArbitrageLogic(callbackData, flashFee);
        
        // Repay Aave
        uint256 repayAmount = amounts[0] + premiums[0];
        IERC20(assets[0]).safeApprove(aavePool, repayAmount);
        
        return true;
    }

    /*//////////////////////////////////////////////////////////////
                     INTERNAL EXECUTION LOGIC
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Core arbitrage execution logic
     */
    function _executeArbitrageLogic(
        FlashCallbackData memory params,
        uint256 flashFee
    ) internal {
        // Step 1: Approve router to spend flash token
        IERC20(params.flashToken).safeApprove(swapRouter, params.flashAmount);
        
        // Step 2: Calculate expected output through skew
        uint256 expectedOutput = _quoteSwap(
            params.flashToken,
            params.targetToken,
            params.flashAmount,
            params.skewedPool
        );
        
        // Step 3: Execute swap through skewed pool (capture the imbalance)
        uint256 receivedFromSkew = _executeSwap(
            params.flashToken,
            params.targetToken,
            params.flashAmount,
            expectedOutput * (10000 - MAX_SLIPPAGE_BP) / 10000, // Min out with slippage
            _getPoolFee(params.skewedPool)
        );
        
        // Step 4: Calculate how much we need to get back to repay flash
        uint256 requiredToRepay = params.flashAmount + flashFee;
        
        // Step 5: Swap back to flash token through exit pool (balanced)
        IERC20(params.targetToken).safeApprove(swapRouter, receivedFromSkew);
        
        uint256 receivedFromExit = _executeSwap(
            params.targetToken,
            params.flashToken,
            receivedFromSkew,
            0, // We'll check profit after
            _getPoolFee(params.exitPool)
        );
        
        // Step 6: Verify profitability
        require(receivedFromExit > requiredToRepay, "Unprofitable: insufficient to repay");
        
        uint256 grossProfit = receivedFromExit - requiredToRepay;
        uint256 profitBP = (grossProfit * 10000) / params.flashAmount;
        
        require(profitBP >= params.minProfit, "Profit below minimum");
        require(profitBP >= MIN_PROFIT_BP, "Profit below absolute minimum");
        
        // Step 7: Repay flash loan
        IERC20(params.flashToken).safeTransfer(
            params.useAave ? aavePool : msg.sender,
            requiredToRepay
        );
        
        // Step 8: Distribute profit
        _distributeProfit(params.flashToken, grossProfit);
        
        // Step 9: Update stats
        totalProfits += grossProfit;
        totalVolume += params.flashAmount;
        successfulArbs++;
        
        emit ArbitrageExecuted(
            params.skewedPool,
            params.exitPool,
            params.flashToken,
            params.flashAmount,
            grossProfit,
            grossProfit, // Net is same for now (fees taken from profit)
            (grossProfit * TREASURY_FEE_BP) / 10000,
            block.timestamp
        );
    }

    /**
     * @notice Determine which token is overweighted in the pool
     */
    function _determineFlashToken(
        address pool,
        SkewPool memory skewPool
    ) internal view returns (
        address flashToken,
        address targetToken,
        bool isToken0Overweight
    ) {
        // Get actual balances
        uint256 balance0 = IERC20(skewPool.token0).balanceOf(pool);
        uint256 balance1 = IERC20(skewPool.token1).balanceOf(pool);
        
        // Normalize for decimals
        uint8 decimals0 = IERC20Metadata(skewPool.token0).decimals();
        uint8 decimals1 = IERC20Metadata(skewPool.token1).decimals();
        
        // Convert to comparable units (18 decimals)
        uint256 normalized0 = balance0 * (10 ** (18 - decimals0));
        uint256 normalized1 = balance1 * (10 ** (18 - decimals1));
        
        uint256 total = normalized0 + normalized1;
        uint256 currentRatio0 = (normalized0 * 10000) / total;
        
        // Determine which is overweighted
        if (currentRatio0 > skewPool.targetRatio0) {
            // Token0 is overweighted - flash it
            return (skewPool.token0, skewPool.token1, true);
        } else {
            // Token1 is overweighted - flash it
            return (skewPool.token1, skewPool.token0, false);
        }
    }

    /**
     * @notice Quote swap output using Quoter
     */
    function _quoteSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address pool
    ) internal view returns (uint256) {
        // Use Quoter for accurate estimation
        try IQuoter(quoter).quoteExactInputSingle(
            tokenIn,
            tokenOut,
            _getPoolFee(pool),
            amountIn,
            0
        ) returns (uint256 amountOut) {
            return amountOut;
        } catch {
            // Fallback: calculate from pool price
            (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
            uint256 price = uint256(sqrtPriceX96) ** 2 >> 192;
            return (amountIn * price) / 1e18;
        }
    }

    /**
     * @notice Execute swap through Uniswap V3
     */
    function _executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint24 fee
    ) internal returns (uint256 amountOut) {
        ISwapRouter.ExactInputSingleParams memory params = 
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            });
        
        amountOut = ISwapRouter(swapRouter).exactInputSingle(params);
        return amountOut;
    }

    /**
     * @notice Get fee tier for a pool
     */
    function _getPoolFee(address pool) internal view returns (uint24) {
        try IUniswapV3Pool(pool).fee() returns (uint24 fee) {
            return fee;
        } catch {
            return 500; // Default 0.05%
        }
    }

    /**
     * @notice Distribute profits between treasury, dev, and owner
     */
    function _distributeProfit(address token, uint256 profit) internal {
        uint256 treasuryFee = (profit * TREASURY_FEE_BP) / 10000;
        uint256 devFee = (profit * DEV_FEE_BP) / 10000;
        uint256 ownerShare = profit - treasuryFee - devFee;
        
        if (treasuryFee > 0) {
            IERC20(token).safeTransfer(treasury, treasuryFee);
        }
        if (devFee > 0) {
            // Send to dev wallet (can be same as owner or separate)
            IERC20(token).safeTransfer(owner(), devFee);
        }
        if (ownerShare > 0) {
            IERC20(token).safeTransfer(owner(), ownerShare);
        }
        
        emit ProfitsDistributed(token, treasuryFee, devFee, ownerShare);
    }

    /*//////////////////////////////////////////////////////////////
                         VIEW FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Get current pool skew data
     */
    function getPoolSkew(address pool) external view returns (
        uint256 balance0,
        uint256 balance1,
        uint256 currentRatio0,
        uint256 currentRatio1,
        uint256 deviation0,
        bool isActive
    ) {
        SkewPool memory sp = skewPools[pool];
        require(sp.pool != address(0), "Pool not registered");
        
        balance0 = IERC20(sp.token0).balanceOf(pool);
        balance1 = IERC20(sp.token1).balanceOf(pool);
        
        uint8 dec0 = IERC20Metadata(sp.token0).decimals();
        uint8 dec1 = IERC20Metadata(sp.token1).decimals();
        
        uint256 norm0 = balance0 * (10 ** (18 - dec0));
        uint256 norm1 = balance1 * (10 ** (18 - dec1));
        uint256 total = norm0 + norm1;
        
        currentRatio0 = (norm0 * 10000) / total;
        currentRatio1 = (norm1 * 10000) / total;
        
        deviation0 = currentRatio0 > sp.targetRatio0 ? 
            currentRatio0 - sp.targetRatio0 : 
            sp.targetRatio0 - currentRatio0;
            
        isActive = sp.active;
    }

    /**
     * @notice Estimate profit for a potential arbitrage
     */
    function estimateProfit(
        address skewedPool,
        address exitPool,
        uint256 flashAmount,
        bool flashToken0
    ) external view returns (
        uint256 estimatedProfit,
        uint256 profitBP,
        bool isProfitable
    ) {
        SkewPool memory sp = skewPools[skewedPool];
        
        // Get flash fee
        uint256 flashFee = (flashAmount * sp.fee) / 1e6;
        
        // Quote through skewed pool
        address flashToken = flashToken0 ? sp.token0 : sp.token1;
        address targetToken = flashToken0 ? sp.token1 : sp.token0;
        
        uint256 outFromSkew = _quoteSwap(flashToken, targetToken, flashAmount, skewedPool);
        
        // Quote through exit pool
        uint256 outFromExit = _quoteSwap(targetToken, flashToken, outFromSkew, exitPool);
        
        // Calculate profit
        uint256 required = flashAmount + flashFee;
        
        if (outFromExit > required) {
            estimatedProfit = outFromExit - required;
            profitBP = (estimatedProfit * 10000) / flashAmount;
            isProfitable = profitBP >= MIN_PROFIT_BP;
        } else {
            estimatedProfit = 0;
            profitBP = 0;
            isProfitable = false;
        }
    }

    /**
     * @notice Get all active pools
     */
    function getActivePools() external view returns (address[] memory) {
        uint256 count = 0;
        for (uint i = 0; i < poolList.length; i++) {
            if (skewPools[poolList[i]].active) count++;
        }
        
        address[] memory active = new address[](count);
        uint256 idx = 0;
        for (uint i = 0; i < poolList.length; i++) {
            if (skewPools[poolList[i]].active) {
                active[idx] = poolList[i];
                idx++;
            }
        }
        return active;
    }

    receive() external payable {}
}
