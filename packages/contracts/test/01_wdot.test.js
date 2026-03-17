/**
 * TEST SUITE 1: WDOT.sol
 * Run: npx hardhat test test/01_wdot.test.js
 *
 * Covers:
 *  1. decimals() returns exactly 10
 *  2. deposit() mints WDOT 1:1, totalSupply() == address(this).balance
 *  3. deposit() emits Deposit AND Transfer(address(0) -> sender)
 *  4. deposit() reverts "WDOT: zero deposit" on msg.value == 0
 *  5. receive() fallback: plain send mints WDOT
 *  6. withdraw() returns native DOT, burns WDOT
 *  7. withdraw() reverts "WDOT: insufficient balance" when wad > balance
 *  8. withdraw() emits Withdrawal AND Transfer(sender -> address(0))
 *  9. transfer() moves WDOT, reverts on insufficient balance
 * 10. approve() + transferFrom(): allowance decrements, MaxUint256 does not
 */
const { ethers } = require("hardhat");
const { expect } = require("chai");

const DOT = (n) => ethers.parseUnits(String(n), 10);

describe("WDOT", function () {
  let wdot, owner, alice, bob;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const WDOT = await ethers.getContractFactory("WDOT");
    wdot = await WDOT.deploy();
    await wdot.waitForDeployment();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────
  it("1. decimals() returns exactly 10", async () => {
    const d = await wdot.decimals();
    expect(d).to.equal(10);
    // strict identity — not just truthy
    expect(Number(d)).to.equal(10);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it("2. deposit() mints WDOT 1:1, totalSupply() == contract balance", async () => {
    await wdot.connect(alice).deposit({ value: DOT(5) });
    expect(await wdot.balanceOf(alice.address)).to.equal(DOT(5));

    const contractAddr = await wdot.getAddress();
    const contractBalance = await ethers.provider.getBalance(contractAddr);
    expect(await wdot.totalSupply()).to.equal(contractBalance);
    expect(await wdot.totalSupply()).to.equal(DOT(5));
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it("3. deposit() emits Deposit AND Transfer(address(0) -> sender)", async () => {
    const tx = wdot.connect(alice).deposit({ value: DOT(1) });
    await expect(tx)
      .to.emit(wdot, "Deposit")
      .withArgs(alice.address, DOT(1));
    await expect(tx)
      .to.emit(wdot, "Transfer")
      .withArgs(ethers.ZeroAddress, alice.address, DOT(1));
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it("4. deposit() reverts 'WDOT: zero deposit' on msg.value == 0", async () => {
    await expect(
      wdot.connect(alice).deposit({ value: 0 })
    ).to.be.revertedWith("WDOT: zero deposit");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it("5. receive() fallback: plain ETH send mints WDOT", async () => {
    const contractAddr = await wdot.getAddress();
    await alice.sendTransaction({ to: contractAddr, value: DOT(3) });
    expect(await wdot.balanceOf(alice.address)).to.equal(DOT(3));
    expect(await wdot.totalSupply()).to.equal(DOT(3));
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it("6. withdraw() returns native DOT, burns WDOT", async () => {
    await wdot.connect(alice).deposit({ value: DOT(2) });

    const balBefore = await ethers.provider.getBalance(alice.address);
    const tx = await wdot.connect(alice).withdraw(DOT(2));
    const receipt = await tx.wait();
    const gasCost = receipt.gasUsed * tx.gasPrice;
    const balAfter = await ethers.provider.getBalance(alice.address);

    // alice got DOT back minus gas
    expect(balAfter + gasCost).to.be.closeTo(balBefore + DOT(2), DOT("0.01"));
    // WDOT balance is 0
    expect(await wdot.balanceOf(alice.address)).to.equal(0);
    // totalSupply back to 0
    expect(await wdot.totalSupply()).to.equal(0);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────
  it("7. withdraw() reverts 'WDOT: insufficient balance' when wad > balance", async () => {
    await wdot.connect(alice).deposit({ value: DOT(1) });
    await expect(
      wdot.connect(alice).withdraw(DOT(2))
    ).to.be.revertedWith("WDOT: insufficient balance");
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────
  it("8. withdraw() emits Withdrawal AND Transfer(sender -> address(0))", async () => {
    await wdot.connect(alice).deposit({ value: DOT(1) });
    const tx = wdot.connect(alice).withdraw(DOT(1));
    await expect(tx)
      .to.emit(wdot, "Withdrawal")
      .withArgs(alice.address, DOT(1));
    await expect(tx)
      .to.emit(wdot, "Transfer")
      .withArgs(alice.address, ethers.ZeroAddress, DOT(1));
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────
  it("9. transfer() moves WDOT, reverts on insufficient balance", async () => {
    await wdot.connect(alice).deposit({ value: DOT(5) });

    // successful transfer
    await wdot.connect(alice).transfer(bob.address, DOT(3));
    expect(await wdot.balanceOf(alice.address)).to.equal(DOT(2));
    expect(await wdot.balanceOf(bob.address)).to.equal(DOT(3));

    // revert: alice only has 2 DOT left, tries to send 5
    await expect(
      wdot.connect(alice).transfer(bob.address, DOT(5))
    ).to.be.revertedWith("WDOT: insufficient balance");
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────
  it("10. approve() + transferFrom(): allowance decrements; MaxUint256 does not", async () => {
    await wdot.connect(alice).deposit({ value: DOT(10) });

    // --- Normal allowance: decrements ---
    await wdot.connect(alice).approve(bob.address, DOT(4));
    expect(await wdot.allowance(alice.address, bob.address)).to.equal(DOT(4));

    await wdot.connect(bob).transferFrom(alice.address, bob.address, DOT(1));
    expect(await wdot.allowance(alice.address, bob.address)).to.equal(DOT(3));

    // --- Insufficient allowance reverts ---
    await expect(
      wdot.connect(bob).transferFrom(alice.address, bob.address, DOT(5))
    ).to.be.revertedWith("WDOT: insufficient allowance");

    // --- MaxUint256 allowance: does NOT decrement ---
    await wdot.connect(alice).approve(bob.address, ethers.MaxUint256);
    expect(await wdot.allowance(alice.address, bob.address)).to.equal(ethers.MaxUint256);

    await wdot.connect(bob).transferFrom(alice.address, bob.address, DOT(2));
    // allowance must still be MaxUint256
    expect(await wdot.allowance(alice.address, bob.address)).to.equal(ethers.MaxUint256);
  });
});
