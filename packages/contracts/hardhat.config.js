require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: "../../.env" });

/**
 * POLKADOT HUB NETWORK CONFIG
 *
 * EVM Track (REVM): Standard solc compilation works as-is.
 * No resolc needed — that's only for the PVM/PolkaVM track.
 *
 * Polkadot Hub TestNet (Paseo) — use for all development & demo:
 *   RPC:      https://eth-rpc-testnet.polkadot.io/
 *   Chain ID: 420420417
 *   Currency: PAS (Paseo testnet DOT)
 *   Faucet:   https://faucet.polkadot.io
 *   Explorer: https://blockscout-testnet.polkadot.io
 *
 * Polkadot Hub Mainnet:
 *   RPC:      https://eth-rpc.polkadot.io/
 *   Chain ID: 420420419
 *   Currency: DOT
 *
 * IMPORTANT — DOT DECIMALS:
 *   DOT uses 10 decimals (1 DOT = 10_000_000_000 planks)
 *   NOT 18 like ETH. All contract math must account for this.
 *   WDOT mirrors this: 10 decimals.
 *   USDC uses 6 decimals.
 *   Health factor math normalizes all values to 18 decimals internally.
 */

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "0".repeat(64);
const TESTNET_RPC  = process.env.TESTNET_RPC  || "https://eth-rpc-testnet.polkadot.io/";
const POLKADOT_RPC = process.env.POLKADOT_RPC || "https://eth-rpc.polkadot.io/";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "paris", // CRITICAL: newer opcodes (PUSH0) unsupported on Polkadot Hub REVM
      optimizer: {
        enabled: true,
        runs: 200,
      },
      metadata: {
        bytecodeHash: "none", // Strip metadata — Polkadot Hub REVM rejects cbor-encoded metadata
      },
      viaIR: false, // Keep false for Polkadot Hub EVM compatibility
    },
  },

  networks: {
    // Local Hardhat node — fastest for unit tests
    hardhat: {
      chainId: 31337,
    },

    // Local node for manual testing
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // Polkadot Hub TestNet (Paseo) — PRIMARY TESTNET for this hackathon
    // REVM with AllowEVMBytecode enabled — accepts standard solc output
    polkadotHubTestnet: {
      url: TESTNET_RPC,
      chainId: 420420417,
      accounts: [PRIVATE_KEY],
      gasPrice: 1_000_000_000_000, // 1000 Gwei — fixed for Polkadot Hub
      gas: 5_000_000,
      timeout: 120000,
    },

    // Polkadot Hub Mainnet — only after full testnet validation
    polkadot: {
      url: POLKADOT_RPC,
      chainId: 420420419,
      accounts: [PRIVATE_KEY],
      gasMultiplier: 1.2,
    },
  },

  paths: {
    sources:   "./contracts",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts",
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
};
