#!/usr/bin/env bun
/**
 * scripts/update-token-profiles.ts
 *
 * Universal Token Profile Updater & Ecosystem Synchronizer for DexScreener & GeckoTerminal.
 *
 * Resolves missing social links, greyed-out icons, and the critical "Info: 0"
 * GT Security Score penalty (scoring 24/100) across Base, Solana, Robinhood, Arbitrum, and Arc.
 *
 * Usage:
 *   bun run scripts/update-token-profiles.ts --ticker=PUMPRUN
 *   bun run scripts/update-token-profiles.ts --ca=0x7CE19E4F978009EB644c27946B47221b824C0bA3
 *   bun run scripts/update-token-profiles.ts --all
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { getAllDeployLogs, getDeploymentTelegramBot, type DeployLogRow } from "../src/db/vault.ts";
import {
  buildDexScreenerProfilePayload,
  saveDexScreenerProfileJson,
  submitDexScreenerProfile,
  getDexScreenerUpdatePortalUrl,
} from "../src/modules/growth/dexscreener-profiler.ts";
import {
  buildGeckoTerminalProfilePayload,
  saveGeckoTerminalProfileJson,
  getGeckoTerminalPoolUrl,
  getGeckoTerminalUpdatePortalUrl,
  getExplorerTokenUpdateUrl,
} from "../src/modules/growth/geckoterminal-profiler.ts";
import { logger } from "../src/logger.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

const args = process.argv.slice(2);

function getArg(flag: string, fallback: string = ""): string {
  for (const a of args) {
    if (a.startsWith(`${flag}=`)) {
      return a.slice(flag.length + 1);
    }
  }
  return fallback;
}

const targetTicker = getArg("--ticker", "").toUpperCase().replace(/^\$/, "");
const targetCa = getArg("--ca", "").toLowerCase();
const updateAll = args.includes("--all");

export async function processTokenProfileSync(log: DeployLogRow) {
  const ticker = log.ticker.replace(/^\$/, "").toUpperCase();
  const name = log.tokenName;
  const ca = log.contractAddr;
  const chain = log.chain.toLowerCase();
  const poolId = log.poolId || undefined;

  if (!ca || ca === "n/a" || ca.startsWith("sim_")) {
    logger.warn(`Skipping token $${ticker}: No valid contract address (${ca})`);
    return;
  }

  console.log(`\n${CYAN}----------------------------------------------------------------------------------------${RESET}`);
  console.log(` ${BOLD}PROFILING TOKEN:${RESET} ${GREEN}$${ticker}${RESET} (${name}) | Chain: ${CYAN}${chain.toUpperCase()}${RESET}`);
  console.log(` Contract Address: ${ca}`);
  console.log(` DEX Pool Address: ${poolId || "Will use pair discovery"}`);
  console.log(`${CYAN}----------------------------------------------------------------------------------------${RESET}`);

  // 1. Resolve site directory
  const siteDir = path.resolve(process.cwd(), "sites", ticker.toLowerCase());
  if (!fs.existsSync(siteDir)) {
    fs.mkdirSync(siteDir, { recursive: true });
  }

  // 2. Resolve metadata from site config or vault
  let description = `${name} ($${ticker}) - Autonomous Web3 Protocol on ${chain.toUpperCase()}. Verified 0% trading tax, unruggable liquidity, and community-driven treasury mechanics.`;
  let iconUrl: string | undefined;

  const siteConfigPath = path.join(siteDir, "token.config.json");
  if (fs.existsSync(siteConfigPath)) {
    try {
      const cfgJson = JSON.parse(fs.readFileSync(siteConfigPath, "utf-8"));
      if (cfgJson.description) description = cfgJson.description;
      if (cfgJson.logoUrl) iconUrl = cfgJson.logoUrl;
    } catch {
      /* ignore */
    }
  }

  // 3. Resolve live URLs
  const websiteUrl = log.websiteUrl || `https://${ticker.toLowerCase()}-web3.pages.dev`;
  const botInfo = getDeploymentTelegramBot(ca);
  const telegramBotUsername = log.telegramBotUsername || botInfo?.botUsername;
  const telegramUrl = telegramBotUsername
    ? `https://t.me/${telegramBotUsername.replace(/^@/, "")}`
    : `https://t.me/${ticker.toLowerCase()}_portal`;
  const twitterUrl = `https://x.com/${ticker}_coin`;

  console.log(`  🌐 Website URL  : ${GREEN}${websiteUrl}${RESET}`);
  console.log(`  ✈️  Telegram URL : ${CYAN}${telegramUrl}${RESET}`);
  console.log(`  🐦 Twitter / X  : ${CYAN}${twitterUrl}${RESET}`);

  // 4. Build & Save DexScreener Profile
  const dexPayload = buildDexScreenerProfilePayload({
    chainId: chain,
    tokenAddress: ca,
    tokenName: name,
    tokenSymbol: ticker,
    description,
    iconUrl,
    websiteUrl,
    twitterUrl,
    telegramUrl,
  });

  if (chain === "base" && poolId) {
    dexPayload.links.push({
      type: "docs",
      label: "Bankr Agent",
      url: `https://bankr.bot/agents/${ticker.toLowerCase()}`,
    });
  }

  const dexJsonPath = saveDexScreenerProfileJson(siteDir, dexPayload);
  console.log(`  ✅ DexScreener Pack Saved: ${GRAY}${dexJsonPath}${RESET}`);

  // 5. Build & Save GeckoTerminal Profile
  const gtPayload = buildGeckoTerminalProfilePayload({
    chainId: chain,
    tokenAddress: ca,
    tokenName: name,
    tokenSymbol: ticker,
    poolAddress: poolId,
    description,
    iconUrl,
    websiteUrl,
    twitterUrl,
    telegramUrl,
  });

  const gtJsonPath = saveGeckoTerminalProfileJson(siteDir, gtPayload);
  console.log(`  ✅ GeckoTerminal Pack Saved: ${GRAY}${gtJsonPath}${RESET}`);

  // 6. Submit to DexScreener API with portal fallback
  await submitDexScreenerProfile(
    {
      chainId: chain,
      tokenAddress: ca,
      tokenName: name,
      tokenSymbol: ticker,
      description,
      iconUrl,
      websiteUrl,
      twitterUrl,
      telegramUrl,
    },
    siteDir
  );

  // 7. Output Actionable 1-Click Submission Instructions
  const dexPortalUrl = getDexScreenerUpdatePortalUrl(chain, ca);
  const gtPortalUrl = getGeckoTerminalUpdatePortalUrl();
  const explorerUrl = getExplorerTokenUpdateUrl(chain, ca);
  const gtChartUrl = poolId ? getGeckoTerminalPoolUrl(chain, poolId) : `https://www.geckoterminal.com/${chain}/tokens/${ca}`;
  const dexChartUrl = `https://dexscreener.com/${chain}/${ca}`;

  console.log(`\n${BOLD}========================================================================================${RESET}`);
  console.log(` ${BOLD}[+] PANDUAN PENGAJUAN RESMI UNTUK MENGAKTIFKAN IKON & MEMPERBAIKI 'INFO: 0' [+]${RESET}`);
  console.log(`${BOLD}========================================================================================${RESET}`);
  console.log(` 1. ${BOLD}COINGECKO / GECKOTERMINAL UPDATE (Solusi Skor Keamanan 24/100 -> 80+/100):${RESET}`);
  console.log(`    Tautan Form Resmi : ${CYAN}${gtPortalUrl}${RESET}`);
  console.log(`    GeckoTerminal Live: ${CYAN}${gtChartUrl}${RESET}`);
  console.log(`    File Auto-Fill    : ${GRAY}${path.join(siteDir, "geckoterminal-update-request.txt")}${RESET}`);
  console.log(`    Instruksi: Buka form CoinGecko di atas, pilih 'Update Token Information', lalu`);
  console.log(`    salin isi file 'geckoterminal-update-request.txt' untuk mengisi deskripsi & media sosial.`);
  console.log(``);
  console.log(` 2. ${BOLD}BLOCKCHAIN EXPLORER TOKEN PROFILE (Auto-Sync Gratis ke GeckoTerminal & DexScreener):${RESET}`);
  console.log(`    Tautan Explorer   : ${CYAN}${explorerUrl}${RESET}`);
  console.log(`    Instruksi: Begitu info diverifikasi di Explorer (Basescan/Solscan),`);
  console.log(`    GeckoTerminal dan DexScreener akan mengimpor logo dan sosial secara otomatis!`);
  console.log(``);
  console.log(` 3. ${BOLD}DEXSCREENER TOKEN INFO UPDATE:${RESET}`);
  console.log(`    DexScreener Live  : ${CYAN}${dexChartUrl}${RESET}`);
  console.log(`    Marketplace Portal: ${CYAN}${dexPortalUrl}${RESET}`);
  console.log(`    File Auto-Fill    : ${GRAY}${path.join(siteDir, "dexscreener-fast-track.txt")}${RESET}`);
  console.log(`${BOLD}========================================================================================${RESET}\n`);
}

