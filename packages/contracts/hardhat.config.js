require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/**
 * POLKADOT HUB NETWORK CONFIG
 *
 * EVM Track (REVM): Standard solc compilation works as-is.
 * No resolc needed — that's only for the PVM/PolkaVM track.
 *
 * Westend Asset Hub Testnet (use for all development & demo):
 *   RPC:      https://westend-asset-hub-eth-rpc.polkadot.io
 *   Chain ID: 420420421
 *   Currency: WND (testnet DOT)
 *   Faucet:   https://faucet.polkadot.io/westend
 *   Explorer: https://assethub-westend.subscan.io
 *
 * Polkadot Hub Mainnet:
 *   RPC:      https://asset-hub-polkadot-eth-rpc.polkadot.io
 *   Chain ID: 420420420
 *   Currency: DOT
 *
 * IMPORTANT — DOT DECIMALS:
 *   DOT uses 10 decimals (1 DOT = 10_000_000_000 planks)
 *   NOT 18 like ETH. All contract math must account for this.
 *   WDOT mirrors this: 10 decimals.
 *   USDC uses 6 decimals.
 *   Health factor math normalizes all values to 18 decimals internally.
 */

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "0".repeat(64);
const WESTEND_RPC  = process.env.WESTEND_RPC  || "https://westend-asset-hub-eth-rpc.polkadot.io";
const POLKADOT_RPC = process.env.POLKADOT_RPC || "https://asset-hub-polkadot-eth-rpc.polkadot.io";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
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

    // Westend Asset Hub — PRIMARY TESTNET for this hackathon
    westend: {
      url: WESTEND_RPC,
      chainId: 420420421,
      accounts: [PRIVATE_KEY],
      // Polkadot Hub has different gas dynamics — don't hardcode gas price
      // Let the node estimate via eth_gasPrice
      gasMultiplier: 1.2, // 20% buffer on gas estimates
    },

    // Polkadot Hub Mainnet — only after full testnet validation
    polkadot: {
      url: POLKADOT_RPC,
      chainId: 420420420,
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
