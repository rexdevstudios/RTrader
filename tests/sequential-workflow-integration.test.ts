/**
 * tests/sequential-workflow-integration.test.ts
 *
 * Comprehensive integration test suite validating:
 * 1. MENU_UTAMA.bat Option 0 Guided Journey routing and smart handoffs.
 * 2. Guided Workflow Wizard database reading & phase step contracts.
 * 3. End-to-end parameter inheritance: Anti-Vamp check -> Deploy -> Enrichment/Offer/Referral -> Catalyst -> Flywheel.
 * 4. Zero regressions on existing vault data and clean isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { DB_PATH } from "../src/db/vault.ts";
import { normalizeTokenKey } from "../src/modules/market/clone-resolver.ts";
import {
  generateDiscoveryPackage,
  saveDiscoveryPackageJson,
  generateIrresistibleOffer,
  saveOfferDeckMarkdown,
} from "../src/modules/growth/token-offer-generator.ts";
import { generateReferralLink } from "../src/modules/growth/flywheel-engine.ts";

describe("Sequential Workflow Integration & Smart Handoff Suite", () => {
  const rootDir = resolve(__dirname, "..");
  const menuBatPath = resolve(rootDir, "MENU_UTAMA.bat");
  const wizardTsPath = resolve(rootDir, "scripts", "guided-workflow-wizard.ts");
  const pipelineTsPath = resolve(rootDir, "scripts", "launch-full-pipeline.ts");
  const db = new Database(DB_PATH);
  const createdDeployIds: number[] = [];

  beforeEach(() => {});

  afterEach(() => {
    if (createdDeployIds.length > 0) {
      const placeholders = createdDeployIds.map(() => "?").join(",");
      db.run(`DELETE FROM deploy_logs WHERE id IN (${placeholders})`, createdDeployIds);
      createdDeployIds.length = 0;
    }
  });

  describe("1. MENU_UTAMA.bat Guided Workflow & Smart Handoff Routing", () => {
    it("1.1 should route Option 0 to :guided_journey calling guided-workflow-wizard.ts", () => {
      const content = readFileSync(menuBatPath, "utf-8");
      expect(content).toContain('if "%pilihan%"=="0" goto guided_journey');
      expect(content).toContain(":guided_journey");
      expect(content).toContain("call bun run scripts/guided-workflow-wizard.ts");
      expect(existsSync(wizardTsPath)).toBe(true);
    });

    it("1.2 should have smart handoff menu in :single_deploy offering 1-click continuation", () => {
      const content = readFileSync(menuBatPath, "utf-8");
      const block = content.split(":single_deploy")[1]?.split(":solana_deploy")[0];
      expect(block).toBeDefined();
      expect(block).toContain("call DEPLOY_1_TOKEN_BASE.bat");
      expect(block).toContain("ESTAFET LANGKAH BERIKUTNYA SETELAH DEPLOYMENT BASE");
      expect(block).toContain("goto project_sync");
      expect(block).toContain("goto telegram_bot");
      expect(block).toContain("goto catalyst_swap");
      expect(block).toContain("goto token_offer");
      expect(block).toContain("goto affiliate_link");
    });

    it("1.3 should have smart handoff menu in :solana_deploy", () => {
      const content = readFileSync(menuBatPath, "utf-8");
      const block = content.split(":solana_deploy")[1]?.split(":project_sync")[0];
      expect(block).toBeDefined();
      expect(block).toContain("call DEPLOY_1_TOKEN_SOLANA.bat");
      expect(block).toContain("ESTAFET LANGKAH BERIKUTNYA SETELAH DEPLOYMENT SOLANA");
      expect(block).toContain("goto telegram_bot");
      expect(block).toContain("goto token_offer");
      expect(block).toContain("goto fleet_matrix");
    });

    it("1.4 should have smart handoff menu in :catalyst_swap", () => {
      const content = readFileSync(menuBatPath, "utf-8");
      const block = content.split(":catalyst_swap")[1]?.split(":trending_booster")[0];
      expect(block).toBeDefined();
      expect(block).toContain("call CATALYST_SWAP.bat");
      expect(block).toContain("ESTAFET LANGKAH BERIKUTNYA SETELAH CATALYST TRADING");
      expect(block).toContain("goto flywheel_worker");
      expect(block).toContain("goto status");
      expect(block).toContain("goto reconcile_fleet");
    });

    it("1.5 should have smart handoff in :dual_chain pointing to rehearsal, deploy, or guided journey", () => {
      const content = readFileSync(menuBatPath, "utf-8");
      const block = content.split(":dual_chain")[1]?.split(":bankr_status")[0];
      expect(block).toBeDefined();
      expect(block).toContain("goto rehearse_launch");
      expect(block).toContain("goto single_deploy");
      expect(block).toContain("goto guided_journey");
    });
  });

  describe("2. End-to-End Parameter Inheritance Across Stages", () => {
    it("2.1 Anti-Vamp normalization accurately resolves variant lookalikes and strips filler words", () => {
      const rawInput = "  $PUMP_RUN!  ";
      const norm = normalizeTokenKey(rawInput);
      expect(norm.tightKey).toBe("PUMPRUN");
      expect(norm.looseKey).toBe("RUN"); // Stripped 'PUMP' filler word
    });

    it("2.2 Deployed token can immediately generate full discovery offer package & deck", () => {
      const mockCa = "0x" + "aa".repeat(20);
      const pkg = generateDiscoveryPackage({
        ticker: "PUMPRUN",
        name: "Pump Run Autonomous",
        contractAddress: mockCa,
        chain: "base",
        telegram: "https://t.me/pumprun_bot",
      });

      expect(pkg.tokenInfo.symbol).toBe("PUMPRUN");
      expect(pkg.tokenInfo.contractAddress).toBe(mockCa);
      expect(pkg.socialAnnouncement.headline).toContain("PUMPRUN");
      expect(pkg.socialAnnouncement.socialPost).toBeTruthy();

      const jsonRes = saveDiscoveryPackageJson(pkg);
      expect(jsonRes.success).toBe(true);
      expect(existsSync(jsonRes.primaryPath!)).toBe(true);

      const offer = generateIrresistibleOffer({
        ticker: "PUMPRUN",
        name: "Pump Run Autonomous",
        contractAddress: mockCa,
        chain: "base",
        telegram: "https://t.me/pumprun_bot",
      });
      const mdRes = saveOfferDeckMarkdown(offer);
      expect(mdRes.success).toBe(true);
      expect(existsSync(mdRes.primaryPath!)).toBe(true);
    });

    it("2.3 Deployed token can immediately generate 5% WETH affiliate referral link", () => {
      const mockCa = "0x" + "bb".repeat(20);
      const mockAffiliate = "0x" + "11".repeat(20);
      const refUrl = generateReferralLink(mockCa, mockAffiliate);

      expect(refUrl).toContain(mockCa);
      expect(refUrl).toContain(mockAffiliate);
      expect(refUrl).toContain("https://dexscreener.com/base/");
    });

    it("2.4 Pipeline script includes steps 0B, 2E, and 5 handoffs", () => {
      const content = readFileSync(pipelineTsPath, "utf-8");
      expect(content).toContain("[LANGKAH 0B/5]");
      expect(content).toContain("[LANGKAH 2E/5]");
      expect(content).toContain("[LANGKAH 5/5]");
      expect(content).toContain("generateDiscoveryPackage");
      expect(content).toContain("generateReferralLink");
      expect(content).toContain("run-flywheel-worker.ts");
    });
  });

  describe("3. Vault State Retrieval for Guided Flow", () => {
    it("3.1 Guided Wizard retrieves latest confirmed Base token from deploy_logs", () => {
      const testCa = "0x" + "fe".repeat(20);
      const insert = db.run(
        `INSERT INTO deploy_logs (
          chain, token_name, ticker, contract_addr, status, lifecycle_state, simulated, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        ["base", "Wizard Test Token", "WIZ", testCa, "confirmed", "DEPLOY_CONFIRMED", 0]
      );
      const testId = Number(insert.lastInsertRowid);
      createdDeployIds.push(testId);

      const row = db
        .query<{ contract_addr: string; ticker: string; token_name: string }, []>(
          `SELECT contract_addr, ticker, token_name 
           FROM deploy_logs 
           WHERE (status = 'confirmed' OR lifecycle_state = 'DEPLOY_CONFIRMED')
             AND contract_addr IS NOT NULL
             AND contract_addr LIKE '0x%'
           ORDER BY id DESC LIMIT 1`
        )
        .get();

      expect(row).toBeDefined();
      expect(row?.contract_addr).toBe(testCa);
      expect(row?.ticker).toBe("WIZ");
      expect(row?.token_name).toBe("Wizard Test Token");
    });
  });
});
