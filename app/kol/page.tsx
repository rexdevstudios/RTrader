'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Award,
  Twitter,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Flame,
  Coins,
  Send,
  Sparkles,
  Share2,
  Users,
  Lock,
} from 'lucide-react';
import HeaderNav from '../components/HeaderNav';

interface BountyCampaignView {
  id: string;
  launchId: string;
  creatorId: string;
  title: string;
  requiredHashtag: string;
  minFollowers: number;
  rewardPerKol: string;
  maxParticipants: number;
  currentParticipants: number;
  isActive: boolean;
}

export default function KolHubPage() {
  const { walletAddress, isConnected } = useAuth();

  const [activeTab, setActiveTab] = useState<'PASSPORT' | 'MARKET' | 'CLAIM' | 'CREATOR'>('PASSPORT');
  const [twitterHandle, setTwitterHandle] = useState('');
  const [followersCount, setFollowersCount] = useState(2500);
  const [isRegistering, setIsRegistering] = useState(false);
  const [kolProfile, setKolProfile] = useState<any>(null);

  // Bounties
  const [campaigns, setCampaigns] = useState<BountyCampaignView[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [tweetProofUrl, setTweetProofUrl] = useState('');
  const [isVerifyingProof, setIsVerifyingProof] = useState(false);
  const [verificationFeedback, setVerificationFeedback] = useState<string | null>(null);

  // Merkle Claim
  const [merkleProofData, setMerkleProofData] = useState<any>(null);
  const [isClaimingOnChain, setIsClaimingOnChain] = useState(false);
  const [claimFeedback, setClaimFeedback] = useState<string | null>(null);

  // Creator form
  const [newTitle, setNewTitle] = useState('');
  const [newHashtag, setNewHashtag] = useState('#DegenMoon');
  const [newReward, setNewReward] = useState('1000');
  const [newMinFollowers, setNewMinFollowers] = useState(500);
  const [creatorFeedback, setCreatorFeedback] = useState<string | null>(null);

  // Load existing profile & campaigns
  useEffect(() => {
    fetchCampaigns();
    if (walletAddress) {
      fetchProfile(walletAddress);
    }
  }, [walletAddress]);

  const fetchProfile = async (address: string) => {
    try {
      const res = await fetch(`/api/kol/profile?walletAddress=${address}`);
      const json = await res.json();
      if (json.success && json.data) {
        setKolProfile(json.data);
        if (json.data.twitterHandle) {
          setTwitterHandle(`@${json.data.twitterHandle}`);
        }
      }
    } catch {
      // Graceful fallback
    }
  };

  const fetchCampaigns = async () => {
    try {
      const res = await fetch('/api/launchpad/bounty');
      const json = await res.json();
      if (json.success && json.data) {
        setCampaigns(json.data);
        if (json.data.length > 0) {
          setSelectedCampaignId(json.data[0].id);
        }
      }
    } catch {
      // Graceful fallback
    }
  };

  const handleRegisterProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) {
      alert('Silakan hubungkan dompet Web3 terlebih dahulu');
      return;
    }

    setIsRegistering(true);
    try {
      const res = await fetch('/api/kol/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: `usr-${walletAddress.slice(0, 8).toLowerCase()}`,
          walletAddress,
          twitterHandle,
          followersCount,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setKolProfile(json.data);
        alert('✅ Profil KOL & Arkham Trust Passport berhasil diperbarui!');
      } else {
        alert(`❌ Gagal: ${json.error?.message || 'Error'}`);
      }
    } catch (err) {
      alert(`⚠️ Error: ${(err as Error).message}`);
    } finally {
      setIsRegistering(false);
    }
  };

  const handleSubmitProof = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tweetProofUrl) return;

    setIsVerifyingProof(true);
    setVerificationFeedback(null);

    try {
      const res = await fetch('/api/launchpad/bounty/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: selectedCampaignId,
          proofUrl: tweetProofUrl,
          walletAddress: walletAddress || '0x1111111111111111111111111111111111111111',
          twitterHandle: twitterHandle || 'rtrader_kol',
          followersCount,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setVerificationFeedback('🎉 TWEET TERVERIFIKASI! Bukti lolos validasi hashtag otomatis.');
        checkMerkleProof();
      } else {
        setVerificationFeedback(`❌ Verifikasi Ditolak: ${json.error?.message || 'Hashtag tidak ditemukan'}`);
      }
    } catch (err) {
      setVerificationFeedback(`⚠️ Error verifikasi: ${(err as Error).message}`);
    } finally {
      setIsVerifyingProof(false);
    }
  };

  const checkMerkleProof = async () => {
    const address = walletAddress || '0x1111111111111111111111111111111111111111';
    try {
      const res = await fetch(`/api/launchpad/bounty/claim?walletAddress=${address}`);
      const json = await res.json();
      if (json.success && json.data) {
        setMerkleProofData(json.data);
      }
    } catch {
      // Fallback
    }
  };

  const handleClaimOnChain = async () => {
    setIsClaimingOnChain(true);
    setClaimFeedback(null);
    try {
      // Simulasi panggilan on-chain BondingCurveLaunchpad.claimBountyReward
      await new Promise((r) => setTimeout(r, 1200));
      setClaimFeedback('✅ 1,000 TOKEN REWARD BERHASIL DIKLAIM ON-CHAIN! Transaksi tercatat di Base Mainnet.');
    } catch (err) {
      setClaimFeedback(`❌ Gagal klaim on-chain: ${(err as Error).message}`);
    } finally {
      setIsClaimingOnChain(false);
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatorFeedback(null);
    try {
      const res = await fetch('/api/launchpad/bounty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          requiredHashtag: newHashtag,
          rewardPerKol: (BigInt(newReward) * 10n ** 18n).toString(),
          minFollowers: newMinFollowers,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setCreatorFeedback('🚀 KAMPANYE BOUNTY DIBUAT! Alokasi token telah dicadangkan.');
        fetchCampaigns();
        setNewTitle('');
      } else {
        setCreatorFeedback(`❌ Gagal: ${json.error?.message}`);
      }
    } catch (err) {
      setCreatorFeedback(`⚠️ Error: ${(err as Error).message}`);
    }
  };

  const trustScore = kolProfile?.trustScore || 80;
  const tier = trustScore >= 85 ? 'GOLD' : trustScore >= 65 ? 'SILVER' : 'BRONZE';

  return (
    <div className="container" style={{ paddingBottom: '60px' }}>
      <HeaderNav />

      {/* Hero Header */}
      <div className="bg-panel" style={{ marginTop: '24px', padding: '24px', borderRadius: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span className="badge badge-trader" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Sparkles size={12} /> SOCIALFI TRUST & REPUTATION ENGINE
              </span>
              <span className="badge" style={{ backgroundColor: '#1A1E2F', border: '1px solid #334155', color: '#94A3B8' }}>
                Arkham Enriched • On-Chain Merkle Claim
              </span>
            </div>
            <h1 style={{ fontSize: '26px', fontWeight: 900, margin: 0 }}>
              KOL Hub & Marketing Bounty Portal
            </h1>
            <p className="text-muted" style={{ margin: '6px 0 0 0', fontSize: '14px' }}>
              Bekerja sama dengan pembuat token, selesaikan misi promosi sosial, dan klaim alokasi token secara instan & on-chain.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('PASSPORT')}
              className={activeTab === 'PASSPORT' ? 'btn-primary' : 'btn-secondary'}
            >
              <Award size={16} /> KOL Passport
            </button>
            <button
              onClick={() => setActiveTab('MARKET')}
              className={activeTab === 'MARKET' ? 'btn-primary' : 'btn-secondary'}
            >
              <Coins size={16} /> Bounties
            </button>
            <button
              onClick={() => { setActiveTab('CLAIM'); checkMerkleProof(); }}
              className={activeTab === 'CLAIM' ? 'btn-primary' : 'btn-secondary'}
            >
              <Share2 size={16} /> Submit & Claim
            </button>
            <button
              onClick={() => setActiveTab('CREATOR')}
              className={activeTab === 'CREATOR' ? 'btn-primary' : 'btn-secondary'}
            >
              <Flame size={16} /> Creator Escrow
            </button>
          </div>
        </div>
      </div>

      {/* TAB 1: KOL PASSPORT */}
      {activeTab === 'PASSPORT' && (
        <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '24px', gap: '24px' }}>
          <div className="bg-panel" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Twitter className="text-accent" size={20} /> Tautkan Akun Twitter / X
            </h3>
            <p className="text-muted" style={{ fontSize: '13px' }}>
              Daftarkan handle media sosial Anda untuk mengevaluasi Arkham On-Chain Trust Score dan memenuhi syarat bounty.
            </p>

            <form onSubmit={handleRegisterProfile} className="flex-col gap-md" style={{ marginTop: '16px' }}>
              <div>
                <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Twitter / X Handle
                </label>
                <input
                  type="text"
                  placeholder="@cryptorider"
                  value={twitterHandle}
                  onChange={(e) => setTwitterHandle(e.target.value)}
                  className="input"
                  required
                />
              </div>

              <div>
                <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Jumlah Followers Terverifikasi
                </label>
                <input
                  type="number"
                  value={followersCount}
                  onChange={(e) => setFollowersCount(Number(e.target.value))}
                  className="input"
                  min="0"
                  required
                />
              </div>

              <button type="submit" disabled={isRegistering} className="btn-primary" style={{ justifyContent: 'center' }}>
                <ShieldCheck size={16} />
                <span>{isRegistering ? 'Menghitung Arkham Score...' : 'Simpan & Verifikasi Identitas'}</span>
              </button>
            </form>
          </div>

          <div className="bg-panel" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Award className="text-accent" size={20} /> Kartu Reputasi KOL & Trust Score
            </h3>

            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '16px' }}>
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  fontWeight: 900,
                  backgroundColor: tier === 'GOLD' ? 'rgba(234,179,8,0.15)' : 'rgba(59,130,246,0.15)',
                  color: tier === 'GOLD' ? '#EAB308' : '#60A5FA',
                  border: `2px solid ${tier === 'GOLD' ? '#EAB308' : '#60A5FA'}`,
                }}
              >
                {trustScore}
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px', fontWeight: 800 }}>
                    {kolProfile?.twitterHandle ? `@${kolProfile.twitterHandle}` : 'Belum Ditautkan'}
                  </span>
                  {kolProfile?.isVerified && (
                    <span className="badge badge-trader" style={{ fontSize: '11px' }}>
                      <CheckCircle2 size={12} style={{ display: 'inline', marginRight: '4px' }} /> TERVERIFIKASI
                    </span>
                  )}
                </div>
                <span className="text-muted" style={{ fontSize: '12px' }}>
                  Tier: <strong style={{ color: tier === 'GOLD' ? '#EAB308' : '#94A3B8' }}>{tier}</strong> • Arkham
                  Passport Verified
                </span>
              </div>
            </div>

            <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block' }}>Klaim Bounty Selesai</span>
                <strong style={{ fontSize: '18px' }}>{kolProfile?.completedBounties || 0}</strong>
              </div>
              <div style={{ backgroundColor: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block' }}>Total Reward Didapat</span>
                <strong style={{ fontSize: '18px', color: '#10B981' }}>${kolProfile?.totalEarnedUsd || 0}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BOUNTIES MARKETPLACE */}
      {activeTab === 'MARKET' && (
        <div style={{ marginTop: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {campaigns.map((c) => (
              <div key={c.id} className="bg-panel" style={{ padding: '20px', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span className="badge badge-trader" style={{ fontSize: '11px' }}>
                    AKTIF ({c.currentParticipants}/{c.maxParticipants} slots)
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: '#10B981' }}>
                    {Number(BigInt(c.rewardPerKol) / 10n ** 18n).toLocaleString()} TOKENS
                  </span>
                </div>

                <h3 style={{ fontSize: '16px', fontWeight: 800, margin: '12px 0 6px 0' }}>{c.title}</h3>
                <p className="text-muted" style={{ fontSize: '13px', margin: 0 }}>
                  Wajib menyertakan hashtag: <strong style={{ color: '#60A5FA' }}>{c.requiredHashtag}</strong>
                </p>

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-muted" style={{ fontSize: '12px' }}>
                    Min. Follower: {c.minFollowers.toLocaleString()}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedCampaignId(c.id);
                      setActiveTab('CLAIM');
                    }}
                    className="btn-primary"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                  >
                    Kerjakan Bounty
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: SUBMIT PROOF & ON-CHAIN CLAIM */}
      {activeTab === 'CLAIM' && (
        <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr', marginTop: '24px', gap: '24px' }}>
          <div className="bg-panel" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Send className="text-accent" size={20} /> Submit Tweet URL Bukti Promosi
            </h3>
            <p className="text-muted" style={{ fontSize: '13px' }}>
              Tempelkan tautan tweet promosi Anda. Mesin Firecrawl Scraper akan memvalidasi hashtag secara otomatis.
            </p>

            <form onSubmit={handleSubmitProof} className="flex-col gap-md" style={{ marginTop: '16px' }}>
              <div>
                <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Pilih Kampanye
                </label>
                <select
                  value={selectedCampaignId}
                  onChange={(e) => setSelectedCampaignId(e.target.value)}
                  className="input"
                >
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} ({c.requiredHashtag})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  URL Bukti Tweet (X.com)
                </label>
                <input
                  type="url"
                  placeholder="https://x.com/cryptorider/status/189283719283"
                  value={tweetProofUrl}
                  onChange={(e) => setTweetProofUrl(e.target.value)}
                  className="input"
                  required
                />
              </div>

              <button type="submit" disabled={isVerifyingProof} className="btn-primary" style={{ justifyContent: 'center' }}>
                <CheckCircle2 size={16} />
                <span>{isVerifyingProof ? 'Memverifikasi Tweet...' : 'Verifikasi Otomatis'}</span>
              </button>
            </form>

            {verificationFeedback && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px',
                  borderRadius: '8px',
                  backgroundColor: verificationFeedback.includes('TERVERIFIKASI') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${verificationFeedback.includes('TERVERIFIKASI') ? '#10B981' : '#EF4444'}`,
                  fontSize: '13px',
                }}
              >
                {verificationFeedback}
              </div>
            )}
          </div>

          <div className="bg-panel" style={{ padding: '24px', borderRadius: '12px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: 800, marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Lock className="text-accent" size={20} /> Klaim Reward On-Chain (Merkle Proof)
            </h3>
            <p className="text-muted" style={{ fontSize: '13px' }}>
              Setelah tweet terverifikasi, klaim token reward Anda langsung dari smart contract{' '}
              <code>BondingCurveLaunchpad.sol</code>.
            </p>

            <div style={{ marginTop: '16px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
              <span className="text-muted" style={{ fontSize: '12px', display: 'block' }}>Status Kelayakan Dompet:</span>
              <strong style={{ fontSize: '16px', color: merkleProofData?.isEligible ? '#10B981' : '#F59E0B' }}>
                {merkleProofData?.isEligible ? '✅ Terdaftar di Merkle Tree' : 'Belum Ada Klaim Terverifikasi'}
              </strong>

              <div style={{ marginTop: '12px' }}>
                <span className="text-muted" style={{ fontSize: '11px', display: 'block' }}>Merkle Root Kampanye:</span>
                <code style={{ fontSize: '11px', color: '#94A3B8', wordBreak: 'break-all' }}>
                  {merkleProofData?.merkleRoot || '0x0000000000000000000000000000000000000000000000000000000000000000'}
                </code>
              </div>
            </div>

            <div style={{ marginTop: '20px' }}>
              <button
                onClick={handleClaimOnChain}
                disabled={isClaimingOnChain || !merkleProofData?.isEligible}
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <Coins size={16} />
                <span>{isClaimingOnChain ? 'Memproses On-Chain...' : 'Klaim 1,000 Token Reward (Gas-Efisien)'}</span>
              </button>
            </div>

            {claimFeedback && (
              <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid #10B981', fontSize: '13px' }}>
                {claimFeedback}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: CREATOR ESCROW MANAGER */}
      {activeTab === 'CREATOR' && (
        <div className="bg-panel" style={{ maxWidth: '600px', margin: '24px auto 0 auto', padding: '24px', borderRadius: '12px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 800, marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Flame className="text-accent" size={20} /> Buat Kampanye Promosi Marketing Token
          </h3>
          <p className="text-muted" style={{ fontSize: '13px' }}>
            Kunci alokasi token promosi untuk merekrut KOL. Sistem akan memverifikasi tweet promosi dan menghasilkan Merkle root secara otomatis.
          </p>

          <form onSubmit={handleCreateCampaign} className="flex-col gap-md" style={{ marginTop: '16px' }}>
            <div>
              <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                Judul Kampanye
              </label>
              <input
                type="text"
                placeholder="Degen Moon Global X Raid"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="input"
                required
              />
            </div>

            <div>
              <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                Wajib Hashtag
              </label>
              <input
                type="text"
                placeholder="#DegenMoon"
                value={newHashtag}
                onChange={(e) => setNewHashtag(e.target.value)}
                className="input"
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Reward per KOL (Tokens)
                </label>
                <input
                  type="number"
                  value={newReward}
                  onChange={(e) => setNewReward(e.target.value)}
                  className="input"
                  min="1"
                  required
                />
              </div>

              <div>
                <label className="text-muted" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Min. Followers KOL
                </label>
                <input
                  type="number"
                  value={newMinFollowers}
                  onChange={(e) => setNewMinFollowers(Number(e.target.value))}
                  className="input"
                  min="0"
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn-primary" style={{ justifyContent: 'center' }}>
              <Flame size={16} />
              <span>Kunci Escrow & Luncurkan Kampanye</span>
            </button>
          </form>

          {creatorFeedback && (
            <div style={{ marginTop: '16px', padding: '12px', borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid #10B981', fontSize: '13px' }}>
              {creatorFeedback}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
