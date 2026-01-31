# DeFi Empire Bot

This is an advanced DeFi arbitrage bot designed for the Arbitrum network. It performs various arbitrage strategies including triangular and quad arbitrages, flash loans, and more, utilizing multiple tokens and protocols.

## Features

- Flash loan arbitrage using Uniswap V3
- Triangular and quad arbitrage cycles
- Support for multiple tokens on Arbitrum
- Dynamic token fetching
- Pool checker for arbitrage opportunities
- Automated AI-driven trading

## Installation

1. **Clone the repository:**
   ```
   git clone https://github.com/caliben909/super-duper-lamp.git
   cd super-duper-lamp
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Set up environment variables:**
    - Copy `.env` and update it with your actual values:
      - `PRIVATE_KEY`: Your Ethereum private key (keep secure)
      - `INFURA_API_KEY`: Your Infura API key for RPC access
      - `GODMODE_EMPIRE_ADDRESS`: Address of the deployed GodModeEmpire contract (after deployment)

4. **Compile the contracts:**
   ```
   npx hardhat compile
   ```

5. **Run tests:**
   ```
   npx hardhat test
   ```

6. **Deploy contracts to Arbitrum:**
   - Ensure your .env has a valid PRIVATE_KEY
   - Run:
     ```
     npx hardhat run scripts/deploy-godmode-empire.js --network arbitrum
     ```
   - Note the deployed contract address and update .env if needed

7. **Run the AI bot:**
   ```
   node empire-ai.js
   ```

## Requirements

- Node.js >= 14.0.0
- npm
- An Ethereum wallet with ETH on Arbitrum for gas fees
- Access to Arbitrum network (via RPC or WebSocket)
- Moralis API key for price checking
- Nodereal API key for enhanced RPC access

## Contracts

- `GodModeEmpire.sol`: Main arbitrage contract with flash loan strategies
- `SkimRouter.sol`: Swap router with fee mechanism

## Scripts

- `empire-ai.js`: AI script that monitors and executes arbitrage opportunities
- `atomic-multicall.js`: Executes atomic batch transactions using Multicall3 for guaranteed all-or-nothing operations
- `fetchArbitrumTokens()`: Fetches token list from CoinGecko

## Testing

Run the test suite:
```
npx hardhat test
```

This will list all token addresses and verify contract functionality.

## Testing

Run the test suite:
```bash
npm test
```

The bot includes comprehensive startup tests to verify:
- Environment variables configuration
- RPC provider connections
- Wallet and contract deployments
- Price quoting functionality
- Flash loan provider initialization
- Cross-chain bridge setup
- MCP Distributor wallet configuration

For backtesting, set `DRY_RUN=true` in your `.env` file to simulate trades without execution.

## Security Notes

- Use hardware wallets or secure enclaves for private keys
- Never store private keys in `.env` files in production
- Monitor gas costs and slippage to avoid losses
- Test thoroughly on testnets before mainnet deployment

## Recent Changes and Audit Fixes

### Code Cleanup and Optimization
- Removed redundant old `GodModeEmpire` contract from `GodModeEmpireFinal.sol`
- Deleted build artifacts (`artifacts/` and `cache/`) to reduce repository size
- Cleaned up extraneous files and code segments

### Security and Bug Fixes
- Fixed incorrect deadline parameter in `ArbBase.sol` swap function (changed from `block.number + 1` to `block.timestamp + 60`)
- Improved token transfer safety in `MCPDistributor.sol` by using `SafeERC20.safeTransfer` for ERC20 rescues
- Added proper imports for `SafeERC20` in `MCPDistributor.sol`

### Risk Mitigation Enhancements
- **Volatility Management**: Added `calculateVolatility()` function in `ArbBase.sol` for real-time risk assessment
- **Liquidity Checks**: Implemented `_checkLiquidity()` in `ArbBase.sol` to verify sufficient pool depth before swaps
- **Quad Arbitrage Support**: Added `_quadArb()` function and `executeAaveQuadArb()` for four-token arbitrage cycles
- **Gas Optimization**: Added `estimateGasCost()` function for cost-benefit analysis
- **MEV Protection**: Enhanced commit-reveal mechanism and randomized execution timing
- **AI Enhancements**: Created `empire-ai-enhanced.js` with adaptive position sizing, multi-DEX routing, and predictive modeling
- **Pool Initialization Fix**: Modified `preloadAllArbitrumPairs()` to dynamically compute and set valid Uniswap V3 pool addresses instead of placeholders, ensuring operational readiness post-deployment
- **Fallback Oracles**: Implemented Chainlink oracle fallback to Uniswap TWAP for improved price reliability
- **Error Handling**: Added try-catch blocks in critical functions to prevent stuck funds and improve robustness

### Testing
- All unit and integration tests verified to pass after fixes
- Regression checks completed to ensure no new issues introduced
- Risk mitigation features tested for edge cases

### Configuration Updates
- No configuration changes required; all fixes are backward compatible

## Disclaimer

This software is provided as-is. DeFi trading involves significant risks including impermanent loss, smart contract vulnerabilities, and market volatility. Always conduct your own research and use at your own risk."# Arbsofa" 
