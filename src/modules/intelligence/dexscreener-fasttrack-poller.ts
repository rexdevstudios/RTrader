/**
 * src/modules/intelligence/dexscreener-fasttrack-poller.ts
 *
 * Automated DexScreener Fast-Track Status Poller & Security Audit Engine.
 * Monitors:
 *  1. DexScreener Pair Indexing & Liquidity
 *  2. DexScreener Orders Status (/orders/v1 paid profile / boosts)
 *  3. On-Chain GoPlus Security Audit (Honeypot, Taxes, Ownership, Mintable)
 *  4. Synchronizes telemetry & status to SQLite local and Neon PostgreSQL cloud.
 */

import { logger } from "../../logger.ts";
import {
  analyzeContractAddress,
  type CaIntelligenceReport,
} from "./ca-intelligence.ts";
import {
  recordTokenTelemetry,
  syncTokenDeploymentToNeon,
  isNeonConfigured,
} from "../../db/neon-vault.ts";
import { resolveTargetToken, getLiveDeployments } from "../fleet/fleet-registry.ts";
import { updateDeployLogWebsite, resolveDbPath } from "../../db/vault.ts";
import { Database } from "bun:sqlite";
import { broadcastSniperReadyAlert } from "../social/beacon-broadcaster.ts";

export interface FastTrackPollingResult {
  ticker: string;
  name: string;
  contractAddress: string;
  chain: string;
  timestamp: string;
  pairAddress?: string;
  pairCreated: boolean;
  priceUsd: string;
  liquidityUsd: number;
  volume24hUsd: number;
  marketCapUsd: number;
  isDexScreenerPaid: boolean;
  dexScreenerProfileApproved: boolean;
  dexScreenerBoostCount: number;
  safetyScore: number;
  safetyVerdict: "VERY_SAFE" | "MODERATE" | "HIGH_RISK" | "DANGEROUS_HONEYPOT";
  sniperBotReady: boolean;
  sniperAlertSent?: boolean;
  neonSynced: boolean;
  riskWarnings: string[];
}

/**
 * Polls DexScreener and on-chain security for a single token.
 */
