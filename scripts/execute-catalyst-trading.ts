#!/usr/bin/env bun
/**
 * scripts/execute-catalyst-trading.ts
 *
 * Catalyst Trading & Dynamic Volume Spark Engine for Base L2 Deployments.
 *
 * Architecture Principles:
 *  1. Anti-Suspicion: Organic separation (non-dev wallet, micro-jitter amounts).
 *  2. 100% Reuse: Directly consumes vault.ts, price-monitor.ts, evm-verifier.ts, fleet-registry.ts.
 *  3. Dynamic Multi-Token: Automatically detects all Base deployments or custom CA / index.
 *  4. Multi-Account Aware: Resolves deployer wallet & dedicated proxy context.
 *  5. Laddered Exit: 50% Take-Profit sell to return $1 capital + profit, while 50% moonbag
 *     remains floating to keep chart bullish and yield 95% creator fee WETH.
 *  6. Strict Privacy: Zero personal handles; dynamic token-specific social tags only.
 */

import axios from "axios";
import { formatEther, parseEther } from "viem";
import { getConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import {
  getEvmPublicClient,
  deriveEvmAddress,
  verifyEvmTransactionReceipt,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  snipeNewToken,
  sellToken,
} from "../src/modules/sniper/basedbot-sniper.ts";
import {
  fetchPriceUsd,
} from "../src/modules/market/price-monitor.ts";
import { Database } from "bun:sqlite";
import {
  DB_PATH,
  getOpenPositions,
  createPendingPosition,
  transitionPositionState,
  updatePositionEntryPrice,
  type ActivePosition,
} from "../src/db/vault.ts";
import { getLiveDeployments } from "../src/modules/fleet/fleet-registry.ts";
import { resolveOperationalContext, getWalletAccount } from "../src/modules/identity/wallet-manager.ts";
import { wrapEth, getWethBalance } from "../src/modules/evm/weth-wrapper.ts";


const db = new Database(DB_PATH);

const DEFAULT_BASE_TOKEN = "0x0a99f4251A461e8abC693a56BB837fD815D51BA3"; // $PUMPRUN (Production)
const DEFAULT_POOL_ID = "0x645d579d8002a6ac09d67c59526d065321b07570b1d9f359a70346c072ca7584";
export const KNOWN_PUMPRUN_TOKENS = [
  "0x0a99f4251a461e8abc693a56bb837fd815d51ba3",
  "0x7ce19e4f978009eb644c27946b47221b824c0ba3",
];
export const DOPPLER_BUY_BASE = `https://app.doppler.lol/tokens/base/`;
export const BANKR_1CLICK_BASE = `https://bankr.bot/terminal/trade?in=ETH&chain=base&out=`;
export const BANKR_WETH_BASE = `https://bankr.bot/terminal/trade?in=WETH&chain=base&out=`;
export const DEXSCREENER_BASE = `https://dexscreener.com/base/`;
export const GECKOTERMINAL_BASE = `https://www.geckoterminal.com/base/pools/`;
export const UNISWAP_1CLICK_BASE = `https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=`;

export interface ResolvedTokenTarget {
  address: string;
  ticker: string;
  name: string;
  poolId?: string;
  walletId?: string;
  index?: number;
}

/**
 * Resolves target token dynamically by index number (1, 2, 3...), contract address, or defaults to latest live token.
 */
export function resolveTargetToken(input?: string): ResolvedTokenTarget {
  const liveFleet = getLiveDeployments("base");

  // 1. If input is a 1-based index (e.g. "1", "2")
  if (input && /^\d+$/.test(input.trim())) {
    const idx = parseInt(input.trim(), 10) - 1;
    if (idx >= 0 && idx < liveFleet.length) {
      const match = liveFleet[idx];
      return {
        address: match.contractAddr!,
        ticker: match.ticker || "TOKEN",
        name: match.tokenName || "Token",
        poolId: match.poolId || undefined,
        walletId: match.walletId || undefined,
        index: idx + 1,
      };
    }
  }

  // 2. If input is an EVM address (0x...)
  if (input && /^0x[a-fA-F0-9]{40}$/.test(input.trim())) {
    const addr = input.trim();
    // Check if in deploy_logs
    try {
      const row = db
        .query(`SELECT contract_addr, ticker, token_name, pool_id, wallet_id FROM deploy_logs WHERE contract_addr = ? ORDER BY id DESC LIMIT 1`)
        .get(addr) as { contract_addr: string; ticker: string; token_name: string; pool_id?: string; wallet_id?: string } | null;

      if (row) {
        return {
          address: row.contract_addr,
          ticker: row.ticker || "TOKEN",
          name: row.token_name || "Token",
          poolId: row.pool_id || undefined,
          walletId: row.wallet_id || undefined,
        };
      }
    } catch {
      // Fails safe
    }

    const isKnownPumprun = KNOWN_PUMPRUN_TOKENS.includes(addr.toLowerCase());
    return {
      address: addr,
      ticker: isKnownPumprun ? "PUMPRUN" : "CUSTOM",
      name: isKnownPumprun ? "Pump Hill Runner" : "Custom Token",
      poolId: isKnownPumprun ? DEFAULT_POOL_ID : undefined,
    };
  }

  // 3. Default: Latest live deployment from fleet
  if (liveFleet.length > 0) {
    const latest = liveFleet[liveFleet.length - 1];
    return {
      address: latest.contractAddr!,
      ticker: latest.ticker || "TOKEN",
      name: latest.tokenName || "Token",
      poolId: latest.poolId || undefined,
      walletId: latest.walletId || undefined,
      index: liveFleet.length,
    };
  }

  // 4. Fallback default
  logger.warn(`⚠️  [CATALYST] Tidak ada token live di fleet Base. Menggunakan fallback token $PUMPRUN: ${DEFAULT_BASE_TOKEN}`);
  return {
    address: DEFAULT_BASE_TOKEN,
    ticker: "PUMPRUN",
    name: "Pump Hill Runner",
    poolId: DEFAULT_POOL_ID,
    walletId: "default-operator",
    index: 1,
  };
}

/**
 * Lists all live tokens deployed on Base with indexes and details.
 */
export function listLiveTokens(): void {
  const liveFleet = getLiveDeployments("base");

  console.log(`
=================================================================
  [+] DAFTAR TOKEN LIVE BASE UNTUK CATALYST TRADING [+]
=================================================================
  Total Live Deployments: ${liveFleet.length}
=================================================================
`);

  if (liveFleet.length === 0) {
    console.log(`  (Belum ada token live di fleet. Menggunakan default $PUMPRUN: ${DEFAULT_BASE_TOKEN})`);
  } else {
    liveFleet.forEach((d, idx) => {
      console.log(`  [${idx + 1}] $${d.ticker} (${d.tokenName})`);
      console.log(`      CA:       ${d.contractAddr}`);
      console.log(`      Pool ID:  ${d.poolId ?? "N/A"}`);
      console.log(`      Wallet:   ${d.walletId ?? "default-operator"}`);
      console.log(`      1-Click:  ${UNISWAP_1CLICK_BASE}${d.contractAddr}`);
      console.log(`  -------------------------------------------------------------`);
    });
  }
}

async function checkStatus(targetInput?: string): Promise<void> {
  const cfg = getConfig();
  const tokenInfo = resolveTargetToken(targetInput);
  const operatorAddress = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);

  console.log(`
=================================================================
  [+] CATALYST TRADING & DEX STATUS AUDIT [+]
=================================================================
  Target Token:      $${tokenInfo.ticker} - ${tokenInfo.name}
  Contract Address:  ${tokenInfo.address}
  Deployer Wallet:   ${tokenInfo.walletId ?? "default-operator"}
  Operator Wallet:   ${operatorAddress ?? "N/A"}
=================================================================
`);

  // 1. Check Operator ETH Balance on Base
  let ethBalance = 0;
  if (operatorAddress) {
    const client = getEvmPublicClient("base");
    if (client) {
      try {
        const rawBal = await client.getBalance({ address: operatorAddress as `0x${string}` });
        ethBalance = parseFloat(formatEther(rawBal));
        const ethUsd = ethBalance * 2450; // approximate
        console.log(`  Wallet Balance:    ${ethBalance.toFixed(6)} ETH (±$${ethUsd.toFixed(2)} USD)`);
        if (ethBalance < 0.00045) {
          console.log(`  Status Saldo:      ⚠️  Saldo di bawah 0.00045 ETH (~$1.10 USD).`);
          console.log(`                     Perlu top-up ~$1.50 - $2.00 ETH ke ${operatorAddress}`);
          console.log(`                     untuk menjalankan Auto-Buy on-chain dari bot.`);
        } else {
          console.log(`  Status Saldo:      ✅ Cukup untuk Auto-Buy ($1.00 swap + gas).`);
        }
      } catch (err: any) {
        console.log(`  Wallet Balance:    Gagal cek RPC: ${err?.message || err}`);
      }
    }
  }

  // 2. Check GeckoTerminal Pool Status
  console.log(`\n  --- GECKOTERMINAL STATUS ---`);
  let geckoUrl = tokenInfo.poolId
    ? `https://api.geckoterminal.com/api/v2/networks/base/pools/${tokenInfo.poolId}`
    : `https://api.geckoterminal.com/api/v2/networks/base/tokens/${tokenInfo.address}`;

  try {
    const geckoRes = await axios.get(geckoUrl, { timeout: 8000 });
    const attrs = geckoRes.data?.data?.attributes;
    if (attrs) {
      console.log(`  Pool / Name:       ${attrs.name || attrs.symbol || tokenInfo.ticker}`);
      console.log(`  Base Price USD:    $${attrs.base_token_price_usd ?? "0.0"}`);
      console.log(`  Volume 24h:        $${attrs.volume_usd?.h24 ?? "0.0"}`);
      console.log(`  Total Buys/Sells:  ${attrs.transactions?.h24?.buys ?? 0} Buys | ${attrs.transactions?.h24?.sells ?? 0} Sells`);
      console.log(`  Status Pool:       ✅ TERDAFTAR & AKTIF (HTTP 200 OK)`);
    }
  } catch (geckoErr: any) {
    console.log(`  GeckoTerminal:     Belum ada transaksi / index pending (${geckoErr.message})`);
  }

  // 3. Check DexScreener Status
  console.log(`\n  --- DEXSCREENER PAIRS STATUS ---`);
  try {
    const dexRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenInfo.address}`, { timeout: 8000 });
    const pairs = dexRes.data?.pairs;
    if (pairs && pairs.length > 0) {
      console.log(`  DexScreener Pairs: ${pairs.length} pair(s) active!`);
      console.log(`  Current Price:     $${pairs[0].priceUsd}`);
      console.log(`  DEX:               ${pairs[0].dexId}`);
      console.log(`  Status Grafik:     🟢 LIVE CHART INDEXED`);
    } else {
      console.log(`  DexScreener Pairs: 0 pair (Menunggu transaksi perdana untuk menyalakan grafik)`);
      console.log(`  Status Grafik:     ⏳ MENUNGGU 1-CLICK SWAP PERDANA`);
    }
  } catch (dexErr: any) {
    console.log(`  DexScreener:       Gagal query: ${dexErr.message}`);
  }

  // 4. Check Local SQLite Active Position
  console.log(`\n  --- POSISI AKTIF DI DATABASE VAULT ---`);
  const openPositions = getOpenPositions().filter((p) => p.contractAddr.toLowerCase() === tokenInfo.address.toLowerCase());
  if (openPositions.length > 0) {
    openPositions.forEach((p) => {
      console.log(`  ID #${p.id} | Status: ${p.status.toUpperCase()} | Entry Price: $${p.entryPrice ?? "Pending"} | TP: ${p.takeProfitX}x | SL: ${(p.stopLossPct * 100).toFixed(0)}%`);
    });
  } else {
    console.log(`  Belum ada posisi aktif untuk $${tokenInfo.ticker}.`);
  }

  const geckoPoolLink = tokenInfo.poolId
    ? `${GECKOTERMINAL_BASE}${tokenInfo.poolId}`
    : `https://www.geckoterminal.com/base/tokens/${tokenInfo.address}`;

  console.log(`
-----------------------------------------------------------------
  Tautan Terminal Pembelian & Aktivasi Grafik:
  1. DexScreener (Grafik & Swap)   : ${DEXSCREENER_BASE}${tokenInfo.address}
  2. GeckoTerminal (Pool Live)      : ${geckoPoolLink}
  3. Bankr Terminal (ETH masukan)   : ${BANKR_1CLICK_BASE}${tokenInfo.address}
  4. Bankr Terminal (WETH masukan)  : ${BANKR_WETH_BASE}${tokenInfo.address}
     ⚡ Gunakan opsi WETH jika ETH memberikan "Quote failed"
  5. Uniswap (Routing Base)         : ${UNISWAP_1CLICK_BASE}${tokenInfo.address}
=================================================================
`);
}

