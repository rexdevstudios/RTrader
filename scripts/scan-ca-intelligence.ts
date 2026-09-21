/**
 * scripts/scan-ca-intelligence.ts
 *
 * Windows CLI Scanner for Token Contract Addresses (CA).
 * Multi-Chain (Base, Solana, Ethereum, BSC, Arbitrum).
 *
 * Features:
 *  - DexScreener Paid Status (/dp verification: profile approved & boosts)
 *  - GoPlus Security Audit (Honeypot, Taxes, Mintable, Blacklist, Renounced)
 *  - Market Analytics (Liquidity, FDV, Price, Volume)
 *  - Unified Safety Score & Risk Warnings
 *  - 1-Click Sniper Bot Deep Links (Maestro, Banana, Trojan, GMGN, Photon)
 *
 * Usage:
 *   bun run scripts/scan-ca-intelligence.ts [CA] [--chain=<chain>] [--json]
 */

import * as readline from "readline";
import {
  analyzeContractAddress,
  type CaIntelligenceReport,
} from "../src/modules/intelligence/ca-intelligence.ts";

// ANSI color codes for Windows CLI
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BG_GREEN = "\x1b[42m\x1b[30m";
const BG_RED = "\x1b[41m\x1b[37m";

function renderReportCard(report: CaIntelligenceReport): void {
  const { market, security, sniperLinks } = report;

  const paidBadge = report.isDexScreenerPaid
    ? `${BG_GREEN} ✅ DEXSCREENER PAID ${RESET} ${GREEN}(${report.dexScreenerStatusText})${RESET}`
    : `${BG_RED} ❌ DEXSCREENER NOT PAID ${RESET} ${YELLOW}(Belum ada profil/boost terbayar)${RESET}`;

  let scoreColor = GREEN;
  if (report.safetyScore < 50) scoreColor = RED;
  else if (report.safetyScore < 80) scoreColor = YELLOW;

  console.log(`
${BOLD}${CYAN}=================================================================${RESET}
${BOLD}${CYAN}   🔍 CA INTELLIGENCE & AUDIT SCANNER (WINDOWS CLI)${RESET}
${BOLD}${CYAN}=================================================================${RESET}
  ${BOLD}Token Name   :${RESET} ${market.tokenName} (${BOLD}$${market.tokenSymbol}${RESET})
  ${BOLD}Contract (CA):${RESET} ${CYAN}${report.contractAddress}${RESET}
  ${BOLD}Network      :${RESET} ${report.chain.toUpperCase()} (Chain ID: ${report.detectedChainId})
  ${BOLD}Scan Time    :${RESET} ${report.timestamp}

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
  ${BOLD}📌 DEXSCREENER STATUS (/dp):${RESET}
  ${paidBadge}
  ${DIM}Profile Approved: ${report.dexScreenerProfileApproved ? "YES" : "NO"} | Active Boosts: ${report.dexScreenerBoostCount}${RESET}

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
  ${BOLD}🛡️ AUDIT KEAMANAN (GoPlus Security):${RESET}
  • Honeypot Check  : ${security.isHoneypot ? `${RED}${BOLD}🚨 HONEYPOT DETECTED (CANNOT SELL!)${RESET}` : `${GREEN}✅ SAFE (Bukan Honeypot)${RESET}`}
  • Trading Taxes   : Beli: ${security.buyTaxPct <= 5 ? GREEN : RED}${security.buyTaxPct}%${RESET} | Jual: ${security.sellTaxPct <= 5 ? GREEN : RED}${security.sellTaxPct}%${RESET}
  • Buy / Sell Lock : ${security.cannotBuy ? `${RED}🚨 Beli Dinonaktifkan${RESET}` : `${GREEN}✅ Beli Aktif${RESET}`} | ${security.cannotSellAll ? `${RED}🚨 Tidak Bisa Jual Semua${RESET}` : `${GREEN}✅ Jual Bebas${RESET}`}
  • Mintable        : ${security.isMintable ? `${YELLOW}⚠️ YA (Dev dapat mencetak token baru)${RESET}` : `${GREEN}✅ TIDAK (Suplai Terkunci)${RESET}`}
  • Ownership       : ${security.canTakeBackOwnership ? `${YELLOW}⚠️ Dev bisa ambil alih kontrak${RESET}` : `${GREEN}✅ Renounced / Aman${RESET}`}
  • Blacklist       : ${security.isBlacklisted ? `${RED}⚠️ Memiliki fitur blacklist wallet${RESET}` : `${GREEN}✅ Tidak ada blacklist${RESET}`}
  • Open Source     : ${security.isOpenSource ? `${GREEN}✅ Verified Code${RESET}` : `${YELLOW}⚠️ Unverified Contract${RESET}`}
  • Pemegang Token  : ${security.holderCount ? `${security.holderCount.toLocaleString()} holders` : "N/A"}

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
  ${BOLD}📊 METRIK PASAR (DexScreener Live):${RESET}
  • Harga           : ${BOLD}${market.priceUsd}${RESET} (${market.priceChange24h >= 0 ? GREEN + "+" : RED}${market.priceChange24h.toFixed(2)}%${RESET} 24h)
  • Likuiditas      : $${market.liquidityUsd.toLocaleString()} USD
  • Market Cap (FDV): $${market.fdvUsd.toLocaleString()} USD
  • Volume 24 Jam   : $${market.volume24h.toLocaleString()} USD
  • DEX Pasangan    : ${market.dexId ? market.dexId.toUpperCase() : "Uniswap"} (${market.pairAddress || "Standard Pool"})

${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}
  ${BOLD}🎯 SAFETY SCORE   :${RESET} ${scoreColor}${BOLD}${report.safetyScore} / 100 [${report.safetyVerdict}]${RESET}
`);

  if (security.riskWarnings.length > 0) {
    console.log(`  ${BOLD}${YELLOW}⚠️  Peringatan Risiko Terdeteksi:${RESET}`);
    security.riskWarnings.forEach((w) => console.log(`     • ${YELLOW}${w}${RESET}`));
    console.log();
  }

  console.log(`  ${BOLD}⚡ TAUTAN CEPAT BOT SNIPER & CHART:${RESET}
  • 🦄 DexScreener : ${CYAN}${sniperLinks.dexScreener}${RESET}
  • 🔎 Explorer    : ${CYAN}${sniperLinks.explorer}${RESET}
  • 🔫 Maestro Bot : ${CYAN}${sniperLinks.maestro}${RESET}
  • 🍌 Banana Gun  : ${CYAN}${sniperLinks.bananaGun}${RESET}
  • 📈 GMGN.ai     : ${CYAN}${sniperLinks.gmgn}${RESET}
  • ⚡ Photon      : ${CYAN}${sniperLinks.photon}${RESET}`);

  if (sniperLinks.trojan) {
    console.log(`  • ⚔️ Trojan Bot  : ${CYAN}${sniperLinks.trojan}${RESET}`);
  }
  if (market.socials.website || market.socials.twitter || market.socials.telegram) {
    console.log(`
  ${BOLD}🌐 TAUTAN SOSIAL DEV:${RESET}`);
    if (market.socials.website) console.log(`  • Website  : ${market.socials.website}`);
    if (market.socials.twitter) console.log(`  • Twitter  : ${market.socials.twitter}`);
    if (market.socials.telegram) console.log(`  • Telegram : ${market.socials.telegram}`);
  }

  console.log(`
${BOLD}${CYAN}=================================================================${RESET}
`);
}

