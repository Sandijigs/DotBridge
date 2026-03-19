import React from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import { polkadotHubTestnet } from '../../constants/chains';

const CHAIN_ID = polkadotHubTestnet.id;

function truncateAddress(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

export function ConnectWallet() {
  const { address, isConnected, chain } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: balance } = useBalance({
    address,
    chainId: CHAIN_ID,
  });

  const isWrongNetwork = isConnected && chain?.id !== CHAIN_ID;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      {isWrongNetwork && (
        <div style={{
          background: '#ff4444',
          color: 'white',
          padding: '8px 16px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '14px',
        }}>
          <span>Wrong network</span>
          <button
            onClick={() => switchChain({ chainId: CHAIN_ID })}
            style={{
              background: 'white',
              color: '#ff4444',
              border: 'none',
              padding: '4px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '13px',
            }}
          >
            Switch to Polkadot Hub
          </button>
        </div>
      )}

      {isConnected && !isWrongNetwork && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          background: '#1a1a2e',
          padding: '8px 16px',
          borderRadius: '8px',
          color: '#e0e0e0',
          fontSize: '14px',
        }}>
          <span style={{ fontFamily: 'monospace' }}>
            {truncateAddress(address!)}
          </span>
          <span style={{ color: '#e91e8c', fontWeight: 'bold' }}>
            {balance
              ? `${parseFloat(formatUnits(balance.value, 10)).toFixed(4)} PAS`
              : '...'}
          </span>
        </div>
      )}

      <ConnectButton showBalance={false} />
    </div>
  );
}