export async function registerManualBuy(targetInput?: string, txHash?: string, ethAmount: number = 0.00041): Promise<boolean> {
  const cfg = getConfig();
  const tokenInfo = resolveTargetToken(targetInput);
  const operatorAddress = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
    logger.error(`❌ [CATALYST] Transaction Hash tidak valid: '${txHash ?? ""}'. Harap masukkan txHash EVM 66-karakter hex riil (0x...).`);
    logger.info(`   Penggunaan: bun run scripts/execute-catalyst-trading.ts register <tokenCA> <0xTxHash> [amountEth]`);
    return false;
  }
  const actualTx = txHash.trim();

  logger.info(`📝 [CATALYST] Mendaftarkan pembelian manual untuk $${tokenInfo.ticker} (${tokenInfo.address})...`);
  logger.info(`🔍 [CATALYST] Memverifikasi transaksi on-chain di Base: ${actualTx}...`);

  const verification = await verifyEvmTransactionReceipt(actualTx, "base");
  if (verification.status === "failed") {
    logger.error(`❌ [CATALYST] Transaksi ${actualTx} ditemukan REVERTED (gagal) di Base! Pendaftaran dibatalkan.`);
    return false;
  }
  if (verification.status === "not_found") {
    logger.warn(`⚠️  [CATALYST] Transaksi ${actualTx} belum tertambang di Base (masih pending di mempool).`);
  } else if (verification.status === "confirmed") {
    logger.success(`✅ [CATALYST] Transaksi ${actualTx} terkonfirmasi di Base (Block #${verification.blockNumber})!`);
  } else {
    logger.info(`ℹ️  [CATALYST] Status verifikasi on-chain: ${verification.status}`);
  }

  // Fetch current price from DEX
  const currentPrice = await fetchPriceUsd("base", tokenInfo.address);
  const entryPrice = currentPrice && currentPrice > 0 ? currentPrice : undefined;

  // Check if position already exists
  const existing = getOpenPositions().find((p) => p.contractAddr.toLowerCase() === tokenInfo.address.toLowerCase());
  if (existing) {
    logger.warn(`⚠️  Posisi untuk token $${tokenInfo.ticker} sudah ada di vault (Status: ${existing.status}). Memperbarui entry...`);
    if (!existing.entryPrice && entryPrice) {
      updatePositionEntryPrice(tokenInfo.address, entryPrice);
    }
    logger.success(`✅ Posisi berhasil diperbarui ${entryPrice ? `dengan entry price $${entryPrice.toFixed(8)}` : ""}.`);
    return true;
  }

  const registered = createPendingPosition({
    deployLogId: 0,
    chain: "base",
    contractAddr: tokenInfo.address,
    ticker: tokenInfo.ticker,
    snipeAmount: ethAmount,
    takeProfitX: 1.5, // 1.5x (+50%)
    stopLossPct: 0.30, // -30%
    walletAddress: operatorAddress ?? undefined,
    deploymentTxHash: actualTx,
    walletId: tokenInfo.walletId ?? undefined,
  });

  if (registered) {
    transitionPositionState(tokenInfo.address, "buy_submitted", "open", {
      entryPrice: entryPrice ?? undefined,
    });
    logger.success(`✅ [VAULT] Pembelian manual $${tokenInfo.ticker} berhasil didaftarkan ke active_positions!`);
    logger.info(`   Tx Hash    : ${actualTx}`);
    if (entryPrice) {
      logger.info(`   Entry Price: $${entryPrice.toFixed(8)} | TP Target: ${(entryPrice * 1.5).toFixed(8)} (1.5x)`);
    } else {
      logger.info(`   Entry Price: Menunggu grafik live DexScreener.`);
    }
    logger.info(`   Jalankan monitor untuk auto take-profit: bun run scripts/execute-catalyst-trading.ts monitor ${tokenInfo.address}`);
    return true;
  } else {
    logger.error(`❌ Gagal mendaftarkan posisi ke database.`);
    return false;
  }
}

