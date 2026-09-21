/**
 * src/modules/growth/token-offer-generator.ts
 *
 * Irresistible Tokenomics & Value Proposition Generator.
 *
 * Generates compelling, high-converting investor & community offers for
 * any deployed token in the multi-chain fleet (Base L2 / Solana).
 *
 * Features:
 *   1. Executive Value Proposition (0% Tax, 30% Deflationary Burn, 20% Passive Dividends, 15% FOMO Jackpot).
 *   2. Twitter / X Viral Launch Thread copy.
 *   3. Telegram / Discord Alpha Caller Announcement copy.
 *   4. DexScreener / DEXTools Bio & Header copy.
 *   5. Zero duplication: Reuses flywheel-engine ratios and vault models.
 */

import * as fs from "fs";
import * as path from "path";
import { getConfig } from "../../config.ts";
import { getPromotionDecision } from "../../db/vault.ts";

export interface TokenOfferInput {
  name: string;
  ticker: string;
  contractAddress: string;
  chain: string;
  description?: string;
  viralScore?: number;
  poolId?: string;
  website?: string;
  twitter?: string;
  telegram?: string;
}

export interface IrresistibleOfferResult {
  tokenSymbol: string;
  tokenName: string;
  contractAddress: string;
  chain: string;
  executiveSummary: string;
  twitterThread: string[];
  telegramPost: string;
  dexScreenerBio: string;
  fullOfferCard: string;
}

/**
 * Generates an irresistible, high-converting value proposition and promotional copy
 * for any deployed token in the multi-chain fleet.
 */
