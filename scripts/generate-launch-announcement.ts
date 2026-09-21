#!/usr/bin/env bun
/**
 * scripts/generate-launch-announcement.ts
 *
 * Standalone CLI generator for Twitter / X Launch Announcement Pack.
 * Generates both Power Tweet (<= 280 chars) and 3-Tweet Mega Thread.
 *
 * Usage:
 *   bun run scripts/generate-launch-announcement.ts [tickerOrCA]
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../src/logger.ts";
import { getProductionFleet } from "../src/modules/fleet/fleet-registry.ts";
import { getDeployLogWebsite } from "../src/db/vault.ts";
import {
  generateLaunchAnnouncementPack,
  saveLaunchAnnouncementPack,
} from "../src/modules/growth/launch-pack-generator.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => !a.startsWith("-"));

  console.log(`
=================================================================
  [+] TWITTER / X LAUNCH ANNOUNCEMENT PACK GENERATOR [+]
=================================================================
`);

  const fleet = getProductionFleet("base");
  let targetToken: any = null;

  if (targetArg) {
    const cleanArg = targetArg.trim().toUpperCase();
    targetToken =
      fleet.live.find((t) => t.ticker?.toUpperCase() === cleanArg || t.contractAddr?.toLowerCase() === targetArg.toLowerCase()) ||
      fleet.all.find((t) => t.ticker?.toUpperCase() === cleanArg || t.contractAddr?.toLowerCase() === targetArg.toLowerCase());
  }

  if (!targetToken) {
    targetToken = fleet.live[0] || fleet.all[0] || {
      ticker: targetArg ? targetArg.toUpperCase() : "BASECOIN",
      tokenName: targetArg ? `${targetArg} Token` : "Base Coin Protocol",
      contractAddr: "0x1111111111111111111111111111111111111111",
      chain: "base",
    };
  }

  const ticker = targetToken.ticker || "TOKEN";
  const name = targetToken.tokenName || `${ticker} Protocol`;
  const ca = targetToken.contractAddr || "0x1111111111111111111111111111111111111111";
  const chain = (targetToken.chain || "base").toLowerCase();

  let webUrl: string | undefined = undefined;
  try {
    webUrl = getDeployLogWebsite(ca) ?? undefined;
  } catch {}

  const pack = generateLaunchAnnouncementPack({
    ticker,
    name,
    contractAddress: ca,
    chain,
    websiteUrl: webUrl,
  });

  // Save to sites/<ticker> directory
  const sitesDir = path.resolve(process.cwd(), "sites", ticker.toLowerCase());
  const saved = saveLaunchAnnouncementPack(sitesDir, pack);

  // Also save a copy to promotions/ for convenience
  const promoDir = path.resolve(process.cwd(), "promotions");
  if (!fs.existsSync(promoDir)) {
    fs.mkdirSync(promoDir, { recursive: true });
  }
  const promoTxt = path.join(promoDir, `LAUNCH_ANNOUNCEMENT_${ticker}.txt`);
  fs.writeFileSync(promoTxt, pack.fullText, "utf-8");

  console.log(`\n${GREEN}✅ Paket Pengumuman Peluncuran Twitter/X Berhasil Dibuat!${RESET}`);
  console.log(`📁 Berkas Teks: ${CYAN}${saved.txtPath}${RESET}`);
  console.log(`📁 Berkas JSON: ${CYAN}${saved.jsonPath}${RESET}`);
  console.log(`📁 Salinan Promosi: ${GRAY}${promoTxt}${RESET}\n`);

  console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}${CYAN}⚡ OPTION A: SINGLE POWER TWEET (${pack.powerTweet.charCount} Karakter)${RESET}`);
  console.log(`${GRAY}Status: ${pack.powerTweet.fitsSingleTweet ? "✅ Sesuai batas 280 karakter" : "⚠️ Melebihi 280 karakter (Gunakan thread)"}${RESET}`);
  console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(pack.powerTweet.content);
  console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}${CYAN}🧵 OPTION B: FULL 3-TWEET LAUNCH THREAD (Siap Salin per Tweet)${RESET}`);
  console.log(`${BOLD}${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  pack.threadTweets.forEach((t) => {
    console.log(`\n${BOLD}[${t.title} - ${t.charCount} Karakter]${RESET}`);
    console.log(t.content);
    console.log(`${GRAY}-----------------------------------------------------------------${RESET}`);
  });
  console.log(`\n💡 Tip: Seluruh teks di atas tersimpan rapi di: ${saved.txtPath}\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Announcement generator error: ${err?.message || err}`);
    process.exit(1);
  });
}
