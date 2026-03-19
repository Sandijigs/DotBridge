# DotBridge

> Borrow stablecoins against your DOT. Send them anywhere, instantly.

## What It Does

DotBridge is a DeFi + remittance protocol on Polkadot Hub (EVM track). It lets users collateralize their DOT holdings to borrow stablecoins and optionally send them cross-chain in a single transaction.

1. **Wrap** native DOT into WDOT (ERC-20)
2. **Deposit** WDOT as collateral into a non-custodial vault
3. **Borrow** USDC at 150% collateral ratio with 5% APR interest
4. **Remit** borrowed USDC cross-chain to any EVM recipient via Hyperbridge
5. **Repay** loan to unlock collateral; positions below 130% health factor are liquidatable

## Architecture

```
                         ┌─────────────────────┐
                         │     Frontend (React) │
                         │  Wagmi + RainbowKit  │
                         └──────────┬───────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼──────┐
              │  WDOT.sol  │  │ Collateral │  │  Lending   │
              │ Wrap/Unwrap│  │  Vault.sol │  │  Pool.sol  │
              └────────────┘  └─────┬──────┘  └──────┬─────┘
                                    │                │
                              ┌─────▼─────┐   ┌─────▼──────┐
                              │   Price    │   │ Remittance │
                              │ Oracle.sol │   │ Bridge.sol │
                              └────────────┘   └────────────┘
```

| Contract              | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| `WDOT.sol`            | Wrap/unwrap native DOT as ERC-20 (fills ecosystem gap #1447)     |
| `CollateralVault.sol` | Holds WDOT collateral, tracks available vs locked per user       |
| `PriceOracle.sol`     | DOT/USD price feed (mock on testnet, Chainlink-ready on mainnet) |
| `LendingPool.sol`     | Core: borrow, repay, liquidate, health factor, 5% APR interest  |
| `RemittanceBridge.sol`| Hyperbridge wrapper for cross-chain USDC sends                   |
| `MockUSDC.sol`        | Test stablecoin (6 decimals, mintable)                           |

## Quick Start

```bash
# Install dependencies
yarn install

# Run all tests (65 tests, 6 suites)
cd packages/contracts
npx hardhat test

# Run test coverage
npx hardhat coverage

# Deploy to Polkadot Hub Testnet
cp .env.example .env   # fill in DEPLOYER_PRIVATE_KEY
npx hardhat run scripts/deploy.js --network polkadotHubTestnet

# Start frontend
cd ../frontend
yarn dev
```

## Test Gates

Each feature has a dedicated test file. All 65 tests pass across 6 suites:

| Gate | File                          | Tests | Feature                     |
| ---- | ----------------------------- | ----- | --------------------------- |
| 1    | `01_WDOT.test.js`             | 7     | Wrapped DOT ERC-20          |
| 2    | `02_PriceOracle.test.js`      | 5     | Price oracle + decimal math |
| 3    | `03_CollateralVault.test.js`  | 11    | Collateral custody          |
| 4    | `04_LendingPool.test.js`      | 22    | Core lending logic          |
| 5    | `05_RemittanceBridge.test.js` | 9     | Cross-chain bridge wrapper  |
| 6    | `06_Integration.test.js`      | 11    | Full end-to-end flow        |

## Network

- **Testnet**: Polkadot Hub Testnet (Paseo)
- **Chain ID**: `420420417`
- **RPC**: `https://eth-rpc-testnet.polkadot.io/`
- **Explorer**: [https://blockscout-testnet.polkadot.io](https://blockscout-testnet.polkadot.io)
- **Faucet**: [https://faucet.polkadot.io/](https://faucet.polkadot.io/)
- **Native Token**: PAS (10 decimals)

## Deployed Contract Addresses (Polkadot Hub Testnet)

| Contract          | Address                                      |
| ----------------- | -------------------------------------------- |
| WDOT              | `0x330eFe22a73AAD374b887d6F77cd90fa16b6cC60` |
| MockUSDC          | `0xda2B35880c142B27bF7db4681Cc85FAd2F352997` |
| PriceOracle       | `0xEc3455BF8842b9b96b0f10450CBA6c685de84d9B` |
| CollateralVault   | `0x62A97b5DD2D7680219B3E7C745D6C74fb7c463F1` |
| RemittanceBridge  | `0x891Fc6d2dFEd0f5ff4Db00690eB552eB029564a8` |
| LendingPool       | `0x03540C0af2350218C206168e0F758450Db84e179` |

## Key Technical Notes

- DOT uses **10 decimals** (not 18). All arithmetic uses `DecimalLib` for safe normalization to 18-decimal WAD format.
- USDC uses **6 decimals**. Conversion between DOT, USDC, and internal WAD (18 decimals) is handled by the library.
- Solidity 0.8.27 compiled with `evmVersion: paris` — safe for Polkadot Hub REVM.
- Standard Hardhat + OpenZeppelin 5.x — no `resolc` needed (EVM track, not PVM).
- Bridge starts in **mock mode** (local USDC transfer) until Hyperbridge Gateway address is live on testnet.
- Frontend uses **TypeScript strict mode**, React 18, Wagmi v2, RainbowKit, and viem.
- Collateral ratio: 150% (borrow) / 130% (liquidation threshold).
- Interest rate: 5% APR, calculated per-second using block timestamps.
- Pull-based bridge pattern: LendingPool does `forceApprove`, bridge does `safeTransferFrom`.
- Checks-Effects-Interactions pattern used throughout for reentrancy safety.

## Known Limitations

- **Oracle**: Uses a mock price oracle with admin-set prices. Production would use Chainlink or a decentralized oracle.
- **Bridge**: Hyperbridge Gateway is not yet live on Paseo testnet, so the bridge runs in mock mode (direct USDC transfer on the same chain).
- **Single collateral**: Only WDOT is supported as collateral. Multi-collateral support is a roadmap item.
- **No partial repayment**: Loans must be repaid in full to close a position.
- **No flash loan protection**: Not needed for current scope but would be added for mainnet.

## Roadmap

- [ ] Integrate live Hyperbridge Gateway for real cross-chain transfers
- [ ] Chainlink oracle integration for production price feeds
- [ ] Multi-collateral support (GLMR, ASTR, etc.)
- [ ] Partial repayment and position management
- [ ] Governance token and fee distribution
- [ ] Mobile-optimized UI
- [ ] Mainnet deployment on Polkadot Hub

## Built With

Polkadot Hub · Solidity 0.8.27 · Hardhat · OpenZeppelin 5.x · Hyperbridge · React 18 · TypeScript · Wagmi v2 · RainbowKit · viem

## License

MIT
