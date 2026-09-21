/**
 * gemini-brain.ts — Otak AI menggunakan Google Gemini.
 *
 * Tugasnya: menerima data tren mentah, lalu menghasilkan
 * identitas token (Nama, Ticker, Deskripsi, Social Links)
 * dalam format JSON yang sudah tervalidasi Zod.
 *
 * Jika AI gagal atau outputnya tidak valid, akan coba ulang
 * hingga MAX_RETRIES kali sebelum menyerah.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";
import { z } from "zod";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";

const MAX_RETRIES = 3;

// Schema validasi output AI — WAJIB sesuai format ini
export const TokenIdentitySchema = z.object({
  name: z
    .string()
    .min(2)
    .max(30)
    .regex(/^[a-zA-Z0-9 ]+$/, "Nama hanya boleh huruf, angka, dan spasi"),
  ticker: z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z0-9]+$/, "Ticker hanya boleh huruf kapital dan angka"),
  description: z.string().min(10).max(280),
  viralScore: z.number().int().min(1).max(100),
  imagePrompt: z.string().min(10).max(500),
  website: z.string().url(),
  twitter: z.string().url(),
  telegram: z.string().url(),
});

export type TokenIdentity = z.infer<typeof TokenIdentitySchema>;

export function sanitizeIdentityRaw(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const sanitized = { ...obj };
  if (typeof sanitized.name === "string") sanitized.name = sanitized.name.trim().slice(0, 30);
  if (typeof sanitized.ticker === "string") sanitized.ticker = sanitized.ticker.trim().toUpperCase().slice(0, 10);
  if (typeof sanitized.description === "string") sanitized.description = sanitized.description.trim().slice(0, 280);
  if (typeof sanitized.imagePrompt === "string") sanitized.imagePrompt = sanitized.imagePrompt.trim().slice(0, 500);
  return sanitized;
}

export function applyIdentityOverrides(identity: TokenIdentity): TokenIdentity {
  const cfg = getConfig();
  const overridden = { ...identity };

  // Helper slug generator from token ticker/name
  const tokenSlug = (identity.name || "token")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const cleanTicker = (identity.ticker || "TOKEN").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

  // Dynamic Anonymous Website: prioritizes template or canonical Bankr agent URL
  if (cfg.DEFAULT_PROJECT_WEBSITE && cfg.DEFAULT_PROJECT_WEBSITE.trim().length > 0) {
    overridden.website = cfg.DEFAULT_PROJECT_WEBSITE.trim()
      .replace(/\{ticker\}/gi, cleanTicker)
      .replace(/\{slug\}/gi, tokenSlug);
  } else if (!overridden.website || overridden.website.includes("xyz") || overridden.website.includes("test")) {
    overridden.website = `https://bankr.bot/agents/${tokenSlug}`;
  }

  // Dynamic Anonymous Twitter Handle: strictly anonymous, never leaks operator personal handle
  if (cfg.DEFAULT_TWITTER_HANDLE && cfg.DEFAULT_TWITTER_HANDLE.trim().length > 0) {
    const template = cfg.DEFAULT_TWITTER_HANDLE.trim().replace(/^@/, "");
    const resolvedHandle = template
      .replace(/\{ticker\}/gi, cleanTicker)
      .replace(/\{slug\}/gi, tokenSlug.replace(/-/g, "_"));
    overridden.twitter = `https://x.com/${resolvedHandle.slice(0, 15)}`;
  } else if (!overridden.twitter || overridden.twitter.includes("random") || overridden.twitter.includes("test")) {
    const anonHandle = `${cleanTicker}_coin`.slice(0, 15);
    overridden.twitter = `https://x.com/${anonHandle}`;
  }

  // Strict Operator Privacy Shield: never allow operator personal keywords or placeholders
  const isPersonalOrPlaceholder = (url: string) => /abdul|rochim|personal|myaccount/i.test(url);
  if (isPersonalOrPlaceholder(overridden.twitter)) {
    const anonHandle = `${cleanTicker}_coin`.slice(0, 15);
    overridden.twitter = `https://x.com/${anonHandle}`;
  }

  // Dynamic Anonymous Telegram
  if (cfg.DEFAULT_TELEGRAM_LINK && cfg.DEFAULT_TELEGRAM_LINK.trim().length > 0) {
    overridden.telegram = cfg.DEFAULT_TELEGRAM_LINK.trim()
      .replace(/\{ticker\}/gi, cleanTicker)
      .replace(/\{slug\}/gi, tokenSlug);
  } else if (!overridden.telegram || overridden.telegram.includes("random") || overridden.telegram.includes("test")) {
    overridden.telegram = `https://t.me/${cleanTicker}_portal`;
  }

  return overridden;
}

export const SYSTEM_PROMPT = `You are an elite, highly experienced crypto trend analyst and viral meme coin creator.
Your job is to analyze live market trend data, identify the most viral degen narratives, and formulate a high-potential meme token identity.

CRITICAL RULES (ALL FIELDS MUST BE IN ENGLISH):
- All fields (name, ticker, description, imagePrompt) MUST be in English for maximum global viral appeal.
- Ticker MUST be all-caps, max 10 characters, alphanumeric only, no spaces.
- Token name MUST be concise (max 30 characters), alphanumeric + spaces only.
- Description MUST be a funny, witty, culturally relevant crypto meme summary (max 280 characters).
- viralScore MUST be an integer between 1 and 100 based on narrative momentum.
- imagePrompt MUST be a detailed, vivid English description of the token logo for AI image generation (e.g. cute chibi character, vibrant colors, vector crypto sticker style).
- website, twitter, telegram MUST be valid complete URLs.
- twitter MUST be relevant to the token narrative or ticker (e.g. https://x.com/TOKEN_coin or extracted from the scraped viral trend/narrative). NEVER use any real person's personal social media.
- Return PURE JSON ONLY. No markdown formatting, no conversational filler, no backticks outside JSON.

OUTPUT FORMAT (STRICT PURE JSON):
{
  "name": "Token Name Here",
  "ticker": "TICKR",
  "description": "Funny and viral meme description under 280 chars",
  "viralScore": 85,
  "imagePrompt": "cute cartoon character wearing sunglasses, crypto meme style, vibrant colors, simple background",
  "website": "https://tokenname.xyz",
  "twitter": "https://twitter.com/tokennamecoin",
  "telegram": "https://t.me/tokennameportal"
}`;

/**
 * Calls ByteDance / BytePlus ModelArk OpenAI-compatible endpoint.
 */
