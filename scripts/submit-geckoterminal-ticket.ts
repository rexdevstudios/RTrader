#!/usr/bin/env bun
/**
 * scripts/submit-geckoterminal-ticket.ts
 *
 * Fast-Track Helper Pengajuan Profil Resmi GeckoTerminal, CoinGecko, & Basescan.
 *
 * Fungsi:
 *  1. Membaca teks pengajuan resmi dari sites/pumprun/geckoterminal-update-request.txt.
 *  2. Menampilkan ringkasan data siap salin (CA, Website, Telegram, Twitter, Logo).
 *  3. Otomatis membuka tautan formulir tiket resmi di browser:
 *     - CoinGecko / GeckoTerminal Support Form (Gratis)
 *     - Basescan Token Update (Gratis)
 *     - GeckoTerminal Live Chart
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "node:child_process";
import { logger } from "../src/logger.ts";

const COINGECKO_TICKET_URL = "https://support.coingecko.com/hc/en-us/requests/new?ticket_form_id=360000025353";
const BASESCAN_UPDATE_URL  = "https://basescan.org/tokenupdate/0x7CE19E4F978009EB644c27946B47221b824C0bA3";
const GECKOTERMINAL_URL    = "https://www.geckoterminal.com/base/tokens/0x7CE19E4F978009EB644c27946B47221b824C0bA3";

export function openUrlInBrowser(url: string): void {
  const isWindows = process.platform === "win32";
  const cmd = isWindows ? `start "" "${url}"` : `open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      logger.warn(`⚠️  Tidak dapat membuka browser otomatis: ${err.message}`);
    }
  });
}

export async function runGeckoTerminalTicketHelper(options: { openBrowser?: boolean } = {}): Promise<void> {
  const reqFilePath = path.join(process.cwd(), "sites", "pumprun", "geckoterminal-update-request.txt");

  console.log(`
=================================================================
  🚀 FAST-TRACK UPDATE PROFIL RESMI GECKOTERMINAL & BASESCAN
=================================================================
  Token Target  : Pump Hill Runner ($PUMPRUN)
  Contract (CA) : 0x7CE19E4F978009EB644c27946B47221b824C0bA3
  Jaringan      : Base Mainnet (Chain ID: 8453)
  Biaya         : 100% GRATIS (Rp 0 / Tanpa Gas ETH)
=================================================================
`);

  if (fs.existsSync(reqFilePath)) {
    const content = fs.readFileSync(reqFilePath, "utf8");
    console.log(content);
  } else {
    console.log(`
  [DATA FORMULIR SIAP SALIN]
  Token Name    : Pump Hill Runner
  Symbol        : $PUMPRUN
  Chain         : Base
  Contract      : 0x7CE19E4F978009EB644c27946B47221b824C0bA3
  Website       : https://pumprun-web3.pages.dev
  Telegram      : https://t.me/pumprun_portal
  Twitter       : https://x.com/PUMPRUN_coin
    `);
  }

  console.log(`
-----------------------------------------------------------------
  LANGKAH PENGAJUAN (Hanya Butuh ~1 Menit):
-----------------------------------------------------------------
  1. Pada form CoinGecko:
     - Pilih: "Update Token Information (Listing on GeckoTerminal)"
     - Tempelkan Contract Address: 0x7CE19E4F978009EB644c27946B47221b824C0bA3
     - Tempelkan Website & Social Links di atas.
  2. Pada form Basescan:
     - Login akun Basescan (gratis) & submit verifikasi icon.
-----------------------------------------------------------------
`);

  const shouldOpen = options.openBrowser ?? !process.argv.includes("--no-browser");

  if (shouldOpen) {
    logger.info("🌐 [BROWSER] Membuka formulir pengajuan resmi di peramban Anda...");
    openUrlInBrowser(COINGECKO_TICKET_URL);
    openUrlInBrowser(BASESCAN_UPDATE_URL);
    logger.success("✅ Halaman formulir telah dibuka. Silakan salin teks di atas ke formulir.");
  }
}

if (import.meta.main) {
  runGeckoTerminalTicketHelper().catch((err) => {
    logger.error(`❌ Terjadi kesalahan: ${err?.message || err}`);
    process.exit(1);
  });
}
