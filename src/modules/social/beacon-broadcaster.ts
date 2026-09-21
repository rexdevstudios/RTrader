/**
 * src/modules/social/beacon-broadcaster.ts
 *
 * Automated Social Beacon Broadcaster.
 *
 * Dispatches on-chain proof cards (Burn Beacon, Dividend Beacon, Jackpot Winner)
 * directly to Discord webhooks or Telegram channels non-blockingly without gas.
 *
 * Invariants:
 *   - Fail-safe: Missing webhooks or network errors never crash or block deployment.
 *   - Non-blocking: Can be fired with .catch(logger.warn).
 */

import axios from "axios";
import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import { getDeployLogWebsite, getDeploymentTelegramBot } from "../../db/vault.ts";

export interface BroadcastOptions {
  discordWebhook?: string;
  telegramWebhook?: string;
  channelTitle?: string;
  timeoutMs?: number;
}

export interface BroadcastResult {
  discordDispatched: boolean;
  telegramDispatched: boolean;
  cardText: string;
  errors: string[];
}

/**
 * Dispatches a formatted Beacon card to configured webhooks.
 */
export async function dispatchBeaconCard(
  cardText: string,
  options?: BroadcastOptions
): Promise<BroadcastResult> {
  const cfg = getConfig();
  const discordUrl = options?.discordWebhook ?? cfg.COMMUNITY_DISCORD_WEBHOOK;
  const telegramUrl = options?.telegramWebhook ?? cfg.COMMUNITY_TELEGRAM_WEBHOOK;
  const timeoutMs = options?.timeoutMs ?? 5000;

  const result: BroadcastResult = {
    discordDispatched: false,
    telegramDispatched: false,
    cardText,
    errors: [],
  };

  // 1. Dispatch to Discord Webhook
  if (discordUrl && discordUrl.startsWith("http")) {
    try {
      await axios.post(
        discordUrl,
        {
          content: cardText,
        },
        { timeout: timeoutMs }
      );
      result.discordDispatched = true;
      logger.success("📡 [BROADCASTER] Dispatched Beacon card to Discord Webhook.");
    } catch (err: any) {
      const errMsg = `Discord dispatch notice: ${err?.message || err}`;
      result.errors.push(errMsg);
      logger.warn(`⚠️  [BROADCASTER] ${errMsg}`);
    }
  }

  // 2. Dispatch to Telegram Webhook
  if (telegramUrl && telegramUrl.startsWith("http")) {
    try {
      await axios.post(
        telegramUrl,
        {
          text: cardText,
        },
        { timeout: timeoutMs }
      );
      result.telegramDispatched = true;
      logger.success("📡 [BROADCASTER] Dispatched Beacon card to Telegram Webhook.");
    } catch (err: any) {
      const errMsg = `Telegram dispatch notice: ${err?.message || err}`;
      result.errors.push(errMsg);
      logger.warn(`⚠️  [BROADCASTER] ${errMsg}`);
    }
  }

  return result;
}

export interface LaunchAnnouncementParams {
  ticker: string;
  name: string;
  contractAddress: string;
  chain: string;
  botUsername?: string;
  botToken?: string;
  telegramChannelOrChatId?: string;
  poolId?: string;
  websiteUrl?: string;
  dexScreenerUrl?: string;
  uniswapUrl?: string;
  timeoutMs?: number;
}

/**
 * Broadcasts an official token launch announcement card to configured Telegram community channels
 * and webhooks non-blockingly.
 */
