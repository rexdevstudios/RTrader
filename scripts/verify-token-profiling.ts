#!/usr/bin/env bun
/**
 * scripts/verify-token-profiling.ts
 *
 * Real-Time Token Profiling Validator & Fast-Track Submission Diagnostic Engine.
 *
 * Fitur:
 *  1. Health-check ketersediaan URL publik (DApp Web3, Telegram, Twitter, Logo).
 *  2. Query langsung ke API GeckoTerminal & DexScreener untuk memeriksa status indeks profil sosial.
 *  3. Menyajikan 1-klik formulir tiket pengajuan resmi CoinGecko & Basescan token update.
 *
 * Penggunaan CLI:
 *   bun run scripts/verify-token-profiling.ts
 *   bun run scripts/verify-token-profiling.ts 0x7CE19E4F978009EB644c27946B47221b824C0bA3
 */

import * as dotenv from "dotenv";
dotenv.config();

import { logger } from "../src/logger.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

export interface AssetHealthCheckResult {
  name: string;
  url: string;
  status: "OK" | "UNREACHABLE" | "REDIRECT";
  httpCode?: number;
  latencyMs: number;
}

export interface ProfilingStatusReport {
  tokenCa: string;
  tokenSymbol: string;
  chain: string;
  assets: AssetHealthCheckResult[];
  geckoTerminal: {
    isIndexed: boolean;
    poolName?: string;
    hasWebsite: boolean;
    hasTelegram: boolean;
    hasTwitter: boolean;
    gtScore?: number;
    infoPenaltyResolved: boolean;
  };
  dexScreener: {
    isIndexed: boolean;
    pairCount: number;
    hasSocials: boolean;
    hasWebsite: boolean;
  };
  actionsNeeded: string[];
}

export async function checkUrlHealth(name: string, url: string): Promise<AssetHealthCheckResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const latencyMs = Date.now() - start;
    const httpCode = res.status;
    if (httpCode >= 200 && httpCode < 300) {
      return { name, url, status: "OK", httpCode, latencyMs };
    }
    if (httpCode >= 300 && httpCode < 400) {
      return { name, url, status: "REDIRECT", httpCode, latencyMs };
    }
    return { name, url, status: "UNREACHABLE", httpCode, latencyMs };
  } catch {
    return { name, url, status: "UNREACHABLE", latencyMs: Date.now() - start };
  }
}

export async function queryGeckoTerminalProfile(ca: string): Promise<{
  isIndexed: boolean;
  poolName?: string;
  hasWebsite: boolean;
  hasTelegram: boolean;
  hasTwitter: boolean;
  gtScore?: number;
  infoPenaltyResolved: boolean;
}> {
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/base/tokens/${ca.toLowerCase()}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json;version=20230302" },
      }
    );
    if (!res.ok) {
      return {
        isIndexed: false,
        hasWebsite: false,
        hasTelegram: false,
        hasTwitter: false,
        infoPenaltyResolved: false,
      };
    }
    const data = (await res.json()) as any;
    const attrs = data?.data?.attributes;
    if (!attrs) {
      return {
        isIndexed: false,
        hasWebsite: false,
        hasTelegram: false,
        hasTwitter: false,
        infoPenaltyResolved: false,
      };
    }

    const hasWebsite = Boolean(attrs.websites && attrs.websites.length > 0);
    const hasTelegram = Boolean(attrs.telegram_handle);
    const hasTwitter = Boolean(attrs.twitter_handle);
    const gtScore = attrs.gt_score;
    const infoPenaltyResolved = hasWebsite && (hasTelegram || hasTwitter);

    return {
      isIndexed: true,
      poolName: attrs.name,
      hasWebsite,
      hasTelegram,
      hasTwitter,
      gtScore,
      infoPenaltyResolved,
    };
  } catch {
    return {
      isIndexed: false,
      hasWebsite: false,
      hasTelegram: false,
      hasTwitter: false,
      infoPenaltyResolved: false,
    };
  }
}

export async function queryDexScreenerProfile(ca: string): Promise<{
  isIndexed: boolean;
  pairCount: number;
  hasSocials: boolean;
  hasWebsite: boolean;
}> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${ca.toLowerCase()}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) {
      return { isIndexed: false, pairCount: 0, hasSocials: false, hasWebsite: false };
    }
    const data = (await res.json()) as any;
    const pairs = data?.pairs || [];
    if (pairs.length === 0) {
      return { isIndexed: false, pairCount: 0, hasSocials: false, hasWebsite: false };
    }

    const firstPair = pairs[0];
    const info = firstPair?.info;
    const hasWebsite = Boolean(info?.websites && info.websites.length > 0);
    const hasSocials = Boolean(info?.socials && info.socials.length > 0);

    return {
      isIndexed: true,
      pairCount: pairs.length,
      hasSocials,
      hasWebsite,
    };
  } catch {
    return { isIndexed: false, pairCount: 0, hasSocials: false, hasWebsite: false };
  }
}

