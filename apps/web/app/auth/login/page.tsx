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
      // In production, signature comes from window.ethereum.request({ method: 'personal_sign' })
      // For simulation check, pass a mock signature
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
    <div style={{ maxWidth: '520px', margin: '40px auto', padding: '32px', backgroundColor: '#131822', borderRadius: '12px', border: '1px solid #1E2638', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px 0', color: '#F8FAFC' }}>
        🔐 SIWE Wallet Authentication
      </h2>
      <p style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '24px' }}>
        Sign-In with Ethereum (EIP-4361) with Rate Limiter protection and RBAC session generation.
      </p>

      {/* Wallet Input */}
      <div style={{ marginBottom: '16px', textAlign: 'left' }}>
        <label style={{ color: '#94A3B8', fontSize: '12px', display: 'block', marginBottom: '4px' }}>
          WALLET ADDRESS
        </label>
        <input
          type="text"
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
          style={{ width: '100%', padding: '10px', backgroundColor: '#0B0E14', color: '#F8FAFC', border: '1px solid #1E293B', borderRadius: '6px', fontFamily: 'monospace', fontSize: '13px' }}
        />
      </div>

      {error && (
        <div style={{ backgroundColor: '#831843', color: '#F472B6', padding: '10px', borderRadius: '6px', fontSize: '13px', marginBottom: '16px', textAlign: 'left' }}>
          ⚠️ {error}
        </div>
      )}

      {session ? (
        <div style={{ backgroundColor: '#065F46', color: '#34D399', padding: '16px', borderRadius: '8px', textAlign: 'left', fontSize: '13px' }}>
          <div><strong>✅ SIWE Session Active!</strong></div>
          <div>User ID: {session.userId}</div>
          <div>Roles: {session.roles?.join(', ')}</div>
          <div>Status: {session.status}</div>
        </div>
      ) : challengeMessage ? (
        <div style={{ textAlign: 'left' }}>
          <div style={{ padding: '12px', backgroundColor: '#0B0E14', borderRadius: '6px', border: '1px solid #1E293B', marginBottom: '16px', fontSize: '12px', fontFamily: 'monospace', color: '#38BDF8', whiteSpace: 'pre-wrap' }}>
            {challengeMessage}
          </div>
          <button
            onClick={handleVerifySignature}
            disabled={isSubmitting}
            style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: '#16A34A', color: '#FFF', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '15px' }}
          >
            {isSubmitting ? 'Verifying...' : 'Sign & Verify SIWE Signature'}
          </button>
        </div>
      ) : (
        <button
          onClick={handleRequestChallenge}
          disabled={isSubmitting}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', backgroundColor: '#2563EB', color: '#FFF', fontWeight: 600, border: 'none', cursor: 'pointer', fontSize: '15px' }}
        >
          {isSubmitting ? 'Generating Challenge...' : 'Request SIWE Challenge (EIP-4361)'}
        </button>
      )}
    </div>
  );
}
