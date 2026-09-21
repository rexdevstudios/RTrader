#!/usr/bin/env bun
/**
 * scripts/check-launch-readiness.ts
 *
 * Standalone CLI runner for 1-Click Launch Readiness Preflight Score.
 * Evaluates 10-checkpoint rubric across on-chain, security, web assets, and announcements.
 *
 * Usage:
 *   bun run scripts/check-launch-readiness.ts [tickerOrCA]
 */

import { logger } from "../src/logger.ts";
import { getProductionFleet } from "../src/modules/fleet/fleet-registry.ts";
import { evaluateLaunchReadiness } from "../src/modules/intelligence/launch-readiness-checker.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find((a) => !a.startsWith("-"));

  console.log(`
=================================================================
  [+] 1-CLICK LAUNCH READINESS PREFLIGHT DIAGNOSTIC [+]
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

  console.log(`${CYAN}🔍 Mengevaluasi 10 checkpoint kesiapan peluncuran untuk:${RESET}`);
  console.log(`   Token:    ${BOLD}$${ticker} (${name})${RESET}`);
  console.log(`   CA:       ${CYAN}${ca}${RESET}`);
  console.log(`   Chain:    ${chain.toUpperCase()}\n`);

  const report = await evaluateLaunchReadiness({
    ticker,
    contractAddress: ca,
    name,
    chain,
  });

  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}📋 TABEL HASIL EVALUASI 10 CHECKPOINT KESIAPAN:${RESET}`);
  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

  report.items.forEach((item, idx) => {
    const num = (idx + 1).toString().padStart(2, " ");
    let badge = `${GREEN}[LULUS]  ${RESET}`;
    let scoreColor = GREEN;
    if (item.status === "WARN") {
      badge = `${YELLOW}[PERINGATAN]${RESET}`;
      scoreColor = YELLOW;
    } else if (item.status === "FAIL") {
      badge = `${RED}[GAGAL]  ${RESET}`;
      scoreColor = RED;
    }

    console.log(
      `${num}. ${badge} ${BOLD}${item.name}${RESET}  ${scoreColor}(+${item.score}/${item.weight} pts)${RESET}`
    );
    console.log(`    ${GRAY}Kategori: ${item.category} | Detail: ${item.details}${RESET}`);
    if (item.remediation) {
      console.log(`    ${YELLOW}💡 Saran: ${item.remediation}${RESET}`);
    }
    console.log("");
  });

  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  let scoreBoxColor = GREEN;
  if (report.verdict === "ACCEPTABLE_WITH_WARNINGS") scoreBoxColor = YELLOW;
  if (report.verdict === "NOT_READY") scoreBoxColor = RED;

  console.log(`${BOLD}${scoreBoxColor}📊 SKOR KESIAPAN AKHIR: [ ${report.overallScore} / 100 ] ${report.verdictEmoji}${RESET}`);
  console.log(`${BOLD}${scoreBoxColor}VONIS: ${report.summary}${RESET}`);
  console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

  const failedItems = report.items.filter((i) => i.status === "FAIL" || i.status === "WARN");
  if (failedItems.length > 0) {
    console.log(`${BOLD}🔧 DAFTAR TINDAKAN PERBAIKAN PRIORITAS:${RESET}`);
    failedItems.forEach((fi) => {
      if (fi.remediation) {
        console.log(` • [${fi.name}]: ${fi.remediation}`);
      }
    });
    console.log("");
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Launch readiness check error: ${err?.message || err}`);
    process.exit(1);
  });
}
