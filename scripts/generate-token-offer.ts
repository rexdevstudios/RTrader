#!/usr/bin/env bun
/**
 * scripts/generate-token-offer.ts
 *
 * Generates high-converting marketing offers & value proposition decks
 * for any deployed token in the multi-chain fleet.
 *
 * Usage:
 *   bun run scripts/generate-token-offer.ts                 # Uses latest deployed token
 *   bun run scripts/generate-token-offer.ts <CA_or_Ticker>  # Uses specified token
 *   bun run scripts/generate-token-offer.ts --save          # Saves markdown deck to promotions/
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import {
  getAllDeployLogs,
  type DeployLog,
  getPromotionDecision,
  recordPromotionDecision,
  type PromotionDecisionRecord,
} from "../src/db/vault.ts";
import {
  generateIrresistibleOffer,
  saveOfferDeckMarkdown,
  generateDiscoveryPackage,
  saveDiscoveryPackageJson,
  validatePromotionApproval,
  type FreeDiscoveryPackage,
} from "../src/modules/growth/token-offer-generator.ts";
import { isLiveDeployment } from "../src/modules/fleet/fleet-registry.ts";
import { fetchDexScreenerMetrics } from "../src/modules/fleet/dex-cache.ts";
import { dispatchBeaconCard } from "../src/modules/social/beacon-broadcaster.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

function askQuestion(promptText: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function resolveTargetToken(query?: string): DeployLog | null {
  const logs = getAllDeployLogs();
  if (logs.length === 0) return null;

  if (query) {
    const clean = query.trim().toLowerCase();
    // Search by CA
    const byCa = logs.find((l) => l.contractAddr && l.contractAddr.toLowerCase() === clean);
    if (byCa) return byCa;
    // Search by ticker (prioritize live on-chain with CA, then any with CA, then fallback)
    const byTickerLive = logs.find(
      (l) => l.ticker && l.ticker.toLowerCase() === clean.replace(/^\$/, "") && !l.simulated && l.contractAddr
    );
    if (byTickerLive) return byTickerLive;
    const byTickerWithCa = logs.find(
      (l) => l.ticker && l.ticker.toLowerCase() === clean.replace(/^\$/, "") && l.contractAddr
    );
    if (byTickerWithCa) return byTickerWithCa;
    const byTicker = logs.find((l) => l.ticker && l.ticker.toLowerCase() === clean.replace(/^\$/, ""));
    if (byTicker) return byTicker;

    // Explicit query provided but not matched -> return null to avoid deceptive fallback
    return null;
  }

  // Default: Prioritize confirmed live on-chain token, then simulated
  const liveTokens = logs.filter(isLiveDeployment);
  if (liveTokens.length > 0) return liveTokens[0];

  const anyConfirmed = logs.filter((l) => l.contractAddr);
  if (anyConfirmed.length > 0) return anyConfirmed[0];

  return logs[0];
}

export interface GenerateOfferOptions {
  query?: string;
  shouldSave?: boolean;
  approve?: boolean;
  reject?: boolean;
  rejectReason?: string;
  yes?: boolean;
  notify?: boolean;
  review?: boolean;
}

export async function runGenerateOffer(
  argOrOptions?: string | GenerateOfferOptions,
  legacyShouldSave = false
): Promise<void> {
  const opts: GenerateOfferOptions =
    typeof argOrOptions === "object" && argOrOptions !== null
      ? argOrOptions
      : { query: argOrOptions, shouldSave: legacyShouldSave };

  const token = resolveTargetToken(opts.query);
  if (!token || !token.contractAddr) {
    if (opts.query) {
      console.error(`\n${YELLOW}[!] Token dengan ticker atau alamat kontrak "${opts.query}" tidak ditemukan di vault.${RESET}`);
      console.error(`Gunakan "bun run fleet" untuk melihat daftar token terdeploy yang valid.\n`);
    } else {
      console.error(`\n${YELLOW}[!] Belum ada token dengan Contract Address (CA) yang valid di database vault.${RESET}`);
      console.error(`Jalankan peluncuran token terlebih dahulu via "bun run scripts/execute-dynamic-deployment.ts".\n`);
    }
    process.exit(1);
  }

  const offer = generateIrresistibleOffer({
    name: token.tokenName,
    ticker: token.ticker,
    contractAddress: token.contractAddr,
    chain: token.chain,
    poolId: token.poolId ?? undefined,
    viralScore: token.viralScore ?? undefined,
  });

  console.log(`\n${CYAN}${BOLD}========================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}   [+] VALUE PROPOSITION & PROMOTIONAL DECK GENERATOR [+]                               ${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================================${RESET}\n`);

  console.log(`${BOLD}[1] KARTU PENAWARAN UTAMA (TERMINAL VIEW)${RESET}`);
  console.log(offer.fullOfferCard);
  console.log("");

  console.log(`${BOLD}[2] RINGKASAN VALUE PROPOSITION (Bahasa Indonesia)${RESET}`);
  console.log(`${GREEN}${offer.executiveSummary}${RESET}\n`);

  console.log(`${BOLD}[3] TWITTER / X VIRAL MEGA-THREAD (Siap Copy-Paste)${RESET}`);
  for (let i = 0; i < offer.twitterThread.length; i++) {
    console.log(`${CYAN}--- Tweet #${i + 1} ---${RESET}`);
    console.log(offer.twitterThread[i]);
    console.log("");
  }

  console.log(`${BOLD}[4] TELEGRAM / DISCORD ANNOUNCEMENT (Siap Copy-Paste)${RESET}`);
  console.log(`${MAGENTA}${offer.telegramPost}${RESET}\n`);

  console.log(`${BOLD}[5] DEXSCREENER / DEXTOOLS PROFILE BIO${RESET}`);
  console.log(`${YELLOW}${offer.dexScreenerBio}${RESET}\n`);

  // Phase 6A: Free Discovery Package & Promotion Readiness
  let dexMetricsObj: any = undefined;
  try {
    const fetched = await fetchDexScreenerMetrics([token.contractAddr]);
    dexMetricsObj = fetched[token.contractAddr.toLowerCase()];
  } catch {}

  const isLive = isLiveDeployment(token);
  let decisionRec: PromotionDecisionRecord | null = getPromotionDecision(token.contractAddr);

  let discoveryPackage: FreeDiscoveryPackage = generateDiscoveryPackage(
    {
      name: token.tokenName,
      ticker: token.ticker,
      contractAddress: token.contractAddr,
      chain: token.chain,
      poolId: token.poolId ?? undefined,
      description: token.description ?? undefined,
    },
    {
      liquidityUsd: dexMetricsObj?.liquidityUsd,
      volume24h: dexMetricsObj?.volume24h,
      priceUsd: dexMetricsObj?.priceUsd,
      pairAddress: dexMetricsObj?.pairAddress,
      onChainVerified: isLive,
      lifecycleState: token.lifecycleState,
      status: token.status,
    },
    decisionRec
      ? {
          status: decisionRec.decision,
          operator: decisionRec.operator,
          decidedAt: decisionRec.decidedAt,
          reason: decisionRec.reason,
        }
      : undefined
  );

  const elig = discoveryPackage.eligibility;

  // Phase 6B.1: Operator Review / Approve / Reject Flow
  let wantApprove = opts.approve ?? false;
  let wantReject = opts.reject ?? false;
  let rejectReason = opts.rejectReason;

  // If interactive review was requested
  if (opts.review && !wantApprove && !wantReject) {
    console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${BOLD}MENU KEPUTUSAN OPERATOR (HUMAN-IN-THE-LOOP):${RESET}`);
    console.log(`  Token: ${BOLD}$${token.ticker}${RESET} (${token.contractAddr})`);
    console.log(`  Status Kelayakan Sistem: [${elig.status}]`);
    console.log(`  Keputusan Saat Ini    : [${decisionRec?.decision || "PENDING_REVIEW"}]\n`);
    console.log(`  [A] Approve Promosi`);
    console.log(`  [R] Reject Promosi`);
    console.log(`  [B] Batal (Keluar Tanpa Perubahan)`);
    console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    const choice = (await askQuestion("Masukkan pilihan Anda [A/R/B]: ")).toLowerCase();
    if (choice === "a") {
      wantApprove = true;
    } else if (choice === "r") {
      wantReject = true;
      rejectReason = await askQuestion("Masukkan alasan penolakan (opsional): ");
    } else {
      console.log(`\n${GRAY}[INFO] Tindakan dibatalkan. Tidak ada perubahan status operator.${RESET}\n`);
    }
  }

  // Execute Approval
  if (wantApprove) {
    const validation = validatePromotionApproval(elig);
    if (!validation.canApprove) {
      console.error(`\n${RED}${BOLD}❌ [APPROVAL GUARD REJECTED]${RESET}`);
      console.error(`${RED}${validation.blockReason}${RESET}\n`);
      process.exit(1);
    }

    if (validation.isConditional) {
      if (!opts.yes) {
        if (process.stdin.isTTY) {
          console.log(`\n${YELLOW}${BOLD}⚠️  PERINGATAN: Kelayakan promosi berstatus CONDITIONAL.${RESET}`);
          console.log(`${YELLOW}Kondisi yang belum terpenuhi:${RESET}`);
          for (const w of validation.warnings) {
            console.log(`  - ${w}`);
          }
          const confirm = await askQuestion("\nApakah Anda yakin tetap ingin menyetujui (Approve) promosi ini? [y/N]: ");
          if (confirm.toLowerCase() !== "y") {
            console.log(`\n${GRAY}[INFO] Tindakan persetujuan dibatalkan. Status operator tetap tidak berubah.${RESET}\n`);
            return;
          }
        } else {
          console.error(`\n${RED}[!] Token berstatus CONDITIONAL. Gunakan flag --yes (-y) untuk konfirmasi persetujuan non-interaktif.${RESET}\n`);
          process.exit(1);
        }
      }
    }

    decisionRec = recordPromotionDecision({
      tokenAddress: token.contractAddr,
      chain: token.chain,
      ticker: token.ticker,
      decision: "APPROVED",
      operator: "local_operator",
    });

    console.log(`\n${GREEN}${BOLD}✅ [OPERATOR APPROVED] Token $${token.ticker} resmi DISETUJUI untuk promosi.${RESET}`);

    if (opts.notify) {
      const beaconMsg = `📢 **PROMOTION APPROVED**: $${token.ticker} (${token.tokenName}) on ${token.chain.toUpperCase()} was APPROVED by local operator for discovery package generation.`;
      await dispatchBeaconCard(beaconMsg);
    }

    // Refresh discovery package with updated decision
    discoveryPackage = generateDiscoveryPackage(
      {
        name: token.tokenName,
        ticker: token.ticker,
        contractAddress: token.contractAddr,
        chain: token.chain,
        poolId: token.poolId ?? undefined,
        description: token.description ?? undefined,
      },
      {
        liquidityUsd: dexMetricsObj?.liquidityUsd,
        volume24h: dexMetricsObj?.volume24h,
        priceUsd: dexMetricsObj?.priceUsd,
        pairAddress: dexMetricsObj?.pairAddress,
        onChainVerified: isLive,
        lifecycleState: token.lifecycleState,
        status: token.status,
      },
      {
        status: "APPROVED",
        operator: decisionRec.operator,
        decidedAt: decisionRec.decidedAt,
      }
    );
  } else if (wantReject) {
    decisionRec = recordPromotionDecision({
      tokenAddress: token.contractAddr,
      chain: token.chain,
      ticker: token.ticker,
      decision: "REJECTED",
      operator: "local_operator",
      reason: rejectReason || "Ditolak oleh operator",
    });

    console.log(`\n${RED}${BOLD}🛑 [OPERATOR REJECTED] Promosi untuk token $${token.ticker} DITOLAK.${RESET}`);
    if (decisionRec.reason) {
      console.log(`   Alasan: ${decisionRec.reason}`);
    }

    // Refresh discovery package with updated decision
    discoveryPackage = generateDiscoveryPackage(
      {
        name: token.tokenName,
        ticker: token.ticker,
        contractAddress: token.contractAddr,
        chain: token.chain,
        poolId: token.poolId ?? undefined,
        description: token.description ?? undefined,
      },
      {
        liquidityUsd: dexMetricsObj?.liquidityUsd,
        volume24h: dexMetricsObj?.volume24h,
        priceUsd: dexMetricsObj?.priceUsd,
        pairAddress: dexMetricsObj?.pairAddress,
        onChainVerified: isLive,
        lifecycleState: token.lifecycleState,
        status: token.status,
      },
      {
        status: "REJECTED",
        operator: decisionRec.operator,
        decidedAt: decisionRec.decidedAt,
        reason: decisionRec.reason,
      }
    );
  }

  const statusColor =
    elig.status === "ELIGIBLE"
      ? GREEN
      : elig.status === "CONDITIONAL"
      ? YELLOW
      : elig.status === "NOT_READY"
      ? RED
      : GRAY;

  const decisionStatus = decisionRec?.decision || "PENDING_REVIEW";
  const decisionColor =
    decisionStatus === "APPROVED"
      ? GREEN
      : decisionStatus === "REJECTED"
      ? RED
      : YELLOW;

  console.log(`${BOLD}[6] STATUS KELAYAKAN PROMOSI & KEPUTUSAN OPERATOR${RESET}`);
  console.log(`  - Status Kelayakan Sistem : ${statusColor}${BOLD}[${elig.status}]${RESET}`);
  console.log(`  - Keputusan Operator       : ${decisionColor}${BOLD}[${decisionStatus}]${RESET}`);
  if (decisionRec) {
    console.log(`      |-- Diputuskan Oleh        : ${decisionRec.operator} (${decisionRec.decidedAt})`);
    if (decisionRec.reason) {
      console.log(`      |-- Alasan Keputusan       : ${decisionRec.reason}`);
    }
  } else {
    console.log(`      |-- Keterangan             : ${GRAY}Belum disetujui (Gunakan --approve untuk menyetujui)${RESET}`);
  }

  console.log(`  - Ringkasan Metrik On-Chain:`);
  console.log(`      |-- On-Chain Terverifikasi : ${elig.evaluatedMetrics.onChainVerified ? `${GREEN}YA (RPC Verified)${RESET}` : `${RED}TIDAK${RESET}`}`);
  console.log(`      |-- Likuiditas Pool        : ${elig.evaluatedMetrics.hasLiquidity ? `${GREEN}ADA${RESET}` : `${YELLOW}BELUM TERDETEKSI / UNKNOWN${RESET}`} (${elig.evaluatedMetrics.liquidityUsd !== "UNKNOWN" ? `$${elig.evaluatedMetrics.liquidityUsd}` : "UNKNOWN"})`);
  console.log(`      |-- Volume 24 Jam          : ${elig.evaluatedMetrics.hasVolume ? `${GREEN}AKTIF${RESET}` : `${YELLOW}0 / UNKNOWN${RESET}`} (${elig.evaluatedMetrics.volume24h !== "UNKNOWN" ? `$${elig.evaluatedMetrics.volume24h}` : "UNKNOWN"})`);
  console.log(`      \\-- Kelengkapan Metadata   : ${elig.evaluatedMetrics.metadataComplete ? `${GREEN}LENGKAP${RESET}` : `${YELLOW}PARSIAL (Sosmed/Deskripsi)${RESET}`}`);
  console.log(`  - Catatan Evaluasi:`);
  for (const r of elig.reasons) {
    console.log(`      * ${r}`);
  }
  console.log(`  - Platform Memenuhi Syarat: ${CYAN}${elig.eligiblePlatforms.length > 0 ? elig.eligiblePlatforms.join(", ") : "Belum ada platform memenuhi syarat"}${RESET}\n`);

  console.log(`${BOLD}[7] PAKET FREE DISCOVERY & SUBMISI DIREKTORI${RESET}`);
  console.log(`  - DexScreener    : [${discoveryPackage.discoveryStatus.dexScreener}] -> ${discoveryPackage.urls.dexScreener}`);
  console.log(`  - GeckoTerminal  : [${discoveryPackage.discoveryStatus.geckoTerminal}] -> ${discoveryPackage.urls.geckoTerminal}`);
  console.log(`  - CoinGecko      : [${discoveryPackage.discoveryStatus.coinGecko}] (Manual Form Submission)`);
  if (discoveryPackage.discoveryStatus.baseEcosystem) {
    const formUrl = discoveryPackage.urls.baseEcosystemForm || "https://forms.gle/hJhc2PqfAsQp86YL8";
    console.log(`  - Base Ecosystem : [${discoveryPackage.discoveryStatus.baseEcosystem}] -> Form Resmi: ${formUrl}`);
  }
  console.log(`  - Komunitas      : [${discoveryPackage.discoveryStatus.communityChannels}]`);
  console.log(`  - Format Pengumuman Sosial Siap Kirim:`);
  console.log(`      ${CYAN}${discoveryPackage.socialAnnouncement.socialPost.replace(/\n/g, "\n      ")}${RESET}\n`);

  if (opts.shouldSave) {
    const saveRes = saveOfferDeckMarkdown(offer, { chainSuffix: true });
    const jsonRes = saveDiscoveryPackageJson(discoveryPackage, { chainSuffix: true });

    if (saveRes.success) {
      console.log(`${GREEN}✅ File promosi Markdown tersimpan di: ${saveRes.chainPath || saveRes.primaryPath}${RESET}`);
    } else {
      console.error(`${YELLOW}Notice saving offer deck: ${saveRes.error}${RESET}`);
    }

    if (jsonRes.success) {
      console.log(`${GREEN}✅ Paket Discovery JSON tersimpan di: ${jsonRes.chainPath || jsonRes.primaryPath}${RESET}\n`);
    } else {
      console.error(`${YELLOW}Notice saving discovery package: ${jsonRes.error}${RESET}\n`);
    }
  }
}

export function printHelp(): void {
  console.log(`\n${CYAN}${BOLD}Omnichain Token Offer & Free Discovery Package Generator (Phase 6B.1)${RESET}`);
  console.log(`\n${BOLD}Penggunaan:${RESET}`);
  console.log(`  bun run scripts/generate-token-offer.ts [OPTIONS] [TICKER_OR_CA]\n`);
  console.log(`${BOLD}Pilihan Umum:${RESET}`);
  console.log(`  -s, --save              Simpan paket offer Markdown dan paket discovery JSON ke promotions/`);
  console.log(`  -h, --help              Tampilkan panduan bantuan ini`);
  console.log(`\n${BOLD}Alur Keputusan Operator (Phase 6B.1):${RESET}`);
  console.log(`  --review                Buka prompt interaktif untuk memilih Approve/Reject`);
  console.log(`  --approve               Setujui promosi secara eksplisit`);
  console.log(`  --reject [ALASAN]       Tolak promosi secara eksplisit dengan alasan opsional`);
  console.log(`  -y, --yes               Konfirmasi persetujuan untuk token berstatus CONDITIONAL`);
  console.log(`  --notify                Kirim kartu notifikasi internal via Discord/Telegram webhook\n`);
  console.log(`${BOLD}Contoh:${RESET}`);
  console.log(`  bun run scripts/generate-token-offer.ts PUMPRUN`);
  console.log(`  bun run scripts/generate-token-offer.ts PUMPRUN --review`);
  console.log(`  bun run scripts/generate-token-offer.ts PUMPRUN --approve --yes --save`);
  console.log(`  bun run scripts/generate-token-offer.ts PUMPRUN --reject "Kurang volume" --save\n`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const wantsHelp = args.includes("--help") || args.includes("-h");
  if (wantsHelp) {
    printHelp();
    process.exit(0);
  }

  const shouldSave = args.includes("--save") || args.includes("-s");
  const approve = args.includes("--approve");
  const rejectIndex = args.indexOf("--reject");
  const reject = rejectIndex !== -1;
  let rejectReason: string | undefined;
  if (reject && args[rejectIndex + 1] && !args[rejectIndex + 1].startsWith("-")) {
    rejectReason = args[rejectIndex + 1];
  }
  const yes = args.includes("--yes") || args.includes("-y");
  const notify = args.includes("--notify");
  const review = args.includes("--review");

  const query = args.find((a, idx) => !a.startsWith("-") && (rejectIndex === -1 || idx !== rejectIndex + 1));

  runGenerateOffer({
    query,
    shouldSave,
    approve,
    reject,
    rejectReason,
    yes,
    notify,
    review,
  })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("Error:", e);
      process.exit(1);
    });
}

