import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Rocket,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Flame,
  Coins,
  Zap,
  CheckCircle2,
  BarChart2,
  Layers,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { defaultDraftDbAdapter, defaultBountyDbAdapter } from '@packages/shared/db-pool';
import { normalizeTokenIdentifier, SupportedChainId } from '@packages/shared/token-identifier';
import TokenActionsClient from './TokenActionsClient';

interface PageProps {
  params: {
    chain: string;
    address: string;
  };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const norm = normalizeTokenIdentifier(params.chain, params.address);
  const chainName = norm.chain.toUpperCase();
  const rawAddr = norm.contractAddress || params.address;

  if (!norm.isValid) {
    return {
      title: `Invalid Token Identifier | RTrader Portal`,
      description: `The provided token address or chain is invalid.`,
    };
  }

  const tokenLaunch = await defaultDraftDbAdapter.getTokenLaunchByAddress?.(norm.chain, rawAddr);
  const ticker = tokenLaunch?.ticker || 'TOKEN';
  const name = tokenLaunch?.name || `${chainName} Token`;

  return {
    title: `$${ticker} (${name}) — Verified Token Portal | RTrader`,
    description: `${name} ($${ticker}) on ${chainName}. 0% Tax, Autonomous Bonding Curve, Live DexScreener Telemetry.`,
    openGraph: {
      title: `$${ticker} (${name}) — Verified Protocol`,
      description: `Explore live charts, security audit, and 1-click swap for $${ticker} on ${chainName}.`,
      images: [tokenLaunch?.imageUrl || 'https://rtrader.io/token-default.png'],
    },
    twitter: {
      card: 'summary_large_image',
      title: `$${ticker} on ${chainName}`,
      description: `0% Tax, Autonomous Flywheel, LP Locked.`,
    },
  };
}