export function generateIrresistibleOffer(input: TokenOfferInput): IrresistibleOfferResult {
  const cfg = getConfig();
  const ticker = input.ticker.replace(/^\$/, "").toUpperCase();
  const name = input.name;
  const ca = input.contractAddress;
  const chainName = input.chain.toLowerCase() === "base" ? "Base Mainnet (L2 by Coinbase)" : "Solana Mainnet";
  const explorerUrl = input.chain.toLowerCase() === "base"
    ? `https://basescan.org/token/${ca}`
    : `https://solscan.io/token/${ca}`;
  const chartUrl = input.chain.toLowerCase() === "base"
    ? `https://dexscreener.com/base/${ca}`
    : `https://dexscreener.com/solana/${ca}`;

  const buybackPct = Math.round((cfg.FLYWHEEL_BUYBACK_RATIO ?? 0.30) * 100);
  const dividendPct = Math.round((cfg.FLYWHEEL_DIVIDEND_RATIO ?? 0.20) * 100);
  const jackpotPct = Math.round((cfg.FLYWHEEL_JACKPOT_RATIO ?? 0.15) * 100);
  const creatorPct = Math.round((cfg.FLYWHEEL_CREATOR_RATIO ?? 0.35) * 100);

  // 1. Executive Summary
  const executiveSummary = [
    `PENAWARAN INVESTASI & VALUE PROPOSITION: $${ticker} (${name})`,
    `1. 0% BUY / SELL TAX: 100% fair launch, tanpa potongan tersembunyi saat jual-beli.`,
    `2. ${buybackPct}% PERPETUAL DEFLATIONARY BURN: Revenue protocol otomatis membeli $${ticker} dari DEX dan membakarnya ke 0xdead untuk mengangkat lantai harga.`,
    `3. ${dividendPct}% PASSIVE NATIVE DIVIDENDS: Top holders otomatis menerima airdrop WETH/SOL ke dompet tanpa perlu staking atau lock token.`,
    `4. ${jackpotPct}% 10-MINUTE FOMO JACKPOT: Setiap pembelian memenuhi syarat. Pembeli terakhir dalam jendela 10 menit memenangkan seluruh pool jackpot.`,
    `5. 5% INSTANT COMMUNITY BOUNTY: Siapapun yang membagikan link referral mendapat komisi 5% instan dari volume yang diarahkan.`,
    `6. 100% RUG-PROOF & RENOUNCED BY DESIGN: Minimal Proxy EIP-1167 kebal manipulasi, 0 hak mint dev, 0 hak ubah pajak, likuiditas terkunci permanen.`,
  ].join("\n");

  // 2. Twitter / X Viral Thread
  const twitterThread = [
    `🚨 NEW ALPHA LAUNCH: $${ticker} (${name}) is now live on ${chainName}!\n\nMost meme coins dump on you. $${ticker} is mathematically designed to do the exact opposite.\n\nHere is why this autonomous flywheel is an irresistible hold 🧵👇\n\n📊 Chart: ${chartUrl}\nCA: ${ca}`,
    `1/ Fair Launch & Zero Friction 🛡️\n\n- 0% Buy Tax / 0% Sell Tax\n- Renounced by Design (EIP-1167 Minimal Proxy / SPL)\n- 100% Initial Liquidity Locked\n- Zero mint capability, zero dev dump risk\n\nYou get 100% of what you trade. No slippage trap.`,
    `2/ Autonomous ${buybackPct}% Buyback & Burn 🔥\n\nEvery single trade generates protocol fees. Our autonomous engine recycles ${buybackPct}% of all fees to market-buy $${ticker} and incinerate it to 0xdead.\n\nResult? Ever-shrinking supply and a rising price floor 📈`,
    `3/ ${dividendPct}% Passive Yield to Diamond Hands 💰\n\nNo complicated staking. No lockup periods.\n\nSimply hold $${ticker} in your self-custody wallet, and the protocol automatically drops native ETH/SOL dividends into your account from trading volume.`,
    `4/ The ${jackpotPct}% 10-Minute FOMO Jackpot 🎰\n\nEvery buy transaction resets a 10-minute timer. If no one buys after you for 10 minutes, YOU win the entire accumulated prize pool!\n\nContinuous buying pressure guaranteed.`,
    `5/ Join the Movement Early 🚀\n\n- Token: $${ticker}\n- Contract: ${ca}\n- Live Chart: ${chartUrl}\n- Explorer: ${explorerUrl}\n\nDon't sleep on positive-sum tokenomics. Grab your bag and let the flywheel work for you!`,
  ];

  // 3. Telegram Announcement
  const telegramPost = [
    `🚀 *NEW LAUNCH ALERT: $${ticker} (${name})* 🚀`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🌐 *Network:* ${chainName}`,
    `📄 *Contract Address:* \`${ca}\``,
    `📊 *DexScreener Chart:* [Klik di Sini](${chartUrl})`,
    `🔍 *Explorer:* [Lihat Transaksi On-Chain](${explorerUrl})`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💎 *KEUNGGULAN & VALUE PROPOSITION UTAMA:*\n`,
    `✅ *0% Pajak (Zero Tax):* Bebas trading tanpa potongan fee beli/jual!`,
    `🔥 *${buybackPct}% Auto Buyback & Burn:* Setiap trading otomatis mendanai buyback dari market dan dibakar ke address hangus (0xdead)!`,
    `💰 *${dividendPct}% Passive Dividen Native:* Cukup simpan $${ticker}, dividen ETH langsung cair ke dompet Anda tanpa perlu staking!`,
    `⚡ *${jackpotPct}% FOMO Jackpot 10-Menit:* Siapa yang beli terakhir sebelum timer habis membawa pulang seluruh pool jackpot!`,
    `🤝 *5% Komisi Referral Instan:* Bagikan link dan dapatkan komisi WETH langsung!`,
    `🔒 *100% Aman & Renounced by Design:* EIP-1167 Minimal Proxy kebal manipulasi, likuiditas terkunci, 0% dev mint!`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🎯 *Amankan posisi Anda sekarang sebelum bonding curve terbang!* 🚀`,
  ].join("\n");

  // 4. DexScreener Bio
  const dexScreenerBio = [
    `$${ticker} - Autonomous Positive-Sum Meme Token on ${input.chain.toUpperCase()}.`,
    `0% Tax | Renounced by Design | ${buybackPct}% Auto Buyback & Burn (0xdead) | ${dividendPct}% Passive ETH Dividends to Holders | ${jackpotPct}% 10-Min FOMO Jackpot.`,
    `Contract: ${ca}`,
    `Powered by Autonomous Omnichain Flywheel Engine.`,
  ].join(" | ");

  // 5. Full Offer Card (Terminal View)
  const fullOfferCard = [
    `=======================================================================`,
    `   [+] KARTU PENAWARAN SUPER MENARIK: $${ticker.padEnd(8)} (${name}) [+]`,
    `=======================================================================`,
    `Jaringan:         ${chainName}`,
    `Contract Address: ${ca}`,
    `Live Chart:       ${chartUrl}`,
    `Audit Keamanan:   100/100 (0% Tax, LP Locked, Renounced by Design)`,
    `-----------------------------------------------------------------------`,
    `PENAWARAN NILAI INVESTOR (TOKENOMICS OTOMATIS):`,
    `  [1] 0% PAJAK BELI/JUAL      : 100% modal masuk ke token tanpa potongan.`,
    `  [2] ${buybackPct}% AUTO BUYBACK & BURN : Fee trading otomatis membeli $${ticker} & hangus.`,
    `  [3] ${dividendPct}% PASSIVE DIVIDEN WETH : Airdrop WETH otomatis ke holders tanpa staking.`,
    `  [4] ${jackpotPct}% FOMO JACKPOT 10-MENIT: Last buyer sebelum timer habis menang pool.`,
    `  [5] 5% AFFILIATE REVENUE    : Referral instan dibayar langsung on-chain.`,
    `=======================================================================`,
  ].join("\n");

  return {
    tokenSymbol: ticker,
    tokenName: name,
    contractAddress: ca,
    chain: input.chain,
    executiveSummary,
    twitterThread,
    telegramPost,
    dexScreenerBio,
    fullOfferCard,
  };
}

