/**
 * src/modules/intelligence/ca-intelligence.ts
 *
 * CA Intelligence & Audit Engine.
 * Multi-chain Contract Address intelligence scanner combining:
 *  1. DexScreener Public API (Tokens & /orders/v1 Paid Verification) - 100% Free
 *  2. GoPlus Security API (Honeypot, Taxes, Mintable, Ownership) - 100% Free
 *  3. Dynamic Sniper Bot & Trading Terminal Deep-Link Generator
 *
 * Zero external paid API required (No Arkham needed).
 */

import axios from "axios";
import { logger } from "../../logger.ts";

export interface DexScreenerOrder {
  type: string;             // e.g. "tokenProfile", "tokenBoost"
  status: string;           // e.g. "approved", "pending", "processing"
  paymentTimestamp?: number;
}

export interface DexScreenerOrdersResponse {
  orders?: DexScreenerOrder[];
  boosts?: Array<{
    type?: string;
    amount?: number;
    totalAmount?: number;
  }>;
}

export interface TokenSecurityAudit {
  isHoneypot: boolean;
  cannotBuy: boolean;
  cannotSellAll: boolean;
  buyTaxPct: number;
  sellTaxPct: number;
  isMintable: boolean;
  isBlacklisted: boolean;
  canTakeBackOwnership: boolean;
  isOpenSource: boolean;
  ownerAddress?: string;
  holderCount?: number;
  rawGoPlusStatus: "success" | "unavailable" | "error";
  riskWarnings: string[];
}

export interface TokenMarketMetrics {
  tokenName: string;
  tokenSymbol: string;
  priceUsd: string;
  priceChange24h: number;
  liquidityUsd: number;
  fdvUsd: number;
  volume24h: number;
  pairAddress?: string;
  dexId?: string;
  pairCreatedAt?: number;
  dexUrl?: string;
  socials: {
    website?: string;
    twitter?: string;
    telegram?: string;
  };
}

export interface SniperLinks {
  maestro: string;
  bananaGun: string;
  trojan?: string;
  bonkBot?: string;
  gmgn: string;
  photon: string;
  dexScreener: string;
  explorer: string;
  twitterSearch: string;
}

export interface CaIntelligenceReport {
  contractAddress: string;
  chain: string;
  detectedChainId: number | string;
  isDexScreenerPaid: boolean;
  dexScreenerProfileApproved: boolean;
  dexScreenerBoostCount: number;
  dexScreenerStatusText: string;
  market: TokenMarketMetrics;
  security: TokenSecurityAudit;
  safetyScore: number;       // 0 to 100
  safetyVerdict: "VERY_SAFE" | "MODERATE" | "HIGH_RISK" | "DANGEROUS_HONEYPOT";
  sniperLinks: SniperLinks;
  timestamp: string;
}

const GOPLUS_CHAIN_MAP: Record<string, string> = {
  base: "8453",
  ethereum: "1",
  eth: "1",
  bsc: "56",
  binance: "56",
  arbitrum: "42161",
  polygon: "137",
  optimism: "10",
  avalanche: "43114",
};

/**
 * Detects whether an address is Solana (base58) or EVM (0x...).
 */
export function detectAddressFormat(address: string): "solana" | "evm" {
  const trimmed = address.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return "evm";
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    return "solana";
  }
  return "evm";
}

/**
 * Queries DexScreener token pairs to get market info and chain id.
 */
export async function fetchDexScreenerTokenData(address: string): Promise<{
  chain: string;
  pair: any;
}> {
  try {
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      timeout: 8000,
    });
    const pairs = res.data?.pairs || [];
    if (pairs.length > 0) {
      // Pick pair with highest liquidity
      const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      return {
        chain: sorted[0].chainId || "base",
        pair: sorted[0],
      };
    }
  } catch (err: any) {
    logger.warn(`[CA-INTEL] DexScreener token fetch notice: ${err?.message || err}`);
  }

  // Fallback chain based on format
  const fmt = detectAddressFormat(address);
  return {
    chain: fmt === "solana" ? "solana" : "base",
    pair: null,
  };
}

/**
 * Queries DexScreener Orders API (/orders/v1) to check if tokenProfile / boosts are paid.
 * This is the exact endpoint behind the Telegram /dp command.
 */