async function promptUserForAddress(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("\n📝 Masukkan Alamat Kontrak (CA) yang ingin di-scan: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const chainArg = args.find((a) => a.startsWith("--chain="));
  const chainOverride = chainArg ? chainArg.split("=")[1]?.trim() : undefined;

  let targetCa = args.find((a) => !a.startsWith("--"));

  if (!targetCa || targetCa.trim().length === 0) {
    if (isJson) {
      console.error(JSON.stringify({ error: "Missing contract address (CA)" }));
      process.exit(1);
    }
    targetCa = await promptUserForAddress();
  }

  if (!targetCa || targetCa.trim().length === 0) {
    console.log("\n❌ Pemindaian dibatalkan: Alamat kontrak kosong.");
    process.exit(0);
  }

  if (!isJson) {
    console.log(`\n⏳ Mengaudit CA \x1b[36m${targetCa}\x1b[0m via DexScreener & GoPlus Security...`);
  }

  try {
    const report = await analyzeContractAddress(targetCa, chainOverride);

    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      renderReportCard(report);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const nextAction = await new Promise<string>((resolve) => {
        rl.question(
          `\n${BOLD}PILIH TINDAKAN SELANJUTNYA:${RESET}\n  [W] Generate Website 3D & Profil DexScreener untuk CA ini\n  [B] Buka DexScreener Chart di Browser\n  [Q] Selesai & Keluar\n\nPilihan [W/B/Q]: `,
          (ans) => {
            rl.close();
            resolve(ans.trim().toUpperCase());
          }
        );
      });

      if (nextAction === "W") {
        console.log(`\n🚀 Meluncurkan Generator Website untuk $${report.market.tokenSymbol || "TOKEN"} (${targetCa})...\n`);
        const { spawn } = await import("child_process");
        const bunBin = process.platform === "win32" ? "bun.cmd" : "bun";
        const child = spawn(bunBin, ["run", "scripts/generate-token-website.ts", targetCa], {
          stdio: "inherit",
          shell: true,
        });
        await new Promise<void>((resolve) => {
          child.on("close", () => resolve());
        });
      } else if (nextAction === "B") {
        const { exec } = await import("child_process");
        const startCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
        exec(`${startCmd} ${report.sniperLinks.dexScreener}`);
      }
    }
  } catch (err: any) {
    if (isJson) {
      console.error(JSON.stringify({ error: err?.message || String(err) }));
    } else {
      console.error(`\n❌ Gagal memindai CA: ${err?.message || err}`);
    }
    process.exit(1);
  }
}

main();
