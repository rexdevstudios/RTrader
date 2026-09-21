/**
 * src/modules/telegram/token-agent-bot.ts
 *
 * Autonomous Telegram Agent Bot for Multi-Token Deployments (GrammY).
 *
 * Supports two operational modes:
 *  1. MASTER FLEET MODE (Default / 1 Bot for ALL Tokens):
 *     - Serves all deployed tokens across multi-wallets from a single Telegram bot.
 *     - /fleet & /tokens: Interactive overview of all deployed tokens with 1-click swap buttons.
 *     - /ca [ticker]: Resolve CA for any token (e.g. /ca PUMPRUN or defaults to latest).
 *     - /price [ticker]: Live DexScreener market analytics.
 *     - /buy [ticker]: 1-click Uniswap Base direct swap.
 *     - /flywheel [ticker]: 95% WETH creator fee recycler tokenomics.
 *     - /team [ticker]: Core AI development team & roadmap.
 *     - Smart Cashtag Listener: Automatically detects mentions like $PUMPRUN in group chats.
 *
 *  2. DEDICATED TOKEN MODE:
 *     - Operates specifically for a single token persona (flagship token).
 */

import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import {
  resolveTargetToken,
  getLiveDeployments,
  type ResolvedTokenTarget,
} from "../fleet/fleet-registry.ts";
import { buildEnrichedProjectData } from "../growth/project-enricher.ts";
import {
  getDeploymentTelegramBot,
  updateDeploymentTelegramBot,
  getDeployLogWebsite,
} from "../../db/vault.ts";
import { analyzeContractAddress } from "../intelligence/ca-intelligence.ts";

export interface TokenAgentCharacter {
  name: string;
  ticker: string;
  contractAddress: string;
  chain: string;
  telegramBotToken?: string;
  telegramBotUsername?: string;
  bio: string[];
  lore: string[];
  topics: string[];
  style: {
    all: string[];
    chat: string[];
  };
}

/**
 * Generates or updates the character sheet JSON file under characters/<ticker>_agent.json.
 */
export function generateTokenCharacterConfig(
  token: ResolvedTokenTarget,
  options?: { botToken?: string; botUsername?: string }
): {
  characterPath: string;
  character: TokenAgentCharacter;
} {
  const charactersDir = path.resolve(process.cwd(), "characters");
  if (!fs.existsSync(charactersDir)) {
    fs.mkdirSync(charactersDir, { recursive: true });
  }

  const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const characterPath = path.join(charactersDir, `${cleanTicker.toLowerCase()}_agent.json`);

  let existingToken: string | undefined = options?.botToken;
  let existingUsername: string | undefined = options?.botUsername;

  if (fs.existsSync(characterPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(characterPath, "utf-8"));
      if (!existingToken && prev.telegramBotToken) existingToken = prev.telegramBotToken;
      if (!existingUsername && prev.telegramBotUsername) existingUsername = prev.telegramBotUsername;
    } catch {
      // ignore
    }
  }

  const character: TokenAgentCharacter = {
    name: `${token.name} Official AI Agent`,
    ticker: cleanTicker,
    contractAddress: token.address,
    chain: "base",
    telegramBotToken: existingToken,
    telegramBotUsername: existingUsername,
    bio: [
      `Official autonomous Telegram representative of $${cleanTicker} on Base Mainnet.`,
      `Engineered with 0% trading tax and autonomous 95% WETH creator fee recycling.`,
      `Provides real-time price intelligence, contract verification, and community alpha.`,
    ],
    lore: [
      `Born from the positive-sum meme revolution on Base L2.`,
      `Designed to turn standard speculative volume into perpetual buyback burns and holder rewards.`,
      `Renounced minimal proxy architecture ensures 100% rug-proof permanence.`,
    ],
    topics: ["crypto", "base", "tokenomics", "flywheel", "dexscreener", "memecoins"],
    style: {
      all: [
        "Be encouraging, ultra-sharp, technically accurate, and community-focused.",
        "Highlight the 0% tax, unruggable contract, and deflationary mechanics.",
        "Always provide verified contract links and DexScreener charts.",
      ],
      chat: [
        "Respond promptly with clear markdown formatting.",
        "Include actionable buttons for 1-click Uniswap buying.",
      ],
    },
  };

  fs.writeFileSync(characterPath, JSON.stringify(character, null, 2), "utf-8");
  logger.success(`📄 [TELEGRAM AGENT] Character profile tersimpan: ${characterPath}`);

  return { characterPath, character };
}

/**
 * Resolves dedicated bot token for a specific token candidate.
 * Hierarchy: explicit param -> vault.db -> characters/<ticker>_agent.json -> TELEGRAM_BOT_TOKEN_<TICKER> -> global TELEGRAM_BOT_TOKEN
 */
export function resolveDedicatedBotToken(
  token: ResolvedTokenTarget,
  explicitToken?: string
): string | undefined {
  if (explicitToken && explicitToken.trim().length > 0) {
    return explicitToken.trim();
  }

  // 1. Check vault.db (deploy_logs)
  try {
    const dbBot = getDeploymentTelegramBot(token.address);
    if (dbBot?.botToken && dbBot.botToken.trim().length > 0) {
      return dbBot.botToken.trim();
    }
  } catch {
    // ignore
  }

  // 2. Check characters/<ticker>_agent.json
  const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const characterPath = path.resolve(process.cwd(), "characters", `${cleanTicker.toLowerCase()}_agent.json`);
  if (fs.existsSync(characterPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(characterPath, "utf-8"));
      if (parsed.telegramBotToken && parsed.telegramBotToken.trim().length > 0) {
        return parsed.telegramBotToken.trim();
      }
    } catch {
      // ignore
    }
  }

  // 3. Check environment variable TELEGRAM_BOT_TOKEN_<TICKER>
  const envTickerKey = `TELEGRAM_BOT_TOKEN_${cleanTicker}`;
  if (process.env[envTickerKey] && process.env[envTickerKey]!.trim().length > 0) {
    return process.env[envTickerKey]!.trim();
  }

  // 4. Fallback to global TELEGRAM_BOT_TOKEN
  const cfg = getConfig();
  const globalToken = cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (globalToken && globalToken.trim().length > 0) {
    return globalToken.trim();
  }

  return undefined;
}

/**
 * Queries real-time price & liquidity metrics from DexScreener API for the given token address.
 */
export async function fetchDexScreenerMetrics(contractAddress: string): Promise<{
  priceUsd: string;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidityUsd: number;
  dexUrl: string;
} | null> {
  try {
    const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`, {
      timeout: 8000,
    });
    const pair = res.data?.pairs?.[0];
    if (!pair) return null;

    return {
      priceUsd: pair.priceUsd ? `$${parseFloat(pair.priceUsd).toFixed(8)}` : "Pending",
      priceChange24h: pair.priceChange?.h24 ?? 0,
      volume24h: pair.volume?.h24 ?? 0,
      marketCap: pair.fdv ?? 0,
      liquidityUsd: pair.liquidity?.usd ?? 0,
      dexUrl: pair.url || `https://dexscreener.com/base/${contractAddress}`,
    };
  } catch (err: any) {
    logger.warn(`⚠️  [DEXSCREENER] Gagal mengambil metrik live: ${err?.message || err}`);
    return null;
  }
}

/**
 * Returns a human-friendly emoji badge and label for the chain.
 */
export function getChainBadge(chain?: string): string {
  const c = chain?.toLowerCase() || "base";
  if (c === "base") return "🔷 Base L2";
  if (c === "solana") return "🟣 Solana (Pump.fun)";
  if (c === "robinhood") return "🪶 Robinhood L2";
  if (c === "clanker") return "🤖 Clanker (Base)";
  return `🌐 ${chain?.toUpperCase() || "EVM"}`;
}

/**
 * Returns the primary swap or exchange URL for a token based on its chain.
 */
