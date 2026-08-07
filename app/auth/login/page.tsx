'use client';

import React, { useState } from 'react';

export default function LoginPage() {
  const [walletAddress, setWalletAddress] = useState('0x71C7656EC7ab88b098defB751B7401B5f6d8976F');
  const [challengeMessage, setChallengeMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Request SIWE Challenge
  const handleRequestChallenge = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, chainType: 'EVM' }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setNonce(json.data.nonce);
        setChallengeMessage(json.data.messageToSign);
      } else {
        setError(json.error?.message || 'Failed to request challenge');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Simulate SIWE Signature & Verify Session
  const handleVerifySignature = async () => {
    if (!nonce || !challengeMessage) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const mockSignature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b';
      
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          chainType: 'EVM',
          signature: mockSignature,
          nonce,
        }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setSession(json.data);
      } else {
        setError(json.error?.message || 'SIWE verification failed');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '480px', margin: '40px auto', padding: '24px', backgroundColor: '#06080E', borderRadius: '8px', border: '1px solid #141A26', textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#E2E8F0' }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 900, margin: '0 0 4px 0', color: '#00E5FF', letterSpacing: '-0.5px' }}>
          🔐 SIWE Wallet Authentication
        </h2>
        <p style={{ color: '#64748B', fontSize: '11px', margin: 0 }}>
          Sign-In with Ethereum (EIP-4361) • Stateless Token Cookie (`rtrader_session`)
        </p>
      </div>

      {/* Wallet Input */}
      <div style={{ marginBottom: '16px', textAlign: 'left' }}>
        <label style={{ color: '#94A3B8', fontSize: '10px', fontWeight: 700, display: 'block', marginBottom: '4px', letterSpacing: '0.5px' }}>
          EVM WALLET ADDRESS
        </label>
        <input
          type="text"
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0C1017', color: '#00E5FF', border: '1px solid #162232', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box' }}
        />
      </div>

      {error && (
        <div style={{ backgroundColor: '#2A0413', border: '1px solid #FF1744', color: '#FF5252', padding: '8px 10px', borderRadius: '4px', fontSize: '11px', marginBottom: '16px', textAlign: 'left' }}>
          ⚠️ {error}
        </div>
      )}

      {session ? (
        <div style={{ backgroundColor: '#041E15', border: '1px solid #00E676', color: '#00E676', padding: '14px', borderRadius: '6px', textAlign: 'left', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ fontWeight: 900, fontSize: '13px', marginBottom: '6px', color: '#00E676' }}>✅ SIWE Session Active!</div>
          <div>User ID: <strong>{session.userId}</strong></div>
          <div>Roles: <strong>{session.roles?.join(', ')}</strong></div>
          <div>Status: <strong>{session.status}</strong></div>
          <div style={{ marginTop: '8px', color: '#B9F6CA', fontSize: '10px' }}>Cookie: `rtrader_session` set on client</div>
        </div>
      ) : challengeMessage ? (
        <div style={{ textAlign: 'left' }}>
          <div style={{ color: '#64748B', fontSize: '10px', fontWeight: 700, marginBottom: '4px' }}>CHALLENGE MESSAGE TO SIGN</div>
          <div style={{ padding: '8px 10px', backgroundColor: '#0C1017', borderRadius: '4px', border: '1px solid #162232', marginBottom: '16px', fontSize: '11px', fontFamily: 'monospace', color: '#00E5FF', whiteSpace: 'pre-wrap', fontVariantNumeric: 'tabular-nums' }}>
            {challengeMessage}
          </div>
          <button
            onClick={handleVerifySignature}
            disabled={isSubmitting}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', backgroundColor: '#00E676', color: '#000000', fontWeight: 900, border: 'none', cursor: 'pointer', fontSize: '12px' }}
          >
            {isSubmitting ? 'Verifying Signature...' : 'Sign & Verify SIWE Signature'}
          </button>
        </div>
      ) : (
        <button
          onClick={handleRequestChallenge}
          disabled={isSubmitting}
          style={{ width: '100%', padding: '10px', borderRadius: '4px', backgroundColor: '#00E5FF', color: '#000000', fontWeight: 900, border: 'none', cursor: 'pointer', fontSize: '12px' }}
        >
          {isSubmitting ? 'Generating Challenge...' : 'Request SIWE Challenge (EIP-4361)'}
        </button>
      )}
    </div>
  );
}