export async function executeAutoBuy(targetInput?: string, customAmountEth?: number): Promise<boolean> {
  const cfg = getConfig();
  const tokenInfo = resolveTargetToken(targetInput);
  const operatorAddress = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);

  if (!operatorAddress) {
    logger.error("❌ EVM_PRIVATE_KEY tidak ditemukan di environment.");
    return false;
  }

  const client = getEvmPublicClient("base");
  if (!client) {
    logger.error("❌ RPC Base tidak dapat dihubungi.");
    return false;
  }

  const rawBal = await client.getBalance({ address: operatorAddress as `0x${string}` });
  const ethBalance = parseFloat(formatEther(rawBal));

  const baseEth = customAmountEth && customAmountEth > 0 ? customAmountEth : 0.00015;
  const minRequired = baseEth + 0.00005; // Buffer for Base L2 gas (~0.00002 ETH)

  if (ethBalance < minRequired) {
    logger.warn(`\n⚠️  [SALDO DOMPET BELUM MENCUKUPI UNTUK AUTO-BUY]`);
    logger.warn(`   Alamat Wallet : ${operatorAddress}`);
    logger.warn(`   Saldo Saat Ini: ${ethBalance.toFixed(6)} ETH (~$${(ethBalance * 2400).toFixed(2)} USD).`);
    logger.warn(`   Dibutuhkan    : Minimal ${minRequired.toFixed(6)} ETH untuk pembelian + gas.\n`);
    logger.info(`💡 SOLUSI (PILIH SALAH SATU):`);
    logger.info(`   1. Top-up saldo 0.0005 - 0.001 ETH (~$1.50 - $2.50 USD) ke alamat operator di jaringan Base:`);
    logger.info(`      👉 ${operatorAddress}`);
    logger.info(`   2. ATAU beli token ~$1 secara manual dari dompet pribadi (MetaMask/Rabby/Coinbase):`);
    logger.info(`      🔗 DexScreener    : ${DEXSCREENER_BASE}${tokenInfo.address}`);
    logger.info(`      🔗 Bankr Terminal : ${BANKR_1CLICK_BASE}${tokenInfo.address}`);
    logger.info(`   3. Setelah swap di browser berhasil, catat transaksi di Menu [3] untuk auto take-profit.\n`);
    return false;
  }

  // Micro-jitter amount (+/- 5%) around baseEth
  const jitterFactor = 0.95 + Math.random() * 0.10;
  const targetEth = baseEth * jitterFactor;

  logger.info(`🤖 [AUTO-BUY] Mempersiapkan pembelian pancingan terukur: ${targetEth.toFixed(6)} ETH (~$${(targetEth * 2400).toFixed(2)} USD)...`);
  logger.info(`   Wallet Operator: ${operatorAddress} (Organic Buyer Role)`);
  logger.info(`   Target Token:    $${tokenInfo.ticker} (${tokenInfo.address})`);

  // Periksa apakah BasedBot Telegram terkonfigurasi untuk eksekusi swap otomatis
  const hasBasedBot = Boolean(cfg.TELEGRAM_BOT_TOKEN && cfg.BASEDBOT_CHAT_ID);

  if (hasBasedBot) {
    logger.info(`🚀 [AUTO-BUY] Mengirim instruksi eksekusi /buy ke BasedBot on-chain...`);
    const snipeOk = await snipeNewToken(tokenInfo.address, "base", tokenInfo.ticker, {
      snipeAmount: targetEth,
      enforceSafeCap: true,
    });

    if (!snipeOk) {
      logger.error(`❌ [AUTO-BUY] Pengiriman order ke BasedBot gagal atau ditolak. Posisi TIDAK dicatat.`);
      return false;
    }

    logger.success(`✅ [AUTO-BUY] Order swap on-chain berhasil dikirim via BasedBot!`);
  } else {
    logger.info(`⚡ [AUTO-BUY] BasedBot Telegram tidak aktif. Mengeksekusi swap langsung on-chain via dompet operator...`);
    const { executeDirectSwap } = await import("./execute-direct-swap.ts");
    const swapResult = await executeDirectSwap({
      amountEth: targetEth.toFixed(6),
      tokenAddress: tokenInfo.address,
    });
    if (!swapResult.success || !swapResult.txHash) {
      logger.error(`❌ [AUTO-BUY] Eksekusi swap on-chain gagal: ${swapResult.error || "Unknown error"}`);
      return false;
    }
    logger.success(`✅ [AUTO-BUY] Swap on-chain berhasil dikonfirmasi di Base: ${swapResult.txHash}`);
    return true;
  }

    const registered = createPendingPosition({
      deployLogId: 0,
      chain: "base",
      contractAddr: tokenInfo.address,
      ticker: tokenInfo.ticker,
      snipeAmount: targetEth,
      takeProfitX: 1.5,
      stopLossPct: 0.30,
      walletAddress: operatorAddress,
      walletId: tokenInfo.walletId ?? undefined,
    });

    if (registered) {
      logger.success(`✅ Posisi pancingan tercatat di database dengan status OPEN.`);
      logger.info(`   Target Take-Profit: 1.5x (+50%) dengan Laddered 50% Exit.`);
      logger.info(`   Mulai memantau pasar: bun run scripts/execute-catalyst-trading.ts monitor ${tokenInfo.address}`);
      return true;
    }
    return false;
}

