require("dotenv").config();
const { opportunity } = require("./scripts/keeper/opportunity");
const nodemailer = require("nodemailer"); // Assume installed for alerts

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

async function test() {
  try {
    const opp = await opportunity();
    if (opp.profitWei.gt(0)) {
      console.log(`Profit found: ${opp.profitWei.toString()} wei`);
      await sendAlert("Arbitrage Opportunity", `Profit: ${opp.profitWei.toString()}`);
    } else {
      console.log("No profitable opportunity found");
    }
  } catch (e) {
    console.error("Error:", e.message);
    await sendAlert("Arbitrage Error", `Error: ${e.message}`);
  }
}

test();