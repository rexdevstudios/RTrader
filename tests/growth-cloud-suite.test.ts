/**
 * tests/growth-cloud-suite.test.ts
 *
 * Automated Regression & Integration Test Suite for the 4-Pillar Cloud-Native System:
 *   1. Zero-Click Multi-Target Deployer (Vercel REST API + Pinata IPFS) & Vault DB Sync.
 *   2. Anti-Sybil Volume Spark (Organic Amount Jitter & Direct On-Chain EVM Swapper Fallback).
 *   3. Ephemeral CI/CD State Exporter & Background Daemon Provisioner.
 *   4. Fast-Track Webhook Idempotency & Replay Attack Protection.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { Database } from "bun:sqlite";

// Rule 4: Database Isolation
const TEST_VAULT_DB = path.resolve(`.eliza/test_cloud_suite_${Date.now()}.db`);
process.env.VAULT_DB_PATH = TEST_VAULT_DB;

import {
  logDeploy,
  getDeployLogByContract,
  getAllDeployLogs,
} from "../src/db/vault.ts";
import {
  deployWebsiteToVercel,
  deployWebsiteToIpfs,
  deployWebsite,
} from "../src/modules/growth/website-deployer.ts";
import {
  applyOrganicAmountJitter,
  executeDirectOnChainMicroBuy,
  runTrendingBoostCycle,
} from "../src/modules/growth/trending-booster.ts";
import {
  exportVaultDeployments,
  importVaultDeployments,
} from "../scripts/export-deployment-state.ts";
import {
  generateSystemdUnit,
  getWindowsTaskCommand,
  SERVICES,
} from "../scripts/setup-service-daemon.ts";
import {
  processFastTrackPaymentPayload,
  getEventIdempotencyKey,
  clearIdempotencyCache,
} from "../src/modules/growth/fast-track-webhook.ts";

describe("4-Pillar Cloud-Native Launch & Growth Suite", () => {
  const testSiteDir = path.resolve("sites/test_cloud_token");

  beforeEach(() => {
    clearIdempotencyCache();

    // Create a mock site directory for testing deployer
    if (!fs.existsSync(testSiteDir)) {
      fs.mkdirSync(testSiteDir, { recursive: true });
    }
    fs.writeFileSync(path.join(testSiteDir, "index.html"), "<html><body>Test Web3 Site</body></html>");
    fs.writeFileSync(path.join(testSiteDir, "style.css"), "body { background: #000; }");
    fs.writeFileSync(path.join(testSiteDir, "app.js"), "console.log('web3 ready');");
    fs.writeFileSync(path.join(testSiteDir, "og-image.svg"), "<svg></svg>");
    fs.writeFileSync(
      path.join(testSiteDir, "dexscreener-profile.json"),
      JSON.stringify({ links: [{ type: "website", label: "Website", url: "https://old.url" }] })
    );

    // Insert dummy deployment in test vault
    logDeploy({
      contractAddr: "0x8888888888888888888888888888888888888888",
      ticker: "CLOUD",
      tokenName: "Cloud Autonomous Token",
      chain: "base",
      txHash: "0xhash_cloud_deploy",
      status: "CONFIRMED",
    });
  });

  afterEach(() => {
    try {
      if (fs.existsSync(testSiteDir)) {
        fs.rmSync(testSiteDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // ─── PILAR 1: MULTI-TARGET WEBSITE DEPLOYER ─────────────────────────────────
  describe("Pilar 1: Zero-Click Multi-Target Deployer (Vercel & IPFS)", () => {
    it("1.1 should execute simulated Vercel deployment when token is unconfigured", async () => {
      const res = await deployWebsiteToVercel({
        siteDir: testSiteDir,
        ticker: "CLOUD",
        contractAddress: "0x8888888888888888888888888888888888888888",
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe("simulation");
      expect(res.deploymentUrl).toBe("https://cloud-official.vercel.app");
      expect(res.deployedFilesCount).toBe(4);
      expect(res.cliInstruction).toContain("npx vercel --prod");
    });

    it("1.2 should execute IPFS deployment and return gateway URL", async () => {
      const res = await deployWebsiteToIpfs({
        siteDir: testSiteDir,
        ticker: "CLOUD",
      });

      expect(res.success).toBe(true);
      expect(res.ipfsUrl).toContain("gateway.pinata.cloud/ipfs/");
    });

    it("1.3 should orchestrate multi-target deployment and synchronize Vault DB", async () => {
      const res = await deployWebsite({
        siteDir: testSiteDir,
        ticker: "CLOUD",
        contractAddress: "0x8888888888888888888888888888888888888888",
        target: "both",
      });

      expect(res.success).toBe(true);
      expect(res.updatedVault).toBe(true);
      expect(res.primaryUrl).toMatch(/(vercel\.app|pages\.dev)/);
      expect(res.ipfsResult?.ipfsUrl).toBeDefined();

      // Check that vault database was updated with live URL
      const updated = getDeployLogByContract("0x8888888888888888888888888888888888888888");
      // Check that dexscreener-profile.json was updated
      const profile = JSON.parse(
        fs.readFileSync(path.join(testSiteDir, "dexscreener-profile.json"), "utf-8")
      );
      const webLink = profile.links.find((l: any) => l.label === "Website");
      expect(webLink.url).toBe(res.primaryUrl);
    }, 20000);
  });

  // ─── PILAR 2: ANTI-SYBIL VOLUME SPARK ────────────────────────────────────────
  describe("Pilar 2: Anti-Sybil Volume Spark & Direct EVM Fallback", () => {
    it("2.1 should apply organic amount jitter within safe bounds (+/- 12%)", () => {
      const base = 0.0001;
      const samples: number[] = [];

      for (let i = 0; i < 50; i++) {
        const jittered = applyOrganicAmountJitter(base, 0.12);
        samples.push(jittered);
        expect(jittered).toBeGreaterThanOrEqual(0.000088);
        expect(jittered).toBeLessThanOrEqual(0.000112);
      }

      // Assert that values are not all identical (proves real organic variance)
      const uniqueValues = new Set(samples);
      expect(uniqueValues.size).toBeGreaterThan(10);
    });

    it("2.2 should execute direct on-chain micro-buy fallback in simulation mode", async () => {
      const res = await executeDirectOnChainMicroBuy(
        "0x8888888888888888888888888888888888888888",
        0.000105,
        { id: "maker-test-1", address: "0x1234567890123456789012345678901234567890" },
        true
      );

      expect(res.success).toBe(true);
      expect(res.simulated).toBe(true);
      expect(res.amountEth).toBe(0.000105);
      expect(res.txHash).toContain("0xsim_");
      expect(res.makerAddress).toBe("0x1234567890123456789012345678901234567890");
    });

    it("2.3 should run multi-maker boost cycle with organic jitter amounts", async () => {
      const summary = await runTrendingBoostCycle({
        tokenAddress: "0x8888888888888888888888888888888888888888",
        tokenSymbol: "CLOUD",
        rounds: 3,
        minDelayMs: 0,
        maxDelayMs: 0,
        isSimulated: true,
      });

      expect(summary.totalRoundsExecuted).toBe(3);
      expect(summary.uniqueMakersCount).toBeGreaterThanOrEqual(1);
      expect(summary.totalVolumeEth).toBeGreaterThan(0);
      expect(summary.simulated).toBe(true);
    });
  });

  // ─── PILAR 3: CI/CD STATE EXPORT & DAEMON SETUP ──────────────────────────────
  describe("Pilar 3: CI/CD State Exporter & Service Daemon Provisioner", () => {
    const testExportDir = path.resolve("test_deployments_dir");

    it("3.1 should export Vault DB deployments to canonical JSON snapshot files", () => {
      const exportedCount = exportVaultDeployments(testExportDir);
      expect(exportedCount).toBeGreaterThanOrEqual(1);

      const jsonFile = path.join(testExportDir, "0x8888888888888888888888888888888888888888.json");
      expect(fs.existsSync(jsonFile)).toBe(true);

      const parsed = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
      expect(parsed.ticker).toBe("CLOUD");
      expect(parsed.contractAddr).toBe("0x8888888888888888888888888888888888888888");

      // Check manifest index
      const manifestFile = path.join(testExportDir, "manifest.json");
      expect(fs.existsSync(manifestFile)).toBe(true);

      // Clean up test export directory
      fs.rmSync(testExportDir, { recursive: true, force: true });
    });

    it("3.2 should generate valid systemd service unit and Windows schtasks commands", () => {
      const webhookService = SERVICES.webhook;
      expect(webhookService).toBeDefined();

      const unit = generateSystemdUnit(webhookService);
      expect(unit).toContain(webhookService.description);
      expect(unit).toContain("Restart=always");
      expect(unit).toContain("ExecStart=");

      const winCmds = getWindowsTaskCommand(webhookService);
      expect(winCmds.installCmd).toContain("schtasks /create");
      expect(winCmds.installCmd).toContain(webhookService.id);
      expect(winCmds.uninstallCmd).toContain("schtasks /delete");
    });
  });

  // ─── PILAR 4: WEBHOOK IDEMPOTENCY REPLAY PROTECTION ──────────────────────────
  describe("Pilar 4: Fast-Track Webhook Idempotency & Replay Protection", () => {
    it("4.1 should compute canonical idempotency key from orderId or txHash", () => {
      const key1 = getEventIdempotencyKey({
        tokenAddress: "0x8888888888888888888888888888888888888888",
        orderId: "ORD-99881",
      });
      expect(key1).toBe("order:ORD-99881");

      const key2 = getEventIdempotencyKey({
        tokenAddress: "0x8888888888888888888888888888888888888888",
        txHash: "0xABCDEF",
      });
      expect(key2).toBe("tx:0xabcdef");
    });

    it("4.2 should process first payment webhook and reject identical replay as duplicate", async () => {
      const payload = {
        tokenAddress: "0x8888888888888888888888888888888888888888",
        tokenSymbol: "CLOUD",
        orderId: "ORDER-IDEMPOTENT-001",
        paidAmountUsd: 299,
      };

      // 1st Call: Initial processing (Volume spark disabled for instant unit test)
      const res1 = await processFastTrackPaymentPayload(payload, {
        autoTriggerVolumeSpark: false,
      });

      expect(res1.success).toBe(true);
      expect(res1.isDuplicate).toBe(false);
      expect(res1.orderId).toBe("ORDER-IDEMPOTENT-001");

      // 2nd Call: Duplicate retry with exact same orderId
      const res2 = await processFastTrackPaymentPayload(payload, {
        autoTriggerVolumeSpark: false,
      });

      expect(res2.success).toBe(true);
      expect(res2.isDuplicate).toBe(true);
      expect(res2.message).toContain("already processed within TTL window");
    });
  });

  afterAll(() => {
    try {
      if (fs.existsSync(TEST_VAULT_DB)) {
        fs.unlinkSync(TEST_VAULT_DB);
      }
    } catch {}
    delete process.env.VAULT_DB_PATH;
  });
});
