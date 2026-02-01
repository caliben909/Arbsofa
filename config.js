module.exports = {
  chainId: 42161,
  rpc: {
    primary: process.env.ARB_RPC || "https://arb-mainnet.g.alchemy.com/v2/demo",
    fallback: "https://rpc.ankr.com/arbitrum",
    backup: "https://arbitrum.blockpi.network/v1/rpc/public"
  },
  flashbots: true,
  bundleSize: 3,          // Increased for gold opportunities
  
  // Your executor contract address
  executorAddress: process.env.EXECUTOR_ADDRESS,
  
  // Minimum profit thresholds (gold has higher volatility = higher thresholds)
  minProfitBP: 15,        // 0.15% for standard pairs
  goldMinProfitBP: 25,    // 0.25% for gold (higher volatility buffer)
  
  tokens: {
    USDT:  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    USDC:  "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    DAI:   "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    WBTC:  "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
    WETH:  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    stETH: "0x5979D7b546E38E414F7E9822514be443A4800529",
    GMX:   "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
    MAGIC: "0x539bdE0d7Dbd336b79148AA742883198BBF60342",
    GRAIL: "0x3d9907F9a368ad0a51Be60f7Da3b97cf940982D8",
    RDNT:  "0x3082CC23568eA640225c2467653dB90e9250AaA0",
    PENDLE:"0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8",
    LINK:  "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
    UNI:   "0x6FD9D7AD17242C41F7131d257212c54a11213923",
    AAVE:  "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196",
    ARB:   "0x912CE59144191C1204E64559FE8253a0e49E6548",
    LDO:   "0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60",
    CRV:   "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978",
    PEPE:  "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00",
    BONK:  "0x09199D9A5F4448d0848e4395D065e1A1C5A5263f",
    
    // GOLD TOKENS - VERIFIED ON ARBITRUM
    PAXG:  "0x2BA8349123de45E941a136e6D766c90b288B3D09", // PAX Gold ✅
    XAUT:  "0x0C5566c8BA86d03A5cE419132D8BD4b35E8381A2", // Tether Gold ✅
    // PMGT: Not available on Arbitrum (Ethereum only)
  },
  pools: { // 0.05 % unless noted
    "USDC/USDT" : "0x6c60E6Ab82D73491e345FC3333D3C875211e5f3F", // 0.01 %
    "USDC/WETH" : "0x03f73225F2a68e94F23752F8384D9e5A1E5A1A98",
    "WBTC/WETH" : "0x2f5e87C9312fa29aed5c179E456625D79015299c", // 0.3 %
    "LINK/WETH" : "0x4A5A2a152E985078e1a4Aa9C3362c7B8ae3D1a5f",
    "ARB/WETH"  : "0x0d4D12115904c50e02333028B4D8d75A76247315",
    "DAI/USDC"  : "0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6", // 0.01 %
    "GMX/WETH"  : "0xC31dCc36A855F3bAa037a3aC014A92A45A94F093",
    "MAGIC/WETH":"0xBc9d99DC8372F3E0115fD089560854B9C3e39F9C",
    "GRAIL/WETH":"0x9eEfE24a4e2BA5aB5Bc366575Ba73887AFD9E514",
    "RDNT/WETH" : "0x9063e77E5bA9bBfA7F4Ec8C5c6a3a67e5B01D86E",
    "PENDLE/WETH":"0x827C6CEFa3E93B7d70A297d4c920C174c6B6B1E6",
    "UNI/WETH"  : "0x6D7b4217F2a52369Ef7E8D6b4C1F0C7F0F0cF4A8",
    "AAVE/WETH" : "0x2516c2B438b7a0BD5dF1FB6F8B4eD4cDf0b54a84",
    "LDO/WETH"  : "0xA66571Ba8fC9cF195Cc5aA2839D4DcD4e4A5cC1F",
    "CRV/WETH"  : "0x3eE5Be63a2A40D7fD846Bb96a7B8b7273351A193",
    "PEPE/WETH" : "0x1190a41c1B9c8Ae95bf53D3C62bF6c0B951a8E91",
    "BONK/WETH" : "0xC108E5A90E8C9aB8cC4c15e54b1E14b9Cd6c93b2",
  },
  
  // GOLD POOLS - Specialized skewed pools for gold arbitrage
  // ⚠️  THESE POOLS MAY NOT EXIST YET - Run scripts/discover-gold-pools.js to check
  // If they don't exist, use scripts/create-gold-pool.js to create them
  goldPools: {
    // PAXG/USDC - Primary gold trading pair
    "PAXG/USDC": {
      address: null, // Will be populated by discovery script
      targetRatio0: 4850,  // 48.5% PAXG / 51.5% USDC (gold tends to be overweighted)
      targetRatio1: 5150,
      minDeviation: 50,    // 0.5% minimum (gold is less volatile than crypto)
      maxFlashSize: ethers.utils.parseUnits('50', 18), // 50 PAXG max (high value)
      fee: 3000,           // 0.3% fee for gold pairs
      isGold: true,
      goldType: 'PAXG'
    },
    
    // PAXG/WETH - Gold/Ethereum pair
    "PAXG/WETH": {
      address: null,
      targetRatio0: 4750,  // 47.5% PAXG / 52.5% WETH
      targetRatio1: 5250,
      minDeviation: 75,    // 0.75% (higher volatility vs ETH)
      maxFlashSize: ethers.utils.parseUnits('30', 18),
      fee: 3000,
      isGold: true,
      goldType: 'PAXG'
    },
    
    // PAXG/USDT - Alternative stable pair
    "PAXG/USDT": {
      address: null,
      targetRatio0: 4925,  // 49.25% / 50.75%
      targetRatio1: 5075,
      minDeviation: 50,
      maxFlashSize: ethers.utils.parseUnits('50', 18),
      fee: 3000,
      isGold: true,
      goldType: 'PAXG'
    }
  },
  oracles: { // chainlink Arbitrum
    USDC:  "0x50834F3163758FCC1Df9973B6e91f0F0F0434AD6",
    USDT:  "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7",
    WBTC:  "0x6ce185860a4963106506C203335A2910413708e9",
    WETH:  "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
    LINK:  "0x86E53cF1B870786351165d955b07ed0F7f4c3d2b",
    UNI:   "0x9C917083fDb403ab5ADbEC26Ee294f6EcAda2720",
    AAVE:  "0xaD1d5344AaDE45F43E596773Bcc4c423EAbdD034",
    ARB:   "0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6",
    LDO:   "0xa43A34030088e6510EeCf95376B516FcE9b74B57",
    CRV:   "0xaebDA2c976cfd1eE1977Eac079B4382acb849325",
    
    // GOLD ORACLES
    PAXG:  "0x8F383361A85268365259F3a8824c3f1d9BC4f9A0", // XAU/USD Chainlink on Arbitrum
    XAU:   "0x8F383361A85268365259F3a8824c3f1d9BC4f9A0", // Same as PAXG
  },
  // Gold-specific configuration
  goldConfig: {
    // London Fix times (major volatility events)
    londonFixAM: { hour: 10, minute: 30 },  // 10:30 AM GMT
    londonFixPM: { hour: 15, minute: 0 },   // 3:00 PM GMT
    
    // Fed meeting impact (gold volatility)
    fedMeetingTimes: [
      // Add scheduled FOMC meeting dates
    ],
    
    // Gold volatility windows (higher profit thresholds during volatile times)
    volatilityWindows: {
      low:    { threshold: 20, minProfitBP: 20 },   // 0.2% min profit
      medium: { threshold: 50, minProfitBP: 30 },   // 0.3% min profit
      high:   { threshold: 100, minProfitBP: 50 },  // 0.5% min profit
      extreme:{ threshold: 200, minProfitBP: 100 }  // 1% min profit (rare)
    },
    
    // Gold price correlation factors
    correlations: {
      DXY: -0.8,    // USD Index inverse correlation
      rates: -0.7,  // Interest rates inverse correlation
      BTC: 0.3      // Bitcoin correlation (digital gold)
    }
  },
  
  stargate: {
    router: "0x53Bf833A5d6c4ddA888F69c22C88C9f356a41614",
    bscId: 102,
    ethPoolId: 1,
    bnbPoolId: 2,
  },
  flashLoan: {
    balancer: {
      vault: "0xBA12222222228d8Ba445958a75a0704d566BF2C8",
    },
    aave: {
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    },
  },
  bundle: {
    maxGasPrice: ethers.utils.parseUnits('1.5', 'gwei'),
    priorityFee: ethers.utils.parseUnits('0.1', 'gwei'),
    blockRange: 5,
  },
};