async function main() {
  console.log(`\n${CYAN}${BOLD}========================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}   [+] UNIVERSAL TOKEN PROFILE SYNCHRONIZER (DEXSCREENER & GECKOTERMINAL) [+]           ${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================================${RESET}`);

  const allLogs = getAllDeployLogs();
  const confirmedLogs = allLogs.filter((l) => l.status === "confirmed" && !l.simulated);

  let targetLogs: DeployLogRow[] = [];

  if (targetTicker) {
    targetLogs = allLogs.filter((l) => l.ticker.toUpperCase() === targetTicker);
    if (targetLogs.length === 0) {
      console.error(`${RED}Token dengan ticker $${targetTicker} tidak ditemukan di vault database!${RESET}`);
      process.exit(1);
    }
  } else if (targetCa) {
    targetLogs = allLogs.filter((l) => l.contractAddr?.toLowerCase() === targetCa);
    if (targetLogs.length === 0) {
      console.error(`${RED}Token dengan CA ${targetCa} tidak ditemukan di vault database!${RESET}`);
      process.exit(1);
    }
  } else if (updateAll) {
    targetLogs = confirmedLogs;
  } else {
    // Default to the most recent confirmed live token (e.g. $PUMPRUN)
    if (confirmedLogs.length > 0) {
      targetLogs = [confirmedLogs[0]];
      console.log(`ℹ️  Tidak ada argumen spesifik. Memproses token live terbaru: ${BOLD}$${targetLogs[0].ticker}${RESET}`);
    } else {
      console.log(`ℹ️  Belum ada token live berstatus confirmed di database.`);
      process.exit(0);
    }
  }

  for (const log of targetLogs) {
    await processTokenProfileSync(log);
  }

  console.log(`${GREEN}${BOLD}✅ Sinkronisasi metadata profil token selesai!${RESET}\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal error in token profile updater: ${err?.message || err}`);
    console.error(err);
    process.exit(1);
  });
}