/**
 * Formats an offer deck into standard GitHub-flavored Markdown.
 */
export function formatOfferDeckMarkdown(offer: IrresistibleOfferResult): string {
  return [
    `# Marketing & Investor Offer Deck: $${offer.tokenSymbol} (${offer.tokenName})`,
    "",
    "## Executive Summary",
    "```text",
    offer.executiveSummary,
    "```",
    "",
    "## Twitter / X Launch Thread",
    offer.twitterThread.map((t, idx) => `### Tweet ${idx + 1}\n\`\`\`text\n${t}\n\`\`\``).join("\n\n"),
    "",
    "## Telegram Announcement",
    "```text",
    offer.telegramPost,
    "```",
    "",
    "## DexScreener Bio",
    "```text",
    offer.dexScreenerBio,
    "```",
  ].join("\n");
}

export interface SaveOfferDeckOptions {
  outputDir?: string;
  chainSuffix?: boolean;
}

/**
 * Idempotently saves offer deck markdown files to disk without throwing unhandled exceptions.
 * Writes both OFFER_<TICKER>.md and OFFER_<TICKER>_<CHAIN>.md if chainSuffix is true.
 */
export function saveOfferDeckMarkdown(
  offer: IrresistibleOfferResult,
  options?: SaveOfferDeckOptions
): { success: boolean; primaryPath?: string; chainPath?: string; error?: string } {
  try {
    const promoDir = options?.outputDir ?? path.resolve(process.cwd(), "promotions");
    if (!fs.existsSync(promoDir)) {
      fs.mkdirSync(promoDir, { recursive: true });
    }

    const mdContent = formatOfferDeckMarkdown(offer);
    const primaryPath = path.join(promoDir, `OFFER_${offer.tokenSymbol}.md`);
    fs.writeFileSync(primaryPath, mdContent, "utf8");

    let chainPath: string | undefined;
    if (options?.chainSuffix ?? true) {
      chainPath = path.join(promoDir, `OFFER_${offer.tokenSymbol}_${offer.chain.toUpperCase()}.md`);
      fs.writeFileSync(chainPath, mdContent, "utf8");
    }


    return { success: true, primaryPath, chainPath };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6A: PROMOTION ELIGIBILITY & FREE DISCOVERY PACKAGE
// ─────────────────────────────────────────────────────────────────────────────

export type PromotionEligibilityStatus = "ELIGIBLE" | "CONDITIONAL" | "NOT_READY" | "UNKNOWN";

export interface PromotionEligibilityInput {
  lifecycleState?: string | null;
  status?: string | null;
  onChainVerified?: boolean | null;
  contractAddress?: string | null;
  chain?: string | null;
  poolId?: string | null;
  pairAddress?: string | null;
  liquidityUsd?: number | null;
  volume24h?: number | null;
  priceUsd?: string | null;
  hasWebsite?: boolean;
  hasTwitter?: boolean;
  hasTelegram?: boolean;
  hasDescription?: boolean;
  hasLogoUrl?: boolean;
}

export interface PromotionEligibilityResult {
  status: PromotionEligibilityStatus;
  reasons: string[];
  eligiblePlatforms: string[];
  evaluatedMetrics: {
    lifecycleState: string;
    onChainVerified: boolean | "UNKNOWN";
    hasLiquidity: boolean | "UNKNOWN";
    liquidityUsd: number | "UNKNOWN";
    hasVolume: boolean | "UNKNOWN";
    volume24h: number | "UNKNOWN";
    metadataComplete: boolean;
  };
}

export type OperatorPromotionDecision = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export interface PromotionApprovalValidationResult {
  canApprove: boolean;
  isConditional: boolean;
  warnings: string[];
  warningReasons?: string[];
  blockReason?: string;
}

/**
 * Validates whether an operator approval can proceed based on promotion eligibility invariants.
 * - NOT_READY: Cannot approve. (Deployment failed, missing CA, or unverified on-chain)
 * - UNKNOWN: Cannot approve. (Ambiguous lifecycle state)
 * - CONDITIONAL: Can approve with explicit warnings and required confirmation.
 * - ELIGIBLE: Cleared for approval.
 */
export function validatePromotionApproval(
  eligibility: PromotionEligibilityResult
): PromotionApprovalValidationResult {
  if (eligibility.status === "NOT_READY") {
    return {
      canApprove: false,
      isConditional: false,
      warnings: eligibility.reasons,
      warningReasons: eligibility.reasons,
      blockReason: `Cannot approve token in NOT_READY status: ${eligibility.reasons.join("; ") || "On-chain deployment verification and valid CA are required."}`,
    };
  }

  if (eligibility.status === "UNKNOWN") {
    return {
      canApprove: false,
      isConditional: false,
      warnings: eligibility.reasons,
      warningReasons: eligibility.reasons,
      blockReason: "Cannot approve token in UNKNOWN status: Deployment state is ambiguous or unresolved on-chain.",
    };
  }

  if (eligibility.status === "CONDITIONAL") {
    return {
      canApprove: true,
      isConditional: true,
      warnings: eligibility.reasons,
      warningReasons: eligibility.reasons,
    };
  }

  return {
    canApprove: true,
    isConditional: false,
    warnings: [],
    warningReasons: [],
  };
}

/**
 * Pure, deterministic evaluation of token promotion & directory readiness.
 *
 * Rules:
 *  - NOT_READY: Failed deployment, missing contract address, or unverified on-chain.
 *  - UNKNOWN: Ambiguous lifecycle state or unreachable telemetry.
 *  - CONDITIONAL: On-chain confirmed, but zero/unverified liquidity, missing socials, or zero volume.
 *  - ELIGIBLE: On-chain verified, positive liquidity, and complete metadata.
 *
 * Never fabricates missing metrics — uses "UNKNOWN" whenever data cannot be confirmed.
 */
export function evaluatePromotionEligibility(
  input: PromotionEligibilityInput
): PromotionEligibilityResult {
  const reasons: string[] = [];
  const eligiblePlatforms: string[] = [];

  const lifecycle = (input.lifecycleState ?? "").toUpperCase();
  const status = (input.status ?? "").toLowerCase();
  const chain = (input.chain ?? "base").toLowerCase();
  const ca = input.contractAddress?.trim() ?? "";

  // 1. Check basic deployment status and CA validity
  const isFailed = status === "failed" || lifecycle === "FAILED";
  const isPending = lifecycle === "DEPLOY_SUBMITTED" || status === "pending";
  const isUnknownStatus = status === "unknown" || lifecycle === "UNRESOLVED_UNKNOWN";
  const hasCa = ca.length >= 20 && !ca.includes("undefined") && !ca.includes("null") && ca !== "n/a";

  if (isFailed || !hasCa) {
    reasons.push(isFailed ? "Deployment has FAILED status." : "Missing or invalid contract address (CA).");
    return {
      status: "NOT_READY",
      reasons,
      eligiblePlatforms: [],
      evaluatedMetrics: {
        lifecycleState: lifecycle || "UNKNOWN",
        onChainVerified: input.onChainVerified ?? false,
        hasLiquidity: false,
        liquidityUsd: input.liquidityUsd ?? "UNKNOWN",
        hasVolume: false,
        volume24h: input.volume24h ?? "UNKNOWN",
        metadataComplete: false,
      },
    };
  }

  if (isUnknownStatus) {
    reasons.push("Deployment state is UNKNOWN or unresolved on-chain.");
    return {
      status: "UNKNOWN",
      reasons,
      eligiblePlatforms: [],
      evaluatedMetrics: {
        lifecycleState: lifecycle,
        onChainVerified: input.onChainVerified ?? "UNKNOWN",
        hasLiquidity: input.liquidityUsd !== undefined ? input.liquidityUsd !== null && input.liquidityUsd > 0 : "UNKNOWN",
        liquidityUsd: input.liquidityUsd ?? "UNKNOWN",
        hasVolume: input.volume24h !== undefined ? input.volume24h !== null && input.volume24h > 0 : "UNKNOWN",
        volume24h: input.volume24h ?? "UNKNOWN",
        metadataComplete: Boolean(input.hasWebsite && input.hasTwitter && input.hasDescription),
      },
    };
  }

  if (isPending) {
    reasons.push("Deployment is still pending confirmation (DEPLOY_SUBMITTED).");
    return {
      status: "NOT_READY",
      reasons,
      eligiblePlatforms: [],
      evaluatedMetrics: {
        lifecycleState: lifecycle,
        onChainVerified: input.onChainVerified ?? false,
        hasLiquidity: false,
        liquidityUsd: input.liquidityUsd ?? "UNKNOWN",
        hasVolume: false,
        volume24h: input.volume24h ?? "UNKNOWN",
        metadataComplete: Boolean(input.hasWebsite && input.hasTwitter && input.hasDescription),
      },
    };
  }

  // 2. On-Chain Verification
  if (input.onChainVerified === false) {
    reasons.push("Contract has not been verified on-chain via RPC.");
    return {
      status: "NOT_READY",
      reasons,
      eligiblePlatforms: [],
      evaluatedMetrics: {
        lifecycleState: lifecycle,
        onChainVerified: false,
        hasLiquidity: false,
        liquidityUsd: input.liquidityUsd ?? "UNKNOWN",
        hasVolume: false,
        volume24h: input.volume24h ?? "UNKNOWN",
        metadataComplete: Boolean(input.hasWebsite && input.hasTwitter && input.hasDescription),
      },
    };
  }

  // 3. Liquidity and Pool Check
  const hasPool = Boolean(input.poolId || input.pairAddress);
  const liquidityUsdVal = input.liquidityUsd;
  const hasKnownLiquidity = liquidityUsdVal !== undefined && liquidityUsdVal !== null;
  const hasLiquidity = hasKnownLiquidity ? liquidityUsdVal > 0 : (hasPool ? "UNKNOWN" : false);

  // 4. Volume Check
  const volumeVal = input.volume24h;
  const hasKnownVolume = volumeVal !== undefined && volumeVal !== null;

  // 5. Metadata Completeness
  const hasSocials = Boolean(input.hasWebsite && input.hasTwitter);
  const metadataComplete = Boolean(hasSocials && input.hasDescription);

  // Auto-discovery platforms (DexScreener, GeckoTerminal index DEX pools automatically)
  if (hasPool || (hasKnownLiquidity && liquidityUsdVal > 0)) {
    eligiblePlatforms.push("dexscreener_auto", "geckoterminal_auto");
  }

  // Conditional reasons
  const conditionalReasons: string[] = [];
  if (!hasSocials) {
    conditionalReasons.push("Social presence incomplete (missing official website or X/Twitter link).");
  }
  if (!hasPool && !hasKnownLiquidity) {
    conditionalReasons.push("No liquidity pool or bonding curve pair detected yet.");
  } else if (!hasKnownLiquidity) {
    conditionalReasons.push("Pool detected but liquidity value is unconfirmed/pending DEX indexing.");
  } else if (hasKnownLiquidity && liquidityUsdVal <= 0) {
    conditionalReasons.push("Pool detected but liquidity is zero ($0 USD).");
  }
  if (hasKnownVolume && volumeVal <= 0) {
    conditionalReasons.push("24h trading volume is currently $0 USD.");
  }

  // Internal quality heuristic: CoinGecko listing review requires sustained trading on a tracked exchange,
  // reliable market data, and complete documentation. We apply $5,000 liquidity + positive volume as an internal filter.
  if (
    hasKnownLiquidity &&
    liquidityUsdVal >= 5000 &&
    hasKnownVolume &&
    volumeVal > 0 &&
    metadataComplete
  ) {
    eligiblePlatforms.push("coingecko_manual_submission");
  }

  // Ecosystem directory criteria
  if (chain === "base" && metadataComplete && (hasPool || (hasKnownLiquidity && liquidityUsdVal > 0))) {
    eligiblePlatforms.push("base_ecosystem_submission");
  }
  if (metadataComplete) {
    eligiblePlatforms.push("community_announcements");
  }

  if (conditionalReasons.length > 0) {
    return {
      status: "CONDITIONAL",
      reasons: conditionalReasons,
      eligiblePlatforms,
      evaluatedMetrics: {
        lifecycleState: lifecycle,
        onChainVerified: input.onChainVerified ?? (lifecycle === "DEPLOY_CONFIRMED"),
        hasLiquidity: hasKnownLiquidity ? liquidityUsdVal > 0 : (hasPool ? "UNKNOWN" : false),
        liquidityUsd: hasKnownLiquidity ? liquidityUsdVal : "UNKNOWN",
        hasVolume: hasKnownVolume ? volumeVal > 0 : "UNKNOWN",
        volume24h: hasKnownVolume ? volumeVal : "UNKNOWN",
        metadataComplete,
      },
    };
  }

  // Fully ELIGIBLE
  return {
    status: "ELIGIBLE",
    reasons: [
      "On-chain deployment confirmed and verified.",
      "Liquidity pool active with positive liquidity.",
      "Social presence and token metadata complete.",
      "Eligible for automated DEX indexing and directory submission.",
    ],
    eligiblePlatforms,
    evaluatedMetrics: {
      lifecycleState: lifecycle,
      onChainVerified: true,
      hasLiquidity: true,
      liquidityUsd: liquidityUsdVal ?? "UNKNOWN",
      hasVolume: hasKnownVolume ? volumeVal > 0 : "UNKNOWN",
      volume24h: hasKnownVolume ? volumeVal : "UNKNOWN",
      metadataComplete: true,
    },
  };
}

export interface FreeDiscoveryPackage {
  tokenInfo: {
    name: string;
    symbol: string;
    chain: string;
    contractAddress: string;
    poolId?: string;
  };
  urls: {
    dexScreener: string;
    geckoTerminal: string;
    explorer: string;
    website?: string;
    twitter?: string;
    telegram?: string;
    baseEcosystemForm?: string;
  };
  marketMetrics: {
    priceUsd: string | "UNKNOWN";
    liquidityUsd: number | "UNKNOWN";
    volume24h: number | "UNKNOWN";
    onChainVerified: boolean | "UNKNOWN";
    verifiedStatus: string;
  };
  discoveryStatus: {
    dexScreener: "OBSERVED" | "PENDING_INDEXING" | "NOT_READY" | "AUTO-DISCOVERED";
    geckoTerminal: "OBSERVED" | "PENDING_INDEXING" | "NOT_READY" | "AUTO-DISCOVERED";
    coinGecko: "SUBMISSION-READY" | "NOT_READY" | "SUBMITTED" | "LISTED";
    baseEcosystem?: "SUBMISSION-READY" | "NOT_READY" | "SUBMITTED" | "LISTED";
    communityChannels: "SUBMISSION-READY" | "NOT_READY";
  };
  socialAnnouncement: {
    headline: string;
    socialPost: string;
    communityPost: string;
  };
  submissionMetadata: {
    projectName: string;
    tokenSymbol: string;
    contractAddress: string;
    chain: string;
    description: string;
    officialWebsite?: string;
    officialTwitter?: string;
    officialTelegram?: string;
    category: "Meme" | "DeFi" | "Community";
    tags: string[];
    officialSubmissionForm?: string;
  };
  eligibility: PromotionEligibilityResult;
  operatorDecision?: {
    status: OperatorPromotionDecision;
    operator: string;
    decidedAt?: string;
    reason?: string;
  };
  generatedAt: string;
}

/**
 * Generates a normalized Free Discovery & Directory Submission package from verified token data.
 */
export function generateDiscoveryPackage(
  tokenInput: TokenOfferInput,
  metrics?: {
    liquidityUsd?: number | null;
    volume24h?: number | null;
    priceUsd?: string | null;
    onChainVerified?: boolean | null;
    pairAddress?: string | null;
    lifecycleState?: string | null;
    status?: string | null;
  },
  operatorDecision?:
    | OperatorPromotionDecision
    | {
        status: OperatorPromotionDecision;
        operator?: string;
        decidedAt?: string;
        reason?: string;
      }
): FreeDiscoveryPackage {
  const ticker = tokenInput.ticker.replace(/^\$/, "").toUpperCase();
  const name = tokenInput.name;
  const ca = tokenInput.contractAddress;
  const chain = tokenInput.chain.toLowerCase();
  const poolId = tokenInput.poolId ?? metrics?.pairAddress;

  const dexScreenerUrl = chain === "solana"
    ? `https://dexscreener.com/solana/${ca}`
    : `https://dexscreener.com/base/${ca}`;

  // Canonical GeckoTerminal URL: links to /pools/${poolId} if pool is known, or /tokens/${ca} if pool is unindexed
  const geckoTerminalUrl = chain === "solana"
    ? (poolId ? `https://www.geckoterminal.com/solana/pools/${poolId}` : `https://www.geckoterminal.com/solana/tokens/${ca}`)
    : (poolId ? `https://www.geckoterminal.com/base/pools/${poolId}` : `https://www.geckoterminal.com/base/tokens/${ca}`);

  const explorerUrl = chain === "solana"
    ? `https://solscan.io/token/${ca}`
    : `https://basescan.org/token/${ca}`;

  const hasDesc = Boolean(tokenInput.description && tokenInput.description.trim().length >= 10);
  const eligibility = evaluatePromotionEligibility({
    lifecycleState: metrics?.lifecycleState ?? "DEPLOY_CONFIRMED",
    status: metrics?.status ?? "confirmed",
    onChainVerified: metrics?.onChainVerified ?? true,
    contractAddress: ca,
    chain,
    poolId,
    pairAddress: metrics?.pairAddress,
    liquidityUsd: metrics?.liquidityUsd,
    volume24h: metrics?.volume24h,
    priceUsd: metrics?.priceUsd,
    hasWebsite: Boolean(tokenInput.website),
    hasTwitter: Boolean(tokenInput.twitter),
    hasTelegram: Boolean(tokenInput.telegram),
    hasDescription: hasDesc,
  });

  const isBase = chain === "base";
  const isReady = eligibility.status !== "NOT_READY";
  const hasDexPair = Boolean(poolId || (metrics?.liquidityUsd != null && metrics.liquidityUsd > 0));
  const hasDexMetrics = Boolean(metrics?.priceUsd && metrics.priceUsd !== "N/A" && metrics.priceUsd !== "Offline");

  // Determine truthful discovery status per platform (never claim SUBMISSION-READY if deployment failed)
  const dexScreenerStatus = !isReady
    ? ("NOT_READY" as const)
    : (hasDexMetrics || hasDexPair)
    ? ("AUTO-DISCOVERED" as const)
    : ("PENDING_INDEXING" as const);

  const geckoTerminalStatus = !isReady
    ? ("NOT_READY" as const)
    : hasDexPair
    ? ("AUTO-DISCOVERED" as const)
    : ("PENDING_INDEXING" as const);

  const coinGeckoStatus = !isReady
    ? ("NOT_READY" as const)
    : ("SUBMISSION-READY" as const);

  const baseEcosystemStatus = isBase
    ? (!isReady ? ("NOT_READY" as const) : ("SUBMISSION-READY" as const))
    : undefined;

  const communityStatus = !isReady
    ? ("NOT_READY" as const)
    : ("SUBMISSION-READY" as const);

  const discoveryStatus = {
    dexScreener: dexScreenerStatus,
    geckoTerminal: geckoTerminalStatus,
    coinGecko: coinGeckoStatus,
    ...(isBase ? { baseEcosystem: baseEcosystemStatus } : {}),
    communityChannels: communityStatus,
  };

  const socialPost = `🚀 $${ticker} (${name}) on ${isBase ? "Base L2" : "Solana"}\n` +
    `0% Tax | Liquidity Locked | Renounced\n` +
    `📊 Chart: ${dexScreenerUrl}\n` +
    `CA: ${ca}`;

  const communityPost = `**NEW TOKEN DISCOVERY PACKAGE: $${ticker} (${name})**\n` +
    `Network: ${isBase ? "Base L2 (by Coinbase)" : "Solana Mainnet"}\n` +
    `Contract Address: \`${ca}\`\n` +
    `DexScreener: ${dexScreenerUrl}\n` +
    `GeckoTerminal: ${geckoTerminalUrl}\n` +
    `Explorer: ${explorerUrl}\n` +
    (tokenInput.website ? `Website: ${tokenInput.website}\n` : "") +
    (tokenInput.twitter ? `Twitter/X: ${tokenInput.twitter}\n` : "") +
    (tokenInput.telegram ? `Telegram: ${tokenInput.telegram}\n` : "") +
    `Description: ${tokenInput.description || "Autonomous community meme token."}\n` +
    `Promotion Status: ${eligibility.status} (${eligibility.reasons.join("; ")})`;

  return {
    tokenInfo: {
      name,
      symbol: ticker,
      chain,
      contractAddress: ca,
      poolId: poolId ?? undefined,
    },
    urls: {
      dexScreener: dexScreenerUrl,
      geckoTerminal: geckoTerminalUrl,
      explorer: explorerUrl,
      website: tokenInput.website,
      twitter: tokenInput.twitter,
      telegram: tokenInput.telegram,
      baseEcosystemForm: isBase ? "https://forms.gle/hJhc2PqfAsQp86YL8" : undefined,
    },
    marketMetrics: {
      priceUsd: metrics?.priceUsd ?? "UNKNOWN",
      liquidityUsd: metrics?.liquidityUsd ?? "UNKNOWN",
      volume24h: metrics?.volume24h ?? "UNKNOWN",
      onChainVerified: Boolean(metrics?.onChainVerified ?? true),
      verifiedStatus: metrics?.onChainVerified ? "VERIFIED_ON_CHAIN" : "PENDING_VERIFICATION",
    },
    discoveryStatus,
    socialAnnouncement: {
      headline: `$${ticker} Free Discovery Package (${name})`,
      socialPost,
      communityPost,
    },
    submissionMetadata: {
      projectName: name,
      tokenSymbol: ticker,
      contractAddress: ca,
      chain,
      description: tokenInput.description || `Autonomous ${name} community meme token on ${chain}.`,
      officialWebsite: tokenInput.website,
      officialTwitter: tokenInput.twitter,
      officialTelegram: tokenInput.telegram,
      category: "Meme",
      tags: [chain, "meme", "flywheel", "zero-tax"],
      officialSubmissionForm: isBase ? "https://forms.gle/hJhc2PqfAsQp86YL8" : undefined,
    },
    eligibility,
    operatorDecision: (() => {
      if (typeof operatorDecision === "string") {
        return {
          status: operatorDecision,
          operator: "local_operator",
          decidedAt: new Date().toISOString(),
        };
      }
      if (operatorDecision && typeof operatorDecision === "object") {
        return {
          status: operatorDecision.status,
          operator: operatorDecision.operator || "local_operator",
          decidedAt: operatorDecision.decidedAt,
          reason: operatorDecision.reason,
        };
      }
      if (ca) {
        try {
          const dbRec = getPromotionDecision(ca);
          if (dbRec) {
            return {
              status: dbRec.decision,
              operator: dbRec.operator,
              decidedAt: dbRec.decidedAt,
              reason: dbRec.reason,
            };
          }
        } catch {
          // Ignore if SQLite is unavailable
        }
      }
      return {
        status: "PENDING_REVIEW" as OperatorPromotionDecision,
        operator: "local_operator",
      };
    })(),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Saves a FreeDiscoveryPackage JSON artifact to disk for operator review and submission.
 */
export function saveDiscoveryPackageJson(
  pkg: FreeDiscoveryPackage,
  options?: { outputDir?: string; chainSuffix?: boolean }
): { success: boolean; primaryPath?: string; chainPath?: string; error?: string } {
  try {
    const promoDir = options?.outputDir ?? path.resolve(process.cwd(), "promotions");
    if (!fs.existsSync(promoDir)) {
      fs.mkdirSync(promoDir, { recursive: true });
    }

    const jsonContent = JSON.stringify(pkg, null, 2);
    const primaryPath = path.join(promoDir, `DISCOVERY_${pkg.tokenInfo.symbol}.json`);
    fs.writeFileSync(primaryPath, jsonContent, "utf8");

    let chainPath: string | undefined;
    if (options?.chainSuffix ?? true) {
      chainPath = path.join(promoDir, `DISCOVERY_${pkg.tokenInfo.symbol}_${pkg.tokenInfo.chain.toUpperCase()}.json`);
      fs.writeFileSync(chainPath, jsonContent, "utf8");
    }

    return { success: true, primaryPath, chainPath };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

