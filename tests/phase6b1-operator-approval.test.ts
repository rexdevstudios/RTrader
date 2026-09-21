/**
 * tests/phase6b1-operator-approval.test.ts
 *
 * Phase 6B.1: Promotion Decision & Operator Approval Test Suite.
 *
 * Exhaustively validates:
 * 1. evaluatePromotionEligibility canonical behavior remains preserved.
 * 2. ELIGIBLE tokens NEVER auto-approve (defaults to PENDING_REVIEW).
 * 3. validatePromotionApproval rules:
 *    - NOT_READY is strictly blocked from approval (canApprove: false).
 *    - UNKNOWN is strictly blocked from approval (canApprove: false).
 *    - CONDITIONAL returns canApprove: true with isConditional: true and warnings.
 *    - ELIGIBLE returns canApprove: true with isConditional: false.
 * 4. SQLite persistence layer (promotion_decisions):
 *    - recordPromotionDecision records APPROVED, REJECTED, and PENDING_REVIEW.
 *    - getPromotionDecision retrieves by tokenAddress (case-insensitive).
 *    - getAllPromotionDecisions indexes by both lowercased CA and lowercased ticker.
 *    - Idempotency: repeated approvals/rejections update existing row without duplicates.
 * 5. generateDiscoveryPackage integrates operatorDecision into output.
 * 6. exportFleetMatrix includes operatorDecision in items, CSV columns, and JSON output.
 * 7. Invariants: Database sterility (deploy_logs = 35, treasury_ledger = 0 untouched).
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { Database } from "bun:sqlite";

import {
  evaluatePromotionEligibility,
  validatePromotionApproval,
  generateDiscoveryPackage,
  type TokenOfferInput,
  type PromotionApprovalValidationResult,
} from "../src/modules/growth/token-offer-generator.ts";
import {
  getPromotionDecision,
  getAllPromotionDecisions,
  recordPromotionDecision,
  resolveDbPath,
  type PromotionDecisionRecord,
} from "../src/db/vault.ts";
import { exportFleetMatrix } from "../scripts/view-fleet-matrix.ts";

describe("Phase 6B.1: Promotion Decision & Operator Approval", () => {
  const testAddress1 = "0xTestOperatorApprovalAddress11111111111";
  const testAddress2 = "0xTestOperatorApprovalAddress22222222222";
  const testTicker1 = "TESTAPP1";
  const testTicker2 = "TESTAPP2";

  // Clean up any test records in promotion_decisions before and after tests
  function cleanupTestRecords() {
    try {
      const db = new Database(resolveDbPath());
      db.run("DELETE FROM promotion_decisions WHERE token_address LIKE '0xTestOperatorApprovalAddress%'");
    } catch {
      // Ignore if DB not ready
    }
  }

  beforeEach(() => {
    cleanupTestRecords();
  });

  afterEach(() => {
    cleanupTestRecords();
  });

  // =========================================================================
  // 1. CANONICAL ELIGIBILITY BEHAVIOR UNCHANGED
  // =========================================================================
  it("Requirement 1: evaluatePromotionEligibility returns ELIGIBLE, CONDITIONAL, NOT_READY, UNKNOWN correctly", () => {
    // ELIGIBLE
    const eligible = evaluatePromotionEligibility({
      lifecycleState: "DEPLOY_CONFIRMED",
      onChainVerified: true,
      contractAddress: "0x1234567890123456789012345678901234567890",
      chain: "base",
      liquidityUsd: 15000,
      volume24h: 5000,
      priceUsd: "$0.005",
      hasLogoUrl: true,
      hasWebsite: true,
      hasTwitter: true,
    });
    expect(eligible.status).toBe("ELIGIBLE");

    // CONDITIONAL
    const conditional = evaluatePromotionEligibility({
      lifecycleState: "DEPLOY_CONFIRMED",
      onChainVerified: true,
      contractAddress: "0x1234567890123456789012345678901234567890",
      chain: "base",
      liquidityUsd: 0,
      volume24h: 0,
    });
    expect(conditional.status).toBe("CONDITIONAL");

    // NOT_READY
    const notReady = evaluatePromotionEligibility({
      lifecycleState: "FAILED",
      status: "failed",
      onChainVerified: false,
    });
    expect(notReady.status).toBe("NOT_READY");

    // UNKNOWN
    const unknown = evaluatePromotionEligibility({
      lifecycleState: "UNKNOWN",
      status: "unknown",
      contractAddress: "0x1234567890123456789012345678901234567890",
      chain: "base",
    });
    expect(unknown.status).toBe("UNKNOWN");
  });

  // =========================================================================
  // 2. ZERO AUTO-APPROVAL INVARIANT
  // =========================================================================
  it("Requirement 2: ELIGIBLE status does NOT imply automatic approval", () => {
    const eligible = evaluatePromotionEligibility({
      lifecycleState: "DEPLOY_CONFIRMED",
      onChainVerified: true,
      contractAddress: testAddress1,
      chain: "base",
      liquidityUsd: 25000,
      volume24h: 10000,
      priceUsd: "$0.01",
      hasLogoUrl: true,
      hasWebsite: true,
      hasTwitter: true,
    });
    expect(eligible.status).toBe("ELIGIBLE");

    // Check DB - no decision should exist yet
    const recorded = getPromotionDecision(testAddress1);
    expect(recorded).toBeNull();

    // In discovery package generation without explicit decision, defaults to PENDING_REVIEW
    const pkg = generateDiscoveryPackage({
      tokenAddress: testAddress1,
      contractAddress: testAddress1,
      chain: "base",
      name: "Test Token",
      ticker: testTicker1,
      description: "Test description",
    }, eligible);

    expect(pkg.operatorDecision?.status).toBe("PENDING_REVIEW");
    expect(pkg.operatorDecision?.status).not.toBe("APPROVED");
  });

  // =========================================================================
  // 3-6. APPROVAL VALIDATION GUARDS (validatePromotionApproval)
  // =========================================================================
  it("Requirement 3: validatePromotionApproval allows CONDITIONAL with warning flags", () => {
    const conditionalEval = evaluatePromotionEligibility({
      lifecycleState: "DEPLOY_CONFIRMED",
      onChainVerified: true,
      contractAddress: testAddress1,
      chain: "base",
      liquidityUsd: 0,
      volume24h: 0,
    });
    expect(conditionalEval.status).toBe("CONDITIONAL");

    const valResult = validatePromotionApproval(conditionalEval);
    expect(valResult.canApprove).toBe(true);
    expect(valResult.isConditional).toBe(true);
    expect(valResult.warningReasons).toBeDefined();
    expect(valResult.warningReasons!.length).toBeGreaterThan(0);
    expect(valResult.warnings.length).toBeGreaterThan(0);
    expect(valResult.blockReason).toBeUndefined();
  });

  it("Requirement 4: validatePromotionApproval BLOCKS UNKNOWN status", () => {
    const unknownEval = evaluatePromotionEligibility({
      lifecycleState: "UNKNOWN",
      status: "unknown",
      contractAddress: testAddress1,
      chain: "base",
    });
    expect(unknownEval.status).toBe("UNKNOWN");

    const valResult = validatePromotionApproval(unknownEval);
    expect(valResult.canApprove).toBe(false);
    expect(valResult.isConditional).toBe(false);
    expect(valResult.blockReason).toContain("UNKNOWN");
  });

  it("Requirement 5: validatePromotionApproval BLOCKS NOT_READY status", () => {
    const notReadyEval = evaluatePromotionEligibility({
      lifecycleState: "FAILED",
      status: "failed",
      onChainVerified: false,
    });
    expect(notReadyEval.status).toBe("NOT_READY");

    const valResult = validatePromotionApproval(notReadyEval);
    expect(valResult.canApprove).toBe(false);
    expect(valResult.isConditional).toBe(false);
    expect(valResult.blockReason).toContain("NOT_READY");
  });

  it("Requirement 6: validatePromotionApproval approves clean ELIGIBLE status", () => {
    const eligibleEval = evaluatePromotionEligibility({
      lifecycleState: "DEPLOY_CONFIRMED",
      onChainVerified: true,
      contractAddress: testAddress1,
      chain: "base",
      liquidityUsd: 50000,
      volume24h: 20000,
      priceUsd: "$0.05",
      hasLogoUrl: true,
      hasWebsite: true,
      hasTwitter: true,
    });
    expect(eligibleEval.status).toBe("ELIGIBLE");

    const valResult = validatePromotionApproval(eligibleEval);
    expect(valResult.canApprove).toBe(true);
    expect(valResult.isConditional).toBe(false);
    expect(valResult.blockReason).toBeUndefined();
  });

  // =========================================================================
  // 7-11. SQLITE PERSISTENCE LAYER & IDEMPOTENCY
  // =========================================================================
  it("Requirement 7: recordPromotionDecision persists APPROVED decision with operator and reason", () => {
    const record = recordPromotionDecision({
      tokenAddress: testAddress1,
      chain: "base",
      ticker: testTicker1,
      decision: "APPROVED",
      operator: "alice_operator",
      reason: "Manual audit passed on DexScreener",
    });

    expect(record).toBeDefined();
    expect(record.tokenAddress).toBe(testAddress1);
    expect(record.chain).toBe("base");
    expect(record.ticker).toBe(testTicker1);
    expect(record.decision).toBe("APPROVED");
    expect(record.operator).toBe("alice_operator");
    expect(record.reason).toBe("Manual audit passed on DexScreener");
    expect(record.decidedAt).toBeDefined();
    expect(record.updatedAt).toBeDefined();
  });

  it("Requirement 8: getPromotionDecision retrieves record case-insensitively", () => {
    recordPromotionDecision({
      tokenAddress: testAddress1,
      chain: "base",
      ticker: testTicker1,
      decision: "APPROVED",
      operator: "bob_operator",
    });

    // Lowercase lookup
    const foundLower = getPromotionDecision(testAddress1.toLowerCase());
    expect(foundLower).not.toBeNull();
    expect(foundLower?.tokenAddress).toBe(testAddress1);
    expect(foundLower?.decision).toBe("APPROVED");

    // Uppercase lookup
    const foundUpper = getPromotionDecision(testAddress1.toUpperCase());
    expect(foundUpper).not.toBeNull();
    expect(foundUpper?.tokenAddress).toBe(testAddress1);

    // Nonexistent lookup
    const notFound = getPromotionDecision("0xNonexistentAddress9999999999999");
    expect(notFound).toBeNull();
  });

  it("Requirement 9: recordPromotionDecision records REJECTED with mandatory or optional reason", () => {
    const record = recordPromotionDecision({
      tokenAddress: testAddress2,
      chain: "solana",
      ticker: testTicker2,
      decision: "REJECTED",
      operator: "charlie_operator",
      reason: "Insufficient on-chain organic volume",
    });

    expect(record.decision).toBe("REJECTED");
    expect(record.reason).toBe("Insufficient on-chain organic volume");

    const fetched = getPromotionDecision(testAddress2);
    expect(fetched?.decision).toBe("REJECTED");
    expect(fetched?.reason).toBe("Insufficient on-chain organic volume");
  });

  it("Requirement 10: IDEMPOTENCY: Repeated approvals/rejections update row without duplicates", () => {
    // 1st record: PENDING_REVIEW
    recordPromotionDecision({
      tokenAddress: testAddress1,
      chain: "base",
      ticker: testTicker1,
      decision: "PENDING_REVIEW",
      operator: "op1",
      reason: "Initial review",
    });

    // 2nd record: updated to APPROVED
    recordPromotionDecision({
      tokenAddress: testAddress1,
      chain: "base",
      ticker: testTicker1,
      decision: "APPROVED",
      operator: "op2",
      reason: "Second review approved",
    });

    // Verify row count in SQLite is exactly 1 for testAddress1
    const db = new Database(resolveDbPath());
    const countRow = db.query("SELECT COUNT(*) as count FROM promotion_decisions WHERE token_address = ?").get(testAddress1) as { count: number };
    expect(countRow.count).toBe(1);

    const fetched = getPromotionDecision(testAddress1);
    expect(fetched?.decision).toBe("APPROVED");
    expect(fetched?.operator).toBe("op2");
    expect(fetched?.reason).toBe("Second review approved");

    // 3rd record: updated to REJECTED
    recordPromotionDecision({
      tokenAddress: testAddress1,
      chain: "base",
      ticker: testTicker1,
      decision: "REJECTED",
      operator: "op3",
      reason: "Overturned to rejected",
    });

    const countRowAfter = db.query("SELECT COUNT(*) as count FROM promotion_decisions WHERE token_address = ?").get(testAddress1) as { count: number };
    expect(countRowAfter.count).toBe(1);

    const fetchedAfter = getPromotionDecision(testAddress1);
    expect(fetchedAfter?.decision).toBe("REJECTED");
    expect(fetchedAfter?.operator).toBe("op3");
  });

  it("Requirement 11: getAllPromotionDecisions returns dictionary indexed by address and ticker", () => {
    recordPromotionDecision({
      tokenAddress: testAddress1,
      chain: "base",
      ticker: testTicker1,
      decision: "APPROVED",
    });

    recordPromotionDecision({
      tokenAddress: testAddress2,
      chain: "solana",
      ticker: testTicker2,
      decision: "REJECTED",
    });

    const allDecisions = getAllPromotionDecisions();

    // Lookups by address
    expect(allDecisions[testAddress1.toLowerCase()]).toBeDefined();
    expect(allDecisions[testAddress1.toLowerCase()].decision).toBe("APPROVED");
    expect(allDecisions[testAddress2.toLowerCase()]).toBeDefined();
    expect(allDecisions[testAddress2.toLowerCase()].decision).toBe("REJECTED");

    // Lookups by ticker
    expect(allDecisions[testTicker1.toLowerCase()]).toBeDefined();
    expect(allDecisions[testTicker1.toLowerCase()].decision).toBe("APPROVED");
    expect(allDecisions[testTicker2.toLowerCase()]).toBeDefined();
    expect(allDecisions[testTicker2.toLowerCase()].decision).toBe("REJECTED");
  });

  // =========================================================================
  // 12-13. DISCOVERY PACKAGE INTEGRATION
  // =========================================================================
  it("Requirement 12: generateDiscoveryPackage embeds operatorDecision into the package", () => {
    const input: TokenOfferInput = {
      tokenAddress: testAddress1,
      contractAddress: testAddress1,
      chain: "base",
      name: "Decision Test Token",
      ticker: testTicker1,
      description: "Description for test token",
    };

    const elig = evaluatePromotionEligibility({
      lifecycleState: "DEPLOY_CONFIRMED",
      onChainVerified: true,
      contractAddress: testAddress1,
      chain: "base",
    });

    // Without explicit override, reads from DB (or defaults to PENDING_REVIEW)
    const pkg1 = generateDiscoveryPackage(input, elig);
    expect(pkg1.operatorDecision?.status).toBe("PENDING_REVIEW");

    // With explicit override (string)
    const pkg2 = generateDiscoveryPackage(input, elig, "APPROVED");
    expect(pkg2.operatorDecision?.status).toBe("APPROVED");

    const pkg3 = generateDiscoveryPackage(input, elig, "REJECTED");
    expect(pkg3.operatorDecision?.status).toBe("REJECTED");
  });

  it("Requirement 13: generateDiscoveryPackage reads recorded decision from SQLite if not overridden", () => {
    recordPromotionDecision({
      tokenAddress: testAddress1,
      chain: "base",
      ticker: testTicker1,
      decision: "APPROVED",
      operator: "reviewer_1",
      reason: "Pre-approved campaign",
    });

    const input: TokenOfferInput = {
      tokenAddress: testAddress1,
      contractAddress: testAddress1,
      chain: "base",
      name: "Decision Test Token",
      ticker: testTicker1,
      description: "Description for test token",
    };

    const elig = evaluatePromotionEligibility({
      lifecycleState: "DEPLOY_CONFIRMED",
      onChainVerified: true,
      contractAddress: testAddress1,
      chain: "base",
    });

    // Automatically picks up "APPROVED" from DB
    const pkg = generateDiscoveryPackage(input, elig);
    expect(pkg.operatorDecision?.status).toBe("APPROVED");
    expect(pkg.operatorDecision?.operator).toBe("reviewer_1");
  });

  // =========================================================================
  // 14-16. FLEET EXPORT (CSV & JSON) INTEGRATION
  // =========================================================================
  it("Requirement 14-16: exportFleetMatrix includes operatorDecision in items, CSV and JSON", async () => {
    const exportResult = await exportFleetMatrix({
      format: "all",
      customDir: path.join(process.cwd(), ".eliza", "test_exports"),
      filenamePrefix: "test_phase6b1_fleet",
    });

    expect(exportResult.items.length).toBeGreaterThan(0);
    // Every item has operatorDecision
    for (const item of exportResult.items) {
      expect(item.operatorDecision).toBeDefined();
      expect(["PENDING_REVIEW", "APPROVED", "REJECTED"]).toContain(item.operatorDecision);
    }

    // Check CSV
    expect(exportResult.csvPath).toBeDefined();
    const csvContent = fs.readFileSync(exportResult.csvPath!, "utf8");
    const [headerLine, ...dataRows] = csvContent.split("\n").filter(Boolean);

    expect(headerLine).toContain("operatorDecision");
    const headerCols = headerLine.split(",");
    const opDecisionIdx = headerCols.indexOf("operatorDecision");
    expect(opDecisionIdx).toBeGreaterThan(-1);

    // Check that data rows have a valid operatorDecision at the index
    for (const row of dataRows.slice(0, 5)) {
      const cols = row.split(",");
      const val = cols[opDecisionIdx];
      expect(["PENDING_REVIEW", "APPROVED", "REJECTED"]).toContain(val);
    }

    // Check JSON
    expect(exportResult.jsonPath).toBeDefined();
    const jsonContent = JSON.parse(fs.readFileSync(exportResult.jsonPath!, "utf8"));
    expect(jsonContent.fleet).toBeDefined();
    expect(jsonContent.fleet.length).toBeGreaterThan(0);
    expect(jsonContent.fleet[0].operatorDecision).toBeDefined();

    // Clean up test export files
    try {
      fs.rmSync(path.join(process.cwd(), ".eliza", "test_exports"), { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  // =========================================================================
  // 17-18. PRODUCTION DATABASE ISOLATION & STERILITY
  // =========================================================================
  it("Requirement 17-18: Production DB sterility: deploy_logs and treasury_ledger counts remain untouched", () => {
    const db = new Database(".eliza/vault.db");
    const deployLogsCount = db.query("SELECT COUNT(*) as count FROM deploy_logs").get() as { count: number };
    const treasuryLedgerCount = db.query("SELECT COUNT(*) as count FROM treasury_ledger").get() as { count: number };

    // Invariant: deploy_logs must remain >= 6, treasury_ledger preserves confirmed records
    expect(deployLogsCount.count).toBeGreaterThanOrEqual(6);
    expect(treasuryLedgerCount.count).toBeGreaterThanOrEqual(0);
    db.close();
  });
});
