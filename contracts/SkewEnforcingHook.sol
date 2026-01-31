// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IHooks} from "../uniswap-v4/src/interfaces/IHooks.sol";
import {IPoolManager} from "../uniswap-v4/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams, SwapParams} from "../uniswap-v4/src/types/PoolOperation.sol";
import {PoolKey} from "../uniswap-v4/src/types/PoolKey.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../uniswap-v4/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "../uniswap-v4/src/types/BeforeSwapDelta.sol";
import {Currency} from "../uniswap-v4/src/types/Currency.sol";
import {IERC20} from "../uniswap-v4/src/interfaces/external/IERC20Minimal.sol";
import {Hooks} from "../uniswap-v4/src/libraries/Hooks.sol";
import {CurrencySettler} from "../uniswap-v4/src/test/utils/CurrencySettler.sol";

contract SkewEnforcingHook is IHooks {
    IPoolManager public immutable manager;

    uint256 public constant TARGET_RATIO_NUMERATOR_0 = 49;
    uint256 public constant TARGET_RATIO_NUMERATOR_1 = 51;
    uint256 public constant DENOMINATOR = 100;

    constructor(IPoolManager _manager) {
        manager = _manager;
        // Validate hook permissions
        Hooks.validateHookPermissions(
            this,
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: true,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: false,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: true,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert("Not implemented");
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert("Not implemented");
    }

    function beforeAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        BalanceDelta delta,
        BalanceDelta,
        bytes calldata
    ) external returns (bytes4, BalanceDelta) {
        // Get current reserves after the liquidity addition
        uint256 reserve0 = IERC20(Currency.unwrap(key.currency0)).balanceOf(address(manager));
        uint256 reserve1 = IERC20(Currency.unwrap(key.currency1)).balanceOf(address(manager));

        uint256 total = reserve0 + reserve1;
        uint256 target0 = total * TARGET_RATIO_NUMERATOR_0 / DENOMINATOR;
        uint256 target1 = total * TARGET_RATIO_NUMERATOR_1 / DENOMINATOR;

        // If reserves are already close to target, no adjustment needed
        if (reserve0 >= target0 - 1 && reserve0 <= target0 + 1 && reserve1 >= target1 - 1 && reserve1 <= target1 + 1) {
            return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
        }

        // Use flashloan and swap to adjust the ratio
        if (reserve0 > target0) {
            // Swap token0 for token1 to reduce reserve0, increase reserve1
            uint256 amountIn = (reserve0 - target0) / 2; // approximate amount to swap
            if (amountIn > 0) {
                // Take token0 as flashloan
                manager.take(key.currency0, address(this), amountIn);
                // Swap
                BalanceDelta swapDelta = manager.swap(
                    key,
                    SwapParams({zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: 0}),
                    ""
                );
                // Settle the input token0
                manager.settle(key.currency0, amountIn);
                // Take the output token1
                manager.take(key.currency1, address(this), uint256(-swapDelta.amount1()));
            }
        } else if (reserve1 > target1) {
            // Swap token1 for token0 to reduce reserve1, increase reserve0
            uint256 amountIn = (reserve1 - target1) / 2;
            if (amountIn > 0) {
                // Take token1 as flashloan
                manager.take(key.currency1, address(this), amountIn);
                // Swap
                BalanceDelta swapDelta = manager.swap(
                    key,
                    SwapParams({zeroForOne: false, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: type(uint160).max}),
                    ""
                );
                // Settle the input token1
                manager.settle(key.currency1, amountIn);
                // Take the output token0
                manager.take(key.currency0, address(this), uint256(-swapDelta.amount0()));
            }
        }

        return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert("Not implemented");
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert("Not implemented");
    }

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata) external pure returns (bytes4, BeforeSwapDelta, uint24) {
        revert("Not implemented");
    }

    function afterSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, int128) {
        revert("Not implemented");
    }

    function beforeDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        revert("Not implemented");
    }

    function afterDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        revert("Not implemented");
    }
}