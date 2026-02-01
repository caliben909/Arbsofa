# SkewArbitrageEngine

A production-ready smart contract system for executing arbitrage on intentionally imbalanced (skewed) DEX liquidity pools.

## Overview

The SkewArbitrageEngine exploits price discrepancies between:
- **Skewed Pools**: Intentionally imbalanced pools (e.g., 49.5/50.5, 48/52 splits)
- **Balanced Pools**: Standard 50/50 reference pools

### How It Works

1. **Flash Loan**: Borrow the overweighted asset from a skewed pool
2. **Swap Through Skew**: Execute swap capturing the imbalance premium
3. **Exit via Balanced Pool**: Swap back through a balanced pool
4. **Repay Flash Loan**: Return borrowed amount + fee
5. **Keep Spread**: Profit from the price difference

## Architecture

### Smart Contract

[`SkewArbitrageEngine.sol`](contracts/SkewArbitrageEngine.sol) - Core arbitrage engine with:

- **Flash Loan Support**: Uniswap V3 and Aave V3
- **Skew Detection**: Automatic overweighted token identification
- **Profit Protection**: Minimum profit thresholds and slippage controls
- **Fee Distribution**: Automated treasury/dev/owner profit splitting
- **Emergency Controls**: Pause functionality and emergency withdrawal

### Key Features

| Feature | Description |
|---------|-------------|
| Multi-DEX Support | Uniswap V3, Aave flash loans |
| Skew Detection | Automatic ratio calculation |
| Profit Estimation | Pre-execution profit calculation |
| Batch Execution | Gas-optimized batch arbitrage |
| Role-Based Access | Owner + Executor permissions |

## Deployment

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Deploy Contract

```bash
# Mainnet
npx hardhat run scripts/deploy-skew-arbitrage.js --network mainnet

# Arbitrum
npx hardhat run scripts/deploy-skew-arbitrage.js --network arbitrum

# Base
npx hardhat run scripts/deploy-skew-arbitrage.js --network base
```

### 4. Register Pools

Edit [`scripts/register-skew-pools.js`](scripts/register-skew-pools.js) with your pool configurations:

```javascript
const POOLS_TO_REGISTER = [
  {
    name: "WETH/USDC 49.5/50.5 Skew",
    address: "0x...", // Pool address
    token0: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    token1: "0xA0b86a33E6441E6C7D3D4B4f6c7e8f9a0b1c2d3e", // USDC
    fee: 500,
    targetRatio0: 4950, // 49.5%
    targetRatio1: 5050, // 50.5%
    minDeviation: 50,   // 0.5%
    maxFlashSize: ethers.parseEther("50"),
  },
];
```

Then run:

```bash
npx hardhat run scripts/register-skew-pools.js --network <network>
```

## Usage

### Start the Monitor

```bash
export ENGINE_ADDRESS=0x...
npx hardhat run scripts/keeper/skew-monitor.js --network <network>
```

The monitor will:
- Check registered pools every 5 seconds
- Detect skew deviations
- Estimate arbitrage profits
- Execute profitable trades automatically

### Manual Execution

```javascript
const params = {
  skewedPool: "0x...",
  exitPool: "0x...",
  flashAmount: ethers.parseEther("10"),
  minProfitBP: 20, // 0.2%
  deadline: Math.floor(Date.now() / 1000) + 300,
};

await engine.executeSkewArbitrage(params);
```

## Configuration

### Pool Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `targetRatio0` | Target % for token0 (basis points) | 4950 = 49.5% |
| `targetRatio1` | Target % for token1 (basis points) | 5050 = 50.5% |
| `minDeviation` | Min deviation to trigger (BP) | 50 = 0.5% |
| `maxFlashSize` | Maximum flash loan amount | 50 ETH |

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MIN_PROFIT_BP` | 15 | 0.15% minimum profit |
| `MAX_SLIPPAGE_BP` | 100 | 1% max slippage |
| `TREASURY_FEE_BP` | 2000 | 20% treasury fee |
| `DEV_FEE_BP` | 500 | 5% dev fee |

## Testing

```bash
# Run all tests
npx hardhat test test/SkewArbitrageEngine.test.js

# Run with coverage
npx hardhat coverage
```

## Security

### Access Control
- `onlyOwner`: Admin functions (register pools, set treasury)
- `onlyExecutor`: Arbitrage execution
- `whenNotPaused`: Emergency stop

### Safety Mechanisms
- Minimum profit thresholds
- Slippage protection
- Deadline enforcement
- Reentrancy guards

### Emergency Functions
- `setPaused()`: Pause all operations
- `emergencyWithdraw()`: Recover stuck tokens

## Profit Distribution

Profits are automatically distributed:
- **20%** → Treasury
- **5%** → Dev/Owner
- **75%** → Owner

## Monitoring

Track performance via events:

```javascript
// Arbitrage executed
ArbitrageExecuted(
  skewedPool,
  exitPool,
  flashToken,
  flashAmount,
  grossProfit,
  netProfit,
  treasuryFee,
  timestamp
);

// Pool registered
SkewPoolRegistered(pool, targetRatio0, targetRatio1, minDeviation);
```

## Networks

Supported networks with pre-configured addresses:

| Network | Factory | Router | Aave Pool |
|---------|---------|--------|-----------|
| Mainnet | ✅ | ✅ | ✅ |
| Arbitrum | ✅ | ✅ | ✅ |
| Base | ✅ | ✅ | ✅ |

## License

MIT

## Disclaimer

This software is provided as-is. Use at your own risk. Always test thoroughly on testnets before mainnet deployment.