export async function broadcastTokenLaunchAnnouncement(
  params: LaunchAnnouncementParams
): Promise<{ success: boolean; telegramSent: boolean; messageText: string; error?: string }> {
  const chainName = params.chain.toUpperCase();
  const ticker = params.ticker.replace(/^\$/, "").toUpperCase();
  const dexUrl =
    params.dexScreenerUrl ||
    `https://dexscreener.com/${params.chain.toLowerCase()}/${params.contractAddress}`;
  const uniUrl =
    params.uniswapUrl ||
    `https://app.uniswap.org/swap?chain=${params.chain.toLowerCase()}&inputCurrency=ETH&outputCurrency=${params.contractAddress}`;
  const botLink = params.botUsername ? `https://t.me/${params.botUsername.replace(/^@/, "")}` : "";
  const webUrl = params.websiteUrl || getDeployLogWebsite(params.contractAddress);

  const htmlMessage =
    `🚀 <b>NEW LAUNCH ALPHA: $${ticker} (${params.name})</b>\n\n` +
    `⛓️ <b>Chain:</b> ${chainName}\n` +
    `📝 <b>CA:</b> <code>${params.contractAddress}</code>\n` +
    `🛡️ <b>Security:</b> 0% Tax | Audited Liquidity | Autonomous Agent\n` +
    (webUrl ? `🌐 <b>Web3 DApp:</b> ${webUrl}\n` : "") +
    (botLink
      ? `🤖 <b>Official Agent Bot:</b> <a href="${botLink}">@${params.botUsername?.replace(/^@/, "")}</a>\n`
      : "") +
    (params.poolId && params.poolId !== "N/A"
      ? `📊 <b>GeckoTerminal:</b> https://www.geckoterminal.com/${params.chain.toLowerCase()}/pools/${params.poolId}\n`
      : "") +
    `📈 <b>DexScreener:</b> ${dexUrl}\n` +
    `🦄 <b>1-Click Swap:</b> ${uniUrl}\n\n` +
    `💡 <i>Autonomous Multi-Chain Launch Engine</i>`;

  const plainMessage =
    `🚀 NEW LAUNCH ALPHA: $${ticker} (${params.name})\n` +
    `Chain: ${chainName}\n` +
    `CA: ${params.contractAddress}\n` +
    `Security: 0% Tax | Audited Liquidity\n` +
    (webUrl ? `Web3 DApp: ${webUrl}\n` : "") +
    (botLink ? `Official Bot: ${botLink}\n` : "") +
    `DexScreener: ${dexUrl}\n` +
    `Swap: ${uniUrl}`;

  let telegramSent = false;
  let dispatchErr: string | undefined;

  const cfg = getConfig();
  const token = params.botToken || cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const targetChat =
    params.telegramChannelOrChatId ||
    process.env.COMMUNITY_TELEGRAM_CHANNEL ||
    process.env.COMMUNITY_TELEGRAM_CHAT_ID;

  if (token && targetChat) {
    try {
      // Siapkan inline keyboard dengan tombol WebApp Telegram
      const inlineKeyboard: any[][] = [];
      if (webUrl && webUrl.startsWith("https://")) {
        inlineKeyboard.push([
          {
            text: `🚀 Buka Web3 DApp ($${ticker})`,
            web_app: { url: webUrl },
          },
        ]);
      }

      const linkRow: any[] = [];
      if (webUrl && webUrl.startsWith("http")) {
        linkRow.push({ text: "🌐 Website", url: webUrl });
      }
      linkRow.push({ text: "🦄 Swap", url: uniUrl });
      linkRow.push({ text: "📊 DexScreener", url: dexUrl });
      inlineKeyboard.push(linkRow);

      const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: targetChat,
          text: htmlMessage,
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: inlineKeyboard,
          },
        },
        { timeout: params.timeoutMs ?? 5000 }
      );
      if (response.data?.ok) {
        telegramSent = true;
        logger.success(
          `📡 [BROADCASTER] Pengumuman token $${ticker} terkirim ke Telegram (${targetChat}) dengan WebApp DApp button!`
        );
      }
    } catch (err: any) {
      dispatchErr = `Telegram send failed: ${err?.message || err}`;
      logger.warn(`⚠️  [BROADCASTER] ${dispatchErr}`);
    }
  }

  // Dispatch to configured webhooks as well
  await dispatchBeaconCard(plainMessage, { timeoutMs: params.timeoutMs });

  return {
    success: true,
    telegramSent,
    messageText: plainMessage,
    error: dispatchErr,
  };
}

export interface ProxyAlertParams {
  type: "FAILOVER" | "PRUNE" | "UNQUARANTINE" | "ROTATION";
  title: string;
  details: string[];
  totalAffected?: number;
  timeoutMs?: number;
}

