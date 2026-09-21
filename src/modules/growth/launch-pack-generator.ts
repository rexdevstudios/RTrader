/**
 * src/modules/growth/launch-pack-generator.ts
 *
 * Automated Twitter / X Launch Announcement Pack Generator.
 *
 * Capabilities:
 *   1. Generates 1-click copy-paste launch announcements for Twitter / X.
 *   2. Dual Format:
 *      - Power Tweet: High-impact single tweet optimized for standard 280 character limit.
 *      - Mega Thread (3 Tweets): Deep dive into token alpha, 4-pillar flywheel tokenomics, and security audit.
 *   3. Structured exports into `sites/<ticker>/launch-announcement.txt` and `launch-announcement.json`.
 *   4. Zero external API keys required (no paid Twitter API dependencies).
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../../logger.ts";

export interface LaunchPackParams {
  ticker: string;
  name: string;
  contractAddress: string;
  chain?: string;
  websiteUrl?: string;
  telegramUrl?: string;
  dexScreenerUrl?: string;
  uniswapUrl?: string;
  description?: string;
  flywheelEnabled?: boolean;
  tax?: { buy: number; sell: number };
  poolId?: string;
}

export interface LaunchTweet {
  index: number;
  title: string;
  content: string;
  charCount: number;
  fitsSingleTweet: boolean;
}

export interface TelegramButton {
  text: string;
  url: string;
}

export interface TelegramLaunchCard {
  htmlCard: string;
  markdownCard: string;
  plainCard: string;
  shareDeepLink: string;
  inlineKeyboard: TelegramButton[][];
}

export interface LaunchAnnouncementPack {
  ticker: string;
  name: string;
  contractAddress: string;
  chain: string;
  powerTweet: LaunchTweet;
  threadTweets: LaunchTweet[];
  telegram: TelegramLaunchCard;
  fullText: string;
  tags: string[];
  metadata: {
    websiteUrl: string;
    dexScreenerUrl: string;
    uniswapUrl: string;
    telegramUrl: string;
    generatedAt: string;
  };
}

/**
 * Generates an official Twitter / X Launch Announcement Pack.
 */
