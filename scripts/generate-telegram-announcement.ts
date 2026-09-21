#!/usr/bin/env bun
/**
 * scripts/generate-telegram-announcement.ts
 *
 * Standalone CLI generator for Telegram Post-Launch Blitz Announcement Pack.
 * Generates HTML Card, MarkdownV2 Card, 1-Click Share Web Deep Link, and Inline Keyboard.
 *
 * Usage:
 *   bun run scripts/generate-telegram-announcement.ts [tickerOrCA] [--send]
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
import { broadcastTokenLaunchAnnouncement } from "../src/modules/social/beacon-broadcaster.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

async function main() {
  const args = process.argv.slice(2);
  const isSendFlag = args.includes("--send");
  const targetArg = args.find((a) => !a.startsWith("-"));

  console.log(`
=================================================================
  [+] TELEGRAM POST-LAUNCH BLITZ ANNOUNCEMENT PACK [+]
=================================================================
`);

  const fleet = getProductionFleet("base");
  let targetToken: any = null;

  if (targetArg) {
    const cleanArg = targetArg.trim().toUpperCase();
    targetToken =
      fleet.live.find(
        (t) =>
          t.ticker?.toUpperCase() === cleanArg ||
          t.contractAddr?.toLowerCase() === targetArg.toLowerCase()
      ) ||
      fleet.all.find(
        (t) =>
          t.ticker?.toUpperCase() === cleanArg ||
          t.contractAddr?.toLowerCase() === targetArg.toLowerCase()
      );
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

  // Save files to sites/<ticker>/ and promotions/
  const sitesDir = path.resolve(process.cwd(), "sites", ticker.toLowerCase());
  const saved = saveLaunchAnnouncementPack(sitesDir, pack);

  console.log(`\n${GREEN}✅ Paket Pengumuman Peluncuran Telegram Berhasil Dibuat!${RESET}`);
  console.log(`📁 Berkas Teks Telegram: ${CYAN}${saved.telegramTxtPath}${RESET}`);
  console.log(`📁 Berkas JSON Telegram: ${CYAN}${saved.telegramJsonPath}${RESET}`);
  console.log(`📁 Berkas Omnichannel:   ${GRAY}${saved.txtPath}${RESET}\n`);

  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}${CYAN}📱 FORMAT 1: HTML RICH MESSAGE (Untuk Pesan Bot / Copy ke Telegram Desktop)${RESET}`);
  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(pack.telegram.htmlCard);
  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}${CYAN}🔗 FORMAT 2: 1-CLICK SHARE WEB DEEP-LINK${RESET}`);
  console.log(`${GRAY}Buka tautan ini di browser/ponsel untuk langsung membuka dialog berbagi Telegram:${RESET}`);
  console.log(`${BOLD}${YELLOW}${pack.telegram.shareDeepLink}${RESET}`);
  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}${CYAN}🔘 FORMAT 3: INLINE KEYBOARD BUTTONS (JSON Matrix)${RESET}`);
  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(JSON.stringify(pack.telegram.inlineKeyboard, null, 2));
  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  if (isSendFlag) {
    console.log(`${CYAN}📢 Memulai siaran langsung ke grup/channel Telegram terkonfigurasi...${RESET}`);
    const bcast = await broadcastTokenLaunchAnnouncement({
      ticker,
      name,
      contractAddress: ca,
      chain,
      dexScreenerUrl: pack.metadata.dexScreenerUrl,
      uniswapUrl: pack.metadata.uniswapUrl,
    });
    if (bcast.telegramSent) {
      console.log(`${GREEN}✅ Pengumuman peluncuran berhasil disiarkan ke Telegram!${RESET}`);
    } else {
      console.log(`${YELLOW}ℹ️  Catatan: Pesan tidak dikirim via API (${bcast.error || "Kredensial TELEGRAM_BOT_TOKEN/CHANNEL belum disetel"}). Silakan copy teks di atas.${RESET}`);
    }
  } else {
    console.log(`💡 Tip: Anda dapat menyiarkan langsung via bot dengan menambahkan argumen --send:\n   ${GRAY}bun run scripts/generate-telegram-announcement.ts ${ticker} --send${RESET}\n`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Telegram announcement generator error: ${err?.message || err}`);
    process.exit(1);
  });
}
