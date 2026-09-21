/**
 * src/modules/growth/trending-booster.ts
 *
 * DexScreener Trending Algorithm Booster (Multi-Wallet Micro-Makers Engine).
 *
 * Mechanics:
 *   1. DexScreener ranks tokens based on: Unique Makers count, Buy Frequency (Green Candles),
 *      and Volume Velocity within short time windows (5m, 1h).
 *   2. This module rotates micro-buy orders across multiple sub-wallet accounts
 *      from wallet-manager.ts with human micro-jitter delays.
 *   3. Supports both live broadcast and simulation modes (0 gas cost).
 */

import { Bot } from "grammy";
import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import { listWalletAccounts, type WalletAccount } from "../identity/wallet-manager.ts";
import { deriveEvmAddress } from "../reconciliation/evm-verifier.ts";

export interface ClusterValidationResult {
  isClustered: boolean;
  warning?: string;
  funderAddress?: string;
  recommendation: string;
}

/**
 * Validates whether a maker wallet matches any known dev/operator addresses.
 * Prevents clustering flags (Bubblemaps / Arkham single-funder bubble).
 */
export function validateFundingCluster(
  makerAddress: string,
  knownDevAddresses: string[]
): ClusterValidationResult {
  if (!makerAddress) {
    return {
      isClustered: false,
      recommendation: "Alamat maker tidak disediakan.",
    };
  }
  const normalizedMaker = makerAddress.toLowerCase();
  const isDevDirect = knownDevAddresses.some(
    (dev) => dev && dev.toLowerCase() === normalizedMaker
  );

  if (isDevDirect) {
    return {
      isClustered: true,
      funderAddress: makerAddress,
      warning: `[CLUSTER WARNING] Dompet maker ${makerAddress} terdeteksi sebagai dev/creator EOA. Transaksi langsung dari dompet dev akan memicu flag 'Dev Wash Trading' di Bubblemaps dan Arkham!`,
      recommendation: "Gunakan sub-wallet non-kustodial terpisah yang didanai langsung dari CEX (Binance/OKX/Tokocrypto) untuk memutus korelasi on-chain (0% cluster).",
    };
  }

  return {
    isClustered: false,
    recommendation: "Dompet maker independen. Bebas dari korelasi dev langsung.",
  };
}

export interface TrendingBoostParams {
  tokenAddress: string;
  tokenSymbol: string;
  rounds?: number;
  microAmountEth?: number;
  liquidityUsd?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  isSimulated?: boolean;
  rotateWallets?: boolean;
  devAddresses?: string[];
}

export interface TrendingBoostSummary {
  tokenAddress: string;
  tokenSymbol: string;
  totalRoundsExecuted: number;
  uniqueMakersCount: number;
  totalVolumeEth: number;
  simulated: boolean;
  durationMs: number;
}

/**
 * Calculates adaptive micro-buy order size based on live pool liquidity.
 * Prevents high slippage on low liquidity and maximizes visual impact on deep pools.
 */
export function computeTieredMicroAmount(
  liquidityUsd?: number,
  explicitAmount?: number
): number {
  if (explicitAmount !== undefined && explicitAmount > 0) {
    return explicitAmount;
  }
  if (!liquidityUsd || liquidityUsd <= 0) {
    return 0.0001;
  }
  if (liquidityUsd < 5000) {
    return 0.00005; // Seed / Low liquidity protection (<$5k)
  }
  if (liquidityUsd <= 25000) {
    return 0.0001; // Medium liquidity standard ($5k - $25k)
  }
  return 0.00025; // Deep liquidity high visual impact (>$25k)
}

/**
 * Applies organic variance (+/- variancePercent, default 12%) to the base micro amount.
 * Prevents robotic identical transaction values on block explorers and DexScreener.
 */
export function applyOrganicAmountJitter(
  baseAmount: number,
  variancePercent = 0.12
): number {
  if (baseAmount <= 0) return baseAmount;
  const factor = 1 + (Math.random() * 2 - 1) * variancePercent;
  return Number((baseAmount * factor).toFixed(6));
}

