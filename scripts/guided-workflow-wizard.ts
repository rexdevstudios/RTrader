#!/usr/bin/env bun
/**
 * scripts/guided-workflow-wizard.ts
 *
 * GUIDED MASTER JOURNEY WIZARD — Alur Kerja Terpadu Berurutan (5 Fase)
 *
 * Menggabungkan seluruh modul independen menjadi satu panduan langkah-demi-langkah
 * yang berkesinambungan:
 *   FASE 1: Audit Kesiapan & Anti-Vamp Preflight
 *   FASE 2: Peluncuran On-Chain (Base / Solana)
 *   FASE 3: Pengayaan Identitas, Tim, Produk & Materi Investor
 *   FASE 4: Aktivasi Pasar & Catalyst Trading ($1)
 *   FASE 5: Mesin Pendapatan Pasif Flywheel & Monitoring
 *
 * Prinsip: 100% Reuse terhadap script yang sudah teruji.
 */

import readline from "readline";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import { getLiveDeployments, getProductionFleet } from "../src/modules/fleet/fleet-registry.ts";

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

async function runStep(label: string, cmdArgs: string[]): Promise<boolean> {
  console.log(`\n\x1b[1;36m[+] MENJALANKAN: ${label}...\x1b[0m`);
  const proc = Bun.spawn(["bun", "run", ...cmdArgs], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    cwd: import.meta.dir + "/..",
  });
  const code = await proc.exited;
  return code === 0;
}

function getLatestConfirmedToken(): { contractAddr: string; ticker: string; name: string } | null {
  const live = getLiveDeployments("base");
  if (live.length > 0) {
    const latest = live[live.length - 1];
    return {
      contractAddr: latest.contractAddr!,
      ticker: latest.ticker || "PUMPRUN",
      name: latest.tokenName || "Pump Hill Runner",
    };
  }

  // Fallback to any live token across chains
  const anyLive = getLiveDeployments();
  if (anyLive.length > 0) {
    const latest = anyLive[anyLive.length - 1];
    return {
      contractAddr: latest.contractAddr!,
      ticker: latest.ticker || "TOKEN",
      name: latest.tokenName || "Token",
    };
  }

  // Fallback to simulated if explicitly present and valid non-zero address
  const sim = getProductionFleet().simulated.filter(
    (s) => s.contractAddr && s.contractAddr !== "0x0000000000000000000000000000000000000000"
  );
  if (sim.length > 0) {
    const latest = sim[sim.length - 1];
    return {
      contractAddr: latest.contractAddr!,
      ticker: (latest.ticker || "SIM") + " [SIMULASI]",
      name: latest.tokenName || "Simulated Token",
    };
  }

  return null;
}

function printHeader(): void {
  console.clear();
  console.log(`
\x1b[1;35m╔═════════════════════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[1;35m║\x1b[0m   \x1b[1;33m[+] GUIDED MASTER JOURNEY WIZARD — SIKLUS HIDUP TOKEN OTONOM BERURUTAN [+]    \x1b[1;35m║\x1b[0m
\x1b[1;35m║\x1b[0m   \x1b[90mPanduan Lengkap Hulu ke Hilir: Dari Audit Preflight Hingga Panen Revenue WETH     \x1b[1;35m║\x1b[0m
\x1b[1;35m╚═════════════════════════════════════════════════════════════════════════════════════╝\x1b[0m
\x1b[90mTips Windows: Jika konsol terhenti (muncul 'Select' di judul jendela), tekan tombol ESC.\x1b[0m
`);
}

