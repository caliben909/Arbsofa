// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./SkewArbitrageEngine.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/**
 * @title GoldSkewArbitrageEngine
 * @notice Specialized skew arbitrage for gold (PAXG) tokens
 * @dev Handles gold-specific volatility and London Fix timing
 */
contract GoldSkewArbitrageEngine is SkewArbitrageEngine {
    
    // Gold-specific constants
    address public constant PAXG = 0x2BA8349123de45E941a136e6D766c90b288B3D09;
    address public constant XAU_ORACLE = 0x8F383361A85268365259F3a8824c3f1d9BC4f9A0;
    
    // London Fix times (GMT)
    uint256 public constant LONDON_FIX_AM = 10 hours + 30 minutes;
    uint256 public constant LONDON_FIX_PM = 15 hours;
    
    // Volatility windows
    mapping(string => uint256) public volatilityThresholds;
    
    // Gold pool registry
    mapping(address => bool) public isGoldPool;
    mapping(address => uint256) public goldPoolMaxFlash;
    
    // Gold configuration
    struct GoldPoolConfig {
        uint256 targetRatio0;
        uint256 targetRatio1;
        uint256 minDeviation;
        uint256 maxFlashSize;
        uint24 fee;
        bool isGold;
        string goldType;
    }
    
    mapping(address => GoldPoolConfig) public goldPoolConfigs;
    
    event GoldArbitrageExecuted(
        address indexed pool,
        uint256 goldPrice,
        string volatilityRegime,
        uint256 profit
    );
    
    event GoldPoolRegistered(
        address indexed pool,
        string goldType,
        uint256 targetRatio0,
        uint256 targetRatio1
    );
    
    constructor(
        address _uniswapV3Factory,
        address _swapRouter,
        address _quoter,
        address _aavePool,
        address _treasury
    ) SkewArbitrageEngine(
        _uniswapV3Factory,
        _swapRouter,
        _quoter,
        _aavePool,
        _treasury
    ) {
        // Set volatility thresholds (basis points)
        volatilityThresholds["low"] = 20;
        volatilityThresholds["medium"] = 50;
        volatilityThresholds["high"] = 100;
        volatilityThresholds["extreme"] = 200;
    }
    
    /**
     * @notice Register a gold pool with special parameters
     */
    function registerGoldPool(
        address pool,
        address token0,
        address token1,
        uint24 fee,
        uint256 targetRatio0,
        uint256 targetRatio1,
        uint256 minDeviation,
        uint256 maxFlashSize,
        string calldata goldType
    ) external onlyOwner {
        require(
            token0 == PAXG || token1 == PAXG,
            "Must include PAXG"
        );
        require(targetRatio0 + targetRatio1 == 10000, "Ratios must sum to 100%");
        require(minDeviation >= 50, "Min deviation too low for gold");
        
        // Verify it's a valid Uniswap V3 pool
        require(
            IUniswapV3Pool(pool).factory() == uniswapV3Factory,
            "Invalid Uniswap V3 pool"
        );
        
        isGoldPool[pool] = true;
        goldPoolMaxFlash[pool] = maxFlashSize;
        
        goldPoolConfigs[pool] = GoldPoolConfig({
            targetRatio0: targetRatio0,
            targetRatio1: targetRatio1,
            minDeviation: minDeviation,
            maxFlashSize: maxFlashSize,
            fee: fee,
            isGold: true,
            goldType: goldType
        });
        
        // Also register in parent contract
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
        
        emit GoldPoolRegistered(pool, goldType, targetRatio0, targetRatio1);
    }
    
    /**
     * @notice Check if currently near London Fix (high volatility)
     */
    function isNearLondonFix() public view returns (bool) {
        // Get current GMT time
        uint256 gmtTimestamp = block.timestamp;
        uint256 gmtHour = (gmtTimestamp % 1 days) / 1 hours;
        uint256 gmtMinute = (gmtTimestamp % 1 hours) / 1 minutes;
        uint256 gmtTime = gmtHour * 60 + gmtMinute;
        
        // Within 15 minutes of either fix
        uint256 amFix = 10 * 60 + 30;
        uint256 pmFix = 15 * 60;
        
        return (
            (gmtTime > amFix - 15 && gmtTime < amFix + 15) ||
            (gmtTime > pmFix - 15 && gmtTime < pmFix + 15)
        );
    }
    
    /**
     * @notice Get current gold price from Chainlink
     */
    function getGoldPrice() public view returns (uint256) {
        (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = AggregatorV3Interface(XAU_ORACLE).latestRoundData();
        
        require(answer > 0, "Invalid gold price");
        require(block.timestamp - updatedAt < 1 hours, "Stale gold price");
        
        return uint256(answer); // 8 decimals
    }
    
    /**
     * @notice Execute gold-specific arbitrage with volatility checks
     */
    function executeGoldArbitrage(
        ArbitrageParams calldata params,
        uint256 maxSlippageBP
    ) external onlyExecutor whenNotPaused nonReentrant {
        require(isGoldPool[params.skewedPool], "Not a gold pool");
        
        // Get current gold price
        uint256 goldPrice = getGoldPrice();
        
        // Adjust parameters based on volatility
        bool nearFix = isNearLondonFix();
        uint256 adjustedMinProfit = nearFix ? 
            params.minProfitBP * 2 : // Double profit requirement near fix
            params.minProfitBP;
        
        // Create adjusted params
        ArbitrageParams memory adjustedParams = params;
        adjustedParams.minProfitBP = adjustedMinProfit;
        
        // Execute the arbitrage
        // Note: This would call the internal logic from parent contract
        // For now, emit event to track
        
        emit GoldArbitrageExecuted(
            params.skewedPool,
            goldPrice,
            nearFix ? "high" : "normal",
            0 // Actual profit calculated in execution
        );
    }
    
    /**
     * @notice Get gold pool configuration
     */
    function getGoldPoolConfig(address pool) external view returns (GoldPoolConfig memory) {
        return goldPoolConfigs[pool];
    }
    
    /**
     * @notice Override profit distribution for gold (higher treasury share)
     */
    function _distributeProfit(address token, uint256 profit) internal override {
        if (token == PAXG) {
            // Higher fees for gold (more valuable, harder to arbitrage)
            uint256 treasuryFee = (profit * 2500) / 10000; // 25%
            uint256 devFee = (profit * 500) / 10000;       // 5%
            uint256 ownerShare = profit - treasuryFee - devFee;
            
            if (treasuryFee > 0) {
                IERC20(token).safeTransfer(treasury, treasuryFee);
            }
            if (devFee > 0) {
                IERC20(token).safeTransfer(owner(), devFee);
            }
            if (ownerShare > 0) {
                IERC20(token).safeTransfer(owner(), ownerShare);
            }
            
            emit ProfitsDistributed(token, treasuryFee, devFee, ownerShare);
        } else {
            super._distributeProfit(token, profit);
        }
    }
    
    /**
     * @notice Get current GMT time for debugging
     */
    function getCurrentGMTTime() external view returns (uint256 hour, uint256 minute) {
        uint256 gmtTimestamp = block.timestamp;
        hour = (gmtTimestamp % 1 days) / 1 hours;
        minute = (gmtTimestamp % 1 hours) / 1 minutes;
    }
}
