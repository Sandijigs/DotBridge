/**
 * TEST SUITE 2: DecimalLib + PriceOracle
 * Run: npx hardhat test test/02_PriceOracle.test.js
 *
 * Tests:
 *  1. starts in mock mode, returns constructor price
 *  2. getDotPriceWad() returns 6e18 exactly at $6
 *  3. setMockPrice() only callable by owner, reverts on 0
 *  4. getWdotValueInUsd(DOT(10)) == parseUnits("60", 18) at $6 price
 *  5. getWdotValueInUsd(DOT(100)) == parseUnits("1000", 18) at $10 price
 *  6. setMode(false) + zero chainlinkFeed → getDotPriceWad() reverts "PriceOracle: feed not set"
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits } = ethers;

const DOT = (n) => parseUnits(String(n), 10);

describe("PriceOracle", function () {
  let oracle, owner, alice;

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();
    const PriceOracle = await ethers.getContractFactory("PriceOracle");
    // Deploy with $6.00 initial mock price (WAD)
    oracle = await PriceOracle.deploy(owner.address, parseUnits("6", 18));
    await oracle.waitForDeployment();
  });

  // ── Test 1 ──────────────────────────────────────────────────────────────
  it("1. starts in mock mode, returns constructor price", async () => {
    expect(await oracle.useMock()).to.equal(true);
    expect(await oracle.mockPriceUsd()).to.equal(parseUnits("6", 18));
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────
  it("2. getDotPriceWad() returns 6e18 exactly at $6", async () => {
    const price = await oracle.getDotPriceWad();
    expect(price).to.equal(parseUnits("6", 18));
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it("3. setMockPrice() only callable by owner, reverts on 0", async () => {
    // Non-owner reverts
    await expect(
      oracle.connect(alice).setMockPrice(parseUnits("8", 18))
    ).to.be.reverted;

    // Zero price reverts
    await expect(oracle.setMockPrice(0)).to.be.revertedWith(
      "PriceOracle: price must be positive"
    );

    // Owner can set valid price
    await oracle.setMockPrice(parseUnits("8", 18));
    expect(await oracle.getDotPriceWad()).to.equal(parseUnits("8", 18));
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────
  it("4. getWdotValueInUsd(DOT(10)) == $60 at $6 price", async () => {
    // 10 DOT at $6 each = $60 in WAD
    const value = await oracle.getWdotValueInUsd(DOT(10));
    expect(value).to.equal(parseUnits("60", 18));
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it("5. getWdotValueInUsd(DOT(100)) == $1000 at $10 price", async () => {
    await oracle.setMockPrice(parseUnits("10", 18));
    const value = await oracle.getWdotValueInUsd(DOT(100));
    expect(value).to.equal(parseUnits("1000", 18));
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it("6. setMode(false) + no chainlinkFeed → reverts 'PriceOracle: feed not set'", async () => {
    await oracle.setMode(false);
    await expect(oracle.getDotPriceWad()).to.be.revertedWith(
      "PriceOracle: feed not set"
    );
  });
});
