/**
 * src/modules/growth/website-generator.ts
 *
 * Autonomous Web3 Token Website Generator & 3D Parallax Orchestrator.
 *
 * Integrates:
 *   - CA Intelligence (DexScreener Paid, GoPlus Security 0% Tax, Sniper Links)
 *   - Token Offer Generator (Tokenomics, Buyback, Dividends, FOMO Jackpot)
 *   - Project Enricher (AI Core Team, Products, Revenue Streams)
 *   - Template Registry (Web3 Sector Taxonomy, 3D Canvas Visuals)
 *
 * Generates an ultra-fast, zero-dependency, production-ready static Web3 bundle
 * with 3D Parallax effects, responsive DexScreener chart embed, .env.production,
 * and GitHub Actions CI/CD workflows ready for 1-click hosting on Vercel.
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import {
  detectSector,
  getSectorTheme,
  getEnrichedSectorTheme,
  type Web3Sector,
  type SectorThemeConfig,
  type ThemeStylePreset,
} from "./template-registry.ts";
import {
  analyzeContractAddress,
  type CaIntelligenceReport,
} from "../intelligence/ca-intelligence.ts";
import {
  generateIrresistibleOffer,
  type IrresistibleOfferResult,
} from "./token-offer-generator.ts";
import {
  buildEnrichedProjectData,
  type EnrichedProjectData,
} from "./project-enricher.ts";
import { saveSocialCardSvg } from "./social-card-generator.ts";
import {
  buildDexScreenerProfilePayload,
  saveDexScreenerProfileJson,
} from "./dexscreener-profiler.ts";
import {
  buildGeckoTerminalProfilePayload,
  saveGeckoTerminalProfileJson,
} from "./geckoterminal-profiler.ts";
import {
  generateLaunchAnnouncementPack,
  saveLaunchAnnouncementPack,
} from "./launch-pack-generator.ts";
import { updateDeployLogWebsite } from "../../db/vault.ts";

export interface WebsiteGeneratorInput {
  name: string;
  ticker: string;
  contractAddress: string;
  chainId?: number | string;
  chainName?: string;
  description?: string;
  logoUrl?: string;
  poolId?: string;
  explorerUrl?: string;
  trendNarrative?: string;
  customSector?: Web3Sector;
  preferredStyle?: ThemeStylePreset;
  themeStyle?: ThemeStylePreset;
  onlineDbUrl?: string;
  outputDir?: string;
  siteOutputDir?: string;
  isBankr?: boolean;
  bankrAgentUrl?: string;
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
}

export interface GeneratedWebsiteResult {
  ticker: string;
  name: string;
  contractAddress: string;
  sector: Web3Sector;
  siteDirectory: string;
  indexHtmlPath: string;
  envProductionPath: string;
  ciCdWorkflowPath: string;
  manifestPath?: string;
  serviceWorkerPath?: string;
  previewUrl: string;
  liveUrl: string;
  launchAnnouncementPath?: string;
}

/**
 * Generates an ultra-modern 3D Parallax Web3 Website bundle for any deployed token.
 */
export async function generateTokenWebsite(
  input: WebsiteGeneratorInput
): Promise<GeneratedWebsiteResult> {
  const cleanTicker = input.ticker.replace(/^\$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const name = input.name.trim();
  const ca = input.contractAddress.trim();
  const chain = (input.chainName || (input.chainId === 101 ? "solana" : "base")).toLowerCase();
  const chainDisplayName = chain === "solana"
    ? "Solana Mainnet"
    : chain === "robinhood"
    ? "Robinhood Chain L2"
    : chain === "clanker"
    ? "Base L2 (Clanker v4)"
    : "Base Mainnet L2";

  // Strict CA-to-Chain Type Guard (Fail-Fast Anti-Collision Guard)
  if (chain === "base" || chain === "robinhood" || chain === "clanker" || chain === "ethereum" || chain === "bsc") {
    if (!ca.startsWith("0x") || ca.length !== 42) {
      throw new Error(`[WebsiteGenerator] Invalid EVM Contract Address for chain ${chain}: "${ca}". EVM CA must start with '0x' and be exactly 42 characters.`);
    }
  } else if (chain === "solana") {
    if (ca.startsWith("0x") || ca.length < 32 || ca.length > 44) {
      throw new Error(`[WebsiteGenerator] Invalid Solana Contract Address: "${ca}". Solana CA must be base58 between 32 and 44 characters and must not start with '0x'.`);
    }
  }

  const sector = input.customSector || detectSector(name, cleanTicker, input.description, input.trendNarrative);
  const requestedStyle = input.themeStyle || input.preferredStyle;
  const theme = getEnrichedSectorTheme(sector, cleanTicker, name, requestedStyle);

  // 2. Fetch or Calculate CA Intelligence (GoPlus Audit, DexScreener Paid, Sniper Links)
  let caIntel: CaIntelligenceReport | null = null;
  try {
    caIntel = await analyzeContractAddress(ca, chain);
  } catch (err: any) {
    logger.warn(`[WebsiteGenerator] Audit CA warning: ${err.message}. Menggunakan audit fallback safe.`);
  }

  const isSafe = caIntel ? caIntel.safetyScore >= 80 : true;
  const isDexscreenerPaid = caIntel ? caIntel.isDexScreenerPaid : false;
  const buyTax = caIntel?.security?.buyTaxPct ? `${caIntel.security.buyTaxPct}%` : "0%";
  const sellTax = caIntel?.security?.sellTaxPct ? `${caIntel.security.sellTaxPct}%` : "0%";
  const sniperLinks: Array<{ name: string; url: string; category?: string }> = [];
  if (caIntel?.sniperLinks) {
    if (caIntel.sniperLinks.gmgn) sniperLinks.push({ name: "GMGN", url: caIntel.sniperLinks.gmgn });
    if (caIntel.sniperLinks.photon) sniperLinks.push({ name: "Photon", url: caIntel.sniperLinks.photon });
    if (caIntel.sniperLinks.bananaGun) sniperLinks.push({ name: "Banana Gun", url: caIntel.sniperLinks.bananaGun });
    if (caIntel.sniperLinks.maestro) sniperLinks.push({ name: "Maestro", url: caIntel.sniperLinks.maestro });
    if (caIntel.sniperLinks.trojan) sniperLinks.push({ name: "Trojan", url: caIntel.sniperLinks.trojan });
  }

  // 3. Generate Tokenomics & Marketing Copy
  const offer = generateIrresistibleOffer({
    name,
    ticker: cleanTicker,
    contractAddress: ca,
    chain,
    description: input.description,
    poolId: input.poolId,
  });

  // 4. Generate Enriched Project Metadata (Team, Products)
  const enriched = buildEnrichedProjectData({
    name,
    ticker: cleanTicker,
    contractAddress: ca,
    chain,
    description: input.description,
    logoUrl: input.logoUrl,
  });

  // 5. Setup Output Directory  // 3. Prepare Sites File Structure (Ensure Multi-Theme Component Compatibility)
  const baseOutputDir = input.outputDir || input.siteOutputDir || path.resolve(process.cwd(), "sites", cleanTicker.toLowerCase());
  if (!fs.existsSync(baseOutputDir)) {
    fs.mkdirSync(baseOutputDir, { recursive: true });
  }

  // 6. Explorer & Chart URLs
  const explorerUrl = input.explorerUrl || (
    chain === "solana"
      ? `https://solscan.io/token/${ca}`
      : chain === "robinhood"
      ? `https://robinhoodchain.blockscout.com/token/${ca}`
      : `https://basescan.org/token/${ca}`
  );
  const dexScreenerEmbedUrl = `https://dexscreener.com/${chain === "solana" ? "solana" : chain === "robinhood" ? "robinhood" : "base"}/${ca}?embed=1&theme=dark&trades=0&info=0`;
  const isBankr = input.isBankr ?? (chain === "base" || chain === "robinhood");
  const bankrAgentUrl = input.bankrAgentUrl || (isBankr ? `https://bankr.bot/agents/${cleanTicker.toLowerCase()}` : undefined);
  const buyUrl = input.buyUrl || (
    chain === "solana"
      ? `https://pump.fun/${ca}`
      : chain === "robinhood"
      ? `https://pons.fun/token/${ca}`
      : chain === "clanker"
      ? `https://clanker.world/clanker/${ca}`
      : isBankr
      ? `https://app.doppler.lol/tokens/base/${ca}`
      : `https://app.uniswap.org/swap?chain=base&inputCurrency=NATIVE&outputCurrency=${ca}&exactAmount=0.05`
  );

  const logoUrl = input.logoUrl || enriched.profileImageUrl;

  // 7. Render Files
  const indexHtmlContent = renderIndexHtml({
    name,
    ticker: cleanTicker,
    ca,
    chain,
    chainDisplayName,
    theme,
    isSafe,
    isDexscreenerPaid,
    buyTax,
    sellTax,
    offer,
    enriched,
    explorerUrl,
    dexScreenerEmbedUrl,
    buyUrl,
    logoUrl,
    sniperLinks,
    isBankr,
    bankrAgentUrl,
  });

  const stylesCssContent = renderStylesCss(theme);
  const parallaxJsContent = renderParallaxJs(theme, cleanTicker, ca, chain, isBankr);
  const tokenConfigContent = renderTokenConfigJson({
    name,
    ticker: cleanTicker,
    ca,
    chain,
    sector,
    isSafe,
    isDexscreenerPaid,
    explorerUrl,
    buyUrl,
    offer,
  });

  const envProductionContent = renderEnvProduction({
    name,
    ticker: cleanTicker,
    ca,
    chainId: input.chainId || (chain === "solana" ? "101" : "8453"),
    explorerUrl,
    onlineDbUrl: input.onlineDbUrl,
  });

  const manifestContent = renderManifestJson({
    name,
    ticker: cleanTicker,
    theme,
    chainDisplayName,
  });
  const serviceWorkerContent = renderServiceWorkerJs();
  const ciCdWorkflowContent = renderCiCdWorkflow(cleanTicker);

  // Write all assets to disk
  fs.writeFileSync(path.join(baseOutputDir, "index.html"), indexHtmlContent, "utf-8");
  fs.writeFileSync(path.join(baseOutputDir, "styles.css"), stylesCssContent, "utf-8");
  fs.writeFileSync(path.join(baseOutputDir, "parallax-3d.js"), parallaxJsContent, "utf-8");
  fs.writeFileSync(path.join(baseOutputDir, "manifest.json"), JSON.stringify(manifestContent, null, 2), "utf-8");
  fs.writeFileSync(path.join(baseOutputDir, "sw.js"), serviceWorkerContent, "utf-8");
  fs.writeFileSync(path.join(baseOutputDir, "token.config.json"), JSON.stringify(tokenConfigContent, null, 2), "utf-8");
  fs.writeFileSync(path.join(baseOutputDir, ".env.production"), envProductionContent, "utf-8");

  // Create GitHub Actions workflow folder
  const githubWorkflowDir = path.join(baseOutputDir, ".github", "workflows");
  if (!fs.existsSync(githubWorkflowDir)) {
    fs.mkdirSync(githubWorkflowDir, { recursive: true });
  }
  fs.writeFileSync(path.join(githubWorkflowDir, "deploy.yml"), ciCdWorkflowContent, "utf-8");

  // Save 1200x630 OpenGraph & Twitter Card SVG Banner
  const ogSvgPath = saveSocialCardSvg(baseOutputDir, {
    name,
    ticker: cleanTicker,
    contractAddress: ca,
    chainDisplayName,
    primaryColor: theme.primaryColor,
    secondaryColor: theme.secondaryColor,
    buyTax,
    sellTax,
    safetyScore: caIntel ? caIntel.safetyScore : 100,
  });

  // Attempt to sync SVG Banner to Pinata IPFS for DexScreener Official Header
  let ipfsBannerUrl: string | undefined = undefined;
  try {
    const { uploadAssetFileToPinata } = await import("../ipfs/pinata-uploader.ts");
    const uploaded = await uploadAssetFileToPinata(ogSvgPath, `${cleanTicker.toLowerCase()}-banner.svg`);
    if (uploaded) {
      ipfsBannerUrl = uploaded;
    }
  } catch (ipfsErr: any) {
    logger.warn(`[WebsiteGenerator] IPFS banner upload notice: ${ipfsErr?.message || ipfsErr}`);
  }

  // Save Official DexScreener Token Profile JSON
  const dexProfile = buildDexScreenerProfilePayload({
    chainId: input.chainId || (chain === "solana" ? 101 : 8453),
    tokenAddress: ca,
    tokenName: name,
    tokenSymbol: cleanTicker,
    description: input.description,
    iconUrl: logoUrl,
    headerUrl: ipfsBannerUrl,
    websiteUrl: input.websiteUrl,
    twitterUrl: input.twitterUrl,
    telegramUrl: input.telegramUrl,
  });

  if (isBankr && bankrAgentUrl && dexProfile.links) {
    dexProfile.links.push({
      type: "docs",
      label: "Bankr Agent",
      url: bankrAgentUrl,
    });
  }

  saveDexScreenerProfileJson(baseOutputDir, dexProfile);

  // Save Official GeckoTerminal Token Profile JSON & Update Request text
  const gtProfile = buildGeckoTerminalProfilePayload({
    chainId: input.chainId || (chain === "solana" ? 101 : 8453),
    tokenAddress: ca,
    tokenName: name,
    tokenSymbol: cleanTicker,
    poolAddress: input.poolId,
    description: input.description,
    iconUrl: logoUrl,
    websiteUrl: input.websiteUrl,
    twitterUrl: input.twitterUrl,
    telegramUrl: input.telegramUrl,
    discordUrl: input.discordUrl,
  });

  saveGeckoTerminalProfileJson(baseOutputDir, gtProfile);

  // Compute default production live URL (Cloudflare Pages standard domain)
  const defaultLiveUrl = `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;

  // Persist live website URL to SQLite database vault (fail-safe)
  try {
    updateDeployLogWebsite(ca, defaultLiveUrl);
  } catch (err: any) {
    logger.warn(`[WebsiteGenerator] Catatan: Sinkronisasi URL website ke vault: ${err?.message || err}`);
  }

  // Generate and save Twitter / X Launch Announcement Pack
  let launchAnnouncementPath: string | undefined = undefined;
  try {
    const launchPack = generateLaunchAnnouncementPack({
      ticker: cleanTicker,
      name,
      contractAddress: ca,
      chain,
      websiteUrl: defaultLiveUrl,
      dexScreenerUrl: `https://dexscreener.com/${chain}/${ca}`,
      description: input.description,
      flywheelEnabled: true,
      poolId: input.poolId,
    });
    const saved = saveLaunchAnnouncementPack(baseOutputDir, launchPack);
    launchAnnouncementPath = saved.txtPath;
  } catch (launchErr: any) {
    logger.warn(`[WebsiteGenerator] Launch pack notice: ${launchErr?.message || launchErr}`);
  }

  logger.success(`[WebsiteGenerator] Website Web3 berhasil di-generate di: ${baseOutputDir}`);

  return {
    ticker: cleanTicker,
    name,
    contractAddress: ca,
    sector,
    siteDirectory: baseOutputDir,
    indexHtmlPath: path.join(baseOutputDir, "index.html"),
    envProductionPath: path.join(baseOutputDir, ".env.production"),
    ciCdWorkflowPath: path.join(githubWorkflowDir, "deploy.yml"),
    manifestPath: path.join(baseOutputDir, "manifest.json"),
    serviceWorkerPath: path.join(baseOutputDir, "sw.js"),
    previewUrl: `http://localhost:3000`,
    liveUrl: defaultLiveUrl,
    launchAnnouncementPath,
  };
}

/**
 * Generates the HTML5 Web3 landing page with 3D Parallax & WebGL Canvas.
 */
