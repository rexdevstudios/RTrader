import React from 'react';

export default function LoginPage() {
  return (
    <div style={{ maxWidth: '480px', margin: '40px auto', padding: '32px', backgroundColor: '#131822', borderRadius: '12px', border: '1px solid #1E2638', textAlign: 'center' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0' }}>SIWE Wallet Authentication</h2>
      <p style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '24px' }}>
        Sign-In with Ethereum (EIP-4361) to access the Degen Launchpad, Trading Terminal, and AI Agent Platform.
      </p>

      <div style={{ padding: '16px', backgroundColor: '#0B0E14', borderRadius: '8px', border: '1px solid #1E293B', marginBottom: '24px', textAlign: 'left', fontSize: '13px', fontFamily: 'monospace' }}>
        <div><strong>Domain:</strong> rtrader.io</div>
        <div><strong>Statement:</strong> Sign in to RTrader Platform with your Web3 Wallet.</div>
        <div><strong>URI:</strong> https://rtrader.io/auth/login</div>
        <div><strong>Version:</strong> 1</div>
        <div><strong>Chain ID:</strong> 8453 (Base Mainnet)</div>
      </div>

      <button style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: '#2563EB', color: '#FFF', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '15px' }}>
        Sign SIWE Message (EIP-4361)
      </button>
    </div>
  );
}
