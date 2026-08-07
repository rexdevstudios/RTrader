import React from 'react';

export const metadata = {
  title: 'RTrader | Degen Launchpad, Trading Terminal & AI Agent Platform',
  description: 'Decision-complete execution platform for crypto launchpads, Binance trading terminal, and proposal-only AI agents.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#0B0E14', color: '#F3F4F6' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', backgroundColor: '#131822', borderBottom: '1px solid #1E2638' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 800, fontSize: '20px', background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              RTRADER PLATFORM
            </span>
            <span style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#1E293B', color: '#94A3B8', border: '1px solid #334155' }}>
              100% Native dRPC
            </span>
          </div>
          <nav style={{ display: 'flex', gap: '20px', fontSize: '14px', fontWeight: 500 }}>
            <a href="/dashboard" style={{ color: '#94A3B8', textDecoration: 'none' }}>Dashboard</a>
            <a href="/launchpad" style={{ color: '#94A3B8', textDecoration: 'none' }}>Launchpad</a>
            <a href="/trading" style={{ color: '#94A3B8', textDecoration: 'none' }}>Trading Terminal</a>
            <a href="/agent" style={{ color: '#94A3B8', textDecoration: 'none' }}>AI Proposals</a>
            <a href="/billing" style={{ color: '#94A3B8', textDecoration: 'none' }}>Billing & Credits</a>
          </nav>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '6px', backgroundColor: '#0F172A', border: '1px solid #1E293B', color: '#38BDF8' }}>
              Credits: <strong>15,000 / 15,000</strong>
            </div>
            <a href="/auth/login" style={{ fontSize: '13px', fontWeight: 600, padding: '8px 16px', borderRadius: '6px', backgroundColor: '#2563EB', color: '#FFF', textDecoration: 'none' }}>
              Connect Wallet (SIWE)
            </a>
          </div>
        </header>
        <main style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
