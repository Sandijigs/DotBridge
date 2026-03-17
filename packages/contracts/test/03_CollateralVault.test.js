/**
 * TEST SUITE 3: CollateralVault.sol
 * Run: npx hardhat test test/03_CollateralVault.test.js
 *
 * Tests:
 *  1.  deposit() requires prior approve, updates _available, emits Deposited
 *  2.  deposit() reverts "Vault: zero deposit" on 0
 *  3.  withdraw() moves available back to wallet, emits Withdrawn
 *  4.  withdraw() reverts "Vault: insufficient available collateral" when > available
 *  5.  withdraw() cannot withdraw locked funds
 *  6.  lockCollateral() moves available → locked (invariant: sum stays same)
 *  7.  lockCollateral() reverts "Vault: insufficient available to lock" when > available
 *  8.  lockCollateral() reverts "Vault: caller is not LendingPool" when alice calls
 *  9.  releaseCollateral() moves locked → available
 * 10.  seizeCollateral() sends WDOT to recipient (not to mockLP)
 * 11.  seizeCollateral() reverts "Vault: zero recipient" on address(0)
 * 12.  All onlyLendingPool functions revert when alice calls them
 * 13.  INVARIANT: getTotalCollateral() == getAvailableCollateral() + getLockedCollateral()
 */
const { ethers } = require("hardhat");
const { expect } = require("chai");

const DOT = (n) => ethers.parseUnits(String(n), 10);

