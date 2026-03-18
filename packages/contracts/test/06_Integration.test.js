/**
 * TEST GATE 6 — Full Integration Test
 * Tests the complete DotBridge user journey end-to-end.
 * Run: npx hardhat test test/06_Integration.test.js
 *
 * Flow:
 *  1. Alice wraps DOT → WDOT
 *  2. Alice deposits WDOT into CollateralVault
 *  3. Alice borrows USDC via LendingPool (local, no bridge)
 *  4. Alice borrows + remits via LendingPool + RemittanceBridge (mock)
 *  5. Alice repays with interest
 *  6. Bob liquidates an undercollateralised position
 */
const { expect } = require('chai');
const { ethers } = require('hardhat');
const { parseUnits, ZeroAddress } = ethers;

const DOT  = (n) => parseUnits(String(n), 10);
const USDC = (n) => parseUnits(String(n), 6);
const WAD  = parseUnits('1', 18);

describe('Feature 6 — Integration (full flow)', () => {
  let wdot, oracle, vault, pool, bridge, mockUsdc;
  let owner, alice, bob, charlie;

  beforeEach(async () => {
    [owner, alice, bob, charlie] = await ethers.getSigners();

    // Deploy all contracts
    const WDOT             = await ethers.getContractFactory('WDOT');
    const MockERC20        = await ethers.getContractFactory('MockERC20');
    const PriceOracle      = await ethers.getContractFactory('PriceOracle');
    const CollateralVault  = await ethers.getContractFactory('CollateralVault');
    const RemittanceBridge = await ethers.getContractFactory('RemittanceBridge');
    const LendingPool      = await ethers.getContractFactory('LendingPool');

    wdot     = await WDOT.deploy();
    mockUsdc = await MockERC20.deploy('USD Coin', 'USDC', 6);
    oracle   = await PriceOracle.deploy(owner.address, parseUnits('6', 18)); // $6 DOT
    vault    = await CollateralVault.deploy(owner.address, await wdot.getAddress());
    bridge   = await RemittanceBridge.deploy(owner.address, await mockUsdc.getAddress(), ZeroAddress); // mock mode
    pool     = await LendingPool.deploy(
      owner.address,
      await vault.getAddress(),
      await oracle.getAddress(),
      await mockUsdc.getAddress()
    );

    await wdot.waitForDeployment();
    await mockUsdc.waitForDeployment();
    await oracle.waitForDeployment();
    await vault.waitForDeployment();
    await bridge.waitForDeployment();
    await pool.waitForDeployment();

    // Wire up
    await vault.setLendingPool(await pool.getAddress());
    await bridge.setLendingPool(await pool.getAddress());
    await pool.setBridge(await bridge.getAddress());

    // Seed pool with USDC liquidity
    await mockUsdc.mint(await pool.getAddress(), USDC(500_000));
  });

  describe('Step 1–2: Wrap DOT + Deposit Collateral', () => {
    it('Alice wraps 100 DOT and deposits as collateral', async () => {
      // Wrap
      await wdot.connect(alice).deposit({ value: DOT(100) });
      expect(await wdot.balanceOf(alice.address)).to.equal(DOT(100));

      // Approve vault
      await wdot.connect(alice).approve(await vault.getAddress(), DOT(100));

      // Deposit
      await vault.connect(alice).deposit(DOT(100));
      expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(100));
      expect(await vault.getLockedCollateral(alice.address)).to.equal(0);
    });
  });

  describe('Step 3: Borrow USDC locally (no bridge)', () => {
    beforeEach(async () => {
      await wdot.connect(alice).deposit({ value: DOT(100) });
      await wdot.connect(alice).approve(await vault.getAddress(), DOT(100));
      await vault.connect(alice).deposit(DOT(100));
    });

    it('borrows USDC at 150% collateral ratio', async () => {
      // 100 DOT × $6 = $600 collateral
      // Max borrow = $600 / 1.5 = $400
      const maxBorrow = await pool.getMaxBorrow(alice.address);
      // maxBorrow is in WAD — convert to USDC amount
      const borrowAmount = USDC(300); // $300 < $400 max

      await pool.connect(alice).borrow(borrowAmount, 0, ZeroAddress);

      expect(await mockUsdc.balanceOf(alice.address)).to.equal(borrowAmount);
      const pos = await pool.positions(alice.address);
      expect(pos.isActive).to.equal(true);
      expect(pos.debtUsdc).to.equal(borrowAmount);
      expect(await vault.getLockedCollateral(alice.address)).to.equal(DOT(100));
    });

    it('reverts when borrowing over the collateral ratio', async () => {
      // $600 collateral / 1.5 = $400 max borrow
      // Try to borrow $401
      await expect(pool.connect(alice).borrow(USDC(401), 0, ZeroAddress))
        .to.be.revertedWith('LP: insufficient collateral for this borrow');
    });

    it('reverts on second borrow (one position per user)', async () => {
      await pool.connect(alice).borrow(USDC(100), 0, ZeroAddress);
      await expect(pool.connect(alice).borrow(USDC(100), 0, ZeroAddress))
        .to.be.revertedWith('LP: position already active');
    });
  });

  describe('Step 4: Borrow + Remit cross-chain (mock bridge)', () => {
    beforeEach(async () => {
      await wdot.connect(alice).deposit({ value: DOT(100) });
      await wdot.connect(alice).approve(await vault.getAddress(), DOT(100));
      await vault.connect(alice).deposit(DOT(100));
    });

    it('sends USDC to recipient via bridge in mock mode', async () => {
      const beforeBob = await mockUsdc.balanceOf(bob.address);
      // Chain 56 = BNB Chain, bob is recipient
      await pool.connect(alice).borrow(USDC(200), 56, bob.address);
      // Mock mode: bridge transfers USDC locally to recipient
      expect(await mockUsdc.balanceOf(bob.address)).to.equal(beforeBob + USDC(200));
    });

    it('emits RemittanceSent event from bridge', async () => {
      await expect(pool.connect(alice).borrow(USDC(200), 56, bob.address))
        .to.emit(bridge, 'RemittanceSent');
    });
  });

  describe('Step 5: Repay + reclaim collateral', () => {
    beforeEach(async () => {
      await wdot.connect(alice).deposit({ value: DOT(100) });
      await wdot.connect(alice).approve(await vault.getAddress(), DOT(100));
      await vault.connect(alice).deposit(DOT(100));
      await pool.connect(alice).borrow(USDC(300), 0, ZeroAddress);
    });

    it('repays principal + interest and releases collateral', async () => {
      const [principal, interest, total] = await pool.getRepaymentAmount(alice.address);
      expect(principal).to.equal(USDC(300));

      // Give Alice enough USDC to repay (+ buffer for interest accrual between blocks)
      const buffer = USDC(1);
      await mockUsdc.mint(alice.address, interest + buffer);
      await mockUsdc.connect(alice).approve(await pool.getAddress(), total + buffer);
      await pool.connect(alice).repay();

      const pos = await pool.positions(alice.address);
      expect(pos.isActive).to.equal(false);
      // Collateral is released back to available
      expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(100));
      expect(await vault.getLockedCollateral(alice.address)).to.equal(0);
    });
  });

  describe('Step 6: Liquidation', () => {
    beforeEach(async () => {
      // Alice borrows at exactly the limit (close to liquidation threshold)
      await wdot.connect(alice).deposit({ value: DOT(100) });
      await wdot.connect(alice).approve(await vault.getAddress(), DOT(100));
      await vault.connect(alice).deposit(DOT(100));
      // $600 collateral, borrow $399 (just under max $400)
      await pool.connect(alice).borrow(USDC(399), 0, ZeroAddress);
    });

    it('position is healthy at $6 DOT price', async () => {
      const hf = await pool.getHealthFactor(alice.address);
      expect(hf).to.be.gte(parseUnits('1', 18));
    });

    it('position becomes liquidatable when DOT price drops', async () => {
      // Drop DOT price to $3 → collateral = $300, debt = $399 → unhealthy
      await oracle.setMockPrice(parseUnits('3', 18));
      const hf = await pool.getHealthFactor(alice.address);
      expect(hf).to.be.lt(parseUnits('1', 18));
    });

    it('bob liquidates and receives seized WDOT', async () => {
      await oracle.setMockPrice(parseUnits('3', 18)); // crash price
      const [,, totalDebt] = await pool.getRepaymentAmount(alice.address);

      // Bob needs USDC to liquidate (+ buffer for interest accrual between blocks)
      const buffer = USDC(1);
      await mockUsdc.mint(bob.address, totalDebt + buffer);
      await mockUsdc.connect(bob).approve(await pool.getAddress(), totalDebt + buffer);

      const bobWdotBefore = await wdot.balanceOf(bob.address);
      await pool.connect(bob).liquidate(alice.address);

      // Bob received seized WDOT
      expect(await wdot.balanceOf(bob.address)).to.be.gt(bobWdotBefore);
      // Alice's position is cleared
      const pos = await pool.positions(alice.address);
      expect(pos.isActive).to.equal(false);
    });

    it('reverts liquidation on healthy position', async () => {
      await expect(pool.connect(bob).liquidate(alice.address))
        .to.be.revertedWith('LP: position is healthy');
    });
  });

  describe('Health factor edge cases', () => {
    it('returns max uint256 for user with no position', async () => {
      expect(await pool.getHealthFactor(charlie.address)).to.equal(ethers.MaxUint256);
    });
  });
});