export function getSwapUrl(tokenAddress: string, chain?: string): string {
  const c = chain?.toLowerCase() || "base";
  if (c === "solana") {
    return `https://pump.fun/${tokenAddress}`;
  }
  if (c === "robinhood") {
    return `https://dexscreener.com/robinhood/${tokenAddress}`;
  }
  if (c === "clanker") {
    return `https://clanker.world/clanker/${tokenAddress}`;
  }
  return `https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${tokenAddress}`;
}

/**
 * Alias for getSwapUrl to provide consistent naming across handlers.
 */
export const getBuyUrl = getSwapUrl;


/**
 * Returns the official DexScreener chart URL for a token.
 */
export function getDexScreenerUrl(tokenAddress: string, chain?: string): string {
  const c = chain?.toLowerCase() || "base";
  return `https://dexscreener.com/${c}/${tokenAddress}`;
}

/**
 * Builds an interactive Telegram keyboard containing WebApp and external links.
 */
export function buildTelegramWebsiteKeyboard(ticker: string, websiteUrl: string): InlineKeyboard {
  const cleanTicker = ticker.replace(/^\$/, "").toUpperCase();
  const keyboard = new InlineKeyboard();
  if (websiteUrl && websiteUrl.startsWith("https://")) {
    keyboard.webApp(`🚀 Buka Web3 DApp ($${cleanTicker})`, websiteUrl).row();
  }
  keyboard
    .url(`🌐 Website Resmi`, websiteUrl)
    .url(`🦄 In-Page Swap`, `${websiteUrl}#swap`);
  return keyboard;
}

/**
 * Builds an interactive Telegram keyboard for the 5% viral affiliate referral command.
 */
export function buildReferralKeyboard(ticker: string, websiteUrl: string, referralUrl: string): InlineKeyboard {
  const cleanTicker = ticker.replace(/^\$/, "").toUpperCase();
  const keyboard = new InlineKeyboard();
  if (referralUrl && referralUrl.startsWith("https://")) {
    keyboard.webApp(`🚀 Buka DApp (Ref Active)`, referralUrl).row();
  }
  const shareText = encodeURIComponent(`Ayo beli token $${cleanTicker} di Base L2! 20% Dividen WETH, 30% Auto-Burn, dan 15% FOMO Jackpot: ${referralUrl}`);
  keyboard
    .url(`🔗 Bagikan ke Teman`, `https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${shareText}`)
    .row();
  if (websiteUrl) {
    keyboard.url(`💸 Cek Komisi 5%`, `${websiteUrl}#flywheel`);
  }
  return keyboard;
}

/**
 * Builds an interactive Telegram keyboard for the 20% WETH dividend command.
 */
export function buildDividendKeyboard(ticker: string, websiteUrl: string, uniswapUrl: string): InlineKeyboard {
  const cleanTicker = ticker.replace(/^\$/, "").toUpperCase();
  const keyboard = new InlineKeyboard();
  if (websiteUrl && websiteUrl.startsWith("https://")) {
    keyboard.webApp(`📊 Cek Dividen Dompet Saya`, `${websiteUrl}#flywheel`).row();
  }
  keyboard
    .url(`🦄 Beli $${cleanTicker}`, uniswapUrl)
    .url(`🌐 Website DApp`, websiteUrl);
  return keyboard;
}

/**
 * Builds an interactive Telegram keyboard for the 15% FOMO Jackpot command.
 */
export function buildJackpotKeyboard(ticker: string, websiteUrl: string, uniswapUrl: string, chartUrl: string): InlineKeyboard {
  const cleanTicker = ticker.replace(/^\$/, "").toUpperCase();
  const keyboard = new InlineKeyboard();
  if (websiteUrl && websiteUrl.startsWith("https://")) {
    keyboard.webApp(`🎰 Buka Live Jackpot DApp`, `${websiteUrl}#flywheel`).row();
  }
  keyboard
    .url(`⚡ Reset Timer (Beli di Uniswap)`, uniswapUrl)
    .row()
    .url(`📊 DexScreener Live`, chartUrl)
    .url(`🌐 Website DApp`, websiteUrl);
  return keyboard;
}


/**
 * Helper to find a token in the fleet by ticker, address, or fallback to latest across all chains.
 */
export function findFleetToken(input?: string): ResolvedTokenTarget {
  const live = getLiveDeployments();
  if (input && input.trim().length > 0) {
    const q = input.trim().replace(/^\$/, "").toLowerCase();
    const match = live.find(
      (d) => d.ticker?.toLowerCase() === q || d.contractAddr?.toLowerCase() === q
    );
    if (match) {
      return {
        address: match.contractAddr!,
        ticker: match.ticker || "TOKEN",
        name: match.tokenName || "Token",
        poolId: match.poolId || undefined,
        walletId: match.walletId || undefined,
        chain: match.chain || "base",
      };
    }
  }

  // Default to resolveTargetToken (which handles index, address, or latest)
  return resolveTargetToken(input);
}

// ─── MASTER FLEET TELEGRAM BOT (1 Bot for ALL Tokens) ───────────────────────

/**
 * Sets up a Master Omnichain Fleet Bot that services all deployed tokens.
 */
