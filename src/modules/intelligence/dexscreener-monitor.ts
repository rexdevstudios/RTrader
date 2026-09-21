/**
 * src/modules/intelligence/dexscreener-monitor.ts
 *
 * DexScreener Official Profile & Boost Activation Monitor.
 *
 * Checks whether a deployed token's profile order has been approved
 * or has active community boosts on DexScreener using public API endpoints.
 * Dispatches real-time proof cards to Telegram/Discord via beacon-broadcaster.ts.
 *
 * 100% Zero-Gas & Free Public API.
 */

import { logger } from "../../logger.ts";
import {
  analyzeContractAddress,
  type CaIntelligenceReport,
} from "./ca-intelligence.ts";
import {
  dispatchBeaconCard,
  type BroadcastResult,
} from "../social/beacon-broadcaster.ts";
import { getAllDeployLogs } from "../../db/vault.ts";

export interface DexScreenerStatusSummary {
  contractAddress: string;
  chain: string;
  tokenName: string;
  tokenSymbol: string;
  isPaid: boolean;
  isProfileApproved: boolean;
  boostCount: number;
  statusText: string;
  pairAddress?: string;
  priceUsd: string;
  safetyScore: number;
  safetyVerdict: string;
  dexUrl?: string;
  lastChecked: string;
}

/**
 * Checks DexScreener profile status and community boosts for a target contract address.
 */
export async function checkTokenDexScreenerStatus(
  contractAddress: string,
  chain = "base"
): Promise<{
  report: CaIntelligenceReport;
  summary: DexScreenerStatusSummary;
}> {
  const report = await analyzeContractAddress(contractAddress, chain);

  const summary: DexScreenerStatusSummary = {
    contractAddress: report.contractAddress,
    chain: report.chain,
    tokenName: report.market.tokenName || "Unknown Token",
    tokenSymbol: report.market.tokenSymbol || "TOKEN",
    isPaid: report.isDexScreenerPaid,
    isProfileApproved: report.dexScreenerProfileApproved,
    boostCount: report.dexScreenerBoostCount,
    statusText: report.dexScreenerStatusText,
    pairAddress: report.market.pairAddress,
    priceUsd: report.market.priceUsd,
    safetyScore: report.safetyScore,
    safetyVerdict: report.safetyVerdict,
    dexUrl: report.market.dexUrl || `https://dexscreener.com/${report.chain}/${report.contractAddress}`,
    lastChecked: new Date().toISOString(),
  };

  return { report, summary };
}

/**
 * Formats a Discord / Telegram social proof card for DexScreener activation or boost event.
 */
export function formatDexScreenerActivationCard(
  report: CaIntelligenceReport,
  previousBoostCount = 0
): string {
  const m = report.market;
  const boostIncreased = report.dexScreenerBoostCount > previousBoostCount;
  const headerIcon = report.dexScreenerProfileApproved ? "💎" : "🚀";
  const headerTitle = report.dexScreenerProfileApproved
    ? "DEXSCREENER OFFICIAL PROFILE ACTIVATED!"
    : boostIncreased
    ? "NEW DEXSCREENER BOOST RECEIVED!"
    : "DEXSCREENER ORDER STATUS UPDATE";

  const lines = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `${headerIcon} [${headerTitle}] ${headerIcon}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🪙 Token:        $${m.tokenSymbol} (${m.tokenName || "Official"})`,
    `⛓️  Jaringan:     ${report.chain.toUpperCase()} (Chain ID: ${report.detectedChainId})`,
    `📍 CA:           \`${report.contractAddress}\``,
    `📊 Status Order: ${report.dexScreenerStatusText}`,
    `⚡ Active Boost: ${report.dexScreenerBoostCount}x Multiplier`,
    `🛡️  Safety Score: ${report.safetyScore}/100 (${report.safetyVerdict})`,
    `💰 Harga / FDV:  $${m.priceUsd} | FDV: $${Number(m.fdvUsd || 0).toLocaleString("en-US")}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔗 Live Chart:    ${m.dexUrl || `https://dexscreener.com/${report.chain}/${report.contractAddress}`}`,
    `🛒 1-Click Buy:   ${report.sniperLinks.gmgn || report.sniperLinks.photon}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🤖 Autonomous Fleet Growth Engine • Zero Gas`,
  ];

  return lines.join("\n");
}

/**
 * Broadcasts an alert card when a token's DexScreener profile or boost status activates.
 */
