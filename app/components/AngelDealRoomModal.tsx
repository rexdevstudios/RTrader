'use client';

import React, { useState } from 'react';
import { ShieldCheck, Users, X, CheckCircle2, AlertCircle, Coins, ArrowRight } from 'lucide-react';
import { ethers } from 'ethers';
import {
  getContractConfiguration,
  ensureBaseNetwork,
  getBrowserSigner,
  getLaunchpadContract,
  normalizeWeb3Error,
  getExplorerUrl,
} from '../../packages/launchpad/web3-provider';

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
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCheckEligibility = async () => {
    if (!connectedWallet) {
      setActionFeedback('⚠️ Silakan hubungkan dompet Web3 terlebih dahulu.');
      return;
    }
    setActionFeedback(null);
    try {
      const res = await fetch(
        `/api/launchpad/whitelist?tokenAddress=${encodeURIComponent(targetToken)}&walletAddress=${encodeURIComponent(connectedWallet)}`
      );
      const json = await res.json();
      if (json.success && json.data) {
        setWhitelistCheck({
          checked: true,
          isEligible: json.data.isWhitelisted,
          proof: json.data.merkleProof,
          root: json.data.merkleRoot,
        });
        if (!json.data.isWhitelisted) {
          setActionFeedback('❌ Dompet Anda tidak terdaftar dalam whitelist alokasi kampanye ini.');
        }
      } else {
        setActionFeedback(`❌ Gagal verifikasi whitelist: ${json.error?.message || 'Error'}`);
      }
    } catch (err: any) {
      setActionFeedback(`❌ Error verifikasi: ${err.message}`);
    }
  };

  const handleClaimSeed = async () => {
    setIsClaiming(true);
    setActionFeedback(null);
    try {
      if (!connectedWallet) {
        setActionFeedback('⚠️ Silakan hubungkan dompet Web3 MetaMask terlebih dahulu.');
        return;
      }

      // 1. Contract Address Verification Gate (Rule 6)
      const contractConfig = getContractConfiguration();
      if (!contractConfig.isConfigured || !contractConfig.contractAddress) {
        setActionFeedback(`❌ ${contractConfig.message} Pembelian on-chain dinonaktifkan demi keamanan.`);
        return;
      }

      // 2. Base Network Validation (Rule 8)
      const networkCheck = await ensureBaseNetwork('0x2105');
      if (!networkCheck.success) {
        setActionFeedback(`❌ ${networkCheck.error || 'Harap beralih ke jaringan Base'}`);
        return;
      }

      if (!whitelistCheck || !whitelistCheck.isEligible) {
        setActionFeedback('❌ Alamat dompet tidak memiliki alokasi whitelist yang valid.');
        return;
      }

      // 3. Real Web3 Execution via MetaMask Signer
      setActionFeedback('⏳ Menghitung estimasi biaya pembelian...');
      const signer = await getBrowserSigner();
      const contract = getLaunchpadContract(signer);

      const tokenAmountWei = ethers.parseEther(allocationAmount || '1000');
      const costWei = await contract.calculateCost(targetToken, tokenAmountWei);

      setActionFeedback(`⏳ Menunggu konfirmasi transaksi di MetaMask (Biaya: ${ethers.formatEther(costWei)} ETH)...`);
      const tx = await contract.buyWhitelistTokens(targetToken, tokenAmountWei, whitelistCheck.proof, {
        value: costWei,
      });

      setActionFeedback(`📡 Transaksi terkirim: ${tx.hash}. Menunggu konfirmasi blok Base...`);
      const receipt = await tx.wait(1);

      if (receipt && receipt.status === 1) {
        setTxHash(tx.hash);
        setClaimSuccess(true);
        setActionFeedback(
          `✅ Pembelian alokasi Angel Investor berhasil! Blok #${receipt.blockNumber}. Hash: ${tx.hash}`
        );
      } else {
        setActionFeedback('❌ Transaksi gagal dieksekusi di blockchain Base.');
      }
    } catch (err: any) {
      setActionFeedback(`❌ Gagal klaim seed on-chain: ${normalizeWeb3Error(err)}`);
    } finally {
      setIsClaiming(false);
    }
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

            {actionFeedback && (
              <div
                style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  backgroundColor: actionFeedback.includes('✅')
                    ? 'rgba(16, 185, 129, 0.1)'
                    : actionFeedback.includes('❌') || actionFeedback.includes('BLOCKED')
                    ? 'rgba(239, 68, 68, 0.1)'
                    : 'rgba(0, 229, 255, 0.1)',
                  border: `1px solid ${
                    actionFeedback.includes('✅')
                      ? '#10B981'
                      : actionFeedback.includes('❌') || actionFeedback.includes('BLOCKED')
                      ? '#EF4444'
                      : '#00E5FF'
                  }`,
                  color: actionFeedback.includes('✅')
                    ? '#10B981'
                    : actionFeedback.includes('❌') || actionFeedback.includes('BLOCKED')
                    ? '#EF4444'
                    : '#00E5FF',
                }}
              >
                {actionFeedback}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