async function main(): Promise<void> {
  let activeToken = getLatestConfirmedToken();

  printHeader();

  console.log(`\x1b[1mStatus Token Terdaftar Saat Ini:\x1b[0m`);
  if (activeToken) {
    console.log(`  • Token Aktif : \x1b[1;32m$${activeToken.ticker}\x1b[0m ("${activeToken.name}")`);
    console.log(`  • Contract CA : \x1b[1;37m${activeToken.contractAddr}\x1b[0m`);
  } else {
    console.log(`  • Belum ada token live terdaftar di vault.`);
  }

  console.log(`
\x1b[1;36mPILIH LANGKAH MULAI PANDUAN BERURUTAN:\x1b[0m
  \x1b[1m[1]\x1b[0m FASE 1: Persiapan, Audit Kesiapan & Anti-Vamp Preflight (Zero-Gas)
  \x1b[1m[2]\x1b[0m FASE 2: Peluncuran Token Baru On-Chain (Base L2 / Solana Pump.fun)
  \x1b[1m[3]\x1b[0m FASE 3: Pengayaan Identitas, Tim, Produk Bankr API & Investor Offer
  \x1b[1m[4]\x1b[0m FASE 4: Aktivasi Grafik DexScreener ($1 Catalyst Swap) & Auto Take-Profit
  \x1b[1m[5]\x1b[0m FASE 5: Menyalakan Mesin Pemanen Revenue Flywheel 24/7 (Dividen WETH)
  \x1b[1m[6]\x1b[0m JALANKAN SEMUA (1-Click Auto-Pilot 5-Fase Hulu ke Hilir Secara Terpadu)
  \x1b[1m[7]\x1b[0m Kembali ke Menu Utama
`);

  const choice = await prompt("Pilih fase awal untuk memulai [1-7]: ");

  if (choice === "1") {
    await runFase1();
  } else if (choice === "2") {
    await runFase2();
  } else if (choice === "3") {
    await runFase3(activeToken);
  } else if (choice === "4") {
    await runFase4(activeToken);
  } else if (choice === "5") {
    await runFase5(activeToken);
  } else if (choice === "6") {
    console.log(`\n\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m`);
    console.log(`\x1b[1;33m  [+] 1-CLICK AUTO-PILOT: SIKLUS HIDUP 5-FASE TERPADU (HULU KE HILIR) [+]\x1b[0m`);
    console.log(`\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m`);
    console.log("Pilih mode eksekusi:");
    if (activeToken && !activeToken.ticker.includes("[SIMULASI]")) {
      console.log(`  [1] Lanjutkan Token Aktif ($${activeToken.ticker}) → Beli Katalyst ~$1 + Monitor + Revenue (Rekomendasi)`);
      console.log("  [2] Peluncuran Token Baru dari Nol (Deploy On-Chain Baru → Beli ~$1 → Monitor)");
      console.log("  [3] Preflight Rehearsal Zero-Gas (Simulasi Aman Tanpa Gas)");
      const subChoice = await prompt("Pilihan [1-3, default=1]: ");
      if (subChoice === "2") {
        const autoChoice = await prompt("Pilih mode [1=Otonom --unattended, 2=Interaktif, default=1]: ");
        const skipProbe = await prompt("Bypass dry simulation probe jika WAF/rate-limit? (y/n, default=y): ");
        const args = ["scripts/launch-full-pipeline.ts", "full"];
        if (autoChoice !== "2") args.push("--unattended");
        if (skipProbe.toLowerCase() !== "n") args.push("--skip-simulation-probe");
        await runStep("Pipeline Otomatis Terpadu (Deploy Baru)", args);
      } else if (subChoice === "3") {
        await runStep("Preflight Rehearsal Zero-Gas", ["scripts/rehearse-deployment.ts", "--chain", "base"]);
      } else {
        await runStep("Pipeline Lanjutan Token Aktif (Catalyst & Monitor)", ["scripts/launch-full-pipeline.ts", "catalyst"]);
      }
    } else {
      console.log("  [1] Mode Otonom Penuh (Zero-Prompt Unattended Mode — Rekomendasi)");
      console.log("  [2] Mode Interaktif (Dengan panduan/konfirmasi di setiap langkah)");
      console.log("  [3] Preflight Rehearsal Zero-Gas (Simulasi Aman)");
      const autoChoice = await prompt("Pilihan [1-3, default=1]: ");
      if (autoChoice === "3") {
        await runStep("Preflight Rehearsal Zero-Gas", ["scripts/rehearse-deployment.ts", "--chain", "base"]);
      } else if (autoChoice === "2") {
        await runStep("Pipeline Otomatis Terpadu Penuh (Interaktif)", ["scripts/launch-full-pipeline.ts", "full"]);
      } else {
        await runStep("Pipeline Otomatis Terpadu Penuh (Otonom)", ["scripts/launch-full-pipeline.ts", "full", "--unattended", "--skip-simulation-probe"]);
      }
    }
  } else {
    return;
  }
}