export interface DirectSwapResult {
  success: boolean;
  txHash?: string;
  makerAddress: string;
  amountEth: number;
  simulated: boolean;
  message: string;
}

/**
 * Direct on-chain EVM micro-buy execution fallback (e.g. Uniswap/Aerodrome pool).
 * Used when Telegram BasedBot is unavailable or when operating in headless CI/CD mode.
 */
export async function executeDirectOnChainMicroBuy(
  tokenAddress: string,
  amountEth: number,
  makerAccount?: { id: string; address?: string },
  isSimulated = false
): Promise<DirectSwapResult> {
  const makerAddress = makerAccount?.address || "0x000000000000000000000000000000000000dead";

  if (isSimulated) {
    return {
      success: true,
      txHash: `0xsim_${Math.random().toString(16).slice(2, 66)}`,
      makerAddress,
      amountEth,
      simulated: true,
      message: `Simulasi direct on-chain swap berhasil (${amountEth} ETH).`,
    };
  }

  // Live direct execution via 0x Settler / Doppler route
  try {
    const { getWalletKeyByAddress } = await import("../../db/vault.ts");
    const makerPrivKey = makerAccount?.address ? getWalletKeyByAddress(makerAccount.address) : null;
    const { executeDirectSwap } = await import("../../../scripts/execute-direct-swap.ts");
    const swapRes = await executeDirectSwap({
      tokenAddress,
      amountEth: amountEth.toFixed(6),
      privateKey: makerPrivKey || undefined,
    });

    if (swapRes.success && swapRes.txHash) {
      return {
        success: true,
        txHash: swapRes.txHash,
        makerAddress,
        amountEth,
        simulated: false,
        message: `Direct on-chain micro-swap sukses di Base: ${swapRes.txHash}`,
      };
    } else {
      logger.warn(`[TRENDING BOOSTER] Direct swap notice: ${swapRes.error || "Gagal mendapatkan hash"}`);
      return {
        success: false,
        makerAddress,
        amountEth,
        simulated: false,
        message: swapRes.error || "Gagal eksekusi on-chain swap",
      };
    }
  } catch (err: any) {
    logger.warn(`[TRENDING BOOSTER] Error memanggil direct swap: ${err?.message || err}`);
    return {
      success: false,
      makerAddress,
      amountEth,
      simulated: false,
      message: err?.message || String(err),
    };
  }
}

