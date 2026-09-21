/**
 * firecrawl-radar.ts — Modul Radar Tren menggunakan Firecrawl API.
 *
 * Tugasnya: scrape halaman DexScreener dan sumber kripto lainnya,
 * lalu kembalikan ringkasan tren dalam bentuk teks bersih (markdown)
 * yang siap dikirim ke Gemini AI untuk dianalisis.
 */
import axios from "axios";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";

const SCRAPE_TARGETS = [
  "https://dexscreener.com/new-pairs",
  "https://pump.fun",
];

interface FirecrawlResponse {
  success: boolean;
  data?: {
    markdown?: string;
    content?: string;
  };
  error?: string;
}

/**
 * Scrape satu URL menggunakan Firecrawl API.
 * Mengembalikan teks markdown atau null jika gagal.
 */
async function scrapeUrl(url: string, apiKey: string): Promise<string | null> {
  try {
    const response = await axios.post<FirecrawlResponse>(
      "https://api.firecrawl.dev/v1/scrape",
      {
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 15000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 20000,
      }
    );

    if (response.data.success && response.data.data?.markdown) {
      // Potong teks agar tidak terlalu panjang dikirim ke AI
      return response.data.data.markdown.slice(0, 3000);
    }
    return null;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.warn(`Firecrawl gagal scrape ${url}: ${err.message}`);
    }
    return null;
  }
}

export interface TrendData {
  raw: string;
  sources: string[];
  scrapedAt: string;
}

/**
 * Fungsi utama: scrape semua target, gabungkan hasilnya.
 */
export async function scanTrends(): Promise<TrendData | null> {
  const cfg = getConfig();
  logger.info("📡 Memulai scan tren dari Firecrawl...");

  const results: string[] = [];
  const successSources: string[] = [];

  for (const url of SCRAPE_TARGETS) {
    const text = await scrapeUrl(url, cfg.FIRECRAWL_API_KEY);
    if (text) {
      results.push(`=== Sumber: ${url} ===\n${text}`);
      successSources.push(url);
      logger.success(`✅ Berhasil scrape: ${url}`);
    }
  }

  if (results.length === 0) {
    logger.error("❌ Tidak ada data tren yang berhasil di-scrape.");
    return null;
  }

  return {
    raw: results.join("\n\n"),
    sources: successSources,
    scrapedAt: new Date().toISOString(),
  };
}
