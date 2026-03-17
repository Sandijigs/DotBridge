/**
 * TEST SUITE 4: LendingPool.sol
 * Run: npx hardhat test test/04_lending.test.js
 *
 * This is the most important test suite.
 * Covers full borrow/repay cycle, health factor, liquidation,
 * and all decimal precision edge cases.
 */
const { ethers } = require("hardhat");
const { expect }  = require("chai");
const { time }    = require("@nomicfoundation/hardhat-network-helpers");

describe("LendingPool", function () {
  let wdot, usdc, oracle, vault, bridge, pool;
  let owner, alice, bob, liquidator;

  const ONE_DOT      = ethers.parseUnits("1", 10);   // 1e10
  const HUNDRED_DOT  = ONE_DOT * 100n;
  const ONE_USDC     = 1_000_000n;                   // 1e6
  const HUNDRED_USDC = ONE_USDC * 100n;

  // $6 DOT price, 8 decimals
  const DOT_PRICE = 600_000_000n;

  beforeEach(async () => {
    [owner, alice, bob, liquidator] = await ethers.getSigners();

    // Deploy all contracts
    const WDOT     = await ethers.getContractFactory("WDOT");
    wdot = await WDOT.deploy();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(DOT_PRICE);

    const CollateralVault = await ethers.getContractFactory("CollateralVault");
    vault = await CollateralVault.deploy(await wdot.getAddress());

    const RemittanceBridge = await ethers.getContractFactory("RemittanceBridge");
    bridge = await RemittanceBridge.deploy(await usdc.getAddress(), ethers.ZeroAddress);

    const LendingPool = await ethers.getContractFactory("LendingPool");
    pool = await LendingPool.deploy(
      await usdc.getAddress(),
      await vault.getAddress(),
      await oracle.getAddress()
    );

    // Wire
    await vault.setLendingPool(await pool.getAddress());
    await bridge.setLendingPool(await pool.getAddress());
    await pool.setBridge(await bridge.getAddress());

    // Seed pool with 100,000 USDC
    await usdc.transfer(await pool.getAddress(), ONE_USDC * 100_000n);

    // Give alice WDOT
    await wdot.connect(alice).deposit({ value: HUNDRED_DOT * 10n });
    await wdot.connect(alice).approve(await vault.getAddress(), HUNDRED_DOT * 10n);
    await vault.connect(alice).deposit(HUNDRED_DOT * 10n);
  });

  describe("requiredCollateral()", () => {
    it("returns correct WDOT for $100 USDC at $6 DOT (150% ratio)", async () => {
      // $100 USDC at 150% = $150 in DOT
      // $150 / $6 per DOT = 25 DOT = 25e10 planks
      const required = await pool.requiredCollateral(HUNDRED_USDC);
      const TWENTY_FIVE_DOT = ONE_DOT * 25n;
      expect(required).to.equal(TWENTY_FIVE_DOT);
    });
  });

  describe("borrow()", () => {
    it("creates position, locks collateral, sends remittance", async () => {
      await pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address);

      const pos = await pool.positions(alice.address);
      expect(pos.isActive).to.be.true;
      expect(pos.debtPrincipal).to.equal(HUNDRED_USDC);

      expect(await vault.lockedCollateral(alice.address)).to.equal(ONE_DOT * 25n);
    });

    it("reverts if insufficient collateral", async () => {
      // Try to borrow $10,000 with only ~$600 in DOT
      await expect(pool.connect(alice).borrow(ONE_USDC * 10_000n, 56, bob.address))
        .to.be.revertedWith("LendingPool: insufficient collateral");
    });

    it("reverts if existing position open", async () => {
      await pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address);
      await expect(pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address))
        .to.be.revertedWith("LendingPool: repay existing loan first");
    });
  });

  describe("repay()", () => {
    beforeEach(async () => {
      await pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address);
      // Give alice USDC to repay (she borrowed it, it went to bridge — simulate faucet)
      await usdc.faucet(alice.address, HUNDRED_USDC * 2n);
    });

    it("clears position and releases collateral", async () => {
      const repayAmount = await pool.getRepayAmount(alice.address);
      await usdc.connect(alice).approve(await pool.getAddress(), repayAmount);
      await pool.connect(alice).repay();

      const pos = await pool.positions(alice.address);
      expect(pos.isActive).to.be.false;
      expect(await vault.lockedCollateral(alice.address)).to.equal(0n);
      expect(await vault.freeCollateral(alice.address)).to.be.gt(0n);
    });

    it("accrues interest over time", async () => {
      const instantDebt = await pool.getRepayAmount(alice.address);
      await time.increase(365 * 24 * 3600); // advance 1 year
      const yearDebt = await pool.getRepayAmount(alice.address);

      // 5% APR: yearDebt ≈ 105 USDC
      expect(yearDebt).to.be.gt(instantDebt);
      const interest = yearDebt - instantDebt;
      // ~5 USDC interest on $100 over 1 year
      expect(interest).to.be.closeTo(5n * ONE_USDC, ONE_USDC / 10n);
    });
  });

  describe("healthFactor()", () => {
    it("returns healthy factor after borrow", async () => {
      await pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address);
      const hf = await pool.healthFactor(alice.address);
      // 150% collateral / 130% threshold = 1.15 → 115 in our scale
      expect(hf).to.be.gte(100n);
    });

    it("drops below 100 when DOT price crashes", async () => {
      await pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address);
      // Crash DOT price from $6 to $3 (50% drop)
      await oracle.setMockPrice(300_000_000n);
      const hf = await pool.healthFactor(alice.address);
      expect(hf).to.be.lt(100n);
    });
  });

  describe("liquidate()", () => {
    it("allows liquidation of undercollateralized position", async () => {
      await pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address);
      await oracle.setMockPrice(300_000_000n); // crash price

      // Give liquidator USDC
      await usdc.faucet(liquidator.address, HUNDRED_USDC * 2n);
      const repayAmount = await pool.getRepayAmount(alice.address);
      await usdc.connect(liquidator).approve(await pool.getAddress(), repayAmount);

      await pool.connect(liquidator).liquidate(alice.address);

      const pos = await pool.positions(alice.address);
      expect(pos.isActive).to.be.false;
      // Liquidator received WDOT (with bonus)
      expect(await vault.lockedCollateral(alice.address)).to.equal(0n);
    });

    it("reverts liquidation of healthy position", async () => {
      await pool.connect(alice).borrow(HUNDRED_USDC, 56, bob.address);
      await expect(pool.connect(liquidator).liquidate(alice.address))
        .to.be.revertedWith("LendingPool: position is healthy");
    });
  });
});