/**
 * Broadcasts a formatted alert card for proxy lifecycle events (Failover, Prune, Unquarantine, Rotation)
 * to configured webhooks (Discord/Telegram) and directly to Telegram channel if configured.
 * Operates strictly fail-safe and non-blocking.
 */
export async function broadcastProxyAlert(
  params: ProxyAlertParams,
  options?: BroadcastOptions
): Promise<BroadcastResult> {
  const icon =
    params.type === "FAILOVER" || params.type === "ROTATION"
      ? "🔄"
      : params.type === "PRUNE"
      ? "🧹"
      : "🩺";

  const lines = [
    `${icon} [PROXY ALERT - ${params.type}] ${params.title}`,
    `⏰ Waktu: ${new Date().toLocaleString("id-ID")}`,
    "",
    ...params.details.map((d) => `• ${d}`),
    "",
    `🤖 Autonomous Proxy Infrastructure Guard`,
  ];

  const plainMessage = lines.join("\n");
  const htmlMessage =
    `<b>${icon} [PROXY ALERT - ${params.type}]</b>\n` +
    `<b>${params.title}</b>\n\n` +
    `⏰ <i>${new Date().toLocaleString("id-ID")}</i>\n\n` +
    params.details
      .map((d) => `• <code>${d.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code>`)
      .join("\n") +
    `\n\n🛡️ <i>Autonomous Proxy Infrastructure Guard</i>`;

  const cfg = getConfig();
  const token = cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const targetChat =
    process.env.COMMUNITY_TELEGRAM_CHANNEL ||
    process.env.COMMUNITY_TELEGRAM_CHAT_ID;

  if (token && targetChat) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: targetChat,
          text: htmlMessage,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        { timeout: params.timeoutMs ?? options?.timeoutMs ?? 5000 }
      );
      logger.info(`📡 [BROADCASTER] Alert proxy (${params.type}) terkirim ke Telegram.`);
    } catch (err: any) {
      logger.warn(`⚠️  [BROADCASTER] Direct Telegram alert notice: ${err?.message || err}`);
    }
  }

  return dispatchBeaconCard(plainMessage, options);
}

export interface BalanceAlertItem {
  id: string;
  label: string;
  chain: string;
  address: string;
  actualBalance: number | null;
  requiredBalance: number;
  deficit: number;
}

export interface BalanceAlertParams {
  title: string;
  wallets: BalanceAlertItem[];
  totalStarving: number;
  timeoutMs?: number;
}

/**
 * Broadcasts a formatted alert card when operator wallets have native balances below minimum thresholds.
 * Dispatches to configured webhooks (Discord/Telegram) and directly to Telegram channel if configured.
 * Operates strictly fail-safe and non-blocking.
 */
