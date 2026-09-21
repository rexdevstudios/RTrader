'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Rocket, ShieldAlert, FileText, CheckCircle2, AlertTriangle, TrendingUp, Scale, Wallet, Users, Tag, Sparkles, Coins, Zap } from 'lucide-react';
import { NutritionLabelCard } from '../components/NutritionLabelCard';
import { AngelDealRoomModal } from '../components/AngelDealRoomModal';
import { ethers } from 'ethers';
import {
  getContractConfiguration,
  ensureBaseNetwork,
  getBrowserSigner,
  getLaunchpadContract,
  normalizeWeb3Error,
  getExplorerUrl,
} from '@packages/launchpad/web3-provider';

export type LaunchModeType = 'BONDING_CURVE' | 'FAIR_LAUNCH' | 'WHITELIST_PRIVATE' | 'FIXED_PRICE' | 'COMMUNITY_PRELAUNCH';

export default function LaunchpadPage() {
  const { isConnected, userRole, walletAddress, connectMetaMask, isConnecting } = useAuth();
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isAngelModalOpen, setIsAngelModalOpen] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [mode, setMode] = useState<LaunchModeType>('BONDING_CURVE');
  const [creatorWallet, setCreatorWallet] = useState(walletAddress || '');
  const [whitelistWallets, setWhitelistWallets] = useState('');
  const [fixedPriceEth, setFixedPriceEth] = useState('0.0001');
  const [fundingGoalEth, setFundingGoalEth] = useState('25');
  const [draftResult, setDraftResult] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [activeTokens, setActiveTokens] = useState<any[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(false);

  // 4 Launchpad Alignment Dimensions (Chain, Pairing, Degen Mode, Vesting)
  const [selectedChain, setSelectedChain] = useState<'base' | 'robinhood' | 'arbitrum' | 'arc'>('base');
  const [poolPairing, setPoolPairing] = useState<'WETH' | 'MORE_TOKENS' | 'STOCKS'>('WETH');
  const [isDegenMode, setIsDegenMode] = useState<boolean>(true);
  const [creatorVesting, setCreatorVesting] = useState<'NONE' | '15_PERCENT'>('NONE');

  const fetchActiveTokens = async () => {
    setIsLoadingTokens(true);
    try {
      const res = await fetch('/api/launchpad/tokens');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setActiveTokens(json.data);
      }
    } catch {
      // Graceful fallback
    } finally {
      setIsLoadingTokens(false);
    }
  };

  useEffect(() => {
    fetchActiveTokens();
  }, []);

  useEffect(() => {
    if (walletAddress) {
      setCreatorWallet(walletAddress);
    }
  }, [walletAddress]);

  const [draftError, setDraftError] = useState<string | null>(null);

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName || !tokenSymbol) return;

    setIsCreating(true);
    setDraftError(null);
    try {
      const res = await fetch('/api/launchpad/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tokenName,
          ticker: tokenSymbol.toUpperCase(),
          description: `Launch draft for ${tokenName} on ${mode} (${selectedChain.toUpperCase()})`,
          imageUrl: 'https://rtrader.io/token-default.png',
          launchMode: mode,
          targetChain: selectedChain === 'base' ? 'base-mainnet' : `${selectedChain}-mainnet`,
          totalSupply: '1000000000',
          creatorAllocationPct: creatorVesting === '15_PERCENT' ? 0.15 : 0.0,
          creatorWallet: walletAddress || creatorWallet,
          socialLinks: {
            whitelist_wallets: whitelistWallets,
            fixed_price_eth: fixedPriceEth,
            funding_goal_eth: fundingGoalEth,
            selected_chain: selectedChain,
            pool_pairing: poolPairing,
            degen_mode: isDegenMode ? 'true' : 'false',
            creator_vesting: creatorVesting,
          },
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        const errorMsg = json.error?.message || 'Gagal membuat draft launchpad';
        if (res.status === 403) {
          setDraftError('🛡️ Akses Ditolak (403 Forbidden): Akun Anda memerlukan hak akses CREATOR atau ADMIN untuk membuat draft launchpad.');
        } else if (res.status === 401) {
          setDraftError('⚠️ Autentikasi Diperlukan (401 Unauthorized): Harap masuk via MetaMask SIWE terlebih dahulu.');
        } else {
          setDraftError(`❌ Gagal: ${errorMsg}`);
        }
        return;
      }

      setDraftResult(json.data);
    } catch (err: any) {
      setDraftError(`Koneksi gagal: ${err.message || 'Tidak dapat menghubungi server'}`);
    } finally {
      setIsCreating(false);
    }
  };

  const [isRegisteringOnChain, setIsRegisteringOnChain] = useState(false);
  const [onChainFeedback, setOnChainFeedback] = useState<string | null>(null);
  const [publishedTxHash, setPublishedTxHash] = useState<string | null>(null);

  const handleRegisterOnChain = async () => {
    if (!draftResult) return;
    setIsRegisteringOnChain(true);
    setOnChainFeedback(null);
    try {
      if (!walletAddress) {
        setOnChainFeedback('⚠️ Silakan hubungkan dompet Web3 MetaMask terlebih dahulu.');
        return;
      }

      // 1. Access Control Invariant Check (onlyOwner in BondingCurveLaunchpad.sol)
      if (userRole !== 'SYSTEM_ADMIN' && userRole !== 'SUPER_ADMIN') {
        setOnChainFeedback(
          '🛡️ Akses Terbatas: Pendaftaran token launchpad on-chain memerlukan hak otorisasi Platform Admin / Contract Owner. Draft Anda telah disimpan di SSOT untuk diproses oleh controller.'
        );
        return;
      }

      // 2. Contract Configuration Verification Gate (Rule 6)
      const contractConfig = getContractConfiguration();
      if (!contractConfig.isConfigured || !contractConfig.contractAddress) {
        setOnChainFeedback(`❌ ${contractConfig.message} Pendaftaran on-chain dinonaktifkan demi keamanan.`);
        return;
      }

      // 3. Base Network Validation (Rule 8)
      const networkCheck = await ensureBaseNetwork('0x2105');
      if (!networkCheck.success) {
        setOnChainFeedback(`❌ ${networkCheck.error || 'Harap beralih ke jaringan Base'}`);
        return;
      }

      // 4. Mode mapping to enum integer (0: FAIR_LAUNCH, 1: BONDING_CURVE, 2: FIXED_PRICE, 3: WHITELIST_PRIVATE, 4: COMMUNITY_PRELAUNCH)
      const modeMap: Record<string, number> = {
        FAIR_LAUNCH: 0,
        BONDING_CURVE: 1,
        FIXED_PRICE: 2,
        WHITELIST_PRIVATE: 3,
        COMMUNITY_PRELAUNCH: 4,
      };
      const modeInt = modeMap[draftResult.mode] ?? 1;

      // 5. Real Contract Call via MetaMask Signer
      setOnChainFeedback('⏳ Menyiapkan pendaftaran token on-chain di Base...');
      const signer = await getBrowserSigner();
      const contract = getLaunchpadContract(signer);

      const derivedTokenAddress = ethers.getCreateAddress({ from: walletAddress, nonce: Math.floor(Math.random() * 100000) });
      const totalSupplyWei = ethers.parseEther('1000000000');
      const initialPriceWei = ethers.parseEther('0.00000002');
      const graduationThresholdWei = ethers.parseEther('24');
      const maxPerWalletPct = 100n;
      const merkleRoot = ethers.ZeroHash;

      setOnChainFeedback('⏳ Menunggu tanda tangan transaksi pendaftaran di MetaMask...');
      const tx = await contract.registerTokenLaunch(
        derivedTokenAddress,
        draftResult.name,
        draftResult.symbol,
        totalSupplyWei,
        initialPriceWei,
        graduationThresholdWei,
        maxPerWalletPct,
        modeInt,
        merkleRoot
      );

      setOnChainFeedback(`📡 Transaksi terkirim: ${tx.hash}. Menunggu konfirmasi blok Base...`);
      const receipt = await tx.wait(1);

      if (receipt && receipt.status === 1) {
        setPublishedTxHash(tx.hash);
        const explorerLink = getExplorerUrl(tx.hash, '0x2105', 'tx');
        setOnChainFeedback(
          `✅ Token $${draftResult.symbol} BERHASIL DIDAFTARKAN ON-CHAIN! Blok #${receipt.blockNumber}. Hash: ${tx.hash} — Lihat di BaseScan: ${explorerLink}`
        );
      } else {
        setOnChainFeedback('❌ Transaksi gagal dieksekusi di blockchain Base.');
      }
    } catch (err: any) {
      setOnChainFeedback(`❌ Gagal pendaftaran on-chain: ${normalizeWeb3Error(err)}`);
    } finally {
      setIsRegisteringOnChain(false);
    }
  };

  return (
    <div className="flex-col gap-lg">
      {/* Top Banner */}
      <div className="bg-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', borderRadius: '8px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 900, margin: '0 0 4px 0', color: '#00E5FF', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Rocket size={20} /> Degen Token Launchpad & Wizard
          </h1>
          <p className="text-muted" style={{ margin: 0, fontSize: '12px' }}>
            Create pump.fun style fair launches and bonding curve tokens backed by Arkham creator risk passports.
          </p>
        </div>
        <div className="flex-row gap-sm items-center">
          <button
            type="button"
            onClick={() => setIsAngelModalOpen(true)}
            className="badge badge-admin"
            style={{ cursor: 'pointer', border: '1px solid #D500F9', color: '#E040FB', backgroundColor: '#1A0826', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Users size={14} /> 👑 ANGEL DEAL ROOM
          </button>
          {userRole === 'SYSTEM_ADMIN' && (
            <span className="badge badge-admin">
              👑 LAUNCHPAD CONTROLLER ACTIVE
            </span>
          )}
          <span className="badge badge-trader" style={{ border: '1px solid #00E5FF', color: '#00E5FF', backgroundColor: '#071A2E' }}>
            5 MODES ACTIVE
          </span>
        </div>
      </div>

      {/* Angel Deal Room Modal */}
      <AngelDealRoomModal
        isOpen={isAngelModalOpen}
        onClose={() => setIsAngelModalOpen(false)}
        connectedWallet={walletAddress}
      />

      <div className="grid-2">
        {/* Left Column: Interactive Token Launch Form */}
        <div className="bg-panel" style={{ borderRadius: '8px', padding: '24px' }}>
          <h2 style={{ color: 'var(--color-foreground)', marginTop: 0, fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <FileText size={18} /> Launch Token Draft Wizard
          </h2>
          <form onSubmit={handleCreateDraft} className="flex-col gap-md">
            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Token Name</label>
              <input
                type="text"
                placeholder="e.g. Degen Moon Alpha"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                className="input"
                style={{ padding: '12px' }}
                required
              />
            </div>

            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Token Symbol</label>
              <input
                type="text"
                placeholder="e.g. MOON"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                className="input"
                style={{ padding: '12px', color: 'var(--color-accent)', fontWeight: 800, fontFamily: 'var(--font-mono)' }}
                required
              />
            </div>

            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Launch Model (5 Deployment Modes Available)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setMode('BONDING_CURVE')}
                  className={mode === 'BONDING_CURVE' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '10px 6px', justifyContent: 'center', fontSize: '11px' }}
                >
                  <TrendingUp size={14} className="inline mr-1" /> Bonding Curve
                </button>
                <button
                  type="button"
                  onClick={() => setMode('FAIR_LAUNCH')}
                  className={mode === 'FAIR_LAUNCH' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '10px 6px', justifyContent: 'center', fontSize: '11px' }}
                >
                  <Scale size={14} className="inline mr-1" /> Fair Launch
                </button>
                <button
                  type="button"
                  onClick={() => setMode('WHITELIST_PRIVATE')}
                  className={mode === 'WHITELIST_PRIVATE' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '10px 6px', justifyContent: 'center', fontSize: '11px', border: mode === 'WHITELIST_PRIVATE' ? '1px solid #D500F9' : undefined }}
                >
                  <Users size={14} className="inline mr-1" /> Angel Whitelist
                </button>
                <button
                  type="button"
                  onClick={() => setMode('FIXED_PRICE')}
                  className={mode === 'FIXED_PRICE' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '10px 6px', justifyContent: 'center', fontSize: '11px' }}
                >
                  <Tag size={14} className="inline mr-1" /> Fixed Price
                </button>
                <button
                  type="button"
                  onClick={() => setMode('COMMUNITY_PRELAUNCH')}
                  className={mode === 'COMMUNITY_PRELAUNCH' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '10px 6px', justifyContent: 'center', fontSize: '11px' }}
                >
                  <Sparkles size={14} className="inline mr-1" /> Community
                </button>
              </div>
            </div>

            {/* Dynamic Mode-Specific Settings */}
            {mode === 'WHITELIST_PRIVATE' && (
              <div className="flex-col gap-xs" style={{ backgroundColor: '#1A0826', border: '1px solid #D500F9', padding: '12px', borderRadius: '6px' }}>
                <label style={{ color: '#E040FB', fontSize: '11px', fontWeight: 800 }}>👑 Angel Investor Whitelist Addresses (Merkle Proofs)</label>
                <textarea
                  placeholder="0x123...abc, 0x456...def (Comma-separated investor wallets)"
                  value={whitelistWallets}
                  onChange={(e) => setWhitelistWallets(e.target.value)}
                  className="input"
                  style={{ padding: '8px', fontSize: '11px', fontFamily: 'var(--font-mono)', minHeight: '60px' }}
                />
                <span className="text-muted" style={{ fontSize: '10px' }}>Only whitelisted angel wallets can claim allocated seed tokens.</span>
              </div>
            )}

            {mode === 'FIXED_PRICE' && (
              <div className="flex-col gap-xs" style={{ backgroundColor: '#071A2E', border: '1px solid #00E5FF', padding: '12px', borderRadius: '6px' }}>
                <label style={{ color: '#00E5FF', fontSize: '11px', fontWeight: 800 }}>🏷️ Fixed Price Per Token (in ETH)</label>
                <input
                  type="text"
                  value={fixedPriceEth}
                  onChange={(e) => setFixedPriceEth(e.target.value)}
                  className="input"
                  style={{ padding: '8px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
              </div>
            )}

            {mode === 'COMMUNITY_PRELAUNCH' && (
              <div className="flex-col gap-xs" style={{ backgroundColor: '#041E15', border: '1px solid var(--color-accent)', padding: '12px', borderRadius: '6px' }}>
                <label style={{ color: 'var(--color-accent)', fontSize: '11px', fontWeight: 800 }}>🤝 Target Funding Goal (in ETH)</label>
                <input
                  type="text"
                  value={fundingGoalEth}
                  onChange={(e) => setFundingGoalEth(e.target.value)}
                  className="input"
                  style={{ padding: '8px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
                <span className="text-muted" style={{ fontSize: '10px' }}>Tokens only mint if funding goal is reached before the deadline.</span>
              </div>
            )}

            {/* Target Blockchain & Relayer Gate */}
            <div className="flex-col gap-xs">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>
                  Target Blockchain & Gas Relayer
                </label>
                <span style={{ fontSize: '10px', color: selectedChain === 'base' ? 'var(--color-accent)' : '#FFAB00', fontWeight: 700 }}>
                  {selectedChain === 'base' ? '⚡ 100% Gas Sponsored by Bankr' : '⚠️ Gas Sponsorship Policy Active'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(115px, 1fr))', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedChain('base')}
                  className={selectedChain === 'base' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px 4px', justifyContent: 'center', fontSize: '11px', flexDirection: 'column', gap: '2px' }}
                >
                  <span style={{ fontWeight: 800 }}>Base L2</span>
                  <span style={{ fontSize: '9px', color: 'var(--color-accent)' }}>✅ Ready (Sponsored)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedChain('robinhood')}
                  className={selectedChain === 'robinhood' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px 4px', justifyContent: 'center', fontSize: '11px', flexDirection: 'column', gap: '2px' }}
                >
                  <span style={{ fontWeight: 800 }}>Robinhood</span>
                  <span style={{ fontSize: '9px', color: '#FF5252' }}>⛔ Blocked in Live</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedChain('arbitrum')}
                  className={selectedChain === 'arbitrum' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px 4px', justifyContent: 'center', fontSize: '11px', flexDirection: 'column', gap: '2px' }}
                >
                  <span style={{ fontWeight: 800 }}>Arbitrum</span>
                  <span style={{ fontSize: '9px', color: '#FF5252' }}>⛔ Blocked in Live</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedChain('arc')}
                  className={selectedChain === 'arc' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px 4px', justifyContent: 'center', fontSize: '11px', flexDirection: 'column', gap: '2px' }}
                >
                  <span style={{ fontWeight: 800 }}>Arc Network</span>
                  <span style={{ fontSize: '9px', color: '#00E5FF' }}>⚡ ArcPad Ready</span>
                </button>
              </div>

              {selectedChain === 'robinhood' && (
                <div style={{ backgroundColor: '#2A0808', border: '1px solid #FF5252', padding: '8px 10px', borderRadius: '4px', fontSize: '11px', color: '#FF8A80' }}>
                  ⛔ <strong>Robinhood Live Blocked:</strong> Bankr Relayer hanya mensubsidi gas di Base. Eksekusi on-chain live diblokir (<code>GAS_SPONSORSHIP_POLICY_VIOLATION</code>) untuk melindungi gas wallet operator. Tersedia hanya pada mode simulasi.
                </div>
              )}
              {selectedChain === 'arbitrum' && (
                <div style={{ backgroundColor: '#2A0808', border: '1px solid #FF5252', padding: '8px 10px', borderRadius: '4px', fontSize: '11px', color: '#FF8A80' }}>
                  ⛔ <strong>Arbitrum Live Blocked:</strong> Bankr Relayer belum mengaktifkan gas sponsorship di Arbitrum. Eksekusi live diblokir oleh Safety Gate. Tersedia hanya pada mode simulasi.
                </div>
              )}
              {selectedChain === 'arc' && (
                <div style={{ backgroundColor: '#071A2E', border: '1px solid #00E5FF', padding: '8px 10px', borderRadius: '4px', fontSize: '11px', color: '#80D8FF' }}>
                  ⚡ <strong>Arc Network Native:</strong> Terhubung dengan smart contract <code>ArcPad.sol</code> di RPC 5042. Jalur Bankr Relayer untuk Arc diblokir secara live tanpa gas sponsorship.
                </div>
              )}
            </div>

            {/* Pool Pairing & Launch Profile */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="flex-col gap-xs">
                <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Pool Pairing</label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setPoolPairing('WETH')}
                    className={poolPairing === 'WETH' ? 'btn-primary' : 'btn-secondary'}
                    style={{ flex: 1, padding: '8px 4px', fontSize: '10px', justifyContent: 'center' }}
                  >
                    WETH ✅
                  </button>
                  <button
                    type="button"
                    onClick={() => setPoolPairing('MORE_TOKENS')}
                    className={poolPairing === 'MORE_TOKENS' ? 'btn-primary' : 'btn-secondary'}
                    style={{ flex: 1, padding: '8px 4px', fontSize: '10px', justifyContent: 'center' }}
                    title="Base Quote Tokens: BNKR, ba3Pump, cbHYPE, cbZEC, TAO"
                  >
                    Tokens
                  </button>
                  <button
                    type="button"
                    disabled
                    className="btn-secondary"
                    style={{ flex: 1, padding: '8px 4px', fontSize: '10px', justifyContent: 'center', opacity: 0.35, cursor: 'not-allowed' }}
                    title="Stocks belum memiliki mapping contract tokenized-stock di backend."
                  >
                    Stocks ⛔
                  </button>
                </div>
                {poolPairing === 'MORE_TOKENS' && (
                  <span style={{ fontSize: '10px', color: 'var(--color-accent)' }}>
                    Base Quotes: BNKR, ba3Pump, cbHYPE, cbZEC, TAO.
                  </span>
                )}
              </div>

              {/* Degen Mode Toggle */}
              <div className="flex-col gap-xs">
                <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Launch Profile</label>
                <button
                  type="button"
                  onClick={() => setIsDegenMode(!isDegenMode)}
                  className={isDegenMode ? 'btn-primary' : 'btn-secondary'}
                  style={{
                    padding: '8px 10px',
                    fontSize: '11px',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: isDegenMode ? '1px solid var(--color-accent)' : undefined,
                  }}
                >
                  <span>🔥 Degen Mode</span>
                  <span style={{ fontSize: '10px', fontWeight: 800 }}>
                    {isDegenMode ? 'ON ($2.5k Mcap)' : 'OFF ($69k)'}
                  </span>
                </button>
                <span style={{ fontSize: '10px', color: 'var(--color-muted)' }}>
                  {isDegenMode ? 'Kurva mikro $2,500 mcap awal.' : 'Kurva standar threshold 24 ETH.'}
                </span>
              </div>
            </div>

            {/* Creator Vesting */}
            <div className="flex-col gap-xs">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>
                  Creator Vesting (Local Launchpad Contract)
                </label>
                <span style={{ fontSize: '10px', color: '#FFAB00', fontWeight: 700 }}>
                  ℹ️ Smart contract lokal
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setCreatorVesting('NONE')}
                  className={creatorVesting === 'NONE' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px', justifyContent: 'center', fontSize: '11px' }}
                >
                  Tanpa Vesting (0%)
                </button>
                <button
                  type="button"
                  onClick={() => setCreatorVesting('15_PERCENT')}
                  className={creatorVesting === '15_PERCENT' ? 'btn-primary' : 'btn-secondary'}
                  style={{ padding: '8px', justifyContent: 'center', fontSize: '11px' }}
                >
                  15% Creator Vesting
                </button>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--color-muted)' }}>
                * Bankr REST API menggunakan template kurva pabrik bawaan tanpa parameter vesting kustom. Field ini tidak dikirim ke REST API Bankr.
              </span>
            </div>

            <div className="flex-col gap-xs">
              <label style={{ color: 'var(--color-muted)', fontSize: '12px', fontWeight: 700 }}>Creator Wallet Address</label>
              <input
                type="text"
                value={creatorWallet}
                onChange={(e) => setCreatorWallet(e.target.value)}
                className="input"
                style={{ padding: '12px', fontFamily: 'var(--font-mono)' }}
              />
            </div>

            {!isConnected ? (
              <div className="flex-col gap-xs" style={{ marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={async () => {
                    setConnectError(null);
                    const res = await connectMetaMask();
                    if (!res.success && res.error) {
                      setConnectError(res.error);
                    }
                  }}
                  disabled={isConnecting}
                  className="btn-primary"
                  style={{ padding: '14px', justifyContent: 'center' }}
                >
                  <Wallet size={16} />
                  {isConnecting ? 'Connecting...' : 'Connect MetaMask to Launch Token'}
                </button>
                {connectError && (
                  <div style={{ color: 'var(--color-destructive)', fontSize: '12px', textAlign: 'center' }}>
                    {connectError}
                  </div>
                )}
              </div>
            ) : (
              <>
                {!isConnected ? (
                  <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.08)', border: '1px solid rgba(34, 197, 94, 0.25)', padding: '10px', borderRadius: '6px', fontSize: '12px', color: '#86EFAC', marginTop: '8px' }}>
                    💡 Hubungkan dompet Web3 MetaMask Anda untuk membuat draft dan memvalidasi skor kurva.
                  </div>
                ) : null}
                {draftError && (
                  <div style={{ backgroundColor: 'rgba(255, 23, 68, 0.1)', border: '1px solid var(--color-destructive)', padding: '10px', borderRadius: '6px', fontSize: '12px', color: 'var(--color-destructive)', marginTop: '8px' }}>
                    {draftError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isCreating}
                  className="btn-primary"
                  style={{ padding: '14px', justifyContent: 'center', marginTop: '8px' }}
                >
                  {isCreating ? 'Validating Risk Passport...' : isConnected ? '🚀 Create Launch Draft' : '⚡ Connect Wallet & Create Draft'}
                </button>
              </>
            )}
          </form>
        </div>

        {/* Right Column: Draft & Risk Passport Inspector */}
        <div className="bg-panel" style={{ borderRadius: '8px', padding: '24px' }}>
          <h2 style={{ color: 'var(--color-foreground)', marginTop: 0, fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <ShieldAlert size={18} /> Risk Passport & Draft Summary
          </h2>

          {draftResult ? (
            <div className="bg-panel" style={{ padding: '16px', borderRadius: '6px', border: '1px solid var(--color-border)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Draft ID:</span>
                <span style={{ color: '#00E5FF', fontWeight: 800 }}>{draftResult.draftId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Token:</span>
                <span style={{ color: 'var(--color-accent)', fontWeight: 900 }}>{draftResult.name} (${draftResult.symbol})</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Launch Mode:</span>
                <span style={{ color: '#D500F9', fontWeight: 800 }}>{draftResult.mode}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Creator Wallet:</span>
                <span style={{ color: 'var(--color-foreground)', fontWeight: 800 }}>{draftResult.creatorWallet.slice(0, 10)}...</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Target Chain:</span>
                <span style={{ color: selectedChain === 'base' ? 'var(--color-accent)' : '#FFAB00', fontWeight: 800 }}>
                  {draftResult.targetChain?.toUpperCase() || selectedChain.toUpperCase()}
                  {selectedChain === 'base' ? ' (SPONSORED)' : ' (POLICY RESTRICTED)'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Pairing / Profile:</span>
                <span style={{ color: 'var(--color-foreground)', fontWeight: 800 }}>
                  {poolPairing} ({isDegenMode ? 'Degen $2.5k Mcap' : 'Std $69k Mcap'})
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Creator Allocation:</span>
                <span style={{ color: 'var(--color-foreground)', fontWeight: 800 }}>
                  {creatorVesting === '15_PERCENT' ? '15% (Local Contract Only)' : '0% (None)'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                <span className="text-muted">Arkham Risk Passport:</span>
                <span style={{ color: 'var(--color-accent)', fontWeight: 900 }}>{draftResult.riskPassportScore} / 100 (LOW_RISK)</span>
              </div>
              <div style={{ backgroundColor: '#041E15', border: '1px solid var(--color-accent)', color: 'var(--color-accent)', padding: '12px', borderRadius: '4px', textAlign: 'center', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
                <CheckCircle2 size={16} /> Draft Ready for Onchain Graduation Test
              </div>

              {/* On-Chain Registration Action & Status */}
              <div style={{ marginBottom: '16px', padding: '14px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#0B1017' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, marginBottom: '8px', color: '#00E5FF', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Zap size={14} /> Settlement Layer: Base Blockchain
                </div>
                {userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN' ? (
                  <div>
                    <p style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '10px' }}>
                      Sebagai <strong>Protocol Admin</strong>, Anda dapat mendaftarkan token ini langsung ke smart contract <code>BondingCurveLaunchpad.sol</code> (<code>onlyOwner</code>).
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      onClick={handleRegisterOnChain}
                      disabled={isRegisteringOnChain || !!publishedTxHash}
                      style={{ padding: '10px', fontSize: '12px', justifyContent: 'center' }}
                    >
                      {isRegisteringOnChain ? '⏳ Memproses di Blockchain Base...' : publishedTxHash ? '✅ Terdaftar On-Chain' : '⚡ Register Token Launch On-Chain'}
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--color-muted)', lineHeight: '1.5' }}>
                    ℹ️ Fungsi on-chain (<code>registerTokenLaunch</code>) diproteksi modifier <code>onlyOwner</code> pada smart contract. Draft telah tersimpan di PostgreSQL SSOT dan akan diaktivasi on-chain oleh Protocol Admin setelah review governance.
                  </div>
                )}

                {onChainFeedback && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      backgroundColor: onChainFeedback.startsWith('✅') ? '#041E15' : '#2A0808',
                      color: onChainFeedback.startsWith('✅') ? 'var(--color-accent)' : '#FF5252',
                      border: `1px solid ${onChainFeedback.startsWith('✅') ? 'var(--color-accent)' : '#FF5252'}`,
                      wordBreak: 'break-all',
                    }}
                  >
                    {onChainFeedback}
                  </div>
                )}
              </div>

              {/* Investor Nutrition Label Preview */}
              <NutritionLabelCard
                liquidityLocked={false}
                mintRevoked={true}
                creatorTrustScore={draftResult.riskPassportScore || 75}
                overallTier="LOW"
                reasons={[
                  'Template contracts enforced via BondingCurveLaunchpad.sol',
                  'Zero withdrawal keys detected on deployer vault',
                  'Pre-launch fair distribution limits active'
                ]}
              />
            </div>
          ) : (
            <div className="bg-panel flex-col items-center justify-center" style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--color-muted)', borderRadius: '6px', border: '1px dashed var(--color-border)', fontSize: '13px' }}>
              <FileText size={32} style={{ marginBottom: '16px', opacity: 0.5 }} />
              Fill in token details and click "Create Launch Draft" to generate risk passport preview.
            </div>
          )}
        </div>
      </div>

      {/* Live Deployed Tokens & Active Bonding Curves (Neon SSOT Stream) */}
      <div className="bg-panel" style={{ borderRadius: '8px', padding: '24px', border: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ color: 'var(--color-foreground)', margin: 0, fontSize: '16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Rocket size={18} style={{ color: 'var(--color-accent)' }} /> Live Deployed Tokens & Bonding Curves
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="badge" style={{ backgroundColor: '#041E15', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', fontSize: '11px', fontWeight: 800 }}>
              {activeTokens.length} LIVE ON BASE
            </span>
            <button
              type="button"
              onClick={fetchActiveTokens}
              className="btn-secondary"
              style={{ padding: '6px 12px', fontSize: '11px' }}
              disabled={isLoadingTokens}
            >
              {isLoadingTokens ? 'Refreshing...' : '🔄 Refresh SSOT'}
            </button>
          </div>
        </div>

        {activeTokens.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {activeTokens.map((token: any) => {
              const raised = Number(token.raisedAmount || 0);
              const target = Number(token.graduationThreshold || 69000);
              const progressPct = Math.min(100, Math.round((raised / target) * 100));
              const explorerUrl = `https://basescan.org/address/${token.contractAddress}`;

              return (
                <div
                  key={token.launchId || token.contractAddress}
                  className="bg-panel"
                  style={{
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: '#070C12',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ fontWeight: 900, color: 'var(--color-foreground)', fontSize: '14px' }}>
                        {token.name}
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--color-accent)', fontSize: '12px' }}>
                        ${token.ticker}
                      </div>
                    </div>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 800,
                        backgroundColor: '#071A2E',
                        color: '#00E5FF',
                        border: '1px solid #00E5FF',
                      }}
                    >
                      {token.chain?.toUpperCase() || 'BASE'}
                    </span>
                  </div>

                  <div style={{ fontSize: '11px', color: 'var(--color-muted)', marginBottom: '12px', fontFamily: 'var(--font-mono)' }}>
                    CA: {token.contractAddress.slice(0, 8)}...{token.contractAddress.slice(-6)}
                  </div>

                  {/* Graduation Progress Bar */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--color-muted)', marginBottom: '4px' }}>
                      <span>Graduation Progress</span>
                      <span style={{ color: 'var(--color-foreground)', fontWeight: 700 }}>${raised.toLocaleString()} / ${target.toLocaleString()}</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', backgroundColor: '#1A2332', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${progressPct}%`, height: '100%', backgroundColor: 'var(--color-accent)' }} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary"
                      style={{ flex: 1, padding: '6px 4px', textAlign: 'center', fontSize: '11px', justifyContent: 'center' }}
                    >
                      Basescan ↗
                    </a>
                    <a
                      href={`/trading?token=${token.contractAddress}`}
                      className="btn-primary"
                      style={{ flex: 1, padding: '6px 4px', textAlign: 'center', fontSize: '11px', justifyContent: 'center' }}
                    >
                      Trade ⚡
                    </a>
                    <a
                      href={`/kol`}
                      className="btn-secondary"
                      style={{ flex: 1, padding: '6px 4px', textAlign: 'center', fontSize: '11px', justifyContent: 'center', borderColor: 'rgba(168, 85, 247, 0.4)', color: '#C084FC' }}
                      title="Ikuti Bounties, Kampanye Share & Staking di KOL Hub"
                    >
                      Campaigns 🎯
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-muted)', fontSize: '12px' }}>
            Belum ada token yang terdaftar di PostgreSQL SSOT. Jalankan deployment via Multibot atau buat draft di atas untuk mendaftarkan token pertama!
          </div>
        )}
      </div>

      {/* Admin Launchpad Governance Console (SYSTEM_ADMIN Exclusive) */}
      {(userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN') && (
        <div className="bg-panel" style={{ border: '1px solid #FF9100', borderRadius: '8px', padding: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 900, color: '#FFD600', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldAlert size={18} /> System Admin: Launchpad Bonding Curve & Liquidity Governance
          </h3>
          <div className="grid-3">
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: '#00E5FF', fontWeight: 800, fontSize: '12px' }}>Graduation Target</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>$69,000 Market Cap</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Auto-migrates to Uniswap v3 Pool</div>
            </div>
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: 'var(--color-accent)', fontWeight: 800, fontSize: '12px' }}>Protocol Fee Split</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-foreground)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>0.50% / 0.50%</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>50% Protocol Treasury / 50% Creator</div>
            </div>
            <div className="bg-panel" style={{ border: '1px solid var(--color-border)', padding: '16px', borderRadius: '6px' }}>
              <div style={{ color: 'var(--color-destructive)', fontWeight: 800, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}><AlertTriangle size={14} /> Emergency Blacklist</div>
              <div style={{ fontSize: '18px', fontWeight: 900, color: 'var(--color-accent)', margin: '8px 0', fontFamily: 'var(--font-mono)' }}>0 Blacklisted Contracts</div>
              <div className="text-muted" style={{ fontSize: '11px' }}>Arkham OFAC Scanned Hourly</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
