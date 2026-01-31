// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3FlashCallback.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-core/contracts/libraries/SqrtPriceMath.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./Interfaces.sol";
import "./Constants.sol";
import "./libraries/TransferHelper.sol";

abstract contract ArbBase is IUniswapV3FlashCallback {
    using SafeERC20 for IERC20;

    address public treasury;
    mapping(address => address) public oracleOf;
    mapping(bytes32 => address) public pairToPool;
    uint256 public minProfitBP;

    event Cycle(address indexed token, uint256 profit, uint256 fee, uint256 surplus);
    event OracleSet(address indexed t, address indexed f);

    function setOracle(address token, address feed) external virtual;

    function _arbCycle(address a, address b, uint256 amt) internal returns (uint256) {
        uint256 mid = _swap(a, b, amt);
        return _swap(b, a, mid);
    }

    function _triangularArb(address a, address b, address c, uint256 amt) internal returns (uint256) {
        uint256 amt1 = _swap(a, b, amt);
        uint256 amt2 = _swap(b, c, amt1);
        return _swap(c, a, amt2);
    }

    function _quadArb(address a, address b, address c, address d, uint256 amt) internal returns (uint256) {
        uint256 amt1 = _swap(a, b, amt);
        uint256 amt2 = _swap(b, c, amt1);
        uint256 amt3 = _swap(c, d, amt2);
        return _swap(d, a, amt3);
    }

    function _swap(address a, address b, uint256 amt) internal returns (uint256) {
        require(_checkLiquidity(a, b, amt), "Insufficient liquidity");
        TransferHelper.safeApprove(a, Constants.ROUTER, 0);
        TransferHelper.safeApprove(a, Constants.ROUTER, amt);
        uint256 minOut = _minOut(a, b, amt);
        return ISwapRouter(Constants.ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: a,
                tokenOut: b,
                fee: Constants.FEE_005,
                recipient: address(this),
                deadline: block.timestamp + 60,
                amountIn: amt,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    function _minOut(address a, address b, uint256 amt) internal view returns (uint256) {
        uint256 priceA = _price(a);
        uint256 priceB = _price(b);
        uint8 decA = IERC20Metadata(a).decimals();
        uint8 decB = IERC20Metadata(b).decimals();
        uint256 expected = (amt * priceA * (10 ** decB)) / (priceB * (10 ** decA));
        return (expected * (10_000 - Constants.SLIPPAGE_BP)) / 10_000;
    }

    function _price(address token) internal view returns (uint256) {
        address feed = oracleOf[token];
        if (feed != address(0)) {
            try AggregatorV3Interface(feed).latestRoundData() returns (uint80 roundId, int256 ans, uint256, uint256 updatedAt, uint80) {
                if (block.timestamp - updatedAt < Constants.STALE_SEC && roundId > 0 && ans > 0) {
                    return uint256(ans);
                }
            } catch {}
        }
        // Fallback to Uniswap TWAP
        return _getTWAPPrice(token);
    }

    function _getTWAPPrice(address token) internal view returns (uint256) {
        if (token == Constants.WETH) {
            address feed = oracleOf[Constants.WETH];
            if (feed != address(0)) {
                try AggregatorV3Interface(feed).latestRoundData() returns (uint80, int256 ans, uint256, uint256 updatedAt, uint80) {
                    if (updatedAt > block.timestamp - Constants.STALE_SEC && ans > 0) return uint256(ans);
                } catch {}
            }
            return 0;
        }
        address pool = pairToPool[_key(token, Constants.WETH)];
        if (pool == address(0)) return 0;
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        // Calculate price: token per WETH
        uint256 priceTokenPerWETH = (uint256(sqrtPriceX96) ** 2) >> 192;
        // Adjust for decimals: assume 18 decimals for both
        uint256 wethPriceUSD = _price(Constants.WETH);
        // priceTokenUSD = priceTokenPerWETH * wethPriceUSD / 1e18
        return (priceTokenPerWETH * wethPriceUSD) / 1e18;
    }

    function _key(address a, address b) internal pure returns (bytes32) {
        (a, b) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encodePacked(a, b));
    }

    function _checkLiquidity(address tokenA, address tokenB, uint256 /* amount */) internal view returns (bool) {
        address pool = pairToPool[_key(tokenA, tokenB)];
        if (pool == address(0)) return false;
        try IUniswapV3Pool(pool).slot0() returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
            // Pool exists
            return true;
        } catch {
            return false;
        }
    }

    function estimateGasCost(uint256 gasPrice, uint256 gasLimit) internal pure returns (uint256) {
        return gasPrice * gasLimit;
    }

    function computePoolAddress(address tokenA, address tokenB, uint24 fee) internal pure returns (address pool) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 salt = keccak256(abi.encode(token0, token1, fee));
        pool = address(uint160(uint(keccak256(abi.encodePacked(
            bytes1(0xff),
            Constants.UNI_V3_FACTORY,
            salt,
            Constants.POOL_INIT_CODE_HASH
        )))));
    }

    function getChainlinkPrice(address oracle) internal view returns (uint256) {
        if (oracle == address(0)) return 0;
        try AggregatorV3Interface(oracle).latestRoundData() returns (uint80 roundId, int256 ans, uint256, uint256 updatedAt, uint80) {
            if (block.timestamp - updatedAt < Constants.STALE_SEC && roundId > 0 && ans > 0) {
                return uint256(ans);
            }
        } catch {}
        return 0;
    }

    function calculateVolatility(address token, uint256 /* timeWindow */) internal view returns (uint256) {
        // Simplified volatility calculation using price changes over time
        // In production, use historical price data
        address feed = oracleOf[token];
        if (feed == address(0)) return 0;
        // Placeholder: return a volatility score (0-100)
        // Actual implementation would track price changes
        return 50; // Medium volatility
    }

    function _preloadOracles() internal {
        oracleOf[Constants.USDC] = Constants.getOracle(Constants.USDC);
        oracleOf[Constants.USDT] = Constants.getOracle(Constants.USDT);
        oracleOf[Constants.WBTC] = Constants.getOracle(Constants.WBTC);
        oracleOf[Constants.WETH] = Constants.getOracle(Constants.WETH);
        oracleOf[Constants.LINK] = Constants.getOracle(Constants.LINK);
        oracleOf[Constants.UNI]  = Constants.getOracle(Constants.UNI);
        oracleOf[Constants.AAVE] = Constants.getOracle(Constants.AAVE);
        oracleOf[Constants.ARB]  = Constants.getOracle(Constants.ARB);
        oracleOf[Constants.LDO]  = Constants.getOracle(Constants.LDO);
        oracleOf[Constants.CRV]  = Constants.getOracle(Constants.CRV);
        oracleOf[Constants.STETH]= Constants.getOracle(Constants.STETH);
        oracleOf[Constants.GMX]  = address(0);
        oracleOf[Constants.MAGIC]= address(0);
        oracleOf[Constants.GRAIL]= address(0);
        oracleOf[Constants.RDNT] = address(0);
        oracleOf[Constants.PENDLE]= address(0);
        oracleOf[Constants.PEPE] = address(0);
        oracleOf[Constants.BONK] = address(0);
        oracleOf[Constants.SXAU] = Constants.getOracle(Constants.SXAU);
        oracleOf[Constants.XAU_TOKEN] = Constants.getOracle(Constants.XAU_TOKEN);
    }

    function _preloadPools() internal {
        pairToPool[_key(Constants.USDC, Constants.USDT)] = Constants.getPool(Constants.USDC, Constants.USDT);
        pairToPool[_key(Constants.USDC, Constants.WETH)] = Constants.getPool(Constants.USDC, Constants.WETH);
        pairToPool[_key(Constants.WBTC, Constants.WETH)] = Constants.getPool(Constants.WBTC, Constants.WETH);
        pairToPool[_key(Constants.LINK, Constants.WETH)] = Constants.getPool(Constants.LINK, Constants.WETH);
        pairToPool[_key(Constants.ARB, Constants.WETH)]  = Constants.getPool(Constants.ARB, Constants.WETH);
        pairToPool[_key(Constants.DAI, Constants.USDC)]  = Constants.getPool(Constants.DAI, Constants.USDC);
    }
}