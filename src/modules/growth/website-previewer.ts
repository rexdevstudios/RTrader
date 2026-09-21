/**
 * src/modules/growth/website-previewer.ts
 *
 * Local Web3 Website Live Preview Engine.
 *
 * Capabilities:
 *   1. Scans and inventories all compiled websites in `sites/`.
 *   2. Starts a zero-config, low-latency static HTTP server using native `Bun.serve`.
 *   3. Intelligent port collision handling (auto-retries ports 3000-3010).
 *   4. Full MIME type support for HTML, SVG OpenGraph cards, JSON profiles, CSS, and JS.
 *   5. Cross-platform 1-click browser opener (Windows, macOS, Linux).
 *   6. Clean, testable lifecycle with `stop()` method for automated integration tests.
 */

import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";
import { logger } from "../../logger.ts";

export interface AvailableWebsite {
  ticker: string;
  siteDir: string;
  hasIndexHtml: boolean;
  hasOgImage: boolean;
  hasDexProfile: boolean;
  modifiedAt: Date;
}

export interface PreviewServerOptions {
  siteDir: string;
  port?: number;
  openBrowser?: boolean;
  host?: string;
}

export interface PreviewServerInstance {
  server: any;
  url: string;
  port: number;
  siteDir: string;
  stop: () => void;
}

/**
 * Returns MIME type based on file extension.
 */
export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

/**
 * Launches the system's default web browser to the specified URL.
 */
export function openBrowser(url: string): void {
  const platform = process.platform;
  const startCmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
      ? `open "${url}"`
      : `xdg-open "${url}"`;

  exec(startCmd, (err) => {
    if (err) {
      logger.warn(`⚠️  [PREVIEW] Tidak dapat membuka browser secara otomatis: ${err.message}`);
    }
  });
}

/**
 * Lists all generated websites currently stored inside `sites/`.
 */
export function listAvailableWebsites(sitesBaseDir?: string): AvailableWebsite[] {
  const baseDir = sitesBaseDir || path.resolve(process.cwd(), "sites");
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const results: AvailableWebsite[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const siteDir = path.join(baseDir, entry.name);
      const indexPath = path.join(siteDir, "index.html");
      const hasIndexHtml = fs.existsSync(indexPath) && fs.statSync(indexPath).isFile();
      const hasOgImage = fs.existsSync(path.join(siteDir, "og-image.svg"));
      const hasDexProfile = fs.existsSync(path.join(siteDir, "dexscreener-profile.json"));

      let modifiedAt = new Date(0);
      try {
        const stats = fs.statSync(siteDir);
        modifiedAt = stats.mtime;
      } catch {}

      results.push({
        ticker: entry.name.toUpperCase(),
        siteDir,
        hasIndexHtml,
        hasOgImage,
        hasDexProfile,
        modifiedAt,
      });
    }
  }

  // Sort descending by last modified
  return results.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

/**
 * Resolves target website directory from input ticker, folder name, or latest site.
 */
export function resolveTargetWebsite(
  target?: string,
  sitesBaseDir?: string
): { siteDir: string; ticker: string } | null {
  const baseDir = sitesBaseDir || path.resolve(process.cwd(), "sites");

  if (target && target.trim().length > 0) {
    const clean = target.trim();
    // 1. Direct path check
    if (fs.existsSync(clean) && fs.statSync(clean).isDirectory()) {
      return {
        siteDir: path.resolve(clean),
        ticker: path.basename(clean).toUpperCase(),
      };
    }

    // 2. Subfolder in sites/
    const subPath = path.join(baseDir, clean.toLowerCase());
    if (fs.existsSync(subPath) && fs.statSync(subPath).isDirectory()) {
      return {
        siteDir: subPath,
        ticker: clean.toUpperCase(),
      };
    }

    // 3. Case-insensitive search in available websites
    const all = listAvailableWebsites(baseDir);
    const match = all.find((s) => s.ticker.toLowerCase() === clean.toLowerCase());
    if (match) {
      return {
        siteDir: match.siteDir,
        ticker: match.ticker,
      };
    }
  }

  // 4. Default: Pick latest modified site
  const all = listAvailableWebsites(baseDir);
  const latestWithIndex = all.find((s) => s.hasIndexHtml) || all[0];
  if (latestWithIndex) {
    return {
      siteDir: latestWithIndex.siteDir,
      ticker: latestWithIndex.ticker,
    };
  }

  return null;
}

/**
 * Starts a high-speed static HTTP server using Bun native HTTP.
 * Automatically tries next ports if the default port is already in use.
 */
export async function startWebsitePreviewServer(
  options: PreviewServerOptions
): Promise<PreviewServerInstance> {
  const siteDir = path.resolve(options.siteDir);
  if (!fs.existsSync(siteDir) || !fs.statSync(siteDir).isDirectory()) {
    throw new Error(`Direktori situs tidak ditemukan: ${siteDir}`);
  }

  const initialPort = options.port || 3000;
  const maxTries = 10;
  let currentPort = initialPort;
  let server: any = null;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    try {
      server = Bun.serve({
        port: currentPort,
        hostname: options.host || "localhost",
        fetch(req) {
          const url = new URL(req.url);
          let pathname = decodeURIComponent(url.pathname);
          if (pathname === "/" || pathname === "") {
            pathname = "/index.html";
          }

          const filePath = path.join(siteDir, pathname);

          // Prevent directory traversal attacks
          if (!filePath.startsWith(siteDir)) {
            return new Response("403 Forbidden", { status: 403 });
          }

          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const file = Bun.file(filePath);
            const mime = getMimeType(filePath);
            return new Response(file, {
              headers: {
                "Content-Type": mime,
                "Cache-Control": "no-cache, no-store, must-revalidate",
              },
            });
          }

          return new Response("404 Not Found", {
            status: 404,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        },
      });

      // Successfully bound port
      break;
    } catch (err: any) {
      if (err?.code === "EADDRINUSE" || String(err).includes("address already in use")) {
        currentPort++;
      } else {
        throw err;
      }
    }
  }

  if (!server) {
    throw new Error(
      `Gagal menjalankan server preview: Port ${initialPort} hingga ${initialPort + maxTries - 1} sedang digunakan.`
    );
  }

  const url = `http://localhost:${currentPort}`;
  logger.success(`🌐 [PREVIEW] Server Web3 DApp aktif di ${url}`);
  logger.info(`   Direktori: ${siteDir}`);

  if (options.openBrowser !== false) {
    openBrowser(url);
  }

  return {
    server,
    url,
    port: currentPort,
    siteDir,
    stop: () => {
      server.stop();
      logger.info(`⏹️  [PREVIEW] Server di port ${currentPort} telah dihentikan.`);
    },
  };
}
