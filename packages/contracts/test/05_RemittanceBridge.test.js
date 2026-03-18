/**
 * TEST SUITE 5: RemittanceBridge.sol
 * Run: npx hardhat test test/05_RemittanceBridge.test.js
 *
 * Tests:
 *  1.  Mock mode: sendRemittance → recipient receives USDC locally in same tx
 *  2.  Mock mode: emits both RemittanceSent AND RemittanceCompleted
 *  3.  Mock mode: transfer stored with Completed status
 *  4.  Access: alice calling sendRemittance reverts "Bridge: caller is not LendingPool"
 *  5.  Reverts "Bridge: zero recipient" on address(0)
 *  6.  Reverts "Bridge: zero amount" on 0
 *  7.  Reverts "Bridge: zero chain ID" on 0
 *  8.  transferCount increments: two calls produce different transferIds
 *  9.  estimateFee() returns 0 in mock mode
 * 10.  recoverTokens(): owner can recover stuck tokens, non-owner reverts
 */
const { ethers } = require("hardhat");
const { expect } = require("chai");

const USDC = (n) => ethers.parseUnits(String(n), 6);

describe("RemittanceBridge", function () {
  let mockUsdc, bridge;
  let owner, mockLP, alice, bob;

  const BNB_CHAIN_ID = 56;

  beforeEach(async () => {
    [owner, mockLP, alice, bob] = await ethers.getSigners();

    // Deploy MockERC20 as USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUsdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockUsdc.waitForDeployment();

    // Deploy RemittanceBridge in mock mode (gateway = address(0))
    const RemittanceBridge = await ethers.getContractFactory("RemittanceBridge");
    bridge = await RemittanceBridge.deploy(
      owner.address,
      await mockUsdc.getAddress(),
      ethers.ZeroAddress
    );
    await bridge.waitForDeployment();

    // Wire: mockLP acts as LendingPool
    await bridge.setLendingPool(mockLP.address);

    // Seed mockLP with USDC and approve bridge
    await mockUsdc.mint(mockLP.address, USDC(100_000));
    await mockUsdc.connect(mockLP).approve(await bridge.getAddress(), ethers.MaxUint256);
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────
  it("1. Mock mode: sendRemittance transfers USDC to recipient locally", async () => {
    const beforeBob = await mockUsdc.balanceOf(bob.address);

    await bridge.connect(mockLP).sendRemittance(bob.address, USDC(100), BNB_CHAIN_ID);

    expect(await mockUsdc.balanceOf(bob.address)).to.equal(beforeBob + USDC(100));
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it("2. Mock mode: emits both RemittanceSent AND RemittanceCompleted", async () => {
    const tx = bridge.connect(mockLP).sendRemittance(bob.address, USDC(50), BNB_CHAIN_ID);

    await expect(tx).to.emit(bridge, "RemittanceSent");
    await expect(tx).to.emit(bridge, "RemittanceCompleted");
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it("3. Mock mode: transfer stored with Completed status", async () => {
    const tx = await bridge.connect(mockLP).sendRemittance(bob.address, USDC(200), BNB_CHAIN_ID);
    const receipt = await tx.wait();

    // Extract transferId from RemittanceSent event
    const parsed = receipt.logs
      .map(l => { try { return bridge.interface.parseLog(l); } catch { return null; } })
      .find(l => l && l.name === "RemittanceSent");

    expect(parsed).to.not.be.undefined;
    const transferId = parsed.args.transferId;

    const record = await bridge.getTransfer(transferId);
    expect(record.recipient).to.equal(bob.address);
    expect(record.usdcAmount).to.equal(USDC(200));
    expect(record.destChainId).to.equal(BNB_CHAIN_ID);
    // TransferStatus.Completed == 1
    expect(record.status).to.equal(1);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it("4. Access: alice calling sendRemittance reverts", async () => {
    await expect(
      bridge.connect(alice).sendRemittance(bob.address, USDC(100), BNB_CHAIN_ID)
    ).to.be.revertedWith("Bridge: caller is not LendingPool");
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it("5. Reverts 'Bridge: zero recipient' on address(0)", async () => {
    await expect(
      bridge.connect(mockLP).sendRemittance(ethers.ZeroAddress, USDC(100), BNB_CHAIN_ID)
    ).to.be.revertedWith("Bridge: zero recipient");
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it("6. Reverts 'Bridge: zero amount' on 0", async () => {
    await expect(
      bridge.connect(mockLP).sendRemittance(bob.address, 0, BNB_CHAIN_ID)
    ).to.be.revertedWith("Bridge: zero amount");
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────
  it("7. Reverts 'Bridge: zero chain ID' on 0", async () => {
    await expect(
      bridge.connect(mockLP).sendRemittance(bob.address, USDC(100), 0)
    ).to.be.revertedWith("Bridge: zero chain ID");
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────
  it("8. transferCount increments: two calls produce different transferIds", async () => {
    const tx1 = await bridge.connect(mockLP).sendRemittance(bob.address, USDC(10), BNB_CHAIN_ID);
    const tx2 = await bridge.connect(mockLP).sendRemittance(bob.address, USDC(10), BNB_CHAIN_ID);

    const receipt1 = await tx1.wait();
    const receipt2 = await tx2.wait();

    const getId = (receipt) => {
      const parsed = receipt.logs
        .map(l => { try { return bridge.interface.parseLog(l); } catch { return null; } })
        .find(l => l && l.name === "RemittanceSent");
      return parsed.args.transferId;
    };

    const id1 = getId(receipt1);
    const id2 = getId(receipt2);

    expect(id1).to.not.equal(id2);
    expect(await bridge.transferCount()).to.equal(2);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────
  it("9. estimateFee() returns 0 in mock mode", async () => {
    expect(await bridge.estimateFee(BNB_CHAIN_ID)).to.equal(0);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────
  it("10. recoverTokens(): owner can recover stuck tokens, non-owner reverts", async () => {
    // Send some USDC directly to bridge (simulating stuck tokens)
    await mockUsdc.mint(await bridge.getAddress(), USDC(500));

    const beforeOwner = await mockUsdc.balanceOf(owner.address);
    await bridge.recoverTokens(await mockUsdc.getAddress(), owner.address, USDC(500));
    expect(await mockUsdc.balanceOf(owner.address)).to.equal(beforeOwner + USDC(500));

    // Non-owner reverts
    await expect(
      bridge.connect(alice).recoverTokens(await mockUsdc.getAddress(), alice.address, USDC(1))
    ).to.be.reverted;
  });
});
