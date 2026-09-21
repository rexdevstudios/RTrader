/**
 * basedbot-sniper.ts — Auto-snipe dan auto-sell token via BasedBot Telegram.
 *
 * Refactor dari v1: Bot instance dijadikan SINGLETON agar tidak membuat
 * koneksi TCP baru setiap kali fungsi dipanggil.
 *
 * Ekspor:
 *  - snipeNewToken() — Kirim /buy (tidak berubah, zero breaking change)
 *  - sellToken()     — Kirim /sell untuk Exit Strategy (BARU)
 */
import { Bot } from "grammy";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";

// ─── Singleton Bot Instance ───────────────────────────────────
// Dibuat satu kali saat modul pertama kali diimport.
// Jika TELEGRAM_BOT_TOKEN kosong, _bot tetap null dan semua fungsi
// akan gracefully skip tanpa throw error.
let _bot: Bot | null = null;

function getBot(): Bot | null {
  const cfg = getConfig();
  if (!cfg.TELEGRAM_BOT_TOKEN) return null;
  if (!_bot) {
    _bot = new Bot(cfg.TELEGRAM_BOT_TOKEN);
  }
  return _bot;
}

// ─── Helper: Kirim pesan ke BasedBot ─────────────────────────
async function sendToBased(message: string, targetChatId?: string): Promise<boolean> {
  const bot = getBot();
  const cfg = getConfig();
  if (!bot) {
    logger.warn("⚠️  TELEGRAM_BOT_TOKEN tidak diisi — aksi BasedBot dilewati.");
    return false;
  }
  const chatId = targetChatId || cfg.BASEDBOT_CHAT_ID;
  try {
    await bot.api.sendMessage(chatId, message);
    return true;
  } catch (err) {
    logger.warn(`⚠️  BasedBot gagal kirim pesan ke ${chatId} (diabaikan): ${String(err)}`);
    return false;
  }
}

/**
 * Calculates safe snipe amount respecting chain constraints and anti-whale caps.
 * For EVM launches on Doppler/Uniswap v4, holding >2% of total supply within 5 minutes
 * causes transactions to revert. This clamps to SNIPE_SAFE_CAP_ETH (default: 0.02 ETH).
 */
export function calculateSafeSnipeAmount(chain: string, requestedAmount?: number): number {
  const cfg = getConfig();
  const rawAmount = requestedAmount ?? (chain === "solana" ? cfg.SNIPE_AMOUNT_SOL : cfg.SNIPE_AMOUNT_ETH);

  if (chain === "solana") {
    return rawAmount;
  }

  const safeCapEth = cfg.SNIPE_SAFE_CAP_ETH ?? 0.02;
  if (rawAmount > safeCapEth) {
    logger.warn(
      `🛡️  [SNIPER SAFE-CAP] Requested ${rawAmount} ETH exceeds safe cap of ${safeCapEth} ETH ` +
        `(Doppler 5-min 2% supply cap). Clamping to ${safeCapEth} ETH.`
    );
    return safeCapEth;
  }

  return rawAmount;
}

// ─── snipeNewToken: Auto-Snipe dengan Doppler Anti-Whale Safe Cap ──
export async function snipeNewToken(
  contractAddress: string,
  chain: string,
  tokenTicker: string,
  options?: {
    snipeAmount?: number;
    enforceSafeCap?: boolean;
  }
): Promise<boolean> {
  const cfg = getConfig();
  const enforceCap = options?.enforceSafeCap ?? true;
  const baseAmount = options?.snipeAmount ?? (chain === "solana" ? cfg.SNIPE_AMOUNT_SOL : cfg.SNIPE_AMOUNT_ETH);
  const amount = enforceCap ? calculateSafeSnipeAmount(chain, baseAmount) : baseAmount;
  const currency = chain === "solana" ? "SOL" : "ETH";
  const message = `/buy ${contractAddress} ${amount}`;

  logger.info(`🤖 Snipe $${tokenTicker}: ${message.slice(0, 60)}...`);
  const ok = await sendToBased(message);
  if (ok) {
    logger.success(`✅ [BASEDBOT] Snipe terkirim: $${tokenTicker} (${amount} ${currency})`);
  }
  return ok;
}