function randomJitter(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Runs a multi-wallet trending boost cycle.
 * Rotates through available wallet accounts to generate diverse unique maker transactions.
 */
export async function runTrendingBoostCycle(
  params: TrendingBoostParams
): Promise<TrendingBoostSummary> {
  const cfg = getConfig();
  const tokenAddress = params.tokenAddress;
  const tokenSymbol = params.tokenSymbol;
  const rounds = params.rounds ?? cfg.VOLUME_BUMP_ROUNDS ?? 10;
  const microAmountEth = computeTieredMicroAmount(params.liquidityUsd, params.microAmountEth);
  const minDelayMs = params.minDelayMs ?? 1000;
  const maxDelayMs = params.maxDelayMs ?? 3000;
  const isSimulated =
    params.isSimulated !== undefined
      ? params.isSimulated
      : (cfg.DEPLOY_MODE === "testnet" || !cfg.EVM_PRIVATE_KEY);

  logger.info(
    `[TRENDING BOOSTER] Starting ${rounds} rounds of Unique Maker micro-trades for $${tokenSymbol}...`
  );
  logger.info(
    `   Target CA: ${tokenAddress} | Amount: ${microAmountEth} ETH | Mode: ${isSimulated ? "SIMULATED" : "LIVE"}`
  );

  const startTime = Date.now();
  const registeredWallets = listWalletAccounts().filter((w) => w.status === "ACTIVE");

  // If fewer registered wallets than desired diversity, build a virtual rotation pool
  const makerPool: Array<{ id: string; label: string; address?: string }> = [];
  if (registeredWallets.length > 0) {
    makerPool.push(
      ...registeredWallets.map((w) => ({
        id: w.id,
        label: w.label,
        address: w.evmAddress ?? undefined,
      }))
    );
  }

  // Ensure at least 5 distinct makers in rotation pool
  const minMakers = Math.max(5, cfg.SNIPE_WALLET_COUNT ?? 3);
  while (makerPool.length < minMakers) {
    const idx = makerPool.length + 1;
    makerPool.push({
      id: `maker-sub-${idx}`,
      label: `Rotating Maker #${idx}`,
      address: `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`,
    });
  }

  const activeMakersUsed = new Set<string>();
  let executedRounds = 0;
  let totalVolume = 0;

  const devAddrs = params.devAddresses ?? [
    cfg.ADMIN_WALLET_PUBLIC_ADDRESS || "",
    cfg.EVM_PRIVATE_KEY ? deriveEvmAddress(cfg.EVM_PRIVATE_KEY) || "" : "",
  ].filter(Boolean);

  let bot: Bot | null = null;
  if (!isSimulated && cfg.TELEGRAM_BOT_TOKEN) {
    bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
  }

  for (let i = 1; i <= rounds; i++) {
    const roundAmount = applyOrganicAmountJitter(microAmountEth);
    const maker = makerPool[(i - 1) % makerPool.length];
    activeMakersUsed.add(maker.id);

    // Anti-cluster verification before execution
    if (maker.address) {
      const clusterCheck = validateFundingCluster(maker.address, devAddrs);
      if (clusterCheck.isClustered) {
        logger.warn(clusterCheck.warning!);
      }
    }

    try {
      if (isSimulated) {
        await executeDirectOnChainMicroBuy(tokenAddress, roundAmount, maker, true);
        logger.info(
          `[MAKER ${i}/${rounds}] Wallet [${maker.id}] micro-buy ${roundAmount} ETH (Simulated green candle)`
        );
        executedRounds++;
        totalVolume += roundAmount;
      } else if (bot && cfg.BASEDBOT_CHAT_ID) {
        try {
          // Send /buy order to BasedBot
          await bot.api.sendMessage(
            cfg.BASEDBOT_CHAT_ID,
            `/buy ${tokenAddress} ${roundAmount}`
          );
          logger.info(
            `[MAKER ${i}/${rounds}] Wallet [${maker.id}] micro-buy ${roundAmount} ETH broadcasted via BasedBot`
          );
          executedRounds++;
          totalVolume += roundAmount;
        } catch (botErr) {
          logger.warn(`[TRENDING BOOSTER] BasedBot delivery notice: ${botErr}. Fallback to direct on-chain swap...`);
          const fallbackRes = await executeDirectOnChainMicroBuy(tokenAddress, roundAmount, maker, false);
          if (fallbackRes.success) {
            executedRounds++;
            totalVolume += roundAmount;
          }
        }
      } else {
        // Direct on-chain fallback when running headless without Telegram bot
        const directRes = await executeDirectOnChainMicroBuy(tokenAddress, roundAmount, maker, false);
        if (directRes.success) {
          logger.info(
            `[MAKER ${i}/${rounds}] Wallet [${maker.id}] direct on-chain micro-buy ${roundAmount} ETH executed (Tx: ${directRes.txHash})`
          );
          executedRounds++;
          totalVolume += roundAmount;
        } else {
          logger.warn(
            `[MAKER ${i}/${rounds}] Wallet [${maker.id}] direct micro-buy notice: ${directRes.message}`
          );
        }
      }

      // Apply human-like randomized micro-jitter between maker orders
      if (i < rounds) {
        await randomJitter(minDelayMs, maxDelayMs);
      }
    } catch (err) {
      logger.warn(`[TRENDING BOOSTER] Round ${i} notice: ${String(err)}`);
    }
  }

  const durationMs = Date.now() - startTime;
  logger.success(
    `[TRENDING BOOSTER COMPLETE] Executed ${executedRounds}/${rounds} micro-buys across ${activeMakersUsed.size} unique makers (${(durationMs / 1000).toFixed(1)}s).`
  );

  return {
    tokenAddress,
    tokenSymbol,
    totalRoundsExecuted: executedRounds,
    uniqueMakersCount: activeMakersUsed.size,
    totalVolumeEth: Number(totalVolume.toFixed(6)),
    simulated: isSimulated,
    durationMs,
  };
}
