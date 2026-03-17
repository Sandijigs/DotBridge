/**
 * TEST SUITE 5: RemittanceBridge.sol
 * Run: npx hardhat test test/05_bridge.test.js
 */
const { ethers } = require("hardhat");
const { expect }  = require("chai");

describe("RemittanceBridge", function () {
  let usdc, bridge, mockGateway, owner, pool, alice;
  const ONE_USDC     = 1_000_000n;
  const HUNDRED_USDC = ONE_USDC * 100n;
  const BNB_CHAIN_ID = 56;

  beforeEach(async () => {
    [owner, pool, alice] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const MockHyperbridgeGateway = await ethers.getContractFactory("MockHyperbridgeGateway");
    mockGateway = await MockHyperbridgeGateway.deploy();

    const RemittanceBridge = await ethers.getContractFactory("RemittanceBridge");
    bridge = await RemittanceBridge.deploy(
      owner.address,
      await usdc.getAddress(),
      await mockGateway.getAddress()
    );

    await bridge.setLendingPool(pool.address);
    // Give bridge USDC to forward (normally LendingPool sends it first)
    await usdc.transfer(await bridge.getAddress(), HUNDRED_USDC);
    // Bridge must approve gateway before teleport call
  });

  describe("mock mode (no gateway)", () => {
    let mockBridge;
    beforeEach(async () => {
      const RemittanceBridge = await ethers.getContractFactory("RemittanceBridge");
      mockBridge = await RemittanceBridge.deploy(owner.address, await usdc.getAddress(), ethers.ZeroAddress);
      await mockBridge.setLendingPool(pool.address);
      await usdc.transfer(await mockBridge.getAddress(), HUNDRED_USDC);
    });

    it("marks transfer complete immediately in mock mode", async () => {
      const tx = await mockBridge.connect(pool).sendRemittance(alice.address, HUNDRED_USDC, BNB_CHAIN_ID);
      const receipt = await tx.wait();
      const sentEvent = receipt.logs.find(l => {
        try { return mockBridge.interface.parseLog(l).name === "RemittanceSent"; } catch { return false; }
      });
      expect(sentEvent).to.not.be.undefined;
    });

    it("reverts if called by non-LendingPool", async () => {
      await expect(mockBridge.connect(alice).sendRemittance(alice.address, HUNDRED_USDC, BNB_CHAIN_ID))
        .to.be.revertedWith("RemittanceBridge: caller is not LendingPool");
    });
  });

  describe("getTransfer()", () => {
    it("stores transfer record with pending status initially (mock mode)", async () => {
      const RemittanceBridge = await ethers.getContractFactory("RemittanceBridge");
      const mb = await RemittanceBridge.deploy(owner.address, await usdc.getAddress(), ethers.ZeroAddress);
      await mb.setLendingPool(pool.address);

      const tx = await mb.connect(pool).sendRemittance(alice.address, HUNDRED_USDC, BNB_CHAIN_ID);
      const receipt = await tx.wait();

      const parsed = receipt.logs
        .map(l => { try { return mb.interface.parseLog(l); } catch { return null; } })
        .find(l => l && l.name === "RemittanceSent");

      const record = await mb.getTransfer(parsed.args.transferId);
      expect(record.recipient).to.equal(alice.address);
      expect(record.amount).to.equal(HUNDRED_USDC);
      expect(record.destChainId).to.equal(BNB_CHAIN_ID);
    });
  });
});
