/**
 * tests/all-templates-integration.test.ts
 *
 * Comprehensive Test Suite for All 4 Web3 Website Templates:
 * 1. AI_AGENT: Cyber AI Terminal Sandbox, /command handler, and Matrix Rain Canvas.
 * 2. DEFI_TREASURY: Treasury Flywheel HUD, Dynamic Dividend Slider, and 3D Particles.
 * 3. GAMING_UTILITY: Cyber Node Power HUD, Hashrate Telemetry, and Cyber Grid Canvas.
 * 4. VIRAL_MEME: 3D Parallax Card, 10-Min FOMO Countdown, and FOMO Fire Canvas.
 *
 * Verifies that all 4 templates are 100% integrated into the system,
 * generate valid HTML & CSS, and produce syntactically valid JavaScript (new Function).
 */

process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || "test-mock-gemini-key";
process.env.PINATA_JWT = process.env.PINATA_JWT || "test-mock-pinata-jwt";
process.env.EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "test-mock-firecrawl-key";

import { describe, test, expect } from "bun:test";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import { SECTOR_THEMES, type Web3Sector } from "../src/modules/growth/template-registry.ts";
import * as fs from "fs";
import * as path from "path";

describe("Web3 Multi-Template Integration Suite (All 4 Archetypes)", () => {
  const baseTestDir = path.join(process.cwd(), "sites", "test_all_templates");

  const sectors: Array<{
    sector: Web3Sector;
    ticker: string;
    name: string;
    expectedHtmlElements: string[];
    expectedJsSignatures: string[];
  }> = [
    {
      sector: "AI_AGENT",
      ticker: "AGNTCORE",
      name: "Autonomous Agent Core",
      expectedHtmlElements: [
        'id="terminal-sandbox"',
        'id="terminal-logs"',
        'id="terminal-form"',
        '/help',
        '/status',
        '/ca',
        '/buyback',
      ],
      expectedJsSignatures: [
        "visualEffect === 'matrix-rain'",
        "animateMatrix",
        "initTerminal",
        "escapeHtml",
      ],
    },
    {
      sector: "DEFI_TREASURY",
      ticker: "TREASURY",
      name: "DeFi Treasury Vault",
      expectedHtmlElements: [
        'id="treasury-hud"',
        'id="treasury-slider"',
        'id="treasury-reserve-val"',
        'id="burn-counter-val"',
        'id="calc-token-amt"',
      ],
      expectedJsSignatures: [
        "initTreasuryHUD",
        "treasury-slider",
        "currentReserveUsd",
        "3d-tilt-particles",
      ],
    },
    {
      sector: "GAMING_UTILITY",
      ticker: "CYBERNODE",
      name: "Cyber DePIN Node",
      expectedHtmlElements: [
        'id="node-power-hud"',
        'id="node-hashrate-val"',
        'id="node-load-text"',
        'id="node-load-bar"',
        "Tier 3 (Master Node)",
      ],
      expectedJsSignatures: [
        "initNodeHUD",
        "visualEffect === 'cyber-grid'",
        "animateGrid",
        "node-hashrate-val",
      ],
    },
    {
      sector: "VIRAL_MEME",
      ticker: "MEMEDGEN",
      name: "Meme Degen Flywheel",
      expectedHtmlElements: [
        'id="parallax-hero-card"',
        'id="jackpot-timer"',
        '10-Minute FOMO Jackpot',
        'id="buy-toast-container"',
      ],
      expectedJsSignatures: [
        "visualEffect === 'fomo-fire'",
        "animateFire",
        "initJackpotCountdown",
        "launchConfetti",
      ],
    },
  ];

  for (const tc of sectors) {
    test(`Template [${tc.sector}] should generate fully integrated bundle with distinctive HUD and canvas effects`, async () => {
      const siteDir = path.join(baseTestDir, tc.ticker.toLowerCase());
      const result = await generateTokenWebsite({
        ticker: tc.ticker,
        name: tc.name,
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        chainName: "base",
        chainId: 8453,
        customSector: tc.sector,
        siteOutputDir: siteDir,
      });

      expect(result.sector).toBe(tc.sector);
      expect(fs.existsSync(result.indexHtmlPath)).toBe(true);

      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");
      const jsPath = path.join(result.siteDirectory, "parallax-3d.js");
      const js = fs.readFileSync(jsPath, "utf-8");
      const cssPath = path.join(result.siteDirectory, "styles.css");
      const css = fs.readFileSync(cssPath, "utf-8");

      // 1. Verify Common Web3 DApp Elements
      expect(html).toContain(">ETH</span>");
      expect(html).toContain("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(html).toContain('id="swap-wallet-balance"');
      expect(html).toContain('id="wallet-guide-modal"');

      // 2. Verify Sector-Specific HTML HUD components
      for (const expectedHtml of tc.expectedHtmlElements) {
        expect(html).toContain(expectedHtml);
      }

      // 3. Verify Sector-Specific JS Canvas Effects & Handlers
      for (const expectedJs of tc.expectedJsSignatures) {
        expect(js).toContain(expectedJs);
      }

      // 4. Verify JavaScript Syntax Integrity via JS Engine (0 Syntax Errors)
      let syntaxError: Error | null = null;
      try {
        new Function(js);
      } catch (err: any) {
        syntaxError = err;
      }
      expect(syntaxError).toBeNull();

      // 5. Verify CSS Theme Palette and Structural Style Generation
      expect(css).toContain(".tilt-card");
      expect(css).toContain(".border-beam-card");
      expect(css.length).toBeGreaterThan(200);
    }, 35000);
  }

  test("Multi-Chain Deployer Binding: Robinhood, Clanker, and Solana smart contract integration", async () => {
    // 1. Robinhood Chain L2 Deployment Integration
    const robinhoodRes = await generateTokenWebsite({
      ticker: "ROBINPUMP",
      name: "Robinhood Pump Token",
      contractAddress: "0x1111111111111111111111111111111111111111",
      chainName: "robinhood",
      chainId: 4663,
      customSector: "DEFI_TREASURY",
      siteOutputDir: path.join(baseTestDir, "robinhood"),
    });
    const rhHtml = fs.readFileSync(robinhoodRes.indexHtmlPath, "utf-8");
    const rhJs = fs.readFileSync(path.join(robinhoodRes.siteDirectory, "parallax-3d.js"), "utf-8");
    expect(rhHtml).toContain("Robinhood Chain L2");
    expect(rhHtml).toContain("https://pons.fun/token/0x1111111111111111111111111111111111111111");
    expect(rhHtml).toContain("https://robinhoodchain.blockscout.com/token/0x1111111111111111111111111111111111111111");
    expect(rhJs).toContain("0x1237"); // Chain ID 4663 in hex
    expect(rhJs).toContain("https://rpc.robinhoodchain.com");

    // 2. Clanker v4 Base L2 Deployment Integration
    const clankerRes = await generateTokenWebsite({
      ticker: "CLANKAI",
      name: "Clanker AI Bot",
      contractAddress: "0x2222222222222222222222222222222222222222",
      chainName: "clanker",
      chainId: 8453,
      customSector: "AI_AGENT",
      siteOutputDir: path.join(baseTestDir, "clanker"),
    });
    const clankerHtml = fs.readFileSync(clankerRes.indexHtmlPath, "utf-8");
    const clankerJs = fs.readFileSync(path.join(clankerRes.siteDirectory, "parallax-3d.js"), "utf-8");
    expect(clankerHtml).toContain("Base L2 (Clanker v4)");
    expect(clankerHtml).toContain("https://clanker.world/clanker/0x2222222222222222222222222222222222222222");
    expect(clankerJs).toContain("0x2105");

    // 3. Solana Pump.fun Deployment Integration
    const solanaRes = await generateTokenWebsite({
      ticker: "SOLMEME",
      name: "Solana Meme Pump",
      contractAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      chainName: "solana",
      chainId: 101,
      customSector: "VIRAL_MEME",
      siteOutputDir: path.join(baseTestDir, "solana"),
    });
    const solHtml = fs.readFileSync(solanaRes.indexHtmlPath, "utf-8");
    const solJs = fs.readFileSync(path.join(solanaRes.siteDirectory, "parallax-3d.js"), "utf-8");
    expect(solHtml).toContain("Solana Mainnet");
    expect(solHtml).toContain(">SOL</span>");
    expect(solHtml).toContain("https://pump.fun/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    expect(solHtml).toContain("https://solscan.io/token/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
    expect(solJs).toContain("window.solana");
  }, 35000);
});
