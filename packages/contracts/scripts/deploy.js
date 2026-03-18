/**
 * DotBridge — Master Deployment Script
 *
 * DEPLOYMENT ORDER (dependency chain must be respected):
 *   1.  WDOT             (no dependencies)
 *   2.  MockERC20/USDC   (testnet: MockERC20 + mint 1M to deployer)
 *   3.  PriceOracle      (deployer, $6 WAD)
 *   4.  CollateralVault  (deployer, WDOT address)
 *   5.  RemittanceBridge (deployer, USDC address, gateway=0x0)
 *   6.  LendingPool      (deployer, vault, oracle, USDC)
 *   7.  Wire: vault.setLendingPool, bridge.setLendingPool, pool.setBridge
 *   8.  Seed LendingPool with 500k USDC (testnet only)
 *   9.  Write deployments/<network>.json
 *  10.  Copy ABIs to packages/frontend/src/abis/
 *  11.  Write packages/frontend/src/abis/addresses.json
 *  12.  Print address summary table
 *
 * USAGE:
 *   npx hardhat run scripts/deploy.js --network westend
 *   npx hardhat run scripts/deploy.js --network localhost
 */

const { ethers } = require("hardhat");
const fs   = require("fs");
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
  const DOT_PRICE_WAD    = ethers.parseUnits("6", 18);        // $6.00 mock price (WAD)
  const USDC_SEED_AMOUNT = 500_000n * 1_000_000n;             // 500,000 USDC
  const HYPERBRIDGE_GATEWAY = process.env.HYPERBRIDGE_GATEWAY || ethers.ZeroAddress;
  const isLocal = network === "hardhat" || network === "localhost";

  // ─── Step 1: Deploy WDOT ─────────────────────────────────────────────────
  console.log("1. Deploying WDOT...");
  const WDOT = await ethers.getContractFactory("WDOT");
  const wdot = await WDOT.deploy();
  await wdot.waitForDeployment();
  const wdotAddress = await wdot.getAddress();
  console.log(`   ✓ WDOT: ${wdotAddress}`);

  // ─── Step 2: Deploy MockERC20 as USDC (testnet) or use precompile ────────
  let usdcAddress;
  let mockUsdcContract;
  if (isLocal || network === "westend" || network === "polkadotHubTestnet") {
    console.log("\n2. Deploying MockERC20 (USDC, 6 decimals)...");
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUsdcContract = await MockERC20.deploy("USD Coin", "USDC", 6);
    await mockUsdcContract.waitForDeployment();
    usdcAddress = await mockUsdcContract.getAddress();
    // Mint 1M USDC to deployer
    await mockUsdcContract.mint(deployer.address, 1_000_000n * 1_000_000n);
    console.log(`   ✓ MockUSDC: ${usdcAddress} (minted 1M to deployer)`);
  } else {
    usdcAddress = process.env.USDC_MAINNET_ADDRESS;
    if (!usdcAddress) throw new Error("USDC_MAINNET_ADDRESS not set in .env");
    console.log(`\n2. Using real USDC: ${usdcAddress}`);
  }

  // ─── Step 3: Deploy PriceOracle ──────────────────────────────────────────
  console.log("\n3. Deploying PriceOracle...");
  const PriceOracle = await ethers.getContractFactory("PriceOracle");
  const oracle = await PriceOracle.deploy(deployer.address, DOT_PRICE_WAD);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`   ✓ PriceOracle: ${oracleAddress} (mock $6.00 WAD)`);

  // ─── Step 4: Deploy CollateralVault ──────────────────────────────────────
  console.log("\n4. Deploying CollateralVault...");
  const CollateralVault = await ethers.getContractFactory("CollateralVault");
  const vault = await CollateralVault.deploy(deployer.address, wdotAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`   ✓ CollateralVault: ${vaultAddress}`);

  // ─── Step 5: Deploy RemittanceBridge ─────────────────────────────────────
  console.log("\n5. Deploying RemittanceBridge...");
  if (HYPERBRIDGE_GATEWAY === ethers.ZeroAddress) {
    console.log("   ⚠  Gateway = address(0) → MOCK MODE");
  }
  const RemittanceBridge = await ethers.getContractFactory("RemittanceBridge");
  const bridge = await RemittanceBridge.deploy(deployer.address, usdcAddress, HYPERBRIDGE_GATEWAY);
  await bridge.waitForDeployment();
  const bridgeAddress = await bridge.getAddress();
  console.log(`   ✓ RemittanceBridge: ${bridgeAddress}`);

  // ─── Step 6: Deploy LendingPool ──────────────────────────────────────────
  console.log("\n6. Deploying LendingPool...");
  const LendingPool = await ethers.getContractFactory("LendingPool");
  const pool = await LendingPool.deploy(deployer.address, vaultAddress, oracleAddress, usdcAddress);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`   ✓ LendingPool: ${poolAddress}`);

  // ─── Step 7: Wire contracts together ─────────────────────────────────────
  console.log("\n7. Wiring contracts...");
  const tx1 = await vault.setLendingPool(poolAddress);
  await tx1.wait();
  console.log("   ✓ vault.setLendingPool()");

  const tx2 = await bridge.setLendingPool(poolAddress);
  await tx2.wait();
  console.log("   ✓ bridge.setLendingPool()");

  const tx3 = await pool.setBridge(bridgeAddress);
  await tx3.wait();
  console.log("   ✓ pool.setBridge()");

  // ─── Step 8: Seed LendingPool with USDC (testnet only) ──────────────────
  if (mockUsdcContract) {
    console.log("\n8. Seeding LendingPool with USDC liquidity...");
    const seedTx = await mockUsdcContract.mint(poolAddress, USDC_SEED_AMOUNT);
    await seedTx.wait();
    console.log(`   ✓ Minted ${Number(USDC_SEED_AMOUNT) / 1e6} USDC into LendingPool`);
  }

  // ─── Step 9: Write deployments/<network>.json ────────────────────────────
  const contracts = {
    WDOT:             wdotAddress,
    MockUSDC:         usdcAddress,
    PriceOracle:      oracleAddress,
    CollateralVault:  vaultAddress,
    RemittanceBridge: bridgeAddress,
    LendingPool:      poolAddress,
  };

  const deployments = {
    network,
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts,
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });
  const deployPath = path.join(deploymentsDir, `${network}.json`);
  fs.writeFileSync(deployPath, JSON.stringify(deployments, null, 2));
  console.log(`\n9. Saved deployments/${network}.json`);

  // ─── Step 10: Copy ABIs to packages/frontend/src/abis/ ──────────────────
  const abisDir = path.join(__dirname, "../../frontend/src/abis");
  if (!fs.existsSync(abisDir)) fs.mkdirSync(abisDir, { recursive: true });

  const abiMap = {
    WDOT:             "WDOT",
    CollateralVault:  "CollateralVault",
    LendingPool:      "LendingPool",
    RemittanceBridge: "RemittanceBridge",
    PriceOracle:      "PriceOracle",
    MockERC20:        "MockERC20",
  };

  console.log("\n10. Copying ABIs to frontend...");
  for (const [name, contractName] of Object.entries(abiMap)) {
    let artifactPath;
    // Check different artifact locations
    const candidates = [
      path.join(__dirname, `../artifacts/contracts/${contractName}.sol/${contractName}.json`),
      path.join(__dirname, `../artifacts/contracts/mocks/${contractName}.sol/${contractName}.json`),
      path.join(__dirname, `../artifacts/contracts/test/${contractName}.sol/${contractName}.json`),
    ];

    artifactPath = candidates.find(p => fs.existsSync(p));

    if (artifactPath) {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      fs.writeFileSync(
        path.join(abisDir, `${name}.json`),
        JSON.stringify({ abi: artifact.abi }, null, 2)
      );
      console.log(`   ✓ ${name}.json`);
    } else {
      console.log(`   ⚠ ${contractName} artifact not found — skipping`);
    }
  }

  // ─── Step 11: Write addresses.json ───────────────────────────────────────
  const addressesPath = path.join(abisDir, "addresses.json");
  let addresses = {};
  if (fs.existsSync(addressesPath)) {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
  }
  addresses[network] = contracts;
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log(`\n11. Wrote addresses.json (network: ${network})`);

  // ─── Step 12: Print address summary table ────────────────────────────────
  console.log("\n══════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE");
  console.log("══════════════════════════════════════════");
  console.log("");
  console.log("  Contract           Address");
  console.log("  ─────────────────  ──────────────────────────────────────────");
  for (const [name, addr] of Object.entries(contracts)) {
    console.log(`  ${name.padEnd(19)} ${addr}`);
  }
  console.log("");
  console.log(`  Deployment saved:  deployments/${network}.json`);
  console.log(`  ABIs written to:   packages/frontend/src/abis/`);
  console.log(`  Addresses file:    packages/frontend/src/abis/addresses.json`);
  console.log("");

  return deployments;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
