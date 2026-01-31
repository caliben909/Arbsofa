require("dotenv").config();
const { ethers } = require("ethers");
const { FlashbotsBundleProvider } = require("@flashbots/ethers-provider-bundle");
const { opportunity } = require("./opportunity");
const { executeAtomicMulticall } = require("./executor");
const cfg = require("../../config");
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransporter({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

async function sendAlert(subject, message) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.ALERT_EMAIL,
    subject,
    text: message
  });
}

const provider = new ethers.providers.JsonRpcProvider(cfg.rpc.primary);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const authSigner = new ethers.Wallet(process.env.FLASHBOTS_SIGNATURE, provider);

const MAX_BUNDLE_TX    = 5;          // 5 arb tx max per bundle
const BLOCKS_AHEAD     = 2;          // target current + 2
const INITIAL_SLEEP_MS = 1_200;      // base poll
const MAX_SLEEP_MS     = 30_000;     // max back-off
const GAS_PRICE_CAP    = ethers.utils.parseUnits("1.5", "gwei");

let fbProvider;
let sleepMs = INITIAL_SLEEP_MS;

/* ----------------------------------------------------------
   Entry
---------------------------------------------------------- */
async function init() {
  fbProvider = await FlashbotsBundleProvider.create(provider, authSigner);
  console.log("Flashbots ready");
  loop();
}

/* ----------------------------------------------------------
   Main loop with exponential back-off on errors
---------------------------------------------------------- */
async function loop() {
  while (true) {
    try {
      const blockNumber = await provider.getBlockNumber();
      const targetBlock = blockNumber + BLOCKS_AHEAD;

      // ------ collect up to 5 opportunities ------
      const bundle = [];
      let totalProfit = ethers.BigNumber.from(0);

      for (let i = 0; i < MAX_BUNDLE_TX; i++) {
        const opp = await opportunity(wallet.address);
        if (!opp.profitWei.gt(0)) break;

        const tx = await opp.toTx();
        bundle.push({ transaction: tx, signer: wallet });
        totalProfit = totalProfit.add(opp.profitWei);
      }

      if (bundle.length === 0) {
        sleepMs = INITIAL_SLEEP_MS;
        await sleep(sleepMs);
        continue;
      }

      // ------ send bundle ------
      const sendResult = await fbProvider.sendBundle(bundle, targetBlock);
      console.log(`Bundle sent (hash=${sendResult.bundleHash})  target=${targetBlock}  txs=${bundle.length}  profit=${ethers.utils.formatUnits(totalProfit, 6)} USDC`);

      // ------ wait for inclusion ------
      const wait = await sendResult.wait();
      if (wait === 0) {
        console.log("✅ Bundle mined");
        sleepMs = INITIAL_SLEEP_MS; // reset back-off
      } else {
        console.log("❌ Bundle rejected");
        sleepMs = Math.min(sleepMs * 2, MAX_SLEEP_MS);
      }

    } catch (e) {
      console.error("Keeper crash", e.message);
      // Send alert
      await sendAlert("Keeper Crash", `Error: ${e.message}`);
      sleepMs = Math.min(sleepMs * 2, MAX_SLEEP_MS);
    }
    await sleep(sleepMs);
  }
}

/* ----------------------------------------------------------
   Utils
---------------------------------------------------------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ----------------------------------------------------------
   Start
---------------------------------------------------------- */
init();