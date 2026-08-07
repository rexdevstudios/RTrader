// Uses native global fetch (Node 18+ & Next.js native)

export interface ScrapeJobResult {
  jobId: string;
  targetUrl: string;
  domain: string;
  markdownContent: string;
  extractedMetadata: Record<string, unknown>;
  scrapedAt: string;
}

export interface ScraperDbAdapter {
  recordScrapedDocument(doc: {
    targetUrl: string;
    domain: string;
    rawContent: string;
    markdownContent: string;
    extractedMetadata: Record<string, unknown>;
    firecrawlJobId: string;
  }): Promise<string>;

  deductCredits(userId: string, amount: number, description: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal: Firecrawl API v1 response shape
// ---------------------------------------------------------------------------
interface FirecrawlApiResponse {
  success: boolean;
  data?: {
    markdown?: string;
    rawHtml?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      [key: string]: unknown;
    };
  };
  error?: string;
}

export class FirecrawlScraperService {
  private static readonly COST_PER_SCRAPE_CREDITS = 1;
  private static readonly FIRECRAWL_API_BASE = 'https://api.firecrawl.dev/v1';

  constructor(
    private firecrawlApiKey: string,
    private db: ScraperDbAdapter
  ) {}

  /**
   * Eksekusi Firecrawl Ingestion Job via Real API & Normalisasi Data ke Postgres SSOT.
   *
   * INVARIANT (MASTER_PROMPT.md §Core Path Protection):
   *   Kegagalan Firecrawl API TIDAK boleh memblok caller.
   *   Seluruh fetch dibungkus try/catch — error dikembalikan sebagai fallback result.
   */
  async scrapeTargetUrl(
    userId: string,
    targetUrl: string
  ): Promise<ScrapeJobResult> {
    console.log(`[Firecrawl Scraper] Ingesting web intelligence from ${targetUrl}...`);

    const urlObj = new URL(targetUrl);
    const domain = urlObj.hostname;

    // 1. Potong Kredit Usage Billing Ledger (1 Kredit)
    await this.db.deductCredits(
      userId,
      FirecrawlScraperService.COST_PER_SCRAPE_CREDITS,
      `Firecrawl Scraping: ${domain}`
    );

    const firecrawlJobId = `fc-job-${Date.now()}`;
    let markdownContent = '';
    let rawContent = '';
    let extractedMetadata: Record<string, unknown> = {};

    try {
      // 2. Real Firecrawl API v1 Call
      const res = await fetch(`${FirecrawlScraperService.FIRECRAWL_API_BASE}/scrape`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: targetUrl,
          formats: ['markdown', 'rawHtml'],
        }),
      });

      if (!res.ok) {
        // Non-2xx: log and fall through to safe defaults
        console.warn(`[Firecrawl Scraper] API returned ${res.status} for ${targetUrl} — using safe fallback`);
      } else {
        const data = (await res.json()) as FirecrawlApiResponse;

        if (data.success && data.data) {
          markdownContent = data.data.markdown || '';
          rawContent = data.data.rawHtml || '';
          const meta = data.data.metadata || {};
          extractedMetadata = {
            title: meta.title || domain,
            description: meta.description || '',
            language: meta.language || 'en',
            source: 'firecrawl_api_v1',
            scrapedDomain: domain,
          };
          console.log(`[Firecrawl Scraper] API success — ${markdownContent.length} chars markdown received`);
        } else {
          console.warn(`[Firecrawl Scraper] API returned success=false for ${targetUrl}: ${data.error}`);
        }
      }
    } catch (err) {
      // Network error or parse failure — fail-safe fallback, do NOT propagate
      console.warn(`[Firecrawl Scraper] API error for ${targetUrl} (out-of-band fallback):`, (err as Error).message);
    }

    // Safe defaults if API produced no content
    if (!markdownContent) {
      markdownContent = `# ${domain}\n\n(Firecrawl ingestion pending or unavailable)`;
    }
    if (!rawContent) {
      rawContent = `<html><body><p>${domain} – content unavailable</p></body></html>`;
    }
    if (Object.keys(extractedMetadata).length === 0) {
      extractedMetadata = { title: domain, source: 'fallback', scrapedDomain: domain };
    }

    // 3. Simpan ke Database SSOT (scraped_documents table)
    const docId = await this.db.recordScrapedDocument({
      targetUrl,
      domain,
      rawContent,
      markdownContent,
      extractedMetadata,
      firecrawlJobId,
    });

    console.log(`[Firecrawl Scraper] Saved normalized document ${docId} (Job: ${firecrawlJobId})`);

    return {
      jobId: firecrawlJobId,
      targetUrl,
      domain,
      markdownContent,
      extractedMetadata,
      scrapedAt: new Date().toISOString(),
    };
  }
}

