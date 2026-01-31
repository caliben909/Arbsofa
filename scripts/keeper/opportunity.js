const { ethers } = require("ethers");
const { quoteExactInput, batchQuoteExactInput } = require("./quoter");
const { quoteV4ExactInput } = require("./quoter-v4"); // Add V4 quoter
const cfg = require("../../config");

// Chainlink oracles for validation
const chainlinkFeeds = {
  USDC: "0x50834F3163758FCC1Df9973B6e91f0F0434AD6",
  WETH: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612"
};
const chainlinkAbi = ["function latestRoundData() external view returns (uint80,int256,uint256,uint256,uint80)"];

let priceHistory = {}; // For volatility

const provider = new ethers.providers.JsonRpcProvider(cfg.rpc.primary);
const MIN_PROFIT_BPS = 30; // 0.3 % net after 0.3 % flash-fee

// Risk mitigations
async function getChainlinkPrice(token) {
  const feed = new ethers.Contract(chainlinkFeeds[token], chainlinkAbi, provider);
  const [, price,,,] = await feed.latestRoundData();
  return price;
}

async function checkVolatility(token) {
  const currentPrice = await getChainlinkPrice(token);
  if (!priceHistory[token]) priceHistory[token] = [];
  priceHistory[token].push(currentPrice);
  if (priceHistory[token].length > 10) priceHistory[token].shift(); // Keep last 10
  const avg = priceHistory[token].reduce((a, b) => a.add(b), ethers.BigNumber.from(0)).div(priceHistory[token].length);
  const variance = priceHistory[token].reduce((sum, p) => sum.add(p.sub(avg).pow(2)), ethers.BigNumber.from(0)).div(priceHistory[token].length);
  const stdDev = Math.sqrt(parseFloat(ethers.utils.formatUnits(variance, 8))); // Assume 8 decimals
  return stdDev / parseFloat(ethers.utils.formatUnits(avg, 8)) > 0.05; // >5% volatility
}

async function simulateProfit(amountIn, expectedOut, repay) {
  // Placeholder: call GodModeEmpire.simulate or estimate
  const estimatedProfit = expectedOut.sub(repay);
  return estimatedProfit.gt(amountIn.mul(130).div(10000)); // >1.3% net
}

/* ----------------------------------------------------------
    Main entry – returns best opportunity or null
---------------------------------------------------------- */
async function opportunity(keeper) {
  // 1. V3 Skew flash-swap (USDC → WETH → USDC) as baseline
  const best = await findSkewFlashSwap("USDC", "WETH", "50000");
  if (best.profitWei.gt(0)) return best;

  // 2. V4 Skew flash-swap (leverage enforced skew)
  const v4Best = await findV4SkewFlashSwap("USDC", "WETH", "50000");
  if (v4Best.profitWei.gt(0)) return v4Best;

  // 3. Multi-path batch scan (optional – uncomment to enable)
  // const batch = await batchScan(["USDC", "USDT", "DAI"], ["WETH", "WBTC"], ["50000", "100000"]);
  // if (batch.profitWei.gt(0)) return batch;

  // 4. Fallback triangular (USDC→USDT→DAI→USDC)
  return await findTriangular();
}

/* ----------------------------------------------------------
   Skew flash-swap single path
---------------------------------------------------------- */
async function findSkewFlashSwap(tokenInSym, tokenOutSym, amountHuman) {
  // Volatility check
  if (await checkVolatility(tokenInSym) || await checkVolatility(tokenOutSym)) {
    console.log("High volatility detected, skipping");
    return { profitWei: ethers.BigNumber.from(0), toTx: null };
  }

  const amountIn = ethers.utils.parseUnits(amountHuman, cfg.meta[tokenInSym].decimals);

  // 1. borrow tokenIn, receive tokenOut
  const outHuman = await quoteExactInput(tokenInSym, tokenOutSym, amountHuman, provider);
  const amountOut = ethers.utils.parseUnits(outHuman, cfg.meta[tokenOutSym].decimals);

  // 2. swap back tokenOut → tokenIn
  const backHuman = await quoteExactInput(tokenOutSym, tokenInSym, outHuman, provider);
  const amountBack = ethers.utils.parseUnits(backHuman, cfg.meta[tokenInSym].decimals);

  // 3. profit after 0.3 % flash-fee
  const repay = amountIn.mul(1003).div(1000);
  const profit = amountBack.sub(repay);

  // Profit simulation
  if (!(await simulateProfit(amountIn, amountBack, repay))) {
    console.log("Profit simulation failed");
    return { profitWei: ethers.BigNumber.from(0), toTx: null };
  }

  if (profit.lte(amountIn.mul(MIN_PROFIT_BPS).div(10000)))
    return { profitWei: ethers.BigNumber.from(0), toTx: null };

  const targetBlock = (await provider.getBlockNumber()) + 2;
  return {
    profitWei: profit,
    targetBlock,
    toTx: () => buildFlashSwapSkewTx(
      cfg.pools[`${tokenInSym}/${tokenOutSym}`],
      amountIn,
      true // zeroForOne for USDC/WETH
    )
  };
}

