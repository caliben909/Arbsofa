const hre = require("hardhat");

// Network-specific addresses
const ADDRESSES = {
  mainnet: {
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
    aavePool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  },
  arbitrum: {
    uniswapV3Factory: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    quoter: "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6",
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  },
  base: {
    uniswapV3Factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
    swapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481",
    quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
    aavePool: "0xA238Dd80C259a9e81C25b005494Dd7d9b6f3B793",
  },
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying SkewArbitrageEngine with account:", deployer.address);

  // Get network
  const network = hre.network.name;
  console.log("Network:", network);

  // Get addresses for network
  const addresses = ADDRESSES[network] || ADDRESSES.mainnet;
  
  // Treasury address (can be same as deployer initially)
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  // Deploy SkewArbitrageEngine
  const SkewArbitrageEngine = await hre.ethers.getContractFactory("SkewArbitrageEngine");
  const engine = await SkewArbitrageEngine.deploy(
    addresses.uniswapV3Factory,
    addresses.swapRouter,
    addresses.quoter,
    addresses.aavePool,
    treasury
  );

  await engine.waitForDeployment();
  const engineAddress = await engine.getAddress();

  console.log("SkewArbitrageEngine deployed to:", engineAddress);
  console.log("Treasury:", treasury);

  // Verify contract on Etherscan (if not local)
  if (network !== "hardhat" && network !== "localhost") {
    console.log("Waiting for block confirmations...");
    await engine.deploymentTransaction().wait(5);

    try {
      await hre.run("verify:verify", {
        address: engineAddress,
        constructorArguments: [
          addresses.uniswapV3Factory,
          addresses.swapRouter,
          addresses.quoter,
          addresses.aavePool,
          treasury,
        ],
      });
      console.log("Contract verified on Etherscan");
    } catch (error) {
      console.log("Verification failed:", error.message);
    }
  }

  // Save deployment info
  const deploymentInfo = {
    network,
    engineAddress,
    treasury,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
  };

  const fs = require("fs");
  fs.writeFileSync(
    `deployments/skew-arbitrage-${network}.json`,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\nDeployment complete!");
  console.log("Next steps:");
  console.log("1. Register skew pools using registerSkewPool()");
  console.log("2. Set up executors using setExecutor()");
  console.log("3. Fund the contract with gas tokens for callbacks");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
