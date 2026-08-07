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

export class FirecrawlScraperService {
  private static readonly COST_PER_SCRAPE_CREDITS = 1;

  constructor(
    private firecrawlApiKey: string,
    private db: ScraperDbAdapter
  ) {}

  /**
   * Eksekusi Firecrawl Ingestion Job & Normalisasi Data ke Postgres SSOT
   */
  async scrapeTargetUrl(
    userId: string,
    targetUrl: string
  ): Promise<ScrapeJobResult> {
    console.log(`[Firecrawl Scraper] Ingesting web intelligence from ${targetUrl}...`);

    const urlObj = new URL(targetUrl);
    const domain = urlObj.hostname;

    // 1. Potong Kredit Usage Billing Ledger (1 Kredit)
    await this.db.deductCredits(userId, FirecrawlScraperService.COST_PER_SCRAPE_CREDITS, `Firecrawl Scraping: ${domain}`);

    // 2. Simulasi Ingestion & Normalisasi Firecrawl API
    const firecrawlJobId = `fc-job-${Date.now()}`;
    const rawHtml = `<html><body><h1>Project ${domain}</h1><p>Tokenomics and whitepaper spec for degen launch.</p></body></html>`;
    const markdownContent = `# Project ${domain}\n\nTokenomics and whitepaper spec for degen launch.`;
    const extractedMetadata = {
      title: `Project ${domain}`,
      language: 'en',
      sentimentScore: 0.78,
      keywords: ['launchpad', 'crypto', 'degen', 'tokenomics'],
    };

    // 3. Simpan ke Database SSOT
    const docId = await this.db.recordScrapedDocument({
      targetUrl,
      domain,
      rawContent: rawHtml,
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