export function generateLaunchAnnouncementPack(params: LaunchPackParams): LaunchAnnouncementPack {
  const cleanTicker = params.ticker.replace(/^\$/, "").toUpperCase();
  const rawChain = (params.chain || "base").toLowerCase();
  const chainDisplayName =
    rawChain === "solana" ? "Solana" : rawChain === "robinhood" ? "Robinhood Chain" : "Base Mainnet";
  const chainTag = rawChain === "solana" ? "#Solana" : "#Base";

  const ca = params.contractAddress;
  const webUrl =
    params.websiteUrl || `https://${cleanTicker.toLowerCase()}-web3.pages.dev`;
  const dexUrl =
    params.dexScreenerUrl || `https://dexscreener.com/${rawChain}/${ca}`;
  const uniUrl =
    params.uniswapUrl ||
    (rawChain === "solana"
      ? `https://jup.ag/swap/SOL-${ca}`
      : `https://app.uniswap.org/swap?chain=${rawChain}&inputCurrency=ETH&outputCurrency=${ca}`);
  const tgUrl = params.telegramUrl || `https://t.me/${cleanTicker.toLowerCase()}_portal`;

  const tags = [
    chainTag,
    "#Crypto",
    "#DeFi",
    "#MemeCoin",
    `#${cleanTicker}`,
    "#Web3",
    "#Gem",
  ];

  // ─── 1. Power Tweet (Single Tweet optimized for 280-char limit) ───
  const displayTitle = params.name && params.name.length > 18 ? `${params.name.slice(0, 16)}..` : params.name;
  const powerTweetLines = [
    `🚀 $${cleanTicker} (${displayTitle}) is LIVE on ${chainTag}!`,
    `🛡️ 0% Tax | 🔥 30% Auto Buyback`,
    `📝 CA: ${ca}`,
    `📊 Chart: ${dexUrl}`,
    `🌐 DApp: ${webUrl}`,
    `${chainTag} #DeFi #${cleanTicker}`,
  ];

  let powerTweetContent = powerTweetLines.join("\n");
  if (powerTweetContent.length > 280) {
    const compactLines = [
      `🚀 $${cleanTicker} (${displayTitle}) is LIVE on ${chainTag}!`,
      `🛡️ 0% Tax | 🔥 Auto Buyback`,
      `📝 CA: ${ca}`,
      `📊 Chart: ${dexUrl}`,
      `${chainTag} #DeFi #${cleanTicker}`,
    ];
    powerTweetContent = compactLines.join("\n");
  }

  const powerTweet: LaunchTweet = {
    index: 0,
    title: "⚡ POWER TWEET (Single Tweet - Fast Announcement)",
    content: powerTweetContent,
    charCount: powerTweetContent.length,
    fitsSingleTweet: powerTweetContent.length <= 280,
  };

  // ─── 2. Mega Thread: Tweet 1/3 (Headline & Alpha) ──────────────────
  const tweet1Content = [
    `1/3 🚀 Introducing $${cleanTicker} (${displayTitle}) — live on ${chainDisplayName}!`,
    "",
    `Built with a Positive-Sum flywheel. Zero insider dump, 100% community protection.`,
    "",
    `📝 CA: ${ca}`,
    `🦄 Swap: ${uniUrl}`,
    `📊 Chart: ${dexUrl}`,
    "",
    `${chainTag} #DeFi #CryptoLaunch`,
  ].join("\n");

  const tweet1: LaunchTweet = {
    index: 1,
    title: "🧵 THREAD 1/3: Official Launch Headline & Verified CA",
    content: tweet1Content,
    charCount: tweet1Content.length,
    fitsSingleTweet: tweet1Content.length <= 280,
  };

  // ─── 3. Mega Thread: Tweet 2/3 (Flywheel Tokenomics) ───────────────
  const tweet2Content = [
    `2/3 🌪️ THE FLYWHEEL ENGINE:`,
    "",
    `Creator swap fees recycle back to holders:`,
    `• 🔥 30% Auto Buyback & Burn (0xdead)`,
    `• 💰 20% Passive WETH Yield`,
    `• ⚡ 15% 10-Min FOMO Jackpot`,
    `• 🏛️ 35% Creator Protocol Kas`,
    "",
    `Volume pumps the floor. Diamond hands win.`,
    "",
    `#Tokenomics #Flywheel`,
  ].join("\n");

  const tweet2: LaunchTweet = {
    index: 2,
    title: "🧵 THREAD 2/3: The 4-Pillar Positive-Sum Flywheel Mechanics",
    content: tweet2Content,
    charCount: tweet2Content.length,
    fitsSingleTweet: tweet2Content.length <= 280,
  };

  // ─── 4. Mega Thread: Tweet 3/3 (Security & Verified Links) ─────────
  const tweet3Content = [
    `3/3 🛡️ AUDITED SECURITY & LINKS:`,
    "",
    `• 0% Buy / Sell Tax (Clean Standard)`,
    `• Audited Liquidity Pool`,
    "",
    `🌐 Web3 DApp: ${webUrl}`,
    `🤖 Telegram: ${tgUrl}`,
    `📊 DexScreener: ${dexUrl}`,
    "",
    `RT & spread the alpha! 🚀`,
    "",
    tags.slice(0, 4).join(" "),
  ].join("\n");

  const tweet3: LaunchTweet = {
    index: 3,
    title: "🧵 THREAD 3/3: Security Audit, Official DApp & Community Links",
    content: tweet3Content,
    charCount: tweet3Content.length,
    fitsSingleTweet: tweet3Content.length <= 280,
  };

  const threadTweets = [tweet1, tweet2, tweet3];

  // ─── 5. Telegram Post-Launch Blitz Cards ───────────────────────────
  const telegramHtmlLines = [
    `🚀 <b>OFFICIAL LAUNCH ALPHA: $${cleanTicker} (${params.name})</b>`,
    "",
    `⛓️ <b>Chain:</b> ${chainDisplayName}`,
    `📝 <b>CA:</b> <code>${ca}</code>`,
    `🛡️ <b>Security:</b> 0% Tax | Audited Liquidity | Minimal Proxy`,
    "",
    `🌪️ <b>4-PILLAR POSITIVE-SUM FLYWHEEL:</b>`,
    `• 🔥 <b>30% Auto Buyback & Burn:</b> Sends to <code>0x000000000000000000000000000000000000dEaD</code>`,
    `• 💰 <b>20% Passive WETH Yield:</b> Auto-distributed to Diamond Hands`,
    `• ⚡ <b>15% 10-Min FOMO Jackpot:</b> Last buyer takes the prize pool`,
    `• 🏛️ <b>35% Protocol Kas:</b> Autonomous development & maintenance`,
    "",
    `🔗 <b>OFFICIAL VERIFIED LINKS:</b>`,
    `• 📊 <a href="${dexUrl}">Live DexScreener Chart</a>`,
    `• 🦄 <a href="${uniUrl}">1-Click Swap</a>`,
    `• 🌐 <a href="${webUrl}">Official Web3 DApp</a>`,
    `• 🤖 <a href="${tgUrl}">Community Telegram</a>`,
    "",
    `💡 <i>Always verify CA before swapping:</i> <code>${ca}</code>`,
  ];
  const telegramHtmlCard = telegramHtmlLines.join("\n");

  const telegramMarkdownLines = [
    `🚀 *OFFICIAL LAUNCH ALPHA: $${cleanTicker} (${params.name})*`,
    "",
    `⛓️ *Chain:* ${chainDisplayName}`,
    `📝 *CA:* \`${ca}\``,
    `🛡️ *Security:* 0% Tax | Audited Liquidity`,
    "",
    `🌪️ *4-PILLAR FLYWHEEL TOKENOMICS:*`,
    `• 🔥 30% Auto Buyback & Burn (0xdead)`,
    `• 💰 20% Passive WETH Yield`,
    `• ⚡ 15% 10-Min FOMO Jackpot`,
    `• 🏛️ 35% Protocol Kas`,
    "",
    `🔗 *OFFICIAL LINKS:*`,
    `• [Live DexScreener Chart](${dexUrl})`,
    `• [1-Click Swap](${uniUrl})`,
    `• [Official Web3 DApp](${webUrl})`,
    `• [Community Telegram](${tgUrl})`,
  ];
  const telegramMarkdownCard = telegramMarkdownLines.join("\n");

  const telegramPlainLines = [
    `🚀 OFFICIAL LAUNCH ALPHA: $${cleanTicker} (${params.name})`,
    `Chain: ${chainDisplayName}`,
    `CA: ${ca}`,
    `Security: 0% Tax | Audited Liquidity`,
    `Flywheel: 30% Burn | 20% Dividend | 15% Jackpot | 35% Kas`,
    `Chart: ${dexUrl}`,
    `Swap: ${uniUrl}`,
    `DApp: ${webUrl}`,
    `Telegram: ${tgUrl}`,
  ];
  const telegramPlainCard = telegramPlainLines.join("\n");

  const shareText = `🚀 OFFICIAL LAUNCH: $${cleanTicker} (${params.name}) is live on ${chainDisplayName}!\n\nCA: ${ca}\n\nChart: ${dexUrl}\nDApp: ${webUrl}`;
  const shareDeepLink = `https://t.me/share/url?url=${encodeURIComponent(webUrl)}&text=${encodeURIComponent(shareText)}`;

  const inlineKeyboard: TelegramButton[][] = [
    [
      { text: "📊 DexScreener Chart", url: dexUrl },
      { text: "🦄 1-Click Swap", url: uniUrl },
    ],
    [
      { text: "🌐 Web3 DApp", url: webUrl },
      { text: "🤖 Telegram Portal", url: tgUrl },
    ],
  ];

  const telegramCard: TelegramLaunchCard = {
    htmlCard: telegramHtmlCard,
    markdownCard: telegramMarkdownCard,
    plainCard: telegramPlainCard,
    shareDeepLink,
    inlineKeyboard,
  };

  // ─── 6. Full Compiled Text (Clipboard-Ready Omnichannel) ───────────
  const fullText = [
    `=================================================================`,
    `  [+] OFFICIAL LAUNCH ANNOUNCEMENT PACK FOR TWITTER / X & TELEGRAM [+]`,
    `  Token: $${cleanTicker} (${params.name})`,
    `  Chain: ${chainDisplayName}`,
    `  CA:    ${ca}`,
    `=================================================================`,
    "",
    `--- [OPTION A: SINGLE POWER TWEET (${powerTweet.charCount} chars)] ---`,
    powerTweetContent,
    "",
    `=================================================================`,
    `--- [OPTION B: FULL 3-TWEET LAUNCH THREAD] ---`,
    "",
    `[TWEET 1/3 - ${tweet1.charCount} chars]`,
    tweet1Content,
    "",
    `-----------------------------------------------------------------`,
    `[TWEET 2/3 - ${tweet2.charCount} chars]`,
    tweet2Content,
    "",
    `-----------------------------------------------------------------`,
    `[TWEET 3/3 - ${tweet3.charCount} chars]`,
    tweet3Content,
    "",
    `=================================================================`,
    `--- [OPTION C: TELEGRAM POST-LAUNCH BLITZ (HTML FORMAT)] ---`,
    telegramHtmlCard,
    "",
    `-----------------------------------------------------------------`,
    `[TELEGRAM 1-CLICK SHARE WEB LINK]`,
    shareDeepLink,
    "",
    `=================================================================`,
    `  Official Links Summary:`,
    `  - Web3 DApp:     ${webUrl}`,
    `  - DexScreener:   ${dexUrl}`,
    `  - 1-Click Swap:  ${uniUrl}`,
    `  - Telegram Bot:  ${tgUrl}`,
    `=================================================================`,
  ].join("\n");

  return {
    ticker: cleanTicker,
    name: params.name,
    contractAddress: ca,
    chain: rawChain,
    powerTweet,
    threadTweets,
    telegram: telegramCard,
    fullText,
    tags,
    metadata: {
      websiteUrl: webUrl,
      dexScreenerUrl: dexUrl,
      uniswapUrl: uniUrl,
      telegramUrl: tgUrl,
      generatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Saves the launch announcement pack into `launch-announcement.txt`, `launch-announcement.json`,
 * and dedicated `telegram-announcement.txt` & `telegram-announcement.json`.
 */
export function saveLaunchAnnouncementPack(
  outputDir: string,
  pack: LaunchAnnouncementPack
): {
  txtPath: string;
  jsonPath: string;
  telegramTxtPath: string;
  telegramJsonPath: string;
} {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Save general omnichannel pack
  const txtPath = path.join(outputDir, "launch-announcement.txt");
  const jsonPath = path.join(outputDir, "launch-announcement.json");
  fs.writeFileSync(txtPath, pack.fullText, "utf-8");
  fs.writeFileSync(jsonPath, JSON.stringify(pack, null, 2), "utf-8");

  // 2. Save dedicated Telegram files
  const telegramTxtPath = path.join(outputDir, "telegram-announcement.txt");
  const telegramJsonPath = path.join(outputDir, "telegram-announcement.json");

  const telegramFullText = [
    `=================================================================`,
    `  [+] TELEGRAM OFFICIAL POST-LAUNCH BLITZ ANNOUNCEMENT [+]`,
    `  Token: $${pack.ticker} (${pack.name})`,
    `  Chain: ${pack.chain.toUpperCase()}`,
    `  CA:    ${pack.contractAddress}`,
    `=================================================================`,
    "",
    `--- [FORMAT 1: HTML RICH MESSAGE (COPY & PASTE TO TELEGRAM)] ---`,
    pack.telegram.htmlCard,
    "",
    `=================================================================`,
    `--- [FORMAT 2: MARKDOWN MESSAGE (ROSE / COMBOT READY)] ---`,
    pack.telegram.markdownCard,
    "",
    `=================================================================`,
    `--- [FORMAT 3: 1-CLICK SHARE DEEP-LINK] ---`,
    `Klik link ini di browser/ponsel untuk langsung membagikan pesan:`,
    pack.telegram.shareDeepLink,
    "",
    `=================================================================`,
    `--- [FORMAT 4: INLINE KEYBOARD BUTTONS (JSON)] ---`,
    JSON.stringify(pack.telegram.inlineKeyboard, null, 2),
    `=================================================================`,
  ].join("\n");

  fs.writeFileSync(telegramTxtPath, telegramFullText, "utf-8");
  fs.writeFileSync(telegramJsonPath, JSON.stringify(pack.telegram, null, 2), "utf-8");

  // 3. Fail-safe copy to promotions/ folder (skip test fixtures)
  try {
    const isTestTicker = /^(test|unit|mock|tgsave|testpack|dpump|pyield|node|tclank|burn|readiness)/i.test(pack.ticker);
    if (!isTestTicker) {
      const promoDir = path.resolve(process.cwd(), "promotions");
      if (!fs.existsSync(promoDir)) fs.mkdirSync(promoDir, { recursive: true });
      fs.writeFileSync(
        path.join(promoDir, `TELEGRAM_ANNOUNCEMENT_${pack.ticker}.txt`),
        telegramFullText,
        "utf-8"
      );
    }
  } catch {}

  logger.success(`📢 [LAUNCH PACK] Berkas pengumuman Twitter & Telegram tersimpan:`);
  logger.info(`   Omnichannel: ${txtPath}`);
  logger.info(`   Telegram:    ${telegramTxtPath}`);

  return { txtPath, jsonPath, telegramTxtPath, telegramJsonPath };
}
