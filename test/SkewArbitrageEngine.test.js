const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SkewArbitrageEngine", function () {
  let engine;
  let owner;
  let executor;
  let treasury;
  let user;

  // Mock addresses
  const UNISWAP_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
  const SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
  const QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
  const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";

  beforeEach(async function () {
    [owner, executor, treasury, user] = await ethers.getSigners();

    const SkewArbitrageEngine = await ethers.getContractFactory("SkewArbitrageEngine");
    engine = await SkewArbitrageEngine.deploy(
      UNISWAP_FACTORY,
      SWAP_ROUTER,
      QUOTER,
      AAVE_POOL,
      treasury.address
    );
    await engine.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await engine.owner()).to.equal(owner.address);
    });

    it("Should set the correct protocol addresses", async function () {
      expect(await engine.uniswapV3Factory()).to.equal(UNISWAP_FACTORY);
      expect(await engine.swapRouter()).to.equal(SWAP_ROUTER);
      expect(await engine.quoter()).to.equal(QUOTER);
      expect(await engine.aavePool()).to.equal(AAVE_POOL);
      expect(await engine.treasury()).to.equal(treasury.address);
    });

    it("Should authorize deployer as executor", async function () {
      expect(await engine.executors(owner.address)).to.be.true;
    });

    it("Should have correct constants", async function () {
      expect(await engine.MIN_PROFIT_BP()).to.equal(15);
      expect(await engine.MAX_SLIPPAGE_BP()).to.equal(100);
      expect(await engine.TREASURY_FEE_BP()).to.equal(2000);
      expect(await engine.DEV_FEE_BP()).to.equal(500);
    });
  });

  describe("Pool Registration", function () {
    const poolAddress = "0x0000000000000000000000000000000000000001";
    const token0 = "0x0000000000000000000000000000000000000002";
    const token1 = "0x0000000000000000000000000000000000000003";

    it("Should allow owner to register a skew pool", async function () {
      await engine.registerSkewPool(
        poolAddress,
        token0,
        token1,
        500,
        4950, // 49.5%
        5050, // 50.5%
        50,   // 0.5% min deviation
        ethers.parseEther("100")
      );

      const pool = await engine.skewPools(poolAddress);
      expect(pool.pool).to.equal(poolAddress);
      expect(pool.token0).to.equal(token0);
      expect(pool.token1).to.equal(token1);
      expect(pool.fee).to.equal(500);
      expect(pool.targetRatio0).to.equal(4950);
      expect(pool.targetRatio1).to.equal(5050);
      expect(pool.minDeviation).to.equal(50);
      expect(pool.active).to.be.true;
    });

    it("Should revert if ratios don't sum to 100%", async function () {
      await expect(
        engine.registerSkewPool(
          poolAddress,
          token0,
          token1,
          500,
          4000,
          5000,
          50,
          ethers.parseEther("100")
        )
      ).to.be.revertedWith("Ratios must sum to 100%");
    });

    it("Should revert if min deviation is too low", async function () {
      await expect(
        engine.registerSkewPool(
          poolAddress,
          token0,
          token1,
          500,
          5000,
          5000,
          5, // Too low
          ethers.parseEther("100")
        )
      ).to.be.revertedWith("Min deviation too low");
    });

    it("Should revert if max flash size is 0", async function () {
      await expect(
        engine.registerSkewPool(
          poolAddress,
          token0,
          token1,
          500,
          5000,
          5000,
          50,
          0
        )
      ).to.be.revertedWith("Max flash must be > 0");
    });

    it("Should emit SkewPoolRegistered event", async function () {
      await expect(
        engine.registerSkewPool(
          poolAddress,
          token0,
          token1,
          500,
          4950,
          5050,
          50,
          ethers.parseEther("100")
        )
      )
        .to.emit(engine, "SkewPoolRegistered")
        .withArgs(poolAddress, 4950, 5050, 50);
    });

    it("Should not allow non-owner to register pool", async function () {
      await expect(
        engine.connect(user).registerSkewPool(
          poolAddress,
          token0,
          token1,
          500,
          4950,
          5050,
          50,
          ethers.parseEther("100")
        )
      ).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    });
  });

  describe("Executor Management", function () {
    it("Should allow owner to authorize executor", async function () {
      await engine.setExecutor(executor.address, true);
      expect(await engine.executors(executor.address)).to.be.true;
    });

    it("Should allow owner to revoke executor", async function () {
      await engine.setExecutor(executor.address, true);
      await engine.setExecutor(executor.address, false);
      expect(await engine.executors(executor.address)).to.be.false;
    });

    it("Should emit ExecutorAuthorized event", async function () {
      await expect(engine.setExecutor(executor.address, true))
        .to.emit(engine, "ExecutorAuthorized")
        .withArgs(executor.address, true);
    });

    it("Should not allow non-owner to set executor", async function () {
      await expect(
        engine.connect(user).setExecutor(executor.address, true)
      ).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow owner to pause", async function () {
      await engine.setPaused(true);
      expect(await engine.paused()).to.be.true;
    });

    it("Should allow owner to unpause", async function () {
      await engine.setPaused(true);
      await engine.setPaused(false);
      expect(await engine.paused()).to.be.false;
    });

    it("Should not allow non-owner to pause", async function () {
      await expect(
        engine.connect(user).setPaused(true)
      ).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    });
  });

  describe("Treasury Management", function () {
    it("Should allow owner to update treasury", async function () {
      await engine.setTreasury(user.address);
      expect(await engine.treasury()).to.equal(user.address);
    });

    it("Should revert for zero address treasury", async function () {
      await expect(
        engine.setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("Invalid treasury");
    });

    it("Should not allow non-owner to update treasury", async function () {
      await expect(
        engine.connect(user).setTreasury(user.address)
      ).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      // Register a test pool
      await engine.registerSkewPool(
        "0x0000000000000000000000000000000000000001",
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
        "0xA0b86a33E6441E6C7D3D4B4f6c7e8f9a0b1c2d3e", // USDC
        500,
        4950,
        5050,
        50,
        ethers.parseEther("100")
      );
    });

    it("Should return active pools", async function () {
      const activePools = await engine.getActivePools();
      expect(activePools.length).to.equal(1);
    });

    it("Should return empty array when no active pools", async function () {
      await engine.updateSkewPool(
        "0x0000000000000000000000000000000000000001",
        false,
        50,
        ethers.parseEther("100")
      );
      const activePools = await engine.getActivePools();
      expect(activePools.length).to.equal(0);
    });
  });

  describe("Emergency Functions", function () {
    it("Should allow owner to emergency withdraw", async function () {
      // This would need a mock token to test properly
      // Just checking the function exists and is protected
      await expect(
        engine.connect(user).emergencyWithdraw(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(engine, "OwnableUnauthorizedAccount");
    });
  });
});