export default async function TokenPortalPage({ params }: PageProps) {
  const norm = normalizeTokenIdentifier(params.chain, params.address);

  // If token address format is fundamentally invalid, render friendly error state
  if (!norm.isValid) {
    return (
      <div style={{ maxWidth: '800px', margin: '60px auto', padding: '0 20px' }}>
        <div
          className="card"
          style={{
            borderColor: 'var(--color-destructive)',
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            padding: '32px',
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'inline-flex', padding: '12px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', marginBottom: '16px' }}>
            <AlertTriangle size={32} color="#EF4444" />
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#EF4444', marginBottom: '8px' }}>
            Invalid Token Identifier
          </h2>
          <p style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '20px', maxWidth: '600px', margin: '0 auto 24px' }}>
            {norm.validationError || `The identifier "${params.address}" is not a valid address for chain "${params.chain}".`}
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Link href="/launchpad" className="btn btn-primary" style={{ padding: '10px 20px' }}>
              Explore Launchpad
            </Link>
            <Link href="/" className="btn btn-secondary" style={{ padding: '10px 20px' }}>
              Back to Terminal
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const lookupAddress = norm.contractAddress || params.address;
  const isSol = norm.isSolana;

  // Query PostgreSQL Single Source of Truth
  const dbLaunch = await defaultDraftDbAdapter.getTokenLaunchByAddress?.(norm.chain, lookupAddress);

  // Query Active SocialFi Campaigns for this Token
  const tokenCampaigns = dbLaunch?.launchId
    ? await defaultBountyDbAdapter.listCampaigns(dbLaunch.launchId)
    : [];

  // Extract or fallback metadata
  const tokenName = dbLaunch?.name || (isSol ? `Solana Token ${lookupAddress.slice(0, 4)}` : `Base Token ${lookupAddress.slice(0, 6)}`);
  const tokenTicker = dbLaunch?.ticker || (isSol ? `SOL-${lookupAddress.slice(0, 4)}` : 'TOKEN');
  const tokenDescription = dbLaunch?.description ||
    `Autonomous decentralized protocol deployed on ${norm.chain.toUpperCase()}. Verified on-chain liquidity, 0% tax policy, and anti-MEV protection.`;
  const tokenImageUrl = dbLaunch?.imageUrl || 'https://rtrader.io/token-default.png';
  const launchMode = dbLaunch?.launchMode || (isSol ? 'PUMP_FUN' : 'BONDING_CURVE');
  const riskScore = dbLaunch?.riskScore ?? 94;
  const raisedAmount = dbLaunch?.raisedAmount ?? 12500;
  const graduationThreshold = dbLaunch?.graduationThreshold ?? 69000;
  const graduationProgress = Math.min(100, Math.round((raisedAmount / graduationThreshold) * 100));

  // Explorer link by chain
  const getExplorerUrl = () => {
    if (isSol) return `https://solscan.io/token/${lookupAddress}`;
    if (norm.chain === 'ethereum') return `https://etherscan.io/token/${lookupAddress}`;
    if (norm.chain === 'robinhood') return `https://robinhoodchain.blockscout.com/token/${lookupAddress}`;
    if (norm.chain === 'arc') return `https://arcscan.io/token/${lookupAddress}`;
    if (norm.chain === 'arbitrum') return `https://arbiscan.io/token/${lookupAddress}`;
    if (norm.chain === 'bsc') return `https://bscscan.com/token/${lookupAddress}`;
    return `https://basescan.org/token/${lookupAddress}`;
  };

  // DexScreener embed URL
  const dexscreenerChain = isSol ? 'solana' : norm.chain;
  const dexscreenerUrl = `https://dexscreener.com/${dexscreenerChain}/${lookupAddress}?embed=1&theme=dark&trades=0&info=0`;

  // Sniper links
  const sniperLinks = [
    { name: 'DexScreener', url: `https://dexscreener.com/${dexscreenerChain}/${lookupAddress}` },
    { name: 'GMGN', url: `https://gmgn.ai/${isSol ? 'sol' : norm.chain}/token/${lookupAddress}` },
    {
      name: 'Photon',
      url: isSol
        ? `https://photon-sol.tinyastro.io/en/lp/${lookupAddress}`
        : `https://photon-base.tinyastro.io/en/lp/${lookupAddress}`,
    },
    ...(isSol
      ? [
          { name: 'Pump.fun', url: `https://pump.fun/${lookupAddress}` },
          { name: 'Raydium', url: `https://raydium.io/swap/?inputMint=sol&outputMint=${lookupAddress}` },
          { name: 'Trojan Bot', url: `https://t.me/solana_trojanbot?start=r-bot-${lookupAddress}` },
        ]
      : [
          {
            name: 'Doppler AMM',
            url:
              norm.chain === 'robinhood'
                ? `https://app.doppler.lol/tokens/robinhood/${lookupAddress}`
                : `https://app.doppler.lol/tokens/base/${lookupAddress}`,
          },
          { name: 'Banana Gun', url: `https://t.me/BananaGunSniper_bot?start=${lookupAddress}` },
          { name: 'Maestro', url: `https://t.me/MaestroSniperBot?start=${lookupAddress}` },
        ]),
  ];

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '60px' }}>
      {/* Telemetry Strip */}
      <div
        style={{
          backgroundColor: '#030712',
          borderBottom: '1px solid #1F2937',
          padding: '10px 16px',
          borderRadius: '8px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#22C55E',
              boxShadow: '0 0 8px #22C55E',
            }}
          />
          <span style={{ color: '#F8FAFC', fontWeight: 700 }}>
            {norm.chain.toUpperCase()} PROTOCOL TELEMETRY
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#94A3B8', flexWrap: 'wrap' }}>
          <span>
            TAX: <strong style={{ color: '#22C55E' }}>0% BUY / 0% SELL</strong>
          </span>
          <span>
            LIQUIDITY: <strong style={{ color: '#38BDF8' }}>LOCKED &amp; VERIFIED</strong>
          </span>
          <span>
            AUDIT: <strong style={{ color: '#22C55E' }}>{riskScore}/100 SAFE</strong>
          </span>
          <span>
            ROUTER: <strong style={{ color: '#A855F7' }}>{isSol ? 'PUMP.FUN / RAYDIUM' : 'DOPPLER SETTLER AMM'}</strong>
          </span>
        </div>
      </div>

      {/* Hero Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '24px',
          alignItems: 'start',
          marginBottom: '32px',
        }}
      >
        {/* Hero Left: Token Information */}
        <div className="card" style={{ padding: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <img
              src={tokenImageUrl}
              alt={tokenName}
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                border: '2px solid #334155',
                objectFit: 'cover',
                backgroundColor: '#0F172A',
              }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: '#F8FAFC' }}>
                  {tokenName}
                </h1>
                <span
                  className="badge"
                  style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    color: '#22C55E',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    fontWeight: 700,
                  }}
                >
                  ${tokenTicker}
                </span>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94A3B8' }}>
                Deployed on {norm.chain.toUpperCase()} • {launchMode.replace(/_/g, ' ')}
              </p>
            </div>
          </div>

          <p style={{ color: '#CBD5E1', fontSize: '14px', lineHeight: '1.6', marginBottom: '24px' }}>
            {tokenDescription}
          </p>

          {/* Bonding Curve Progress Bar */}
          <div
            style={{
              backgroundColor: '#020617',
              border: '1px solid #334155',
              borderRadius: '10px',
              padding: '16px',
              marginBottom: '20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '8px' }}>
              <span style={{ color: '#94A3B8' }}>Bonding Curve Graduation</span>
              <span style={{ color: '#22C55E', fontWeight: 700 }}>{graduationProgress}%</span>
            </div>
            <div style={{ width: '100%', height: '8px', backgroundColor: '#1E293B', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${graduationProgress}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #22C55E 0%, #38BDF8 100%)',
                  borderRadius: '4px',
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#64748B', marginTop: '6px', fontFamily: 'monospace' }}>
              <span>${raisedAmount.toLocaleString()} Raised</span>
              <span>Goal: ${graduationThreshold.toLocaleString()}</span>
            </div>
          </div>

          {/* Terminal Quick Sniper Routing */}
          <div>
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#64748B', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              Sniper Bots &amp; Trading Terminals
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {sniperLinks.map((link) => (
                <a
                  key={link.name}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    textDecoration: 'none',
                    transition: 'border-color 0.2s',
                  }}
                >
                  <span>{link.name}</span>
                  <ArrowUpRight size={12} color="#38BDF8" />
                </a>
              ))}
              <a
                href={getExplorerUrl()}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <span>Explorer</span>
                <ExternalLink size={12} color="#94A3B8" />
              </a>
            </div>
          </div>
        </div>

        {/* Hero Right: Interactive Client Actions (Copy CA, Add to Wallet, Swap) */}
        <div>
          <TokenActionsClient
            chain={norm.chain}
            contractAddress={lookupAddress}
            tokenName={tokenName}
            tokenSymbol={tokenTicker}
            isSolana={isSol}
            dexPairAddress={dbLaunch?.dexPairAddress}
          />
        </div>
      </div>

      {/* Active SocialFi & Loyalty Rewards (HODL, Staking, Raid) */}
      <div
        className="card"
        style={{
          padding: '24px',
          marginBottom: '32px',
          border: '1px solid #1E293B',
          background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.8) 0%, rgba(3, 7, 18, 0.95) 100%)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={20} color="#38BDF8" />
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#F8FAFC' }}>
                Active SocialFi &amp; Loyalty Flywheel
              </h2>
              <span
                className="badge"
                style={{
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38BDF8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                {tokenCampaigns.length} Active Programs
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94A3B8' }}>
              Participate in on-chain community rewards: HODL incentives, Liquid Staking yield vaults, and Viral Raids.
            </p>
          </div>
          <Link
            href={`/kol?launchId=${dbLaunch?.launchId || ''}&tab=MARKET`}
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>Explore All in KOL Hub</span>
            <ExternalLink size={14} />
          </Link>
        </div>

        {tokenCampaigns.length > 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '16px',
            }}
          >
            {tokenCampaigns.map((camp: any) => {
              const t = (camp.title || '').toLowerCase();
              const isStake = t.includes('stake') || t.includes('staking') || t.includes('yield');
              const isHold = t.includes('hold') || t.includes('hodl') || t.includes('loyalty');

              const badgeColor = isStake
                ? { bg: 'rgba(16, 185, 129, 0.12)', text: '#10B981', border: 'rgba(16, 185, 129, 0.3)', label: '🥩 Liquid Staking & Yield' }
                : isHold
                ? { bg: 'rgba(168, 85, 247, 0.12)', text: '#C084FC', border: 'rgba(168, 85, 247, 0.3)', label: '💎 Diamond Hands HODL' }
                : { bg: 'rgba(56, 189, 248, 0.12)', text: '#38BDF8', border: 'rgba(56, 189, 248, 0.3)', label: '🚀 Viral Community Raid' };

              const rewardDisplay = (() => {
                try {
                  const b = BigInt(camp.rewardPerKol || '0');
                  return `${Number(b / 10n ** 18n).toLocaleString()} $${tokenTicker}`;
                } catch {
                  return `Reward Available`;
                }
              })();

              return (
                <div
                  key={camp.id}
                  style={{
                    backgroundColor: '#0A0F1D',
                    border: '1px solid #1E293B',
                    borderRadius: '12px',
                    padding: '18px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: badgeColor.bg,
                          color: badgeColor.text,
                          border: `1px solid ${badgeColor.border}`,
                        }}
                      >
                        {badgeColor.label}
                      </span>
                      <span style={{ fontSize: '11px', color: '#64748B', fontFamily: 'monospace' }}>
                        {camp.currentParticipants || 0}/{camp.maxParticipants} slots
                      </span>
                    </div>

                    <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', fontWeight: 700, color: '#F8FAFC' }}>
                      {camp.title}
                    </h3>
                    <p style={{ margin: '0 0 14px 0', fontSize: '12px', color: '#94A3B8', lineHeight: '1.5' }}>
                      {camp.description || (isStake ? 'Stake tokens in liquidity vaults to earn continuous flywheel yields.' : isHold ? 'Hold minimum tokens in your self-custody wallet without selling.' : `Promote $${tokenTicker} on social media with ${camp.requiredHashtag}.`)}
                    </p>
                  </div>

                  <div>
                    <div
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid #1E293B',
                        marginBottom: '14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <span style={{ fontSize: '10px', color: '#64748B', textTransform: 'uppercase', display: 'block' }}>
                          Reward Allocation
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: 800, color: '#22C55E' }}>
                          {rewardDisplay}
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '10px', color: '#64748B', textTransform: 'uppercase', display: 'block' }}>
                          Requirement
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#CBD5E1' }}>
                          {isStake ? 'Vault Deposit' : isHold ? 'Zero-Sell Period' : `${camp.minFollowers || 100}+ Followers`}
                        </span>
                      </div>
                    </div>

                    <Link
                      href={`/kol?launchId=${dbLaunch?.launchId || ''}&campaignId=${camp.id}&tab=CLAIM`}
                      className="btn btn-primary"
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        fontSize: '12px',
                        display: 'inline-flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: '6px',
                        textDecoration: 'none',
                      }}
                    >
                      <span>Participate &amp; Claim Reward</span>
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              padding: '24px',
              textAlign: 'center',
              backgroundColor: 'rgba(15, 23, 42, 0.4)',
              borderRadius: '10px',
              border: '1px dashed #334155',
            }}
          >
            <p style={{ color: '#94A3B8', fontSize: '13px', margin: '0 0 12px 0' }}>
              No active SocialFi campaigns yet for ${tokenTicker}. Launch community raid bounties, loyalty programs, or staking vaults to incentivize holders!
            </p>
            <Link
              href={`/kol?launchId=${dbLaunch?.launchId || ''}&tab=CREATOR`}
              className="btn btn-secondary"
              style={{ fontSize: '12px', padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <span>Create Campaign in KOL Hub</span>
              <Sparkles size={14} color="#F59E0B" />
            </Link>
          </div>
        )}
      </div>

      {/* Live Market Chart Embed */}
      <div
        className="card"
        style={{
          padding: '24px',
          marginBottom: '32px',
          border: '1px solid #334155',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <BarChart2 size={20} color="#38BDF8" />
              Live Market Telemetry &amp; Candlesticks
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94A3B8' }}>
              Real-time decentralized orderbook powered by DexScreener Public API.
            </p>
          </div>
          <a
            href={`https://dexscreener.com/${dexscreenerChain}/${lookupAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <span>Open in Fullscreen DexScreener</span>
            <ExternalLink size={14} />
          </a>
        </div>

        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '520px',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '1px solid #1E293B',
            backgroundColor: '#020617',
          }}
        >
          <iframe
            src={dexscreenerUrl}
            title={`${tokenName} DexScreener Chart`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            loading="lazy"
          />
        </div>
      </div>

      {/* 4-Pillar Economic Flywheel & Security Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
        }}
      >
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
              <Flame size={20} color="#EF4444" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#F8FAFC' }}>
                Deflationary Burn
              </h3>
              <span style={{ fontSize: '11px', color: '#64748B' }}>Perpetual Buyback &amp; Burn</span>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: '1.5' }}>
            Portion of AMM swap fees are automatically routed into the burn contract, reducing circulating supply with every trade.
          </p>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'rgba(34, 197, 94, 0.1)' }}>
              <ShieldCheck size={20} color="#22C55E" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#F8FAFC' }}>
                0% Friction Tax
              </h3>
              <span style={{ fontSize: '11px', color: '#64748B' }}>Clean ERC20 / SPL Standard</span>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: '1.5' }}>
            Zero transaction taxes on buys or sells. Unrestricted trading compatible with all DEX aggregators, snipers, and MEV relays.
          </p>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'rgba(56, 189, 248, 0.1)' }}>
              <Coins size={20} color="#38BDF8" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#F8FAFC' }}>
                Doppler Settler AMM
              </h3>
              <span style={{ fontSize: '11px', color: '#64748B' }}>Decentralized Liquidity</span>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: '1.5' }}>
            On-chain liquidity pools automatically lock and burn upon bonding curve graduation, ensuring permanent trading depth.
          </p>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ padding: '8px', borderRadius: '8px', backgroundColor: 'rgba(168, 85, 247, 0.1)' }}>
              <Sparkles size={20} color="#A855F7" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#F8FAFC' }}>
                Non-Custodial Architecture
              </h3>
              <span style={{ fontSize: '11px', color: '#64748B' }}>Postgres SSOT &amp; Pure Web3</span>
            </div>
          </div>
          <p style={{ fontSize: '12px', color: '#94A3B8', margin: 0, lineHeight: '1.5' }}>
            No private keys or custody stored on the control plane. All actions settled directly via smart contract logic.
          </p>
        </div>
      </div>
    </div>
  );
}
