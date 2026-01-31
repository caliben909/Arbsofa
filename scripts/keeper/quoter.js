/* ----------------------------------------------------------
   Universal Uni-V3 off-chain quoter
   - decimal-correct (6-18)
   - fee tier auto-map (100/500/3000)
   - throws on failure → keeper skips
---------------------------------------------------------- */
const { Contract, ethers } = require("ethers");
const QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const abi = ["function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)"];

const chainlinkFeeds = require("../../config").oracles;
const chainlinkAbi = ["function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)"];

async function getChainlinkPrice(token) {
  const provider = new ethers.providers.JsonRpcProvider(require("../../config").rpc.primary);
  const feed = new Contract(chainlinkFeeds[token], chainlinkAbi, provider);
  const [, price,,,] = await feed.latestRoundData();
  return price;
}

/* ----------------------------------------------------------
   Token meta (decimals + address)  –  matches config.js
---------------------------------------------------------- */
const meta = {
  USDC:  { decimals: 6,  addr: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8" },
  USDT:  { decimals: 6,  addr: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" },
  DAI:   { decimals: 18, addr: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" },
  WBTC:  { decimals: 8,  addr: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" },
  WETH:  { decimals: 18, addr: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
  stETH: { decimals: 18, addr: "0x5979D7b546E38E414F7E9822514be443A4800529" },
  GMX:   { decimals: 18, addr: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a" },
  MAGIC: { decimals: 18, addr: "0x539bdE0d7Dbd336b79148AA742883198BBF60342" },
  GRAIL: { decimals: 18, addr: "0x3d9907F9a368ad0a51Be60f7Da3b97cf940982D8" },
  RDNT:  { decimals: 18, addr: "0x3082CC23568eA640225c2467653dB90e9250AaA0" },
  PENDLE:{ decimals: 18, addr: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8" },
  LINK:  { decimals: 18, addr: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4" },
  UNI:   { decimals: 18, addr: "0x6FD9D7AD17242C41F7131d257212c54a11213923" },
  AAVE:  { decimals: 18, addr: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196" },
  ARB:   { decimals: 18, addr: "0x912CE59144191C1204E64559FE8253a0e49E6548" },
  LDO:   { decimals: 18, addr: "0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60" },
  CRV:   { decimals: 18, addr: "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978" },
  PEPE:  { decimals: 18, addr: "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00" },
  BONK:  { decimals: 18, addr: "0x09199D9A5F4448d0848e4395D065e1A1C5A5263f" },
  SXAU:  { decimals: 18, addr: "0x9D5f8C42F21d0234eFF8274de832C6E123c2B46a" },
};

/* ----------------------------------------------------------
   Fee tier map (same as config.js)
---------------------------------------------------------- */
const fees = {
  "USDC/USDT": 100, "DAI/USDC": 100, "USDC/WETH": 500, "WBTC/WETH": 3000,
  "LINK/WETH": 3000, "ARB/WETH": 3000, "GMX/WETH": 3000, "MAGIC/WETH": 3000,
  "GRAIL/WETH": 3000, "RDNT/WETH": 3000, "PENDLE/WETH": 3000,
  "UNI/WETH": 3000, "AAVE/WETH": 3000, "LDO/WETH": 3000, "CRV/WETH": 3000,
  "PEPE/WETH": 3000, "BONK/WETH": 3000, "SXAU/USDC": 3000,
};

/* ----------------------------------------------------------
   Universal helper
---------------------------------------------------------- */
async function quoteExactInput(tokenInSym, tokenOutSym, amountHuman, provider) {
  const mIn  = meta[tokenInSym];
  const mOut = meta[tokenOutSym];
  if (!mIn || !mOut) throw new Error("Unknown token symbol");

  const amountIn = ethers.utils.parseUnits(amountHuman, mIn.decimals);
  const key = `${tokenInSym}/${tokenOutSym}`;
  const fee = fees[key] || 3000; // default 0.3 %
  const quoter = new Contract(QUOTER, abi, provider);

  const amountOut = await quoter.quoteExactInputSingle(
      mIn.addr,
      mOut.addr,
      fee,
      amountIn,
      0,
      { gasLimit: 50_000 } // static-call
  );

  // Chainlink validation
  const uniswapPrice = parseFloat(amountHuman) / parseFloat(ethers.utils.formatUnits(amountOut, mOut.decimals));
  const chainlinkIn = await getChainlinkPrice(tokenInSym);
  const chainlinkOut = await getChainlinkPrice(tokenOutSym);
  const chainlinkPrice = parseFloat(ethers.utils.formatUnits(chainlinkIn, 8)) / parseFloat(ethers.utils.formatUnits(chainlinkOut, 8));
  if (Math.abs(uniswapPrice - chainlinkPrice) / chainlinkPrice > 0.01) { // >1% deviation
    throw new Error("Price validation failed");
  }

  return ethers.utils.formatUnits(amountOut, mOut.decimals);
}

/* ----------------------------------------------------------
   Batch-quote helper (multi-call in one RPC)
---------------------------------------------------------- */
async function batchQuoteExactInput(quotes, provider) {
  const quoter = new Contract(QUOTER, abi, provider);
  const promises = quotes.map(q =>
    quoter.quoteExactInputSingle(
        meta[q.tokenIn].addr,
        meta[q.tokenOut].addr,
        fees[`${q.tokenIn}/${q.tokenOut}`] || 3000,
        ethers.utils.parseUnits(q.amount, meta[q.tokenIn].decimals),
        0,
        { gasLimit: 50_000 }
    ).then(r => ethers.utils.formatUnits(r, meta[q.tokenOut].decimals))
  );
  return Promise.all(promises);
}

module.exports = { quoteExactInput, batchQuoteExactInput };