export async function fetchDexScreenerOrders(
  chain: string,
  address: string
): Promise<{
  isPaid: boolean;
  profileApproved: boolean;
  boostCount: number;
  statusText: string;
  rawOrders: DexScreenerOrder[];
}> {
  try {
    const res = await axios.get<DexScreenerOrdersResponse>(
      `https://api.dexscreener.com/orders/v1/${chain}/${address}`,
      { timeout: 8000 }
    );
    const orders = res.data?.orders || [];
    const boosts = res.data?.boosts || [];

    const profileApproved = orders.some(
      (o) => o.type === "tokenProfile" && (o.status === "approved" || o.status === "processing")
    );

    let totalBoosts = 0;
    if (boosts.length > 0) {
      totalBoosts = boosts.reduce((acc, b) => acc + (b.totalAmount || b.amount || 1), 0);
    }

    const isPaid = profileApproved || totalBoosts > 0;

    let statusText = "DexScreener not paid";
    if (profileApproved && totalBoosts > 0) {
      statusText = `DexScreener Paid (Profile Approved + ${totalBoosts} Boosts)`;
    } else if (profileApproved) {
      statusText = "DexScreener Paid (Profile Approved)";
    } else if (totalBoosts > 0) {
      statusText = `DexScreener Boosted (${totalBoosts} Boosts)`;
    }

    return {
      isPaid,
      profileApproved,
      boostCount: totalBoosts,
      statusText,
      rawOrders: orders,
    };
  } catch (err: any) {
    logger.warn(`[CA-INTEL] DexScreener orders check notice: ${err?.message || err}`);
    return {
      isPaid: false,
      profileApproved: false,
      boostCount: 0,
      statusText: "DexScreener not paid",
      rawOrders: [],
    };
  }
}

/**
 * Queries GoPlus Security API to detect Honeypot, Taxes, Mintability, and Blacklists.
 */
export async function fetchGoPlusSecurity(
  chain: string,
  address: string
): Promise<TokenSecurityAudit> {
  const riskWarnings: string[] = [];

  try {
    let url = "";
    if (chain.toLowerCase() === "solana") {
      url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${address}`;
    } else {
      const goplusChainId = GOPLUS_CHAIN_MAP[chain.toLowerCase()] || "8453";
      url = `https://api.gopluslabs.io/api/v1/token_security/${goplusChainId}?contract_addresses=${address}`;
    }

    const res = await axios.get(url, { timeout: 8000 });
    const resultObj = res.data?.result || {};
    const auditData = resultObj[address.toLowerCase()] || resultObj[address] || Object.values(resultObj)[0] as any;

    if (!auditData) {
      return {
        isHoneypot: false,
        cannotBuy: false,
        cannotSellAll: false,
        buyTaxPct: 0,
        sellTaxPct: 0,
        isMintable: false,
        isBlacklisted: false,
        canTakeBackOwnership: false,
        isOpenSource: true,
        rawGoPlusStatus: "unavailable",
        riskWarnings: ["Audit data not yet indexed by security provider"],
      };
    }

    const isHoneypot = auditData.is_honeypot === "1";
    const cannotBuy = auditData.cannot_buy === "1";
    const cannotSellAll = auditData.cannot_sell_all === "1";

    const buyTaxFloat = parseFloat(auditData.buy_tax || "0");
    const sellTaxFloat = parseFloat(auditData.sell_tax || "0");
    const buyTaxPct = Number.isFinite(buyTaxFloat) ? Math.round(buyTaxFloat * 10000) / 100 : 0;
    const sellTaxPct = Number.isFinite(sellTaxFloat) ? Math.round(sellTaxFloat * 10000) / 100 : 0;

    const isMintable = auditData.is_mintable === "1";
    const isBlacklisted = auditData.is_blacklisted === "1";
    const canTakeBackOwnership = auditData.can_take_back_ownership === "1";
    const isOpenSource = auditData.is_open_source === "1" || auditData.is_open_source === undefined;
    const holderCount = parseInt(auditData.holder_count || "0", 10);

    if (isHoneypot) riskWarnings.push("CRITICAL: Token is detected as a HONEYPOT (cannot sell)!");
    if (cannotBuy) riskWarnings.push("CRITICAL: Buying disabled by contract!");
    if (cannotSellAll) riskWarnings.push("HIGH RISK: Cannot sell all tokens!");
    if (sellTaxPct > 10) riskWarnings.push(`HIGH TAX: Sell tax is high (${sellTaxPct}%)`);
    if (buyTaxPct > 10) riskWarnings.push(`HIGH TAX: Buy tax is high (${buyTaxPct}%)`);
    if (isMintable) riskWarnings.push("INFLATION: Owner can mint new tokens!");
    if (canTakeBackOwnership) riskWarnings.push("CENTRALIZATION: Owner can reclaim ownership!");
    if (!isOpenSource && chain !== "solana") riskWarnings.push("UNVERIFIED: Contract is not open source / unverified");

    return {
      isHoneypot,
      cannotBuy,
      cannotSellAll,
      buyTaxPct,
      sellTaxPct,
      isMintable,
      isBlacklisted,
      canTakeBackOwnership,
      isOpenSource,
      ownerAddress: auditData.owner_address || undefined,
      holderCount,
      rawGoPlusStatus: "success",
      riskWarnings,
    };
  } catch (err: any) {
    logger.warn(`[CA-INTEL] GoPlus audit notice: ${err?.message || err}`);
    return {
      isHoneypot: false,
      cannotBuy: false,
      cannotSellAll: false,
      buyTaxPct: 0,
      sellTaxPct: 0,
      isMintable: false,
      isBlacklisted: false,
      canTakeBackOwnership: false,
      isOpenSource: true,
      rawGoPlusStatus: "error",
      riskWarnings: ["Security audit service unavailable for this chain"],
    };
  }
}