export async function verifyTokenProfiling(
  customCa?: string,
  customSymbol = "PUMPRUN"
): Promise<ProfilingStatusReport> {
  const tokenCa = customCa || "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
  const chain = "base";

  // 1. Health check assets
  const assetChecks = await Promise.all([
    checkUrlHealth("DApp Web3 Landing", "https://pumprun-web3.pages.dev"),
    checkUrlHealth("Telegram Community", "https://t.me/pumprun_portal"),
    checkUrlHealth("Twitter / X Profile", "https://x.com/PUMPRUN_coin"),
    checkUrlHealth(
      "Logo Artwork (Pollinations)",
      "https://image.pollinations.ai/prompt/Pump%20Hill%20Runner%20crypto%20token%20logo?width=512&height=512&nologo=true"
    ),
  ]);

  // 2. Query external APIs in parallel
  const [gecko, dex] = await Promise.all([
    queryGeckoTerminalProfile(tokenCa),
    queryDexScreenerProfile(tokenCa),
  ]);

  const actionsNeeded: string[] = [];
  if (!gecko.infoPenaltyResolved) {
    actionsNeeded.push(
      "Kirim tiket formulir resmi CoinGecko/GeckoTerminal untuk menghapus penalti 'Info: 0'."
    );
  }
  if (!dex.hasSocials || !dex.hasWebsite) {
    actionsNeeded.push(
      "Perbarui profil di DexScreener Enhanced Profile Portal untuk mengaktifkan ikon sosial."
    );
  }
  actionsNeeded.push(
    "Ajukan permohonan token update di Basescan untuk sinkronisasi otomatis logo & website."
  );

  return {
    tokenCa,
    tokenSymbol: customSymbol,
    chain,
    assets: assetChecks,
    geckoTerminal: gecko,
    dexScreener: dex,
    actionsNeeded,
  };
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}    [+] DIAGNOSTIK PROFILING TOKEN REAL-TIME (GECKOTERMINAL & DEXSCREENER) [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  const args = process.argv.slice(2);
  const targetCa = args.find((a) => a.startsWith("0x")) || "0x7CE19E4F978009EB644c27946B47221b824C0bA3";

  console.log(`${CYAN}[INFO] Memverifikasi status aset publik dan indexing API untuk ${targetCa}...${RESET}\n`);

  const report = await verifyTokenProfiling(targetCa);

  console.log(`${BOLD}1. KETERSEDIAAN ASET PUBLIK (HEALTH-CHECK):${RESET}`);
  console.log(`─────────────────────────────────────────────────────────────────────────────`);
  for (const a of report.assets) {
    const badge = a.status === "OK" ? `${GREEN}[ONLINE ${a.httpCode}]${RESET}` : `${RED}[${a.status}]${RESET}`;
    console.log(`  ${badge.padEnd(16)} ${BOLD}${a.name}${RESET} (${a.latencyMs}ms)`);
    console.log(`  ${GRAY}-> ${a.url}${RESET}`);
  }

  console.log(`\n${BOLD}2. STATUS INDEXING API GECKOTERMINAL:${RESET}`);
  console.log(`─────────────────────────────────────────────────────────────────────────────`);
  console.log(`  • Terdaftar di GeckoTerminal : ${report.geckoTerminal.isIndexed ? `${GREEN}✅ YA (Pool Aktif)${RESET}` : `${RED}❌ BELUM${RESET}`}`);
  console.log(`  • Website Terindeks          : ${report.geckoTerminal.hasWebsite ? `${GREEN}✅ ADA${RESET}` : `${YELLOW}⚠️  KOSONG (Perlu Pengajuan)${RESET}`}`);
  console.log(`  • Telegram / Twitter         : ${report.geckoTerminal.hasTelegram || report.geckoTerminal.hasTwitter ? `${GREEN}✅ ADA${RESET}` : `${YELLOW}⚠️  KOSONG (Penalti 'Info: 0')${RESET}`}`);
  console.log(`  • Status Penalti "Info: 0"   : ${report.geckoTerminal.infoPenaltyResolved ? `${GREEN}✅ TUNTAS${RESET}` : `${RED}⚠️  AKTIF (Skor GT dibatasi 24/100)${RESET}`}`);

  console.log(`\n${BOLD}3. STATUS INDEXING API DEXSCREENER:${RESET}`);
  console.log(`─────────────────────────────────────────────────────────────────────────────`);
  console.log(`  • Pasangan Pool Terindeks    : ${report.dexScreener.isIndexed ? `${GREEN}✅ YA (${report.dexScreener.pairCount} pair)${RESET}` : `${RED}❌ BELUM${RESET}`}`);
  console.log(`  • Ikon & Link Sosial         : ${report.dexScreener.hasSocials ? `${GREEN}✅ TERPASANG${RESET}` : `${YELLOW}⚠️  BELUM DIKLAIM (Enhanced Profile)${RESET}`}`);

  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  [+] AKSI 1-KLIK UNTUK MENDONGKRAK SKOR KEPERCAYAAN TOKEN KE 85-95/100 [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}`);

  console.log(`\n${BOLD}Langkah 1: Pengajuan Formulir Resmi CoinGecko / GeckoTerminal (Gratis ~1 Menit)${RESET}`);
  console.log(`  Buka URL  : ${CYAN}https://support.coingecko.com/hc/en-us/requests/new?ticket_form_id=360000025353${RESET}`);
  console.log(`  Data Isi  : Salin teks lengkap dari ${BOLD}sites/pumprun/geckoterminal-update-request.txt${RESET}`);

  console.log(`\n${BOLD}Langkah 2: Token Profile Update di Basescan (Auto-Sync Gratis)${RESET}`);
  console.log(`  Buka URL  : ${CYAN}https://basescan.org/tokenupdate/${report.tokenCa}${RESET}`);
  console.log(`  Data Isi  : Masukkan website ${BOLD}https://pumprun-web3.pages.dev${RESET} dan logo SVG`);

  console.log(`\n${BOLD}Langkah 3: Pembaruan Profil di DexScreener${RESET}`);
  console.log(`  Buka URL  : ${CYAN}https://dexscreener.com/base/${report.tokenCa}${RESET}`);
  console.log(`  Klik tombol ${BOLD}"Update Token Info"${RESET} di halaman grafik token.\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`[ERROR] Verifikasi profil gagal: ${err?.message || err}`);
    process.exit(1);
  });
}
