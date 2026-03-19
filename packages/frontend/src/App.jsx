import React, { useRef } from 'react';
import { Web3Provider } from './contexts/Web3Context';
import { ConnectWallet } from './components/ConnectWallet/ConnectWallet';
import { DepositFlow } from './components/Deposit/DepositFlow';
import { BorrowPanel } from './components/Borrow/BorrowPanel';
import { Dashboard } from './components/Dashboard/Dashboard';

function AppContent() {
  const depositRef = useRef(null);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a1a',
      color: '#ffffff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px 32px',
        borderBottom: '1px solid #1a1a3e',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px', fontWeight: 'bold', color: '#e91e8c' }}>
            DotBridge
          </span>
          <span style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            Borrow DOT. Send Anywhere.
          </span>
        </div>
        <ConnectWallet />
      </header>

      <main style={{
        maxWidth: '960px',
        margin: '0 auto',
        padding: '48px 32px',
        textAlign: 'center',
      }}>
        <h1 style={{ fontSize: '36px', marginBottom: '16px' }}>
          DeFi Remittances on Polkadot Hub
        </h1>
        <p style={{ color: '#999', fontSize: '18px', maxWidth: '600px', margin: '0 auto' }}>
          Deposit WDOT as collateral, borrow USDC, and send it cross-chain
          to any recipient via Hyperbridge — all in one transaction.
        </p>

        <div style={{ marginTop: '48px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* Deposit + Borrow column */}
          <div style={{ maxWidth: '520px', marginLeft: 'auto', marginRight: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div ref={depositRef}>
              <DepositFlow />
            </div>
            <BorrowPanel />
          </div>

          {/* Dashboard: Position, Collateral Summary, Remittance History */}
          <Dashboard depositRef={depositRef} />
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Web3Provider>
      <AppContent />
    </Web3Provider>
  );
}