/**
 * Calculates a unified safety score (0 - 100).
 */
export function calculateSafetyScore(
  security: TokenSecurityAudit,
  isPaid: boolean,
  liquidityUsd: number
): { score: number; verdict: "VERY_SAFE" | "MODERATE" | "HIGH_RISK" | "DANGEROUS_HONEYPOT" } {
  if (security.isHoneypot || security.cannotBuy || security.cannotSellAll) {
    return { score: 0, verdict: "DANGEROUS_HONEYPOT" };
  }

  let score = 75; // Baseline for standard token

  // Security bonuses & penalties
  if (security.isOpenSource) score += 5;
  if (!security.isMintable) score += 5;
  if (security.buyTaxPct <= 2 && security.sellTaxPct <= 2) score += 5;

  if (security.isMintable) score -= 20;
  if (security.canTakeBackOwnership) score -= 20;
  if (security.isBlacklisted) score -= 15;
  if (!security.isOpenSource) score -= 15;

  if (security.sellTaxPct > 15) score -= 30;
  else if (security.sellTaxPct > 5) score -= 15;

  if (security.buyTaxPct > 15) score -= 20;
  else if (security.buyTaxPct > 5) score -= 10;

  // DexScreener Paid bonus (proves creator invested money)
  if (isPaid) score += 10;

  // Liquidity confidence
  if (liquidityUsd >= 10000) score += 5;
  else if (liquidityUsd < 500 && liquidityUsd > 0) score -= 10;

  score = Math.max(5, Math.min(100, score));

  let verdict: "VERY_SAFE" | "MODERATE" | "HIGH_RISK" | "DANGEROUS_HONEYPOT" = "MODERATE";
  if (score >= 80) verdict = "VERY_SAFE";
  else if (score >= 50) verdict = "MODERATE";
  else verdict = "HIGH_RISK";

  return { score, verdict };
}

/**
 * Generates direct 1-click sniper & terminal deep links matching degen trading bot conventions.
 */
export function generateSniperLinks(chain: string, address: string): SniperLinks {
  const isSol = chain.toLowerCase() === "solana";
  const cleanAddr = address.trim();

  return {
    maestro: `https://t.me/MaestroSniperBot?start=${cleanAddr}`,
    bananaGun: `https://t.me/BananaGunSniper_bot?start=${cleanAddr}`,
    trojan: isSol ? `https://t.me/solana_trojanbot?start=r-bot-${cleanAddr}` : undefined,
    bonkBot: isSol ? `https://t.me/bonkbot_bot?start=ref_${cleanAddr}` : undefined,
    gmgn: `https://gmgn.ai/${chain}/token/${cleanAddr}`,
    photon: isSol
      ? `https://photon-sol.tinyastro.io/en/lp/${cleanAddr}`
      : `https://photon-base.tinyastro.io/en/lp/${cleanAddr}`,
    dexScreener: `https://dexscreener.com/${chain}/${cleanAddr}`,
    explorer: isSol
      ? `https://solscan.io/token/${cleanAddr}`
      : `https://basescan.org/token/${cleanAddr}`,
    twitterSearch: `https://twitter.com/search?q=${cleanAddr}`,
  };
}