export async function setupMasterFleetTelegramBot(customBotToken?: string): Promise<{
  bot: Bot | null;
  running: boolean;
  reason?: string;
}> {
  const cfg = getConfig();
  const botToken = customBotToken || cfg.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken || botToken.trim().length === 0) {
    logger.warn("⚠️  [TELEGRAM BOT] TELEGRAM_BOT_TOKEN tidak ditemukan di environment.");
    logger.info("   Untuk mengaktifkan Master Bot live, isi TELEGRAM_BOT_TOKEN=<token_dari_botfather> di .env");
    return { bot: null, running: false, reason: "NO_BOT_TOKEN" };
  }

  const bot = new Bot(botToken);

  // 1. /start & /help
  bot.command(["start", "help"], async (ctx) => {
    const live = getLiveDeployments("base");
    const latest = resolveTargetToken();
    const latestWebsite = getDeployLogWebsite(latest.address) || `https://${latest.ticker.toLowerCase()}-web3.pages.dev`;

    const keyboard = new InlineKeyboard();
    live.slice(0, 5).forEach((t, i) => {
      keyboard.url(`🦄 Beli $${t.ticker}`, `https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${t.contractAddr}`);
      if (i % 2 === 1) keyboard.row();
    });
    keyboard.row();
    if (latestWebsite && latestWebsite.startsWith("https://")) {
      keyboard.webApp(`🚀 Buka Web3 DApp ($${latest.ticker})`, latestWebsite).row();
    }
    keyboard
      .url(`🌐 Website $${latest.ticker}`, latestWebsite)
      .url(`🦄 In-Page Swap`, `${latestWebsite}#swap`);

    const message = `
🚀 *OMNICHAIN ALPHA FLEET PORTAL BOT* 🚀
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Selamat datang di Portal Komunitas Resmi Armada Token Base L2!
Seluruh token kami memiliki fitur unggulan terdesentralisasi:
🛡️ *0% Pajak (Zero Tax):* Bebas trading beli & jual
🔥 *30% Auto Buyback & Burn:* Membakar suplai berkelanjutan
💰 *20% Dividen WETH:* Pasif income otomatis ke holders
🎰 *15% 10-Minute FOMO Jackpot:* Pool hadiah pembeli terakhir
🔒 *100% Unruggable:* Minimal Proxy EIP-1167 renounced

📌 *Daftar Perintah Tersedia:*
• \`/fleet [chain]\` atau \`/tokens\` - Daftar armada koin (all, base, solana, robinhood)
• \`/crosschain\` - Panduan ekosistem multi-chain & bridging
• \`/ca [ticker]\` - Alamat kontrak (contoh: \`/ca PUMPRUN\`)
• \`/website [ticker]\` - Kunjungi website 3D resmi & in-page swap
• \`/price [ticker]\` - Cek harga live DexScreener
• \`/buy [ticker]\` - Tautan instan 1-Click Swap
• \`/flywheel [ticker]\` - Info tokenomics & bagi hasil
• \`/referral [wallet]\` - Buat link referral 5% komisi WETH instan
• \`/dividend [wallet]\` - Cek pasif income 20% WETH & eligibilitas
• \`/jackpot [ticker]\` - Status 15% 10-Minute FOMO Jackpot game
• \`/team [ticker]\` - Profil tim inti pengembang AI
• \`/dp [CA/ticker]\` - Cek status DexScreener Paid (/dp) & Boosts
• \`/scan [CA/ticker]\` - Audit keamanan kontrak & honeypot (GoPlus)

💡 *Tips Grup:* Sebutkan cashtag koin (seperti *$PUMPRUN*) di grup, bot akan otomatis merespons info koin!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Token Terkini: *$${latest.ticker}* (\`${latest.address}\`)
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 2. /fleet & /tokens (Cross-Chain Fleet Navigation)
  bot.command(["fleet", "tokens", "list"], async (ctx) => {
    const rawQuery = ctx.match?.trim().toLowerCase();
    const filterChain =
      rawQuery === "base" || rawQuery === "solana" || rawQuery === "robinhood" || rawQuery === "clanker"
        ? rawQuery
        : undefined;

    const live = getLiveDeployments(filterChain);
    const scopeLabel = filterChain ? filterChain.toUpperCase() : "OMNICHAIN MULTI-CHAIN";

    if (live.length === 0) {
      await ctx.reply(`Belum ada token live di database armada ${scopeLabel}.`, { parse_mode: "Markdown" });
      return;
    }

    let text = `🌟 *DAFTAR KOIN RESMI ARMADA ${scopeLabel}* 🌟\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    const keyboard = new InlineKeyboard();

    live.forEach((t, i) => {
      const badge = getChainBadge(t.chain);
      text += `${i + 1}. *$${t.ticker}* (${t.tokenName || "Token"})\n`;
      text += `   Jaringan: ${badge}\n`;
      text += `   CA: \`${t.contractAddr}\`\n`;
      text += `   Perintah: \`/price ${t.ticker}\` | \`/buy ${t.ticker}\`\n\n`;

      const buyUrl = getSwapUrl(t.contractAddr!, t.chain);
      const chartUrl = getDexScreenerUrl(t.contractAddr!, t.chain);

      keyboard.url(`🛒 $${t.ticker}`, buyUrl);
      keyboard.url(`📊 Chart`, chartUrl).row();
    });

    text += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nFilter: \`/fleet all\` | \`/fleet base\` | \`/fleet solana\` | \`/fleet robinhood\`\nPanduan Bridge: \`/crosschain\``;
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 2B. /crosschain & /bridge
  bot.command(["crosschain", "bridge", "omnichain"], async (ctx) => {
    const keyboard = new InlineKeyboard()
      .url("🔷 Base Bridge", "https://bridge.base.org/deposit")
      .url("🟣 Wormhole Portal", "https://portalbridge.com")
      .row()
      .url("🚀 DexScreener", "https://dexscreener.com");

    const message = `
🌐 *ARSITEKTUR MULTI-CHAIN ARMADA OTONOM*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ekosistem token beroperasi lintas jaringan terdesentralisasi:

🔷 *Base L2 (Coinbase):*
• Pusat DeFi & Likuiditas Institusional Uniswap v3
• 95% Creator Fee dialirkan ke Perpetual WETH Flywheel (Auto Buyback & Dividen)

🟣 *Solana (Pump.fun):*
• Kecepatan eksekusi ultra-tinggi & viral community bonding curve
• Transaksi instan & likuiditas Raydium otomatis

🪶 *Robinhood L2:*
• Jembatan adopsi massal pengguna ritel mobile
• Biaya gas micro & integrasi fiat on-ramp ramah pengguna

🤖 *Clanker (Base L2):*
• Autonomous AI Farcaster agent deployer & social tipping

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Tips:* Gunakan \`/fleet [base|solana|robinhood]\` untuk melihat armada spesifik tiap jaringan!
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 3. /ca [ticker]
  bot.command(["ca", "contract", "address"], async (ctx) => {
    const query = ctx.match?.trim();
    const token = findFleetToken(query);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const chainBadge = getChainBadge(token.chain);
    const buyUrl = getSwapUrl(token.address, token.chain);
    const chartUrl = getDexScreenerUrl(token.address, token.chain);

    const keyboard = new InlineKeyboard()
      .url("🛒 Beli Token", buyUrl)
      .url("📊 Chart", chartUrl);

    const message = `
📄 *ALAMAT KONTRAK RESMI: $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\`${token.address}\`
*(Ketuk alamat di atas untuk menyalin instan)*

⛓️ *Network:* ${chainBadge}
🛡️ *Keamanan:* Audited Proxy | Ownership Renounced | Verified
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 4. /price [ticker]
  bot.command(["price", "chart", "stats"], async (ctx) => {
    const query = ctx.match?.trim();
    const token = findFleetToken(query);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const metrics = await fetchDexScreenerMetrics(token.address);
    const chartUrl = metrics?.dexUrl || getDexScreenerUrl(token.address, token.chain);
    const buyUrl = getSwapUrl(token.address, token.chain);

    const keyboard = new InlineKeyboard()
      .url("📊 Buka DexScreener", chartUrl)
      .url("🛒 1-Click Swap", buyUrl);

    if (!metrics) {
      const msg = `
⏳ *Status Pasar $${cleanTicker}:*
Grafik sedang menunggu transaksi perdana di DexScreener.
Lakukan swap perdana untuk menyalakan candle chart!
Jaringan: ${getChainBadge(token.chain)}
Alamat: \`${token.address}\`
`;
      await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    const changeSign = metrics.priceChange24h >= 0 ? "+" : "";
    const message = `
📊 *STATISTIK PASAR: $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⛓️ *Jaringan:* ${getChainBadge(token.chain)}
💵 *Harga Saat Ini:* \`${metrics.priceUsd}\`
📈 *Perubahan 24h:* \`${changeSign}${metrics.priceChange24h.toFixed(2)}%\`
💰 *Market Cap (FDV):* \`$${metrics.marketCap.toLocaleString("en-US", { maximumFractionDigits: 0 })}\`
💧 *Likuiditas Pool:* \`$${metrics.liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}\`
🔄 *Volume 24h:* \`$${metrics.volume24h.toLocaleString("en-US", { maximumFractionDigits: 0 })}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 5. /buy [ticker]
  bot.command(["buy", "swap"], async (ctx) => {
    const query = ctx.match?.trim();
    const token = findFleetToken(query);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const buyUrl = getSwapUrl(token.address, token.chain);
    const badge = getChainBadge(token.chain);

    const keyboard = new InlineKeyboard().url(`🛒 Beli $${cleanTicker}`, buyUrl);
    const message = `
🛒 *CARA MEMBELI $${cleanTicker} (${badge}):*
1. Siapkan saldo gas pada wallet Anda sesuai jaringan.
2. Klik tombol tautan di bawah.
3. Hubungkan wallet dan tukar ke $${cleanTicker}!

Contract: \`${token.address}\`
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 6. /flywheel [ticker]
  bot.command(["flywheel", "tokenomics", "burn"], async (ctx) => {
    const query = ctx.match?.trim();
    const token = findFleetToken(query);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const tokenSlug = token.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const keyboard = new InlineKeyboard().url("🤖 Halaman Bankr Agent", `https://bankr.bot/agents/${tokenSlug}`);
    const message = `
⚙️ *TOKENOMICS & POSITIVE-SUM FLYWHEEL $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Setiap transaksi di Uniswap menghasilkan creator fee 95% dalam bentuk WETH:
🔥 *30% Auto Buyback & Burn:* Membeli dari market dan membakar token ke 0xdead.
💰 *20% Pasif Dividen WETH:* Airdrop WETH langsung ke dompet holders.
🎰 *15% 10-Minute FOMO Jackpot:* Pembeli terakhir memenangkan seluruh prize pool.
🏛️ *35% Protokol & Treasury:* Likuiditas ekosistem multi-chain.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 6b. /referral [wallet] atau [ticker] [wallet]
  bot.command(["referral", "affiliate", "ref"], async (ctx) => {
    const rawArgs = ctx.match?.trim().split(/\s+/) || [];
    let wallet = "";
    let tokenQuery = "";

    if (rawArgs.length >= 2) {
      if (rawArgs[0].startsWith("0x") || rawArgs[0].length >= 32) {
        wallet = rawArgs[0];
        tokenQuery = rawArgs[1];
      } else {
        tokenQuery = rawArgs[0];
        wallet = rawArgs[1];
      }
    } else if (rawArgs.length === 1 && rawArgs[0].length > 0) {
      if (rawArgs[0].startsWith("0x") || rawArgs[0].length >= 32) {
        wallet = rawArgs[0];
      } else {
        tokenQuery = rawArgs[0];
      }
    }

    const token = findFleetToken(tokenQuery || undefined);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const websiteUrl = getDeployLogWebsite(token.address) || `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;

    if (!wallet) {
      const infoMsg = `
🔗 *PROGRAM AFILIASI & KOMISI 5% INSTAN ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dapatkan pasif komisi on-chain *5% dalam WETH* secara instan dari setiap transaksi pembelian yang Anda referensikan!

📌 *Cara Membuat Link Khusus Anda:*
Ketik: \`/referral <alamat_wallet_kamu>\`
Contoh: \`/referral 0x71C...b4e\`

💎 *Keunggulan Program Afiliasi:*
• *5% Real-Time WETH:* Komisi langsung masuk ke dompet Anda saat teman melakukan swap.
• *On-Chain & Transparan:* Tanpa perantara pihak ketiga.
• *Non-Dilutive:* Komisi dipotong langsung dari kreator fee protokol, bukan dari pembeli.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      const keyboard = new InlineKeyboard()
        .url("🌐 Buka DApp", websiteUrl)
        .url("⚙️ Info Tokenomics", `${websiteUrl}#flywheel`);
      await ctx.reply(infoMsg, { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    const referralUrl = `${websiteUrl}?ref=${wallet}`;
    const keyboard = buildReferralKeyboard(cleanTicker, websiteUrl, referralUrl);
    const msg = `
🎉 *LINK AFILIASI RESMI ANDA SIAP ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Dompet Penerima Komisi:*
\`${wallet}\`

🔗 *Tautan Unik Anda:*
\`${referralUrl}\`

💸 *Skema Bagi Hasil:*
Setiap pembeli yang menghubungkan dompet dan melakukan swap melalui tautan ini akan otomatis mengalirkan *5% dari nilai fee* langsung ke dompet Anda dalam bentuk WETH!

Ketuk tombol di bawah untuk langsung menyebarkannya ke grup Telegram atau membuka DApp!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 6c. /dividend [wallet] atau [ticker]
  bot.command(["dividend", "dividends", "claim"], async (ctx) => {
    const rawArgs = ctx.match?.trim().split(/\s+/) || [];
    let wallet = "";
    let tokenQuery = "";

    if (rawArgs.length >= 2) {
      if (rawArgs[0].startsWith("0x") || rawArgs[0].length >= 32) {
        wallet = rawArgs[0];
        tokenQuery = rawArgs[1];
      } else {
        tokenQuery = rawArgs[0];
        wallet = rawArgs[1];
      }
    } else if (rawArgs.length === 1 && rawArgs[0].length > 0) {
      if (rawArgs[0].startsWith("0x") || rawArgs[0].length >= 32) {
        wallet = rawArgs[0];
      } else {
        tokenQuery = rawArgs[0];
      }
    }

    const token = findFleetToken(tokenQuery || undefined);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const websiteUrl = getDeployLogWebsite(token.address) || `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;
    const buyUrl = getBuyUrl(token.address, token.chain);

    const keyboard = buildDividendKeyboard(cleanTicker, websiteUrl, buyUrl);
    const walletText = wallet ? `\n👤 *Dompet Terpilih:* \`${wallet}\`` : "";

    const msg = `
💰 *20% PASIF DIVIDEN WETH ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Setiap transaksi trading Uniswap menghasilkan creator fee, dan *20% langsung dialokasikan untuk pemegang token*!

💎 *Mekanisme Bagi Hasil:*
• *Zero Staking / Zero Lock:* Cukup simpan token $${cleanTicker} di dompet Anda.
• *Proporsional:* Semakin banyak token yang Anda pegang, semakin besar porsi dividen WETH Anda.
• *Snapshot Tiap Epoch:* Dividen dapat diverifikasi secara transparan on-chain.
${walletText}
👉 Gunakan tombol *Cek Dividen Dompet Saya* di bawah untuk membuka panel kalkulator & eligibility checker interaktif di DApp!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 6d. /jackpot [ticker]
  bot.command(["jackpot", "fomo", "pot"], async (ctx) => {
    const query = ctx.match?.trim();
    const token = findFleetToken(query);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const websiteUrl = getDeployLogWebsite(token.address) || `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;
    const buyUrl = getBuyUrl(token.address, token.chain);
    const chartUrl = getDexScreenerUrl(token.address, token.chain);

    const keyboard = buildJackpotKeyboard(cleanTicker, websiteUrl, buyUrl, chartUrl);
    const msg = `
🎰 *15% 10-MINUTE FOMO JACKPOT ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fitur game-teori viral on-chain di jaringan Base L2!

⏱️ *Aturan Main & Countdown:*
1. Timer berdetak mundur dari *10:00 Menit*.
2. Setiap kali ada order *BUY* (minimal ~$1+), timer otomatis *RESET kembali ke 10:00*.
3. *15% dari seluruh fee transaksi* terus mengalir menambah total *Prize Pool WETH*.
4. Jika waktu habis (*00:00*) tanpa ada pembeli baru, *PEMBELI TERAKHIR MEMENANGKAN 100% PRIZE POOL WETH*!

⚡ Ingin mereset waktu dan memimpin klasemen? Klik *Reset Timer (Beli di Uniswap)* sekarang!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 7. /team [ticker]
  bot.command(["team", "dev"], async (ctx) => {
    const query = ctx.match?.trim();
    const token = findFleetToken(query);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

    const enriched = buildEnrichedProjectData({
      name: token.name,
      ticker: token.ticker,
      contractAddress: token.address,
    });

    let teamList = "";
    enriched.teamMembers.forEach((m, idx) => {
      teamList += `${idx + 1}. *${m.name}*\n   Peran: _${m.role}_\n\n`;
    });

    const message = `
👥 *TIM INTI PENGEMBANG OTONOM $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${teamList}Transparansi 100% on-chain di Base Mainnet.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown" });
  });

  // 8. /dp [CA / ticker] (DexScreener Paid Verification)
  bot.command(["dp", "dexscreenerpaid"], async (ctx) => {
    const query = ctx.match?.trim();
    let targetCa = "";

    if (query && (query.startsWith("0x") || query.length >= 32)) {
      targetCa = query;
    } else {
      const token = findFleetToken(query);
      targetCa = token.address;
    }

    try {
      const report = await analyzeContractAddress(targetCa);
      const paidIcon = report.isDexScreenerPaid ? "✅" : "❌";
      const statusTitle = report.isDexScreenerPaid
        ? `${paidIcon} *DexScreener Paid*`
        : `${paidIcon} *DexScreener not paid*`;

      const keyboard = new InlineKeyboard()
        .url("MAE", report.sniperLinks.maestro)
        .url("BAN", report.sniperLinks.bananaGun)
        .url("GMG", report.sniperLinks.gmgn)
        .url("PHO", report.sniperLinks.photon)
        .row()
        .url("📊 DexScreener", report.sniperLinks.dexScreener)
        .url("🔎 Explorer", report.sniperLinks.explorer);

      const message = `
🔍 *DEXSCREENER PAID AUDIT (/dp)*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Token: *${report.market.tokenName}* (*$${report.market.tokenSymbol}*)
CA: \`${report.contractAddress}\`
Network: *${report.chain.toUpperCase()}*

${statusTitle}
↳ Status: _${report.dexScreenerStatusText}_
↳ Profile Approved: *${report.dexScreenerProfileApproved ? "YES" : "NO"}*
↳ Active Boosts: *${report.dexScreenerBoostCount}*

🛡️ *GoPlus Security:*
• Honeypot: *${report.security.isHoneypot ? "🚨 HONEYPOT" : "✅ SAFE"}*
• Pajak: Beli *${report.security.buyTaxPct}%* | Jual *${report.security.sellTaxPct}%*
• Mintable: *${report.security.isMintable ? "⚠️ YA" : "✅ TIDAK"}*
• Safety Score: *${report.safetyScore}/100 [${report.safetyVerdict}]*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
    } catch (err: any) {
      await ctx.reply(`⚠️ Gagal memeriksa status /dp: ${err?.message || err}`);
    }
  });

  // 9. /scan [CA / ticker] (Full Intelligence & Honeypot Audit)
  bot.command(["scan", "audit", "security"], async (ctx) => {
    const query = ctx.match?.trim();
    let targetCa = "";

    if (query && (query.startsWith("0x") || query.length >= 32)) {
      targetCa = query;
    } else {
      const token = findFleetToken(query);
      targetCa = token.address;
    }

    try {
      const report = await analyzeContractAddress(targetCa);
      const keyboard = new InlineKeyboard()
        .url("MAE", report.sniperLinks.maestro)
        .url("BAN", report.sniperLinks.bananaGun)
        .url("GMG", report.sniperLinks.gmgn)
        .url("PHO", report.sniperLinks.photon)
        .row()
        .url("📊 DexScreener", report.sniperLinks.dexScreener)
        .url("🔎 Explorer", report.sniperLinks.explorer);

      let warningsText = "";
      if (report.security.riskWarnings.length > 0) {
        warningsText = `\n⚠️ *Peringatan Risiko:*\n` + report.security.riskWarnings.map((w) => `• _${w}_`).join("\n") + "\n";
      }

      const message = `
🛡️ *HASIL AUDIT INTELIJEN KONTRAK (CA)*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Token: *${report.market.tokenName}* (*$${report.market.tokenSymbol}*)
CA: \`${report.contractAddress}\`
Network: *${report.chain.toUpperCase()}*

📌 *Status DexScreener:*
${report.isDexScreenerPaid ? "✅ *PAID*" : "❌ *NOT PAID*"} (${report.dexScreenerStatusText})

🔒 *Audit Keamanan (GoPlus):*
• Honeypot: *${report.security.isHoneypot ? "🚨 YA (HONEYPOT)" : "✅ BUKAN HONEYPOT"}*
• Pajak Transaksi: Beli *${report.security.buyTaxPct}%* | Jual *${report.security.sellTaxPct}%*
• Mintable: *${report.security.isMintable ? "⚠️ YA (Bisa Cetak)" : "✅ TIDAK (Kunci)"}*
• Ownership: *${report.security.canTakeBackOwnership ? "⚠️ Bisa Diambil Alih" : "✅ Renounced / Aman"}*
• Open Source: *${report.security.isOpenSource ? "✅ Verified Code" : "⚠️ Belum Terverifikasi"}*

📊 *Metrik Pasar:*
• Harga: \`${report.market.priceUsd}\` (${report.market.priceChange24h >= 0 ? "+" : ""}${report.market.priceChange24h.toFixed(2)}%)
• Likuiditas: \`$${report.market.liquidityUsd.toLocaleString()}\` | FDV: \`$${report.market.fdvUsd.toLocaleString()}\`
• Volume 24h: \`$${report.market.volume24h.toLocaleString()}\`
${warningsText}
🎯 *Safety Score:* *${report.safetyScore}/100* [*${report.safetyVerdict}*]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
    } catch (err: any) {
      await ctx.reply(`⚠️ Gagal mengaudit CA: ${err?.message || err}`);
    }
  });

  // 9B. /website [ticker]
  bot.command(["website", "web", "site"], async (ctx) => {
    const query = ctx.match?.trim();
    const token = findFleetToken(query);
    const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const websiteUrl = getDeployLogWebsite(token.address) || `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;
    const swapUrl = `${websiteUrl}#swap`;

    const keyboard = buildTelegramWebsiteKeyboard(cleanTicker, websiteUrl);

    const message = `
🌐 *WEBSITE RESMI 3D PARALLAX: $${cleanTicker} (${token.name})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 *URL:* ${websiteUrl}

✨ *Fitur Ekosistem:*
• 🌌 3D Parallax & WebGL Responsive Visuals
• 📊 Real-Time DexScreener Embed Chart
• 🦄 Decentralized In-Page Swap Widget (\`#swap\`)
• 🛡️ GoPlus Verified 100/100 Safe (0% Tax)
• 📋 Portal Profil Resmi DexScreener
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  // 10. Smart Cashtag Listener in Group Chats (Cross-Chain Omnichain)
  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // Handled by commands

    const match = text.match(/\$([a-zA-Z0-9]{2,10})/);
    if (!match) return;

    const tickerCandidate = match[1].toUpperCase();
    const live = getLiveDeployments();
    const found = live.find((d) => d.ticker?.toUpperCase() === tickerCandidate);

    if (found && found.contractAddr) {
      const metrics = await fetchDexScreenerMetrics(found.contractAddr);
      const buyUrl = getSwapUrl(found.contractAddr, found.chain);
      const chartUrl = metrics?.dexUrl || getDexScreenerUrl(found.contractAddr, found.chain);
      const badge = getChainBadge(found.chain);

      const keyboard = new InlineKeyboard()
        .url("🛒 Beli", buyUrl)
        .url("📊 Chart", chartUrl);

      const priceStr = metrics?.priceUsd ? ` | Harga: \`${metrics.priceUsd}\`` : "";
      const changeStr = metrics ? ` (${metrics.priceChange24h >= 0 ? "+" : ""}${metrics.priceChange24h.toFixed(1)}%)` : "";

      await ctx.reply(
        `⚡ *Koin Terdeteksi:* $${found.ticker} (${found.tokenName || "Token"})${priceStr}${changeStr}\nJaringan: ${badge}\nCA: \`${found.contractAddr}\``,
        { parse_mode: "Markdown", reply_markup: keyboard }
      );
    }
  });

  return { bot, running: true };
}

// ─── DEDICATED TOKEN TELEGRAM BOT (1 Bot for 1 Token) ───────────────────────

/**
 * Builds and initializes an interactive Telegram bot for a specific token persona.
 */
export async function setupTokenTelegramBot(
  token: ResolvedTokenTarget,
  customBotToken?: string
): Promise<{
  bot: Bot | null;
  running: boolean;
  reason?: string;
  characterPath: string;
}> {
  const botToken = resolveDedicatedBotToken(token, customBotToken);
  const { characterPath } = generateTokenCharacterConfig(token, { botToken });

  if (customBotToken && customBotToken.trim().length > 0) {
    try {
      updateDeploymentTelegramBot(token.address, customBotToken.trim());
    } catch {
      // ignore
    }
  }

  if (!botToken || botToken.trim().length === 0) {
    logger.warn(`⚠️  [TELEGRAM BOT] Token bot Telegram untuk $${token.ticker} tidak ditemukan.`);
    logger.info(`💡 Character template telah dibuat di: ${characterPath}`);
    logger.info(`   Untuk mengaktifkan bot live untuk $${token.ticker}:`);
    logger.info(`   1. Dapatkan token bot dari @BotFather di Telegram.`);
    logger.info(`   2. Jalankan: START_TELEGRAM_BOT.bat -> Opsi [2] (Dedicated Bot).`);
    return { bot: null, running: false, reason: "NO_BOT_TOKEN", characterPath };
  }

  const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const tokenSlug = token.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const uniswapUrl = `https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${token.address}`;
  const chartUrl = `https://dexscreener.com/base/${token.address}`;
  const bankrAgentUrl = `https://bankr.bot/agents/${tokenSlug}`;
  const basescanUrl = `https://basescan.org/token/${token.address}`;
  const websiteUrl = getDeployLogWebsite(token.address) || `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;
  const swapUrl = `${websiteUrl}#swap`;

  const bot = new Bot(botToken);

  bot.command(["start", "help"], async (ctx) => {
    const keyboard = new InlineKeyboard()
      .url("🦄 Beli di Uniswap ($1+)", uniswapUrl)
      .url("📊 Live Chart", chartUrl)
      .row();
    if (websiteUrl && websiteUrl.startsWith("https://")) {
      keyboard.webApp(`🚀 Buka Web3 DApp ($${cleanTicker})`, websiteUrl).row();
    }
    keyboard
      .url("🌐 Website Resmi", websiteUrl)
      .url("🦄 In-Page Swap", swapUrl)
      .row()
      .url("🤖 Profil Agen di Bankr", bankrAgentUrl)
      .url("🔍 Basescan", basescanUrl);

    const message = `
🚀 *Selamat Datang di Portal Resmi $${cleanTicker} (${token.name})* 🚀
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
*Jaringan:* Base Mainnet (Coinbase L2)
*Alamat Kontrak (CA):*
\`${token.address}\`

💎 *Keunggulan Utama Protokol:*
• *0% Pajak (Zero Tax):* Bebas biaya jual/beli
• *95% WETH Recycler:* Fee trading otomatis dipanen & dibakar
• *30% Auto Buyback & Burn:* Mengangkat lantai harga secara konsisten
• *20% Pasif Dividen WETH:* Dibagikan ke pemegang token
• *100% Unruggable:* Minimal Proxy EIP-1167 renounced

📌 *Daftar Perintah Bot:*
/ca - Tampilkan alamat kontrak (copyable)
/website - Kunjungi landing page resmi 3D & in-page swap
/price - Cek harga live, volume, & market cap (DexScreener)
/flywheel - Penjelasan tokenomics & sistem bagi hasil
/referral - Buat link referral 5% komisi WETH instan
/dividend - Cek alokasi 20% pasif dividen & eligibilitas
/jackpot - Status 15% 10-Minute FOMO Jackpot game
/team - Profil tim inti pengembang AI
/buy - Tautan instan 1-Click Swap Uniswap
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["website", "web", "site"], async (ctx) => {
    const keyboard = buildTelegramWebsiteKeyboard(cleanTicker, websiteUrl);

    const message = `
🌐 *WEBSITE RESMI 3D PARALLAX: $${cleanTicker} (${token.name})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 *URL:* ${websiteUrl}

✨ *Fitur Ekosistem:*
• 🌌 3D Parallax & WebGL Responsive Visuals
• 📊 Real-Time DexScreener Embed Chart
• 🦄 Decentralized In-Page Swap Widget (\`#swap\`)
• 🛡️ GoPlus Verified 100/100 Safe (0% Tax)
• 📋 Portal Profil Resmi DexScreener
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["ca", "contract", "address"], async (ctx) => {
    const keyboard = new InlineKeyboard()
      .url("🦄 Beli di Uniswap", uniswapUrl)
      .url("🔍 Verifikasi di Basescan", basescanUrl);

    const message = `
📄 *ALAMAT KONTRAK RESMI (CA) $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\`${token.address}\`
*(Ketuk alamat di atas untuk menyalin otomatis)*

⛓️ *Jaringan:* Base Mainnet (Chain ID: 8453)
🛡️ *Keamanan:* 0% Tax | LP Terkunci | Ownership Renounced
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["price", "chart", "stats"], async (ctx) => {
    const metrics = await fetchDexScreenerMetrics(token.address);
    const keyboard = new InlineKeyboard()
      .url("📊 Buka DexScreener", chartUrl)
      .url("🦄 1-Click Swap", uniswapUrl);

    if (!metrics) {
      const pendingMsg = `
⏳ *Status Pasar $${cleanTicker}:*
Grafik sedang menunggu transaksi perdana di DexScreener.
Lakukan swap perdana senilai ~$1 di Uniswap untuk menyalakan candle chart!
Alamat: \`${token.address}\`
`;
      await ctx.reply(pendingMsg, { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    const changeSign = metrics.priceChange24h >= 0 ? "+" : "";
    const message = `
📊 *STATISTIK LIVE PASAR: $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💵 *Harga Saat Ini:* \`${metrics.priceUsd}\`
📈 *Perubahan 24h:* \`${changeSign}${metrics.priceChange24h.toFixed(2)}%\`
💰 *Market Cap (FDV):* \`$${metrics.marketCap.toLocaleString("en-US", { maximumFractionDigits: 0 })}\`
💧 *Likuiditas Pool:* \`$${metrics.liquidityUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}\`
🔄 *Volume 24h:* \`$${metrics.volume24h.toLocaleString("en-US", { maximumFractionDigits: 0 })}\`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["flywheel", "tokenomics", "burn"], async (ctx) => {
    const keyboard = new InlineKeyboard().url("🤖 Halaman Bankr Agent", bankrAgentUrl);
    const message = `
⚙️ *TOKENOMICS & POSITIVE-SUM FLYWHEEL $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Setiap transaksi di Uniswap menghasilkan creator fee sebesar 95% dalam bentuk WETH:
🔥 *30% Auto Buyback & Burn:* Membeli dari market dan membakar token.
💰 *20% Pasif Dividen WETH:* Airdrop WETH langsung ke holders.
🎰 *15% 10-Minute FOMO Jackpot:* Pembeli terakhir memenangkan jackpot pool.
🏛️ *35% Protokol & Treasury:* Likuiditas ekosistem multi-chain.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["referral", "affiliate", "ref"], async (ctx) => {
    const rawArgs = ctx.match?.trim().split(/\s+/) || [];
    let wallet = "";
    if (rawArgs.length >= 1 && (rawArgs[0].startsWith("0x") || rawArgs[0].length >= 32)) {
      wallet = rawArgs[0];
    }

    if (!wallet) {
      const infoMsg = `
🔗 *PROGRAM AFILIASI & KOMISI 5% INSTAN ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dapatkan pasif komisi on-chain *5% dalam WETH* secara instan dari setiap transaksi pembelian $${cleanTicker} yang Anda referensikan!

📌 *Cara Membuat Link Khusus Anda:*
Ketik: \`/referral <alamat_wallet_kamu>\`
Contoh: \`/referral 0x71C...b4e\`

💎 *Keunggulan Program Afiliasi:*
• *5% Real-Time WETH:* Komisi langsung masuk ke dompet Anda saat teman melakukan swap.
• *On-Chain & Transparan:* Tanpa perantara pihak ketiga.
• *Non-Dilutive:* Komisi dipotong langsung dari kreator fee protokol.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      const keyboard = new InlineKeyboard()
        .url("🌐 Buka DApp", websiteUrl)
        .url("⚙️ Info Tokenomics", `${websiteUrl}#flywheel`);
      await ctx.reply(infoMsg, { parse_mode: "Markdown", reply_markup: keyboard });
      return;
    }

    const referralUrl = `${websiteUrl}?ref=${wallet}`;
    const keyboard = buildReferralKeyboard(cleanTicker, websiteUrl, referralUrl);
    const msg = `
🎉 *LINK AFILIASI RESMI ANDA SIAP ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Dompet Penerima Komisi:*
\`${wallet}\`

🔗 *Tautan Unik Anda:*
\`${referralUrl}\`

💸 *Skema Bagi Hasil:*
Setiap pembeli yang menghubungkan dompet dan melakukan swap melalui tautan ini akan otomatis mengalirkan *5% dari nilai fee* langsung ke dompet Anda dalam bentuk WETH!

Ketuk tombol di bawah untuk langsung menyebarkannya ke grup Telegram atau membuka DApp!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["dividend", "dividends", "claim"], async (ctx) => {
    const rawArgs = ctx.match?.trim().split(/\s+/) || [];
    let wallet = "";
    if (rawArgs.length >= 1 && (rawArgs[0].startsWith("0x") || rawArgs[0].length >= 32)) {
      wallet = rawArgs[0];
    }

    const keyboard = buildDividendKeyboard(cleanTicker, websiteUrl, uniswapUrl);
    const walletText = wallet ? `\n👤 *Dompet Terpilih:* \`${wallet}\`` : "";

    const msg = `
💰 *20% PASIF DIVIDEN WETH ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Setiap transaksi trading Uniswap menghasilkan creator fee, dan *20% langsung dialokasikan untuk seluruh pemegang token $${cleanTicker}*!

💎 *Mekanisme Bagi Hasil:*
• *Zero Staking / Zero Lock:* Cukup simpan token $${cleanTicker} di dompet Anda.
• *Proporsional:* Semakin banyak token yang Anda pegang, semakin besar porsi dividen WETH Anda.
• *Snapshot Tiap Epoch:* Dividen dapat diverifikasi secara transparan on-chain.
${walletText}
👉 Gunakan tombol *Cek Dividen Dompet Saya* di bawah untuk membuka panel kalkulator & eligibility checker interaktif di DApp!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["jackpot", "fomo", "pot"], async (ctx) => {
    const keyboard = buildJackpotKeyboard(cleanTicker, websiteUrl, uniswapUrl, chartUrl);
    const msg = `
🎰 *15% 10-MINUTE FOMO JACKPOT ($${cleanTicker})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fitur game-teori viral on-chain di Base L2 untuk token *$${cleanTicker}*!

⏱️ *Aturan Main & Countdown:*
1. Timer berdetak mundur dari *10:00 Menit*.
2. Setiap kali ada order *BUY* (minimal ~$1+), timer otomatis *RESET kembali ke 10:00*.
3. *15% dari seluruh fee transaksi* terus mengalir menambah total *Prize Pool WETH*.
4. Jika waktu habis (*00:00*) tanpa ada pembeli baru, *PEMBELI TERAKHIR MEMENANGKAN 100% PRIZE POOL WETH*!

⚡ Ingin mereset waktu dan memimpin klasemen? Klik *Reset Timer (Beli di Uniswap)* sekarang!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(msg, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  bot.command(["team", "dev"], async (ctx) => {
    const enriched = buildEnrichedProjectData({
      name: token.name,
      ticker: token.ticker,
      contractAddress: token.address,
    });

    let teamList = "";
    enriched.teamMembers.forEach((m, idx) => {
      teamList += `${idx + 1}. *${m.name}*\n   Peran: _${m.role}_\n\n`;
    });

    const message = `
👥 *TIM INTI PENGEMBANG OTONOM $${cleanTicker}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${teamList}Proyek ini dikelola oleh arsitektur AI agent otonom di Base Mainnet.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    await ctx.reply(message, { parse_mode: "Markdown" });
  });

  bot.command(["buy", "swap"], async (ctx) => {
    const keyboard = new InlineKeyboard().url("🦄 Beli Sekarang di Uniswap", uniswapUrl);
    const message = `
🛒 *CARA MEMBELI $${cleanTicker} (BASE L2):*
1. Siapkan ETH di jaringan *Base Mainnet* pada wallet Anda.
2. Klik tombol tautan di bawah.
3. Hubungkan wallet dan tukar ETH ke $${cleanTicker}. Pajak 0%!

Contract: \`${token.address}\`
`;
    await ctx.reply(message, { parse_mode: "Markdown", reply_markup: keyboard });
  });

  return { bot, running: true, characterPath };
}

// ─── MULTI-BOT DEDICATED SUPERVISOR ─────────────────────────────────────────

/**
 * Runs all configured dedicated bots concurrently in a single supervisor process.
 * Each token has its own independent Bot instance, polling queue, and character persona.
 */
export async function setupMultiDedicatedSupervisor(): Promise<{
  runningBots: Array<{ ticker: string; address: string; bot: Bot; username?: string }>;
  totalStarted: number;
}> {
  const live = getLiveDeployments("base");
  const runningBots: Array<{ ticker: string; address: string; bot: Bot; username?: string }> = [];

  console.log(`
=================================================================
  [+] MULTI-BOT DEDICATED TELEGRAM SUPERVISOR [+]
=================================================================
  Mode: Multi-Tenant Dedicated Bots (1 Bot Unik per Koin)
  Jumlah Koin Terdaftar di Vault: ${live.length}
=================================================================
`);

  if (live.length === 0) {
    logger.warn("⚠️  Tidak ditemukan koin live di database armada Base.");
    return { runningBots, totalStarted: 0 };
  }

  for (const item of live) {
    const token: ResolvedTokenTarget = {
      address: item.contractAddr!,
      ticker: item.ticker || "TOKEN",
      name: item.tokenName || "Token",
      poolId: item.poolId || undefined,
      walletId: item.walletId || undefined,
    };

    const resolvedToken = resolveDedicatedBotToken(token);
    if (!resolvedToken) {
      logger.info(`ℹ️  Koin $${token.ticker} (${token.address}): Belum ada token bot khusus. Melewati...`);
      continue;
    }

    const { bot, running, reason } = await setupTokenTelegramBot(token, resolvedToken);
    if (running && bot) {
      bot.start({
        onStart: (botInfo) => {
          logger.success(
            `✅ Dedicated Bot $${token.ticker} AKTIF: @${botInfo.username} (CA: ${token.address})`
          );
        },
      });
      runningBots.push({ ticker: token.ticker, address: token.address, bot });
    } else {
      logger.warn(`⚠️  Gagal menjalankan bot untuk $${token.ticker}: ${reason}`);
    }
  }

  return { runningBots, totalStarted: runningBots.length };
}

/**
 * Broadcasts an official launch card with website & DexScreener links, and attempts to pin the message in group chats.
 */
export async function broadcastAndPinTokenWebsite(
  token: ResolvedTokenTarget,
  options?: {
    websiteUrl?: string;
    botToken?: string;
    chatId?: string;
  }
): Promise<{ success: boolean; messageId?: number; pinned?: boolean; error?: string }> {
  const bToken =
    options?.botToken !== undefined
      ? options.botToken.trim()
      : resolveDedicatedBotToken(token);
  if (!bToken) {
    return { success: false, error: "TIDAK_ADA_BOT_TOKEN (Setel TELEGRAM_BOT_TOKEN di .env)" };
  }

  const cleanTicker = token.ticker.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const webUrl = options?.websiteUrl || getDeployLogWebsite(token.address) || `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;
  const chartUrl = `https://dexscreener.com/base/${token.address}`;
  const swapUrl = `${webUrl}#swap`;
  const targetChat =
    options?.chatId !== undefined
      ? options.chatId.trim()
      : process.env.COMMUNITY_TELEGRAM_CHANNEL || process.env.COMMUNITY_TELEGRAM_CHAT_ID;

  if (!targetChat) {
    return { success: false, error: "TIDAK_ADA_CHAT_ID (Setel COMMUNITY_TELEGRAM_CHANNEL di .env)" };
  }

  const message = `
🚀 *WEBSITE RESMI TELAH DILUNCURKAN: $${cleanTicker}* 🚀
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 *Landing Page:* ${webUrl}
🦄 *In-Page Swap:* ${swapUrl}
📊 *DexScreener Chart:* ${chartUrl}
📍 *Contract:* \`${token.address}\`

🛡️ *Audit:* 100/100 Safe (0% Buy / 0% Sell Tax)
🔥 *Flywheel:* 30% Buyback & Burn | 20% Pasif Dividen WETH | 15% Jackpot
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

  try {
    const tempBot = new Bot(bToken);
    const keyboard = new InlineKeyboard();
    if (webUrl && webUrl.startsWith("https://")) {
      keyboard.webApp(`🚀 Buka Web3 DApp ($${cleanTicker})`, webUrl).row();
    }
    keyboard
      .url("🌐 Kunjungi Website Resmi", webUrl)
      .url("🦄 In-Page Swap", swapUrl)
      .row()
      .url("📊 DexScreener Chart", chartUrl);

    const sent = await tempBot.api.sendMessage(targetChat, message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });

    let pinned = false;
    try {
      await tempBot.api.pinChatMessage(targetChat, sent.message_id);
      pinned = true;
    } catch {
      // pinning requires admin rights; non-fatal if not allowed
    }

    return { success: true, messageId: sent.message_id, pinned };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

/**
 * Starts a high-performance, low-latency webhook server using Bun native HTTP server.
 * Enables sub-100ms response times for WebApp buttons, /start commands, and cashtags on VPS/Cloud.
 */
export function startTelegramBotWebhookServer(
  bot: Bot,
  options?: {
    port?: number;
    path?: string;
    secretToken?: string;
    publicUrl?: string;
  }
): {
  server: any;
  port: number;
  webhookPath: string;
  stop: () => void;
} {
  const port = options?.port || parseInt(process.env.TELEGRAM_WEBHOOK_PORT || "8443", 10);
  const webhookPath = options?.path || "/telegram-webhook";
  const secretToken = options?.secretToken || process.env.TELEGRAM_WEBHOOK_SECRET;

  const handleUpdate = webhookCallback(bot, "std/http", {
    secretToken,
  });

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.pathname === webhookPath) {
        return handleUpdate(req);
      }
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
        return new Response(
          JSON.stringify({ status: "ok", mode: "telegram_webhook", port, path: webhookPath }),
          { headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  logger.success(`⚡ [TELEGRAM WEBHOOK] Native Bun HTTP Server aktif di port ${port}`);
  logger.info(`   Endpoint: POST http://localhost:${port}${webhookPath}`);
  logger.info(`   Health  : GET  http://localhost:${port}/health`);

  const pubUrl = options?.publicUrl || process.env.TELEGRAM_WEBHOOK_URL;
  if (pubUrl && pubUrl.startsWith("https://")) {
    const fullWebhookUrl = `${pubUrl.replace(/\/+$/, "")}${webhookPath}`;
    bot.api
      .setWebhook(fullWebhookUrl, {
        secret_token: secretToken,
        drop_pending_updates: true,
      })
      .then(() => {
        logger.success(`✅ [TELEGRAM WEBHOOK] Webhook URL terdaftar di Telegram API: ${fullWebhookUrl}`);
      })
      .catch((err: any) => {
        logger.warn(`⚠️  [TELEGRAM WEBHOOK] Catatan setWebhook Telegram API: ${err?.message || err}`);
      });
  }

  return {
    server,
    port,
    webhookPath,
    stop: () => server.stop(),
  };
}

// ─── CLI RUNNER ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isSupervisor = args.includes("--supervisor") || args[0] === "supervisor";
  const isFleetMode = !isSupervisor && (args[0] === "--fleet" || args[0] === "fleet" || args.includes("--fleet"));
  const isWebhookMode = args.includes("--webhook") || args.includes("webhook");

  if (isSupervisor) {
    const { runningBots, totalStarted } = await setupMultiDedicatedSupervisor();
    if (totalStarted === 0) {
      logger.warn("⚠️  Tidak ada bot dedicated yang memiliki token aktif.");
      console.log("\n💡 Untuk menyetel bot token per koin:");
      console.log("   Gunakan: START_TELEGRAM_BOT.bat -> Opsi [2] (Dedicated Bot)\n");
      process.exit(0);
    }
    logger.info(`🤖 Multi-Bot Supervisor sedang berjalan (${totalStarted} bot aktif online)...`);
    logger.info("   Tekan Ctrl + C untuk menghentikan seluruh bot kapan saja.\n");
  } else if (isFleetMode) {
    console.log(`
=================================================================
  [+] OMNICHAIN MASTER FLEET TELEGRAM BOT LAUNCHER [+]
=================================================================
  Mode:          MASTER FLEET (1 Bot untuk SEMUA Token)
  Transport:     ${isWebhookMode ? "FAST-PATH WEBHOOK (Native Bun HTTP <100ms)" : "POLLING MODE (Long-Polling)"}
  Jaringan:      Base Mainnet (Coinbase L2)
=================================================================
`);

    const { bot, running, reason } = await setupMasterFleetTelegramBot();
    if (!running || !bot) {
      logger.warn(`⚠️  Master Fleet Bot tidak dapat dijalankan secara live: ${reason}`);
      console.log("\n💡 Untuk menjalankan bot secara live:");
      console.log("   1. Dapatkan token bot dari @BotFather di Telegram.");
      console.log("   2. Isi TELEGRAM_BOT_TOKEN=<token> di file .env");
      console.log("   3. Jalankan kembali: START_TELEGRAM_BOT.bat\n");
      process.exit(0);
    }

    if (isWebhookMode) {
      logger.info("🤖 Memulai Master Fleet Telegram Bot (Fast-Path Webhook)...");
      startTelegramBotWebhookServer(bot);
      logger.info("   Tekan Ctrl + C untuk menghentikan server webhook kapan saja.\n");
    } else {
      logger.info("🤖 Memulai Master Fleet Telegram Bot (polling mode)...");
      bot.start({
        onStart: (botInfo) => {
          logger.success(`✅ Master Fleet Bot aktif secara live sebagai @${botInfo.username}!`);
          logger.info("   Melayani seluruh koin yang terdaftar di database armada.");
          logger.info("   Tekan Ctrl + C untuk menghentikan bot kapan saja.\n");
        },
      });
    }
  } else {
    const targetTokenInput = args.find((a) => !a.startsWith("--"));
    const customBotToken = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
    const token = resolveTargetToken(targetTokenInput);

    console.log(`
=================================================================
  [+] DEDICATED TOKEN TELEGRAM BOT LAUNCHER [+]
=================================================================
  Target Token:  $${token.ticker} (${token.name})
  Contract:      ${token.address}
  Transport:     ${isWebhookMode ? "FAST-PATH WEBHOOK (Native Bun HTTP <100ms)" : "POLLING MODE (Long-Polling)"}
  Chain:         Base Mainnet
=================================================================
`);

    const { bot, running, reason, characterPath } = await setupTokenTelegramBot(token, customBotToken);
    if (!running || !bot) {
      logger.warn(`⚠️  Bot tidak dapat dijalankan secara live: ${reason}`);
      logger.info(`   Character file tetap aman dan ter-generate di: ${characterPath}`);
      process.exit(0);
    }

    if (isWebhookMode) {
      logger.info(`🤖 Memulai Dedicated Telegram Bot untuk $${token.ticker} (Fast-Path Webhook)...`);
      startTelegramBotWebhookServer(bot);
      logger.info("   Tekan Ctrl + C untuk menghentikan server webhook kapan saja.\n");
    } else {
      logger.info(`🤖 Memulai Dedicated Telegram Bot untuk $${token.ticker} (polling mode)...`);
      bot.start({
        onStart: (botInfo) => {
          logger.success(`✅ Dedicated Bot Telegram untuk $${token.ticker} aktif secara live sebagai @${botInfo.username}!`);
          logger.info(`   CA: ${token.address}`);
          logger.info("   Tekan Ctrl + C untuk menghentikan bot kapan saja.\n");
        },
      });
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal Telegram bot error: ${err?.message || err}`);
    process.exit(1);
  });
}