export async function broadcastDexScreenerActivation(
  report: CaIntelligenceReport,
  previousBoostCount = 0
): Promise<BroadcastResult> {
  const cardText = formatDexScreenerActivationCard(report, previousBoostCount);
  logger.info(
    `[DexScreenerMonitor] Memancarkan update status untuk $${report.market.tokenSymbol} (${report.contractAddress})`
  );
  return dispatchBeaconCard(cardText);
}

// In-memory state tracking to detect milestone transitions between cycles
const knownTokenStates = new Map<string, { approved: boolean; boosts: number }>();

/**
 * Background Watchdog: Periodically monitors active tokens for DexScreener
 * profile approval and community boost increments.
 */
export async function runDexScreenerWatchdog(options?: {
  maxTokens?: number;
  autoTriggerVolumeSpark?: boolean;
}): Promise<{
  checked: number;
  activations: number;
  errors: number;
}> {
  const max = options?.maxTokens ?? 5;
  const logs = getAllDeployLogs({ status: "confirmed" });
  const liveTokens = logs
    .filter((l) => l.contractAddr && l.contractAddr.length >= 32 && !l.simulated)
    .slice(0, max);

  let checked = 0;
  let activations = 0;
  let errors = 0;

  logger.info(`[DexScreenerWatchdog] Memulai pemantauan untuk ${liveTokens.length} token aktif...`);

  for (const t of liveTokens) {
    const ca = t.contractAddr!;
    const chain = t.chain || "base";
    checked++;

    try {
      const { report } = await checkTokenDexScreenerStatus(ca, chain);
      const prevState = knownTokenStates.get(ca.toLowerCase());

      const isNewlyApproved = report.dexScreenerProfileApproved && (!prevState || !prevState.approved);
      const prevBoosts = prevState ? prevState.boosts : 0;
      const hasMoreBoosts = report.dexScreenerBoostCount > prevBoosts && prevBoosts > 0;

      if (isNewlyApproved || hasMoreBoosts) {
        activations++;
        logger.success(
          `[DexScreenerWatchdog] Milestone terdeteksi untuk $${report.market.tokenSymbol}: ` +
            (isNewlyApproved ? "PROFIL DISETUJUI! " : "") +
            (hasMoreBoosts ? `BOOST MENINGKAT: ${report.dexScreenerBoostCount}x ` : "")
        );
        await broadcastDexScreenerActivation(report, prevBoosts);

        // Auto-Trigger Volume Spark: 5 rounds of micro-buys to spark unique makers on DexScreener
        if (options?.autoTriggerVolumeSpark !== false) {
          try {
            const { runTrendingBoostCycle } = await import("../growth/trending-booster.ts");
            logger.info(`[DexScreenerWatchdog] ⚡ Memulai Volume Spark otomatis untuk $${report.market.tokenSymbol}...`);
            await runTrendingBoostCycle({
              tokenAddress: ca,
              tokenSymbol: report.market.tokenSymbol,
              liquidityUsd: report.market.liquidityUsd,
              rounds: 5,
            });
          } catch (sparkErr: any) {
            logger.warn(`[DexScreenerWatchdog] Volume spark notice: ${sparkErr?.message || sparkErr}`);
          }
        }
      }

      knownTokenStates.set(ca.toLowerCase(), {
        approved: report.dexScreenerProfileApproved,
        boosts: report.dexScreenerBoostCount,
      });
    } catch (err: any) {
      errors++;
      logger.warn(`[DexScreenerWatchdog] Gagal memeriksa ${t.ticker} (${ca}): ${err?.message || err}`);
    }
  }

  logger.info(
    `[DexScreenerWatchdog] Selesai. Diperiksa: ${checked}, Aktivasi: ${activations}, Gagal: ${errors}`
  );
  return { checked, activations, errors };
}

// CLI runner if executed directly
if (import.meta.main || (process.argv[1] && process.argv[1].includes("dexscreener-monitor.ts"))) {
  const caArg = process.argv[2];
  const chainArg = process.argv[3] || "base";

  if (!caArg) {
    console.log("Penggunaan: bun run src/modules/intelligence/dexscreener-monitor.ts <CONTRACT_ADDRESS> [chain]");
    process.exit(1);
  }

  console.log(`\n🔍 Memeriksa status DexScreener untuk CA: ${caArg} (${chainArg})...\n`);
  checkTokenDexScreenerStatus(caArg, chainArg)
    .then(({ report, summary }) => {
      console.log(formatDexScreenerActivationCard(report));
      console.log("\nRingkasan Terstruktur:", JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error("Gagal memeriksa status DexScreener:", err.message);
      process.exit(1);
    });
}
