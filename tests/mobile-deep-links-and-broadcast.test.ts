/**
 * tests/mobile-deep-links-and-broadcast.test.ts
 *
 * Automated verification suite for:
 * 1. Universal Mobile Wallet Deep Linking (MetaMask, Coinbase Wallet, Phantom) in Web3 DApp.
 * 2. Client-side JavaScript syntax verification (new Function check).
 * 3. Token Launch Announcement Broadcast integration with live Web3 URL and WebApp button.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import { broadcastTokenLaunchAnnouncement } from "../src/modules/social/beacon-broadcaster.ts";

describe("Universal Mobile Wallet Deep Linking & Broadcast Suite", () => {
  const SITES_DIR = path.join(process.cwd(), "sites");

  it("1.1 should generate EVM DApp with mobile deep link containers and schema in index.html & parallax-3d.js", async () => {
    const baseCA = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
    const res = await generateTokenWebsite({
      name: "Mobile EVM Test",
      ticker: "TMEVM",
      contractAddress: baseCA,
      chainId: 8453,
      chainName: "base",
      sector: "VIRAL_MEME",
      skipSocialCard: true,
      skipIpfs: true,
    });

    const htmlPath = path.join(res.siteDirectory, "index.html");
    const jsPath = path.join(res.siteDirectory, "parallax-3d.js");
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.existsSync(jsPath)).toBe(true);

    const html = fs.readFileSync(htmlPath, "utf-8");
    const js = fs.readFileSync(jsPath, "utf-8");

    // HTML assertions
    expect(html).toContain("id=\"wallet-guide-modal\"");
    expect(html).toContain("id=\"wallet-modal-description\"");
    expect(html).toContain("id=\"wallet-mobile-options\"");
    expect(html).toContain("id=\"wallet-desktop-options\"");
    expect(html).toContain("id=\"wallet-deep-metamask\"");
    expect(html).toContain("id=\"wallet-deep-coinbase\"");
    expect(html).toContain("id=\"wallet-fallback-swap\"");
    expect(html).toContain("Open in MetaMask App");
    expect(html).toContain("Open in Coinbase Wallet");

    // JavaScript assertions
    expect(js).toContain("Android|iPhone|iPad|iPod");
    expect(js).toContain("https://metamask.app.link/dapp/");
    expect(js).toContain("https://go.cb-w.com/dapp?cb_url=");

    // JS Syntax validation
    expect(() => {
      new Function(js);
    }).not.toThrow();
  });

  it("1.2 should generate Solana DApp with Phantom mobile deep linking and schema", async () => {
    const solanaCA = "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz";
    const res = await generateTokenWebsite({
      name: "Mobile Solana Test",
      ticker: "TMSOL",
      contractAddress: solanaCA,
      chainId: 101,
      chainName: "solana",
      sector: "AI_AGENT",
      skipSocialCard: true,
      skipIpfs: true,
    });

    const htmlPath = path.join(res.siteDirectory, "index.html");
    const jsPath = path.join(res.siteDirectory, "parallax-3d.js");
    expect(fs.existsSync(htmlPath)).toBe(true);
    expect(fs.existsSync(jsPath)).toBe(true);

    const html = fs.readFileSync(htmlPath, "utf-8");
    const js = fs.readFileSync(jsPath, "utf-8");

    // Solana HTML assertions
    expect(html).toContain("id=\"wallet-guide-modal\"");
    expect(html).toContain("id=\"wallet-deep-phantom\"");
    expect(html).toContain("Open in Phantom App");
    expect(html).toContain("https://phantom.app/download");

    // Solana JS assertions
    expect(js).toContain("https://phantom.app/ul/browse/");
    expect(js).toContain("phantomLink.href");

    // JS Syntax validation
    expect(() => {
      new Function(js);
    }).not.toThrow();
  });

  it("1.3 should broadcast launch announcement incorporating live Web3 DApp URL non-blockingly", async () => {
    const bcastResult = await broadcastTokenLaunchAnnouncement({
      ticker: "PUMPRUN",
      name: "PumpRun Protocol",
      contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      chain: "base",
      websiteUrl: "https://pumprun-web3.pages.dev",
      poolId: "0xpool123",
      timeoutMs: 1500,
    });

    expect(bcastResult.success).toBe(true);
    expect(bcastResult.messageText).toContain("PUMPRUN");
    expect(bcastResult.messageText).toContain("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    expect(bcastResult.messageText).toContain("Web3 DApp: https://pumprun-web3.pages.dev");
    expect(bcastResult.messageText).toContain("BASE");
  });

  it("1.4 should gracefully handle missing optional parameters in broadcastTokenLaunchAnnouncement without throwing", async () => {
    const bcastResult = await broadcastTokenLaunchAnnouncement({
      ticker: "ROBIN",
      name: "Robinhood Token",
      contractAddress: "0x1234567890abcdef1234567890abcdef12345678",
      chain: "robinhood",
      timeoutMs: 1000,
    });

    expect(bcastResult.success).toBe(true);
    expect(bcastResult.messageText).toContain("ROBIN");
    expect(bcastResult.messageText).toContain("ROBINHOOD");
  });
});
