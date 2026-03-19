// src/constants/chains.js
// Polkadot Hub TestNet (Paseo) chain definition for Wagmi

export const polkadotHubTestnet = {
  id: 420420417,
  name: 'Polkadot Hub Testnet',
  nativeCurrency: {
    name: 'Paseo DOT',
    symbol: 'PAS',
    decimals: 10,   // CRITICAL: DOT is 10 decimals
  },
  rpcUrls: {
    default: {
      http: ['https://eth-rpc-testnet.polkadot.io/'],
    },
    public: {
      http: ['https://eth-rpc-testnet.polkadot.io/'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Blockscout',
      url: 'https://blockscout-testnet.polkadot.io',
    },
  },
  testnet: true,
};

// Supported destination chains for remittance
export const DEST_CHAINS = [
  { id: 56,    name: 'BNB Chain',     logo: '🟡' },
  { id: 1,     name: 'Ethereum',      logo: '🔷' },
  { id: 8453,  name: 'Base',          logo: '🔵' },
  { id: 42161, name: 'Arbitrum',      logo: '🔶' },
];
