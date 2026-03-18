/**
 * TEST SUITE 6 — Full End-to-End Integration Test
 * Tests the complete DotBridge user journey.
 * Run: npx hardhat test test/06_Integration.test.js
 *
 * Flow:
 *  1-2. Wrap DOT → WDOT → deposit as collateral
 *  3.   Borrow USDC locally (no bridge)
 *  4.   Borrow + remit via mock bridge
 *  5.   Repay with interest
 *  6.   Liquidation after price crash
 *  7.   Invariants + edge cases
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

    // 1. Deploy WDOT
    const WDOT = await ethers.getContractFactory('WDOT');
    wdot = await WDOT.deploy();

    // 2. Deploy MockERC20 as USDC (6 decimals)
    const MockERC20 = await ethers.getContractFactory('MockERC20');
    mockUsdc = await MockERC20.deploy('USD Coin', 'USDC', 6);

    // 3. Deploy PriceOracle at $6 DOT
    const PriceOracle = await ethers.getContractFactory('PriceOracle');
    oracle = await PriceOracle.deploy(owner.address, parseUnits('6', 18));

    // 4. Deploy CollateralVault
    const CollateralVault = await ethers.getContractFactory('CollateralVault');
    vault = await CollateralVault.deploy(owner.address, await wdot.getAddress());

    // 5. Deploy RemittanceBridge (mock mode — gateway = ZeroAddress)
    const RemittanceBridge = await ethers.getContractFactory('RemittanceBridge');
    bridge = await RemittanceBridge.deploy(owner.address, await mockUsdc.getAddress(), ZeroAddress);

    // 6. Deploy LendingPool
    const LendingPool = await ethers.getContractFactory('LendingPool');
    pool = await LendingPool.deploy(
      owner.address,
      await vault.getAddress(),
      await oracle.getAddress(),
      await mockUsdc.getAddress()
    );

    // Wait for all deployments
    await wdot.waitForDeployment();
    await mockUsdc.waitForDeployment();
    await oracle.waitForDeployment();
    await vault.waitForDeployment();
    await bridge.waitForDeployment();
    await pool.waitForDeployment();

    // 7-9. Wire contracts
    await vault.setLendingPool(await pool.getAddress());
    await bridge.setLendingPool(await pool.getAddress());
    await pool.setBridge(await bridge.getAddress());

    // 10. Seed pool with USDC liquidity
    await mockUsdc.mint(await pool.getAddress(), USDC(500_000));

    // 11. Seed bridge with USDC for mock mode remittances
    await mockUsdc.mint(await bridge.getAddress(), USDC(500_000));
  });

  // ── Helper: wrap + deposit for a signer ─────────────────────────────────
  async function wrapAndDeposit(signer, dotAmount) {
    await wdot.connect(signer).deposit({ value: dotAmount });
    await wdot.connect(signer).approve(await vault.getAddress(), dotAmount);
    await vault.connect(signer).deposit(dotAmount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  describe('Step 1-2: Wrap + Deposit', () => {
    it('alice wraps 100 DOT and deposits as collateral', async () => {
      await wdot.connect(alice).deposit({ value: DOT(100) });
      expect(await wdot.balanceOf(alice.address)).to.equal(DOT(100));

      await wdot.connect(alice).approve(await vault.getAddress(), DOT(100));
      await vault.connect(alice).deposit(DOT(100));

      expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(100));
      expect(await vault.getLockedCollateral(alice.address)).to.equal(0n);

      // INVARIANT: available + locked == total
      const avail  = await vault.getAvailableCollateral(alice.address);
      const locked = await vault.getLockedCollateral(alice.address);
      expect(await vault.getTotalCollateral(alice.address)).to.equal(avail + locked);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('Step 3: Borrow local', () => {
    beforeEach(async () => {
      await wrapAndDeposit(alice, DOT(100));
    });

    it('borrows $300 USDC at 150% ratio', async () => {
      // 100 DOT × $6 = $600 collateral → max borrow = $400
      await pool.connect(alice).borrow(USDC(300), 0, ZeroAddress);

      expect(await mockUsdc.balanceOf(alice.address)).to.equal(USDC(300));
      const pos = await pool.positions(alice.address);
      expect(pos.isActive).to.equal(true);
      expect(pos.debtUsdc).to.equal(USDC(300));
      expect(await vault.getLockedCollateral(alice.address)).to.equal(DOT(100));
    });

    it('reverts when borrowing over ratio', async () => {
      // $600 / 1.5 = $400 max → $401 should revert
      await expect(pool.connect(alice).borrow(USDC(401), 0, ZeroAddress))
        .to.be.revertedWith('LP: insufficient collateral for this borrow');
    });

    it('reverts on second borrow attempt', async () => {
      await pool.connect(alice).borrow(USDC(100), 0, ZeroAddress);
      await expect(pool.connect(alice).borrow(USDC(100), 0, ZeroAddress))
        .to.be.revertedWith('LP: position already active');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('Step 4: Borrow + Remit (mock bridge)', () => {
    beforeEach(async () => {
      await wrapAndDeposit(alice, DOT(100));
    });

    it('bob receives USDC via bridge in mock mode', async () => {
      const bobBefore = await mockUsdc.balanceOf(bob.address);
      await pool.connect(alice).borrow(USDC(200), 56, bob.address);
      expect(await mockUsdc.balanceOf(bob.address)).to.equal(bobBefore + USDC(200));
    });

    it('emits RemittanceSent from bridge', async () => {
      await expect(pool.connect(alice).borrow(USDC(200), 56, bob.address))
        .to.emit(bridge, 'RemittanceSent');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('Step 5: Repay', () => {
    beforeEach(async () => {
      await wrapAndDeposit(alice, DOT(100));
      await pool.connect(alice).borrow(USDC(300), 0, ZeroAddress);
    });

    it('repays and releases full collateral', async () => {
      const [principal, interest, total] = await pool.getRepaymentAmount(alice.address);
      expect(principal).to.equal(USDC(300));

      // Give Alice enough USDC to repay (+ buffer for interest accrual between blocks)
      const buffer = USDC(1);
      await mockUsdc.mint(alice.address, interest + buffer);
      await mockUsdc.connect(alice).approve(await pool.getAddress(), total + buffer);
      await pool.connect(alice).repay();

      expect((await pool.positions(alice.address)).isActive).to.equal(false);
      expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(100));
      expect(await vault.getLockedCollateral(alice.address)).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('Step 6: Liquidation', () => {
    beforeEach(async () => {
      await wrapAndDeposit(alice, DOT(100));
      // $600 collateral, borrow $399 (just under max $400)
      await pool.connect(alice).borrow(USDC(399), 0, ZeroAddress);
    });

    it('position healthy at $6 price', async () => {
      expect(await pool.getHealthFactor(alice.address)).to.be.gte(WAD);
    });

    it('position liquidatable after price crash to $3', async () => {
      await oracle.setMockPrice(parseUnits('3', 18));
      expect(await pool.getHealthFactor(alice.address)).to.be.lt(WAD);
    });

    it('bob liquidates and receives seized WDOT', async () => {
      await oracle.setMockPrice(parseUnits('3', 18));
      const [,, totalDebt] = await pool.getRepaymentAmount(alice.address);

      // Buffer for interest accrual between read and liquidate tx
      const buffer = USDC(1);
      await mockUsdc.mint(bob.address, totalDebt + buffer);
      await mockUsdc.connect(bob).approve(await pool.getAddress(), totalDebt + buffer);

      const bobWdotBefore = await wdot.balanceOf(bob.address);
      await pool.connect(bob).liquidate(alice.address);

      expect(await wdot.balanceOf(bob.address)).to.be.gt(bobWdotBefore);
      expect((await pool.positions(alice.address)).isActive).to.equal(false);
    });

    it('reverts liquidating healthy position', async () => {
      await expect(pool.connect(bob).liquidate(alice.address))
        .to.be.revertedWith('LP: position is healthy');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  describe('Invariants + Edge Cases', () => {
    it('collateral invariant: available + locked == total at all stages', async () => {
      const check = async () => {
        const a = await vault.getAvailableCollateral(alice.address);
        const l = await vault.getLockedCollateral(alice.address);
        const t = await vault.getTotalCollateral(alice.address);
        expect(a + l).to.equal(t);
      };

      // Stage 1: after deposit
      await wdot.connect(alice).deposit({ value: DOT(100) });
      await wdot.connect(alice).approve(await vault.getAddress(), DOT(100));
      await vault.connect(alice).deposit(DOT(100));
      await check();

      // Stage 2: after borrow (collateral locked)
      await pool.connect(alice).borrow(USDC(200), 0, ZeroAddress);
      await check();

      // Stage 3: after repay (collateral released)
      const [,, total] = await pool.getRepaymentAmount(alice.address);
      const buffer = USDC(1);
      await mockUsdc.mint(alice.address, total + buffer);
      await mockUsdc.connect(alice).approve(await pool.getAddress(), total + buffer);
      await pool.connect(alice).repay();
      await check();
    });

    it('getHealthFactor returns MaxUint256 for user with no position', async () => {
      expect(await pool.getHealthFactor(charlie.address)).to.equal(ethers.MaxUint256);
    });
  });
});
