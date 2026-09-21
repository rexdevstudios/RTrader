/**
 * twitter-shiller.ts — Auto-tweet setelah token berhasil di-deploy.
 *
 * Menggunakan Twitter API v2 (OAuth 1.0a User Context) untuk posting tweet
 * berisi nama token, contract address, chain, dan link sosmed.
 *
 * Semua env var Twitter bersifat OPSIONAL. Jika tidak diisi,
 * fungsi ini gracefully skip tanpa error.
 *
 * Rate limit Twitter gratis: 1 tweet per 15 menit.
 * Bot ini sudah memiliki cooldown internal untuk menghindari ban.
 */
import axios from "axios";
import crypto from "crypto";
import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import type { TokenIdentity } from "../ai/gemini-brain.ts";

// Cooldown: Simpan timestamp tweet terakhir di memory (bukan DB)
let _lastTweetAt = 0;
const TWEET_COOLDOWN_MS = 16 * 60 * 1000; // 16 menit (lebih dari batas 15 menit Twitter)

/**
 * Buat OAuth 1.0a header untuk Twitter API v2.
 */
function buildOAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  cfg: ReturnType<typeof getConfig>
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: cfg.TWITTER_API_KEY!,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: cfg.TWITTER_ACCESS_TOKEN!,
    oauth_version: "1.0",
  };

  // Gabungkan semua parameter untuk signature
  const allParams = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k]!)}`)
    .join("&");

  const sigBase = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString),
  ].join("&");

  const sigKey = [
    encodeURIComponent(cfg.TWITTER_API_SECRET!),
    encodeURIComponent(cfg.TWITTER_ACCESS_SECRET!),
  ].join("&");

  const signature = crypto
    .createHmac("sha1", sigKey)
    .update(sigBase)
    .digest("base64");

  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k]!)}"`);

  return `OAuth ${headerParts.join(", ")}`;
}

/**
 * Post tweet tentang token baru yang baru di-deploy.
 */
export async function shillOnTwitter(
  identity: TokenIdentity,
  contractAddress: string,
  chain: string
): Promise<boolean> {
  const cfg = getConfig();

  // Skip jika kredensial Twitter tidak lengkap
  if (
    !cfg.TWITTER_API_KEY ||
    !cfg.TWITTER_API_SECRET ||
    !cfg.TWITTER_ACCESS_TOKEN ||
    !cfg.TWITTER_ACCESS_SECRET
  ) {
    logger.warn("⚠️  Twitter credentials tidak lengkap — shilling dilewati.");
    return false;
  }

  // Enforced cooldown
  const now = Date.now();
  if (now - _lastTweetAt < TWEET_COOLDOWN_MS) {
    const waitSec = Math.ceil((TWEET_COOLDOWN_MS - (now - _lastTweetAt)) / 1000);
    logger.warn(`⚠️  Twitter cooldown aktif — tunggu ${waitSec} detik lagi.`);
    return false;
  }

  const chainLabel = chain === "solana" ? "Solana" : chain === "base" ? "Base" : chain.toUpperCase();
  const tweetText = [
    `🚀 Just launched: ${identity.name} ($${identity.ticker})`,
    ``,
    `${identity.description.slice(0, 120)}`,
    ``,
    `⛓️ Chain: ${chainLabel}`,
    `📋 CA: ${contractAddress}`,
    ``,
    `🌐 ${identity.website}`,
    `💬 ${identity.telegram}`,
    ``,
    `#${identity.ticker} #MemeCoin #${chainLabel} #Crypto`,
  ].join("\n");

  const TWEET_URL = "https://api.twitter.com/2/tweets";

  try {
    const oauthHeader = buildOAuthHeader("POST", TWEET_URL, {}, cfg);

    await axios.post(
      TWEET_URL,
      { text: tweetText },
      {
        headers: {
          Authorization: oauthHeader,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    _lastTweetAt = Date.now();
    logger.success(`🐦 [TWITTER] Tweet berhasil diposting untuk $${identity.ticker}!`);
    return true;
  } catch (err) {
    const msg = axios.isAxiosError(err)
      ? `${err.response?.status}: ${JSON.stringify(err.response?.data)}`
      : String(err);
    logger.warn(`⚠️  Twitter shilling gagal (diabaikan): ${msg}`);
    return false;
  }
}
