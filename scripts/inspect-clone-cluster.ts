#!/usr/bin/env bun
/**
 * scripts/inspect-clone-cluster.ts
 *
 * Terminal GUI/CLI Anti-Vamp & Clone Resolver
 * Terinspirasi oleh intelijen Novamp Terminal untuk mendeteksi:
 * 1. Token tiruan dengan huruf Cyrillic/Greek lookalikes (Homoglyphs).
 * 2. Variasi Leetspeak (N0VA vs NOVA).
 * 3. Variasi Suffix / Filler Words (PEANUTCOIN, INU, V2).
 * 4. Status Perang Kloning Pasar (SOLO, CLEAN, CONTESTED, SWARM).
 *
 * Cara Penggunaan:
 *   bun run scripts/inspect-clone-cluster.ts [TICKER]
 *   bun run scripts/inspect-clone-cluster.ts NOVAMP
 *   bun run scripts/inspect-clone-cluster.ts PUMPRUN
 */

import readline from "readline";
import axios from "axios";
import {
  normalizeTokenKey,
  analyzeCloneCluster,
  foldHomoglyphs,
  type CloneClusterAnalysis,
} from "../src/modules/market/clone-resolver.ts";

const DEXSCREENER_SEARCH = "https://api.dexscreener.com/latest/dex/search";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function renderBanner(): void {
  console.log(`
\x1b[1;36m╔═══════════════════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[1;36m║\x1b[0m   \x1b[1;33m[+] ANTI-VAMP CLONE RESOLVER TERMINAL — RADAR INTELIJEN PASAR DEX [+]\x1b[0m         \x1b[1;36m║\x1b[0m
\x1b[1;36m║\x1b[0m   \x1b[90mTerinspirasi oleh Novamp Terminal: Same Name, Multiple Launches, Find Real\x1b[0m      \x1b[1;36m║\x1b[0m
\x1b[1;36m╚═══════════════════════════════════════════════════════════════════════════════════╝\x1b[0m
`);
}

