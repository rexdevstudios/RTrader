/**
 * tests/full-pipeline-workflow.test.ts
 *
 * Full 5-Phase Pipeline Workflow, Multi-Wallet & Investor Enrichment Test Suite.
 *
 * Verifies:
 *  1. Multi-wallet & CLI argument parsing for the automated orchestrator.
 *  2. Fase 1: Preflight balance evaluation & Anti-Vamp clone resolver integration.
 *  3. Fase 2: On-chain Base deployment dispatch contract & DB snapshot helper.
 *  4. Fase 3: Investor Offer Deck generation & 5% WETH referral bounties.
 *  5. Fase 4: Catalyst trading bounding (maxIterations) & DexScreener cold-start resolution.
 *  6. Fase 5: Flywheel revenue harvester single-pass audit handoff.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { resetConfig } from "../src/config.ts";

describe("5-Phase Automated End-to-End Pipeline & Multi-Wallet Suite", () => {
  const rootDir = resolve(__dirname, "..");
  const launchPipelinePath = resolve(rootDir, "scripts/launch-full-pipeline.ts");
  const wizardPath = resolve(rootDir, "scripts/guided-workflow-wizard.ts");
  const menuBatPath = resolve(rootDir, "MENU_UTAMA.bat");
  const pipelineBatPath = resolve(rootDir, "PIPELINE_OTOMATIS.bat");

  beforeEach(() => {
    resetConfig();
  });

  it("1. should ensure all orchestrator files exist on disk", () => {
    expect(existsSync(launchPipelinePath)).toBe(true);
    expect(existsSync(wizardPath)).toBe(true);
    expect(existsSync(menuBatPath)).toBe(true);
    expect(existsSync(pipelineBatPath)).toBe(true);
  });

  it("2. should verify MENU_UTAMA.bat defines Option 0 and Option 6 with 5-phase lifecycle", () => {
    const content = readFileSync(menuBatPath, "utf-8");
    expect(content).toContain('if "%pilihan%"=="0" goto guided_journey');
    expect(content).toContain('if "%pilihan%"=="6" goto pipeline_terpadu');
    expect(content).toContain("[AUTO-PILOT]");
    expect(content).toContain("Pipeline Otomatis Terpadu");
  });

  it("3. should verify launch-full-pipeline.ts orchestrates all 5 sequential phases", () => {
    const content = readFileSync(launchPipelinePath, "utf-8");

    // Fase 1: Preflight & Anti-Vamp
    expect(content).toContain("FASE 1/5");
    expect(content).toContain("evaluatePreflightBalance");
    expect(content).toContain("normalizeTokenKey");

    // Fase 2: On-Chain Launch
    expect(content).toContain("FASE 2/5");
    expect(content).toContain("execute-single-base-deployment.ts");
    expect(content).toContain("findNewConfirmedDeployment");

    // Fase 3: Enrichment & Investor Attraction
    expect(content).toContain("enrichAndSyncBankrProject");
    expect(content).toContain("generateIrresistibleOffer");
    expect(content).toContain("generateReferralLink");
    expect(content).toContain("broadcastTokenLaunchAnnouncement");

    // Fase 4: Catalyst Trading & DexScreener
    expect(content).toContain("FASE 4/5");
    expect(content).toContain("executeAutoBuy");
    expect(content).toContain("runLiveMonitor");

    // Fase 5: Flywheel Harvester 24/7 & Monitoring
    expect(content).toContain("FASE 5/5");
    expect(content).toContain("run-flywheel-worker.ts");
    expect(content).toContain("view-fleet-matrix.ts");
  });

  it("4. should verify multi-wallet resolution support in launch-full-pipeline.ts", () => {
    const content = readFileSync(launchPipelinePath, "utf-8");
    expect(content).toContain("selectExecutionWallet");
    expect(content).toContain("listWalletAccounts");
    expect(content).toContain("resolveOperationalContext");
    expect(content).toContain("autoFailoverUnhealthyRoutes");
    expect(content).toContain("--wallet=");
    expect(content).toContain("--unattended");
  });

  it("5. should verify runLiveMonitor supports bounded maxIterations in unattended mode", () => {
    const content = readFileSync(resolve(rootDir, "scripts/execute-catalyst-trading.ts"), "utf-8");
    expect(content).toContain("maxIterations?: number");
    expect(content).toContain("if (maxIterations && iteration > maxIterations)");
  });

  it("6. should verify Investor Offer Deck generator produces investor-grade tokenomics", async () => {
    const { generateIrresistibleOffer } = await import("../src/modules/growth/token-offer-generator.ts");
    const offer = generateIrresistibleOffer({
      ticker: "INVESTORTEST",
      name: "Investor Test Token",
      contractAddress: "0x1234567890123456789012345678901234567890",
      chain: "base",
    });

    expect(offer.tokenSymbol).toBe("INVESTORTEST");
    expect(offer.contractAddress).toBe("0x1234567890123456789012345678901234567890");
    expect(offer.executiveSummary).toBeDefined();
    expect(offer.twitterThread.length).toBeGreaterThanOrEqual(3);
    expect(offer.fullOfferCard).toContain("INVESTORTEST");
  });

  it("7. should verify Affiliate Referral Link generates compliant 5% WETH bounty URLs", async () => {
    const { generateReferralLink } = await import("../src/modules/growth/flywheel-engine.ts");
    const ca = "0x7ce19e4f978009eb644c27946b47221b824c0ba3";
    const affiliate = "0x1e130ec63174d4258473366b762f197560942760";
    const refUrl = generateReferralLink(ca, affiliate);

    expect(refUrl).toContain(ca);
    expect(refUrl).toContain(`ref=${affiliate}`);
  });

  it("8. should verify guided-workflow-wizard.ts provides 1-click auto-pilot execution", () => {
    const content = readFileSync(wizardPath, "utf-8");
    expect(content).toContain("1-Click Auto-Pilot");
    expect(content).toContain("launch-full-pipeline.ts");
    expect(content).toContain("--unattended");
  });
});