export async function runLiveMonitor(targetInput?: string, maxIterations?: number): Promise<void> {
  const tokenInfo = resolveTargetToken(targetInput);
  logger.info(`👁️  [MONITOR] Memulai loop pemantau live harga $${tokenInfo.ticker} (${tokenInfo.address}) di Base...`);
  logger.info(`   Tekan Ctrl + C untuk keluar dari monitor kapan saja.\n`);

  let iteration = 0;
  while (true) {
    iteration++;
    if (maxIterations && iteration > maxIterations) {
      logger.info(`ℹ️  [MONITOR] Batas siklus pemantau awal tercapai (${maxIterations} iterasi). Melanjutkan pipeline...`);
      break;
    }
    try {
      const price = await fetchPriceUsd("base", tokenInfo.address);
      const openPositions = getOpenPositions().filter((p) => p.contractAddr.toLowerCase() === tokenInfo.address.toLowerCase());

      const timestamp = new Date().toLocaleTimeString();
      if (price !== null && price > 0) {
        if (openPositions.length > 0) {
          const pos = openPositions[0];
          const entry = pos.entryPrice || price;
          const tpPrice = entry * pos.takeProfitX;
          const slPrice = entry * (1 - pos.stopLossPct);
          const changePct = ((price - entry) / entry) * 100;
          const changeSign = changePct >= 0 ? "+" : "";

          console.log(
            `[${timestamp}] #` + iteration + ` $${tokenInfo.ticker}: $${price.toFixed(8)} ` +
            `(${changeSign}${changePct.toFixed(1)}%) | Entry: $${entry.toFixed(8)} | TP: $${tpPrice.toFixed(8)}`
          );

          if (price >= tpPrice) {
            logger.success(`\n🎉 [TAKE PROFIT TRIGGERED!] Harga mencapai target ${pos.takeProfitX}x ($${price.toFixed(8)})!`);
            logger.info(`💰 [LADDERED EXIT] Menjual 50% token untuk mengamankan modal $1.00 + profit bersih.`);
            logger.info(`🚀 [MOONBAG] Sisa 50% token tetap disimpan untuk menjaga chart hijau dan memanen 95% creator fee WETH.`);

            const sold = await sellToken(tokenInfo.address, "base", tokenInfo.ticker, "take_profit", 50);
            if (sold) {
              logger.success(`✅ [ON-CHAIN EXIT] Order jual 50% laddered take-profit berhasil dikirim!`);
            } else {
              logger.warn(`⚠️  [ON-CHAIN EXIT] Order jual via bot tidak terkirim. Silakan jual manual di Uniswap:`);
              logger.info(`   🔗 ${UNISWAP_1CLICK_BASE}${tokenInfo.address}`);
            }

            transitionPositionState(tokenInfo.address, "open", "closing", {
              exitReason: "take_profit_laddered_50",
              exitPrice: price,
            });
            break;
          } else if (price <= slPrice) {
            logger.warn(`\n🛑 [STOP LOSS TRIGGERED] Harga turun ${(pos.stopLossPct * 100).toFixed(0)}% ($${price.toFixed(8)}).`);

            const sold = await sellToken(tokenInfo.address, "base", tokenInfo.ticker, "stop_loss", 100);
            if (sold) {
              logger.success(`✅ [ON-CHAIN EXIT] Order jual 100% stop-loss berhasil dikirim!`);
            } else {
              logger.warn(`⚠️  [ON-CHAIN EXIT] Order jual via bot tidak terkirim. Silakan jual manual di Uniswap:`);
              logger.info(`   🔗 ${UNISWAP_1CLICK_BASE}${tokenInfo.address}`);
            }

            transitionPositionState(tokenInfo.address, "open", "closing", {
              exitReason: "stop_loss",
              exitPrice: price,
            });
            break;
          }
        } else {
          console.log(`[${timestamp}] #${iteration} $${tokenInfo.ticker}: $${price.toFixed(8)} (Belum ada posisi aktif di database)`);
        }
      } else {
        console.log(`[${timestamp}] #${iteration} $${tokenInfo.ticker}: Menunggu pembeli perdana (Gecko/DexScreener pending)...`);
      }
    } catch (loopErr: any) {
      logger.warn(`⚠️  [MONITOR] Warning: ${loopErr.message}`);
    }

    await new Promise((r) => setTimeout(r, 8000)); // Cek tiap 8 detik
  }
}