export async function pollTokenFastTrackStatus(
  input?: string,
  chainOverride?: string,
  options?: { autoBroadcastAlert?: boolean }
): Promise<FastTrackPollingResult> {
  const target = resolveTargetToken(input);
  const chain = chainOverride || target.chain || "base";

  logger.info(`🔍 [FAST-TRACK POLLER] Mengaudit $${target.ticker} (${target.address}) pada chain ${chain.toUpperCase()}...`);

  // 1. Jalankan audit CA intelijen (DexScreener + GoPlus)
  const intel: CaIntelligenceReport = await analyzeContractAddress(target.address, chain);

  const isPairCreated = Boolean(intel.market.pairAddress && intel.market.pairAddress !== "");
  const sniperBotReady =
    intel.safetyScore >= 80 &&
    !intel.security.isHoneypot &&
    !intel.security.cannotSellAll &&
    intel.security.sellTaxPct <= 5;

  // 2. Sinkronkan snapshot metrik ke database SQLite lokal
  try {
    const db = new Database(resolveDbPath());
    if (intel.market.pairAddress) {
      db.query(
        `UPDATE deploy_logs SET pool_id = ? WHERE contract_addr = ? AND (pool_id IS NULL OR pool_id = '')`
      ).run(intel.market.pairAddress, target.address);
    }
    db.close();
  } catch (dbErr: any) {
    logger.warn(`[FAST-TRACK POLLER] SQLite notice: ${dbErr?.message || dbErr}`);
  }

  // 3. Sinkronkan snapshot metrik ke Neon Cloud Database (token_<ticker>)
  let neonSynced = false;
  if (isNeonConfigured()) {
    try {
      // Rekam telemetri harga & likuiditas
      await recordTokenTelemetry(target.ticker, {
        contractAddr: target.address,
        priceUsd: parseFloat(intel.market.priceUsd) || 0,
        liquidityUsd: intel.market.liquidityUsd,
        volume24hUsd: intel.market.volume24h,
        marketCapUsd: intel.market.fdvUsd,
        holderCount: intel.security.holderCount,
      });

      // Update identitas token jika ada info baru
      await syncTokenDeploymentToNeon({
        contractAddr: target.address,
        ticker: target.ticker,
        tokenName: target.name,
        chain,
        poolId: intel.market.pairAddress,
        dexUrl: intel.market.dexUrl,
      });

      neonSynced = true;
    } catch (neonErr: any) {
      logger.warn(`[FAST-TRACK POLLER] Neon sync notice: ${neonErr?.message || neonErr}`);
    }
  }

  // 4. Kirim alert sniper bot jika kondisi terpenuhi dan opsi broadcast aktif
  let sniperAlertSent = false;
  if (sniperBotReady && isPairCreated && options?.autoBroadcastAlert) {
    try {
      const sniperLinks: Array<{ name: string; url: string }> = [];
      if (intel.sniperLinks) {
        if (intel.sniperLinks.gmgn) sniperLinks.push({ name: "GMGN", url: intel.sniperLinks.gmgn });
        if (intel.sniperLinks.photon) sniperLinks.push({ name: "Photon", url: intel.sniperLinks.photon });
        if (intel.sniperLinks.bananaGun) sniperLinks.push({ name: "Banana Gun", url: intel.sniperLinks.bananaGun });
        if (intel.sniperLinks.maestro) sniperLinks.push({ name: "Maestro", url: intel.sniperLinks.maestro });
        if (intel.sniperLinks.trojan) sniperLinks.push({ name: "Trojan", url: intel.sniperLinks.trojan });
      }

      const alertRes = await broadcastSniperReadyAlert({
        ticker: target.ticker,
        name: target.name,
        contractAddress: target.address,
        chain,
        safetyScore: intel.safetyScore,
        safetyVerdict: intel.safetyVerdict,
        liquidityUsd: intel.market.liquidityUsd,
        pairAddress: intel.market.pairAddress,
        dexUrl: intel.market.dexUrl,
        sniperLinks,
      });

      sniperAlertSent = alertRes.telegramSent || alertRes.webhookDispatched;
    } catch (alertErr: any) {
      logger.warn(`[FAST-TRACK POLLER] Alert notice: ${alertErr?.message || alertErr}`);
    }
  }

  return {
    ticker: target.ticker,
    name: target.name,
    contractAddress: target.address,
    chain,
    timestamp: new Date().toISOString(),
    pairAddress: intel.market.pairAddress,
    pairCreated: isPairCreated,
    priceUsd: intel.market.priceUsd,
    liquidityUsd: intel.market.liquidityUsd,
    volume24hUsd: intel.market.volume24h,
    marketCapUsd: intel.market.fdvUsd,
    isDexScreenerPaid: intel.isDexScreenerPaid,
    dexScreenerProfileApproved: intel.dexScreenerProfileApproved,
    dexScreenerBoostCount: intel.dexScreenerBoostCount,
    safetyScore: intel.safetyScore,
    safetyVerdict: intel.safetyVerdict,
    sniperBotReady,
    sniperAlertSent,
    neonSynced,
    riskWarnings: intel.security.riskWarnings,
  };
}

/**
 * Polls status for the entire live fleet across all chains.
 */
export async function pollFleetFastTrackStatus(chain?: string): Promise<FastTrackPollingResult[]> {
  const fleet = getLiveDeployments(chain);
  const results: FastTrackPollingResult[] = [];

  logger.info(`🚀 [FAST-TRACK POLLER] Memulai pemindaian berkala untuk ${fleet.length} token armada...`);

  for (const token of fleet) {
    if (!token.contractAddr) continue;
    try {
      const res = await pollTokenFastTrackStatus(token.contractAddr, token.chain);
      results.push(res);
    } catch (err: any) {
      logger.warn(`⚠️ [FAST-TRACK POLLER] Gagal memindai $${token.ticker}: ${err?.message || err}`);
    }
  }

  return results;
}
