/**
 * tests/pwa-and-multi-rpc.test.ts
 *
 * Automated verification suite for:
 * 1. PWA (Progressive Web App) Manifest (manifest.json) & Offline Service Worker (sw.js).
 * 2. Client-Side Multi-RPC Failover Engine in parallax-3d.js across Base, Robinhood, and Solana.
 * 3. Client-side JavaScript syntax verification (new Function check).
 */

import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";

describe("PWA Mobile Manifest & Multi-RPC Failover Engine Suite", () => {
  it("1.1 should generate valid manifest.json and sw.js in site directory", async () => {
    const baseCA = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
    const res = await generateTokenWebsite({
      name: "PWA Protocol",
      ticker: "PWAEV",
      contractAddress: baseCA,
      chainId: 8453,
      chainName: "base",
      sector: "DEFI_TREASURY",
      skipSocialCard: true,
      skipIpfs: true,
    });

    const manifestPath = path.join(res.siteDirectory, "manifest.json");
    const swPath = path.join(res.siteDirectory, "sw.js");
    const htmlPath = path.join(res.siteDirectory, "index.html");
    const jsPath = path.join(res.siteDirectory, "parallax-3d.js");

    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(swPath)).toBe(true);
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.existsSync(jsPath)).toBe(true);

    // Verify manifest JSON structure
    const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.name).toBe("PWA Protocol Protocol");
    expect(manifest.short_name).toBe("$PWAEV");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("./");
    expect(manifest.background_color).toBe("#07080b");
    expect(manifest.icons).toBeArray();
    expect(manifest.icons.length).toBeGreaterThan(0);

    // Verify sw.js syntax & logic
    const swJs = fs.readFileSync(swPath, "utf-8");
    expect(swJs).toContain("CACHE_NAME");
    expect(swJs).toContain("STATIC_ASSETS");
    expect(swJs).toContain("caches.open");
    expect(swJs).toContain("self.skipWaiting");
    expect(() => {
      new Function(swJs);
    }).not.toThrow();

    // Verify index.html tags
    const html = fs.readFileSync(htmlPath, "utf-8");
    expect(html).toContain("<link rel=\"manifest\" href=\"manifest.json\"");
    expect(html).toContain("apple-mobile-web-app-capable");
    expect(html).toContain("apple-mobile-web-app-status-bar-style");
    expect(html).toContain("apple-touch-icon");
  });

  it("1.2 should verify Service Worker registration and Multi-RPC pool in parallax-3d.js", async () => {
    const baseCA = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
    const res = await generateTokenWebsite({
      name: "RPC Failover Test",
      ticker: "TRPC",
      contractAddress: baseCA,
      chainId: 8453,
      chainName: "base",
      sector: "AI_AGENT",
      skipSocialCard: true,
      skipIpfs: true,
    });

    const jsPath = path.join(res.siteDirectory, "parallax-3d.js");
    const js = fs.readFileSync(jsPath, "utf-8");

    // Service Worker registration check
    expect(js).toContain("navigator.serviceWorker.register");
    expect(js).toContain("sw.js");

    // Multi-RPC pool check
    expect(js).toContain("const RPC_POOL =");
    expect(js).toContain("https://mainnet.base.org");
    expect(js).toContain("https://base.llamarpc.com");
    expect(js).toContain("https://rpc.robinhoodchain.com");
    expect(js).toContain("https://api.mainnet-beta.solana.com");
    expect(js).toContain("async function executeRpcWithFailover");

    // Fallback balance query check
    expect(js).toContain("executeRpcWithFailover");
    expect(js).toContain("eth_getBalance");

    // JS Syntax validation
    expect(() => {
      new Function(js);
    }).not.toThrow();
  });

  it("1.3 should integrate native SOL balance query with failover RPC on Solana DApp", async () => {
    const solCA = "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz";
    const res = await generateTokenWebsite({
      name: "Solana RPC Test",
      ticker: "SOLRPC",
      contractAddress: solCA,
      chainId: 101,
      chainName: "solana",
      sector: "GAMING_UTILITY",
      skipSocialCard: true,
      skipIpfs: true,
    });

    const jsPath = path.join(res.siteDirectory, "parallax-3d.js");
    const js = fs.readFileSync(jsPath, "utf-8");

    // Solana balance query check
    expect(js).toContain("executeRpcWithFailover('solana', 'getBalance', [addr])");
    expect(js).toContain("swapBalEl.innerText = 'Balance: ' + solAmount.toFixed(4) + ' SOL'");

    // JS Syntax validation
    expect(() => {
      new Function(js);
    }).not.toThrow();
  });
});
