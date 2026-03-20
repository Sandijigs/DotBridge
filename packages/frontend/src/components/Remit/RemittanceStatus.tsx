import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { DEST_CHAINS, polkadotHubTestnet } from '../../constants/chains';

const EXPLORER_TX = polkadotHubTestnet.blockExplorers!.default.url + '/tx/';

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '12px',
  padding: '24px',
  border: '1px solid #2a2a4e',
};

function chainName(id: string | number): string {
  const chain = DEST_CHAINS.find((c) => c.id === Number(id));
  return chain ? `${chain.logo} ${chain.name}` : `Chain ${id}`;
}

function truncateAddr(addr: string): string {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

interface StoredRemittance {
  txHash: string;
  recipient: string;
  usdcAmount: string;
  destChainId: string;
  timestamp: number;
}

export function RemittanceStatus() {
  const { address } = useAccount();
  const [events, setEvents] = useState<StoredRemittance[]>([]);

  useEffect(() => {
    if (!address) return;
    const key = `dotbridge_remittances_${address}`;
    try {
      const stored = JSON.parse(localStorage.getItem(key) || '[]');
      setEvents(stored);
    } catch {
      setEvents([]);
    }
  }, [address]);

  // Re-read on storage changes (e.g. after a borrow in same tab)
  useEffect(() => {
    if (!address) return;
    const key = `dotbridge_remittances_${address}`;
    const interval = setInterval(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || '[]');
        setEvents(stored);
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [address]);

  if (!address) return null;

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Remittance History</h3>

      {events.length === 0 && (
        <div style={{ color: '#888', fontSize: '14px', textAlign: 'center' }}>No remittances yet.</div>
      )}

      {events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {events.map((evt, i) => (
            <div key={evt.txHash || i} style={{
              background: '#0d0d1a', borderRadius: '8px', padding: '14px 16px', border: '1px solid #2a2a4e',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontWeight: 'bold' }}>{parseFloat(evt.usdcAmount).toFixed(2)} USDC</div>
                <div style={{ fontSize: '13px', color: '#aaa' }}>
                  To: {truncateAddr(evt.recipient)} on {chainName(evt.destChainId)}
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  {new Date(evt.timestamp).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                <span style={{ padding: '3px 10px', borderRadius: '12px', background: '#3B6D11', color: '#fff', fontSize: '12px', fontWeight: 'bold' }}>
                  Completed
                </span>
                <a href={EXPLORER_TX + evt.txHash} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#e91e8c' }}>
                  Explorer
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
