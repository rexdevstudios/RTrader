/**
 * src/modules/growth/project-enricher.ts
 *
 * Enriches token deployments into high-credibility, fully-populated
 * Bankr Agent Projects with AI Core Teams, Real Products, and Revenue Streams.
 *
 * Eliminates empty project shells (0 team, 0 products) by generating
 * convincing, domain-aligned Web3 / AI Agent metadata for public listings.
 */

import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import {
  getBankrProfiles,
  updateBankrProfile,
  createBankrProfile,
  type CreateProfilePayload,
  type BankrProfile,
  type RequestOptions,
} from "../evm/bankr-project.ts";

export interface TokenProjectInput {
  name: string;
  ticker: string;
  contractAddress: string;
  chain?: string;
  description?: string;
  website?: string;
  logoUrl?: string;
  telegramUrl?: string;
  twitterUrl?: string;
  poolId?: string;
}

export interface EnrichedProjectData {
  projectName: string;
  description: string;
  tokenAddress: string;
  website: string;
  profileImageUrl: string;
  isPublished: boolean;
  tags: string[];
  teamMembers: Array<{
    name: string;
    role: string;
    links?: Array<{ type: string; url: string }>;
  }>;
  products: Array<{
    name: string;
    description?: string;
    url?: string;
  }>;
  revenueSources: Array<{
    name: string;
    description?: string;
  }>;
}

/**
 * Builds a comprehensive, professional project payload for Bankr API
 * given a deployed token's identity and contract address.
 */
export function buildEnrichedProjectData(input: TokenProjectInput): EnrichedProjectData {
  const cfg = getConfig();
  const ticker = input.ticker.replace(/^\$/, "").toUpperCase();
  const name = input.name;
  const ca = input.contractAddress;
  const cleanTicker = ticker.replace(/[^a-zA-Z0-9]/g, "");
  const tokenSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const website =
    input.website ||
    (cfg.DEFAULT_PROJECT_WEBSITE
      ? cfg.DEFAULT_PROJECT_WEBSITE.replace(/\{ticker\}/gi, cleanTicker).replace(/\{slug\}/gi, tokenSlug)
      : `https://bankr.bot/agents/${tokenSlug}`);

  const telegramUrl =
    input.telegramUrl ||
    (cfg.DEFAULT_TELEGRAM_LINK
      ? cfg.DEFAULT_TELEGRAM_LINK.replace(/\{ticker\}/gi, cleanTicker).replace(/\{slug\}/gi, tokenSlug)
      : `https://t.me/${cleanTicker}_portal`);

  const twitterUrl =
    input.twitterUrl ||
    (cfg.DEFAULT_TWITTER_HANDLE
      ? `https://x.com/${cfg.DEFAULT_TWITTER_HANDLE.replace(/^@/, "").replace(/\{ticker\}/gi, cleanTicker).slice(0, 15)}`
      : `https://x.com/${cleanTicker}_coin`);

  const profileImageUrl =
    input.logoUrl ||
    `https://image.pollinations.ai/prompt/${encodeURIComponent(name)}%20crypto%20token%20logo?width=512&height=512&nologo=true`;

  const description =
    input.description ||
    `Autonomous AI Agent Protocol on Base Mainnet. Features 0% trading tax, 95% WETH creator fee recycler, and automated community tokenomics.`;

  // 1. Professional AI & Protocol Core Team
  const teamMembers = [
    {
      name: `${cleanTicker} Protocol Architect`,
      role: "Autonomous System & Core Protocol Lead",
      links: [
        { type: "website", url: website },
        { type: "telegram", url: telegramUrl },
      ],
    },
    {
      name: "Doppler Sentinel",
      role: "Liquidity & Flywheel Engineer",
      links: [
        { type: "twitter", url: twitterUrl },
        { type: "website", url: `https://basescan.org/token/${ca}` },
      ],
    },
    {
      name: "NeuroAgent Vanguard",
      role: "Telegram Bot & Ecosystem Growth",
      links: [
        { type: "telegram", url: telegramUrl },
        { type: "website", url: `https://dexscreener.com/base/${ca}` },
      ],
    },
  ];

  // 2. Concrete, Usable Products
  const products = [
    {
      name: `$${ticker} Telegram Alpha Agent Bot`,
      description: `Interactive Telegram bot providing live DexScreener charts, holder analytics, contract security auditing, and 1-click Uniswap routing.`,
      url: telegramUrl,
    },
    {
      name: "95% WETH Protocol Fee Recycler",
      description: `Autonomous engine capturing Uniswap V3 swap fees on Base L2, converting them into perpetual buyback burns and holder dividends.`,
      url: website,
    },
    {
      name: "EIP-1167 Immutable Token Contract",
      description: `Audited, renounced minimal proxy contract on Base Mainnet with 0% buy/sell taxes and permanent locked liquidity.`,
      url: `https://basescan.org/token/${ca}`,
    },
  ];

  // 3. Clear, High-Trust Revenue Sources
  const revenueSources = [
    {
      name: "Uniswap V3 LP Swap Volume",
      description: "95% of all trading pool creator fees collected continuously in native WETH.",
    },
    {
      name: "Autonomous Buyback & Burn Reserve",
      description: "Dedicated percentage of protocol revenue dedicated to buying and incinerating tokens.",
    },
    {
      name: "Holder Passive Dividends Pool",
      description: "Automated distribution of trading fee surplus directly to active holders.",
    },
  ];

  const tags = ["AI Agent", "Autonomous", "Base", "Flywheel", "Deflationary", "Zero Tax"];

  return {
    projectName: name,
    description,
    tokenAddress: ca,
    website,
    profileImageUrl,
    isPublished: true,
    tags,
    teamMembers,
    products,
    revenueSources,
  };
}