// ─── CLI Dispatcher ──────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase() || "check";
  const targetToken = args[1];

  switch (command) {
    case "list":
      listLiveTokens();
      break;
    case "check":
      await checkStatus(targetToken);
      break;
    case "auto-buy":
      const customBuyAmount = args[2] ? parseFloat(args[2]) : undefined;
      await executeAutoBuy(targetToken, customBuyAmount);
      break;
    case "spark": {
      const resolved = resolveTargetToken(targetToken);
      const rounds = args[2] ? parseInt(args[2], 10) : 3;
      const amountEth = args[3] ? parseFloat(args[3]) : 0.00005;
      console.log(`\n🔥 [VOLUME SPARK] Menjalankan ${rounds} ronde micro-maker untuk $${resolved.ticker} (${resolved.address})...`);
      const { runTrendingBoostCycle } = await import("../src/modules/growth/trending-booster.ts");
      const sparkRes = await runTrendingBoostCycle({
        tokenAddress: resolved.address,
        tokenSymbol: resolved.ticker,
        rounds,
        microAmountEth: amountEth,
        isSimulated: false,
      });
      console.log(`\n✅ [VOLUME SPARK SELESAI] Total Ronde Berhasil: ${sparkRes.totalRoundsExecuted}/${rounds}`);
      break;
    }
    case "register":
      const txHash = args[2];
      const amountEth = parseFloat(args[3] || "0.00041");
      if (!txHash) {
        console.log(`\n❌ Harap sertakan Transaction Hash EVM asli (0x...).\nContoh:\n  bun run scripts/execute-catalyst-trading.ts register 1 0x47e1d5a8... 0.00041\n`);
        break;
      }
      await registerManualBuy(targetToken, txHash, amountEth);
      break;
    case "monitor":
      const maxIter = args[2] ? parseInt(args[2], 10) : undefined;
      await runLiveMonitor(targetToken, maxIter);
      break;
    case "wrap-eth": {
      // ── Wrap ETH → WETH9 on Base Mainnet ──
      const rawAmount = args[1];
      const ethToWrap = rawAmount ? parseFloat(rawAmount) : 0;
      if (!ethToWrap || isNaN(ethToWrap) || ethToWrap <= 0) {
        console.log(`\n❌ Jumlah ETH tidak valid.`);
        console.log(`   Penggunaan: bun run scripts/execute-catalyst-trading.ts wrap-eth 0.01\n`);
        break;
      }
      console.log(`\n💱 [WETH-WRAP] Memulai wrap ${ethToWrap} ETH → WETH di Base Mainnet...`);
      const { getConfig } = await import("../src/config.ts");
      const cfg = getConfig();
      const wethBefore = await getWethBalance();
      console.log(`   WETH sebelum: ${wethBefore.toFixed(6)} WETH`);
      const wrapResult = await wrapEth(ethToWrap);
      if (wrapResult.success) {
        const wethAfter = wrapResult.wethBalanceAfter ?? await getWethBalance();
        console.log(`\n✅ [WETH-WRAP] Wrap berhasil!`);
        console.log(`   ETH yang di-wrap : ${ethToWrap} ETH`);
        console.log(`   WETH diterima    : ${wrapResult.wethReceived ?? ethToWrap} WETH`);
        console.log(`   WETH sesudah     : ${wethAfter.toFixed(6)} WETH`);
        console.log(`   Gas cost         : ${wrapResult.gasCostEth?.toFixed(8) ?? "N/A"} ETH`);
        console.log(`   TxHash           : ${wrapResult.txHash ?? "N/A"}`);
        console.log(`   Explorer         : ${wrapResult.explorerUrl ?? "N/A"}`);
      } else {
        console.log(`\n❌ [WETH-WRAP] Gagal: ${wrapResult.error}`);
      }
      break;
    }
    case "link": {
      const resolved = resolveTargetToken(targetToken);
      const subType = args[2]?.toLowerCase();
      if (subType === "bankr") {
        console.log(`${BANKR_1CLICK_BASE}${resolved.address}`);
      } else if (subType === "weth") {
        console.log(`${BANKR_WETH_BASE}${resolved.address}`);
      } else if (subType === "uniswap") {
        console.log(`${UNISWAP_1CLICK_BASE}${resolved.address}`);
      } else if (subType === "gecko") {
        const poolRef = resolved.poolId || resolved.address;
        console.log(`${GECKOTERMINAL_BASE}${poolRef}`);
      } else {
        // default: dexscreener
        console.log(`${DEXSCREENER_BASE}${resolved.address}`);
      }
      break;
    }
    default:
      console.log(`
Penggunaan Catalyst Trading:
  bun run scripts/execute-catalyst-trading.ts list
  bun run scripts/execute-catalyst-trading.ts check [index|tokenAddress]
  bun run scripts/execute-catalyst-trading.ts spark [index|tokenAddress] [rounds] [amountEth]
  bun run scripts/execute-catalyst-trading.ts auto-buy [index|tokenAddress]
  bun run scripts/execute-catalyst-trading.ts register [index|tokenAddress] [txHash] [amountEth]
  bun run scripts/execute-catalyst-trading.ts monitor [index|tokenAddress]
  bun run scripts/execute-catalyst-trading.ts link [index|tokenAddress]
  bun run scripts/execute-catalyst-trading.ts wrap-eth [amountEth]
`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal Catalyst Trading error: ${err.message}`);
    process.exit(1);
  });
}
