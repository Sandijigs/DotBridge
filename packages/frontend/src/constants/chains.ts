import type { Chain } from 'viem';

export const polkadotHubTestnet: Chain = {
  id: 420420417,
  name: 'Polkadot Hub Testnet',
  nativeCurrency: {
    name: 'Paseo DOT',
    symbol: 'PAS',
    decimals: 10, // CRITICAL: DOT is 10 decimals
  },
  rpcUrls: {
    default: {
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

export interface DestChain {
  id: number;
  name: string;
  logo: string;
}

export const DEST_CHAINS: DestChain[] = [
  { id: 56, name: 'BNB Chain', logo: '🟡' },
  { id: 1, name: 'Ethereum', logo: '🔷' },
  { id: 8453, name: 'Base', logo: '🔵' },
  { id: 42161, name: 'Arbitrum', logo: '🔶' },
];