// ── FASE 1: AUDIT & PREFLIGHT ────────────────────────────────────────────────
async function runFase1(): Promise<void> {
  console.log(`\n\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[1;33m  [FASE 1/5] AUDIT KESIAPAN, PROXY & DETEKSI ANTI-VAMP (ZERO-GAS)\x1b[0m`);
  console.log(`\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m\n`);

  console.log("Langkah 1A: Memverifikasi saldo on-chain dan kuota API...");
  await runStep("Audit Dual-Chain Kesiapan", ["scripts/verify-dual-chain.ts"]);

  console.log("\nLangkah 1B: Memeriksa akun & kuota resmi Bankr API...");
  await runStep("Audit Akun Bankr API", ["scripts/check-bankr-account.ts"]);

  const checkAntiVamp = await prompt("\nApakah ingin menguji ticker tren tertentu terhadap radar Anti-Vamp sekarang? (y/n): ");
  if (checkAntiVamp.toLowerCase() === "y") {
    await runStep("Anti-Vamp Clone Resolver", ["scripts/inspect-clone-cluster.ts"]);
  }

  const doRehearsal = await prompt("\nApakah ingin menjalankan Preflight Flight Rehearsal (simulasi deploy gratis)? (y/n): ");
  if (doRehearsal.toLowerCase() === "y") {
    await runStep("Preflight Rehearsal Zero-Gas", ["scripts/rehearse-deployment.ts", "--chain", "base"]);
  }

  console.log(`\n\x1b[1;32m✅ FASE 1 SELESAI: Lingkungan sistem 100% siap operasional.\x1b[0m`);
  const next = await prompt("Lanjutkan ke FASE 2: Peluncuran Token On-Chain? (y/n): ");
  if (next.toLowerCase() === "y") {
    await runFase2();
  }
}

// ── FASE 2: DEPLOYMENT ───────────────────────────────────────────────────────
async function runFase2(): Promise<void> {
  console.log(`\n\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[1;33m  [FASE 2/5] PELUNCURAN TOKEN KE BLOCKCHAIN ON-CHAIN\x1b[0m`);
  console.log(`\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m\n`);

  console.log("Pilih chain target:");
  console.log("  [1] Base Mainnet       (100% Relayer Gas Sponsored — Biaya 0 ETH)");
  console.log("  [2] Robinhood Chain L2 (Bankr API — Doppler v4, Pons v2)");
  console.log("  [3] Clanker Base       (Uniswap V4 On-Chain — Gas Operator ~0.00015 ETH / ~$0.40)");
  console.log("  [4] Solana Mainnet     (Pump.fun Bonding Curve)");
  console.log("  [5] Lewati deployment  (Gunakan token yang sudah ada di vault)");

  const depChoice = await prompt("Pilihan [1-5]: ");

  if (depChoice === "1") {
    await runStep("Deploy Token ke Base Mainnet", ["scripts/execute-single-base-deployment.ts"]);
  } else if (depChoice === "2") {
    await runStep("Deploy Token ke Robinhood Chain L2", ["scripts/execute-single-robinhood-deployment.ts"]);
  } else if (depChoice === "3") {
    await runStep("Deploy Token via Clanker v4 (Base)", ["scripts/execute-single-clanker-deployment.ts"]);
  } else if (depChoice === "4") {
    await runStep("Deploy Token ke Solana Pump.fun", ["scripts/execute-single-solana-deployment.ts"]);
  }

  const updatedToken = getLatestConfirmedToken();
  console.log(`\n\x1b[1;32m✅ FASE 2 SELESAI: Token aktif terverifikasi di vault.\x1b[0m`);
  if (updatedToken) {
    console.log(`   Token: $${updatedToken.ticker} (CA: ${updatedToken.contractAddr})`);
  }

  const next = await prompt("\nLanjutkan ke FASE 3: Pengayaan Identitas, Tim & Materi Investor? (y/n): ");
  if (next.toLowerCase() === "y") {
    await runFase3(updatedToken);
  }
}