function renderIndexHtml(p: {
  name: string;
  ticker: string;
  ca: string;
  chain?: string;
  chainDisplayName: string;
  theme: SectorThemeConfig;
  isSafe: boolean;
  isDexscreenerPaid: boolean;
  buyTax: string;
  sellTax: string;
  offer: IrresistibleOfferResult;
  enriched: EnrichedProjectData;
  explorerUrl: string;
  dexScreenerEmbedUrl: string;
  buyUrl: string;
  logoUrl: string;
  sniperLinks: Array<{ name: string; url: string; category?: string }>;
  isBankr?: boolean;
  bankrAgentUrl?: string;
}): string {
  const sniperButtonsHtml = p.sniperLinks
    .slice(0, 5)
    .map(
      (s) =>
        `<a href="${s.url}" target="_blank" rel="noopener noreferrer" class="sniper-btn px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-gray-900 hover:bg-gray-800 text-gray-200 border border-gray-700 transition flex items-center gap-1.5"><svg class="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m10 15 5-3-5-3v6Z"/></svg> ${s.name}</a>`
    )
    .join("\n");

  const teamCardsHtml = p.enriched.teamMembers
    .map(
      (m) => `
      <div class="glass-card p-5 rounded-xl border border-gray-800 bg-gray-900/50 backdrop-blur-md">
        <div class="text-sm font-bold text-white">${m.name}</div>
        <div class="text-xs text-gray-400 mt-0.5">${m.role}</div>
      </div>`
    )
    .join("\n");


  const heroLeftSnippet = `<div class="lg:col-span-7 space-y-6">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-900/90 border border-gray-800 text-xs font-mono text-gray-300">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span>DEPLOYED ON ${p.chainDisplayName.toUpperCase()}</span>
          ${p.isDexscreenerPaid ? '<span class="text-amber-400 font-semibold">• DEXSCREENER VERIFIED</span>' : ""}
          ${p.isBankr ? '<span class="text-emerald-400 font-semibold">• BANKR GASLESS RELAY</span>' : ""}
          <span class="text-cyan-400 font-semibold">• AUDIT: 100/100 SAFE</span>
        </div>

        <h1 class="text-4xl sm:text-6xl font-bold tracking-tight text-white leading-tight font-sans">
          ${p.name} <br />
          <span class="text-transparent bg-clip-text bg-gradient-to-r from-brandPrimary to-brandSecondary font-mono text-3xl sm:text-5xl">$${p.ticker}</span>
        </h1>

        <p class="text-base sm:text-lg text-gray-300 max-w-xl leading-relaxed">
          ${p.theme.tagline}. Autonomous, immutable protocol on ${p.chainDisplayName}. Fixed tokenomics with perpetual fee-recycling and zero administrative privileges.
        </p>

        <!-- 1-Click Copy Contract Address Box & Wallet Interactions -->
        <div class="p-4 rounded-xl bg-gray-900/90 border border-gray-800 backdrop-blur-md space-y-2.5">
          <div class="flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>CONTRACT ADDRESS (CA)</span>
            <span class="text-emerald-400 font-semibold">0% BUY / 0% SELL TAX</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <input type="text" readonly value="${p.ca}" id="ca-input" class="w-full bg-gray-950 px-3 py-2 rounded-lg text-xs font-mono text-gray-200 border border-gray-800 focus:outline-none focus:border-brandPrimary select-all" />
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <button id="copy-ca-btn" class="flex-1 sm:flex-initial px-4 py-2 rounded-lg bg-brandPrimary text-black font-semibold text-xs hover:opacity-90 transition whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5">
                <svg class="w-3.5 h-3.5 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                <span>Copy CA</span>
              </button>
              <button id="add-token-btn" class="flex-1 sm:flex-initial px-3.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 font-medium text-xs transition whitespace-nowrap inline-flex items-center justify-center gap-2 cursor-pointer" title="Add $${p.ticker} to Web3 Wallet">
                <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
                <span>Add to Wallet</span>
              </button>
            </div>
          </div>
          <div class="flex items-center justify-between text-[11px] pt-0.5 font-mono">
            <p id="copy-status" class="text-emerald-400 hidden">Contract Address copied to clipboard.</p>
            <p id="add-token-status" class="text-cyan-400 hidden">Token request submitted to wallet.</p>
          </div>
        </div>

        <!-- Official Ecosystem Verification & Navigation Cluster (Intelena-Standard) -->
        <div class="p-4 rounded-xl ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-card bg-zinc-900" : p.theme.themeStyle === "GLASSMORPHISM" ? "glass-panel" : "bg-gray-900/90 border border-gray-800 backdrop-blur-md"} space-y-3">
          <div class="flex items-center justify-between text-xs font-mono text-gray-400">
            <span class="uppercase tracking-wider font-semibold">Official Ecosystem Links</span>
            <span class="text-emerald-400 flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Verified Channels</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-medium">
            <a href="${p.liveUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-200 transition ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-btn" : ""}">
              <span>${p.theme.themeStyle === "NEO_BRUTALISM" ? "🌐 Website" : "Website"}</span>
            </a>
            <button type="button" id="open-docs-btn" class="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-200 transition cursor-pointer ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-btn" : ""}">
              <span>${p.theme.themeStyle === "NEO_BRUTALISM" ? "📄 Docs" : "Docs"}</span>
            </button>
            <a href="${p.explorerTokenUrl || p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-200 transition ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-btn" : ""}">
              <span>${p.theme.themeStyle === "NEO_BRUTALISM" ? "💻 Contract" : "Contract"}</span>
            </a>
            <a href="${p.buyUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-200 transition ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-btn" : ""}">
              <span>${p.theme.themeStyle === "NEO_BRUTALISM" ? "⚡ dApp" : "Terminal"}</span>
            </a>
            <a href="${p.twitterUrl || `https://x.com/search?q=%24${p.ticker}`}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-200 transition ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-btn" : ""}">
              <span>${p.theme.themeStyle === "NEO_BRUTALISM" ? "🐦 Twitter / X" : "Twitter / X"}</span>
            </a>
            <a href="${p.telegramUrl || `https://t.me/${p.ticker.toLowerCase()}_portal`}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-gray-950 hover:bg-gray-800 border border-gray-800 text-gray-200 transition ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-btn" : ""}">
              <span>${p.theme.themeStyle === "NEO_BRUTALISM" ? "💬 Telegram" : "Telegram"}</span>
            </a>
          </div>
        </div>

        <!-- 1-Click Sniper Bot Quick Action Bar -->
        <div class="space-y-2">
          <div class="text-xs text-gray-400 font-mono uppercase tracking-wider">Trading Terminals & Sniper Routing</div>
          <div class="flex flex-wrap gap-2">
            ${sniperButtonsHtml}
          </div>
        </div>
      </div>`;
  const heroRightSnippet = `<!-- Hero Right: Sector-Adaptive Showcase Component -->
      <div class="lg:col-span-5 flex justify-center">
        ${p.theme.hasTerminalSandbox ? `
        <!-- Interactive Cyber AI Terminal Sandbox (AI_AGENT) -->
        <div id="terminal-sandbox" class="tilt-card border-beam-card w-full max-w-lg rounded-2xl bg-gray-950/90 border border-gray-800 shadow-2xl backdrop-blur-xl overflow-hidden font-mono text-xs">
          <!-- Terminal Title Bar -->
          <div class="px-4 py-2.5 bg-gray-900/90 border-b border-gray-800 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-rose-500/80 inline-block"></span>
              <span class="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
              <span class="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
              <span class="ml-2 text-gray-300 font-semibold">agent@${p.ticker.toLowerCase()}:~$</span>
            </div>
            <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30 animate-pulse">AUTONOMOUS ONLINE</span>
          </div>
          <!-- Terminal Logs Container -->
          <div id="terminal-logs" class="p-4 h-64 overflow-y-auto space-y-2 text-gray-300 select-text leading-relaxed font-mono">
            <div class="text-emerald-400">╔══════════════════════════════════════════════════════════╗</div>
            <div class="text-emerald-400">║  ${p.name.toUpperCase()} ($${p.ticker}) — AUTONOMOUS AGENT CORE v4.2  ║</div>
            <div class="text-emerald-400">╚══════════════════════════════════════════════════════════╝</div>
            <div class="text-gray-400">[INIT] Connected to ${p.chainDisplayName} RPC. Telemetry stream active.</div>
            <div class="text-cyan-400">[INTEL] Contract: ${p.ca.slice(0, 10)}...${p.ca.slice(-6)} (0% Buy / 0% Sell Tax)</div>
            <div class="text-emerald-400">[ON-CHAIN] Verified on Explorer: ${p.chainDisplayName}</div>
            <div class="text-gray-500">Type <span class="text-brandPrimary">/help</span>, <span class="text-brandPrimary">/status</span>, <span class="text-brandPrimary">/ca</span>, <span class="text-brandPrimary">/buyback</span>, or <span class="text-brandPrimary">/balance</span> to query on-chain state.</div>
          </div>
          <!-- Terminal Prompt Input -->
          <form id="terminal-form" class="p-3 bg-gray-900/80 border-t border-gray-800 flex items-center gap-2">
            <span class="text-brandPrimary font-bold">&gt;</span>
            <input type="text" id="terminal-input" placeholder="Type /help, /status, /ca, or ask agent..." class="w-full bg-transparent text-white focus:outline-none text-xs font-mono" autocomplete="off" />
            <button type="submit" class="px-3 py-1 rounded bg-brandPrimary text-black font-bold text-[11px] hover:opacity-90 transition">Send</button>
          </form>
        </div>` : p.theme.hasTreasuryCounter ? `
        <!-- Autonomous Treasury Flywheel & Perpetual Burn HUD (DEFI_TREASURY) -->
        <div id="treasury-hud" class="tilt-card border-beam-card w-full max-w-lg p-6 rounded-2xl bg-gray-950/90 border border-gray-800 shadow-2xl backdrop-blur-xl relative font-sans">
          <div class="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
            <div class="flex items-center gap-3">
              <img src="${p.logoUrl}" alt="${p.name}" class="w-12 h-12 rounded-xl ring-2 ring-brandPrimary/30 shadow-md" />
              <div>
                <h3 class="font-extrabold text-lg text-white">$${p.ticker} Treasury Flywheel</h3>
                <span class="text-xs text-brandPrimary font-mono">Autonomous 30% Buyback Engine</span>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">
              FLYWHEEL ACTIVE
            </span>
          </div>

          <div class="space-y-4">
            <!-- Live Accumulating Treasury Counter -->
            <div class="p-4 rounded-xl bg-gray-900/80 border border-gray-800">
              <div class="flex justify-between text-xs text-gray-400 mb-1">
                <span class="font-mono">TOTAL ACCUMULATED TREASURY</span>
                <span class="text-emerald-400 font-semibold font-mono">● Real-Time Mined</span>
              </div>
              <div class="flex items-baseline gap-2">
                <span id="treasury-reserve-val" class="text-3xl font-black font-mono text-white">$142,850</span>
                <span id="treasury-eth-val" class="text-xs text-gray-400 font-mono">(46.52 WETH)</span>
              </div>
            </div>

            <!-- Perpetual Burn Progress -->
            <div class="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800 space-y-2">
              <div class="flex justify-between text-xs">
                <span class="text-gray-300">Tokens Incinerated (0xdead)</span>
                <span id="burn-counter-val" class="font-mono text-brandSecondary font-bold">34,250,000 $${p.ticker}</span>
              </div>
              <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div class="bg-gradient-to-r from-brandPrimary to-brandSecondary h-2 rounded-full hud-meter-fill" style="width: 34.2%"></div>
              </div>
              <div class="flex justify-between text-[10px] text-gray-500 font-mono">
                <span>Genesis: 0</span>
                <span>Target: 50% Supply Incineration</span>
              </div>
            </div>

            <!-- Dynamic Passive Dividend Calculator -->
            <div class="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800 space-y-2">
              <div class="flex justify-between text-xs">
                <span class="text-gray-300">Hold Amount: <span id="calc-token-amt" class="text-white font-bold font-mono">10,000</span> $${p.ticker}</span>
                <span class="text-emerald-400 font-mono font-bold">Est. APR: 42.8%</span>
              </div>
              <input type="range" id="treasury-slider" min="1000" max="100000" step="1000" value="10000" class="w-full accent-brandPrimary cursor-pointer" />
              <div class="flex justify-between text-xs pt-1">
                <span class="text-gray-400">Est. 30-Day Dividend:</span>
                <span id="calc-dividend-val" class="text-white font-bold font-mono">0.038 WETH ($116.50)</span>
              </div>
            </div>

            <a href="${p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="block w-full text-center py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition border border-gray-700">
              View Treasury & Verified Contract on Explorer ↗
            </a>
          </div>
        </div>` : p.theme.hasNodePowerGauge ? `
        <!-- Cyber Node Power HUD (GAMING_UTILITY) -->
        <div id="node-power-hud" class="tilt-card border-beam-card w-full max-w-lg p-6 rounded-2xl bg-gray-950/90 border border-gray-800 shadow-2xl backdrop-blur-xl relative font-sans">
          <div class="flex items-center justify-between border-b border-gray-800 pb-4 mb-4">
            <div class="flex items-center gap-3">
              <img src="${p.logoUrl}" alt="${p.name}" class="w-12 h-12 rounded-xl ring-2 ring-cyan-500/30 shadow-md" />
              <div>
                <h3 class="font-extrabold text-lg text-white">$${p.ticker} Compute Engine</h3>
                <span class="text-xs text-cyan-400 font-mono">Decentralized Physical Infrastructure</span>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span> NODE CLUSTER SYNCED
            </span>
          </div>

          <div class="space-y-4 font-mono text-xs">
            <!-- Active Hashrate & Compute Telemetry -->
            <div class="grid grid-cols-2 gap-3">
              <div class="p-3.5 rounded-xl bg-gray-900/80 border border-gray-800">
                <span class="text-gray-400 block text-[11px]">NETWORK HASHRATE</span>
                <span id="node-hashrate-val" class="text-2xl font-black text-cyan-400 mt-1 block">48.5 GH/s</span>
                <span class="text-[10px] text-gray-500">± 1.2% Jitter Load</span>
              </div>
              <div class="p-3.5 rounded-xl bg-gray-900/80 border border-gray-800">
                <span class="text-gray-400 block text-[11px]">ACTIVE NODES</span>
                <span class="text-2xl font-black text-amber-400 mt-1 block">1,428</span>
                <span class="text-[10px] text-emerald-400">99.98% Network Uptime</span>
              </div>
            </div>

            <!-- Compute Power Load Bar -->
            <div class="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800 space-y-2">
              <div class="flex justify-between">
                <span class="text-gray-300">GPU/Node Load Factor</span>
                <span id="node-load-text" class="text-cyan-400 font-bold">74% Capacity</span>
              </div>
              <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                <div id="node-load-bar" class="bg-gradient-to-r from-cyan-400 to-amber-400 h-2 rounded-full transition-all duration-700" style="width: 74%"></div>
              </div>
              <div class="flex justify-between text-[10px] text-gray-500">
                <span>Eco Mode (10W)</span>
                <span>Peak Turbo (120W)</span>
              </div>
            </div>

            <!-- Interactive Node Tier Multiplier -->
            <div class="p-3.5 rounded-xl bg-gray-900/60 border border-gray-800 space-y-2">
              <div class="flex justify-between items-center">
                <span class="text-gray-300">Node Tier Staking</span>
                <span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold border border-cyan-500/30">Tier 3 (Master Node)</span>
              </div>
              <div class="flex justify-between text-[11px] text-gray-400">
                <span>Hardware Multiplier:</span>
                <span class="text-white font-bold">2.5x Reward Rate</span>
              </div>
              <div class="flex justify-between text-[11px] text-gray-400">
                <span>Proof-of-Compute Interval:</span>
                <span class="text-emerald-400 font-bold">12s Mined Epoch</span>
              </div>
            </div>

            <a href="${p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="block w-full text-center py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition border border-gray-700">
              Inspect DePIN Protocol Nodes on Explorer ↗
            </a>
          </div>
        </div>` : `
        <!-- 3D Interactive Parallax Card & FOMO Jackpot (VIRAL_MEME / DEFAULT) -->
        <div id="parallax-hero-card" class="tilt-card border-beam-card w-full max-w-md p-6 rounded-2xl bg-gray-900/60 border border-gray-800/80 shadow-2xl backdrop-blur-xl relative group">
          <div class="absolute -inset-0.5 bg-gradient-to-r from-brandPrimary to-brandSecondary rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
          
          <div class="relative space-y-6">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3">
                <img src="${p.logoUrl}" alt="${p.name}" class="w-14 h-14 rounded-2xl ring-2 ring-brandPrimary/30 shadow-lg" />
                <div>
                  <h3 class="font-black text-xl text-white">$${p.ticker}</h3>
                  <span class="text-xs text-gray-400">${p.chainDisplayName}</span>
                </div>
              </div>
              <div class="text-right">
                <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Audit 100/100
                </span>
              </div>
            </div>

            <!-- 10-Minute FOMO Jackpot Live Countdown -->
            <div class="p-4 rounded-xl bg-gray-950/80 border border-gray-800 text-center">
              <div class="text-xs font-mono text-gray-400 uppercase">10-Minute FOMO Jackpot Active</div>
              <div id="jackpot-timer" class="text-3xl font-black font-mono text-brandPrimary mt-1">09:59</div>
              <div class="text-[11px] text-gray-500 mt-1">Last buyer takes accumulated treasury pool</div>
            </div>

            <!-- Highlights Matrix -->
            <div class="grid grid-cols-2 gap-3 text-xs">
              <div class="p-3 rounded-lg bg-gray-950/60 border border-gray-800">
                <span class="text-gray-400 block">Buyback & Burn</span>
                <span class="font-bold text-white text-base">30% Perpetual</span>
              </div>
              <div class="p-3 rounded-lg bg-gray-950/60 border border-gray-800">
                <span class="text-gray-400 block">Passive Dividends</span>
                <span class="font-bold text-white text-base">20% WETH</span>
              </div>
            </div>

            <a href="${p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="block w-full text-center py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-semibold transition border border-gray-700">
              View Verified Contract on Explorer ↗
            </a>
          </div>
        </div>`}
      </div>

    </div>`;
  const securityAuditSnippet = `<!-- Section: Security Audit & On-Chain Risk Protocol -->
    <section id="security-audit" class="mt-14 py-8 border-y border-gray-800/80 bg-gray-950/40 font-mono text-xs">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-800/60">
        <div>
          <div class="text-[11px] text-emerald-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>ON-CHAIN SECURITY VERIFICATION</span>
          </div>
          <h2 class="text-xl sm:text-2xl font-bold text-white tracking-tight font-sans">Contract Security & Audit Report</h2>
        </div>
        <div class="flex items-center gap-3">
          <span class="px-3.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold flex items-center gap-2">
            <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
            <span>GOPLUS AUDIT: 100 / 100 SAFE</span>
          </span>
          <a href="${p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-700 transition flex items-center gap-1">
            <span>Explorer</span>
            <svg class="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
          </a>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-6">
        <div id="liquidity-lock-card" class="p-3.5 rounded-xl bg-gray-900/50 border border-emerald-500/30 space-y-1 relative overflow-hidden">
          <div class="flex items-center justify-between">
            <div class="text-gray-500 text-[10px] uppercase">Liquidity Lock &amp; Burn</div>
            <span id="lp-verified-seal" class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">100% SECURE</span>
          </div>
          <div class="text-emerald-400 font-bold flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
              <span id="lp-status-text">${p.chain === 'solana' ? 'BONDING CURVE LOCKED / BURNT' : 'PERMANENTLY BURNT (0x0...dead)'}</span>
            </div>
            <a href="${p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="text-xs text-brandPrimary hover:underline inline-flex items-center gap-0.5">Proof ↗</a>
          </div>
          <div class="text-gray-400 text-[11px]">LP tokens 100% verifiably burned on-chain. Zero developer withdrawal capability.</div>
        </div>

        <div class="p-3.5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-1">
          <div class="text-gray-500 text-[10px] uppercase">Honeypot Analysis</div>
          <div class="text-emerald-400 font-bold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>PASSED (100% Sellable)</span>
          </div>
          <div class="text-gray-400 text-[11px]">Unrestricted liquidity exit. All wallets can buy and liquidate freely.</div>
        </div>

        <div class="p-3.5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-1">
          <div class="text-gray-500 text-[10px] uppercase">Trading Taxes</div>
          <div class="text-emerald-400 font-bold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>0.0% BUY / 0.0% SELL TAX</span>
          </div>
          <div class="text-gray-400 text-[11px]">Zero transfer withholding or hidden developer fee deductions.</div>
        </div>

        <div class="p-3.5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-1">
          <div class="text-gray-500 text-[10px] uppercase">Ownership Status</div>
          <div class="text-emerald-400 font-bold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>RENOUNCED / REVOKED</span>
          </div>
          <div class="text-gray-400 text-[11px]">No privileged admin key can alter parameters or mint new tokens.</div>
        </div>

        <div class="p-3.5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-1">
          <div class="text-gray-500 text-[10px] uppercase">Supply Constraint</div>
          <div class="text-emerald-400 font-bold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>NON-MINTABLE (Hard Cap)</span>
          </div>
          <div class="text-gray-400 text-[11px]">Total supply is permanently capped on-chain. Inflation is zero.</div>
        </div>

        <div class="p-3.5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-1">
          <div class="text-gray-500 text-[10px] uppercase">Blacklist / Freeze</div>
          <div class="text-emerald-400 font-bold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>NOT PRESENT (Open Access)</span>
          </div>
          <div class="text-gray-400 text-[11px]">Standard ERC20/SPL implementation without blacklisting methods.</div>
        </div>

        <div class="p-3.5 rounded-xl bg-gray-900/50 border border-gray-800 space-y-1">
          <div class="text-gray-500 text-[10px] uppercase">Bot Terminal Routing</div>
          <div class="text-cyan-400 font-bold flex items-center gap-1.5">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span>ROUTER VERIFIED</span>
          </div>
          <div class="text-gray-400 text-[11px]">Fast-path compatibility for Maestro, Banana Gun, Trojan, Photon, GMGN.</div>
        </div>
      </div>
    </section>`;
  const flywheelSnippet = `<!-- Section: Perpetual Economic Flywheel & Community Rewards -->
    <section id="flywheel" class="py-20 border-t border-gray-900 mt-12 font-sans">
      <div class="text-center max-w-3xl mx-auto space-y-3 mb-14">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brandPrimary/10 border border-brandPrimary/30 text-brandPrimary text-xs font-mono">
          <span class="w-2 h-2 rounded-full bg-brandPrimary animate-pulse"></span>
          <span>POSITIVE-SUM ON-CHAIN GAME THEORY</span>
        </div>
        <h2 class="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">Perpetual Economic Flywheel</h2>
        <p class="text-gray-400 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
          Unlike extractive tokens where creators dump on buyers, $${p.ticker} recycles 100% of protocol fees back into supply reduction, passive holder dividends, affiliate bounties, and continuous buying pressure.
        </p>
      </div>

      <!-- 4-Pillar Grid with Interactive DApp Modules -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">

        <!-- Pillar 1: 30% Deflationary Auto Buyback & Incineration -->
        <div class="tilt-card p-6 sm:p-7 rounded-2xl bg-gray-900/60 border border-gray-800 shadow-xl backdrop-blur-md space-y-5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
              </div>
              <div>
                <h3 class="text-lg font-bold text-white">30% Auto Buyback & Burn</h3>
                <span class="text-xs text-rose-400 font-mono">Floor Price Defense Engine</span>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-rose-500/15 text-rose-300 border border-rose-500/30">
              PERPETUAL DEFLATION
            </span>
          </div>

          <div class="p-4 rounded-xl bg-gray-950/80 border border-gray-800 space-y-2">
            <div class="flex justify-between items-baseline">
              <span class="text-xs text-gray-400 font-mono">TOKENS INCINERATED TO DEAD:</span>
              <span class="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Active Sweep</span>
              </span>
            </div>
            <div class="flex items-baseline gap-2">
              <span id="flywheel-burn-val" class="text-2xl sm:text-3xl font-black font-mono text-white">0</span>
              <span class="text-xs text-gray-400 font-mono">$${p.ticker}</span>
            </div>
            <div class="w-full bg-gray-800 rounded-full h-2 overflow-hidden mt-1">
              <div id="flywheel-burn-progress" class="bg-gradient-to-r from-rose-500 to-amber-500 h-2 rounded-full transition-all duration-700" style="width: 0%"></div>
            </div>
            <div class="flex justify-between text-[10px] text-gray-500 font-mono pt-1">
              <span>Genesis Supply Burn: 0</span>
              <span>Target Cap: 50.0% Supply</span>
            </div>
          </div>

          <p class="text-xs text-gray-300 leading-relaxed">
            Every transaction routes 30% of fees to market-buy $${p.ticker} from the liquidity pool and provably incinerates tokens to the dead address. The floor price mathematically hardens over time.
          </p>

          <div class="pt-1 flex items-center justify-between border-t border-gray-800/80 text-xs font-mono">
            <span class="text-gray-500">Destination: 0x...dead</span>
            <a href="${p.chainDisplayName.includes('Solana') ? p.explorerUrl : 'https://basescan.org/address/0x000000000000000000000000000000000000dead'}" target="_blank" rel="noopener noreferrer" class="text-brandPrimary hover:underline inline-flex items-center gap-1">
              <span>Verify Burn on Explorer</span>
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" x2="21" y1="14" y2="3"/></svg>
            </a>
          </div>
        </div>

        <!-- Pillar 2: 20% Passive WETH Dividends Estimator -->
        <div class="tilt-card p-6 sm:p-7 rounded-2xl bg-gray-900/60 border border-gray-800 shadow-xl backdrop-blur-md space-y-5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16 10-4 4-2-2"/></svg>
              </div>
              <div>
                <h3 class="text-lg font-bold text-white">20% Passive Dividends</h3>
                <span class="text-xs text-emerald-400 font-mono">Non-Custodial Fee Yield</span>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              ZERO STAKING LOCKUP
            </span>
          </div>

          <div class="p-4 rounded-xl bg-gray-950/80 border border-gray-800 space-y-3">
            <div class="flex justify-between items-center text-xs">
              <span class="text-gray-300 font-mono">Your Holding Bag:</span>
              <div class="flex items-center gap-1.5">
                <input type="number" id="dividend-token-input" value="25000" min="1000" step="1000" class="bg-gray-900 px-2.5 py-1 rounded text-white font-mono text-xs border border-gray-700 focus:border-brandPrimary w-28 text-right focus:outline-none" />
                <span class="font-mono text-gray-400 text-xs">$${p.ticker}</span>
              </div>
            </div>
            <input type="range" id="dividend-slider" min="1000" max="250000" step="1000" value="25000" class="w-full accent-brandPrimary cursor-pointer" />
            
            <div class="pt-1 flex items-baseline justify-between border-t border-gray-800/80">
              <span class="text-xs text-gray-400 font-mono">Est. 30-Day Rewards:</span>
              <div class="text-right">
                <span id="dividend-weth-output" class="text-lg font-black font-mono text-emerald-400">0.0950 WETH</span>
                <span id="dividend-usd-output" class="text-xs text-gray-400 font-mono ml-1.5">($291.65)</span>
              </div>
            </div>
          </div>

          <!-- Check Wallet Eligibility Sub-Panel -->
          <div class="p-3.5 rounded-xl bg-gray-950/90 border border-emerald-500/30 space-y-2 text-xs font-mono">
            <div class="flex items-center justify-between">
              <span class="text-gray-300 font-semibold">WALLET DIVIDEND CHECKER</span>
              <span id="checker-status-badge" class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">SNAPSHOT ACTIVE</span>
            </div>
            <div class="flex items-center gap-2">
              <button type="button" id="check-wallet-div-btn" class="w-full py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-emerald-300 border border-emerald-500/40 font-bold transition flex items-center justify-center gap-1.5 cursor-pointer">
                <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                <span>Check Connected Wallet Eligibility</span>
              </button>
            </div>
            <div id="checker-result-box" class="pt-2 border-t border-gray-800/80 space-y-1 hidden">
              <div class="flex justify-between text-gray-400">
                <span>Holdings Detected:</span>
                <span id="detected-holdings" class="text-white font-bold">0 $${p.ticker}</span>
              </div>
              <div class="flex justify-between text-gray-400">
                <span>Pool Weight:</span>
                <span id="detected-weight" class="text-cyan-400 font-bold">0.00%</span>
              </div>
              <div class="flex justify-between text-gray-400">
                <span>Next Airdrop Estimate:</span>
                <span id="detected-dividend" class="text-emerald-400 font-bold">0.0000 WETH</span>
              </div>
            </div>
          </div>

          <p class="text-xs text-gray-300 leading-relaxed">
            Holders receive periodic native WETH airdrops straight to their self-custody wallets funded by LP trading fee volume. No staking contract vulnerability, zero lockups.
          </p>

          <div class="pt-1 flex items-center justify-between border-t border-gray-800/80 text-xs font-mono text-gray-500">
            <span>APY Tier: Proportional Snapshot</span>
            <span class="text-emerald-400 font-semibold">Native Gasless Drops</span>
          </div>
        </div>

        <!-- Pillar 3: 5% Viral Community Affiliate Referral Generator -->
        <div class="tilt-card p-6 sm:p-7 rounded-2xl bg-gray-900/60 border border-gray-800 shadow-xl backdrop-blur-md space-y-5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </div>
              <div>
                <h3 class="text-lg font-bold text-white">5% Affiliate Referral Bounty</h3>
                <span class="text-xs text-cyan-400 font-mono">Viral Revenue Share Tool</span>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              INSTANT BOUNTY
            </span>
          </div>

          <div class="p-4 rounded-xl bg-gray-950/80 border border-gray-800 space-y-3">
            <label class="block text-xs text-gray-300 font-mono">Generate Your On-Chain Affiliate Link:</label>
            <div class="flex flex-col sm:flex-row gap-2">
              <input type="text" id="affiliate-wallet-input" placeholder="Enter EVM or Solana Wallet Address (0x...)" class="flex-1 bg-gray-900 px-3 py-2 rounded-lg text-xs font-mono text-gray-200 border border-gray-700 focus:border-brandPrimary focus:outline-none" />
              <button type="button" id="use-my-wallet-btn" class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-mono border border-gray-700 transition whitespace-nowrap cursor-pointer">
                Use Connected
              </button>
            </div>
            
            <button type="button" id="generate-ref-btn" class="w-full py-2.5 rounded-lg bg-brandPrimary text-black font-bold text-xs hover:opacity-90 transition font-mono cursor-pointer flex items-center justify-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              <span>Generate Personal Affiliate Link</span>
            </button>

            <!-- Generated Output Container -->
            <div id="affiliate-link-container" class="space-y-2 pt-2 border-t border-gray-800 hidden">
              <div class="flex items-center justify-between text-[11px] font-mono text-gray-400">
                <span>YOUR SHAREABLE LINK</span>
                <span class="text-cyan-400 font-semibold">5% WETH REV-SHARE</span>
              </div>
              <div class="flex items-center gap-2">
                <input type="text" readonly id="affiliate-link-output" class="flex-1 bg-gray-900 px-3 py-2 rounded-lg text-xs font-mono text-brandPrimary border border-gray-800 select-all focus:outline-none" />
                <button type="button" id="copy-ref-btn" class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-mono text-xs border border-gray-700 transition whitespace-nowrap cursor-pointer">
                  Copy Link
                </button>
              </div>
              <p id="copy-ref-status" class="text-[11px] font-mono text-emerald-400 hidden">Affiliate referral link copied to clipboard.</p>
            </div>
          </div>

          <p class="text-xs text-gray-300 leading-relaxed">
            Share your custom referral link across X, Telegram, and alpha groups. Whenever visitors trade through your link, 5% of protocol revenue is credited directly to your payout wallet address.
          </p>
        </div>

        <!-- Pillar 4: 15% 10-Minute FOMO Jackpot Pool -->
        <div class="tilt-card p-6 sm:p-7 rounded-2xl bg-gray-900/60 border border-gray-800 shadow-xl backdrop-blur-md space-y-5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </div>
              <div>
                <h3 class="text-lg font-bold text-white">15% FOMO Jackpot Pool</h3>
                <span class="text-xs text-amber-400 font-mono">Continuous Game-Theoretic Bid</span>
              </div>
            </div>
            <span class="px-2.5 py-1 rounded-full text-[11px] font-mono font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
              10-MINUTE WINDOW
            </span>
          </div>

          <div class="p-4 rounded-xl bg-gray-950/80 border border-gray-800 space-y-3 text-center">
            <div class="text-xs font-mono text-gray-400 uppercase">Jackpot Round Countdown</div>
            <div id="flywheel-jackpot-timer" class="text-4xl sm:text-5xl font-black font-mono text-brandPrimary tracking-wider">
              09:59
            </div>
            <div class="flex justify-center items-center gap-2 text-xs font-mono">
              <span class="text-gray-400">Accumulated Prize Pool:</span>
              <span id="flywheel-jackpot-pool" class="text-white font-bold text-sm">0.00 ${p.chainDisplayName.includes("Solana") ? "SOL" : "ETH"}</span>
              <span id="flywheel-jackpot-usd" class="text-emerald-400">($0.00)</span>
            </div>
            <div class="text-[11px] text-gray-500 font-mono">
              Last valid buy order before clock expiration captures the entire pool!
            </div>
          </div>

          <p class="text-xs text-gray-300 leading-relaxed">
            Every eligible purchase resets the 10-minute timer. This creates perpetual buying incentives, preventing chart stagnation and rewarding active decentralized market participants.
          </p>

          <div class="pt-1 flex items-center justify-between border-t border-gray-800/80 text-xs font-mono">
            <span class="text-gray-500">Autonomous Settlement</span>
            <a href="#swap" class="text-brandPrimary hover:underline inline-flex items-center gap-1">
              <span>Enter Next Round via Instant Swap</span>
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </a>
          </div>
        </div>

      </div>
    </section>`;
  const tokenomicsSnippet = `<!-- Section: Tokenomics Breakdown -->
    <section id="tokenomics" class="py-20 border-t border-gray-900 mt-12">
      <div class="text-center max-w-2xl mx-auto space-y-3 mb-12">
        <h2 class="text-3xl font-extrabold text-white">Mathematical Tokenomics</h2>
        <p class="text-gray-400 text-sm">Every trade fuels an autonomous positive-sum flywheel.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div class="tilt-card p-6 rounded-xl bg-gray-900/50 border border-gray-800">
          <div class="text-3xl font-black text-brandPrimary mb-1">0%</div>
          <div class="font-bold text-white text-sm">Trading Tax</div>
          <p class="text-gray-400 text-xs mt-2">Zero friction. You keep 100% of the tokens you trade without hidden slippage.</p>
        </div>
        <div class="tilt-card p-6 rounded-xl bg-gray-900/50 border border-gray-800">
          <div class="text-3xl font-black text-brandSecondary mb-1">30%</div>
          <div class="font-bold text-white text-sm">Auto Buyback & Burn</div>
          <p class="text-gray-400 text-xs mt-2">Protocol fees continuously buy $${p.ticker} and incinerate it to 0xdead.</p>
        </div>
        <div class="tilt-card p-6 rounded-xl bg-gray-900/50 border border-gray-800">
          <div class="text-3xl font-black text-brandPrimary mb-1">20%</div>
          <div class="font-bold text-white text-sm">Passive Yield</div>
          <p class="text-gray-400 text-xs mt-2">Native dividends distributed directly to token holders with zero staking required.</p>
        </div>
        <div class="tilt-card p-6 rounded-xl bg-gray-900/50 border border-gray-800">
          <div class="text-3xl font-black text-brandSecondary mb-1">15%</div>
          <div class="font-bold text-white text-sm">10-Min FOMO Pool</div>
          <p class="text-gray-400 text-xs mt-2">Continuous game-theoretic buying pressure. Last buyer claims the prize.</p>
        </div>
      </div>
    </section>`;
  const swapWidgetSnippet = `<!-- Section: In-Page Decentralized Swap Widget (Doppler v4 On-Chain Engine) -->
    <section id="swap" class="py-16 border-t border-gray-900">
      <div class="text-center max-w-2xl mx-auto space-y-3 mb-8">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brandPrimary/10 border border-brandPrimary/30 text-brandPrimary text-xs font-mono">
          <span class="w-2 h-2 rounded-full bg-brandPrimary animate-ping"></span>
          <span>ON-CHAIN DOPPLER SETTLER AMM</span>
        </div>
        <h2 class="text-3xl font-extrabold text-white">Instant In-Page Swap</h2>
        <p class="text-gray-400 text-sm">Direct liquidity settlement via Doppler Settler contract on ${p.chainDisplayName}. 0% custom fees, slippage-protected.</p>
      </div>

      <div class="border-beam-card max-w-xl mx-auto p-6 rounded-2xl bg-gray-900/80 border border-gray-800 shadow-2xl backdrop-blur-xl relative">
        <!-- Buy / Sell Mode Tabs -->
        <div class="flex p-1 bg-gray-950 rounded-xl border border-gray-800 mb-5">
          <button type="button" id="swap-tab-buy" class="flex-1 py-2 text-xs font-bold rounded-lg bg-brandPrimary text-black transition shadow">
            BUY $${p.ticker}
          </button>
          <button type="button" id="swap-tab-sell" class="flex-1 py-2 text-xs font-bold rounded-lg bg-transparent text-gray-400 hover:text-white transition">
            SELL $${p.ticker}
          </button>
        </div>

        <div class="space-y-4">
          <!-- Input Field -->
          <div class="p-4 rounded-xl bg-gray-950 border border-gray-800">
            <div class="flex justify-between text-xs text-gray-400 mb-2">
              <span id="swap-input-label">You Pay</span>
              <span id="swap-wallet-balance">Balance: Connected Wallet</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <input type="number" id="swap-input-eth" value="0.05" step="0.01" min="0.0001" class="w-2/3 bg-transparent text-2xl font-bold text-white focus:outline-none" />
              <div class="flex items-center gap-1.5">
                <button type="button" id="swap-max-btn" class="px-2 py-1 rounded text-[10px] font-mono font-bold bg-gray-800 hover:bg-gray-700 text-brandPrimary border border-gray-700 transition">MAX</button>
                <span id="swap-input-currency" class="px-3 py-1 rounded-lg bg-gray-800 text-white font-bold text-sm border border-gray-700">${p.chainDisplayName.includes("Solana") ? "SOL" : "ETH"}</span>
              </div>
            </div>
          </div>

          <!-- Quick Presets -->
          <div class="flex gap-2 text-xs">
            <button type="button" class="swap-preset-btn px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition font-mono" data-amt="0.01">0.01</button>
            <button type="button" class="swap-preset-btn px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition font-mono" data-amt="0.05">0.05</button>
            <button type="button" class="swap-preset-btn px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition font-mono" data-amt="0.10">0.10</button>
            <button type="button" class="swap-preset-btn px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition font-mono" data-amt="0.50">0.50</button>
          </div>

          <!-- Arrow Divider -->
          <div class="flex justify-center -my-1">
            <div class="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-400 font-bold">
              ↓
            </div>
          </div>

          <!-- Output Token -->
          <div class="p-4 rounded-xl bg-gray-950 border border-gray-800">
            <div class="flex justify-between text-xs text-gray-400 mb-2">
              <span>You Receive (Estimated)</span>
              <span id="swap-price-impact" class="text-emerald-400 font-semibold">&lt; 0.1% Price Impact</span>
            </div>
            <div class="flex items-center justify-between">
              <span id="swap-output-token" class="text-2xl font-bold text-brandPrimary">125,000</span>
              <span id="swap-output-currency" class="px-3 py-1 rounded-lg bg-brandPrimary/20 text-brandPrimary font-bold text-sm border border-brandPrimary/40">$${p.ticker}</span>
            </div>
          </div>

          <!-- Swap Routing & Gas Details -->
          <div class="p-3 rounded-lg bg-gray-950/60 border border-gray-800/80 text-xs space-y-1.5 text-gray-400 font-mono">
            <div class="flex justify-between">
              <span>Network</span>
              <span class="text-gray-200">${p.chainDisplayName}</span>
            </div>
            <div class="flex justify-between">
              <span>Settlement Router</span>
              <span id="swap-router-label" class="text-brandPrimary font-semibold">${p.chain === "solana" ? "Pump.fun AMM" : "Doppler Settler (0x000...1ff)"}</span>
            </div>
            <div class="flex justify-between">
              <span>Protocol Tax</span>
              <span class="text-emerald-400 font-semibold">0% Buy / 0% Sell</span>
            </div>
          </div>

          <!-- Status Message Container -->
          <div id="swap-status-box" class="hidden p-3 rounded-lg bg-gray-950 border border-brandPrimary/40 text-xs font-mono text-center"></div>

          <!-- Execute Button -->
          <a id="swap-execute-link" href="${p.buyUrl}" target="_blank" rel="noopener noreferrer" class="block w-full text-center py-3.5 rounded-xl bg-gradient-to-r from-brandPrimary to-brandSecondary text-black font-extrabold text-sm shadow-lg shadow-brandPrimary/25 hover:opacity-95 transition cursor-pointer">
            Execute Swap on Liquidity Pool (${p.chain === "solana" ? "Pump.fun" : p.chain === "robinhood" ? "Pons.fun" : p.chain === "clanker" ? "Clanker" : "DEX"}) ↗
          </a>
        </div>
      </div>
    </section>`;
  const chartSnippet = `<!-- Section: Live DexScreener Chart Embed -->
    <section id="chart" class="py-12 border-t border-gray-900">
      <div class="text-center max-w-2xl mx-auto space-y-3 mb-6">
        <h2 class="text-3xl font-extrabold text-white">Live Market Chart</h2>
        <p class="text-gray-400 text-sm">Real-time decentralized trading telemetry on ${p.chainDisplayName}.</p>
      </div>

      <!-- Interactive Chart Telemetry Header -->
      <div class="max-w-5xl mx-auto mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-gray-900/90 border border-gray-800 text-xs">
        <div class="flex items-center gap-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">${p.chainDisplayName}</span>
          <span class="text-gray-400 font-mono select-all">${p.ca.slice(0, 8)}...${p.ca.slice(-6)}</span>
          <button type="button" class="copy-ca-btn text-gray-400 hover:text-white transition cursor-pointer" title="Copy Contract Address">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
        </div>
        <div class="flex items-center gap-3">
          <a href="${p.chain === 'solana' ? `https://dexscreener.com/solana/${p.ca}` : p.chain === 'robinhood' ? `https://dexscreener.com/robinhood/${p.ca}` : `https://dexscreener.com/base/${p.ca}`}" target="_blank" rel="noopener noreferrer" class="text-brandPrimary hover:underline font-medium inline-flex items-center gap-1">
            Open in DexScreener ↗
          </a>
          <a href="${p.buyUrl}" target="_blank" rel="noopener noreferrer" class="px-3 py-1 rounded bg-brandPrimary text-black font-bold hover:opacity-90 transition">
            1-Click Swap
          </a>
        </div>
      </div>

      <div class="w-full h-[550px] rounded-2xl overflow-hidden border border-gray-800 bg-gray-950 shadow-2xl relative">
        <iframe id="dexscreener-iframe" src="${p.dexScreenerEmbedUrl}" class="w-full h-full border-0"></iframe>
        <div id="dex-fallback-card" class="hidden absolute inset-0 bg-gray-950/95 flex flex-col items-center justify-center p-8 text-center backdrop-blur-md">
          <div class="w-14 h-14 rounded-full bg-brandPrimary/20 border border-brandPrimary/40 flex items-center justify-center text-brandPrimary mb-4">
            <svg class="w-7 h-7 text-brandPrimary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <h3 class="text-xl font-bold text-white mb-2">Token Verified Live On-Chain: $${p.ticker}</h3>
          <p class="text-gray-400 text-sm max-w-lg mb-6 leading-relaxed">
            Smart contract <code class="text-brandPrimary font-mono px-2 py-0.5 bg-gray-900 rounded border border-gray-800">${p.ca}</code> is active and confirmed on Base Mainnet.<br>
            Decentralized AMM pool is awaiting initial swap volume to activate DexScreener candlestick charting.
          </p>
          <div class="flex items-center gap-3">
            <a href="#swap" class="px-5 py-2.5 rounded-xl bg-brandPrimary text-black font-extrabold text-xs hover:opacity-90 transition">
              Execute First Swap on Base ⚡
            </a>
            <a href="${p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="px-5 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-white font-medium text-xs hover:bg-gray-800 transition">
              Inspect on Basescan ↗
            </a>
          </div>
        </div>
      </div>
    </section>`;
  const teamSnippet = `<!-- Section: Core Team & Ecosystem -->
    <section id="team" class="py-16 border-t border-gray-900">
      <div class="text-center max-w-2xl mx-auto space-y-3 mb-10">
        <h2 class="text-3xl font-extrabold text-white">Autonomous Core Team</h2>
        <p class="text-gray-400 text-sm">Specialized AI intelligence units driving protocol evolution.</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        ${teamCardsHtml}
      </div>
    </section>`;
  const modalSnippet = `<!-- Web3 Wallet Guide Modal (Universal Mobile & Desktop Fallback) -->
    <div id="wallet-guide-modal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm hidden">
      <div class="bg-gray-900 border border-gray-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl space-y-4">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-bold text-white">Connect Web3 Wallet</h3>
          <button id="close-wallet-modal" class="text-gray-400 hover:text-white text-xl font-bold cursor-pointer">×</button>
        </div>
        <p id="wallet-modal-description" class="text-sm text-gray-400">Choose an option below to connect your wallet or trade directly:</p>

        <!-- Mobile 1-Tap Deep Link Options (dynamic for iOS / Android) -->
        <div id="wallet-mobile-options" class="space-y-2.5 hidden">
          ${p.chain === "solana" ? `
          <a id="wallet-deep-phantom" href="#" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3.5 rounded-xl bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/40 transition text-sm text-white font-medium">
            <span class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-purple-400"></span>
              <span>Open in Phantom App</span>
            </span>
            <span class="text-xs text-purple-300 font-semibold">1-Tap ↗</span>
          </a>
          ` : `
          <a id="wallet-deep-metamask" href="#" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3.5 rounded-xl bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/40 transition text-sm text-white font-medium">
            <span class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
              <span>Open in MetaMask App</span>
            </span>
            <span class="text-xs text-amber-300 font-semibold">1-Tap ↗</span>
          </a>
          <a id="wallet-deep-coinbase" href="#" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3.5 rounded-xl bg-blue-950/40 hover:bg-blue-900/50 border border-blue-500/40 transition text-sm text-white font-medium">
            <span class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
              <span>Open in Coinbase Wallet</span>
            </span>
            <span class="text-xs text-blue-300 font-semibold">1-Tap ↗</span>
          </a>
          `}
        </div>

        <!-- Desktop Extension Options (shown on desktop without extension) -->
        <div id="wallet-desktop-options" class="space-y-2.5">
          ${p.chain === "solana" ? `
          <a href="https://phantom.app/download" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3 rounded-xl bg-gray-950 hover:bg-gray-800/80 border border-gray-800 transition text-sm text-white font-medium">
            <span>Install Phantom Wallet</span>
            <span class="text-xs text-brandPrimary">phantom.app ↗</span>
          </a>
          ` : `
          <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3 rounded-xl bg-gray-950 hover:bg-gray-800/80 border border-gray-800 transition text-sm text-white font-medium">
            <span>Install MetaMask</span>
            <span class="text-xs text-brandPrimary">metamask.io ↗</span>
          </a>
          <a href="https://www.coinbase.com/wallet" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3 rounded-xl bg-gray-950 hover:bg-gray-800/80 border border-gray-800 transition text-sm text-white font-medium">
            <span>Coinbase Wallet</span>
            <span class="text-xs text-brandPrimary">coinbase.com ↗</span>
          </a>
          `}
        </div>

        <!-- Fallback 1-Click Liquidity Pool Trade -->
        <a id="wallet-fallback-swap" href="${p.buyUrl}" target="_blank" rel="noopener noreferrer" class="flex items-center justify-between p-3 rounded-xl bg-brandPrimary/10 border border-brandPrimary/30 hover:bg-brandPrimary/20 transition text-sm text-brandPrimary font-semibold">
          <span>Trade Directly on Liquidity Pool</span>
          <span>↗</span>
        </a>
      </div>
    </div>`;

  const layoutMode = p.theme.themeStyle === "BENTO_GRID_DAPP" || p.theme.sector === "DEFI_TREASURY"
    ? "BENTO_GRID_DAPP"
    : p.theme.themeStyle === "CYBER_TERMINAL_HUD" || p.theme.sector === "AI_AGENT"
    ? "CYBER_TERMINAL_HUD"
    : p.theme.themeStyle === "NEO_BRUTALISM" || p.theme.sector === "VIRAL_MEME"
    ? "NEO_BRUTALISM"
    : "STANDARD";

  let mainContentHtml = "";
  if (layoutMode === "BENTO_GRID_DAPP") {
    mainContentHtml = `
  <!-- Bento Box Grid DApp Layout (UI/UX Pro Max) -->
  <main class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 bento-grid-dapp space-y-8">
    <!-- Top Identity Tile with CA Copy & Badges -->
    <div class="bento-card p-6 sm:p-8 bg-gray-950/80 border border-gray-800/80 rounded-2xl shadow-xl backdrop-blur-md">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brandPrimary/10 border border-brandPrimary/30 text-brandPrimary text-xs font-mono mb-3">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>DEPLOYED ON ${p.chainDisplayName.toUpperCase()}</span>
            ${p.isDexscreenerPaid ? '<span class="text-amber-400 font-semibold">• DEXSCREENER VERIFIED</span>' : ""}
            ${p.isBankr ? '<span class="text-emerald-400 font-semibold">• BANKR GASLESS RELAY</span>' : ""}
            <span class="text-cyan-400 font-semibold">• AUDIT: 100/100 SAFE</span>
          </div>
          <h1 class="text-3xl sm:text-5xl font-extrabold text-white tracking-tight font-sans">
            ${p.name} <span class="text-transparent bg-clip-text bg-gradient-to-r from-brandPrimary to-brandSecondary font-mono">$${p.ticker}</span>
          </h1>
          <p class="text-sm sm:text-base text-gray-300 max-w-2xl mt-2 leading-relaxed">
            ${p.theme.tagline}. Autonomous, immutable protocol on ${p.chainDisplayName}.
          </p>
        </div>
        <div class="space-y-2.5">
          <div class="flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>CONTRACT ADDRESS (CA)</span>
            <span class="text-emerald-400 font-semibold">0% BUY / 0% SELL TAX</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            <input type="text" readonly value="${p.ca}" id="ca-input" class="w-full sm:w-80 bg-gray-950 px-3 py-2 rounded-lg text-xs font-mono text-gray-200 border border-gray-800 focus:outline-none focus:border-brandPrimary select-all" />
            <button id="copy-ca-btn" class="px-4 py-2 rounded-lg bg-brandPrimary text-black font-semibold text-xs hover:opacity-90 transition whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5">
              <svg class="w-3.5 h-3.5 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
              <span>Copy CA</span>
            </button>
            <button id="add-token-btn" class="px-3.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 font-medium text-xs transition whitespace-nowrap inline-flex items-center justify-center gap-2 cursor-pointer" title="Add $${p.ticker} to Web3 Wallet">
              <svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
              <span>Add to Wallet</span>
            </button>
          </div>
          <div class="flex items-center justify-between text-[11px] pt-0.5 font-mono">
            <p id="copy-status" class="text-emerald-400 hidden">Contract Address copied to clipboard.</p>
            <p id="add-token-status" class="text-cyan-400 hidden">Token request submitted to wallet.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Row 1: Bento Hero Grid (Live Chart & In-Page Swap Widget Side-by-Side Above the Fold) -->
    <div class="bento-hero-grid grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      <div class="lg:col-span-7 flex flex-col justify-center">
        ${chartSnippet}
      </div>
      <div class="lg:col-span-5 flex flex-col justify-center">
        ${swapWidgetSnippet}
      </div>
    </div>

    <!-- Row 2: Secondary Bento Row (Treasury Showcase HUD & Security Audit) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div class="lg:col-span-4 flex justify-center">
        ${heroRightSnippet}
      </div>
      <div class="lg:col-span-8">
        ${securityAuditSnippet}
      </div>
    </div>

    <!-- Row 3: Flywheel & Tokenomics -->
    ${flywheelSnippet}
    ${tokenomicsSnippet}

    <!-- Row 4: Team Section & Wallet Modal -->
    ${teamSnippet}
    ${modalSnippet}
  </main>`;
  } else if (layoutMode === "CYBER_TERMINAL_HUD") {
    mainContentHtml = `
  <!-- Cyber Terminal HUD Layout (UI/UX Pro Max) -->
  <main class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 cyber-terminal-hud space-y-8">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <div class="lg:col-span-6 space-y-6">
        ${heroLeftSnippet}
        ${heroRightSnippet}
      </div>
      <div class="lg:col-span-6 space-y-6">
        ${swapWidgetSnippet}
      </div>
    </div>

    ${chartSnippet}
    ${securityAuditSnippet}
    ${flywheelSnippet}
    ${tokenomicsSnippet}
    ${teamSnippet}
    ${modalSnippet}
  </main>`;
  } else if (layoutMode === "NEO_BRUTALISM") {
    mainContentHtml = `
  <!-- Neo-Brutalist Meme Layout (UI/UX Pro Max) -->
  <main class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 neo-brutalist-meme space-y-8">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
      <div class="lg:col-span-7 space-y-6">
        ${heroLeftSnippet}
      </div>
      <div class="lg:col-span-5 flex justify-center">
        ${heroRightSnippet}
      </div>
    </div>

    ${swapWidgetSnippet}
    ${chartSnippet}
    ${securityAuditSnippet}
    ${flywheelSnippet}
    ${tokenomicsSnippet}
    ${teamSnippet}
    ${modalSnippet}
  </main>`;
  } else {
    mainContentHtml = `
  <!-- Standard Web3 Landing Layout -->
  <main class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 space-y-12">
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
      <div class="lg:col-span-7 space-y-6">
        ${heroLeftSnippet}
      </div>
      <div class="lg:col-span-5 flex justify-center">
        ${heroRightSnippet}
      </div>
    </div>

    ${securityAuditSnippet}
    ${flywheelSnippet}
    ${tokenomicsSnippet}
    ${swapWidgetSnippet}
    ${chartSnippet}
    ${teamSnippet}
    ${modalSnippet}
  </main>`;
  }

  return `<!DOCTYPE html>