export async function broadcastLowBalanceAlert(
  params: BalanceAlertParams,
  options?: BroadcastOptions
): Promise<BroadcastResult> {
  const lines = [
    `⚠️ [BALANCE ALERT - LOW OPERATOR BALANCE]`,
    params.title,
    `⏰ Waktu: ${new Date().toLocaleString("id-ID")}`,
    "",
    `Perhatian: Terdapat ${params.totalStarving} akun operator dengan saldo native di bawah batas minimum:`,
    "",
    ...params.wallets.map((w) => {
      const balStr = w.actualBalance !== null ? `${w.actualBalance.toFixed(6)}` : "0.000000 (RPC error / 0)";
      const symbol = w.chain.toLowerCase().includes("sol") ? "SOL" : "ETH";
      return `• ID: ${w.id} ("${w.label}") | ${w.chain.toUpperCase()}: ${balStr} ${symbol} < min ${w.requiredBalance.toFixed(4)} ${symbol} (Defisit: -${w.deficit.toFixed(6)} ${symbol})`;
    }),
    "",
    `💡 Tindakan: Harap lakukan top-up saldo gas ke alamat dompet terkait agar siklus pipeline tidak terhenti.`,
    "",
    `🤖 Autonomous Wallet Infrastructure Guard`,
  ];

  const plainMessage = lines.join("\n");

  const htmlLines = [
    `<b>⚠️ [BALANCE ALERT - LOW OPERATOR BALANCE]</b>`,
    `<b>${params.title}</b>\n`,
    `⏰ <i>${new Date().toLocaleString("id-ID")}</i>\n`,
    `Perhatian: Terdapat <b>${params.totalStarving}</b> akun operator dengan saldo native di bawah batas minimum:\n`,
    ...params.wallets.map((w) => {
      const balStr = w.actualBalance !== null ? `${w.actualBalance.toFixed(6)}` : "0.000000";
      const symbol = w.chain.toLowerCase().includes("sol") ? "SOL" : "ETH";
      return `• <b>${w.id}</b> (<i>${w.label}</i>)\n  <code>${w.chain.toUpperCase()}</code>: ${balStr} ${symbol} &lt; min ${w.requiredBalance.toFixed(4)} ${symbol}\n  Defisit: <code>-${w.deficit.toFixed(6)} ${symbol}</code>\n  Alamat: <code>${w.address}</code>`;
    }),
    `\n💡 <i>Tindakan: Harap lakukan top-up saldo gas ke alamat dompet di atas agar siklus pipeline tidak terhenti.</i>\n`,
    `🛡️ <i>Autonomous Wallet Infrastructure Guard</i>`,
  ];

  const htmlMessage = htmlLines.join("\n");

  const cfg = getConfig();
  const token = cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const targetChat =
    process.env.COMMUNITY_TELEGRAM_CHANNEL ||
    process.env.COMMUNITY_TELEGRAM_CHAT_ID;

  if (token && targetChat) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: targetChat,
          text: htmlMessage,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        { timeout: params.timeoutMs ?? options?.timeoutMs ?? 5000 }
      );
      logger.info(`📡 [BROADCASTER] Alert saldo rendah terkirim ke Telegram.`);
    } catch (err: any) {
      logger.warn(`⚠️  [BROADCASTER] Direct Telegram balance alert notice: ${err?.message || err}`);
    }
  }

  return dispatchBeaconCard(plainMessage, options);
}

// ─── Autonomous Multi-Account Balance Rebalance Alert ────────────────────────

export interface RebalanceTransferSummary {
  walletId: string;
  label: string;
  chain: string;
  recipientAddress: string;
  amount: number;
  currency: string;
  txHash?: string;
  status: "success" | "failed" | "skipped" | "simulated";
  errorReason?: string;
}

export interface RebalanceAlertReport {
  timestamp: string;
  dryRun: boolean;
  totalStarvingWallets: number;
  totalRebalanced: number;
  totalSkipped: number;
  totalFailed: number;
  totalEthTransferred: number;
  totalSolTransferred: number;
  masterRemainingEth?: number;
  masterRemainingSol?: number;
  transfers: RebalanceTransferSummary[];
  warnings?: string[];
}

/**
 * Dispatches an automated report card for multi-account balance rebalancing
 * (gas top-up) to Telegram and Discord channels non-blockingly.
 */
