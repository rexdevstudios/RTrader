'use client';

import React, { useState } from 'react';
import { ShieldCheck, Users, X, CheckCircle2, AlertCircle, Coins, ArrowRight } from 'lucide-react';

interface AngelDealRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectedWallet?: string;
}

export const AngelDealRoomModal: React.FC<AngelDealRoomModalProps> = ({
  isOpen,
  onClose,
  connectedWallet,
}) => {
  const [targetToken, setTargetToken] = useState('0xTokenAlpha1234567890abcdef');
  const [allocationAmount, setAllocationAmount] = useState('50000');
  const [whitelistCheck, setWhitelistCheck] = useState<{
    checked: boolean;
    isEligible: boolean;
    proof: string[];
    root: string;
  } | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);

  if (!isOpen) return null;

  const handleCheckEligibility = () => {
    // Simulasi verifikasi Merkle proof untuk dompet angel yang terhubung
    setWhitelistCheck({
      checked: true,
      isEligible: true,
      proof: ['0x1111111111111111111111111111111111111111111111111111111111111111'],
      root: '0x2cc5811b29aa1fb5cf826c2c91700c1538415d3af95dabbebe07280e7865a3e1',
    });
  };

  const handleClaimSeed = () => {
    setIsClaiming(true);
    setTimeout(() => {
      setIsClaiming(false);
      setClaimSuccess(true);
    }, 800);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        className="bg-panel"
        style={{
          width: '100%',
          maxWidth: '520px',
          border: '1px solid #D500F9',
          borderRadius: '12px',
          padding: '24px',
          position: 'relative',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Users size={22} color="#E040FB" />
          <h3 style={{ margin: 0, color: 'var(--color-foreground)', fontSize: '18px', fontWeight: 900 }}>
            Angel Investor Deal Room
          </h3>
        </div>
        <p className="text-muted" style={{ fontSize: '12px', margin: '0 0 16px 0' }}>
          Cryptographic Merkle Proof verification for Private Seed allocations.
        </p>

        <div className="flex-col gap-sm" style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '11px', color: 'var(--color-muted)' }}>Connected Angel Wallet:</label>
          <input
            type="text"
            readOnly
            value={connectedWallet || '0xConnectYourWalletFirst'}
            className="input"
            style={{ padding: '10px', fontSize: '12px', color: '#00E5FF' }}
          />
        </div>

        <div className="flex-col gap-sm" style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '11px', color: 'var(--color-muted)' }}>Target Token Launch Address:</label>
          <input
            type="text"
            value={targetToken}
            onChange={(e) => setTargetToken(e.target.value)}
            className="input"
            style={{ padding: '10px', fontSize: '12px' }}
          />
        </div>

        {!whitelistCheck?.checked ? (
          <button
            onClick={handleCheckEligibility}
            className="btn-primary"
            style={{ width: '100%', padding: '12px', justifyContent: 'center', backgroundColor: '#9C27B0', borderColor: '#BA68C8' }}
          >
            <ShieldCheck size={16} /> Verify Merkle Whitelist Eligibility
          </button>
        ) : (
          <div className="flex-col gap-sm">
            <div
              style={{
                backgroundColor: '#1A0826',
                border: '1px solid #D500F9',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '11px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#E040FB', fontWeight: 800 }}>
                <CheckCircle2 size={14} /> Whitelist Verified: Eligible for Private Seed Round
              </div>
              <div style={{ marginTop: '6px', color: 'var(--color-muted)' }}>
                Merkle Root: <span style={{ color: 'var(--color-foreground)' }}>{whitelistCheck.root.slice(0, 16)}...</span>
              </div>
              <div style={{ color: 'var(--color-muted)' }}>
                Available Allocation: <span style={{ color: '#00E676', fontWeight: 800 }}>100,000 TOKENS (Fixed Rate)</span>
              </div>
            </div>

            {!claimSuccess ? (
              <div className="flex-col gap-xs" style={{ marginTop: '8px' }}>
                <label style={{ fontSize: '11px', color: 'var(--color-muted)' }}>Amount to Purchase:</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="number"
                    value={allocationAmount}
                    onChange={(e) => setAllocationAmount(e.target.value)}
                    className="input"
                    style={{ flex: 1, padding: '10px' }}
                  />
                  <button
                    onClick={handleClaimSeed}
                    disabled={isClaiming}
                    className="btn-primary"
                    style={{ padding: '10px 16px', backgroundColor: '#00E676', color: '#000', fontWeight: 800 }}
                  >
                    <Coins size={16} />
                    {isClaiming ? 'Claiming...' : 'Claim & Buy On-Chain'}
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  backgroundColor: '#041E15',
                  border: '1px solid var(--color-accent)',
                  borderRadius: '8px',
                  padding: '12px',
                  textAlign: 'center',
                  color: 'var(--color-accent)',
                  fontWeight: 800,
                  fontSize: '12px',
                }}
              >
                🎉 Success! {allocationAmount} Seed tokens allocated and locked in your wallet vesting schedule.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
