#!/usr/bin/env bun
/**
 * scripts/view-fleet-matrix.ts
 *
 * Clean & Structured Visualizer for Multi-Chain Token Fleet & Autonomous Tokenomics.
 * Displays all deployed tokens (Base L2 + Solana) with clear metrics, status,
 * explorer links, live DEX pricing/liquidity, and automated tokenomics performance.
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";

import { getAllDeployLogs, getFlywheelSummary, getAllPromotionDecisions, type DeployLog } from "../src/db/vault.ts";
import {
  isLiveDeployment,
  isSimulatedDeployment,
  getProductionFleet,
} from "../src/modules/fleet/fleet-registry.ts";
import {
  fetchDexScreenerMetrics,
  type DexMetrics,
} from "../src/modules/fleet/dex-cache.ts";
import { evaluatePromotionEligibility } from "../src/modules/growth/token-offer-generator.ts";

export { fetchDexScreenerMetrics, type DexMetrics };

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

export async function displayFleetMatrix(showAll = false): Promise<void> {
  const logs = getAllDeployLogs();
  const flywheel = getFlywheelSummary();
  const promoDecisions = getAllPromotionDecisions();

  const { live, simulated, all: fleetWithCa } = getProductionFleet();
  const liveBase = live.filter((l) => l.chain === "base");
  const liveSol = live.filter((l) => l.chain === "solana");
  const liveArc = live.filter((l) => l.chain === "arc");
  const totalLive = live.length;

  // Pre-fetch live DEX metrics for on-chain tokens
  const liveCAs = live.map((t) => t.contractAddr!).filter(Boolean);
  const dexMetrics = await fetchDexScreenerMetrics(liveCAs);

  console.log(`\n${CYAN}${BOLD}========================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}   [+] MATRIKS ARMADA TOKEN MULTI-CHAIN & STATUS TOKENOMICS OTOMATIS [+]                 ${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================================${RESET}\n`);

  // 1. Fleet Overview Header
  const baseWithCa = fleetWithCa.filter((l) => l.chain === "base");
  const solWithCa = fleetWithCa.filter((l) => l.chain === "solana");
  const arcWithCa = fleetWithCa.filter((l) => l.chain === "arc");

  console.log(`${BOLD}[1] RINGKASAN ARMADA GLOBAL (FLEET OVERVIEW)${RESET}`);
  console.log(`  - Total Token Ber-Kontrak: ${BOLD}${fleetWithCa.length}${RESET} token (${GREEN}${totalLive} Live Mainnet${RESET} / ${YELLOW}${fleetWithCa.length - totalLive} Simulasi/Testnet${RESET})`);
  console.log(`  - Armada Base L2         : ${BOLD}${baseWithCa.length}${RESET} token (${GREEN}${liveBase.length} Live${RESET} / ${YELLOW}${baseWithCa.length - liveBase.length} Simulasi${RESET}) | ${GREEN}100% Relayer Gas Sponsored (0.0 ETH)${RESET}`);
  console.log(`  - Armada Solana          : ${BOLD}${solWithCa.length}${RESET} token (${GREEN}${liveSol.length} Live${RESET} / ${YELLOW}${solWithCa.length - liveSol.length} Simulasi${RESET}) | ${CYAN}Pump.fun Bonding Curve Ready${RESET}`);
  console.log(`  - Armada Arc Chain       : ${BOLD}${arcWithCa.length}${RESET} token (${GREEN}${liveArc.length} Live${RESET} / ${YELLOW}${arcWithCa.length - liveArc.length} Simulasi${RESET}) | ${YELLOW}ArcPad Uniswap V3 Locked LP (USDC Gas)${RESET}`);
  console.log(`  - Total Flywheel Recycled: ${GREEN}${flywheel.totalClaimedWeth.toFixed(6)} WETH${RESET} across ${flywheel.eventCount} cycles`);
  console.log(`    |-- Tokens Burned      : ${MAGENTA}${flywheel.totalBurnedTokens.toLocaleString()} tokens hangus ke 0xdead${RESET}`);
  console.log(`    |-- Dividen Holders    : ${GREEN}${flywheel.totalDividendWeth.toFixed(6)} WETH${RESET}`);
  console.log(`    \\-- Jackpot Pool       : ${YELLOW}${flywheel.totalJackpotWeth.toFixed(6)} WETH${RESET}\n`);

  // 2. Live Mainnet Fleet Section
  console.log(`${BOLD}[2] DAFTAR TOKEN LIVE MAINNET RESMI (ON-CHAIN ACTIVE)${RESET}`);
  if (totalLive === 0) {
    console.log(`  ${GRAY}(Belum ada token live mainnet on-chain terdeploy)${RESET}`);
  } else {
    for (const [idx, token] of [...liveBase, ...liveSol, ...liveArc].entries()) {
      const chainBadge =
        token.chain === "base"
          ? `${CYAN}[BASE L2]${RESET}`
          : token.chain === "solana"
          ? `${MAGENTA}[SOLANA]${RESET}`
          : token.chain === "arc"
          ? `${YELLOW}[ARC CHAIN]${RESET}`
          : `[${(token.chain || "EVM").toUpperCase()}]`;
      const ca = token.contractAddr!;
      const metrics = dexMetrics[ca.toLowerCase()];

      console.log(`  ${BOLD}#${idx + 1}${RESET} ${chainBadge} ${GREEN}[LIVE ON-CHAIN]${RESET} ${BOLD}$${token.ticker}${RESET} ("${token.tokenName}")`);
      console.log(`     |-- Contract (CA) : ${CYAN}${ca}${RESET}`);

      if (metrics && metrics.priceUsd && metrics.priceUsd !== "N/A" && metrics.priceUsd !== "Offline") {
        const changeStr = metrics.change24h != null
          ? (metrics.change24h >= 0 ? `${GREEN}+${metrics.change24h.toFixed(2)}%${RESET}` : `${RED}${metrics.change24h.toFixed(2)}%${RESET}`)
          : "n/a";
        const volStr = metrics.volume24h != null ? `$${metrics.volume24h.toLocaleString()}` : "UNKNOWN";
        const liqStr = metrics.liquidityUsd != null ? `$${metrics.liquidityUsd.toLocaleString()}` : "UNKNOWN";
        console.log(`     |-- Pasar DEX     : ${BOLD}${metrics.priceUsd}${RESET} | 24h: ${changeStr} | Vol: ${volStr} | Liq: ${liqStr} ${GREEN}[DEX: OBSERVED]${RESET}`);
      } else {
        console.log(`     |-- Pasar DEX     : ${YELLOW}[DEX: PENDING INDEXING / UNKNOWN]${RESET}`);
      }

      if (token.txHash) console.log(`     |-- Deploy Tx     : ${token.txHash}`);
      const promoEval = evaluatePromotionEligibility({
        lifecycleState: token.lifecycleState,
        status: token.status,
        onChainVerified: true,
        contractAddress: ca,
        chain: token.chain,
        poolId: token.poolId,
        pairAddress: metrics?.pairAddress,
        liquidityUsd: metrics?.liquidityUsd,
        volume24h: metrics?.volume24h,
        priceUsd: metrics?.priceUsd,
      });
      const promoBadge = promoEval.status === "ELIGIBLE"
        ? `${GREEN}[ELIGIBLE]${RESET}`
        : promoEval.status === "CONDITIONAL"
        ? `${YELLOW}[CONDITIONAL]${RESET}`
        : `${GRAY}[${promoEval.status}]${RESET}`;
      const decisionRec = ca ? (promoDecisions[ca.toLowerCase()] || (token.ticker ? promoDecisions[token.ticker.toLowerCase()] : null)) : (token.ticker ? promoDecisions[token.ticker.toLowerCase()] : null);
      const opDecision = decisionRec?.decision || "PENDING_REVIEW";
      const opBadge = opDecision === "APPROVED"
        ? `${GREEN}[APPROVED]${RESET}`
        : opDecision === "REJECTED"
        ? `${RED}[REJECTED]${RESET}`
        : `${YELLOW}[PENDING_REVIEW]${RESET}`;
      console.log(`     |-- Promosi Free  : ${promoBadge} ${GRAY}(${promoEval.reasons[0] || "Ready"})${RESET} | Keputusan: ${opBadge}`);
      if (token.websiteUrl) {
        console.log(`     |-- Web3 DApp     : ${GREEN}${token.websiteUrl}${RESET}`);
      }
      if (token.ticker) {
        const neonDb = `token_${token.ticker.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
        console.log(`     |-- Neon Cloud DB : ${CYAN}[${neonDb}]${RESET} (AWS Serverless Postgres)`);
      }
      if (token.chain === "base") {
        console.log(`     |-- DexScreener   : ${GREEN}https://dexscreener.com/base/${ca}${RESET}`);
        console.log(`     |-- BaseScan      : https://basescan.org/token/${ca}`);
        console.log(`     \\-- Tokenomics    : ${CYAN}Flywheel Aktif (35% Kas / 30% Burn / 20% Dividen / 15% Jackpot)${RESET}`);
      } else if (token.chain === "arc") {
        console.log(`     |-- ArcPad        : ${GREEN}https://arcpad.meme/token/${ca}${RESET}`);
        console.log(`     |-- Arcscan       : https://arcscan.app/token/${ca}`);
        console.log(`     \\-- Tokenomics    : ${CYAN}0.5% USDC Creator Fee Stream (Permanent Uniswap V3 Locked LP)${RESET}`);
      } else {
        console.log(`     |-- Pump.fun      : ${GREEN}https://pump.fun/${ca}${RESET}`);
        console.log(`     |-- DexScreener   : https://dexscreener.com/solana/${ca}`);
        console.log(`     \\-- Solscan       : https://solscan.io/token/${ca}`);
      }
    }
  }
  console.log("");

  // 3. Recent Deployments & Simulations Section
  console.log(`${BOLD}[3] AKTIVITAS PELUNCURAN TERAKHIR (TOP 5 RECENT)${RESET}`);
  const recentLogs = fleetWithCa.slice(0, 5);
  for (const [idx, r] of recentLogs.entries()) {
    const isLive = isLiveDeployment(r);
    const badge = isLive ? `${GREEN}[LIVE]${RESET}` : `${YELLOW}[SIMULASI]${RESET}`;
    const chainStr = r.chain ? r.chain.toUpperCase() : "BASE";
    const caShort = r.contractAddr ? (r.contractAddr.length > 16 ? `${r.contractAddr.slice(0, 10)}...${r.contractAddr.slice(-4)}` : r.contractAddr) : "Pending";
    console.log(`  - ${badge} ${BOLD}$${r.ticker || "UNKNOWN"}${RESET} on ${chainStr} | CA: ${caShort} | Status: ${r.status || r.lifecycleState}`);
  }
  console.log("");

  // 4. Operational Actions
  console.log(`${CYAN}----------------------------------------------------------------------------------------${RESET}`);
  console.log(`${BOLD}PANDUAN PERINTAH OPERASIONAL / QUICK COMMAND REFERENCE (Salin & Jalankan di Terminal):${RESET}`);
  console.log(`  - Buat Pitch & Materi Promosi Viral : ${CYAN}bun run scripts/generate-token-offer.ts [TICKER]${RESET}`);
  console.log(`  - Luncurkan Token Baru (Multi-Chain): ${CYAN}bun run scripts/execute-dynamic-deployment.ts${RESET}`);
  console.log(`  - Jalankan Tokenomics Harvester 24/7: ${GREEN}bun run scripts/run-flywheel-worker.ts --daemon 5${RESET}`);
  console.log(`  - Ekspor Telemetri Armada (CSV/JSON): ${CYAN}bun run scripts/view-fleet-matrix.ts --export${RESET}`);
  console.log(`${CYAN}========================================================================================${RESET}\n`);
}

export interface FleetExportItem {
  id: number;
  ticker: string;
  tokenName: string;
  chain: string;
  contractAddr: string;
  poolId: string;
  status: string;
  lifecycleState: string;
  isLive: boolean;
  promotionEligibility?: string;
  dexDiscoveryStatus?: string;
  operatorDecision: string;
  deployCost: number;
  txHash: string;
  priceUsd: string;
  change24h: string;
  volume24h: string;
  liquidityUsd: string;
  createdAt: string;
}

export interface ExportFleetOptions {
  format?: "csv" | "json" | "all";
  customDir?: string;
  filenamePrefix?: string;
  dexMetrics?: Record<string, DexMetrics>;
}

export interface ExportFleetResult {
  csvPath?: string;
  jsonPath?: string;
  count: number;
  items: FleetExportItem[];
}

export function escapeCsv(val: any): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportFleetMatrix(options?: ExportFleetOptions): Promise<ExportFleetResult> {
  const format = options?.format ?? "all";
  const baseDir = options?.customDir ?? path.join(process.cwd(), ".eliza", "exports");
  fs.mkdirSync(baseDir, { recursive: true });

  const { all: fleetWithCa } = getProductionFleet();
  const liveCAs = fleetWithCa.map((t) => t.contractAddr!).filter(Boolean);
  const dexMetrics = options?.dexMetrics ?? (await fetchDexScreenerMetrics(liveCAs));

  const promoDecisions = getAllPromotionDecisions();
  const items: FleetExportItem[] = fleetWithCa.map((t) => {
    const isLive = isLiveDeployment(t);
    const ca = t.contractAddr || "";
    const metrics = ca ? dexMetrics[ca.toLowerCase()] : undefined;

    const elig = evaluatePromotionEligibility({
      lifecycleState: t.lifecycleState,
      status: t.status,
      onChainVerified: isLive,
      contractAddress: ca,
      chain: t.chain,
      poolId: t.poolId,
      pairAddress: metrics?.pairAddress,
      liquidityUsd: metrics?.liquidityUsd,
      volume24h: metrics?.volume24h,
      priceUsd: metrics?.priceUsd,
      hasLogoUrl: Boolean(t.ipfsUrl),
    });

    const hasDexObserved = Boolean(metrics && metrics.priceUsd && metrics.priceUsd !== "N/A" && metrics.priceUsd !== "Offline");
    const dexDiscoveryStatus = isLive
      ? (hasDexObserved ? "OBSERVED" : "PENDING_INDEXING")
      : "SIMULATED";

    const decisionRec = ca ? (promoDecisions[ca.toLowerCase()] || (t.ticker ? promoDecisions[t.ticker.toLowerCase()] : null)) : (t.ticker ? promoDecisions[t.ticker.toLowerCase()] : null);
    const operatorDecision = decisionRec?.decision || "PENDING_REVIEW";

    return {
      id: t.id,
      ticker: t.ticker || "",
      tokenName: t.tokenName || "",
      chain: t.chain || "base",
      contractAddr: ca,
      poolId: t.poolId || "",
      status: t.status || "",
      lifecycleState: t.lifecycleState || "",
      isLive,
      promotionEligibility: elig.status,
      dexDiscoveryStatus,
      operatorDecision,
      deployCost: t.deployCost ?? 0,
      txHash: t.txHash || "",
      priceUsd: metrics?.priceUsd || "",
      change24h: metrics?.change24h != null ? String(metrics.change24h) : "",
      volume24h: metrics?.volume24h != null ? String(metrics.volume24h) : "",
      liquidityUsd: metrics?.liquidityUsd != null ? String(metrics.liquidityUsd) : "",
      createdAt: t.createdAt || "",
    };
  });

  const timestamp = Date.now();
  const prefix = options?.filenamePrefix ?? "fleet_matrix";
  const result: ExportFleetResult = { count: items.length, items };

  if (format === "csv" || format === "all") {
    const csvHeader = [
      "id",
      "ticker",
      "tokenName",
      "chain",
      "contractAddr",
      "poolId",
      "status",
      "lifecycleState",
      "isLive",
      "promotionEligibility",
      "dexDiscoveryStatus",
      "operatorDecision",
      "deployCost",
      "txHash",
      "priceUsd",
      "change24h",
      "volume24h",
      "liquidityUsd",
      "createdAt",
    ].join(",");

    const csvRows = items.map((item) =>
      [
        escapeCsv(item.id),
        escapeCsv(item.ticker),
        escapeCsv(item.tokenName),
        escapeCsv(item.chain),
        escapeCsv(item.contractAddr),
        escapeCsv(item.poolId),
        escapeCsv(item.status),
        escapeCsv(item.lifecycleState),
        escapeCsv(item.isLive),
        escapeCsv(item.promotionEligibility),
        escapeCsv(item.dexDiscoveryStatus),
        escapeCsv(item.operatorDecision),
        escapeCsv(item.deployCost),
        escapeCsv(item.txHash),
        escapeCsv(item.priceUsd),
        escapeCsv(item.change24h),
        escapeCsv(item.volume24h),
        escapeCsv(item.liquidityUsd),
        escapeCsv(item.createdAt),
      ].join(",")
    );

    const csvContent = [csvHeader, ...csvRows].join("\n");
    const csvPath = path.join(baseDir, `${prefix}_${timestamp}.csv`);
    fs.writeFileSync(csvPath, csvContent, "utf8");
    result.csvPath = csvPath;
  }

  if (format === "json" || format === "all") {
    const jsonPath = path.join(baseDir, `${prefix}_${timestamp}.json`);
    const jsonContent = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        timestamp,
        totalFleet: items.length,
        fleet: items,
      },
      null,
      2
    );
    fs.writeFileSync(jsonPath, jsonContent, "utf8");
    result.jsonPath = jsonPath;
  }

  return result;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const wantsCsv = args.includes("--export-csv");
  const wantsJson = args.includes("--export-json");
  const wantsAllExport = args.includes("--export");

  displayFleetMatrix()
    .then(async () => {
      if (wantsCsv || wantsJson || wantsAllExport) {
        const format = wantsAllExport ? "all" : wantsCsv && wantsJson ? "all" : wantsCsv ? "csv" : "json";
        const res = await exportFleetMatrix({ format });
        console.log(`\n${GREEN}${BOLD}📁 [TELEMETRY EXPORT BERHASIL]${RESET}`);
        if (res.csvPath) console.log(`   |-- CSV  : ${CYAN}${res.csvPath}${RESET}`);
        if (res.jsonPath) console.log(`   \\-- JSON : ${CYAN}${res.jsonPath}${RESET}`);
        console.log(`   Total armada terekspor: ${res.count} token\n`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
