/**
 * tests/website-generator.test.ts
 *
 * Automated test suite for the Web3 Website Generator & 3D Parallax Orchestrator.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  detectSector,
  getSectorTheme,
  CURATED_GITHUB_TEMPLATES,
} from "../src/modules/growth/template-registry.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";

describe("Web3 Website Generator & Template Registry Suite", () => {
  const testOutputDir = path.resolve(process.cwd(), "sites", "test_unit_token");

  afterAll(() => {
    // Clean up test directory
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe("1. Sector Classification & Template Registry", () => {
    it("should classify AI-related tokens into AI_AGENT", () => {
      expect(detectSector("Intelena", "INTEL", "Autonomous AI intelligence agent")).toBe("AI_AGENT");
      expect(detectSector("ClankBot", "CLANK", "On-chain neural agent")).toBe("AI_AGENT");
      expect(detectSector("Cortex Matrix", "CRTX", "")).toBe("AI_AGENT");
    });

    it("should classify DeFi and Treasury tokens into DEFI_TREASURY", () => {
      expect(detectSector("Treasury Yield", "YIELD", "Autonomous 30% buyback vault")).toBe("DEFI_TREASURY");
      expect(detectSector("Bank Cash", "CASH", "Decentralized liquidity")).toBe("DEFI_TREASURY");
    });

    it("should classify Gaming and DePIN tokens into GAMING_UTILITY", () => {
      expect(detectSector("DePIN Node", "NODE", "Decentralized hardware compute")).toBe("GAMING_UTILITY");
      expect(detectSector("Meta Arcade", "PLAY", "Web3 gaming token")).toBe("GAMING_UTILITY");
    });

    it("should default community tokens into VIRAL_MEME", () => {
      expect(detectSector("Pepe Rocket", "PEPE", "Community flywheel moonshot")).toBe("VIRAL_MEME");
      expect(detectSector("Doge Fun", "DOGE", "Degen pump coin")).toBe("VIRAL_MEME");
    });

    it("should provide valid themes and curated GitHub repositories for all sectors", () => {
      const sectors = ["AI_AGENT", "DEFI_TREASURY", "VIRAL_MEME", "GAMING_UTILITY"] as const;
      for (const s of sectors) {
        const theme = getSectorTheme(s);
        expect(theme.primaryColor).toBeDefined();
        expect(theme.curatedTemplate).toBeDefined();
        expect(theme.curatedTemplate.repoUrl).toContain("github.com");
        expect(theme.curatedTemplate.stars).toBeGreaterThan(100);
      }
    });
  });

  describe("2. Website Bundle Generation & 3D Parallax Synthesis", () => {
    const testMemeDir = path.resolve(process.cwd(), "sites", "test_unit_meme");

    afterAll(() => {
      if (fs.existsSync(testMemeDir)) {
        fs.rmSync(testMemeDir, { recursive: true, force: true });
      }
    });

    it("should generate a complete AI_AGENT website with Cyber Terminal Sandbox and without buy toast", async () => {
      const mockCA = "0x1234567890abcdef1234567890abcdef12345678";
      const result = await generateTokenWebsite({
        name: "Test Clank Protocol",
        ticker: "TCLANK",
        contractAddress: mockCA,
        chainId: 8453,
        chainName: "base",
        description: "Autonomous AI Agent with 0% tax and 30% perpetual buyback.",
        outputDir: testOutputDir,
      });

      expect(result.ticker).toBe("TCLANK");
      expect(result.siteDirectory).toBe(testOutputDir);
      expect(fs.existsSync(result.indexHtmlPath)).toBe(true);
      expect(fs.existsSync(result.envProductionPath)).toBe(true);
      expect(fs.existsSync(result.ciCdWorkflowPath)).toBe(true);

      // Verify index.html content
      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");
      expect(html).toContain("TCLANK");
      expect(html).toContain("Test Clank Protocol");
      expect(html).toContain(mockCA);
      expect(html.toUpperCase()).toContain("0% BUY / 0% SELL TAX");
      expect(html).toContain("Auto Buyback & Burn");
      expect(html).toContain("30%");
      expect(html).toContain("bg-canvas");
      expect(html).toContain("tilt-card");
      expect(html).toContain("dexscreener.com");

      // Sector-Adaptive AI Agent elements:
      expect(html).toContain('id="terminal-sandbox"');
      expect(html).toContain("agent@tclank:~$");
      expect(html).toContain("marquee-track");
      expect(html).toContain("border-beam-card");
      expect(html).toContain("JetBrains+Mono");
      expect(html).toContain('id="download-banner-btn"');
      // Web3 Interactive CTAs & CA Actions:
      expect(html).toContain('id="connect-wallet-btn"');
      expect(html).toContain('id="add-token-btn"');
      expect(html).toContain("Add to Wallet");
      expect(html).toContain('id="security-audit"');
      expect(html).toContain("Contract Security & Audit Report");
      // Should NOT have buy toast container in AI Agent theme
      expect(html).not.toContain('id="buy-toast-container"');

      // Verify styles.css
      const cssPath = path.join(testOutputDir, "styles.css");
      expect(fs.existsSync(cssPath)).toBe(true);
      const css = fs.readFileSync(cssPath, "utf-8");
      expect(css).toContain("tilt-card");
      expect(css).toContain("transform-style: preserve-3d");
      expect(css).toContain("spin-beam");
      expect(css).toContain("marquee-scroll");

      // Verify parallax-3d.js
      const jsPath = path.join(testOutputDir, "parallax-3d.js");
      expect(fs.existsSync(jsPath)).toBe(true);
      const js = fs.readFileSync(jsPath, "utf-8");
      expect(js).toContain("initCanvas");
      expect(js).toContain("init3DTilt");
      expect(js).toContain("initCopyCa");
      expect(js).toContain("initWalletConnect");
      expect(js).toContain("initAddTokenToWallet");
      expect(js).toContain("wallet_watchAsset");
      expect(js).toContain("initTerminal");
      expect(js).toContain("launchConfetti");
      expect(js).toContain("telemetryPool");
      expect(js).toContain("initMediaKitDownload");
      expect(js).toContain("download-banner-btn");

      // Verify token.config.json
      const configPath = path.join(testOutputDir, "token.config.json");
      expect(fs.existsSync(configPath)).toBe(true);
      const configJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(configJson.ticker).toBe("TCLANK");
      expect(configJson.contractAddress).toBe(mockCA);
      expect(configJson.security.isSafe).toBe(true);

      // Verify .env.production
      const envContent = fs.readFileSync(result.envProductionPath, "utf-8");
      expect(envContent).toContain(`NEXT_PUBLIC_CONTRACT_ADDRESS="${mockCA}"`);
      expect(envContent).toContain(`NEXT_PUBLIC_TOKEN_TICKER="TCLANK"`);

      // Verify .github/workflows/deploy.yml
      const workflowContent = fs.readFileSync(result.ciCdWorkflowPath, "utf-8");
      expect(workflowContent).toContain("amondnet/vercel-action@v25");
    });

    it("should generate a VIRAL_MEME website with Live Buy Toast container and FOMO card", async () => {
      const memeCA = "0x9999999999999999999999999999999999999999";
      const result = await generateTokenWebsite({
        name: "Doge Pump Moon",
        ticker: "DPUMP",
        contractAddress: memeCA,
        chainId: 8453,
        chainName: "base",
        description: "Pure community meme token to the moon with jackpot.",
        customSector: "VIRAL_MEME",
        outputDir: testMemeDir,
      });

      expect(fs.existsSync(result.indexHtmlPath)).toBe(true);
      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");

      // Sector-Adaptive Meme elements:
      expect(html).toContain('id="buy-toast-container"');
      expect(html).toContain('id="parallax-hero-card"');
      expect(html).toContain('id="jackpot-timer"');
      // Should NOT have terminal sandbox in Meme theme
      expect(html).not.toContain('id="terminal-sandbox"');

      // Verify JS has buy toast engine
      const jsPath = path.join(testMemeDir, "parallax-3d.js");
      const js = fs.readFileSync(jsPath, "utf-8");
      expect(js).toContain("initBuyToasts");
      expect(js).toContain("buy-toast");
    });

    const testDefiDir = path.resolve(process.cwd(), "sites", "test_unit_defi");
    const testGamingDir = path.resolve(process.cwd(), "sites", "test_unit_gaming");

    afterAll(() => {
      if (fs.existsSync(testDefiDir)) fs.rmSync(testDefiDir, { recursive: true, force: true });
      if (fs.existsSync(testGamingDir)) fs.rmSync(testGamingDir, { recursive: true, force: true });
    });

    it("should generate a DEFI_TREASURY website with Treasury Flywheel HUD and APR calculator", async () => {
      const defiCA = "0x7777777777777777777777777777777777777777";
      const result = await generateTokenWebsite({
        name: "Perpetual Yield Vault",
        ticker: "PYIELD",
        contractAddress: defiCA,
        chainId: 8453,
        chainName: "base",
        description: "Autonomous 30% buyback and 20% passive WETH dividends.",
        customSector: "DEFI_TREASURY",
        outputDir: testDefiDir,
      });

      expect(fs.existsSync(result.indexHtmlPath)).toBe(true);
      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");

      // Sector-Adaptive DeFi elements:
      expect(html).toContain('id="treasury-hud"');
      expect(html).toContain('id="treasury-reserve-val"');
      expect(html).toContain('id="burn-counter-val"');
      expect(html).toContain('id="treasury-slider"');
      expect(html).toContain('id="calc-dividend-val"');
      // Should NOT have terminal sandbox or retail buy toast
      expect(html).not.toContain('id="terminal-sandbox"');
      expect(html).not.toContain('id="buy-toast-container"');

      // Verify JS has treasury HUD engine and live market poller
      const jsPath = path.join(testDefiDir, "parallax-3d.js");
      const js = fs.readFileSync(jsPath, "utf-8");
      expect(js).toContain("initTreasuryHUD");
      expect(js).toContain("initLiveMarketData");
    });

    it("should generate a GAMING_UTILITY website with Cyber Node Power HUD and hashrate telemetry", async () => {
      const gamingCA = "0x6666666666666666666666666666666666666666";
      const result = await generateTokenWebsite({
        name: "Cyber DePIN Protocol",
        ticker: "NODE",
        contractAddress: gamingCA,
        chainId: 8453,
        chainName: "base",
        description: "Decentralized physical compute nodes and gaming micro-rewards.",
        customSector: "GAMING_UTILITY",
        outputDir: testGamingDir,
      });

      expect(fs.existsSync(result.indexHtmlPath)).toBe(true);
      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");

      // Sector-Adaptive Gaming/DePIN elements:
      expect(html).toContain('id="node-power-hud"');
      expect(html).toContain('id="node-hashrate-val"');
      expect(html).toContain('id="node-load-bar"');
      expect(html).toContain("NODE CLUSTER SYNCED");
      // Should NOT have terminal sandbox or retail buy toast
      expect(html).not.toContain('id="terminal-sandbox"');
      expect(html).not.toContain('id="buy-toast-container"');

      // Verify JS has node HUD engine
      const jsPath = path.join(testGamingDir, "parallax-3d.js");
      const js = fs.readFileSync(jsPath, "utf-8");
      expect(js).toContain("initNodeHUD");
      expect(js).toContain("initLiveMarketData");
    });
  });

  describe("3. UI/UX Pro Max Modular Layout Archetypes Diversity", () => {
    const testBentoDir = path.resolve(process.cwd(), "sites", "test_unit_bento");
    const testCyberDir = path.resolve(process.cwd(), "sites", "test_unit_cyber");

    afterAll(() => {
      if (fs.existsSync(testBentoDir)) fs.rmSync(testBentoDir, { recursive: true, force: true });
      if (fs.existsSync(testCyberDir)) fs.rmSync(testCyberDir, { recursive: true, force: true });
    });

    it("should generate a BENTO_GRID_DAPP layout placing Chart and Swap Widget side-by-side above the fold", async () => {
      const result = await generateTokenWebsite({
        name: "Pump Run DApp",
        ticker: "PUMPRUN",
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        chainId: 8453,
        chainName: "base",
        description: "Decentralized AMM trading runner on Base L2.",
        customSector: "DEFI_TREASURY",
        themeStyle: "BENTO_GRID_DAPP",
        outputDir: testBentoDir,
      });

      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");
      expect(html).toContain("bento-grid-dapp");
      expect(html).toContain('id="swap"');
      expect(html).toContain('id="chart"');
      // In Bento Grid DApp, chart and swap appear in the top hero grid
      expect(html).toContain("bento-hero-grid");
    });

    it("should generate a CYBER_TERMINAL_HUD layout featuring split-screen CLI sandbox", async () => {
      const result = await generateTokenWebsite({
        name: "Matrix Agent Core",
        ticker: "AGENTAI",
        contractAddress: "0x3d04B377AEcFC89Eb2963849197164565145CeD7",
        chainId: 8453,
        chainName: "base",
        description: "Autonomous LLM Swarm on Base L2.",
        customSector: "AI_AGENT",
        themeStyle: "CYBER_TERMINAL_HUD",
        outputDir: testCyberDir,
      });

      const html = fs.readFileSync(result.indexHtmlPath, "utf-8");
      expect(html).toContain("cyber-terminal-hud");
      expect(html).toContain('id="terminal-sandbox"');
      expect(html).toContain('id="swap"');
    });
  });
});
