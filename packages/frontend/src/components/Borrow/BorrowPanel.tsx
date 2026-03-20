import React, { useState, useMemo, useCallback } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits, isAddress } from 'viem';
import {
  useBorrow,
  useRepay,
  usePosition,
  useHealthFactor,
  useMaxBorrow,
  useRepaymentAmount,
  type HealthStatus,
} from '../../hooks/useLendingPool';
import { useCollateralBalances } from '../../hooks/useVault';
import { useContracts } from '../../hooks/useContracts';
import { DEST_CHAINS, polkadotHubTestnet } from '../../constants/chains';

const EXPLORER_TX = polkadotHubTestnet.blockExplorers!.default.url + '/tx/';
const WDOT_DECIMALS = 10;
const USDC_DECIMALS = 6;

const HF_COLORS: Record<HealthStatus | 'none', string> = {
  safe: '#3B6D11',
  caution: '#BA7517',
  danger: '#A32D2D',
  none: '#888',
};

const cardStyle: React.CSSProperties = { background: '#1a1a2e', borderRadius: '12px', padding: '24px', border: '1px solid #2a2a4e' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '12px 16px', background: '#0d0d1a', border: '1px solid #2a2a4e', borderRadius: '8px', color: '#ffffff', fontSize: '16px', outline: 'none', boxSizing: 'border-box' };
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer', appearance: 'none' as const, backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' fill=\'%23888\' viewBox=\'0 0 16 16\'%3E%3Cpath d=\'M8 11L3 6h10z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' };
const btnBase: React.CSSProperties = { width: '100%', padding: '14px', borderRadius: '8px', border: 'none', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', marginTop: '12px' };
const btnPrimary: React.CSSProperties = { ...btnBase, background: '#e91e8c', color: '#ffffff' };
const btnDisabled: React.CSSProperties = { ...btnBase, background: '#444', color: '#888', cursor: 'not-allowed' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '14px', color: '#ccc' };
const hintStyle: React.CSSProperties = { fontSize: '13px', color: '#888', marginTop: '6px' };

function HealthBadge({ display, status }: { display: string; status: HealthStatus }) {
  const color = HF_COLORS[status] || HF_COLORS.none;
  return (
    <span style={{ padding: '4px 12px', borderRadius: '8px', border: `1px solid ${color}`, color, fontWeight: 'bold', fontSize: '14px' }}>
      {display}
    </span>
  );
}

function FeeEstimate({ destChainId }: { destChainId: string }) {
  const { bridge } = useContracts();
  const { data: feeRaw } = useReadContract({
    address: bridge.address,
    abi: bridge.abi,
    functionName: 'estimateFee',
    args: [BigInt(destChainId || 0)],
    query: { enabled: !!destChainId && destChainId !== '0' },
  });
  if (!feeRaw && feeRaw !== 0n) return null;
  const feeDisplay = parseFloat(formatUnits(feeRaw as bigint, 10)).toFixed(4);
  return <div style={{ ...hintStyle, color: '#aaa' }}>Bridge fee: ~{feeDisplay} PAS</div>;
}

export function BorrowPanel() {
  const { address } = useAccount();
  const { available } = useCollateralBalances(address);
  const { isActive, collateralWdot, refetch: refetchPosition } = usePosition(address);
  const { display: hfDisplay, status: hfStatus, refetch: refetchHf } = useHealthFactor(address);
  const { maxUsdc, display: maxDisplay, refetch: refetchMax } = useMaxBorrow(address);
  const { principal: repPrincipal, interest: repInterest, total: repTotal, totalRaw: repTotalRaw, refetch: refetchRepay } = useRepaymentAmount(address);

  const { oracle } = useContracts();
  const { data: dotPriceWad } = useReadContract({
    address: oracle.address,
    abi: oracle.abi,
    functionName: 'getDotPriceWad',
    query: { enabled: !!address },
  });

  const [usdcAmount, setUsdcAmount] = useState('');
  const [remitEnabled, setRemitEnabled] = useState(false);
  const [destChainId, setDestChainId] = useState('');
  const [recipient, setRecipient] = useState('');
  const { borrow, isLoading: borrowLoading, txHash: borrowTx, error: borrowError } = useBorrow();
  const { repay, step: repayStep, isLoading: repayLoading, txHash: repayTx, error: repayError } = useRepay();

  const collateralFormatted = formatUnits(available.raw + (collateralWdot ?? 0n), WDOT_DECIMALS);
  const collateralUsd = useMemo(() => {
    if (!dotPriceWad) return '0.00';
    const totalWdot = available.raw + (collateralWdot ?? 0n);
    const usdWad = (totalWdot * (dotPriceWad as bigint)) / (10n ** 10n);
    return parseFloat(formatUnits(usdWad, 18)).toFixed(2);
  }, [available.raw, collateralWdot, dotPriceWad]);

  const inputUsdc = parseFloat(usdcAmount) || 0;
  const maxUsdcNum = parseFloat(formatUnits(maxUsdc, USDC_DECIMALS));
  const borrowValid = inputUsdc > 0 && inputUsdc <= maxUsdcNum && !isActive;
  const remitValid = !remitEnabled || (destChainId && recipient && isAddress(recipient));

  const previewHf = useMemo(() => {
    if (!inputUsdc || inputUsdc <= 0 || !dotPriceWad || !available.raw) return null;
    const collUsdWad = (available.raw * (dotPriceWad as bigint)) / (10n ** 10n);
    const debtUsdWad = BigInt(Math.floor(inputUsdc * 1e6)) * (10n ** 12n);
    if (debtUsdWad === 0n) return null;
    const WAD = 10n ** 18n;
    const hf = (collUsdWad * 13000n * WAD) / (debtUsdWad * 10000n);
    const hfNum = Number(hf) / 1e18;
    let status: HealthStatus;
    if (hfNum >= 1.5) status = 'safe';
    else if (hfNum >= 1.3) status = 'caution';
    else status = 'danger';
    return { display: hfNum.toFixed(2), status };
  }, [inputUsdc, dotPriceWad, available.raw]);

  const refreshAll = useCallback(() => {
    refetchPosition(); refetchHf(); refetchMax(); refetchRepay();
  }, [refetchPosition, refetchHf, refetchMax, refetchRepay]);

  const handleBorrow = async () => {
    try {
      const chain = remitEnabled ? destChainId : '0';
      const recip = remitEnabled ? recipient : '0x0000000000000000000000000000000000000000';
      await borrow(usdcAmount, chain, recip);
      setUsdcAmount('');
      refreshAll();
    } catch { /* hook manages error */ }
  };

  const handleRepay = async () => {
    try {
      const buffer = repTotalRaw + 1000000n;
      await repay(buffer);
      refreshAll();
    } catch { /* hook manages error */ }
  };

  if (!address) {
    return <div style={{ ...cardStyle, textAlign: 'center', color: '#888' }}>Connect your wallet to borrow.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Stats Row */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Position Overview</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', textAlign: 'center' }}>
          <div>
            <div style={{ color: '#888', fontSize: '13px', marginBottom: '4px' }}>Collateral</div>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{parseFloat(collateralFormatted).toFixed(4)} WDOT</div>
            <div style={{ fontSize: '12px', color: '#888' }}>~${collateralUsd}</div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '13px', marginBottom: '4px' }}>Max Borrow</div>
            <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{maxDisplay}</div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '13px', marginBottom: '4px' }}>Health Factor</div>
            <div style={{ marginTop: '4px' }}><HealthBadge display={hfDisplay} status={hfStatus} /></div>
          </div>
        </div>
      </div>

      {/* Borrow Form */}
      {!isActive && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Borrow USDC</h3>
          <label style={labelStyle}>Amount (USDC)</label>
          <div style={{ position: 'relative' }}>
            <input type="number" min="0" step="any" placeholder="0.00" value={usdcAmount}
              onChange={(e) => setUsdcAmount(e.target.value)} disabled={borrowLoading} style={inputStyle} />
            <button onClick={() => setUsdcAmount(formatUnits(maxUsdc, USDC_DECIMALS))}
              style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: '#2a2a4e', border: 'none', color: '#e91e8c', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
              MAX
            </button>
          </div>
          <div style={{ ...hintStyle, textAlign: 'right' }}>Max: {maxDisplay}</div>

          {previewHf && (
            <div style={{ ...hintStyle, display: 'flex', alignItems: 'center', gap: '8px' }}>
              Projected health factor: <HealthBadge display={previewHf.display} status={previewHf.status} />
            </div>
          )}

          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={remitEnabled} onChange={(e) => setRemitEnabled(e.target.checked)}
                style={{ width: '18px', height: '18px', accentColor: '#e91e8c' }} />
              <span style={{ fontSize: '14px', color: '#ccc' }}>Send cross-chain (remittance)</span>
            </label>
          </div>

          {remitEnabled && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={labelStyle}>Destination Chain</label>
                <select value={destChainId} onChange={(e) => setDestChainId(e.target.value)} style={selectStyle}>
                  <option value="">Select chain...</option>
                  {DEST_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.logo} {c.name}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Recipient Address</label>
                <input type="text" placeholder="0x..." value={recipient} onChange={(e) => setRecipient(e.target.value)} style={inputStyle} />
                {recipient && !isAddress(recipient) && (
                  <div style={{ color: '#A32D2D', fontSize: '12px', marginTop: '4px' }}>Invalid address</div>
                )}
              </div>
              {destChainId && <FeeEstimate destChainId={destChainId} />}
            </div>
          )}

          <button onClick={handleBorrow} disabled={!borrowValid || !remitValid || borrowLoading}
            style={!borrowValid || !remitValid || borrowLoading ? btnDisabled : btnPrimary}>
            {borrowLoading ? 'Borrowing...' : remitEnabled
              ? `Borrow + Send to ${DEST_CHAINS.find((c) => String(c.id) === destChainId)?.name || '...'}`
              : `Borrow $${usdcAmount || '0'} USDC`}
          </button>

          {borrowError && <div style={{ color: '#ff4444', fontSize: '13px', marginTop: '8px' }}>{borrowError}</div>}
          {borrowTx && (
            <div style={{ fontSize: '13px', marginTop: '8px', color: '#22c55e' }}>
              Success: <a href={EXPLORER_TX + borrowTx} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e' }}>View on Explorer</a>
            </div>
          )}
        </div>
      )}

      {/* Repay Section */}
      {isActive && (
        <div style={cardStyle}>
          <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Repay Loan</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px', textAlign: 'center' }}>
            <div><div style={{ color: '#888', fontSize: '13px' }}>Principal</div><div style={{ fontWeight: 'bold' }}>{parseFloat(repPrincipal).toFixed(2)} USDC</div></div>
            <div><div style={{ color: '#888', fontSize: '13px' }}>Interest</div><div style={{ fontWeight: 'bold' }}>{parseFloat(repInterest).toFixed(4)} USDC</div></div>
            <div><div style={{ color: '#888', fontSize: '13px' }}>Total Due</div><div style={{ fontWeight: 'bold', color: '#e91e8c' }}>{parseFloat(repTotal).toFixed(4)} USDC</div></div>
          </div>
          <button onClick={handleRepay} disabled={repayLoading} style={repayLoading ? btnDisabled : btnPrimary}>
            {repayStep === 'approving' ? 'Approving USDC...' : repayStep === 'repaying' ? 'Repaying...' : `Repay ${parseFloat(repTotal).toFixed(2)} USDC`}
          </button>
          {repayError && <div style={{ color: '#ff4444', fontSize: '13px', marginTop: '8px' }}>{repayError}</div>}
          {repayTx && (
            <div style={{ fontSize: '13px', marginTop: '8px', color: '#22c55e' }}>
              Repaid: <a href={EXPLORER_TX + repayTx} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e' }}>View on Explorer</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
