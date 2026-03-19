import React, { useState, useCallback } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits } from 'viem';
import { useWrapDOT, useWDOTBalance } from '../../hooks/useWDOT';
import { useDepositCollateral, useCollateralBalances } from '../../hooks/useVault';
import { polkadotHubTestnet } from '../../constants/chains';

const EXPLORER_TX = polkadotHubTestnet.blockExplorers!.default.url + '/tx/';

const cardStyle: React.CSSProperties = {
  background: '#1a1a2e',
  borderRadius: '12px',
  padding: '24px',
  border: '1px solid #2a2a4e',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: '#0d0d1a',
  border: '1px solid #2a2a4e',
  borderRadius: '8px',
  color: '#ffffff',
  fontSize: '16px',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnBase: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: '8px',
  border: 'none',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
  marginTop: '12px',
};

const btnPrimary: React.CSSProperties = { ...btnBase, background: '#e91e8c', color: '#ffffff' };
const btnDisabled: React.CSSProperties = { ...btnBase, background: '#444', color: '#888', cursor: 'not-allowed' };
const balanceHint: React.CSSProperties = { fontSize: '13px', color: '#888', marginTop: '6px', textAlign: 'right' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: '8px', fontWeight: 'bold', fontSize: '14px', color: '#ccc' };

interface StepBadgeProps {
  label: string;
  active: boolean;
  done: boolean;
}

function StepBadge({ label, active, done }: StepBadgeProps) {
  const bg = done ? '#22c55e' : active ? '#e91e8c' : '#333';
  const color = done || active ? '#fff' : '#666';
  return (
    <span style={{
      padding: '4px 12px',
      borderRadius: '12px',
      background: bg,
      color,
      fontWeight: active ? 'bold' : 'normal',
    }}>
      {done ? '✓ ' : ''}{label}
    </span>
  );
}

export function DepositFlow() {
  const { address } = useAccount();
  const { data: nativeBalance } = useBalance({
    address,
    chainId: polkadotHubTestnet.id,
  });

  const { raw: wdotRaw, formatted: wdotFormatted, refetch: refetchWdot } = useWDOTBalance(address);
  const { available, locked, refetch: refetchVault } = useCollateralBalances(address);

  const [wrapAmount, setWrapAmount] = useState('');
  const { wrap, isLoading: wrapLoading, txHash: wrapTx, error: wrapError } = useWrapDOT();

  const [depositAmount, setDepositAmount] = useState('');
  const {
    deposit,
    step: depositStep,
    isLoading: depositLoading,
    txHash: depositTx,
    error: depositError,
  } = useDepositCollateral();

  const nativeBal = nativeBalance ? parseFloat(formatUnits(nativeBalance.value, 10)) : 0;
  const wdotBal = parseFloat(formatUnits(wdotRaw, 10));

  const wrapValid = wrapAmount && parseFloat(wrapAmount) > 0 && parseFloat(wrapAmount) <= nativeBal;
  const depositValid = depositAmount && parseFloat(depositAmount) > 0 && parseFloat(depositAmount) <= wdotBal;

  const refreshAll = useCallback(() => {
    refetchWdot();
    refetchVault();
  }, [refetchWdot, refetchVault]);

  const handleWrap = async () => {
    try {
      await wrap(wrapAmount);
      setWrapAmount('');
      refreshAll();
    } catch { /* error state handled by hook */ }
  };

  const handleDeposit = async () => {
    try {
      await deposit(depositAmount);
      setDepositAmount('');
      refreshAll();
    } catch { /* error state handled by hook */ }
  };

  if (!address) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', color: '#888' }}>
        Connect your wallet to get started.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Section 1: Wrap DOT */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>1. Wrap DOT</h3>
        <label style={labelStyle}>Amount (DOT)</label>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0.0"
          value={wrapAmount}
          onChange={(e) => setWrapAmount(e.target.value)}
          disabled={wrapLoading}
          style={inputStyle}
        />
        <div style={balanceHint}>
          Wallet: {nativeBal.toFixed(4)} PAS
        </div>

        <button
          onClick={handleWrap}
          disabled={!wrapValid || wrapLoading}
          style={!wrapValid || wrapLoading ? btnDisabled : btnPrimary}
        >
          {wrapLoading ? 'Wrapping...' : 'Wrap DOT → WDOT'}
        </button>

        {wrapError && (
          <div style={{ color: '#ff4444', fontSize: '13px', marginTop: '8px' }}>{wrapError}</div>
        )}
        {wrapTx && (
          <div style={{ fontSize: '13px', marginTop: '8px', color: '#22c55e' }}>
            Success:{' '}
            <a href={EXPLORER_TX + wrapTx} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e' }}>
              View on Explorer
            </a>
          </div>
        )}
      </div>

      {/* Section 2: Deposit WDOT */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>2. Deposit WDOT as Collateral</h3>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', fontSize: '13px' }}>
          <StepBadge label="Approve" active={depositStep === 'approving'} done={depositStep === 'depositing' || depositStep === 'done'} />
          <span style={{ color: '#444' }}>→</span>
          <StepBadge label="Deposit" active={depositStep === 'depositing'} done={depositStep === 'done'} />
        </div>

        <label style={labelStyle}>Amount (WDOT)</label>
        <input
          type="number"
          min="0"
          step="any"
          placeholder="0.0"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          disabled={depositLoading}
          style={inputStyle}
        />
        <div style={balanceHint}>Wallet: {wdotFormatted}</div>

        <button
          onClick={handleDeposit}
          disabled={!depositValid || depositLoading}
          style={!depositValid || depositLoading ? btnDisabled : btnPrimary}
        >
          {depositStep === 'approving' ? 'Approving vault...' : depositStep === 'depositing' ? 'Depositing...' : 'Approve & Deposit'}
        </button>

        {depositError && (
          <div style={{ color: '#ff4444', fontSize: '13px', marginTop: '8px' }}>{depositError}</div>
        )}
        {depositTx && (
          <div style={{ fontSize: '13px', marginTop: '8px', color: '#22c55e' }}>
            Deposited:{' '}
            <a href={EXPLORER_TX + depositTx} target="_blank" rel="noopener noreferrer" style={{ color: '#22c55e' }}>
              View on Explorer
            </a>
          </div>
        )}
      </div>

      {/* Section 3: Vault Position */}
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Vault Position</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', textAlign: 'center' }}>
          <div>
            <div style={{ color: '#888', fontSize: '13px', marginBottom: '4px' }}>Available</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {parseFloat(formatUnits(available.raw, 10)).toFixed(4)} WDOT
            </div>
          </div>
          <div>
            <div style={{ color: '#888', fontSize: '13px', marginBottom: '4px' }}>Locked</div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {parseFloat(formatUnits(locked.raw, 10)).toFixed(4)} WDOT
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
