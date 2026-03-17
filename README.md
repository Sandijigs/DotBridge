# DotBridge 🌉

> Borrow stablecoins against your DOT. Send them anywhere, instantly.

## What It Does

DotBridge is a DeFi + remittance protocol on Polkadot Hub (EVM track):

1. **Wrap** native DOT → WDOT (ERC-20)
2. **Deposit** WDOT as collateral
3. **Borrow** USDC at 150% collateral ratio
4. **Remit** borrowed USDC cross-chain to any recipient via Hyperbridge

## Architecture

```
User
 ├── WDOT.sol              Wrap/unwrap native DOT (fills ecosystem gap #1447)
 ├── CollateralVault.sol   Holds WDOT collateral, tracks available vs locked
 ├── LendingPool.sol       Core: borrow, repay, liquidate, health factor
 ├── RemittanceBridge.sol  Hyperbridge wrapper for cross-chain USDC sends
 └── PriceOracle.sol       DOT/USD price feed (mock on testnet, Chainlink on mainnet)
```

## Quick Start

```bash
# Install dependencies
yarn install

# Run all test gates
cd packages/contracts
npx hardhat test

# Deploy to Polkadot Hub Testnet
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY
npx hardhat run scripts/deploy.js --network polkadotHubTestnet

# Start frontend
cd packages/frontend
yarn dev
```

## Test Gates

Each feature has a dedicated test file. All must pass before the next feature:

| Gate | File                          | Feature                     |
| ---- | ----------------------------- | --------------------------- |
| 1    | `01_WDOT.test.js`             | Wrapped DOT ERC-20          |
| 2    | `02_PriceOracle.test.js`      | Price oracle + decimal math |
| 3    | `03_CollateralVault.test.js`  | Collateral custody          |
| 4    | `04_LendingPool.test.js`      | Core lending logic          |
| 5    | `05_RemittanceBridge.test.js` | Cross-chain bridge wrapper  |
| 6    | `06_Integration.test.js`      | Full end-to-end flow        |

## Network

- **Testnet**: Polkadot Hub Testnet (Westend Asset Hub)
- **Chain ID**: 420420421
- **RPC**: https://westend-asset-hub-eth-rpc.polkadot.io
- **Faucet**: https://faucet.polkadot.io/westend

## Key Technical Notes

- DOT uses **10 decimals** (not 18). All arithmetic uses `DecimalLib` for normalization.
- Solidity compiled to `evmVersion: paris` — safe for Polkadot Hub REVM.
- Standard Hardhat + OpenZeppelin — no `resolc` needed (EVM track, not PVM).
- Bridge starts in **mock mode** (local USDC transfer) until Hyperbridge Gateway address is live on testnet.

## Built With

Polkadot Hub · Solidity · Hardhat · OpenZeppelin · Hyperbridge · React · Wagmi · RainbowKit