/* ----------------------------------------------------------
   Multi-path batch scan (async)
---------------------------------------------------------- */
async function batchScan(sources, destinations, sizes) {
  const quotes = [];
  sources.forEach(s => destinations.forEach(d => sizes.forEach(sz => quotes.push({ tokenIn: s, tokenOut: d, amount: sz }))));

  // 1. batch quote all legs-1
  const legs1 = await batchQuoteExactInput(quotes, provider);

  let best = { profitWei: ethers.BigNumber.from(0), toTx: null };

  for (let i = 0; i < quotes.length; i++) {
    const q   = quotes[i];
    const backHuman = await quoteExactInput(q.tokenOut, q.tokenIn, legs1[i], provider);
    const amountIn  = ethers.utils.parseUnits(q.amount, meta[q.tokenIn].decimals);
    const amountBack= ethers.utils.parseUnits(backHuman, meta[q.tokenIn].decimals);
    const profit    = amountBack.sub(amountIn.mul(1003).div(1000));

    if (profit.gt(best.profitWei)) best = {
      profitWei: profit,
      targetBlock: (await provider.getBlockNumber()) + 2,
      toTx: () => buildFlashSwapSkewTx(
        cfg.pools[`${q.tokenIn}/${q.tokenOut}`],
        amountIn,
        true
      )
    };
  }
  return best;
}

/* ----------------------------------------------------------
    V4 Skew flash-swap single path (leverages enforced 49/51 skew)
---------------------------------------------------------- */
async function findV4SkewFlashSwap(tokenInSym, tokenOutSym, amountHuman) {
  const amountIn = ethers.utils.parseUnits(amountHuman, cfg.meta[tokenInSym].decimals);

  // 1. borrow tokenIn, receive tokenOut
  const outHuman = await quoteV4ExactInput(tokenInSym, tokenOutSym, amountHuman, provider);
  const amountOut = ethers.utils.parseUnits(outHuman, cfg.meta[tokenOutSym].decimals);

  // 2. swap back tokenOut → tokenIn
  const backHuman = await quoteV4ExactInput(tokenOutSym, tokenInSym, outHuman, provider);
  const amountBack = ethers.utils.parseUnits(backHuman, cfg.meta[tokenInSym].decimals);

  // 3. profit after 0.3 % flash-fee
  const repay = amountIn.mul(1003).div(1000);
  const profit = amountBack.sub(repay);

  if (profit.lte(amountIn.mul(MIN_PROFIT_BPS).div(10000)))
    return { profitWei: ethers.BigNumber.from(0), toTx: null };

  const targetBlock = (await provider.getBlockNumber()) + 2;
  return {
    profitWei: profit,
    targetBlock,
    toTx: () => buildV4FlashSwapSkewTx(
      cfg.pools[`${tokenInSym}/${tokenOutSym}`], // Assume V4 pools added to config
      amountIn,
      true
    )
  };
}

/* ----------------------------------------------------------
    Triangular arb (USDC→USDT→DAI→USDC)
---------------------------------------------------------- */
async function findTriangular() {
  const amt = ethers.utils.parseUnits("50000", 6);
  const step1 = await quoteExactInput("USDC", "USDT", "50000", provider);
  const step2 = await quoteExactInput("USDT", "DAI", step1, provider);
  const step3 = await quoteExactInput("DAI", "USDC", step2, provider);
  const back  = ethers.utils.parseUnits(step3, 6);
  const profit= back.sub(amt.mul(1003).div(1000)); // 0.3 % flash-fee
  if (profit.lte(amt.mul(MIN_PROFIT_BPS).div(10000)))
    return { profitWei: ethers.BigNumber.from(0), toTx: null };

  return {
    profitWei: profit,
    targetBlock: (await provider.getBlockNumber()) + 2,
    toTx: () => buildTriangularTx(amt)
  };
}

/* ----------------------------------------------------------
   Calldata builders
---------------------------------------------------------- */
function buildFlashSwapSkewTx(pool, amount, zeroForOne) {
  const iface = new ethers.utils.Interface([
    "function arbFlashSwap((address,bool,uint256,int24,uint160))"
  ]);
  const data = iface.encodeFunctionData("arbFlashSwap", [{
    pool: pool,
    zeroForOne: zeroForOne,
    amountIn: amount,
    tickSpacing: 10, // 0.05 % tier
    sqrtPriceLimitX96: 0
  }]);
  return { to: process.env.CONTRACT, data, gasLimit: 380_000 };
}

function buildV4FlashSwapSkewTx(pool, amount, zeroForOne) {
  // Assume V4 PoolManager interface
  const iface = new ethers.utils.Interface([
    "function swap((address,bool,uint256,int256,uint160,bytes)) returns (int256,int256)"
  ]);
  // Placeholder: adapt to V4 swap params
  const data = iface.encodeFunctionData("swap", [{
    pool: pool,
    zeroForOne: zeroForOne,
    amountIn: amount,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  }]);
  return { to: process.env.V4_POOL_MANAGER, data, gasLimit: 380_000 };
}

function buildTriangularTx(amount) {
  const iface = new ethers.utils.Interface(["function arbTriangular(uint256)"]);
  const data = iface.encodeFunctionData("arbTriangular", [amount]);
  return { to: process.env.CONTRACT, data, gasLimit: 380_000 };
}

module.exports = { opportunity };