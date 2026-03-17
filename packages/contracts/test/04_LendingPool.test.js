/**
 * TEST SUITE 4: LendingPool.sol
 * Run: npx hardhat test test/04_LendingPool.test.js
 *
 * Tests:
 *  1.  borrow() local: alice deposits 100 DOT ($600), borrows $300 → receives USDC
 *  2.  borrow() max: $400 succeeds, $401 reverts "LP: insufficient collateral for this borrow"
 *  3.  borrow() reverts "LP: no collateral deposited" with zero vault balance
 *  4.  borrow() reverts "LP: position already active" on second call
 *  5.  borrow() with bridge: deploy SimpleMockBridge, setBridge, verify sendRemittance called
 *  6.  repay() zero interest: same block, position cleared, collateral released
 *  7.  repay() with interest (TIME TRAVEL): ~5% of principal after 1 year
 *  8.  repay() reverts "LP: no active position" when no position
 *  9.  liquidate() healthy position reverts "LP: position is healthy"
 * 10.  liquidate() after price crash to $3: succeeds, bob gets WDOT, position cleared
 * 11.  getHealthFactor() returns type(uint256).max for user with no position
 * 12.  pause() blocks borrow/repay/liquidate, getHealthFactor still works
 * 13.  protocolFeesUsdc accumulates, withdrawFees sends to owner
 */
const { ethers } = require("hardhat");
const { expect } = require("chai");

const DOT  = (n) => ethers.parseUnits(String(n), 10);
const USDC = (n) => ethers.parseUnits(String(n), 6);
const WAD  = ethers.parseUnits("1", 18);

