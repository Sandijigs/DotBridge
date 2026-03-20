import React, { useRef } from 'react';
import { useAccount } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Web3Provider } from './contexts/Web3Context';
import { ConnectWallet } from './components/ConnectWallet/ConnectWallet';
import { DepositFlow } from './components/Deposit/DepositFlow';
import { BorrowPanel } from './components/Borrow/BorrowPanel';
import { Dashboard } from './components/Dashboard/Dashboard';

/* ───── Feature Card ───── */
function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(233,30,140,0.08) 0%, rgba(26,26,46,0.9) 100%)',
      border: '1px solid rgba(233,30,140,0.2)',
      borderRadius: '16px',
      padding: '28px 24px',
      textAlign: 'center',
      transition: 'transform 0.2s ease, border-color 0.2s ease',
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.transform = 'translateY(-4px)';
      e.currentTarget.style.borderColor = 'rgba(233,30,140,0.5)';
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.borderColor = 'rgba(233,30,140,0.2)';
    }}
    >
      <div style={{ fontSize: '36px', marginBottom: '14px' }}>{icon}</div>
      <h3 style={{ margin: '0 0 8px', fontSize: '18px', color: '#fff' }}>{title}</h3>
      <p style={{ margin: 0, fontSize: '14px', color: '#999', lineHeight: '1.6' }}>{desc}</p>
    </div>
  );
}

/* ───── Step Pill ───── */
function StepPill({ num, label }: { num: number; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: '40px', height: '40px', borderRadius: '50%',
        background: 'linear-gradient(135deg, #e91e8c, #b8157a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 'bold', fontSize: '16px', flexShrink: 0,
      }}>{num}</div>
      <span style={{ fontSize: '15px', color: '#ccc' }}>{label}</span>
    </div>
  );
}

/* ───── Stat Box ───── */
function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#e91e8c' }}>{value}</div>
      <div style={{ fontSize: '13px', color: '#888', marginTop: '4px' }}>{label}</div>
    </div>
  );
}

