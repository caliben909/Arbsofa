/* ----------------------------------------------------------
    V4 Quoter (placeholder - adapt for V4 PoolManager)
    - Use V4 PoolManager for quotes
---------------------------------------------------------- */
const { Contract, ethers } = require("ethers");
const V4_POOL_MANAGER = "0x..."; // Deployed V4 PoolManager address
const abi = ["function swap(...) returns (...)"]; // V4 swap ABI

const meta = require("../../config").meta; // Reuse meta

async function quoteV4ExactInput(tokenInSym, tokenOutSym, amountHuman, provider) {
  // Placeholder: implement V4 quoting
  // For now, return dummy or use V3 quoter as fallback
  return require("./quoter").quoteExactInput(tokenInSym, tokenOutSym, amountHuman, provider);
}

module.exports = { quoteV4ExactInput };