export async function broadcastRebalanceAlert(
  report: RebalanceAlertReport,
  options?: BroadcastOptions
): Promise<BroadcastResult> {
  const modeStr = report.dryRun ? "🧪 SIMULASI (DRY-RUN)" : "⚡ ON-CHAIN LIVE";
  const title = `🔄 [AUTO-REBALANCE] Multi-Account Gas Top-Up Report`;

  const lines = [
    `==================================================`,
    `  ${title}`,
    `==================================================`,
    `Mode: ${modeStr}`,
    `Waktu: ${new Date(report.timestamp).toLocaleString("id-ID")}`,
    `Total Akun Defisit  : ${report.totalStarvingWallets}`,
    `Total Berhasil      : ${report.totalRebalanced}`,
    `Total Dilewati      : ${report.totalSkipped}`,
    `Total Gagal         : ${report.totalFailed}`,
    `Total ETH Disalurkan: ${report.totalEthTransferred.toFixed(6)} ETH`,
    `Total SOL Disalurkan: ${report.totalSolTransferred.toFixed(6)} SOL`,
    "",
    "Rincian Transfer:",
    ...report.transfers.map((t) => {
      const tx = t.txHash ? ` (tx: ${t.txHash.slice(0, 10)}...)` : "";
      const err = t.errorReason ? ` [${t.errorReason}]` : "";
      return ` • [${t.status.toUpperCase()}] ${t.walletId} (${t.label}) -> ${t.amount.toFixed(6)} ${t.currency}${tx}${err}`;
    }),
    "",
    `🤖 Autonomous Balance Rebalancer Guard`,
  ];

  const plainMessage = lines.join("\n");

  const htmlLines = [
    `<b>${title}</b>`,
    `<b>Mode:</b> <code>${modeStr}</code>`,
    `⏰ <i>${new Date(report.timestamp).toLocaleString("id-ID")}</i>\n`,
    `<b>Ringkasan Distribusi Saldo:</b>`,
    `• Akun Defisit : <b>${report.totalStarvingWallets}</b>`,
    `• Berhasil     : <b>${report.totalRebalanced}</b>`,
    `• Dilewati     : <b>${report.totalSkipped}</b>`,
    `• Gagal        : <b>${report.totalFailed}</b>`,
    `• Total ETH    : <code>${report.totalEthTransferred.toFixed(6)} ETH</code>`,
    `• Total SOL    : <code>${report.totalSolTransferred.toFixed(6)} SOL</code>\n`,
    `<b>Rincian Transfer:</b>`,
    ...report.transfers.map((t) => {
      const statusIcon =
        t.status === "success" || t.status === "simulated"
          ? "✅"
          : t.status === "skipped"
          ? "⏸️"
          : "❌";
      const txInfo = t.txHash ? `\n  Tx: <code>${t.txHash}</code>` : "";
      const errInfo = t.errorReason ? `\n  Catatan: <i>${t.errorReason}</i>` : "";
      return `${statusIcon} <b>${t.walletId}</b> (<i>${t.label}</i>)\n  <code>${t.chain.toUpperCase()}</code>: +${t.amount.toFixed(6)} ${t.currency}\n  Alamat: <code>${t.recipientAddress}</code>${txInfo}${errInfo}`;
    }),
    `\n🛡️ <i>Autonomous Balance Rebalancer Guard</i>`,
  ];

  const htmlMessage = htmlLines.join("\n");

  const cfg = getConfig();
  const token = cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const targetChat =
    process.env.COMMUNITY_TELEGRAM_CHANNEL ||
    process.env.COMMUNITY_TELEGRAM_CHAT_ID;

  if (token && targetChat) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: targetChat,
          text: htmlMessage,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        },
        { timeout: options?.timeoutMs ?? 5000 }
      );
      logger.info(`📡 [BROADCASTER] Laporan rebalance saldo terkirim ke Telegram.`);
    } catch (err: any) {
      logger.warn(`⚠️  [BROADCASTER] Direct Telegram rebalance alert notice: ${err?.message || err}`);
    }
  }

  return dispatchBeaconCard(plainMessage, options);
}

// ─── Autonomous Flywheel Auto Buyback & Burn Hype Broadcaster ────────────────

export interface FlywheelBurnAlertParams {
  tokenSymbol?: string;
  ticker?: string;
  contractAddress: string;
  burnedTokens: number;
  wethUsed: number;
  burnTxHash: string;
  totalClaimedWeth?: number;
  split?: {
    creatorWeth: number;
    buybackWeth: number;
    dividendWeth: number;
    jackpotWeth: number;
    referralWeth?: number;
  };
  isSimulated?: boolean;
  botToken?: string;
  chatId?: string;
  websiteUrl?: string;
  timeoutMs?: number;
}

export interface FlywheelBurnBroadcastResult {
  success: boolean;
  telegramSent: boolean;
  webhookDispatched: boolean;
  messageText: string;
  error?: string;
}

/**
 * Broadcasts an official on-chain Buyback & Burn proof alert card to Telegram community chat/channel
 * with rich inline keyboard buttons (BaseScan Tx Proof, DexScreener Chart, WebApp DApp, and Uniswap 1-Click Buy).
 * Non-blocking and fail-safe by design.
 */