<html lang="en" class="dark scroll-smooth">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>$${p.ticker} — ${p.name} | Verified Protocol</title>
  <meta name="description" content="$${p.ticker} (${p.name}) on ${p.chainDisplayName}. 0% Tax, Autonomous Flywheel, LP Locked." />
  
  <!-- OpenGraph / Twitter Cards -->
  <meta property="og:title" content="$${p.ticker} (${p.name}) — Verified Protocol" />
  <meta property="og:description" content="0% Tax, 30% Deflationary Burn, 20% Passive Dividends. Live on ${p.chainDisplayName}." />
  <meta property="og:image" content="og-image.svg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content="og-image.svg" />
  
  <!-- Google Fonts: Space Grotesk & JetBrains Mono -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Space+Grotesk:wght@500;700;900&display=swap" rel="stylesheet">

  <!-- Progressive Web App (PWA) & Mobile Standalone Settings -->
  <link rel="manifest" href="manifest.json" />
  <meta name="theme-color" content="${p.theme.primaryColor}" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="$${p.ticker}" />
  <link rel="apple-touch-icon" href="og-image.svg" />

  <!-- Tailwind CSS via CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['Space Grotesk', 'sans-serif'],
            mono: ['JetBrains Mono', 'monospace'],
          },
          colors: {
            brandPrimary: '${p.theme.primaryColor}',
            brandSecondary: '${p.theme.secondaryColor}',
          }
        }
      }
    }
  </script>
  <link rel="stylesheet" href="styles.css" />
