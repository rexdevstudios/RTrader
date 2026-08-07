'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Wallet, ShieldCheck, ShieldAlert, Zap } from 'lucide-react';

export default function LoginPage() {
  const { isConnected, userRole, walletAddress: currentWallet, isConnecting, connectWallet, connectMetaMask, disconnectWallet } = useAuth();
  const [walletAddress, setWalletAddress] = useState<string>(currentWallet || '');
  const [challengeMessage, setChallengeMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [session, setSession] = useState<any | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasMetaMask, setHasMetaMask] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect MetaMask on client
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      setHasMetaMask(true);
      // Try to check if already connected
      (window as any).ethereum.request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
          if (accounts && accounts.length > 0 && !walletAddress) {
            setWalletAddress(accounts[0]);
          }
        })
        .catch(() => {});
    }
  }, [walletAddress]);

  // Primary Action: Real Dynamic MetaMask Connect & Cryptographic Sign
  const handleMetaMaskSignIn = async () => {
    setError(null);
    const result = await connectMetaMask();
    if (!result.success) {
      setError(result.error || 'MetaMask sign-in failed');
    }
  };

  // Step 1: Request SIWE Challenge (For manual or custom Web3 flow)
  const handleRequestChallenge = async () => {
    if (!walletAddress) {
      setError('Please provide a valid Ethereum wallet address (or connect with MetaMask).');
      return;
    }
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

  // Step 2: SIWE Signature Approval & Verification
  const handleVerifySignature = async () => {
    if (!nonce || !challengeMessage || !walletAddress) return;
    setIsSubmitting(true);
    setError(null);
    try {
      let signature: string;

      // If MetaMask is installed, request real personal_sign signature
      if (typeof window !== 'undefined' && (window as any).ethereum) {
        const { ethers } = await import('ethers');
        const hexMessage = ethers.hexlify(ethers.toUtf8Bytes(challengeMessage));
        signature = await (window as any).ethereum.request({
          method: 'personal_sign',
          params: [hexMessage, walletAddress],
        });
      } else {
        // Dev fallback mock signature
        signature = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b';
      }
      
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          chainType: 'EVM',
          signature,
          nonce,
          message: challengeMessage,
        }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setSession(json.data);
        connectWallet(walletAddress, 'TRADER');
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
    <div style={{ maxWidth: '520px', margin: '64px auto', padding: '0 24px' }}>
      <div className="bg-panel" style={{ padding: '32px', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
        <div style={{ marginBottom: '32px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 900, margin: '0 0 8px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <ShieldCheck size={28} className="text-accent" /> SIWE Wallet Authentication
          </h2>
          <p className="text-muted" style={{ fontSize: '14px', margin: 0 }}>
            Sign-In with Ethereum (EIP-4361)
          </p>
        </div>

        {error && (
          <div className="badge badge-admin" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', marginBottom: '24px', width: '100%' }}>
            <ShieldAlert size={16} /> {error}
          </div>
        )}

        {isConnected ? (
          <div className="badge badge-trader" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px', width: '100%', alignItems: 'flex-start' }}>
            <div style={{ fontWeight: 900, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={20} /> Authenticated Session Active!
            </div>
            <div>Wallet: <strong style={{ fontFamily: 'var(--font-mono)' }}>{currentWallet}</strong></div>
            <div>Active Role: <strong>{userRole}</strong></div>
            
            <button
              onClick={disconnectWallet}
              className="btn-destructive"
              style={{ marginTop: '12px' }}
            >
              Disconnect Wallet
            </button>
          </div>
        ) : (
          <div className="flex-col gap-lg">
            {/* PRIMARY: Dynamic MetaMask Connect & Sign Button */}
            <div>
              <button
                onClick={handleMetaMaskSignIn}
                disabled={isConnecting}
                className="btn-primary"
                style={{
                  width: '100%',
                  padding: '16px',
                  justifyContent: 'center',
                  fontSize: '16px',
                  boxShadow: hasMetaMask ? 'var(--shadow-neon)' : 'none',
                }}
              >
                <Wallet size={24} />
                {isConnecting ? 'Waiting for Signature...' : hasMetaMask ? 'Sign-In with MetaMask (SIWE)' : 'Connect Web3 Wallet'}
              </button>
              <div className="text-muted" style={{ fontSize: '12px', marginTop: '12px', textAlign: 'center' }}>
                {hasMetaMask ? '✓ MetaMask detected. Click above to authenticate.' : 'ℹ️ MetaMask extension not detected. You can use manual input below.'}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0', color: 'var(--color-muted)', fontSize: '12px', fontWeight: 800 }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border)' }}></div>
              <span style={{ padding: '0 16px', letterSpacing: '1px' }}>OR MANUAL VERIFICATION</span>
              <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--color-border)' }}></div>
            </div>

            {/* Manual Input Flow */}
            <div className="flex-col gap-sm">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px' }}>
                CUSTOM WALLET ADDRESS
              </label>
              <input
                type="text"
                placeholder="0x..."
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="input"
                style={{ width: '100%', padding: '12px', fontFamily: 'var(--font-mono)' }}
              />
            </div>

            {challengeMessage ? (
              <div className="flex-col gap-sm">
                <div style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>CHALLENGE MESSAGE TO SIGN</div>
                <div className="bg-panel" style={{ padding: '12px', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                  {challengeMessage}
                </div>
                <button
                  onClick={handleVerifySignature}
                  disabled={isSubmitting}
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {isSubmitting ? 'Verifying Signature...' : 'Sign Challenge & Complete SIWE'}
                </button>
              </div>
            ) : (
              <button
                onClick={handleRequestChallenge}
                disabled={isSubmitting || !walletAddress}
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', opacity: walletAddress ? 1 : 0.6 }}
              >
                {isSubmitting ? 'Generating...' : 'Generate SIWE Challenge Nonce'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
