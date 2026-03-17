/**
 * DotBridge — Master Deployment Script
 *
 * DEPLOYMENT ORDER (dependency chain must be respected):
 *   1. MockUSDC         (or use real USDC address on mainnet)
 *   2. WDOT             (no dependencies)
 *   3. PriceOracle      (no dependencies)
 *   4. CollateralVault  (needs: WDOT address)
 *   5. RemittanceBridge (needs: USDC, Hyperbridge gateway)
 *   6. LendingPool      (needs: USDC, CollateralVault, PriceOracle)
 *   7. setLendingPool() on CollateralVault
 *   8. setLendingPool() on RemittanceBridge
 *   9. setBridge()      on LendingPool
 *  10. Seed LendingPool with USDC liquidity
 *
 * USAGE:
 *   npx hardhat run scripts/deploy.js --network westend
 *   npx hardhat run scripts/deploy.js --network localhost
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = hre.network.name;

  console.log("\n══════════════════════════════════════════");
  console.log("  DotBridge Deployment");
  console.log(`  Network:  ${network}`);
  console.log(`  Deployer: ${deployer.address}`);
  console.log("══════════════════════════════════════════\n");

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`  Deployer balance: ${ethers.formatUnits(balance, 10)} DOT\n`);

  // ─── Config ───────────────────────────────────────────────────────────────
  const DOT_PRICE_WAD = ethers.parseUnits("6", 18); // $6.00 mock price (WAD)
  const USDC_SEED_AMOUNT   = 100_000n * 1_000_000n; // 100,000 USDC to seed pool

  // Hyperbridge gateway: set to zero for mock mode (safe for testnet)
  // Update from .env once Hyperbridge Westend address is confirmed
  const HYPERBRIDGE_GATEWAY = process.env.HYPERBRIDGE_GATEWAY_WESTEND || ethers.ZeroAddress;

  const isLocal = network === "hardhat" || network === "localhost";

  // ─── Step 1: MockUSDC (local/testnet only) ────────────────────────────────
  let usdcAddress;
  if (isLocal || network === "westend") {
    console.log("1. Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    console.log(`   ✓ MockUSDC: ${usdcAddress}`);
  } else {
    // mainnet: use real USDC precompile address
    usdcAddress = process.env.USDC_MAINNET_ADDRESS;
    require(usdcAddress, "USDC_MAINNET_ADDRESS not set in .env");
    console.log(`1. Using real USDC: ${usdcAddress}`);
  }

  // ─── Step 2: WDOT ─────────────────────────────────────────────────────────
  console.log("\n2. Deploying WDOT...");
  const WDOT = await ethers.getContractFactory("WDOT");
  const wdot = await WDOT.deploy();
  await wdot.waitForDeployment();
  const wdotAddress = await wdot.getAddress();
  console.log(`   ✓ WDOT: ${wdotAddress}`);

  // ─── Step 3: PriceOracle ──────────────────────────────────────────────────
  console.log("\n3. Deploying PriceOracle...");
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await PriceOracle.deploy(deployer.address, DOT_PRICE_WAD);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`   ✓ PriceOracle: ${oracleAddress} (mock $6.00 WAD)`);

  // ─── Step 4: CollateralVault ──────────────────────────────────────────────
  console.log("\n4. Deploying CollateralVault...");
  const CollateralVault = await ethers.getContractFactory("CollateralVault");
  const vault = await CollateralVault.deploy(deployer.address, wdotAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`   ✓ CollateralVault: ${vaultAddress}`);

  // ─── Step 5: RemittanceBridge ─────────────────────────────────────────────
  console.log("\n5. Deploying RemittanceBridge...");
  if (HYPERBRIDGE_GATEWAY === ethers.ZeroAddress) {
    console.log("   ⚠  Hyperbridge gateway not set — deploying in MOCK MODE");
  }
  const RemittanceBridge = await ethers.getContractFactory("RemittanceBridge");
  const bridge = await RemittanceBridge.deploy(deployer.address, usdcAddress, HYPERBRIDGE_GATEWAY);
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log(`   ✓ RemittanceBridge: ${bridgeAddress} (mockMode: ${HYPERBRIDGE_GATEWAY === ethers.ZeroAddress})`);

  // ─── Step 6: LendingPool ──────────────────────────────────────────────────
  console.log("\n6. Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const pool = await LendingPool.deploy(deployer.address, vaultAddress, oracleAddress, usdcAddress);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`   ✓ LendingPool: ${poolAddress}`);

  // ─── Step 7–9: Wire contracts together ────────────────────────────────────
  console.log("\n7. Wiring contracts...");

  const tx1 = await vault.setLendingPool(poolAddress);
  await tx1.wait();
  console.log("   ✓ CollateralVault.setLendingPool()");

  const tx2 = await bridge.setLendingPool(poolAddress);
  await tx2.wait();
  console.log("   ✓ RemittanceBridge.setLendingPool()");

  const tx3 = await pool.setBridge(bridgeAddress);
  await tx3.wait();
  console.log("   ✓ LendingPool.setBridge()");

  // ─── Step 10: Seed LendingPool with USDC ──────────────────────────────────
  if (isLocal || network === "westend") {
    console.log("\n8. Seeding LendingPool with USDC liquidity...");
    const MockUSDC = await ethers.getContractAt("MockUSDC", usdcAddress);
    const seedTx = await MockUSDC.transfer(poolAddress, USDC_SEED_AMOUNT);
    await seedTx.wait();
    console.log(`   ✓ Seeded ${Number(USDC_SEED_AMOUNT) / 1e6} USDC into LendingPool`);
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  const deployments = {
    network,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      USDC:             usdcAddress,
      WDOT:             wdotAddress,
      PriceOracle:      oracleAddress,
      CollateralVault:  vaultAddress,
      RemittanceBridge: bridgeAddress,
      LendingPool:      poolAddress,
    }
  };

  console.log("\n══════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("══════════════════════════════════════════");
  console.log(JSON.stringify(deployments.contracts, null, 2));

  // Save to file
  const outPath = path.join(__dirname, `../deployments/${network}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deployments, null, 2));
  console.log(`\n  Saved to: deployments/${network}.json`);
  console.log("\n  Next steps:");
  console.log("  1. Copy addresses to packages/frontend/src/config/contracts.js");
  console.log("  2. Update .env with deployed addresses");
  console.log("  3. Run: npx hardhat test --network westend\n");

  return deployments;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
