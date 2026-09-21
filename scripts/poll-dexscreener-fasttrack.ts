/**
 * scripts/poll-dexscreener-fasttrack.ts
 *
 * Windows CLI Poller for DexScreener Fast-Track Status & On-Chain Security Audit.
 * Multi-Chain (Base, Solana, etc.)
 *
 * Usage:
 *   bun run scripts/poll-dexscreener-fasttrack.ts [TICKER_OR_CA]
 *   bun run scripts/poll-dexscreener-fasttrack.ts --fleet
 *   bun run scripts/poll-dexscreener-fasttrack.ts --json
 */

import {
  pollTokenFastTrackStatus,
  pollFleetFastTrackStatus,
  type FastTrackPollingResult,
} from "../src/modules/intelligence/dexscreener-fasttrack-poller.ts";

// ANSI Color Codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BG_GREEN = "\x1b[42m\x1b[30m";
const BG_RED = "\x1b[41m\x1b[37m";

function renderResultCard(res: FastTrackPollingResult): void {
  const paidBadge = res.isDexScreenerPaid
    ? `${BG_GREEN} PAID PROFILE APPROVED ${RESET} ${GREEN}(Boosts: ${res.dexScreenerBoostCount})${RESET}`
    : `${BG_RED} UNPAID / PENDING ${RESET} ${YELLOW}(Fast-track submitted or pending payment)${RESET}`;

  const botBadge = res.sniperBotReady
    ? `${GREEN}${BOLD}YES — SAFE FOR TRADING BOTS (Score: ${res.safetyScore}/100)${RESET}`
    : `${RED}${BOLD}CAUTION (Score: ${res.safetyScore}/100 - Review Warnings)${RESET}`;

  console.log(`
${BOLD}${CYAN}=================================================================${RESET}
${BOLD}${CYAN}   DEXSCREENER FAST-TRACK & CONTRACT SECURITY AUDIT REPORT${RESET}
${BOLD}${CYAN}=================================================================${RESET}
  ${BOLD}Token Name        :${RESET} ${res.name} (${BOLD}$${res.ticker}${RESET})
  ${BOLD}Contract (CA)     :${RESET} ${CYAN}${res.contractAddress}${RESET}
  ${BOLD}Network           :${RESET} ${res.chain.toUpperCase()}
  ${BOLD}Audit Timestamp   :${RESET} ${res.timestamp}

${BOLD}-----------------------------------------------------------------${RESET}
  ${BOLD}DEX POOL STATUS   :${RESET} ${res.pairCreated ? `${GREEN}LIVE POOL (${res.pairAddress})${RESET}` : `${YELLOW}AWAITING FIRST SWAP / UNINDEXED${RESET}`}
  ${BOLD}PRICE (USD)       :${RESET} ${res.priceUsd ? `$${res.priceUsd}` : "N/A"}
  ${BOLD}LIQUIDITY         :${RESET} $${res.liquidityUsd.toLocaleString()} USD
  ${BOLD}MARKET CAP (FDV)  :${RESET} $${res.marketCapUsd.toLocaleString()} USD
  ${BOLD}VOLUME 24H        :${RESET} $${res.volume24hUsd.toLocaleString()} USD

${BOLD}-----------------------------------------------------------------${RESET}
  ${BOLD}DEXSCREENER STATUS:${RESET}
  ${paidBadge}
  ${DIM}Profile Approved: ${res.dexScreenerProfileApproved ? "YES" : "NO"} | Active Boosts: ${res.dexScreenerBoostCount}${RESET}

${BOLD}-----------------------------------------------------------------${RESET}
  ${BOLD}GOPLUS AUDIT SCORE:${RESET} ${res.safetyScore} / 100 [${res.safetyVerdict}]
  ${BOLD}BOT READINESS     :${RESET} ${botBadge}
  ${BOLD}NEON CLOUD SYNC   :${RESET} ${res.neonSynced ? `${GREEN}SYNCHRONIZED [token_${res.ticker.toLowerCase()}]${RESET}` : `${YELLOW}LOCAL ONLY / OFFLINE${RESET}`}
${BOLD}=================================================================${RESET}
`);

  if (res.riskWarnings.length > 0) {
    console.log(`  ${BOLD}${YELLOW}Security Warnings:${RESET}`);
    res.riskWarnings.forEach((w) => console.log(`   - ${YELLOW}${w}${RESET}`));
    console.log();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const isFleet = args.includes("--fleet");
  const target = args.find((a) => !a.startsWith("--"));

  try {
    if (isFleet) {
      const results = await pollFleetFastTrackStatus();
      if (isJson) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        results.forEach(renderResultCard);
      }
    } else {
      const result = await pollTokenFastTrackStatus(target);
      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        renderResultCard(result);
      }
    }
  } catch (err: any) {
    if (isJson) {
      console.error(JSON.stringify({ error: err?.message || String(err) }));
    } else {
      console.error(`\n[ERROR] Gagal memindai Fast-Track: ${err?.message || err}`);
    }
    process.exit(1);
  }
}

main();
