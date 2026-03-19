import React from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, getDefaultConfig } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { polkadotHubTestnet } from '../constants/chains';

const config = getDefaultConfig({
  appName: 'DotBridge',
  projectId: 'dotbridge-demo',
  chains: [polkadotHubTestnet],
  transports: {
    [polkadotHubTestnet.id]: http(polkadotHubTestnet.rpcUrls.default.http[0]),
  },
});

const queryClient = new QueryClient();

interface Web3ProviderProps {
  children: React.ReactNode;
}

export function Web3Provider({ children }: Web3ProviderProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