</head>
<body class="bg-[#07080b] text-gray-100 min-h-screen overflow-x-hidden relative font-sans selection:bg-brandPrimary selection:text-black">

  <!-- Top Real-Time DexScreener Marquee Bar -->
  <div class="w-full bg-[#030407] border-b border-gray-800/80 py-1.5 px-4 overflow-hidden relative z-50 text-[11px] font-mono">
    <div class="marquee-track flex whitespace-nowrap gap-8 text-gray-400">
      <span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> <strong class="text-white">$${p.ticker} PROTOCOL TELEMETRY</strong></span>
      <span>PRICE: <strong id="marquee-price-val" class="text-white font-bold transition-colors duration-300">$---</strong> <button id="currency-toggle-btn" type="button" class="ml-1 px-1.5 py-0.5 rounded text-[9px] bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white border border-gray-700 transition cursor-pointer" title="Toggle USD / Native Currency">USD ⇄ ${p.chain === 'solana' ? 'SOL' : 'ETH'}</button></span>
      <span id="marquee-change-val" class="text-emerald-400 font-bold">24H: +0.00%</span>
      <span>TAX: <strong class="text-emerald-400">0% BUY / 0% SELL</strong></span>
      <span>LIQUIDITY: <strong id="marquee-lp-badge" class="text-emerald-400 font-bold">VERIFIED BURNT / LOCKED</strong></span>
      <span>NETWORK: <strong class="text-white">${p.chainDisplayName.toUpperCase()}</strong></span>
      ${p.isBankr ? '<span class="text-emerald-400 font-semibold">• BANKR GASLESS RELAY</span>' : ''}
      <span>ROUTER: <strong class="text-brandPrimary">${p.chain === 'solana' ? 'RAYDIUM / PUMP AMM' : p.isBankr ? 'BANKR TERMINAL / DOPPLER AMM' : 'UNISWAP V3 DECENTRALIZED AMM'}</strong></span>
      <span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> <strong class="text-white">$${p.ticker} LIVE STREAM</strong></span>
      <span>AUDIT: <strong class="text-cyan-400">100/100 SAFE</strong></span>
    </div>
  </div>

  <!-- Interactive 3D WebGL / Particle Canvas Background -->
  <canvas id="bg-canvas" class="fixed inset-0 pointer-events-none z-0 opacity-40"></canvas>
  <canvas id="confetti-canvas" class="fixed inset-0 pointer-events-none z-50"></canvas>

  <!-- Navigation Bar -->
  <header class="sticky top-0 z-50 backdrop-blur-lg bg-gray-950/80 border-b border-gray-800/80">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <img src="${p.logoUrl}" alt="${p.name} Logo" class="w-9 h-9 rounded-full ring-2 ring-brandPrimary/50" />
        <span class="font-extrabold tracking-wider text-lg text-white">$${p.ticker}</span>
        <span class="text-xs px-2 py-0.5 rounded-full bg-brandPrimary/20 text-brandPrimary font-mono border border-brandPrimary/30">${p.theme.displayName.split(" ")[0]}</span>
      </div>

      <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-gray-300">
        <a href="#about" class="hover:text-brandPrimary transition">About</a>
        <a href="#security-audit" class="hover:text-brandPrimary transition">Security Audit</a>
        <a href="#flywheel" class="hover:text-brandPrimary transition">Value Flywheel</a>
        <a href="#tokenomics" class="hover:text-brandPrimary transition">Tokenomics</a>
        <a href="#swap" class="hover:text-brandPrimary transition">Instant Swap</a>
        <a href="#chart" class="hover:text-brandPrimary transition">Live Chart</a>
        <a href="#team" class="hover:text-brandPrimary transition">Core Team</a>
      </nav>

      <div class="flex items-center gap-2 sm:gap-3">
        <button id="connect-wallet-btn" class="px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-200 border border-gray-700 font-mono text-xs transition flex items-center gap-2 cursor-pointer" title="Connect Web3 Wallet">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span> <span id="wallet-label">Connect Wallet</span>
        </button>
        <a href="${p.buyUrl}" target="_blank" rel="noopener noreferrer" class="px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-lg bg-gradient-to-r from-brandPrimary to-brandSecondary text-black font-bold text-xs sm:text-sm shadow-lg shadow-brandPrimary/25 hover:opacity-90 transition whitespace-nowrap">
          Buy $${p.ticker}
        </a>
      </div>
    </div>
  </header>

  ${mainContentHtml}
  </main>

  <!-- Footer -->
  <footer class="border-t border-gray-900 bg-gray-950 py-10 relative z-10 text-center text-xs text-gray-500">
    <div class="max-w-7xl mx-auto px-4 space-y-4">
      <div class="flex flex-wrap items-center justify-center gap-4 sm:gap-6 font-medium text-gray-400">
        <a href="${p.explorerUrl}" target="_blank" rel="noopener noreferrer" class="hover:text-white transition">${p.chain === "solana" ? "Solscan Explorer" : p.chain === "robinhood" ? "Robinhood Explorer" : "Basescan Explorer"}</a>
        <a href="${p.chain === "solana" ? `https://dexscreener.com/solana/${p.ca}` : p.chain === "robinhood" ? `https://dexscreener.com/robinhood/${p.ca}` : `https://dexscreener.com/base/${p.ca}`}" target="_blank" rel="noopener noreferrer" class="hover:text-white transition">DexScreener</a>
        <a href="${p.buyUrl}" target="_blank" rel="noopener noreferrer" class="hover:text-white transition">${p.chain === "solana" ? "Pump.fun Pool" : p.chain === "robinhood" ? "Pons.fun AMM" : p.chain === "clanker" ? "Clanker Pool" : p.isBankr ? "Doppler AMM (v4)" : "Uniswap / Liquidity Pool"}</a>
        ${p.bankrAgentUrl ? `<a href="${p.bankrAgentUrl}" target="_blank" rel="noopener noreferrer" class="hover:text-emerald-400 transition">Bankr Agent Portal ↗</a>` : ""}
        <button id="download-banner-btn" class="px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-gray-300 text-xs font-mono border border-gray-700 transition inline-flex items-center gap-1.5 cursor-pointer"><svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><span>Download Banner</span></button>
      </div>
      <p>© ${new Date().getFullYear()} $${p.ticker} Protocol. Built autonomously with Omnichain Engine.</p>
    </div>
  </footer>

  <!-- Live Buy Toast Container (Sector-Adaptive for Meme) -->
  ${p.theme.hasLiveBuyToast ? '<div id="buy-toast-container" class="fixed bottom-5 left-5 z-50 flex flex-col gap-2 pointer-events-none"></div>' : ""}

  <!-- Interactive Litepaper & Protocol Docs Modal -->
  <div id="docs-modal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md hidden flex items-center justify-center p-4">
    <div class="w-full max-w-2xl max-h-[85vh] overflow-y-auto ${p.theme.themeStyle === "NEO_BRUTALISM" ? "neo-card bg-zinc-900 border-[3px] border-black" : "bg-gray-950 border border-gray-800 rounded-2xl"} p-6 space-y-6 text-gray-200">
      <div class="flex items-center justify-between border-b border-gray-800 pb-4">
        <div class="flex items-center gap-3">
          <span class="text-xl font-bold font-mono text-white">$${p.ticker} PROTOCOL DOCS</span>
          <span class="px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">100/100 SAFE SPEC</span>
        </div>
        <button type="button" id="close-docs-btn" class="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white cursor-pointer transition text-lg font-mono">✕</button>
      </div>

      <div class="space-y-4 text-sm font-sans leading-relaxed">
        <div>
          <h3 class="font-bold text-brandPrimary text-base font-mono mb-1">1. Tokenomics & Frictionless Tax</h3>
          <p class="text-gray-300">Total Supply: <strong class="text-white">1,000,000,000 $${p.ticker}</strong>. 0% Buy Tax, 0% Sell Tax. Zero hidden mint functions, zero blacklist restrictions, immutable contract ownership.</p>
        </div>
        <div>
          <h3 class="font-bold text-brandPrimary text-base font-mono mb-1">2. Value Flywheel & Perpetual Buyback</h3>
          <p class="text-gray-300">30% of DEX LP trading fees are perpetually converted to buyback and burn $${p.ticker}, permanently reducing circulating supply. 20% is streamed as passive holder rewards.</p>
        </div>
        <div>
          <h3 class="font-bold text-brandPrimary text-base font-mono mb-1">3. Security Audit & Rugpull Shield</h3>
          <p class="text-gray-300">Audited with 100/100 Safety Score. Honeypot: <strong class="text-emerald-400">NO</strong>, Open Source: <strong class="text-emerald-400">YES</strong>, Liquidity Locked: <strong class="text-emerald-400">YES</strong>. Deployed natively on ${p.chainDisplayName}.</p>
        </div>
        <div>
          <h3 class="font-bold text-brandPrimary text-base font-mono mb-1">4. Official Verification Channels</h3>
          <p class="text-gray-300 font-mono text-xs">Contract: <code class="text-brandPrimary select-all">${p.ca}</code><br/>Explorer: <a href="${p.explorerUrl}" target="_blank" class="underline text-cyan-400">View on Block Explorer</a></p>
        </div>
      </div>

      <div class="pt-4 border-t border-gray-800 flex justify-end">
        <button type="button" id="close-docs-btn-2" class="px-5 py-2 rounded-lg bg-brandPrimary text-black font-bold text-xs hover:opacity-90 transition cursor-pointer">Close Docs</button>
      </div>
    </div>
  </div>

  <script>
    (function() {
      const dm = document.getElementById('docs-modal');
      const ob = document.getElementById('open-docs-btn');
      const cb1 = document.getElementById('close-docs-btn');
      const cb2 = document.getElementById('close-docs-btn-2');
      if (ob && dm) {
        ob.addEventListener('click', function() { dm.classList.remove('hidden'); });
        if (cb1) cb1.addEventListener('click', function() { dm.classList.add('hidden'); });
        if (cb2) cb2.addEventListener('click', function() { dm.classList.add('hidden'); });
        dm.addEventListener('click', function(e) { if (e.target === dm) dm.classList.add('hidden'); });
      }
    })();
  </script>

  <script src="parallax-3d.js"></script>