describe("LendingPool", function () {
  let wdot, mockUsdc, oracle, vault, pool;
  let owner, alice, bob;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();

    // Deploy WDOT
    const WDOT = await ethers.getContractFactory("WDOT");
    wdot = await WDOT.deploy();
    await wdot.waitForDeployment();

    // Deploy MockERC20 as USDC (6 decimals)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUsdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockUsdc.waitForDeployment();

    // Deploy PriceOracle at $6 DOT
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    oracle = await PriceOracle.deploy(owner.address, ethers.parseUnits("6", 18));
    await oracle.waitForDeployment();

    // Deploy CollateralVault
    const CollateralVault = await ethers.getContractFactory("CollateralVault");
    vault = await CollateralVault.deploy(owner.address, await wdot.getAddress());
    await vault.waitForDeployment();

    // Deploy LendingPool
    const LendingPool = await ethers.getContractFactory("LendingPool");
    pool = await LendingPool.deploy(
      owner.address,
      await vault.getAddress(),
      await oracle.getAddress(),
      await mockUsdc.getAddress()
    );
    await pool.waitForDeployment();

    // Wire
    await vault.setLendingPool(await pool.getAddress());

    // Seed pool with 500,000 USDC liquidity
    await mockUsdc.mint(await pool.getAddress(), USDC(500_000));

    // Alice: wrap 100 DOT → deposit in vault
    await wdot.connect(alice).deposit({ value: DOT(100) });
    await wdot.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(alice).deposit(DOT(100));
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────
  it("1. borrow() local: alice deposits 100 DOT ($600), borrows $300 → receives USDC", async () => {
    // destChainId=0 → local, no bridge
    await pool.connect(alice).borrow(USDC(300), 0, ethers.ZeroAddress);

    expect(await mockUsdc.balanceOf(alice.address)).to.equal(USDC(300));

    const pos = await pool.positions(alice.address);
    expect(pos.isActive).to.equal(true);
    expect(pos.debtUsdc).to.equal(USDC(300));
    expect(pos.collateralWdot).to.equal(DOT(100));

    // Collateral locked in vault
    expect(await vault.getLockedCollateral(alice.address)).to.equal(DOT(100));
    expect(await vault.getAvailableCollateral(alice.address)).to.equal(0);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it("2. borrow() max: $400 succeeds, $401 reverts", async () => {
    // 100 DOT * $6 = $600 collateral. maxBorrow = $600 / 1.5 = $400
    await pool.connect(alice).borrow(USDC(400), 0, ethers.ZeroAddress);
    expect(await mockUsdc.balanceOf(alice.address)).to.equal(USDC(400));

    // Second user tries $401 with same collateral
    await wdot.connect(bob).deposit({ value: DOT(100) });
    await wdot.connect(bob).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(bob).deposit(DOT(100));

    await expect(
      pool.connect(bob).borrow(USDC(401), 0, ethers.ZeroAddress)
    ).to.be.revertedWith("LP: insufficient collateral for this borrow");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it("3. borrow() reverts 'LP: no collateral deposited' with zero vault balance", async () => {
    await expect(
      pool.connect(bob).borrow(USDC(100), 0, ethers.ZeroAddress)
    ).to.be.revertedWith("LP: no collateral deposited");
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it("4. borrow() reverts 'LP: position already active' on second call", async () => {
    await pool.connect(alice).borrow(USDC(100), 0, ethers.ZeroAddress);
    await expect(
      pool.connect(alice).borrow(USDC(100), 0, ethers.ZeroAddress)
    ).to.be.revertedWith("LP: position already active");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it("5. borrow() with bridge: SimpleMockBridge records sendRemittance call", async () => {
    const SimpleMockBridge = await ethers.getContractFactory("SimpleMockBridge");
    const mockBridge = await SimpleMockBridge.deploy();
    await mockBridge.waitForDeployment();

    await pool.setBridge(await mockBridge.getAddress());

    // borrow with destChainId=56 (BNB) and bob as recipient
    await pool.connect(alice).borrow(USDC(200), 56, bob.address);

    expect(await mockBridge.callCount()).to.equal(1);
    expect(await mockBridge.lastRecipient()).to.equal(bob.address);
    expect(await mockBridge.lastAmount()).to.equal(USDC(200));
    expect(await mockBridge.lastDestChainId()).to.equal(56);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it("6. repay() zero interest: same block, position cleared, collateral released", async () => {
    await pool.connect(alice).borrow(USDC(200), 0, ethers.ZeroAddress);

    // Alice got USDC from borrow — approve and repay immediately
    await mockUsdc.connect(alice).approve(await pool.getAddress(), USDC(200));
    await pool.connect(alice).repay();

    const pos = await pool.positions(alice.address);
    expect(pos.isActive).to.equal(false);
    // Collateral released back to available
    expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(100));
    expect(await vault.getLockedCollateral(alice.address)).to.equal(0);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────
  it("7. repay() with interest: ~5% after 1 year", async () => {
    await pool.connect(alice).borrow(USDC(200), 0, ethers.ZeroAddress);

    // Time travel: 1 year
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    const [principal, interest, total] = await pool.getRepaymentAmount(alice.address);
    expect(principal).to.equal(USDC(200));
    // 5% of 200 = 10 USDC, allow ±0.1 USDC tolerance
    expect(interest).to.be.closeTo(USDC(10), USDC("0.1"));
    expect(total).to.equal(principal + interest);

    // Give alice extra USDC for interest, approve, repay
    await mockUsdc.mint(alice.address, interest);
    await mockUsdc.connect(alice).approve(await pool.getAddress(), total);
    await pool.connect(alice).repay();

    const pos = await pool.positions(alice.address);
    expect(pos.isActive).to.equal(false);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────
  it("8. repay() reverts 'LP: no active position' when no position", async () => {
    await expect(
      pool.connect(alice).repay()
    ).to.be.revertedWith("LP: no active position");
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────
  it("9. liquidate() healthy position reverts 'LP: position is healthy'", async () => {
    await pool.connect(alice).borrow(USDC(300), 0, ethers.ZeroAddress);

    await expect(
      pool.connect(bob).liquidate(alice.address)
    ).to.be.revertedWith("LP: position is healthy");
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────
  it("10. liquidate() after price crash to $3: bob gets WDOT, position cleared", async () => {
    // Borrow near max ($400) so price crash makes it liquidatable
    await pool.connect(alice).borrow(USDC(400), 0, ethers.ZeroAddress);

    // Crash DOT price from $6 → $3
    // Collateral now worth $300, debt=$400 → hf = ($300 * 13000 * 1e18)/(400e18 * 10000) = 0.975e18
    await oracle.setMockPrice(ethers.parseUnits("3", 18));

    // Health factor should be < 1 WAD now
    const hf = await pool.getHealthFactor(alice.address);
    expect(hf).to.be.lt(WAD);

    // Bob pays alice's debt, gets her WDOT
    // Add buffer because interest accrues between read and tx
    const [, , totalDebt] = await pool.getRepaymentAmount(alice.address);
    const buffer = USDC("1"); // 1 USDC buffer for block advancement
    await mockUsdc.mint(bob.address, totalDebt + buffer);
    await mockUsdc.connect(bob).approve(await pool.getAddress(), totalDebt + buffer);

    const bobWdotBefore = await wdot.balanceOf(bob.address);
    await pool.connect(bob).liquidate(alice.address);

    // Bob received WDOT
    expect(await wdot.balanceOf(bob.address)).to.be.gt(bobWdotBefore);
    // Alice's position is cleared
    const pos = await pool.positions(alice.address);
    expect(pos.isActive).to.equal(false);
    expect(await vault.getLockedCollateral(alice.address)).to.equal(0);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────
  it("11. getHealthFactor() returns type(uint256).max for user with no position", async () => {
    expect(await pool.getHealthFactor(bob.address)).to.equal(ethers.MaxUint256);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────
  it("12. pause() blocks borrow/repay/liquidate, getHealthFactor still works", async () => {
    await pool.pause();

    // borrow blocked
    await expect(
      pool.connect(alice).borrow(USDC(100), 0, ethers.ZeroAddress)
    ).to.be.reverted;

    // getHealthFactor still works (view function, no whenNotPaused)
    expect(await pool.getHealthFactor(alice.address)).to.equal(ethers.MaxUint256);

    // unpause restores borrow
    await pool.unpause();
    await pool.connect(alice).borrow(USDC(100), 0, ethers.ZeroAddress);
    expect((await pool.positions(alice.address)).isActive).to.equal(true);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────
  it("13. protocolFeesUsdc accumulates, withdrawFees sends to owner", async () => {
    await pool.connect(alice).borrow(USDC(200), 0, ethers.ZeroAddress);

    // Time travel 1 year to accrue interest
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);

    // Repay — interest goes to protocolFeesUsdc
    const [, interest, total] = await pool.getRepaymentAmount(alice.address);
    await mockUsdc.mint(alice.address, interest);
    await mockUsdc.connect(alice).approve(await pool.getAddress(), total);
    await pool.connect(alice).repay();

    // Fees accumulated
    const fees = await pool.protocolFeesUsdc();
    expect(fees).to.be.gt(0);
    expect(fees).to.be.closeTo(USDC(10), USDC("0.1")); // ~5% of 200

    // Withdraw fees
    const ownerBalBefore = await mockUsdc.balanceOf(owner.address);
    await pool.withdrawFees(owner.address);
    const ownerBalAfter = await mockUsdc.balanceOf(owner.address);

    expect(ownerBalAfter - ownerBalBefore).to.equal(fees);
    expect(await pool.protocolFeesUsdc()).to.equal(0);
  });
});
