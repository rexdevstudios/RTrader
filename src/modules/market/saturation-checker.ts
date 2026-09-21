/**
 * saturation-checker.ts — Anti-Saturasi: Cek apakah ticker sudah terlalu
 * banyak dipasarkan di DexScreener sebelum kita deploy.
 *
 * Logika: Jika ada ≥ 3 token dengan ticker yang sama dibuat
 * dalam 2 jam terakhir → pasar sudah jenuh → batalkan deploy.
 *
 * Sumber data: DexScreener public API (tidak butuh API key).
 */
import axios from "axios";
import { logger } from "../../logger.ts";
import {
  analyzeCloneCluster,
  evaluateCloneMatch,
  type CloneClusterAnalysis,
} from "./clone-resolver.ts";

const DEXSCREENER_SEARCH = "https://api.dexscreener.com/latest/dex/search";
const SATURATION_THRESHOLD = 3;       // Jumlah token serupa yang dianggap jenuh
const SATURATION_WINDOW_HOURS = 2;    // Rentang waktu pengecekan (jam)

interface DexPair {
  chainId?: string;       // e.g. "base", "solana", "ethereum", "bsc", etc.
  pairCreatedAt?: number; // Unix ms
  baseToken?: { symbol?: string; name?: string };
}

interface DexSearchResponse {
  pairs?: DexPair[];
}

export interface SaturationResult {
  saturated: boolean;
  count: number;
  message: string;
}

export interface ChainSaturationDetail {
  chain: string;
  observedCount: number;
  saturated: boolean;
}

export interface CrossChainSaturationResult extends SaturationResult {
  byChain: Record<string, ChainSaturationDetail>;
  observedChains: string[];
  timestamp: string;
  source: string;
  providerStatus: "available" | "unavailable";
  cloneCluster?: CloneClusterAnalysis;
}

/**
 * Checks ticker saturation across supported blockchains using DexScreener search.
 * Produces global count + chain-level observational breakdown without modifying deployment decisions.
 */
export async function checkCrossChainSaturation(
  ticker: string,
  targetChains: string[] = ["base", "solana"]
): Promise<CrossChainSaturationResult> {
  const timestamp = new Date().toISOString();
  const source = "dexscreener";

  try {
    logger.info(`🔍 Mengecek saturasi lintas-chain untuk $${ticker}...`);

    const response = await axios.get<DexSearchResponse>(DEXSCREENER_SEARCH, {
      params: { q: ticker },
      timeout: 10000,
    });

    const pairs = response.data.pairs ?? [];
    const windowMs = SATURATION_WINDOW_HOURS * 60 * 60 * 1000;
    const cutoffMs = Date.now() - windowMs;

    // Filter recent matches for ticker within window (exact + clone lookalikes)
    const recentMatches = pairs.filter((p) => {
      const createdAt = p.pairCreatedAt ?? 0;
      const symbolMatch =
        (p.baseToken?.symbol ?? "").toUpperCase() === ticker.toUpperCase();
      const cloneEval = evaluateCloneMatch(
        ticker,
        undefined,
        p.baseToken?.symbol ?? "",
        p.baseToken?.name
      );
      return (symbolMatch || cloneEval.isMatch) && createdAt > cutoffMs;
    });

    const cloneCluster = analyzeCloneCluster(
      ticker,
      undefined,
      pairs.filter((p) => (p.pairCreatedAt ?? 0) > cutoffMs)
    );

    const count = recentMatches.length;

    // Aggregate matches by chain
    const chainMatchMap: Record<string, number> = {};
    for (const p of recentMatches) {
      const chain = (p.chainId ?? "unknown").toLowerCase();
      chainMatchMap[chain] = (chainMatchMap[chain] ?? 0) + 1;
    }

    const observedChains = Object.keys(chainMatchMap).sort();

    // Build chain details for targetChains + any other observed chains
    const allChains = Array.from(new Set([...targetChains.map((c) => c.toLowerCase()), ...observedChains])).sort();
    const byChain: Record<string, ChainSaturationDetail> = {};

    for (const ch of allChains) {
      const observedCount = chainMatchMap[ch] ?? 0;
      byChain[ch] = {
        chain: ch,
        observedCount,
        saturated: observedCount >= SATURATION_THRESHOLD,
      };
    }

    const isSwarmOrContested =
      cloneCluster.clusterStatus === "SWARM" ||
      cloneCluster.clusterStatus === "CONTESTED";
    const saturated = count >= SATURATION_THRESHOLD || isSwarmOrContested;
    const message = saturated
      ? `${count} token serupa $${ticker} terdeteksi dalam ${SATURATION_WINDOW_HOURS} jam terakhir (${cloneCluster.clusterStatus})`
      : "OK";

    if (cloneCluster.hasHomoglyphs) {
      logger.warn(
        `🚨 [ANTI-VAMP] Terdeteksi peniruan ticker/nama menggunakan karakter homoglif (lookalike) pada $${ticker}!`
      );
    }

    if (saturated) {
      logger.warn(
        `⚠️  $${ticker} JENUH: ${count} token serupa dalam ${SATURATION_WINDOW_HOURS} jam terakhir across chains: ${observedChains.join(", ") || "none"} [Status: ${cloneCluster.clusterStatus}].`
      );
    } else {
      logger.info(`✅ $${ticker} aman: ${count} token serupa (batas: ${SATURATION_THRESHOLD})`);
    }

    return {
      saturated,
      count,
      message,
      byChain,
      observedChains,
      timestamp,
      source,
      providerStatus: "available",
      cloneCluster,
    };
  } catch (err) {
    // If DexScreener is down, preserve non-blocking behavior but explicitly flag providerStatus: "unavailable"
    logger.warn(`⚠️  Saturation check gagal (dilanjutkan): ${String(err)}`);
    const byChain: Record<string, ChainSaturationDetail> = {};
    for (const ch of targetChains) {
      byChain[ch.toLowerCase()] = {
        chain: ch.toLowerCase(),
        observedCount: 0,
        saturated: false,
      };
    }

    return {
      saturated: false,
      count: 0,
      message: "check failed — skipped",
      byChain,
      observedChains: [],
      timestamp,
      source,
      providerStatus: "unavailable",
      cloneCluster: undefined,
    };
  }
}

export async function checkSaturation(ticker: string): Promise<CrossChainSaturationResult> {
  return checkCrossChainSaturation(ticker);
}