describe("CollateralVault", function () {
  let wdot, vault, owner, alice, bob, mockLP;

  beforeEach(async () => {
    [owner, alice, bob, mockLP] = await ethers.getSigners();

    // Deploy WDOT
    const WDOT = await ethers.getContractFactory("WDOT");
    wdot = await WDOT.deploy();
    await wdot.waitForDeployment();

    // Deploy CollateralVault
    const CollateralVault = await ethers.getContractFactory("CollateralVault");
    vault = await CollateralVault.deploy(owner.address, await wdot.getAddress());
    await vault.waitForDeployment();

    // Set mockLP as the lending pool
    await vault.setLendingPool(mockLP.address);

    // Give alice 100 WDOT
    await wdot.connect(alice).deposit({ value: DOT(100) });
    await wdot.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────
  it("1. deposit() requires prior approve, updates _available, emits Deposited", async () => {
    // Bob has no approval — should revert
    await wdot.connect(bob).deposit({ value: DOT(10) });
    await expect(
      vault.connect(bob).deposit(DOT(10))
    ).to.be.reverted; // SafeERC20 revert (no allowance)

    // Alice has approval — should succeed
    const tx = vault.connect(alice).deposit(DOT(20));
    await expect(tx)
      .to.emit(vault, "Deposited")
      .withArgs(alice.address, DOT(20));

    expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(20));
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it("2. deposit() reverts 'Vault: zero deposit' on 0", async () => {
    await expect(
      vault.connect(alice).deposit(0)
    ).to.be.revertedWith("Vault: zero deposit");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it("3. withdraw() moves available back to wallet, emits Withdrawn", async () => {
    await vault.connect(alice).deposit(DOT(30));

    const balBefore = await wdot.balanceOf(alice.address);
    const tx = vault.connect(alice).withdraw(DOT(10));
    await expect(tx)
      .to.emit(vault, "Withdrawn")
      .withArgs(alice.address, DOT(10));

    expect(await wdot.balanceOf(alice.address)).to.equal(balBefore + DOT(10));
    expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(20));
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it("4. withdraw() reverts 'Vault: insufficient available collateral' when > available", async () => {
    await vault.connect(alice).deposit(DOT(10));
    await expect(
      vault.connect(alice).withdraw(DOT(20))
    ).to.be.revertedWith("Vault: insufficient available collateral");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it("5. withdraw() cannot withdraw locked funds", async () => {
    await vault.connect(alice).deposit(DOT(20));
    // Lock all 20
    await vault.connect(mockLP).lockCollateral(alice.address, DOT(20));
    // Available is now 0, try to withdraw full amount
    await expect(
      vault.connect(alice).withdraw(DOT(20))
    ).to.be.revertedWith("Vault: insufficient available collateral");
    // Even 1 planck fails
    await expect(
      vault.connect(alice).withdraw(1)
    ).to.be.revertedWith("Vault: insufficient available collateral");
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it("6. lockCollateral() moves available → locked (invariant: sum stays same)", async () => {
    await vault.connect(alice).deposit(DOT(50));

    const totalBefore = await vault.getTotalCollateral(alice.address);
    await vault.connect(mockLP).lockCollateral(alice.address, DOT(30));

    expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(20));
    expect(await vault.getLockedCollateral(alice.address)).to.equal(DOT(30));
    expect(await vault.getTotalCollateral(alice.address)).to.equal(totalBefore);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────
  it("7. lockCollateral() reverts 'Vault: insufficient available to lock' when > available", async () => {
    await vault.connect(alice).deposit(DOT(10));
    await expect(
      vault.connect(mockLP).lockCollateral(alice.address, DOT(20))
    ).to.be.revertedWith("Vault: insufficient available to lock");
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────
  it("8. lockCollateral() reverts 'Vault: caller is not LendingPool' when alice calls", async () => {
    await vault.connect(alice).deposit(DOT(10));
    await expect(
      vault.connect(alice).lockCollateral(alice.address, DOT(10))
    ).to.be.revertedWith("Vault: caller is not LendingPool");
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────
  it("9. releaseCollateral() moves locked → available", async () => {
    await vault.connect(alice).deposit(DOT(40));
    await vault.connect(mockLP).lockCollateral(alice.address, DOT(40));

    expect(await vault.getAvailableCollateral(alice.address)).to.equal(0);
    expect(await vault.getLockedCollateral(alice.address)).to.equal(DOT(40));

    await vault.connect(mockLP).releaseCollateral(alice.address, DOT(25));

    expect(await vault.getAvailableCollateral(alice.address)).to.equal(DOT(25));
    expect(await vault.getLockedCollateral(alice.address)).to.equal(DOT(15));
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────
  it("10. seizeCollateral() sends WDOT to recipient (not to mockLP)", async () => {
    await vault.connect(alice).deposit(DOT(30));
    await vault.connect(mockLP).lockCollateral(alice.address, DOT(30));

    const bobBalBefore = await wdot.balanceOf(bob.address);
    await vault.connect(mockLP).seizeCollateral(alice.address, DOT(30), bob.address);

    // Bob (recipient) gets the WDOT, not mockLP
    expect(await wdot.balanceOf(bob.address)).to.equal(bobBalBefore + DOT(30));
    expect(await vault.getLockedCollateral(alice.address)).to.equal(0);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────
  it("11. seizeCollateral() reverts 'Vault: zero recipient' on address(0)", async () => {
    await vault.connect(alice).deposit(DOT(10));
    await vault.connect(mockLP).lockCollateral(alice.address, DOT(10));

    await expect(
      vault.connect(mockLP).seizeCollateral(alice.address, DOT(10), ethers.ZeroAddress)
    ).to.be.revertedWith("Vault: zero recipient");
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────
  it("12. All onlyLendingPool functions revert when alice calls them", async () => {
    await vault.connect(alice).deposit(DOT(20));
    await vault.connect(mockLP).lockCollateral(alice.address, DOT(10));

    await expect(
      vault.connect(alice).lockCollateral(alice.address, DOT(5))
    ).to.be.revertedWith("Vault: caller is not LendingPool");

    await expect(
      vault.connect(alice).releaseCollateral(alice.address, DOT(5))
    ).to.be.revertedWith("Vault: caller is not LendingPool");

    await expect(
      vault.connect(alice).seizeCollateral(alice.address, DOT(5), bob.address)
    ).to.be.revertedWith("Vault: caller is not LendingPool");
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────
  it("13. INVARIANT: getTotalCollateral() == getAvailableCollateral() + getLockedCollateral()", async () => {
    // After deposit
    await vault.connect(alice).deposit(DOT(50));
    expect(await vault.getTotalCollateral(alice.address)).to.equal(
      (await vault.getAvailableCollateral(alice.address)) +
        (await vault.getLockedCollateral(alice.address))
    );

    // After lock
    await vault.connect(mockLP).lockCollateral(alice.address, DOT(30));
    expect(await vault.getTotalCollateral(alice.address)).to.equal(
      (await vault.getAvailableCollateral(alice.address)) +
        (await vault.getLockedCollateral(alice.address))
    );

    // After partial release
    await vault.connect(mockLP).releaseCollateral(alice.address, DOT(10));
    expect(await vault.getTotalCollateral(alice.address)).to.equal(
      (await vault.getAvailableCollateral(alice.address)) +
        (await vault.getLockedCollateral(alice.address))
    );

    // After withdraw
    await vault.connect(alice).withdraw(DOT(15));
    expect(await vault.getTotalCollateral(alice.address)).to.equal(
      (await vault.getAvailableCollateral(alice.address)) +
        (await vault.getLockedCollateral(alice.address))
    );

    // After seize
    await vault.connect(mockLP).seizeCollateral(alice.address, DOT(20), bob.address);
    expect(await vault.getTotalCollateral(alice.address)).to.equal(
      (await vault.getAvailableCollateral(alice.address)) +
        (await vault.getLockedCollateral(alice.address))
    );
  });
});