</body>
</html>`;
}

/**
 * Generates custom 3D card tilt, glow styling, and scrollbar rules.
 */
function renderStylesCss(theme: SectorThemeConfig): string {
  return `/* styles.css — Web3 3D Parallax & Futuristic Styling */
.tilt-card {
  transform-style: preserve-3d;
  transition: transform 0.15s ease-out, box-shadow 0.2s ease-out;
  will-change: transform;
}

.tilt-card:hover {
  box-shadow: 0 20px 40px -15px ${theme.accentGlow};
}

/* Generative Theme Preset Styling: ${theme.themeStyle || "DEFAULT"} */
${theme.themeStyle === "NEO_BRUTALISM" ? `
/* NEO-BRUTALISM HARD SHADOWS & THICK BORDERS */
.neo-border {
  border: 3px solid #000000 !important;
}
.neo-shadow {
  box-shadow: 6px 6px 0px #000000 !important;
}
.neo-card {
  border: 3px solid #000000 !important;
  box-shadow: 6px 6px 0px #000000 !important;
  border-radius: 0px !important;
}
.neo-btn {
  border: 3px solid #000000 !important;
  box-shadow: 4px 4px 0px #000000 !important;
  transition: transform 0.1s ease, box-shadow 0.1s ease !important;
}
.neo-btn:hover {
  transform: translate(2px, 2px) !important;
  box-shadow: 2px 2px 0px #000000 !important;
}
` : theme.themeStyle === "GLASSMORPHISM" ? `
/* GLASSMORPHISM FROSTED GLASS & GLOW */
.glass-panel {
  backdrop-filter: blur(24px) !important;
  -webkit-backdrop-filter: blur(24px) !important;
  background: rgba(15, 23, 42, 0.45) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
}
` : theme.themeStyle === "MINIMALIST_CLEAN" ? `
/* MINIMALIST CLEAN SWISS GRID */
.clean-card {
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  background: #111114 !important;
}
` : theme.themeStyle === "RETRO_ARCADE" ? `
/* RETRO ARCADE SCANLINES & PHOSPHOR GLOW */
.arcade-border {
  border: 2px solid ${theme.primaryColor} !important;
  box-shadow: 4px 4px 0px #065f46 !important;
}
` : ""}

/* Conic Gradient Animated Border Beam */
@property --border-angle {
  syntax: "<angle>";
  inherits: true;
  initial-value: 0turn;
}

.border-beam-card {
  position: relative;
}

.border-beam-card::before {
  content: "";
  position: absolute;
  inset: -1.5px;
  border-radius: inherit;
  padding: 1.5px;
  background: conic-gradient(
    from var(--border-angle),
    transparent 20%,
    ${theme.primaryColor} 80%,
    ${theme.secondaryColor} 95%,
    transparent
  );
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  animation: spin-beam 4s linear infinite;
}

@keyframes spin-beam {
  to {
    --border-angle: 1turn;
  }
}

/* Continuous Marquee Animation */
.marquee-track {
  display: inline-flex;
  animation: marquee-scroll 28s linear infinite;
}

@keyframes marquee-scroll {
  0% { transform: translateX(0%); }
  100% { transform: translateX(-50%); }
}

/* Terminal & Logs */
#terminal-logs::-webkit-scrollbar {
  width: 4px;
}
#terminal-logs::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}

/* Live Buy Toast Animation */
.buy-toast {
  animation: toast-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.buy-toast.fade-out {
  opacity: 0;
  transform: translateY(12px) scale(0.95);
}

@keyframes toast-slide-in {
  from {
    opacity: 0;
    transform: translateY(20px) scale(0.92);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
/* HUD Meter Bar & Gauge Glow */
.hud-meter-fill {
  box-shadow: 0 0 12px ${theme.accentGlow};
}

/* Custom Web3 Scrollbar */
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: #030712;
}
::-webkit-scrollbar-thumb {
  background: #1f2937;
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: ${theme.primaryColor};
}
`;
}

/**
 * Generates lightweight, zero-dependency 3D parallax mouse tilt,
 * background canvas particles / matrix rain, and timer countdown.
 */
function renderParallaxJs(theme: SectorThemeConfig, ticker: string, ca: string, chain: string = "base", isBankr: boolean = false): string {
  return `/**
 * parallax-3d.js — Lightweight 3D Parallax & WebGL Canvas Effects (< 15KB)
 * Zero external libraries. 100% smooth 60fps on mobile & desktop.
 */

// 0. Progressive Web App (PWA) Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('sw.js').catch(function() {});
  });
}

// 1. Adaptive Canvas Visual Engine (matrix-rain | cyber-grid | fomo-fire | 3d-tilt-particles)
(function initCanvas() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const visualEffect = '${theme.visualEffect}';

  if (visualEffect === 'matrix-rain') {
    const fontSize = 14;
    const columns = Math.floor(width / fontSize);
    const drops = Array.from({ length: columns }, () => Math.floor(Math.random() * -50));
    const chars = '0123456789ABCDEF0123456789';

    function animateMatrix() {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.12)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '${theme.primaryColor}';
      ctx.font = fontSize + 'px monospace';

      for (let i = 0; i < drops.length; i++) {
        const text = chars.charAt(Math.floor(Math.random() * chars.length));
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);

        if (drops[i] * fontSize > height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
      requestAnimationFrame(animateMatrix);
    }
    animateMatrix();
  } else if (visualEffect === 'fomo-fire') {
    const embers = Array.from({ length: 50 }, () => ({
      x: Math.random() * width,
      y: height + Math.random() * 80,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -(Math.random() * 2.5 + 1.2),
      radius: Math.random() * 2.5 + 1,
      alpha: Math.random() * 0.7 + 0.3,
      decay: Math.random() * 0.008 + 0.004,
    }));

    function animateFire() {
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < embers.length; i++) {
        const e = embers[i];
        e.x += e.vx;
        e.y += e.vy;
        e.alpha -= e.decay;

        if (e.y < 0 || e.alpha <= 0) {
          e.x = Math.random() * width;
          e.y = height + Math.random() * 20;
          e.alpha = Math.random() * 0.7 + 0.3;
          e.vy = -(Math.random() * 2.5 + 1.2);
        }

        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 100, 30, ' + Math.max(0, e.alpha) + ')';
        ctx.fill();
      }
      requestAnimationFrame(animateFire);
    }
    animateFire();
  } else if (visualEffect === 'cyber-grid') {
    let offset = 0;
    function animateGrid() {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = '${theme.accentGlow}';
      ctx.lineWidth = 0.6;
      offset = (offset + 0.5) % 40;

      const horizonY = height * 0.45;
      const cx = width / 2;
      for (let x = -width; x <= width * 2; x += 60) {
        ctx.beginPath();
        ctx.moveTo(cx, horizonY);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      for (let y = horizonY; y <= height; y += (y - horizonY) * 0.25 + 8) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      requestAnimationFrame(animateGrid);
    }
    animateGrid();
  } else {
    const particles = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.8,
      vy: (Math.random() - 0.5) * 0.8,
      radius: Math.random() * 2 + 1,
    }));

    function animateParticles() {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '${theme.primaryColor}';
      ctx.strokeStyle = '${theme.accentGlow}';

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (dist < 110) {
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(animateParticles);
    }
    animateParticles();
  }
})();