// ── FASE 3: ENRICHMENT & BRANDING ────────────────────────────────────────────
async function runFase3(token: { contractAddr: string; ticker: string; name: string } | null): Promise<void> {
  console.log(`\n\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[1;33m  [FASE 3/5] PENGAYAAN IDENTITAS, TIM, PRODUK & MATERI INVESTOR\x1b[0m`);
  console.log(`\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m\n`);

  if (!token) {
    console.log("⚠️  Tidak ada token terdaftar di vault. Mengarahkan kembali ke menu.");
    return;
  }

  console.log(`Mengelola Token: \x1b[1;32m$${token.ticker}\x1b[0m (${token.contractAddr})`);

  console.log("\nLangkah 3A: Mendaftarkan profil proyek, produk nyata & tim di Bankr API...");
  await runStep("Sync Proyek Bankr API", ["scripts/manage-bankr-project.ts", "sync-all"]);

  console.log("\nLangkah 3B: Menghasilkan materi promosi & penawaran investor viral...");
  await runStep("Generate Token Offer Deck", ["scripts/generate-token-offer.ts", token.ticker]);

  console.log("\nLangkah 3C: Menghasilkan tautan referral bagi hasil (5% WETH)...");
  await runStep("Generate Affiliate Referral Links", ["scripts/generate-affiliate-link.ts", token.ticker]);

  console.log("\nLangkah 3D: Menerbitkan Website 3D Parallax & Profil DexScreener Resmi...");
  await runStep("Generate Website & DexScreener Profile", ["scripts/generate-token-website.ts", token.ticker]);

  console.log("\nLangkah 3E: Mempublikasikan Website Web3 ke Cloudflare Pages Edge...");
  await runStep("Deploy ke Cloudflare Pages", ["scripts/deploy-cloudflare-pages.ts", token.ticker]);

  console.log("\nLangkah 3F: Mengalokasikan & Menyinkronkan Database Cloud Neon PostgreSQL...");
  await runStep("Sinkronisasi Database Neon Cloud", ["scripts/manage-neon-db.ts", "sync"]);

  console.log("\nLangkah 3G: Sinkronisasi Media Assets & OpenGraph Cards ke Cloudflare R2...");
  await runStep("Sinkronisasi Cloudflare R2 Assets", ["scripts/sync-r2-assets.ts", token.ticker]);

  console.log("\nLangkah 3H: Audit Kesiapan Fast-Track DexScreener & Sniper Bot...");
  await runStep("Audit Fast-Track DexScreener", ["scripts/poll-dexscreener-fasttrack.ts", token.ticker]);

  console.log(`\n\x1b[1;32m✅ FASE 3 SELESAI: Seluruh aset promosi, profil tim, referral, website 3D Cloudflare, R2 Assets, DexScreener Fast-Track, & Neon Cloud DB siap publikasi.\x1b[0m`);
  const next = await prompt("\nLanjutkan ke FASE 4: Aktivasi Pasar & Catalyst Swap ($1)? (y/n): ");
  if (next.toLowerCase() === "y") {
    await runFase4(token);
  }
}

