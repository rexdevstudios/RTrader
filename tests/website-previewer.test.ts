/**
 * tests/website-previewer.test.ts
 *
 * Automated tests for Local Web3 Website Live Previewer:
 *   - MIME type resolution (HTML, SVG, JSON, CSS, JS)
 *   - Directory scanning (listAvailableWebsites)
 *   - Target website resolution (ticker, directory, latest fallback)
 *   - High-speed Bun.serve static file serving (200 OK & 404 handling)
 *   - Clean server lifecycle & stop() shutdown
 *   - CLI argument parsing
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  getMimeType,
  listAvailableWebsites,
  resolveTargetWebsite,
  startWebsitePreviewServer,
} from "../src/modules/growth/website-previewer.ts";
import { parsePreviewArgs } from "../scripts/preview-website.ts";

describe("Web3 Website Local Previewer Suite", () => {
  const testSitesBase = path.resolve(process.cwd(), "sites", "test_preview_sandbox");
  const dummySiteDir = path.join(testSitesBase, "dummy_token");

  beforeEach(() => {
    if (!fs.existsSync(dummySiteDir)) {
      fs.mkdirSync(dummySiteDir, { recursive: true });
      fs.writeFileSync(
        path.join(dummySiteDir, "index.html"),
        "<!DOCTYPE html><html><head><title>Preview Test</title></head><body><h1>$DUMMY Live</h1></body></html>",
        "utf-8"
      );
      fs.writeFileSync(
        path.join(dummySiteDir, "dexscreener-profile.json"),
        JSON.stringify({ ticker: "DUMMY", chainId: 8453 }),
        "utf-8"
      );
      fs.writeFileSync(
        path.join(dummySiteDir, "og-image.svg"),
        "<svg><text>DUMMY</text></svg>",
        "utf-8"
      );
    }
  });

  afterEach(() => {
    if (fs.existsSync(testSitesBase)) {
      fs.rmSync(testSitesBase, { recursive: true, force: true });
    }
  });

  describe("1. MIME Type Resolution", () => {
    it("1.1 should correctly resolve MIME types for web assets", () => {
      expect(getMimeType("index.html")).toContain("text/html");
      expect(getMimeType("banner.svg")).toBe("image/svg+xml");
      expect(getMimeType("profile.json")).toContain("application/json");
      expect(getMimeType("style.css")).toContain("text/css");
      expect(getMimeType("app.js")).toContain("application/javascript");
      expect(getMimeType("favicon.ico")).toBe("image/x-icon");
      expect(getMimeType("unknown.bin")).toBe("application/octet-stream");
    });
  });

  describe("2. Directory Scanning & Target Resolution", () => {
    it("2.1 should list available websites in directory", () => {
      const available = listAvailableWebsites(testSitesBase);
      expect(available.length).toBe(1);
      expect(available[0].ticker).toBe("DUMMY_TOKEN");
      expect(available[0].hasIndexHtml).toBe(true);
      expect(available[0].hasOgImage).toBe(true);
      expect(available[0].hasDexProfile).toBe(true);
    });

    it("2.2 should resolve target website by ticker or subfolder", () => {
      const match = resolveTargetWebsite("dummy_token", testSitesBase);
      expect(match).not.toBeNull();
      expect(match?.ticker).toBe("DUMMY_TOKEN");
      expect(match?.siteDir).toBe(dummySiteDir);
    });

    it("2.3 should fallback to latest website when target is omitted", () => {
      const latest = resolveTargetWebsite(undefined, testSitesBase);
      expect(latest).not.toBeNull();
      expect(latest?.ticker).toBe("DUMMY_TOKEN");
    });
  });

  describe("3. Static File HTTP Serving (Bun.serve)", () => {
    it("3.1 should start preview server, serve index.html with 200 OK, and stop cleanly", async () => {
      const instance = await startWebsitePreviewServer({
        siteDir: dummySiteDir,
        port: 3388,
        openBrowser: false,
      });

      try {
        expect(instance.url).toBe(`http://localhost:${instance.port}`);
        expect(instance.port).toBe(3388);

        // Fetch root index.html
        const res = await fetch(`${instance.url}/`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        const body = await res.text();
        expect(body).toContain("$DUMMY Live");

        // Fetch JSON asset
        const jsonRes = await fetch(`${instance.url}/dexscreener-profile.json`);
        expect(jsonRes.status).toBe(200);
        expect(jsonRes.headers.get("content-type")).toContain("application/json");

        // Fetch SVG asset
        const svgRes = await fetch(`${instance.url}/og-image.svg`);
        expect(svgRes.status).toBe(200);
        expect(svgRes.headers.get("content-type")).toBe("image/svg+xml");

        // Fetch non-existent file
        const notFoundRes = await fetch(`${instance.url}/non-existent.html`);
        expect(notFoundRes.status).toBe(404);
      } finally {
        instance.stop();
      }
    });

    it("3.2 should throw when siteDir does not exist", async () => {
      expect(
        startWebsitePreviewServer({
          siteDir: path.join(testSitesBase, "non_existent_folder_xyz"),
          port: 3389,
          openBrowser: false,
        })
      ).rejects.toThrow("Direktori situs tidak ditemukan");
    });
  });

  describe("4. CLI Argument Parsing", () => {
    it("4.1 should parse CLI arguments with custom port and --no-open", () => {
      const parsed = parsePreviewArgs(["PUMPRUN", "--port=4000", "--no-open"]);
      expect(parsed.target).toBe("PUMPRUN");
      expect(parsed.port).toBe(4000);
      expect(parsed.openBrowser).toBe(false);
    });

    it("4.2 should parse shorthand -p flag", () => {
      const parsed = parsePreviewArgs(["-p", "5000", "--headless"]);
      expect(parsed.port).toBe(5000);
      expect(parsed.openBrowser).toBe(false);
    });
  });
});