// ─── sellToken: BARU — untuk Exit Strategy (TP / SL) ─────────
export async function sellToken(
  contractAddress: string,
  chain: string,
  tokenTicker: string,
  reason: "take_profit" | "stop_loss",
  percentage: number = 100
): Promise<boolean> {
  const emoji = reason === "take_profit" ? "💰 TAKE PROFIT" : "🛑 STOP LOSS";
  const pct = Math.min(100, Math.max(1, Math.round(percentage)));
  const message = `/sell ${contractAddress} ${pct}%`;

  logger.info(`${emoji} (${pct}%) — Menjual $${tokenTicker}...`);
  const ok = await sendToBased(message);
  if (ok) {
    logger.success(`✅ [BASEDBOT] ${emoji} (${pct}%) tereksekusi untuk $${tokenTicker} (${chain.toUpperCase()})`);
  }
  return ok;
}

export interface MultiSnipeTarget {
  walletId?: string;
  chatId?: string;
  amount?: number;
  label?: string;
}

export interface MultiSnipeResult {
  success: boolean;
  totalDispatchedAmount: number;
  successfulOrders: number;
  failedOrders: number;
  orders: Array<{
    targetId: string;
    chatId: string;
    amount: number;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Executes a distributed multi-account snipe across multiple BasedBot wallets/chats.
 * Partitions the total snipe amount so that no single wallet exceeds Doppler's
 * anti-whale cap (max 1.8% supply / 0.02 ETH), creating a decentralized Top Holders (TH)
 * footprint on public scanners (Rick Bot / TTF Bot / DexScreener).
 */
export async function snipeMultiAccountToken(
  contractAddress: string,
  chain: string,
  tokenTicker: string,
  options?: {
    targets?: MultiSnipeTarget[];
    totalAmount?: number;
    walletCount?: number;
    jitterMs?: number;
    enforceSafeCap?: boolean;
  }
): Promise<MultiSnipeResult> {
  const cfg = getConfig();
  const enforceCap = options?.enforceSafeCap ?? true;
  const currency = chain === "solana" ? "SOL" : "ETH";
  const jitterMs = options?.jitterMs ?? 300;

  let targets = options?.targets ? [...options.targets] : [];

  // If no explicit targets provided, partition totalAmount or default amount across walletCount
  if (targets.length === 0) {
    const total =
      options?.totalAmount ?? (chain === "solana" ? cfg.SNIPE_AMOUNT_SOL : cfg.SNIPE_AMOUNT_ETH);
    const count = Math.max(1, options?.walletCount ?? 3);
    const slice = total / count;

    for (let i = 0; i < count; i++) {
      targets.push({
        walletId: `sub_wallet_${i + 1}`,
        chatId: cfg.BASEDBOT_CHAT_ID,
        amount: slice,
        label: `Sub-Account #${i + 1}`,
      });
    }
  }

  const result: MultiSnipeResult = {
    success: false,
    totalDispatchedAmount: 0,
    successfulOrders: 0,
    failedOrders: 0,
    orders: [],
  };

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const targetId = target.walletId || `target_${i + 1}`;
    const targetChat = target.chatId || cfg.BASEDBOT_CHAT_ID;
    const baseAmt =
      target.amount ??
      (options?.totalAmount
        ? options.totalAmount / targets.length
        : chain === "solana"
        ? cfg.SNIPE_AMOUNT_SOL
        : cfg.SNIPE_AMOUNT_ETH);
    const safeAmount = enforceCap ? calculateSafeSnipeAmount(chain, baseAmt) : baseAmt;

    const message = `/buy ${contractAddress} ${safeAmount}`;
    logger.info(`🤖 Multi-Snipe [${targetId}] $${tokenTicker}: ${message}...`);

    const ok = await sendToBased(message, targetChat);
    if (ok) {
      result.successfulOrders++;
      result.totalDispatchedAmount += safeAmount;
      result.orders.push({
        targetId,
        chatId: targetChat,
        amount: safeAmount,
        success: true,
      });
      logger.success(
        `✅ [BASEDBOT MULTI] Snipe terkirim untuk ${targetId}: $${tokenTicker} (${safeAmount} ${currency})`
      );
    } else {
      result.failedOrders++;
      result.orders.push({
        targetId,
        chatId: targetChat,
        amount: safeAmount,
        success: false,
        error: "Dispatch failed via Telegram API",
      });
    }

    // Apply micro-delay jitter between orders to prevent nonce or rate-limit collision
    if (i < targets.length - 1 && jitterMs > 0) {
      await new Promise((r) => setTimeout(r, jitterMs));
    }
  }

  result.success = result.successfulOrders > 0;
  return result;
}