interface CaCacheEntry {
  report: CaIntelligenceReport;
  expiresAt: number;
}
const caIntelligenceCache = new Map<string, CaCacheEntry>();
const CA_CACHE_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Master scanner function: Resolves full CA intelligence across DexScreener & GoPlus.
 */
export async function analyzeContractAddress(
  rawAddress: string,
  chainOverride?: string
): Promise<CaIntelligenceReport> {
  const address = rawAddress.trim();
  const cacheKey = `${(chainOverride || "").toLowerCase()}:${address.toLowerCase()}`;
  const now = Date.now();
  const cached = caIntelligenceCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.report;
  }

  const format = detectAddressFormat(address);

  // 1. Query DexScreener token pairs
  const dexData = await fetchDexScreenerTokenData(address);
  const chain = chainOverride?.toLowerCase() || dexData.chain || (format === "solana" ? "solana" : "base");

  // 2. Query DexScreener Orders & GoPlus concurrently
  const [ordersRes, securityRes] = await Promise.all([
    fetchDexScreenerOrders(chain, address),
    fetchGoPlusSecurity(chain, address),
  ]);

  // 3. Extract Market Metrics
  const pair = dexData.pair;
  const tokenName = pair?.baseToken?.name || (address.startsWith("0x") ? `Token ${address.slice(0, 6)}` : "Solana Token");
  const tokenSymbol = pair?.baseToken?.symbol || "UNKNOWN";
  const priceUsd = pair?.priceUsd ? `$${parseFloat(pair.priceUsd).toFixed(8)}` : "$0.00";
  const priceChange24h = pair?.priceChange?.h24 ?? 0;
  const liquidityUsd = pair?.liquidity?.usd ?? 0;
  const fdvUsd = pair?.fdv ?? 0;
  const volume24h = pair?.volume?.h24 ?? 0;
  const dexUrl = pair?.url || `https://dexscreener.com/${chain}/${address}`;

  const socials = {
    website: pair?.info?.websites?.[0]?.url,
    twitter: pair?.info?.socials?.find((s: any) => s.type === "twitter")?.url,
    telegram: pair?.info?.socials?.find((s: any) => s.type === "telegram")?.url,
  };

  const market: TokenMarketMetrics = {
    tokenName,
    tokenSymbol,
    priceUsd,
    priceChange24h,
    liquidityUsd,
    fdvUsd,
    volume24h,
    pairAddress: pair?.pairAddress,
    dexId: pair?.dexId,
    pairCreatedAt: pair?.pairCreatedAt,
    dexUrl,
    socials,
  };

  // 4. Calculate Safety Score & Verdict
  const { score: safetyScore, verdict: safetyVerdict } = calculateSafetyScore(
    securityRes,
    ordersRes.isPaid,
    liquidityUsd
  );

  // 5. Generate Sniper Links
  const sniperLinks = generateSniperLinks(chain, address);

  const report: CaIntelligenceReport = {
    contractAddress: address,
    chain,
    detectedChainId: GOPLUS_CHAIN_MAP[chain] || chain,
    isDexScreenerPaid: ordersRes.isPaid,
    dexScreenerProfileApproved: ordersRes.profileApproved,
    dexScreenerBoostCount: ordersRes.boostCount,
    dexScreenerStatusText: ordersRes.statusText,
    market,
    security: securityRes,
    safetyScore,
    safetyVerdict,
    sniperLinks,
    timestamp: new Date().toISOString(),
  };

  caIntelligenceCache.set(cacheKey, { report, expiresAt: now + CA_CACHE_TTL_MS });
  if (caIntelligenceCache.size > 200) {
    const oldestKey = caIntelligenceCache.keys().next().value;
    if (oldestKey) caIntelligenceCache.delete(oldestKey);
  }

  return report;
}
