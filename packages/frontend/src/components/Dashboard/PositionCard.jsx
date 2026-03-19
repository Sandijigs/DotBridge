import React, { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import {
  usePosition,
  useHealthFactor,
  useRepaymentAmount,
  useRepay,
} from '../../hooks/useLendingPool';
import { useCollateralBalances } from '../../hooks/useVault';

const SUBSCAN_TX = 'https://assethub-westend.subscan.io/tx/';
const WDOT_DECIMALS = 10;

const HF_COLORS = {
  safe: '#3B6D11',
  caution: '#BA7517',
  danger: '#A32D2D',
  none: '#888',
};

const cardStyle = {
  background: '#1a1a2e',
  borderRadius: '12px',
  padding: '24px',
  border: '1px solid #2a2a4e',
};

const btnBase = {
  width: '100%',
  padding: '14px',
  borderRadius: '8px',
  border: 'none',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
  marginTop: '16px',
};

const btnPrimary = { ...btnBase, background: '#e91e8c', color: '#ffffff' };
const btnDisabled = { ...btnBase, background: '#444', color: '#888', cursor: 'not-allowed' };

function HealthBar({ display, status, raw }) {
  const color = HF_COLORS[status] || HF_COLORS.none;
  const hfNum = status === 'none' ? 0 : Number(raw) / 1e18;
  const fillPct = status === 'none' ? 0 : Math.min(Math.max((1.3 / hfNum) * 100, 0), 100);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <span style={{ fontSize: '13px', color: '#888' }}>Health Factor</span>
        <span style={{ fontWeight: 'bold', color, fontSize: '18px' }}>{display}</span>
      </div>
      <div style={{
        width: '100%',
        height: '8px',
        background: '#0d0d1a',
        borderRadius: '4px',
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${fillPct}%`,
          height: '100%',
          background: color,
          borderRadius: '4px',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

export function PositionCard() {
  const { address } = useAccount();
  const { isActive, collateralWdot, debtUsdc, refetch: refetchPosition } = usePosition(address);
  const { display: hfDisplay, status: hfStatus, raw: hfRaw, refetch: refetchHf } = useHealthFactor(address);
  const {
    principal: repPrincipal,
    interest: repInterest,
    total: repTotal,
    totalRaw: repTotalRaw,
    refetch: refetchRepay,
  } = useRepaymentAmount(address);
  const { refetch: refetchVault } = useCollateralBalances(address);

  const { repay, step: repayStep, isLoading: repayLoading, txHash: repayTx, error: repayError } = useRepay();
  const [closed, setClosed] = useState(false);
  const [returnedWdot, setReturnedWdot] = useState('');

  const refreshAll = useCallback(() => {
    refetchPosition();
    refetchHf();
    refetchRepay();
    refetchVault();
  }, [refetchPosition, refetchHf, refetchRepay, refetchVault]);

  const handleRepay = async () => {
    try {
      const wdotBefore = collateralWdot;
      // Add 1 USDC buffer for interest accrual between read and tx
      const buffer = repTotalRaw + 1000000n;
      await repay(buffer);
      setReturnedWdot(parseFloat(formatUnits(wdotBefore, WDOT_DECIMALS)).toFixed(4));
      setClosed(true);
      refreshAll();
    } catch (_) { /* hook manages error */ }
  };

  if (!address) return null;

  // Post-repay success state
  if (closed && repayTx) {
    return (
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', color: '#22c55e', fontWeight: 'bold', marginBottom: '12px' }}>
            Position Closed
          </div>
          <div style={{ color: '#aaa', fontSize: '14px', marginBottom: '8px' }}>
            {returnedWdot} WDOT returned to available balance
          </div>
          <a
            href={SUBSCAN_TX + repayTx}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#e91e8c', fontSize: '13px' }}
          >
            View on Subscan
          </a>
        </div>
      </div>
    );
  }

  // No active position
  if (!isActive) {
    return (
      <div style={cardStyle}>
        <h3 style={{ margin: '0 0 12px', color: '#e91e8c' }}>Position</h3>
        <div style={{ textAlign: 'center', color: '#888', padding: '24px 0' }}>
          <div style={{ fontSize: '16px', marginBottom: '8px' }}>No active position</div>
          <div style={{ fontSize: '14px' }}>
            Deposit collateral and borrow USDC to get started.
          </div>
        </div>
      </div>
    );
  }

  // Active position
  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Active Position</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>Locked collateral</span>
          <span style={{ fontWeight: 'bold' }}>
            {parseFloat(formatUnits(collateralWdot, WDOT_DECIMALS)).toFixed(4)} WDOT
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>Borrowed</span>
          <span style={{ fontWeight: 'bold' }}>
            ${parseFloat(repPrincipal).toFixed(2)} USDC
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>Accrued interest</span>
          <span style={{ fontWeight: 'bold' }}>
            ${parseFloat(repInterest).toFixed(4)} USDC
          </span>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          borderTop: '1px solid #2a2a4e',
          paddingTop: '12px',
        }}>
          <span style={{ color: '#ccc', fontWeight: 'bold' }}>Total to repay</span>
          <span style={{ fontWeight: 'bold', color: '#e91e8c', fontSize: '18px' }}>
            ${parseFloat(repTotal).toFixed(4)} USDC
          </span>
        </div>

        <div style={{ marginTop: '8px' }}>
          <HealthBar display={hfDisplay} status={hfStatus} raw={hfRaw} />
        </div>
      </div>

      <button
        onClick={handleRepay}
        disabled={repayLoading}
        style={repayLoading ? btnDisabled : btnPrimary}
      >
        {repayStep === 'approving'
          ? 'Approving USDC...'
          : repayStep === 'repaying'
            ? 'Repaying...'
            : `Repay $${parseFloat(repTotal).toFixed(2)} USDC`}
      </button>

      {repayError && (
        <div style={{ color: '#ff4444', fontSize: '13px', marginTop: '8px' }}>
          {repayError}
        </div>
      )}
    </div>
  );
}