export async function callByteDanceModelArk(
  trendData: string,
  cfg: ReturnType<typeof getConfig>
): Promise<TokenIdentity | null> {
  const apiKey = cfg.BYTEDANCE_ARK_API_KEY?.trim();
  const endpoint = cfg.BYTEDANCE_MODEL_ENDPOINT?.trim();
  const baseUrl = cfg.BYTEDANCE_BASE_URL?.trim().replace(/\/+$/, "");

  if (!apiKey || !endpoint || !baseUrl) {
    logger.warn("⚠️  [AI-FALLBACK] ByteDance ModelArk credentials are not fully configured.");
    return null;
  }

  const userPrompt = `Here is the latest live crypto market trend data:\n\n${trendData.slice(0, 4000)}\n\nBased on the data above, identify the most viral narrative and generate an English meme token identity. Return pure JSON only.`;

  logger.info(`🔄 [AI-FALLBACK] Invoking BytePlus ModelArk (${endpoint})...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model: endpoint,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.7,
          response_format: { type: "json_object" },
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 25000,
        }
      );

      const rawContent = response.data?.choices?.[0]?.message?.content?.trim();
      if (!rawContent) {
        logger.warn(`⚠️  [AI-FALLBACK] ByteDance returned empty response (attempt ${attempt})`);
        continue;
      }

      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn(`⚠️  [AI-FALLBACK] ByteDance returned invalid JSON text (attempt ${attempt})`);
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      const sanitized = sanitizeIdentityRaw(parsed);
      const validated = TokenIdentitySchema.safeParse(sanitized);

      if (!validated.success) {
        logger.warn(
          `⚠️  [AI-FALLBACK] ByteDance validation failed (attempt ${attempt}): ${validated.error.errors.map((e) => e.message).join(", ")}`
        );
        continue;
      }

      logger.success(
        `✅ [AI-FALLBACK] BytePlus ModelArk successfully created token: $${validated.data.ticker} - "${validated.data.name}" (score: ${validated.data.viralScore})`
      );
      return applyIdentityOverrides(validated.data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`⚠️  [AI-FALLBACK] ByteDance error (attempt ${attempt}/${MAX_RETRIES}): ${errMsg}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  logger.error("❌ [AI-FALLBACK] BytePlus ModelArk failed to generate token identity after retries.");
  return null;
}

export function normalizeTrendInput(input?: string | { chain?: string; trendData?: string } | null): string {
  if (typeof input === "string" && input.trim().length > 0) {
    return input.trim();
  }
  if (input && typeof input === "object") {
    if (typeof input.trendData === "string" && input.trendData.trim().length > 0) {
      return input.trendData.trim();
    }
    if (typeof input.chain === "string" && input.chain.trim().length > 0) {
      return `Trending crypto meme narratives and high-momentum alpha on ${input.chain.trim()} chain, viral autonomous AI culture`;
    }
  }
  return "Trending crypto meme narratives, autonomous AI agents, on-chain culture, viral decentralized finance";
}

export async function generateTokenIdentity(
  trendDataOrOptions?: string | { chain?: string; trendData?: string }
): Promise<TokenIdentity | null> {
  const trendData = normalizeTrendInput(trendDataOrOptions);
  const cfg = getConfig();
  const userPrompt = `Here is the latest live crypto market trend data:\n\n${trendData.slice(0, 4000)}\n\nBased on the data above, identify the most viral narrative and generate an English meme token identity. Return pure JSON only.`;

  // ─── STAGE 1: Primary AI — Google Gemini ─────────────────────
  if (cfg.GOOGLE_GENERATIVE_AI_API_KEY && cfg.GOOGLE_GENERATIVE_AI_API_KEY.trim().length > 0) {
    const genAI = new GoogleGenerativeAI(cfg.GOOGLE_GENERATIVE_AI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.info(`🧠 [AI] Gemini AI processing trends... (attempt ${attempt}/${MAX_RETRIES})`);

        const chat = model.startChat({
          history: [
            { role: "user", parts: [{ text: SYSTEM_PROMPT }] },
            { role: "model", parts: [{ text: "Understood. Send the trend data and I will output pure JSON token identity." }] },
          ],
        });

        const result = await chat.sendMessage(userPrompt);
        const rawText = result.response.text().trim();

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          logger.warn(`⚠️  Gemini did not return valid JSON (attempt ${attempt})`);
          continue;
        }

        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        const sanitized = sanitizeIdentityRaw(parsed);
        const validated = TokenIdentitySchema.safeParse(sanitized);

        if (!validated.success) {
          logger.warn(
            `⚠️  Gemini validation failed (attempt ${attempt}): ${validated.error.errors.map((e) => e.message).join(", ")}`
          );
          continue;
        }

        logger.success(`✅ Gemini created token identity: $${validated.data.ticker} (score: ${validated.data.viralScore})`);
        return applyIdentityOverrides(validated.data);
      } catch (err) {
        logger.error(`❌ Gemini error (attempt ${attempt}): ${String(err)}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    logger.warn("⚠️  Gemini attempts exhausted. Evaluating AI fallback provider...");
  } else {
    logger.info("ℹ️  GOOGLE_GENERATIVE_AI_API_KEY not configured. Falling back to ByteDance ModelArk directly...");
  }

  // ─── STAGE 2: Secondary / Fallback AI — BytePlus ModelArk ──
  if (cfg.BYTEDANCE_ARK_API_KEY && cfg.BYTEDANCE_ARK_API_KEY.trim().length > 0) {
    const fallbackResult = await callByteDanceModelArk(trendData, cfg);
    if (fallbackResult) {
      return fallbackResult;
    }
  }

  logger.error("❌ All AI providers (Gemini & ByteDance ModelArk) failed or are unconfigured.");
  return null;
}

