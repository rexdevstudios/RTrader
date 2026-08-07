'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

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
        signature = await (window as any).ethereum.request({
          method: 'personal_sign',
          params: [challengeMessage, walletAddress],
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

  const handleQuickConnect = (address: string, role: any) => {
    setWalletAddress(address);
    connectWallet(address, role);
  };

  return (
    <div style={{ maxWidth: '520px', margin: '40px auto', padding: '24px', backgroundColor: '#06080E', borderRadius: '8px', border: '1px solid #141A26', textAlign: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#E2E8F0' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 900, margin: '0 0 4px 0', color: '#00E5FF', letterSpacing: '-0.5px' }}>
          🔐 SIWE Wallet Authentication
        </h2>
        <p style={{ color: '#64748B', fontSize: '11px', margin: 0 }}>
          Sign-In with Ethereum (EIP-4361) • Cryptographic Signature Verification
        </p>
      </div>

      {error && (
        <div style={{ backgroundColor: '#2A0413', border: '1px solid #FF1744', color: '#FF5252', padding: '10px 12px', borderRadius: '4px', fontSize: '11px', marginBottom: '16px', textAlign: 'left' }}>
          ⚠️ {error}
        </div>
      )}

      {isConnected ? (
        <div style={{ backgroundColor: '#041E15', border: '1px solid #00E676', color: '#00E676', padding: '16px', borderRadius: '6px', textAlign: 'left', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
          <div style={{ fontWeight: 900, fontSize: '14px', marginBottom: '6px', color: '#00E676' }}>✅ Authenticated Session Active!</div>
          <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Wallet: <strong style={{ color: '#E2E8F0', fontFamily: 'monospace' }}>{currentWallet}</strong></div>
          <div style={{ color: '#94A3B8', marginBottom: '12px' }}>Active Role: <strong style={{ color: userRole === 'SYSTEM_ADMIN' ? '#FFD600' : '#00E5FF' }}>{userRole}</strong></div>
          
          <button
            onClick={disconnectWallet}
            style={{ padding: '8px 14px', backgroundColor: '#2A0413', color: '#FF5252', border: '1px solid #FF1744', borderRadius: '4px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
          >
            Disconnect Wallet
          </button>
        </div>
      ) : (
        <>
          {/* PRIMARY: Dynamic MetaMask Connect & Sign Button */}
          <div style={{ marginBottom: '24px' }}>
            <button
              onClick={handleMetaMaskSignIn}
              disabled={isConnecting}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '6px',
                backgroundColor: hasMetaMask ? '#E2761B' : '#1E293B',
                color: '#FFFFFF',
                fontWeight: 900,
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxShadow: hasMetaMask ? '0 0 20px rgba(226, 118, 27, 0.3)' : 'none',
              }}
            >
              <span style={{ fontSize: '18px' }}>🦊</span>
              {isConnecting ? 'Waiting for MetaMask Signature...' : hasMetaMask ? 'Sign-In with MetaMask (EIP-4361)' : 'Connect Web3 Wallet (MetaMask)'}
            </button>
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '6px' }}>
              {hasMetaMask ? '✓ MetaMask detected in browser. Click above to request account & sign.' : 'ℹ️ MetaMask extension not detected. You can install MetaMask or use manual input below.'}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', color: '#475569', fontSize: '10px', fontWeight: 800 }}>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }}></div>
            <span style={{ padding: '0 10px', letterSpacing: '1px' }}>OR CUSTOM / LOCAL DEV TESTING</span>
            <div style={{ flex: 1, height: '1px', backgroundColor: '#1E293B' }}></div>
          </div>

          {/* Quick-Connect Role Presets */}
          <div style={{ marginBottom: '20px', textAlign: 'left' }}>
            <label style={{ color: '#94A3B8', fontSize: '10px', fontWeight: 700, display: 'block', marginBottom: '8px', letterSpacing: '0.5px' }}>
              ⚡ 1-CLICK ROLE PRESET SWITCHER (SANDBOX / DEMO)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <button
                type="button"
                onClick={() => handleQuickConnect('0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'TRADER')}
                style={{ backgroundColor: userRole === 'TRADER' ? '#00E676' : '#0C1017', color: userRole === 'TRADER' ? '#000000' : '#E2E8F0', border: '1px solid #1E293B', padding: '8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}
              >
                📈 Pro Trader
                <span style={{ display: 'block', fontSize: '9px', color: userRole === 'TRADER' ? '#000000' : '#64748B' }}>0x71C7...976F</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickConnect('0x90F79bf6EB2c4f870365E785982E1f101E93b906', 'CREATOR')}
                style={{ backgroundColor: userRole === 'CREATOR' ? '#00E5FF' : '#0C1017', color: userRole === 'CREATOR' ? '#000000' : '#E2E8F0', border: '1px solid #1E293B', padding: '8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}
              >
                🚀 Token Creator
                <span style={{ display: 'block', fontSize: '9px', color: userRole === 'CREATOR' ? '#000000' : '#64748B' }}>0x90F7...b906</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickConnect('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', 'SYSTEM_ADMIN')}
                style={{ backgroundColor: userRole === 'SYSTEM_ADMIN' ? '#FFD600' : '#0C1017', color: userRole === 'SYSTEM_ADMIN' ? '#000000' : '#E2E8F0', border: '1px solid #1E293B', padding: '8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}
              >
                👑 System Admin
                <span style={{ display: 'block', fontSize: '9px', color: userRole === 'SYSTEM_ADMIN' ? '#000000' : '#64748B' }}>0x3C44...93BC</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickConnect('0x976EA74026E726554dB657fA54763abd0C3a0aa9', 'SUPER_ADMIN')}
                style={{ backgroundColor: userRole === 'SUPER_ADMIN' ? '#D500F9' : '#0C1017', color: userRole === 'SUPER_ADMIN' ? '#000000' : '#E2E8F0', border: '1px solid #1E293B', padding: '8px', borderRadius: '4px', fontSize: '11px', fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}
              >
                🛡️ Super Admin
                <span style={{ display: 'block', fontSize: '9px', color: userRole === 'SUPER_ADMIN' ? '#000000' : '#64748B' }}>0x976E...0aa9</span>
              </button>
            </div>
          </div>

          {/* Manual Input Flow */}
          <div style={{ marginBottom: '16px', textAlign: 'left' }}>
            <label style={{ color: '#94A3B8', fontSize: '10px', fontWeight: 700, display: 'block', marginBottom: '4px', letterSpacing: '0.5px' }}>
              CUSTOM WALLET ADDRESS
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', backgroundColor: '#0C1017', color: '#00E5FF', border: '1px solid #162232', borderRadius: '4px', fontFamily: 'monospace', fontSize: '12px', fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box' }}
            />
          </div>

          {challengeMessage ? (
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: '#64748B', fontSize: '10px', fontWeight: 700, marginBottom: '4px' }}>CHALLENGE MESSAGE TO SIGN</div>
              <div style={{ padding: '8px 10px', backgroundColor: '#0C1018', borderRadius: '4px', border: '1px solid #162232', marginBottom: '16px', fontSize: '11px', fontFamily: 'monospace', color: '#00E5FF', whiteSpace: 'pre-wrap', fontVariantNumeric: 'tabular-nums' }}>
                {challengeMessage}
              </div>
              <button
                onClick={handleVerifySignature}
                disabled={isSubmitting}
                style={{ width: '100%', padding: '10px', borderRadius: '4px', backgroundColor: '#00E676', color: '#000000', fontWeight: 900, border: 'none', cursor: 'pointer', fontSize: '12px' }}
              >
                {isSubmitting ? 'Verifying Signature...' : 'Sign Challenge & Complete SIWE'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleRequestChallenge}
              disabled={isSubmitting || !walletAddress}
              style={{ width: '100%', padding: '10px', borderRadius: '4px', backgroundColor: '#00E5FF', color: '#000000', fontWeight: 900, border: 'none', cursor: walletAddress ? 'pointer' : 'not-allowed', fontSize: '12px', opacity: walletAddress ? 1 : 0.6 }}
            >
              {isSubmitting ? 'Generating Challenge...' : 'Generate SIWE Challenge Nonce'}
            </button>
          )}
        </>
      )}
    </div>
  );
}


