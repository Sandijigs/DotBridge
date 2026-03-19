import React from 'react';
import { useAccount } from 'wagmi';
import { usePosition, useHealthFactor } from '../../hooks/useLendingPool';

const HF_COLORS = {
  safe: '#3B6D11',
  caution: '#BA7517',
  danger: '#A32D2D',
  none: '#888',
};

export function LiquidationPanel({ onAddCollateral, onRepay }) {
  const { address } = useAccount();
  const { isActive } = usePosition(address);
  const { display: hfDisplay, status: hfStatus } = useHealthFactor(address);

  // Only show when position is active AND health factor is danger
  if (!isActive || hfStatus !== 'danger') return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #2d0a0a 0%, #1a1a2e 100%)',
      borderRadius: '12px',
      padding: '20px 24px',
      border: '2px solid #A32D2D',
      marginBottom: '24px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '12px',
      }}>
        <span style={{ fontSize: '24px' }}>&#x26A0;&#xFE0F;</span>
        <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#ff6b6b' }}>
          Your position is at risk of liquidation
        </span>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        marginBottom: '16px',
        fontSize: '14px',
      }}>
        <div>
          <span style={{ color: '#888' }}>Current health factor: </span>
          <span style={{ fontWeight: 'bold', color: HF_COLORS.danger, fontSize: '16px' }}>
            {hfDisplay}
          </span>
        </div>
        <div>
          <span style={{ color: '#888' }}>Liquidation threshold: </span>
          <span style={{ fontWeight: 'bold', color: '#ccc' }}>1.30</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={onAddCollateral}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #A32D2D',
            background: 'transparent',
            color: '#ff6b6b',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Add Collateral
        </button>
        <button
          onClick={onRepay}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '8px',
            border: 'none',
            background: '#A32D2D',
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Repay Now
        </button>
      </div>
    </div>
  );
}