async function inspectTicker(targetTicker: string, targetName?: string): Promise<void> {
  const cleanTicker = targetTicker.trim().toUpperCase();
  console.log(`\x1b[1;34m[*] Mengaudit Ticker Target:\x1b[0m \x1b[1;37m$${cleanTicker}\x1b[0m ${targetName ? `("${targetName}")` : ""}`);

  // 1. Audit Kunci Normalisasi
  const normKey = normalizeTokenKey(cleanTicker, targetName);
  console.log(`\n\x1b[1m[1] AUDIT KANONIKAL & DETEKSI HOMOGLIF\x1b[0m`);
  console.log(`  • Raw Ticker  : ${normKey.rawTicker}`);
  console.log(`  • Tight Key   : ${normKey.tightKey}`);
  console.log(`  • Loose Key   : ${normKey.looseKey}`);
  if (normKey.hasHomoglyphs) {
    console.log(`  • \x1b[1;31m🚨 PERINGATAN HOMOGLIF\x1b[0m: Ticker ini mengandung karakter lookalike non-Latin: [\x1b[1;33m${normKey.detectedHomoglyphs.join(", ")}\x1b[0m]!`);
  } else {
    console.log(`  • Status Huruf: \x1b[1;32m✓ 100% Karakter Latin ASCII Murni\x1b[0m`);
  }

  // 2. Query Live DexScreener API
  console.log(`\n\x1b[1m[2] MEMINDAI PASAR LIVE DEXSCREENER...\x1b[0m`);
  try {
    const response = await axios.get<{ pairs?: any[] }>(DEXSCREENER_SEARCH, {
      params: { q: cleanTicker },
      timeout: 12000,
    });

    const rawPairs = response.data.pairs ?? [];
    console.log(`  • Mengambil ${rawPairs.length} pasangan likuiditas (pools) terkait dari DexScreener.`);

    const analysis: CloneClusterAnalysis = analyzeCloneCluster(
      cleanTicker,
      targetName,
      rawPairs
    );

    // 3. Render Status Klaster
    console.log(`\n\x1b[1m[3] HASIL ANALISIS KLASTER KELONING (CLONE WAR MATRIX)\x1b[0m`);
    let badge = "";
    if (analysis.clusterStatus === "SOLO") {
      badge = "\x1b[1;32m[SOLO - 100% UNIK]\x1b[0m";
    } else if (analysis.clusterStatus === "CLEAN") {
      badge = "\x1b[1;32m[CLEAN - AMAN]\x1b[0m";
    } else if (analysis.clusterStatus === "CONTESTED") {
      badge = "\x1b[1;33m[CONTESTED - DIPEREBUTKAN]\x1b[0m";
    } else {
      badge = "\x1b[1;31m[SWARM - PERANG KLON / FARM]\x1b[0m";
    }

    console.log(`  • Status Klaster   : ${badge}`);
    console.log(`  • Total Terdeteksi : \x1b[1;37m${analysis.totalObserved}\x1b[0m token serupa/klon`);
    console.log(`  • Exact Matches    : ${analysis.exactCount}`);
    console.log(`  • Lookalikes/Suffix: ${analysis.lookalikeCount}`);
    console.log(`  • Homoglyphs       : ${analysis.homoglyphCount > 0 ? `\x1b[1;31m${analysis.homoglyphCount} token palsu\x1b[0m` : "0"}`);
    console.log(`  • Ringkasan        : ${analysis.summaryNote}`);

    // 4. Tabel Daftar Token Terdeteksi
    if (analysis.matches.length > 0) {
      console.log(`\n\x1b[1m[4] RINCIAN PASANGAN TOKEN DI PASAR (TOP 10):\x1b[0m`);
      console.log(`  ┌────┬──────────────┬──────────────┬────────────────┬───────────────────────────┐`);
      console.log(`  │ No │ Simbol       │ Chain        │ Tipe Kecocokan │ Waktu Dibuat              │`);
      console.log(`  ├────┼──────────────┼──────────────┼────────────────┼───────────────────────────┤`);

      analysis.matches.slice(0, 10).forEach((m, idx) => {
        const numStr = String(idx + 1).padStart(2);
        const symStr = m.symbol.padEnd(12).slice(0, 12);
        const chainStr = m.chain.padEnd(12).slice(0, 12);
        let matchLabel = m.matchType.toUpperCase();
        if (m.matchType === "exact") matchLabel = "\x1b[32mEXACT\x1b[0m       ";
        else if (m.matchType === "homoglyph") matchLabel = "\x1b[31mHOMOGLYPH\x1b[0m   ";
        else if (m.matchType === "leetspeak") matchLabel = "\x1b[33mLEETSPEAK\x1b[0m   ";
        else if (m.matchType === "filler_variant") matchLabel = "\x1b[35mSUFFIX/INU\x1b[0m  ";
        else matchLabel = "VARIANT     ";

        const timeStr = m.createdAt
          ? new Date(m.createdAt).toISOString().replace("T", " ").slice(0, 19)
          : "N/A                ";

        console.log(`  │ ${numStr} │ ${symStr} │ ${chainStr} │ ${matchLabel} │ ${timeStr} │`);
      });
      console.log(`  └────┴──────────────┴──────────────┴────────────────┴───────────────────────────┘`);
    }

    // 5. Rekomendasi Eksekusi
    console.log(`\n\x1b[1m[5] REKOMENDASI KEPUTUSAN OPERATOR:\x1b[0m`);
    if (analysis.clusterStatus === "SOLO" || analysis.clusterStatus === "CLEAN") {
      console.log(`  \x1b[1;32m[+] SIAP DEPLOY / BELI:\x1b[0m Ticker $${cleanTicker} bebas dari clone war. Peluncuran atau catalyst buy aman dieksekusi.`);
    } else if (analysis.clusterStatus === "CONTESTED") {
      console.log(`  \x1b[1;33m[!] HATI-HATI:\x1b[0m Ticker $${cleanTicker} sedang diperebutkan di beberapa DEX. Pastikan kontrak address (CA) yang Anda beli adalah yang pertama terdaftar dan likuiditasnya sah.`);
    } else {
      console.log(`  \x1b[1;31m[!] BAHAYA / BATALKAN:\x1b[0m $${cleanTicker} sedang mengalami SWARM clone war. Jangan meluncurkan token baru dengan ticker ini untuk menghindari tertutup oleh kebisingan klon.`);
    }

  } catch (err: any) {
    console.error(`\x1b[1;31m[!] Gagal memindai DexScreener:\x1b[0m ${err?.message || err}`);
  }

  console.log(`\n\x1b[90m===================================================================================\x1b[0m\n`);
}

async function main(): Promise<void> {
  renderBanner();

  let target = process.argv[2];
  if (!target) {
    target = await prompt("Masukkan Ticker atau Nama Token yang ingin diaudit (contoh: PUMPRUN / NOVAMP): ");
  }

  if (!target) {
    console.log("Tidak ada ticker yang dimasukkan. Keluar.");
    process.exit(0);
  }

  await inspectTicker(target);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