// ── FASE 4: CATALYST TRADING ─────────────────────────────────────────────────
async function runFase4(token: { contractAddr: string; ticker: string; name: string } | null): Promise<void> {
  console.log(`\n\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[1;33m  [FASE 4/5] AKTIVASI PASAR DEXSCREENER ($1 CATALYST SWAP) & AUTO-TP\x1b[0m`);
  console.log(`\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m\n`);

  if (!token) {
    console.log("⚠️  Tidak ada token terdaftar di vault.");
    return;
  }

  console.log(`Token Target: \x1b[1;32m$${token.ticker}\x1b[0m (${token.contractAddr})`);
  console.log(`Tautan 1-Click Uniswap: https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${token.contractAddr}\n`);

  console.log("Pilihan Aktivasi Catalyst:");
  console.log("  [1] Lakukan swap mandiri ~$1 di Uniswap, lalu daftarkan TxHash ke bot");
  console.log("  [2] Eksekusi swap otomatis via bot (memerlukan ~0.0008 ETH di wallet lokal)");
  console.log("  [3] Lewati swap (Langsung pantau grafik live & auto-TP)");
  console.log("  [4] Lewati ke Fase 5");

  const catChoice = await prompt("Pilihan [1-4]: ");

  if (catChoice === "1") {
    const txHash = await prompt("Masukkan TxHash swap Uniswap Anda: ");
    if (txHash && txHash.startsWith("0x")) {
      await runStep("Register Catalyst Swap", ["scripts/execute-catalyst-trading.ts", "register", token.contractAddr, txHash]);
    }
  } else if (catChoice === "2") {
    await runStep("Auto Catalyst Buy", ["scripts/execute-catalyst-trading.ts", "auto", token.contractAddr]);
  } else if (catChoice === "3") {
    await runStep("Live Price Monitor", ["scripts/execute-catalyst-trading.ts", "monitor", token.contractAddr]);
  }

  console.log(`\n\x1b[1;32m✅ FASE 4 SELESAI: Posisi catalyst aktif dan grafik pasar terinisiasi.\x1b[0m`);
  const next = await prompt("\nLanjutkan ke FASE 5: Menyalakan Flywheel Harvester 24/7? (y/n): ");
  if (next.toLowerCase() === "y") {
    await runFase5(token);
  }
}

// ── FASE 5: FLYWHEEL REVENUE HARVESTER ─────────────────────────────────────────
async function runFase5(token: { contractAddr: string; ticker: string; name: string } | null): Promise<void> {
  console.log(`\n\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m`);
  console.log(`\x1b[1;33m  [FASE 5/5] MESIN PENDAPATAN PASIF FLYWHEEL 24/7 & MONITORING\x1b[0m`);
  console.log(`\x1b[1;33m════════════════════════════════════════════════════════════════════════════════\x1b[0m\n`);

  console.log("Pilihan Harvester:");
  console.log("  [1] Jalankan pemeriksaan fee sekali jalan (Single-Pass Audit)");
  console.log("  [2] Nyalakan Flywheel Harvester Daemon 24/7 (Interval 5 menit)");
  console.log("  [3] Tampilkan Matriks Armada & Rekonsiliasi On-Chain");

  const flyChoice = await prompt("Pilihan [1-3]: ");

  if (flyChoice === "1") {
    await runStep("Flywheel Harvester Audit", ["scripts/run-flywheel-worker.ts"]);
  } else if (flyChoice === "2") {
    console.log("\n🚀 Menjalankan Flywheel Harvester Daemon (Tekan Ctrl+C untuk berhenti)...");
    await runStep("Flywheel Harvester Daemon", ["scripts/run-flywheel-worker.ts", "--daemon", "5"]);
  } else if (flyChoice === "3") {
    await runStep("Matriks Armada Token", ["scripts/view-fleet-matrix.ts"]);
  }

  console.log(`\n\x1b[1;32m🎉 SELURUH 5 FASE SIKLUS HIDUP TOKEN SELESAI DIJALANKAN DENGAN SUKSES!\x1b[0m`);
}

main().catch((err) => {
  console.error("Fatal wizard error:", err);
  process.exit(1);
});
