// src/constants/chains.js
// Polkadot Hub testnet (Westend Asset Hub) chain definition for Wagmi

export const polkadotHubTestnet = {
  id: 420420421,
  name: 'Polkadot Hub Testnet',
  nativeCurrency: {
    name: 'Westend DOT',
    symbol: 'WND',
    decimals: 10,   // CRITICAL: DOT is 10 decimals
  },
  rpcUrls: {
    default: {
      http: ['https://westend-asset-hub-eth-rpc.polkadot.io'],
    },
    public: {
      http: ['https://westend-asset-hub-eth-rpc.polkadot.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Subscan',
      url: 'https://assethub-westend.subscan.io',
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
