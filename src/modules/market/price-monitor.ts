/**
 * price-monitor.ts — Exit Strategy & Position Verification.
 *
 * Rules:
 *  - Atomic transitions: POSITION_OPEN -> POSITION_CLOSING.
 *  - Concurrent workers cannot both submit sell (second worker receives conflict/no-op).
 *  - Does NOT mark POSITION_CLOSED merely because sell request was sent.
 *  - Maintains POSITION_CLOSING until confirmed in Task 3 reconciliation.
 */
import axios from "axios";
import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import {
  getOpenPositions,
  updatePositionEntryPrice,
  transitionPositionState,
  type ActivePosition,
} from "../../db/vault.ts";
import { sellToken } from "../sniper/basedbot-sniper.ts";
import { evaluateSellDispatch } from "../reconciliation/lifecycle-policy.ts";

const DEXSCREENER_PAIRS = "https://api.dexscreener.com/latest/dex/pairs";

interface DexPairData {
  priceUsd?: string;
}
interface DexPairsResponse {
  pairs?: DexPairData[];
}

export async function fetchPriceUsd(
  chain: string,
  contractAddr: string
): Promise<number | null> {
  const chainMap: Record<string, string> = {
    base: "base",
    solana: "solana",
    bsc: "bsc",
    ethereum: "ethereum",
    robinhood: "robinhood",
  };
  const dexChain = chainMap[chain] ?? chain;

  try {
    // 1. Query token endpoint first (DexScreener standard for Token Contract Addresses)
    const tokenRes = await axios.get<DexPairsResponse>(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddr}`,
      { timeout: 8000 }
    ).catch(() => null);

    const tokenPriceStr = tokenRes?.data?.pairs?.[0]?.priceUsd;
    if (tokenPriceStr) {
      const parsed = parseFloat(tokenPriceStr);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    // 2. Fallback to pair endpoint (in case contractAddr is a liquidity pool address)
    const pairRes = await axios.get<DexPairsResponse>(
      `${DEXSCREENER_PAIRS}/${dexChain}/${contractAddr}`,
      { timeout: 8000 }
    ).catch(() => null);

    const pairPriceStr = pairRes?.data?.pairs?.[0]?.priceUsd;
    if (pairPriceStr) {
      const parsed = parseFloat(pairPriceStr);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }

    return null;
  } catch {
    return null;
  }
}

export async function handlePosition(pos: ActivePosition): Promise<void> {
  const cfg = getConfig();
  const price = await fetchPriceUsd(pos.chain, pos.contractAddr);

  if (price === null) {
    logger.warn(`⚠️  [MONITOR] Harga $${pos.ticker} tidak tersedia — skip.`);
    return;
  }

  // Positions in buy_submitted must be verified by on-chain reconciler balance check, not price discovery alone
  if (pos.status === "buy_submitted") {
    if (!pos.entryPrice) {
      updatePositionEntryPrice(pos.contractAddr, price);
    }
    logger.info(`⏳ [MONITOR] Posisi $${pos.ticker} masih menunggu verifikasi saldo on-chain (BUY_SUBMITTED).`);
    return;
  }

  // If already in closing state, do not send duplicate sell orders
  if (pos.status === "closing") {
    logger.info(`⏳ [MONITOR] Posisi $${pos.ticker} sedang berstatus POSITION_CLOSING — menunggu verifikasi exit.`);
    return;
  }

  if (pos.status !== "open") {
    return;
  }

  // Record entry price if not set
  if (!pos.entryPrice) {
    updatePositionEntryPrice(pos.contractAddr, price);
    logger.info(`📌 [MONITOR] Entry price $${pos.ticker}: $${price.toFixed(6)}`);
    return;
  }

  const entry = pos.entryPrice;
  const tpPrice = entry * pos.takeProfitX;
  const slPrice = entry * (1 - pos.stopLossPct);

  logger.info(
    `👁️  [MONITOR] $${pos.ticker}: now=$${price.toFixed(6)} ` +
      `| TP=$${tpPrice.toFixed(6)} | SL=$${slPrice.toFixed(6)}`
  );

  if (price >= tpPrice) {
    logger.success(`💰 TAKE PROFIT! $${pos.ticker} mencapai target ${pos.takeProfitX}x ($${price.toFixed(6)})`);

    // Atomic transition from 'open' -> 'closing' storing exitPrice for PnL calculation
    const transitioned = transitionPositionState(pos.contractAddr, "open", "closing", {
      exitReason: "take_profit",
      exitPrice: price,
    });

    if (!transitioned) {
      logger.warn(`⚠️  [MONITOR] Posisi $${pos.ticker} sudah ditransisikan oleh proses lain. Skip duplicate sell.`);
      return;
    }

    const sent = await sellToken(pos.contractAddr, pos.chain, pos.ticker, "take_profit");
    const dispatchEval = evaluateSellDispatch({
      status: "closing",
      dispatchSuccess: sent,
    });
    if (dispatchEval.action === "ROLLBACK_SELL") {
      transitionPositionState(pos.contractAddr, "closing", "open", {
        exitReason: null as any,
        exitPrice: null as any,
      });
      logger.warn(
        `⚠️  [MONITOR] Perintah sell $${pos.ticker} gagal terkirim ke BasedBot. Rolled back closing -> open.`
      );
    }
  } else if (price <= slPrice) {
    logger.warn(
      `🛑 STOP LOSS! $${pos.ticker} turun ${(pos.stopLossPct * 100).toFixed(0)}% ($${price.toFixed(6)})`
    );

    // Atomic transition from 'open' -> 'closing' storing exitPrice for PnL calculation
    const transitioned = transitionPositionState(pos.contractAddr, "open", "closing", {
      exitReason: "stop_loss",
      exitPrice: price,
    });

    if (!transitioned) {
      logger.warn(`⚠️  [MONITOR] Posisi $${pos.ticker} sudah ditransisikan oleh proses lain. Skip duplicate sell.`);
      return;
    }

    const sent = await sellToken(pos.contractAddr, pos.chain, pos.ticker, "stop_loss");
    const dispatchEval = evaluateSellDispatch({
      status: "closing",
      dispatchSuccess: sent,
    });
    if (dispatchEval.action === "ROLLBACK_SELL") {
      transitionPositionState(pos.contractAddr, "closing", "open", {
        exitReason: null as any,
        exitPrice: null as any,
      });
      logger.warn(
        `⚠️  [MONITOR] Perintah sell $${pos.ticker} gagal terkirim ke BasedBot. Rolled back closing -> open.`
      );
    }
  }
}

/**
 * Entry point: dipanggil dari cron setiap 5 menit di index.ts.
 */
export async function checkAndExecuteExits(): Promise<void> {
  const positions = getOpenPositions();

  if (positions.length === 0) return;

  logger.info(`👁️  [MONITOR] Mengecek ${positions.length} posisi aktif...`);

  // Proses tiap posisi secara sequential untuk menghindari rate limit DexScreener
  for (const pos of positions) {
    await handlePosition(pos);
    await new Promise((r) => setTimeout(r, 1500)); // Jeda 1.5 detik antar request
  }
}