/* ───── Landing Page (wallet not connected) ───── */
function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section style={{
        textAlign: 'center',
        padding: '80px 32px 60px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Glow */}
        <div style={{
          position: 'absolute', top: '-120px', left: '50%', transform: 'translateX(-50%)',
          width: '600px', height: '400px',
          background: 'radial-gradient(ellipse, rgba(233,30,140,0.15) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{
          display: 'inline-block',
          padding: '6px 18px',
          borderRadius: '20px',
          background: 'rgba(233,30,140,0.12)',
          border: '1px solid rgba(233,30,140,0.3)',
          fontSize: '13px',
          color: '#e91e8c',
          fontWeight: '600',
          marginBottom: '24px',
        }}>
          Built on Polkadot Hub
        </div>

        <h1 style={{
          fontSize: 'clamp(32px, 5vw, 56px)',
          fontWeight: '800',
          lineHeight: '1.15',
          margin: '0 auto 20px',
          maxWidth: '700px',
        }}>
          Borrow Against Your DOT.{' '}
          <span style={{
            background: 'linear-gradient(90deg, #e91e8c, #ff6ec7)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            Send Anywhere.
          </span>
        </h1>

        <p style={{
          fontSize: '18px', color: '#999', maxWidth: '560px', margin: '0 auto 36px',
          lineHeight: '1.7',
        }}>
          Collateralize your DOT, borrow USDC stablecoins, and send them
          cross-chain to any recipient — all in one transaction. No selling.
          No intermediaries. No waiting.
        </p>

        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <button
              onClick={openConnectModal}
              style={{
                padding: '16px 48px',
                fontSize: '17px',
                fontWeight: 'bold',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                background: 'linear-gradient(135deg, #e91e8c, #b8157a)',
                color: '#fff',
                boxShadow: '0 4px 24px rgba(233,30,140,0.35)',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.04)';
                e.currentTarget.style.boxShadow = '0 6px 32px rgba(233,30,140,0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 4px 24px rgba(233,30,140,0.35)';
              }}
            >
              Launch App
            </button>
          )}
        </ConnectButton.Custom>
      </section>

      {/* Stats Bar */}
      <section style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '64px',
        padding: '40px 32px',
        borderTop: '1px solid #1a1a3e',
        borderBottom: '1px solid #1a1a3e',
        flexWrap: 'wrap',
      }}>
        <StatBox value="150%" label="Collateral Ratio" />
        <StatBox value="5%" label="APR Interest" />
        <StatBox value="< $0.01" label="Transaction Fee" />
        <StatBox value="~1s" label="Settlement Time" />
      </section>

      {/* Features */}
      <section style={{ maxWidth: '960px', margin: '0 auto', padding: '0 32px 72px' }}>
        <h2 style={{ textAlign: 'center', fontSize: '28px', fontWeight: '700', marginBottom: '40px' }}>
          How DotBridge Works
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
        }}>
          <FeatureCard
            icon="🔄"
            title="Wrap DOT"
            desc="Convert native DOT into WDOT (ERC-20) to use as on-chain collateral."
          />
          <FeatureCard
            icon="🏦"
            title="Deposit & Borrow"
            desc="Lock WDOT in the vault, borrow USDC at 150% collateral ratio with 5% APR."
          />
          <FeatureCard
            icon="🌍"
            title="Send Cross-Chain"
            desc="Route USDC to any EVM chain via Hyperbridge — Base, Optimism, Arbitrum."
          />
          <FeatureCard
            icon="🛡️"
            title="Keep Your DOT"
            desc="Repay the loan anytime to unlock your collateral. Your DOT stays yours."
          />
        </div>
      </section>

      {/* How It Works Steps */}
      <section style={{
        maxWidth: '560px', margin: '0 auto', padding: '0 32px 72px',
      }}>
        <h2 style={{ textAlign: 'center', fontSize: '28px', fontWeight: '700', marginBottom: '36px' }}>
          One Transaction. Four Steps.
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <StepPill num={1} label="Wrap your native DOT into WDOT (ERC-20)" />
          <div style={{ marginLeft: '19px', borderLeft: '2px dashed #2a2a4e', height: '12px' }} />
          <StepPill num={2} label="Deposit WDOT as collateral into the vault" />
          <div style={{ marginLeft: '19px', borderLeft: '2px dashed #2a2a4e', height: '12px' }} />
          <StepPill num={3} label="Borrow USDC — optionally send cross-chain" />
          <div style={{ marginLeft: '19px', borderLeft: '2px dashed #2a2a4e', height: '12px' }} />
          <StepPill num={4} label="Repay loan to unlock and reclaim your DOT" />
        </div>
      </section>

      {/* Why Polkadot */}
      <section style={{
        maxWidth: '800px', margin: '0 auto', padding: '0 32px 72px',
        textAlign: 'center',
      }}>
        <h2 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '32px' }}>
          Why Polkadot?
        </h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '20px',
        }}>
          {[
            { title: 'EVM on Polkadot Hub', desc: 'Full Solidity support backed by Polkadot shared security.' },
            { title: 'Hyperbridge', desc: 'Trustless cross-chain messaging to any EVM chain.' },
            { title: 'Near-Zero Gas', desc: 'Fractions of a cent per transaction — critical for small remittances.' },
          ].map((item) => (
            <div key={item.title} style={{
              background: '#12122a',
              border: '1px solid #2a2a4e',
              borderRadius: '12px',
              padding: '24px 20px',
            }}>
              <h4 style={{ margin: '0 0 8px', color: '#e91e8c', fontSize: '15px' }}>{item.title}</h4>
              <p style={{ margin: 0, fontSize: '14px', color: '#888', lineHeight: '1.6' }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{
        textAlign: 'center',
        padding: '60px 32px 80px',
        borderTop: '1px solid #1a1a3e',
      }}>
        <h2 style={{ fontSize: '26px', fontWeight: '700', marginBottom: '12px' }}>
          Ready to send money without the middlemen?
        </h2>
        <p style={{ color: '#888', fontSize: '15px', marginBottom: '28px' }}>
          Connect your wallet and start borrowing against your DOT in seconds.
        </p>
        <ConnectButton.Custom>
          {({ openConnectModal }) => (
            <button
              onClick={openConnectModal}
              style={{
                padding: '16px 48px',
                fontSize: '17px',
                fontWeight: 'bold',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                background: 'linear-gradient(135deg, #e91e8c, #b8157a)',
                color: '#fff',
                boxShadow: '0 4px 24px rgba(233,30,140,0.35)',
              }}
            >
              Connect Wallet
            </button>
          )}
        </ConnectButton.Custom>
      </section>

      {/* Footer */}
      <footer style={{
        textAlign: 'center',
        padding: '24px 32px',
        borderTop: '1px solid #1a1a3e',
        color: '#555',
        fontSize: '13px',
      }}>
        DotBridge — Built for the Polkadot Prodigy Hackathon 2025
      </footer>
    </>
  );
}

/* ───── Connected App ───── */
function ConnectedApp() {
  const depositRef = useRef<HTMLDivElement>(null);

  return (
    <main style={{
      maxWidth: '960px',
      margin: '0 auto',
      padding: '40px 32px 80px',
    }}>
      <div style={{
        textAlign: 'center',
        marginBottom: '40px',
      }}>
        <h1 style={{
          fontSize: '28px',
          fontWeight: '700',
          margin: '0 0 8px',
        }}>
          <span style={{
            background: 'linear-gradient(90deg, #e91e8c, #ff6ec7)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>DotBridge</span> Dashboard
        </h1>
        <p style={{ color: '#666', fontSize: '14px', margin: 0 }}>
          Manage your collateral, borrow USDC, and send remittances.
        </p>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '24px',
        alignItems: 'start',
      }}>
        {/* Left Column: Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div ref={depositRef}>
            <DepositFlow />
          </div>
        </div>

        {/* Right Column: Borrow */}
        <div>
          <BorrowPanel />
        </div>
      </div>

      <div style={{ marginTop: '32px' }}>
        <Dashboard depositRef={depositRef} />
      </div>
    </main>
  );
}

/* ───── App Shell ───── */
function AppContent() {
  const { isConnected } = useAccount();

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
        position: 'sticky',
        top: 0,
        background: 'rgba(10,10,26,0.92)',
        backdropFilter: 'blur(12px)',
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '8px',
            background: 'linear-gradient(135deg, #e91e8c, #b8157a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 'bold', fontSize: '16px',
          }}>D</div>
          <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>
            DotBridge
          </span>
          <span style={{
            fontSize: '11px', color: '#666', marginTop: '2px',
            padding: '2px 8px', background: '#1a1a2e', borderRadius: '4px',
          }}>
            Testnet
          </span>
        </div>
        <ConnectWallet />
      </header>

      {isConnected ? <ConnectedApp /> : <LandingPage />}
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
