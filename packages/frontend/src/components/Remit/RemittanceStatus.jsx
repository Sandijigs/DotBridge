import React from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { useContracts } from '../../hooks/useContracts';
import { DEST_CHAINS } from '../../constants/chains';
import { useState, useEffect } from 'react';

const SUBSCAN_TX = 'https://assethub-westend.subscan.io/tx/';
const USDC_DECIMALS = 6;

const cardStyle = {
  background: '#1a1a2e',
  borderRadius: '12px',
  padding: '24px',
  border: '1px solid #2a2a4e',
};

const STATUS_BADGE = {
  0: { label: 'Pending', bg: '#BA7517', color: '#fff' },
  1: { label: 'Completed', bg: '#3B6D11', color: '#fff' },
  2: { label: 'Failed', bg: '#A32D2D', color: '#fff' },
};

function chainName(id) {
  const chain = DEST_CHAINS.find((c) => c.id === Number(id));
  return chain ? `${chain.logo} ${chain.name}` : `Chain ${id}`;
}

function truncateId(id) {
  if (!id) return '';
  return id.slice(0, 12) + '...';
}

function truncateAddr(addr) {
  if (!addr) return '';
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

export function RemittanceStatus() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { bridge } = useContracts();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !bridge.address || !publicClient) return;

    let cancelled = false;

    async function fetchEvents() {
      setLoading(true);
      try {
        // RemittanceSent(bytes32 indexed transferId, address indexed sender, ...)
        const logs = await publicClient.getLogs({
          address: bridge.address,
          event: {
            type: 'event',
            name: 'RemittanceSent',
            inputs: [
              { name: 'transferId', type: 'bytes32', indexed: true },
              { name: 'sender', type: 'address', indexed: true },
              { name: 'recipient', type: 'address', indexed: false },
              { name: 'usdcAmount', type: 'uint256', indexed: false },
              { name: 'destChainId', type: 'uint256', indexed: false },
            ],
          },
          args: {
            sender: address,
          },
          fromBlock: 0n,
          toBlock: 'latest',
        });

        if (!cancelled) {
          setEvents(
            logs.map((log) => ({
              transferId: log.args.transferId,
              recipient: log.args.recipient,
              usdcAmount: log.args.usdcAmount,
              destChainId: log.args.destChainId,
              txHash: log.transactionHash,
            })).reverse()
          );
        }
      } catch (err) {
        console.error('Failed to fetch remittance events:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEvents();
    return () => { cancelled = true; };
  }, [address, bridge.address, publicClient]);

  if (!address) return null;

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Remittance History</h3>

      {loading && <div style={{ color: '#888', fontSize: '14px' }}>Loading transfers...</div>}

      {!loading && events.length === 0 && (
        <div style={{ color: '#888', fontSize: '14px', textAlign: 'center' }}>
          No remittances yet.
        </div>
      )}

      {events.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {events.map((evt) => {
            const badge = STATUS_BADGE[1]; // Mock mode = always completed
            return (
              <div
                key={evt.transferId}
                style={{
                  background: '#0d0d1a',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  border: '1px solid #2a2a4e',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ fontSize: '13px', color: '#888', fontFamily: 'monospace' }}>
                    {truncateId(evt.transferId)}
                  </div>
                  <div style={{ fontWeight: 'bold' }}>
                    {parseFloat(formatUnits(evt.usdcAmount, USDC_DECIMALS)).toFixed(2)} USDC
                  </div>
                  <div style={{ fontSize: '13px', color: '#aaa' }}>
                    To: {truncateAddr(evt.recipient)} on {chainName(evt.destChainId)}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: '12px',
                    background: badge.bg,
                    color: badge.color,
                    fontSize: '12px',
                    fontWeight: 'bold',
                  }}>
                    {badge.label}
                  </span>
                  <a
                    href={SUBSCAN_TX + evt.txHash}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '12px', color: '#e91e8c' }}
                  >
                    Subscan
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