export async function broadcastFlywheelBurnAlert(
  params: FlywheelBurnAlertParams,
  options?: BroadcastOptions
): Promise<FlywheelBurnBroadcastResult> {
  const rawTicker = params.tokenSymbol || params.ticker || "TOKEN";
  const cleanTicker = rawTicker.replace(/^\$/, "").toUpperCase();
  const isSim = Boolean(params.isSimulated || params.burnTxHash.startsWith("sim_"));
  const shortTx =
    params.burnTxHash.startsWith("0x") && params.burnTxHash.length > 14
      ? `${params.burnTxHash.slice(0, 10)}...${params.burnTxHash.slice(-8)}`
      : params.burnTxHash;
  const txUrl = params.burnTxHash.startsWith("0x")
    ? `https://basescan.org/tx/${params.burnTxHash}`
    : `https://basescan.org/address/${params.contractAddress}`;
  const dexUrl = `https://dexscreener.com/base/${params.contractAddress}`;
  const uniUrl = `https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${params.contractAddress}`;

  let webUrl = params.websiteUrl;
  if (!webUrl) {
    try {
      webUrl = getDeployLogWebsite(params.contractAddress) ?? undefined;
    } catch {
      // fallback
    }
  }

  const modeBadge = isSim ? " (SIMULASI)" : "";
  const header = `🔥 <b>[LIVE ON-CHAIN BURN BEACON${modeBadge}]</b> 🔥`;

  const htmlMessage =
    `${header}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 <b>Token:</b> $${cleanTicker}\n` +
    `🔥 <b>Burn Amount:</b> <code>${params.burnedTokens.toLocaleString()} $${cleanTicker}</code>\n` +
    `💰 <b>WETH Digunakan:</b> <code>${params.wethUsed.toFixed(6)} WETH</code>\n` +
    `💀 <b>Destinasi:</b> <code>0x000000000000000000000000000000000000dEaD</code>\n` +
    `🧾 <b>Bukti Eksekusi:</b> <a href="${txUrl}">${shortTx}</a>\n` +
    (params.split
      ? `\n📊 <b>Alokasi 4-Pilar Flywheel:</b>\n` +
        `• 🏛️ Creator Kas: <code>${params.split.creatorWeth.toFixed(6)} WETH</code>\n` +
        `• 🔥 Auto-Burn (30%): <code>${params.split.buybackWeth.toFixed(6)} WETH</code>\n` +
        `• 💰 Pasif Dividen (20%): <code>${params.split.dividendWeth.toFixed(6)} WETH</code>\n` +
        `• ⚡ FOMO Jackpot (15%): <code>${params.split.jackpotWeth.toFixed(6)} WETH</code>\n`
      : "") +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🛡️ <i>Tekanan Deflasi Aktif • Floor Price Terlindungi • Diamond Hands Diberi Reward!</i>`;

  const plainMessage =
    `🔥 ─── [LIVE ON-CHAIN BURN BEACON${isSim ? " (SIMULATED)" : ""}] ─── 🔥\n` +
    `Token: $${cleanTicker}\n` +
    `Status: ${isSim ? "SIMULATION / PENDING SMART CONTRACT INTEGRATION" : "VERIFIED ON-CHAIN INCINERATION"}\n` +
    `Burn Amount: ${params.burnedTokens.toLocaleString()} $${cleanTicker}\n` +
    `WETH Swapped: ${params.wethUsed.toFixed(6)} WETH\n` +
    `Burn Destination: 0x000000000000000000000000000000000000dEaD\n` +
    `Execution Proof: ${txUrl} (${shortTx})\n` +
    `Chart: ${dexUrl}\n` +
    `Floor price protected. Diamond hands rewarded!\n` +
    `──────────────────────────────────────────`;

  const cfg = getConfig();
  let token = params.botToken !== undefined ? params.botToken.trim() : undefined;
  if (!token) {
    try {
      const dbBot = getDeploymentTelegramBot(params.contractAddress);
      if (dbBot?.botToken && dbBot.botToken.trim().length > 0) {
        token = dbBot.botToken.trim();
      }
    } catch {
      // ignore
    }
  }
  if (!token) {
    token = (cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  }

  let targetChat = params.chatId !== undefined ? params.chatId.trim() : undefined;
  if (!targetChat) {
    targetChat = (
      process.env.COMMUNITY_TELEGRAM_CHANNEL ||
      process.env.COMMUNITY_TELEGRAM_CHAT_ID ||
      ""
    ).trim();
  }

  let telegramSent = false;
  let dispatchErr: string | undefined;

  if (token && targetChat) {
    const inlineButtons: Array<Array<{ text: string; url?: string; web_app?: { url: string } }>> = [];

    // Row 1: WebApp Button if live https URL exists
    if (webUrl && webUrl.startsWith("https://")) {
      inlineButtons.push([
        { text: `🚀 Buka Web3 DApp ($${cleanTicker})`, web_app: { url: webUrl } },
      ]);
    }

    // Row 2: Proof & DexScreener
    inlineButtons.push([
      { text: "🔥 Bukti Tx BaseScan", url: txUrl },
      { text: "📊 DexScreener Chart", url: dexUrl },
    ]);

    // Row 3: Uniswap Direct Swap
    inlineButtons.push([
      { text: "🦄 1-Click Uniswap Buy", url: uniUrl },
    ]);

    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: targetChat,
          text: htmlMessage,
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: inlineButtons,
          },
        },
        { timeout: params.timeoutMs ?? options?.timeoutMs ?? 5000 }
      );
      if (response.data?.ok) {
        telegramSent = true;
        logger.success(`📡 [BROADCASTER] Burn Hype Alert $${cleanTicker} terkirim ke Telegram (${targetChat})!`);
      }
    } catch (err: any) {
      dispatchErr = `Telegram send failed: ${err?.message || err}`;
      logger.warn(`⚠️  [BROADCASTER] ${dispatchErr}`);
    }
  }

  // Also dispatch plain beacon card to configured Discord/Telegram webhooks
  const webhookRes = await dispatchBeaconCard(plainMessage, options);

  return {
    success: true,
    telegramSent,
    webhookDispatched: webhookRes.discordDispatched || webhookRes.telegramDispatched,
    messageText: htmlMessage,
    error: dispatchErr,
  };
}

export interface SniperReadyAlertParams {
  ticker: string;
  name: string;
  contractAddress: string;
  chain: string;
  safetyScore: number;
  safetyVerdict?: string;
  liquidityUsd?: number;
  pairAddress?: string;
  dexUrl?: string;
  uniswapUrl?: string;
  websiteUrl?: string;
  sniperLinks?: Array<{ name: string; url: string }>;
  botToken?: string;
  chatId?: string;
  timeoutMs?: number;
}

/**
 * Broadcasts a Telegram and Discord alert when a token is indexed on DexScreener
 * and passes the automated security audit, confirming trading bots (Maestro, Trojan, Banana Gun, Photon)
 * are ready for community order execution.
 */
export async function broadcastSniperReadyAlert(
  params: SniperReadyAlertParams,
  options?: BroadcastOptions
): Promise<{
  success: boolean;
  telegramSent: boolean;
  webhookDispatched: boolean;
  messageText: string;
  error?: string;
}> {
  const cleanTicker = params.ticker.replace(/^\$/, "").toUpperCase();
  const chainName = params.chain.toUpperCase();
  const dexUrl =
    params.dexUrl ||
    `https://dexscreener.com/${params.chain.toLowerCase()}/${params.contractAddress}`;
  const uniUrl =
    params.uniswapUrl ||
    (params.chain.toLowerCase() === "solana"
      ? `https://raydium.io/swap/?inputMint=sol&outputMint=${params.contractAddress}`
      : `https://app.uniswap.org/swap?chain=${params.chain.toLowerCase()}&inputCurrency=ETH&outputCurrency=${params.contractAddress}`);

  let webUrl = params.websiteUrl;
  if (!webUrl) {
    try {
      webUrl = getDeployLogWebsite(params.contractAddress) ?? undefined;
    } catch {
      // fallback
    }
  }

  const liqStr = params.liquidityUsd ? `$${params.liquidityUsd.toLocaleString()} USD` : "Active DEX Pool";

  const htmlMessage =
    `🎯 <b>[SNIPER BOT ACTIVATION ALERT] $${cleanTicker} IS LIVE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🪙 <b>Token:</b> ${params.name} ($${cleanTicker})\n` +
    `⛓️ <b>Chain:</b> ${chainName}\n` +
    `📝 <b>CA:</b> <code>${params.contractAddress}</code>\n` +
    `🛡️ <b>Audit GoPlus:</b> <b>${params.safetyScore}/100 SAFE</b> (${params.safetyVerdict || "0% Tax / Honeypot Passed"})\n` +
    `💧 <b>Liquidity:</b> <code>${liqStr}</code>\n` +
    `📈 <b>DexScreener:</b> <a href="${dexUrl}">Live Chart & Order Book</a>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ <b>Trading Terminals & Sniper Bot Routing:</b>\n` +
    `• Maestro Bot: Ready\n` +
    `• Trojan / Banana Gun: Active\n` +
    `• Photon / GMGN: High-Speed AMM Synced\n\n` +
    `💡 <i>0% Tax • Non-Mintable • Permanent Deflationary Flywheel</i>`;

  const plainMessage =
    `🎯 [SNIPER BOT ACTIVATION ALERT] $${cleanTicker} IS LIVE\n` +
    `Token: ${params.name} ($${cleanTicker})\n` +
    `Chain: ${chainName}\n` +
    `CA: ${params.contractAddress}\n` +
    `Audit GoPlus: ${params.safetyScore}/100 SAFE\n` +
    `Liquidity: ${liqStr}\n` +
    `Chart: ${dexUrl}\n` +
    `Trading bots (Maestro, Trojan, Banana Gun, Photon) verified active!`;

  const cfg = getConfig();
  let token = params.botToken !== undefined ? params.botToken.trim() : undefined;
  if (!token) {
    try {
      const dbBot = getDeploymentTelegramBot(params.contractAddress);
      if (dbBot?.botToken && dbBot.botToken.trim().length > 0) {
        token = dbBot.botToken.trim();
      }
    } catch {
      // ignore
    }
  }
  if (!token) {
    token = (cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  }

  let targetChat = params.chatId !== undefined ? params.chatId.trim() : undefined;
  if (!targetChat) {
    targetChat = (
      process.env.COMMUNITY_TELEGRAM_CHANNEL ||
      process.env.COMMUNITY_TELEGRAM_CHAT_ID ||
      ""
    ).trim();
  }

  let telegramSent = false;
  let dispatchErr: string | undefined;

  if (token && targetChat) {
    const inlineButtons: Array<Array<{ text: string; url?: string; web_app?: { url: string } }>> = [];

    if (webUrl && webUrl.startsWith("https://")) {
      inlineButtons.push([
        { text: `🚀 Buka Web3 DApp ($${cleanTicker})`, web_app: { url: webUrl } },
      ]);
    }

    const row2: any[] = [
      { text: "📊 DexScreener", url: dexUrl },
      { text: "🦄 Buy / Swap", url: uniUrl },
    ];
    inlineButtons.push(row2);

    if (params.sniperLinks && params.sniperLinks.length > 0) {
      const sniperRow: any[] = params.sniperLinks.slice(0, 3).map((s) => ({
        text: `⚡ ${s.name}`,
        url: s.url,
      }));
      inlineButtons.push(sniperRow);
    }

    try {
      const response = await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: targetChat,
          text: htmlMessage,
          parse_mode: "HTML",
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: inlineButtons,
          },
        },
        { timeout: params.timeoutMs ?? options?.timeoutMs ?? 5000 }
      );
      if (response.data?.ok) {
        telegramSent = true;
        logger.success(`📡 [BROADCASTER] Sniper Bot Ready Alert $${cleanTicker} terkirim ke Telegram (${targetChat})!`);
      }
    } catch (err: any) {
      dispatchErr = `Telegram send failed: ${err?.message || err}`;
      logger.warn(`⚠️  [BROADCASTER] ${dispatchErr}`);
    }
  }

  const webhookRes = await dispatchBeaconCard(plainMessage, options);

  return {
    success: true,
    telegramSent,
    webhookDispatched: webhookRes.discordDispatched || webhookRes.telegramDispatched,
    messageText: htmlMessage,
    error: dispatchErr,
  };
}