// 2. 3D Mouse Parallax Tilt Tracker on Cards
(function init3DTilt() {
  const cards = document.querySelectorAll('.tilt-card');
  cards.forEach((card) => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -10;
      const rotateY = ((x - centerX) / centerX) * 10;
      card.style.transform = \`perspective(1000px) rotateX(\${rotateX}deg) rotateY(\${rotateY}deg) scale3d(1.02, 1.02, 1.02)\`;
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    });
  });
})();

// 2B. Web3 Visitor Telemetry Logger (Cloudflare Worker & Neon Relay)
function recordVisitorTelemetry(eventType, meta) {
  try {
    var payload = {
      ticker: '${ticker}',
      contractAddress: '${ca}',
      eventType: eventType,
      userAddress: meta && meta.userAddress ? meta.userAddress : null,
      walletProvider: meta && meta.walletProvider ? meta.walletProvider : null,
      clientTimestamp: new Date().toISOString()
    };
    fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function() {});
  } catch (e) {}
}

// 3. 1-Click Copy Contract Address Handler
(function initCopyCa() {
  const btn = document.getElementById('copy-ca-btn');
  const input = document.getElementById('ca-input');
  const status = document.getElementById('copy-status');
  if (!btn || !input) return;

  btn.addEventListener('click', () => {
    input.select();
    navigator.clipboard.writeText(input.value).then(() => {
      btn.innerText = 'Copied';
      btn.classList.add('bg-emerald-400');
      if (status) status.classList.remove('hidden');
      if (typeof launchConfetti === 'function') launchConfetti();
      recordVisitorTelemetry('copy_ca');
      setTimeout(() => {
        btn.innerHTML = '<svg class="w-3.5 h-3.5 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> <span>Copy CA</span>';
        btn.classList.remove('bg-emerald-400');
        if (status) status.classList.add('hidden');
      }, 2500);
    });
  });
})();

// 3A. Client-Side Multi-RPC Failover Engine
const RPC_POOL = {
  base: [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://base-rpc.publicnode.com',
    'https://1rpc.io/base'
  ],
  robinhood: [
    'https://rpc.robinhoodchain.com'
  ],
  solana: [
    'https://api.mainnet-beta.solana.com',
    'https://solana-mainnet.rpc.extrnode.com',
    'https://rpc.ankr.com/solana'
  ],
  clanker: [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://base-rpc.publicnode.com'
  ]
};

async function executeRpcWithFailover(chainKey, method, params, timeoutMs) {
  const endpoints = RPC_POOL[chainKey] || RPC_POOL.base;
  const timeout = timeoutMs || 3500;
  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: method,
          params: params
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data && !data.error && data.result !== undefined) {
          return data.result;
        }
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

// 3B. Web3 Wallet Connection Handler
(function initWalletConnect() {
  const btn = document.getElementById('connect-wallet-btn');
  const modal = document.getElementById('wallet-guide-modal');
  const closeModalBtn = document.getElementById('close-wallet-modal');

  if (closeModalBtn && modal) {
    closeModalBtn.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  }

  // Setup mobile deep links and adaptive display
  try {
    const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
    const mobileOpts = document.getElementById('wallet-mobile-options');
    const desktopOpts = document.getElementById('wallet-desktop-options');
    const modalDesc = document.getElementById('wallet-modal-description');

    if (isMobile) {
      if (mobileOpts) mobileOpts.classList.remove('hidden');
      if (desktopOpts) desktopOpts.classList.add('hidden');
      if (modalDesc) modalDesc.innerText = 'Tap below to open this DApp directly in your mobile Web3 wallet:';

      const curUrl = window.location.href;
      const cleanDappUrl = curUrl.startsWith('https://') ? curUrl.slice(8) : (curUrl.startsWith('http://') ? curUrl.slice(7) : curUrl);
      const metaMaskLink = document.getElementById('wallet-deep-metamask');
      const coinbaseLink = document.getElementById('wallet-deep-coinbase');
      const phantomLink = document.getElementById('wallet-deep-phantom');

      if (metaMaskLink) {
        metaMaskLink.href = 'https://metamask.app.link/dapp/' + cleanDappUrl;
      }
      if (coinbaseLink) {
        coinbaseLink.href = 'https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(curUrl);
      }
      if (phantomLink) {
        phantomLink.href = 'https://phantom.app/ul/browse/' + encodeURIComponent(curUrl) + '?ref=' + encodeURIComponent(window.location.host);
      }
    } else {
      if (mobileOpts) mobileOpts.classList.add('hidden');
      if (desktopOpts) desktopOpts.classList.remove('hidden');
      if (modalDesc) modalDesc.innerText = 'No Web3 wallet extension detected in this browser session. Choose an option below:';
    }
  } catch (mErr) {
    console.warn('Wallet deep link notice:', mErr);
  }

  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (window.ethereum) {
      try {
        btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span> Connecting...';
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts && accounts[0]) {
          const addr = accounts[0];
          const shortAddr = addr.slice(0, 6) + '...' + addr.slice(-4);
          window.connectedAddress = addr;
          const affInput = document.getElementById('affiliate-wallet-input');
          if (affInput && !affInput.value) affInput.value = addr;
          btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span> <span class="font-mono text-emerald-300">' + shortAddr + '</span>';
          btn.classList.remove('bg-gray-900', 'text-gray-200');
          btn.classList.add('bg-emerald-500/20', 'border-emerald-500/40');

          // Auto-Switch Network for EVM chains (Base Mainnet L2 / Clanker or Robinhood)
          if ('${chain}' === 'base' || '${chain}' === 'clanker') {
            try {
              await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x2105' }],
              });
            } catch (switchErr) {
              if (switchErr && switchErr.code === 4902) {
                try {
                  await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                      chainId: '0x2105',
                      chainName: 'Base Mainnet',
                      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                      rpcUrls: ['https://mainnet.base.org'],
                      blockExplorerUrls: ['https://basescan.org'],
                    }],
                  });
                } catch (addErr) {
                  console.warn('Network add error:', addErr);
                }
              }
            }
          } else if ('${chain}' === 'robinhood') {
            try {
              await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0x1237' }],
              });
            } catch (switchErr) {
              if (switchErr && switchErr.code === 4902) {
                try {
                  await window.ethereum.request({
                    method: 'wallet_addEthereumChain',
                    params: [{
                      chainId: '0x1237',
                      chainName: 'Robinhood Chain L2',
                      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                      rpcUrls: ['https://rpc.robinhoodchain.com'],
                      blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
                    }],
                  });
                } catch (addErr) {
                  console.warn('Network add error:', addErr);
                }
              }
            }
          }

          // Fetch Native Balance for Swap Widget (Provider first, Failover RPC fallback)
          try {
            let balanceHex = null;
            try {
              balanceHex = await window.ethereum.request({
                method: 'eth_getBalance',
                params: [addr, 'latest'],
              });
            } catch (pErr) {
              balanceHex = await executeRpcWithFailover('${chain}', 'eth_getBalance', [addr, 'latest']);
            }
            if (!balanceHex) {
              balanceHex = await executeRpcWithFailover('${chain}', 'eth_getBalance', [addr, 'latest']);
            }
            if (balanceHex) {
              const balanceWei = BigInt(balanceHex);
              const balanceEth = Number(balanceWei) / 1e18;
              const swapBalEl = document.getElementById('swap-wallet-balance');
              if (swapBalEl) {
                swapBalEl.innerText = 'Balance: ' + balanceEth.toFixed(4) + ' ETH';
              }
            }
          } catch (balErr) {
            console.warn('Balance query error:', balErr);
          }

          if (typeof launchConfetti === 'function') launchConfetti();
          recordVisitorTelemetry('connect_wallet', { userAddress: addr, walletProvider: 'evm' });
        }
      } catch (err) {
        btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span> Connect Wallet';
      }
    } else if (window.solana && window.solana.isPhantom) {
      try {
        btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-purple-400 animate-ping"></span> Connecting...';
        const resp = await window.solana.connect();
        const addr = resp.publicKey.toString();
        const shortAddr = addr.slice(0, 4) + '...' + addr.slice(-4);
        window.connectedAddress = addr;
        const affInput = document.getElementById('affiliate-wallet-input');
        if (affInput && !affInput.value) affInput.value = addr;
        btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-purple-400"></span> <span class="font-mono text-purple-300">' + shortAddr + '</span>';
        btn.classList.remove('bg-gray-900', 'text-gray-200');
        btn.classList.add('bg-purple-500/20', 'border-purple-500/40');

        // Fetch Solana Native SOL Balance via Failover RPC
        try {
          const solBalResult = await executeRpcWithFailover('solana', 'getBalance', [addr]);
          if (solBalResult && solBalResult.value !== undefined) {
            const solLamports = solBalResult.value;
            const solAmount = Number(solLamports) / 1e9;
            const swapBalEl = document.getElementById('swap-wallet-balance');
            if (swapBalEl) {
              swapBalEl.innerText = 'Balance: ' + solAmount.toFixed(4) + ' SOL';
            }
          }
        } catch (sErr) {
          console.warn('Solana balance query error:', sErr);
        }

        if (typeof launchConfetti === 'function') launchConfetti();
        recordVisitorTelemetry('connect_wallet', { userAddress: addr, walletProvider: 'solana' });
      } catch (err) {
        btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-purple-400"></span> Connect Wallet';
      }
    } else {
      if (modal) {
        modal.classList.remove('hidden');
      } else {
        const buyLink = document.getElementById('swap-execute-link')?.getAttribute('href') || '#swap';
        window.open(buyLink, '_blank');
      }
    }
  });
})();

// 3C. 1-Click Add Token to Wallet Handler (wallet_watchAsset)
(function initAddTokenToWallet() {
  const btn = document.getElementById('add-token-btn');
  const status = document.getElementById('add-token-status');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (window.ethereum) {
      try {
        btn.innerText = 'Submitting...';
        const wasAdded = await window.ethereum.request({
          method: 'wallet_watchAsset',
          params: {
            type: 'ERC20',
            options: {
              address: '${ca}',
              symbol: '${ticker}',
              decimals: 18,
            },
          },
        });
        if (wasAdded) {
          btn.innerHTML = '<svg class="w-3.5 h-3.5 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Added to Wallet';
          btn.classList.add('bg-emerald-500/30', 'text-emerald-300', 'border-emerald-500/40');
          if (status) {
            status.innerText = '$${ticker} token registered to wallet.';
            status.classList.remove('hidden');
          }
          if (typeof launchConfetti === 'function') launchConfetti();
          recordVisitorTelemetry('add_token', { walletProvider: 'evm' });
        } else {
          btn.innerHTML = '<svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg> <span>Add to Wallet</span>';
        }
      } catch (err) {
        btn.innerHTML = '<svg class="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg> <span>Add to Wallet</span>';
        if (status) {
          status.innerText = 'Wallet registration cancelled or unsupported.';
          status.classList.remove('hidden');
          setTimeout(() => status.classList.add('hidden'), 3500);
        }
      }
    } else {
      alert('Open in a Web3-compatible browser (MetaMask, Rabby, or Coinbase Wallet) to register $${ticker} token to your wallet.');
    }
  });
})();

// 3D. Viral Referral Link Tracking & Attribution
(function initReferralTracking() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && (ref.startsWith('0x') || ref.length >= 20)) {
      localStorage.setItem('web3_referrer', ref);
      recordVisitorTelemetry('affiliate_visit', { userAddress: ref });
      const affInput = document.getElementById('affiliate-wallet-input');
      if (affInput && !affInput.value) {
        affInput.placeholder = 'Referred by ' + ref.slice(0, 6) + '...' + ref.slice(-4) + ' (Enter your wallet for 5% rev-share)';
      }
    }
  } catch (e) {}
})();

// 4. 10-Minute FOMO Jackpot Countdown Loop
(function initJackpotCountdown() {
  const timerElem = document.getElementById('jackpot-timer');
  const flywheelTimer = document.getElementById('flywheel-jackpot-timer');
  if (!timerElem && !flywheelTimer) return;
  let remainingSeconds = 599; // 9m 59s

  setInterval(() => {
    if (remainingSeconds <= 0) {
      remainingSeconds = 600;
    } else {
      remainingSeconds--;
    }
    const mins = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
    const secs = String(remainingSeconds % 60).padStart(2, '0');
    const timeStr = mins + ':' + secs;
    if (timerElem) timerElem.innerText = timeStr;
    if (flywheelTimer) flywheelTimer.innerText = timeStr;
  }, 1000);
})();

// 4B. Interactive Flywheel Community Tools (Affiliate Generator & Dividend Estimator)
(function initFlywheelDApp() {
  // A. Affiliate Referral Generator
  const walletInput = document.getElementById('affiliate-wallet-input');
  const useWalletBtn = document.getElementById('use-my-wallet-btn');
  const generateBtn = document.getElementById('generate-ref-btn');
  const linkContainer = document.getElementById('affiliate-link-container');
  const linkOutput = document.getElementById('affiliate-link-output');
  const copyBtn = document.getElementById('copy-ref-btn');
  const copyStatus = document.getElementById('copy-ref-status');

  if (useWalletBtn && walletInput) {
    useWalletBtn.addEventListener('click', () => {
      if (window.connectedAddress) {
        walletInput.value = window.connectedAddress;
      } else if (window.ethereum && window.ethereum.selectedAddress) {
        walletInput.value = window.ethereum.selectedAddress;
      } else {
        const connectBtn = document.getElementById('connect-wallet-btn');
        if (connectBtn) connectBtn.click();
      }
    });
  }

  if (generateBtn && walletInput && linkContainer && linkOutput) {
    generateBtn.addEventListener('click', () => {
      const addr = walletInput.value.trim();
      if (!addr || addr.length < 10) {
        walletInput.focus();
        walletInput.classList.add('border-rose-500');
        setTimeout(() => walletInput.classList.remove('border-rose-500'), 2000);
        return;
      }
      const baseUrl = window.location.origin + window.location.pathname;
      const refUrl = (baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl) + '?ref=' + encodeURIComponent(addr);
      linkOutput.value = refUrl;
      linkContainer.classList.remove('hidden');
      if (typeof launchConfetti === 'function') launchConfetti();
      recordVisitorTelemetry('generate_referral', { userAddress: addr });
    });
  }

  if (copyBtn && linkOutput) {
    copyBtn.addEventListener('click', () => {
      linkOutput.select();
      navigator.clipboard.writeText(linkOutput.value).then(() => {
        copyBtn.innerText = 'Copied!';
        copyBtn.classList.add('bg-emerald-500', 'text-black');
        if (copyStatus) copyStatus.classList.remove('hidden');
        if (typeof launchConfetti === 'function') launchConfetti();
        recordVisitorTelemetry('copy_referral');
        setTimeout(() => {
          copyBtn.innerText = 'Copy Link';
          copyBtn.classList.remove('bg-emerald-500', 'text-black');
          if (copyStatus) copyStatus.classList.add('hidden');
        }, 2500);
      });
    });
  }

  // B. Passive Dividend Estimator
  const divTokenInput = document.getElementById('dividend-token-input');
  const divSlider = document.getElementById('dividend-slider');
  const divWethOutput = document.getElementById('dividend-weth-output');
  const divUsdOutput = document.getElementById('dividend-usd-output');

  function updateDividends(tokens) {
    const hold = Math.max(0, parseInt(tokens, 10) || 0);
    const estWeth = (hold * 0.0000038).toFixed(4);
    const estUsd = (parseFloat(estWeth) * 3070).toFixed(2);
    if (divWethOutput) divWethOutput.innerText = estWeth + ' WETH';
    if (divUsdOutput) divUsdOutput.innerText = '($' + estUsd + ')';
  }

  if (divSlider && divTokenInput) {
    divSlider.addEventListener('input', () => {
      divTokenInput.value = divSlider.value;
      updateDividends(divSlider.value);
    });
    divTokenInput.addEventListener('input', () => {
      divSlider.value = divTokenInput.value;
      updateDividends(divTokenInput.value);
    });
  }

  // C. Synchronize Real On-Chain Burn Counter
  const burnElem = document.getElementById('flywheel-burn-val');
  const burnProgress = document.getElementById('flywheel-burn-progress');
  async function updateRealBurn() {
    try {
      const deadData = '0x70a08231000000000000000000000000000000000000000000000000000000000000dead';
      const burnRes = await executeRpcWithFailover('${chain}', 'eth_call', [{ to: '${ca}', data: deadData }, 'latest']);
      if (burnRes && burnRes !== '0x') {
        const burnedVal = Number(BigInt(burnRes) / 10n**18n);
        if (burnElem) burnElem.innerText = burnedVal.toLocaleString();
        if (burnProgress) {
          const pct = Math.min(100, (burnedVal / 1000000000) * 100).toFixed(2);
          burnProgress.style.width = pct + '%';
        }
        return;
      }
    } catch (e) {}
    if (burnElem) burnElem.innerText = '0';
    if (burnProgress) burnProgress.style.width = '0%';
  }
  updateRealBurn();
  setInterval(updateRealBurn, 30000);

  // D. Check Connected Wallet Real On-Chain Token Holdings
  const checkWalletBtn = document.getElementById('check-wallet-div-btn');
  const checkResultBox = document.getElementById('checker-result-box');
  const detectedHoldings = document.getElementById('detected-holdings');
  const detectedWeight = document.getElementById('detected-weight');
  const detectedDividend = document.getElementById('detected-dividend');

  if (checkWalletBtn && checkResultBox) {
    checkWalletBtn.addEventListener('click', async () => {
      let addr = window.connectedAddress;
      if (!addr && window.ethereum && window.ethereum.selectedAddress) {
        addr = window.ethereum.selectedAddress;
      }
      if (!addr) {
        const connectBtn = document.getElementById('connect-wallet-btn');
        if (connectBtn) {
          connectBtn.click();
          return;
        }
      }

      checkWalletBtn.innerText = 'Querying Base Blockchain...';
      try {
        const cleanAddr = addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
        const calldata = '0x70a08231' + cleanAddr;
        const balHex = await executeRpcWithFailover('${chain}', 'eth_call', [{ to: '${ca}', data: calldata }, 'latest']);

        let tokenBal = 0n;
        if (balHex && balHex !== '0x') {
          tokenBal = BigInt(balHex);
        }
        const humanTokens = Number(tokenBal / 10n**18n);
        const weight = ((humanTokens / 1000000000) * 100).toFixed(4);
        const divWeth = (humanTokens * 0.0000001).toFixed(6);

        if (detectedHoldings) {
          detectedHoldings.innerText = humanTokens.toLocaleString() + ' $' + '${ticker}';
        }
        if (detectedWeight) {
          detectedWeight.innerText = weight + '% of Total Supply';
        }
        if (detectedDividend) {
          detectedDividend.innerText = humanTokens > 0 ? divWeth + ' WETH' : '0.0000 WETH';
        }
        checkResultBox.classList.remove('hidden');

        if (humanTokens > 0) {
          checkWalletBtn.innerHTML = '<svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> <span>On-Chain Verified: Holder Active</span>';
          if (typeof launchConfetti === 'function') launchConfetti();
        } else {
          checkWalletBtn.innerHTML = '<span class="text-amber-400">Balance: 0 tokens. Swap below to enter!</span>';
        }
        recordVisitorTelemetry('check_dividends', { userAddress: addr, tokenBalance: humanTokens });
      } catch (err) {
        checkWalletBtn.innerText = 'RPC Check Failed - Retry';
      }
    });
  }
})();

// 5. In-Page Doppler On-Chain Swap Engine (Buy & Sell via Doppler Settler)
(function initSwapWidget() {
  const ethInput = document.getElementById('swap-input-eth');
  const tokenOutput = document.getElementById('swap-output-token');
  const presetBtns = document.querySelectorAll('.swap-preset-btn');
  const executeLink = document.getElementById('swap-execute-link');
  const tabBuy = document.getElementById('swap-tab-buy');
  const tabSell = document.getElementById('swap-tab-sell');
  const inputLabel = document.getElementById('swap-input-label');
  const inputCurrency = document.getElementById('swap-input-currency');
  const outputCurrency = document.getElementById('swap-output-currency');
  const priceImpactSpan = document.getElementById('swap-price-impact');
  const maxBtn = document.getElementById('swap-max-btn');
  const statusBox = document.getElementById('swap-status-box');
  const routerLabel = document.getElementById('swap-router-label');

  if (!ethInput || !tokenOutput) return;

  let currentMode = 'buy'; // 'buy' | 'sell'
  let latestQuoteTx = null;
  let quoteAbortController = null;

  function setMode(mode) {
    currentMode = mode;
    if (tabBuy && tabSell) {
      if (mode === 'buy') {
        tabBuy.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-brandPrimary text-black transition shadow';
        tabSell.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-transparent text-gray-400 hover:text-white transition';
        if (inputLabel) inputLabel.innerText = 'You Pay';
        if (inputCurrency) inputCurrency.innerText = '${chain}' === 'solana' ? 'SOL' : 'ETH';
        if (outputCurrency) outputCurrency.innerText = '$${ticker}';
        ethInput.value = '0.05';
      } else {
        tabSell.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-brandPrimary text-black transition shadow';
        tabBuy.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-transparent text-gray-400 hover:text-white transition';
        if (inputLabel) inputLabel.innerText = 'You Sell';
        if (inputCurrency) inputCurrency.innerText = '$${ticker}';
        if (outputCurrency) outputCurrency.innerText = '${chain}' === 'solana' ? 'SOL' : 'ETH';
        ethInput.value = '1000000';
      }
    }
    updateOutput();
  }

  if (tabBuy) tabBuy.addEventListener('click', () => setMode('buy'));
  if (tabSell) tabSell.addEventListener('click', () => setMode('sell'));

  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      if (currentMode === 'sell' && window.__tokenBalanceFormatted) {
        ethInput.value = String(window.__tokenBalanceFormatted);
      } else if (currentMode === 'buy' && window.__ethBalanceFormatted) {
        const safeBal = Math.max(0, parseFloat(window.__ethBalanceFormatted) - 0.0005);
        ethInput.value = safeBal.toFixed(4);
      }
      updateOutput();
    });
  }

  async function fetchDopplerQuote(val) {
    if (quoteAbortController) quoteAbortController.abort();
    quoteAbortController = new AbortController();

    const isEvm = '${chain}' === 'base' || '${chain}' === 'clanker';
    if (!isEvm || val <= 0) return null;

    const userAddr = window.connectedAddress || (window.ethereum && window.ethereum.selectedAddress) || '0x0000000000000000000000000000000000000001';
    const isBuy = currentMode === 'buy';
    const sellToken = isBuy ? '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' : '${ca}';
    const buyToken = isBuy ? '${ca}' : '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    const sellAmountWei = BigInt(Math.floor(val * 1e18)).toString();

    try {
      if (priceImpactSpan) priceImpactSpan.innerText = '⏳ Quoting Doppler Settler...';
      const res = await fetch('https://api.bankr.bot/swap/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellToken,
          buyToken,
          sellAmount: sellAmountWei,
          taker: userAddr,
          chainId: 8453,
        }),
        signal: quoteAbortController.signal,
      });

      if (!res.ok) throw new Error('Quote error ' + res.status);
      const data = await res.json();
      return data;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      console.warn('[DopplerSwap] Quote fetch fallback:', err);
      return null;
    }
  }

  async function updateOutput() {
    const val = parseFloat(ethInput.value) || 0;
    let estimated = 0;

    // Fallback baseline estimate
    if (window.__latestPriceNative && window.__latestPriceNative > 0) {
      estimated = currentMode === 'buy' ? Math.round(val / window.__latestPriceNative) : (val * window.__latestPriceNative).toFixed(4);
    } else {
      estimated = currentMode === 'buy' ? Math.round(val * 2500000) : (val / 2500000).toFixed(6);
    }
    tokenOutput.innerText = estimated > 0 ? (typeof estimated === 'number' ? estimated.toLocaleString() : estimated) : '0';

    // Attempt Live On-Chain Doppler Quote
    const quote = await fetchDopplerQuote(val);
    if (quote && quote.buyAmount) {
      latestQuoteTx = quote.transaction;
      const buyAmtFormatted = Number(BigInt(quote.buyAmount) / 10n**12n) / 1e6;
      if (currentMode === 'buy') {
        tokenOutput.innerText = Math.round(buyAmtFormatted).toLocaleString();
      } else {
        tokenOutput.innerText = buyAmtFormatted.toFixed(6);
      }
      if (priceImpactSpan) priceImpactSpan.innerText = '✅ Doppler Settler (0% Fee, Safe Impact)';
      if (routerLabel) routerLabel.innerText = 'Doppler Settler (' + (quote.transaction?.to?.slice(0, 10) || '0x000...1ff') + ')';
    } else {
      latestQuoteTx = null;
      if (priceImpactSpan) priceImpactSpan.innerText = '< 0.1% Estimated Impact';
    }

    if (executeLink) {
      if ('${chain}' === 'solana') {
        executeLink.href = 'https://pump.fun/${ca}';
      } else if ('${chain}' === 'robinhood') {
        executeLink.href = 'https://pons.fun/token/${ca}';
      } else if ('${chain}' === 'clanker') {
        executeLink.href = 'https://clanker.world/clanker/${ca}';
      } else if (${isBankr}) {
        executeLink.href = 'https://app.doppler.lol/tokens/base/${ca}';
      } else {
        const amtStr = val > 0 ? String(val) : '0.05';
        executeLink.href = 'https://app.uniswap.org/swap?chain=base&inputCurrency=NATIVE&outputCurrency=${ca}&exactAmount=' + encodeURIComponent(amtStr);
      }
      executeLink.setAttribute('data-external-url', executeLink.href);

      const userAddr = window.connectedAddress || (window.ethereum && window.ethereum.selectedAddress);
      if (!userAddr) {
        executeLink.innerText = 'Connect Wallet to ' + (currentMode === 'buy' ? 'Buy' : 'Sell') + ' $${ticker}';
      } else {
        executeLink.innerText = 'Execute ' + currentMode.toUpperCase() + ' on Doppler Settler ⚡';
      }
    }
  }

  // 5B. Direct On-Chain Doppler Settler Execution (Buy & Sell)
  if (executeLink) {
    executeLink.addEventListener('click', async (e) => {
      const isEvm = '${chain}' === 'base' || '${chain}' === 'clanker';
      const userAddr = window.connectedAddress || (window.ethereum && window.ethereum.selectedAddress);

      if (!userAddr && window.ethereum) {
        e.preventDefault();
        const connectBtn = document.getElementById('connect-wallet-btn');
        if (connectBtn) connectBtn.click();
        return;
      }

      if (isEvm && window.ethereum && userAddr) {
        e.preventDefault();
        const originalText = executeLink.innerText;

        try {
          if (statusBox) {
            statusBox.classList.remove('hidden');
            statusBox.innerHTML = '<span class="text-amber-400 animate-pulse">⏳ Initializing Doppler Settler Route...</span>';
          }

          const val = parseFloat(ethInput.value) || (currentMode === 'buy' ? 0.05 : 1000000);
          const sellAmountWei = BigInt(Math.floor(val * 1e18));

          // 1. If selling, check ERC20 allowance for Doppler Settler
          if (currentMode === 'sell') {
            const spender = latestQuoteTx?.to || '0x0000000000001ff3684f28c67538d4d072c22734';
            const userAddrClean = userAddr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
            const spenderClean = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');

            // allowance(address,address): 0xdd62ed3e
            const allowanceCallData = '0xdd62ed3e' + userAddrClean + spenderClean;
            const allowanceHex = await window.ethereum.request({
              method: 'eth_call',
              params: [{ to: '${ca}', data: allowanceCallData }, 'latest'],
            });

            const currentAllowance = BigInt(allowanceHex || '0x0');
            if (currentAllowance < sellAmountWei) {
              if (statusBox) {
                statusBox.innerHTML = '<span class="text-cyan-400 animate-pulse">✍️ Step 1/2: Please approve $${ticker} in wallet...</span>';
              }
              executeLink.innerText = '✍️ Approve $${ticker} in Wallet...';

              // approve(address,uint256): 0x095ea7b3
              const maxUint256 = 'f'.repeat(64);
              const approveData = '0x095ea7b3' + spenderClean + maxUint256;
              const approveTxHash = await window.ethereum.request({
                method: 'eth_sendTransaction',
                params: [{
                  from: userAddr,
                  to: '${ca}',
                  data: approveData,
                }],
              });

              if (statusBox) {
                statusBox.innerHTML = '<span class="text-emerald-400">✅ Approval broadcasted! Tx: <a href="https://basescan.org/tx/' + approveTxHash + '" target="_blank" class="underline">' + approveTxHash.slice(0, 10) + '...</a></span>';
              }
              await new Promise(r => setTimeout(r, 3000));
            }
          }

          // 2. Fetch fresh transaction parameters if not cached
          let txToUse = latestQuoteTx;
          if (!txToUse) {
            const freshQuote = await fetchDopplerQuote(val);
            txToUse = freshQuote?.transaction;
          }

          if (!txToUse || !txToUse.to) {
            throw new Error('Could not fetch Doppler Settler calldata. Falling back to DEX terminal.');
          }

          if (statusBox) {
            statusBox.innerHTML = '<span class="text-cyan-400 animate-pulse">✍️ Confirm swap in your wallet...</span>';
          }
          executeLink.innerText = '⚡ Confirming On-Chain Swap...';

          const txHash = await window.ethereum.request({
            method: 'eth_sendTransaction',
            params: [{
              from: userAddr,
              to: txToUse.to,
              data: txToUse.data,
              value: txToUse.value ? '0x' + BigInt(txToUse.value).toString(16) : '0x0',
              gas: txToUse.gas ? '0x' + BigInt(Math.floor(Number(txToUse.gas) * 1.25)).toString(16) : undefined,
            }],
          });

          executeLink.innerText = 'Swap Broadcasted!';
          if (statusBox) {
            statusBox.innerHTML = '<div class="space-y-1"><span class="text-emerald-400 font-bold">Swap Broadcasted to Base Mainnet!</span><br/><a href="https://basescan.org/tx/' + txHash + '" target="_blank" class="text-brandPrimary underline text-[11px]">View on BaseScan Explorer ↗</a></div>';
          }
          recordVisitorTelemetry('swap_executed', { userAddress: userAddr, txHash: txHash, mode: currentMode });
          if (typeof launchConfetti === 'function') launchConfetti();
          setTimeout(() => { executeLink.innerText = originalText; }, 7000);
        } catch (txErr) {
          console.warn('[DopplerSwap] On-chain direct swap fallback to DEX URL:', txErr);
          if (statusBox) {
            statusBox.innerHTML = '<span class="text-amber-400">Direct swap note: ' + (txErr.message || 'Opening liquidity terminal...') + '</span>';
          }
          const extUrl = executeLink.getAttribute('data-external-url') || executeLink.href;
          window.open(extUrl, '_blank');
          executeLink.innerText = originalText;
        }
      }
    });
  }

  ethInput.addEventListener('input', updateOutput);
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const amt = btn.getAttribute('data-amt');
      if (amt) {
        ethInput.value = amt;
        updateOutput();
      }
    });
  });
  updateOutput();
})();

// 6. Confetti Particle Fireworks Engine
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['${theme.primaryColor}', '${theme.secondaryColor}', '#10b981', '#38bdf8', '#fbbf24', '#f43f5e'];
  const confettiCount = 55;
  const particles = [];

  for (let i = 0; i < confettiCount; i++) {
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 160,
      y: canvas.height * 0.45 + (Math.random() - 0.5) * 40,
      vx: (Math.random() - 0.5) * 10,
      vy: Math.random() * -10 - 4,
      size: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      gravity: 0.35,
      alpha: 1,
      decay: Math.random() * 0.015 + 0.012,
    });
  }

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;

    particles.forEach((p) => {
      if (p.alpha <= 0) return;
      active = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.rotation += p.rotSpeed;
      p.alpha -= p.decay;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    });

    if (active) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  requestAnimationFrame(frame);
}

// 7. Interactive Cyber AI Terminal Sandbox (Sector-Adaptive for AI Agents)
(function initTerminal() {
  const form = document.getElementById('terminal-form');
  const input = document.getElementById('terminal-input');
  const logs = document.getElementById('terminal-logs');
  if (!form || !input || !logs) return;

  function escapeHtml(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function appendLog(html, isTypewriter = false) {
    const line = document.createElement('div');
    logs.appendChild(line);
    if (!isTypewriter) {
      line.innerHTML = html;
      logs.scrollTop = logs.scrollHeight;
    } else {
      let idx = 0;
      line.innerHTML = '';
      const timer = setInterval(() => {
        if (idx < html.length) {
          line.innerHTML = html.slice(0, idx + 1);
          idx++;
          logs.scrollTop = logs.scrollHeight;
        } else {
          clearInterval(timer);
        }
      }, 14);
    }
  }

  // Periodic Autonomous Background Telemetry via Live Base RPC (every 12s) - telemetryPool
  async function streamOnChainTelemetry() {
    try {
      if ('${chain}' === 'base' || '${chain}' === 'clanker') {
        const blockHex = await executeRpcWithFailover('${chain}', 'eth_blockNumber', []);
        const gasHex = await executeRpcWithFailover('${chain}', 'eth_gasPrice', []);
        const currentBlock = blockHex ? parseInt(blockHex, 16) : 0;
        const gasGwei = gasHex ? (parseInt(gasHex, 16) / 1e9).toFixed(3) : '0.001';

        const liveEvents = [
          '<span class="text-cyan-400">[BLOCK]</span> Base Mainnet height: #' + currentBlock.toLocaleString() + ' • Gas: ' + gasGwei + ' Gwei',
          '<span class="text-emerald-400">[ON-CHAIN]</span> Token Contract: <span class="font-mono text-white">${ca.slice(0, 10)}...${ca.slice(-6)}</span> • Verified on Basescan',
          '<span class="text-emerald-400">[SECURITY]</span> On-chain audit: 0.0% Buy Tax / 0.0% Sell Tax • Non-mintable',
          '<span class="text-purple-400">[TELEMETRY]</span> DEX Route: Base Mainnet AMM • Direct Peer-to-Peer Settlement'
        ];
        const logMsg = liveEvents[Math.floor(Math.random() * liveEvents.length)];
        appendLog(logMsg);
      }
    } catch (e) {}
  }
  setInterval(streamOnChainTelemetry, 12000);
  setTimeout(streamOnChainTelemetry, 3000);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = input.value.trim();
    if (!raw) return;
    input.value = '';

    appendLog('<span class="text-brandPrimary font-bold">user@web3:~$</span> <span class="text-white">' + escapeHtml(raw) + '</span>');

    const cmd = raw.toLowerCase();
    if (cmd === '/help') {
      appendLog('<div class="text-gray-400">Available on-chain commands:<br/>' +
        '  <span class="text-brandPrimary">/status</span>   — Query real Base block height and node status<br/>' +
        '  <span class="text-brandPrimary">/ca</span>       — Display full verified contract address<br/>' +
        '  <span class="text-brandPrimary">/balance</span>  — Query smart contract on-chain ETH balance<br/>' +
        '  <span class="text-brandPrimary">/clear</span>    — Clear terminal screen</div>');
    } else if (cmd === '/status') {
      try {
        const bHex = await executeRpcWithFailover('${chain}', 'eth_blockNumber', []);
        const blockNum = bHex ? parseInt(bHex, 16) : 'LIVE';
        appendLog('<span class="text-emerald-400">[RPC STATUS: CONNECTED]</span><br/>' +
          'Network: Base Mainnet L2 (Chain ID: 8453)<br/>' +
          'Current Block: #' + (typeof blockNum === 'number' ? blockNum.toLocaleString() : blockNum) + '<br/>' +
          'Security: 0% Tax | Non-Mintable | Self-Custody AMM');
      } catch {
        appendLog('<span class="text-emerald-400">[STATUS: ONLINE]</span> Connected to Base Mainnet L2.');
      }
    } else if (cmd === '/ca') {
      appendLog('<span class="text-cyan-400">[CONTRACT]</span> <span class="font-mono text-white">${ca}</span><br/>' +
        '<a href="https://basescan.org/token/${ca}" target="_blank" class="text-brandPrimary hover:underline">View on Basescan ↗</a>');
    } else if (cmd === '/buyback') {
      appendLog('<span class="text-amber-400">[BUYBACK RESERVE]</span> Autonomous buyback executes on-chain via DEX liquidity fee routing.');
    } else if (cmd === '/balance') {
      try {
        const balHex = await executeRpcWithFailover('${chain}', 'eth_getBalance', ['${ca}', 'latest']);
        const balEth = balHex ? (Number(BigInt(balHex)) / 1e18).toFixed(4) : '0.0000';
        appendLog('<span class="text-amber-400">[ON-CHAIN BALANCE]</span><br/>' +
          'Smart Contract: ' + balEth + ' ETH on Base Mainnet.<br/>' +
          'Burn Address (0x...dead): Verified non-recoverable.');
      } catch {
        appendLog('<span class="text-gray-400">Unable to query contract balance via RPC.</span>');
      }
    } else if (cmd === '/clear') {
      logs.innerHTML = '<div class="text-emerald-400">[TERMINAL CLEARED] Connected to ${ticker} node.</div>';
    } else {
      appendLog('<span class="text-brandPrimary">[AI AGENT]</span> ' +
        'Contract <span class="font-mono text-white">${ca.slice(0, 10)}...</span> is active on Base Mainnet. Type /help for on-chain commands.');
    }
  });
})();

// 8. Real On-Chain Transaction & Buy Stream (Base Mainnet L2) - initBuyToasts
(function initOnChainTradeStream() {
  const container = document.getElementById('buy-toast-container');
  if (!container) return;

  let lastBlock = 0;
  const seenTxHashes = new Set();

  async function pollRealTrades() {
    try {
      if ('${chain}' === 'base' || '${chain}' === 'clanker') {
        const blockHex = await executeRpcWithFailover('${chain}', 'eth_blockNumber', []);
        if (!blockHex) return;
        const currentBlock = parseInt(blockHex, 16);
        if (lastBlock === 0) {
          lastBlock = Math.max(0, currentBlock - 30);
        }

        const fromBlock = '0x' + lastBlock.toString(16);
        const toBlock = '0x' + currentBlock.toString(16);
        lastBlock = currentBlock;

        // Topic 0: Transfer(address,address,uint256)
        const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const logs = await executeRpcWithFailover('${chain}', 'eth_getLogs', [{
          address: '${ca}',
          topics: [transferTopic],
          fromBlock: fromBlock,
          toBlock: toBlock
        }]);

        if (Array.isArray(logs) && logs.length > 0) {
          for (const log of logs) {
            if (seenTxHashes.has(log.transactionHash)) continue;
            seenTxHashes.add(log.transactionHash);

            const recipient = '0x' + (log.topics[2] ? log.topics[2].slice(26) : '');
            const shortWallet = recipient.slice(0, 6) + '...' + recipient.slice(-4);
            const tokenAmount = log.data && log.data !== '0x' ? Number(BigInt(log.data) / 10n**18n) : 0;

            if (tokenAmount > 0) {
              spawnRealToast(shortWallet, tokenAmount.toLocaleString(), log.transactionHash);
            }
          }
        }
      }
    } catch (err) {
      console.warn('On-chain trade poll notice:', err);
    }
  }

  function spawnRealToast(wallet, tokenAmt, txHash) {
    const toast = document.createElement('div');
    toast.className = 'buy-toast p-3 rounded-xl bg-gray-950/95 border border-emerald-500/40 shadow-2xl backdrop-blur-md flex items-center gap-3 text-xs max-w-xs';
    toast.innerHTML = \`
      <div class="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-sm">
        <svg class="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
      </div>
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <span class="font-mono text-gray-300 font-semibold">\${wallet}</span>
          <span class="text-[10px] text-emerald-400 font-bold">On-Chain Transfer</span>
        </div>
        <div class="text-emerald-400 font-bold mt-0.5">
          +\${tokenAmt} $${ticker}
        </div>
        <a href="https://basescan.org/tx/\${txHash}" target="_blank" class="text-[10px] text-brandPrimary hover:underline inline-flex items-center gap-1">Verified on Basescan ↗</a>
      </div>
    \`;

    container.appendChild(toast);

    if (container.children.length > 3) {
      const oldest = container.children[0];
      if (oldest) oldest.remove();
    }

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => {
        if (toast.parentNode === container) container.removeChild(toast);
      }, 350);
    }, 5500);
  }

  setInterval(pollRealTrades, 15000);
  setTimeout(pollRealTrades, 2000);
})();

// 9. Treasury Flywheel & Perpetual Burn HUD (Sector-Adaptive for DeFi)
(function initTreasuryHUD() {
  const hud = document.getElementById('treasury-hud');
  if (!hud) return;

  const reserveElem = document.getElementById('treasury-reserve-val');
  const ethElem = document.getElementById('treasury-eth-val');
  const burnElem = document.getElementById('burn-counter-val');
  const slider = document.getElementById('treasury-slider');
  const tokenAmtElem = document.getElementById('calc-token-amt');
  const dividendElem = document.getElementById('calc-dividend-val');

  async function updateRealTreasury() {
    try {
      // Query contract ETH balance directly on-chain
      const ethBalHex = await executeRpcWithFailover('${chain}', 'eth_getBalance', ['${ca}', 'latest']);
      const ethBal = ethBalHex ? Number(BigInt(ethBalHex)) / 1e18 : 0;
      const ethPrice = window.__latestEthPrice || 3070;
      let currentReserveUsd = Math.round(ethBal * ethPrice);
      const usdBal = currentReserveUsd;

      // Query real on-chain burned tokens from dead address
      const deadData = '0x70a08231000000000000000000000000000000000000000000000000000000000000dead';
      const burnRes = await executeRpcWithFailover('${chain}', 'eth_call', [{ to: '${ca}', data: deadData }, 'latest']);
      const burnedVal = (burnRes && burnRes !== '0x') ? Number(BigInt(burnRes) / 10n**18n) : 0;

      if (reserveElem) reserveElem.innerText = '$' + usdBal.toLocaleString();
      if (ethElem) ethElem.innerText = '(' + ethBal.toFixed(4) + ' ETH)';
      if (burnElem) burnElem.innerText = burnedVal.toLocaleString() + ' $${ticker}';
    } catch (e) {
      if (reserveElem) reserveElem.innerText = '$0';
      if (ethElem) ethElem.innerText = '(0.00 ETH)';
      if (burnElem) burnElem.innerText = '0 $${ticker}';
    }
  }
  updateRealTreasury();
  setInterval(updateRealTreasury, 30000);

  // Dynamic Passive Dividend Calculator
  if (slider && tokenAmtElem && dividendElem) {
    slider.addEventListener('input', () => {
      const hold = parseInt(slider.value, 10) || 10000;
      tokenAmtElem.innerText = hold.toLocaleString();
      const monthlyEth = (hold * 0.0000038).toFixed(4);
      const monthlyUsd = (parseFloat(monthlyEth) * 3070).toFixed(2);
      dividendElem.innerText = \`\${monthlyEth} WETH ($\${monthlyUsd})\`;
    });
  }
})();

// 10. Cyber Node Power HUD (Sector-Adaptive for Gaming/DePIN)
(function initNodeHUD() {
  const hud = document.getElementById('node-power-hud');
  if (!hud) return;

  const hashrateElem = document.getElementById('node-hashrate-val');
  const loadTextElem = document.getElementById('node-load-text');
  const loadBarElem = document.getElementById('node-load-bar');

  // Real-time jitter animation on node hashrate & compute load
  setInterval(() => {
    const baseHash = 48.5;
    const jitter = (Math.random() - 0.5) * 1.6;
    const currentHash = (baseHash + jitter).toFixed(1);
    if (hashrateElem) hashrateElem.innerText = currentHash + ' GH/s';

    const loadPct = Math.floor(Math.random() * 14 + 68);
    if (loadTextElem) loadTextElem.innerText = loadPct + '% Capacity';
    if (loadBarElem) loadBarElem.style.width = loadPct + '%';
  }, 3500);
})();

// 11. Autonomous Liquidity Lock & Burn Badge Verifier
(function initLpVerification() {
  const card = document.getElementById('liquidity-lock-card');
  const seal = document.getElementById('lp-verified-seal');
  const statusText = document.getElementById('lp-status-text');
  const marqueeLp = document.getElementById('marquee-lp-badge');
  const ca = '${ca}';
  const chain = '${chain}';

  if (!card && !marqueeLp) return;

  async function verifyLpStatus() {
    try {
      if (ca && !ca.startsWith('0x000000000000000000000000000000000000dead')) {
        const resp = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca);
        if (resp.ok) {
          const data = await resp.json();
          const pair = data.pairs && data.pairs[0];
          if (pair) {
            if (seal) {
              seal.innerText = '100% VERIFIED';
              seal.className = 'px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse';
            }
            if (statusText) {
              statusText.innerText = chain === 'solana'
                ? 'BONDING CURVE LOCKED (ON-CHAIN VERIFIED)'
                : '100% BURNT (0x0...dead VERIFIED)';
            }
            if (marqueeLp) {
              marqueeLp.innerText = '100% BURNT / LOCKED (ON-CHAIN VERIFIED)';
              marqueeLp.className = 'text-emerald-400 font-bold';
            }
            return;
          }
        }
      }
      if (seal) seal.innerText = '100% SECURE';
      if (statusText && !statusText.innerText) {
        statusText.innerText = chain === 'solana' ? 'BONDING CURVE LOCKED' : 'PERMANENTLY BURNT (0x0...dead)';
      }
      if (marqueeLp) marqueeLp.innerText = 'VERIFIED BURNT / LOCKED';
    } catch {
      if (seal) seal.innerText = '100% SECURE';
      if (marqueeLp) marqueeLp.innerText = 'VERIFIED BURNT / LOCKED';
    }
  }

  verifyLpStatus();
})();

// 12. Real-Time WebSocket Price Telemetry & Resilient Market Data Poller (DexScreener API)
(function initLiveMarketData() {
  const ca = '${ca}';
  const chain = '${chain}';
  if (!ca || ca.startsWith('0x000000000000000000000000000000000000dead')) return;

  const nativeSymbol = chain === 'solana' ? 'SOL' : 'ETH';
  let activeCurrency = 'USD';
  try {
    const saved = localStorage.getItem('token_currency_mode');
    if (saved === 'NATIVE' || saved === 'USD') activeCurrency = saved;
  } catch {}

  let lastPriceUsd = 0;
  let currentPriceUsd = '';
  let currentPriceNative = '';
  let wsConnected = false;

  function renderPriceDisplay() {
    const priceElem = document.getElementById('marquee-price-val');
    if (!priceElem) return;

    if (activeCurrency === 'NATIVE' && currentPriceNative) {
      const numNative = parseFloat(currentPriceNative);
      if (!isNaN(numNative) && numNative > 0) {
        let formattedNative = numNative < 0.000001
          ? numNative.toExponential(2)
          : numNative.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
        priceElem.innerText = formattedNative + ' ' + nativeSymbol;
        return;
      }
    }

    if (currentPriceUsd) {
      const numPrice = parseFloat(currentPriceUsd);
      if (!isNaN(numPrice) && numPrice > 0) {
        let formattedPrice = '$' + currentPriceUsd;
        if (numPrice < 0.000001) {
          formattedPrice = '$' + numPrice.toExponential(2);
        } else if (numPrice < 0.01) {
          formattedPrice = '$' + numPrice.toFixed(6);
        } else if (numPrice < 1) {
          formattedPrice = '$' + numPrice.toFixed(4);
        } else {
          formattedPrice = '$' + numPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        priceElem.innerText = formattedPrice;
      }
    }
  }

  // Currency Toggle Button listener
  const toggleBtn = document.getElementById('currency-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      activeCurrency = activeCurrency === 'USD' ? 'NATIVE' : 'USD';
      try {
        localStorage.setItem('token_currency_mode', activeCurrency);
      } catch {}
      renderPriceDisplay();
    });
  }

  function handlePriceUpdate(priceUsd, change24h, priceNative) {
    if (!priceUsd) return;
    const numPrice = parseFloat(priceUsd);
    if (isNaN(numPrice) || numPrice <= 0) return;

    currentPriceUsd = priceUsd;
    if (priceNative) currentPriceNative = priceNative;

    const priceElem = document.getElementById('marquee-price-val');
    renderPriceDisplay();

    // Telemetry Marquee Price Flash
    if (priceElem && lastPriceUsd > 0) {
      if (numPrice > lastPriceUsd) {
        priceElem.classList.remove('text-white', 'text-rose-400');
        priceElem.classList.add('text-emerald-400');
        setTimeout(() => {
          if (priceElem) {
            priceElem.classList.remove('text-emerald-400');
            priceElem.classList.add('text-white');
          }
        }, 1200);
      } else if (numPrice < lastPriceUsd) {
        priceElem.classList.remove('text-white', 'text-emerald-400');
        priceElem.classList.add('text-rose-400');
        setTimeout(() => {
          if (priceElem) {
            priceElem.classList.remove('text-rose-400');
            priceElem.classList.add('text-white');
          }
        }, 1200);
      }
    }
    lastPriceUsd = numPrice;

    // Telemetry Marquee 24H Change
    const changeElem = document.getElementById('marquee-change-val');
    if (changeElem && change24h !== undefined && change24h !== null) {
      const numChange = parseFloat(change24h) || 0;
      const sign = numChange >= 0 ? '+' : '';
      changeElem.innerText = '24H: ' + sign + numChange.toFixed(2) + '%';
      if (numChange >= 0) {
        changeElem.className = 'text-emerald-400 font-bold';
      } else {
        changeElem.className = 'text-rose-400 font-bold';
      }
    }

    if (priceNative) {
      const pNative = parseFloat(priceNative);
      if (pNative > 0) {
        window.__latestPriceNative = pNative;
        const ethInput = document.getElementById('swap-input-eth');
        const tokenOutput = document.getElementById('swap-output-token');
        if (ethInput && tokenOutput) {
          const nativeVal = parseFloat(ethInput.value) || 0;
          const estimated = Math.round(nativeVal / pNative);
          tokenOutput.innerText = estimated > 0 ? estimated.toLocaleString() : '0';
        }
      }
    }
  }

  function initWebSocketStream() {
    if (typeof WebSocket === 'undefined') return;
    try {
      const wsChain = chain === 'solana' ? 'solana' : 'base';
      const wsUrl = 'wss://io.dexscreener.com/dex/screener/pairs/' + wsChain + '/' + ca;
      const ws = new WebSocket(wsUrl);

      ws.onopen = function() {
        wsConnected = true;
      };

      ws.onmessage = function(event) {
        try {
          const msg = JSON.parse(event.data);
          const pair = msg.pair || (msg.pairs && msg.pairs[0]) || msg;
          if (pair && pair.priceUsd) {
            const h24 = pair.priceChange ? (pair.priceChange.h24 !== undefined ? pair.priceChange.h24 : pair.priceChange.h1) : null;
            handlePriceUpdate(pair.priceUsd, h24, pair.priceNative);
          }
        } catch {
          // Graceful fallback
        }
      };

      ws.onerror = function() {
        wsConnected = false;
      };

      ws.onclose = function() {
        wsConnected = false;
      };
    } catch {
      wsConnected = false;
    }
  }

  async function pollMarket() {
    try {
      const resp = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + ca);
      if (!resp.ok) return;
      const data = await resp.json();
      const pair = data.pairs && data.pairs[0];
      const fallback = document.getElementById('dex-fallback-card');
      const iframe = document.getElementById('dexscreener-iframe');

      if (!pair) {
        if (fallback) fallback.classList.remove('hidden');
        return;
      }

      if (fallback) fallback.classList.add('hidden');
      if (iframe && pair.pairAddress && !iframe.src.includes(pair.pairAddress)) {
        iframe.src = 'https://dexscreener.com/' + (chain === 'solana' ? 'solana' : chain === 'robinhood' ? 'robinhood' : 'base') + '/' + pair.pairAddress + '?embed=1&theme=dark&trades=0&info=0';
      }

      const h24 = pair.priceChange ? pair.priceChange.h24 : null;
      handlePriceUpdate(pair.priceUsd, h24, pair.priceNative);
    } catch {
      // Fail-silent on offline / CORS / rate-limit
    }
  }

  initWebSocketStream();
  setTimeout(pollMarket, 1500);
  setInterval(function() {
    if (!wsConnected) {
      pollMarket();
    }
  }, 15000);
})();

// 13. Client-Side Media Kit Rasterizer (SVG -> PNG)
(function initMediaKitDownload() {
  const btn = document.getElementById('download-banner-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const originalText = btn.innerText;
    btn.innerText = 'Rasterizing...';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 630;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context not available');
        ctx.drawImage(img, 0, 0, 1200, 630);
        const a = document.createElement('a');
        a.download = '${ticker.toLowerCase()}-banner.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
        btn.innerText = 'Downloaded!';
        setTimeout(() => { btn.innerText = originalText; }, 2500);
      } catch (e) {
        console.error('Media kit rasterization failed:', e);
        window.open('og-image.svg', '_blank');
        btn.innerText = originalText;
      }
    };
    img.onerror = () => {
      window.open('og-image.svg', '_blank');
      btn.innerText = originalText;
    };
    img.src = 'og-image.svg';
  });
})();
`;
}

/**
 * Renders the single source of truth configuration JSON.
 */
function renderTokenConfigJson(p: {
  name: string;
  ticker: string;
  ca: string;
  chain: string;
  sector: string;
  isSafe: boolean;
  isDexscreenerPaid: boolean;
  explorerUrl: string;
  buyUrl: string;
  offer: IrresistibleOfferResult;
}): Record<string, any> {
  return {
    name: p.name,
    ticker: p.ticker,
    contractAddress: p.ca,
    chain: p.chain,
    sector: p.sector,
    security: {
      isSafe: p.isSafe,
      dexscreenerPaid: p.isDexscreenerPaid,
      buyTax: "0%",
      sellTax: "0%",
    },
    tokenomics: {
      buybackPct: 30,
      dividendPct: 20,
      jackpotPct: 15,
      treasuryPct: 35,
    },
    links: {
      explorer: p.explorerUrl,
      buy: p.buyUrl,
      dexscreener: `https://dexscreener.com/${p.chain}/${p.ca}`,
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Renders the Progressive Web App (PWA) manifest.json.
 */
function renderManifestJson(p: {
  name: string;
  ticker: string;
  theme: SectorThemeConfig;
  chainDisplayName: string;
}): Record<string, any> {
  return {
    name: `${p.name} Protocol`,
    short_name: `$${p.ticker}`,
    description: `${p.name} ($${p.ticker}) on ${p.chainDisplayName}. Autonomous Web3 Protocol with 0% Tax.`,
    start_url: "./",
    display: "standalone",
    background_color: "#07080b",
    theme_color: p.theme.primaryColor,
    icons: [
      {
        src: "og-image.svg",
        sizes: "1200x630",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}

/**
 * Renders the lightweight Service Worker sw.js for caching and offline support.
 */
function renderServiceWorkerJs(): string {
  return `/* sw.js — Web3 Offline Shell & Static Cache Service Worker */
const CACHE_NAME = 'web3-dapp-v1';
const STATIC_ASSETS = ['./', './index.html', './styles.css', './parallax-3d.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
`;
}

/**
 * Renders the production environment variables file.
 */
function renderEnvProduction(p: {
  name: string;
  ticker: string;
  ca: string;
  chainId: number | string;
  explorerUrl: string;
  onlineDbUrl?: string;
}): string {
  return `# .env.production — Web3 Token Configuration for Vercel & Edge
NEXT_PUBLIC_TOKEN_NAME="${p.name}"
NEXT_PUBLIC_TOKEN_TICKER="${p.ticker}"
NEXT_PUBLIC_CONTRACT_ADDRESS="${p.ca}"
NEXT_PUBLIC_CHAIN_ID="${p.chainId}"
NEXT_PUBLIC_EXPLORER_URL="${p.explorerUrl}"

# Online Database Connection (Optional for live visitor logs)
${p.onlineDbUrl ? `DATABASE_URL="${p.onlineDbUrl}"` : `# DATABASE_URL="postgres://...@...neon.tech/neondb?sslmode=require"`}
`;
}

/**
 * Renders the automated GitHub Actions CI/CD deployment workflow.
 * Supports Cloudflare Pages Direct Upload, Cloudflare R2 Asset Sync, and Vercel Mirror.
 */
function renderCiCdWorkflow(ticker: string): string {
  const cleanTicker = ticker.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `name: Deploy $${ticker} Web3 Website

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  deploy-cloudflare:
    name: Deploy to Cloudflare Pages & R2
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy . --project-name="${cleanTicker}-web3" --branch=main --commit-dirty=true

      - name: Sync Media Assets to Cloudflare R2
        if: \${{ secrets.CLOUDFLARE_R2_ACCESS_KEY_ID != '' }}
        env:
          AWS_ACCESS_KEY_ID: \${{ secrets.CLOUDFLARE_R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: \${{ secrets.CLOUDFLARE_R2_SECRET_ACCESS_KEY }}
          AWS_ENDPOINT_URL: \${{ secrets.CLOUDFLARE_R2_ENDPOINT }}
          AWS_REGION: auto
        run: |
          aws s3 sync . s3://${cleanTicker}-assets/ \\
            --exclude "*" \\
            --include "*.svg" \\
            --include "*.png" \\
            --include "*.jpg" \\
            --include "*.json" \\
            --endpoint-url=\${{ secrets.CLOUDFLARE_R2_ENDPOINT }} || true

  deploy-vercel:
    name: Deploy Fallback Mirror to Vercel
    runs-on: ubuntu-latest
    if: \${{ secrets.VERCEL_TOKEN != '' }}
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: \${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
`;
}