/**
 * Enriches and synchronizes a deployed token with the official Bankr API.
 * Updates an existing project if found, or creates a new published project.
 */
export async function enrichAndSyncBankrProject(
  input: TokenProjectInput,
  options?: RequestOptions
): Promise<{ profile: BankrProfile; action: "created" | "updated" }> {
  const enriched = buildEnrichedProjectData(input);

  logger.info(`🤖 [PROJECT ENRICHER] Menyiapkan sinkronisasi profil Bankr untuk $${input.ticker}...`);
  logger.info(`   Nama Proyek    : ${enriched.projectName}`);
  logger.info(`   Alamat Token   : ${enriched.tokenAddress}`);
  logger.info(`   Jumlah Anggota : ${enriched.teamMembers.length} anggota tim inti`);
  logger.info(`   Jumlah Produk  : ${enriched.products.length} produk terdaftar`);

  const existingProfiles = await getBankrProfiles(options);
  const targetSlug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const match = existingProfiles.find(
    (p) =>
      (p.tokenAddress && p.tokenAddress.toLowerCase() === input.contractAddress.toLowerCase()) ||
      p.slug === targetSlug
  );

  const payload: CreateProfilePayload = {
    projectName: enriched.projectName,
    description: enriched.description,
    tokenAddress: enriched.tokenAddress,
    website: enriched.website,
    profileImageUrl: enriched.profileImageUrl,
    isPublished: true,
    teamMembers: enriched.teamMembers,
    products: enriched.products,
    revenueSources: enriched.revenueSources,
  };

  if (match) {
    logger.info(`🔄 [PROJECT ENRICHER] Memperbarui proyek yang sudah ada: "${match.projectName}" (${match.slug})...`);
    const updated = await updateBankrProfile(match.slug, payload, options);
    logger.success(`✅ [PROJECT ENRICHER] Proyek "${updated.projectName}" berhasil disinkronkan ke Bankr!`);
    return { profile: updated, action: "updated" };
  } else {
    logger.info(`✨ [PROJECT ENRICHER] Mendaftarkan proyek baru ke Bankr: "${enriched.projectName}"...`);
    const created = await createBankrProfile(payload, options);
    logger.success(`✅ [PROJECT ENRICHER] Proyek baru "${created.projectName}" berhasil dipublikasikan di Bankr!`);
    return { profile: created, action: "created" };
  }
}
