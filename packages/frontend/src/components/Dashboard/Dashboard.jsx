import React, { useRef, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { PositionCard } from './PositionCard';
import { LiquidationPanel } from '../Liquidate/LiquidationPanel';
import { RemittanceStatus } from '../Remit/RemittanceStatus';
import { useCollateralBalances } from '../../hooks/useVault';

const WDOT_DECIMALS = 10;

const cardStyle = {
  background: '#1a1a2e',
  borderRadius: '12px',
  padding: '24px',
  border: '1px solid #2a2a4e',
};

function CollateralSummary() {
  const { address } = useAccount();
  const { available, locked } = useCollateralBalances(address);

  if (!address) return null;

  const totalRaw = available.raw + locked.raw;
  const totalFormatted = parseFloat(formatUnits(totalRaw, WDOT_DECIMALS)).toFixed(4);

  return (
    <div style={cardStyle}>
      <h3 style={{ margin: '0 0 16px', color: '#e91e8c' }}>Collateral Summary</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>Available</span>
          <span style={{ fontWeight: 'bold', color: '#22c55e' }}>
            {parseFloat(formatUnits(available.raw, WDOT_DECIMALS)).toFixed(4)} WDOT
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>Locked</span>
          <span style={{ fontWeight: 'bold', color: '#BA7517' }}>
            {parseFloat(formatUnits(locked.raw, WDOT_DECIMALS)).toFixed(4)} WDOT
          </span>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          borderTop: '1px solid #2a2a4e',
          paddingTop: '12px',
        }}>
          <span style={{ color: '#ccc', fontWeight: 'bold' }}>Total</span>
          <span style={{ fontWeight: 'bold' }}>{totalFormatted} WDOT</span>
        </div>
      </div>
    </div>
  );
}

export function Dashboard({ depositRef }) {
  const { address } = useAccount();

  const scrollToDeposit = useCallback(() => {
    depositRef?.current?.scrollIntoView({ behavior: 'smooth' });
  }, [depositRef]);

  // Repay action scrolls to the position card (which has the repay button)
  const positionRef = useRef(null);
  const scrollToPosition = useCallback(() => {
    positionRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  if (!address) {
    return (
      <div style={{ ...cardStyle, textAlign: 'center', color: '#888' }}>
        Connect your wallet to view your dashboard.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Liquidation warning banner */}
      <LiquidationPanel
        onAddCollateral={scrollToDeposit}
        onRepay={scrollToPosition}
      />

      {/* Row 1: Position + Collateral Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.5fr 1fr',
        gap: '24px',
      }}>
        <div ref={positionRef}>
          <PositionCard />
        </div>
        <CollateralSummary />
      </div>

      {/* Row 2: Remittance History */}
      <RemittanceStatus />
    </div>
  );
}
