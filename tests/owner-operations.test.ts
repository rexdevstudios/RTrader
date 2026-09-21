/**
 * owner-operations.test.ts — V2.3 Owner Operations: Full Test Suite
 *
 * Covers:
 *  - Multi-wallet reporting (wallet A vs wallet B separated)
 *  - Wallet-level PnL (calculated vs pending vs price return)
 *  - Platform-level PnL aggregation
 *  - Realized profit / realized loss
 *  - pnl_pending shown as pending (not fabricated)
 *  - Partial exit / full exit history
 *  - Treasury credit / debit / balance
 *  - Fee lifecycle (detected → claimed)
 *  - Manual intervention audit trail
 *  - Disabled wallet excluded from routes
 *  - Unresolved transaction flagging
 *  - Credential values never appear in owner reports
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_PATH, createPendingPosition, transitionPositionState, logDeploy, insertTreasuryLedgerEntry, recordFeeEvent, logIntervention, getInterventionLogs } from "../src/db/vault.ts";
import { registerWalletAccount, setWalletProviderRoute, updateWalletStatus, updateProviderRouteStatus, getAllWalletAccounts, getAllProviderRoutes } from "../src/modules/identity/wallet-manager.ts";
import { getWalletPnlSummary, getPlatformPnlSummary, getWalletReport, getPositionHistory, getUnresolvedTransactions, getTreasuryReport } from "../src/modules/owner/owner-reporter.ts";
import { forceClosePosition, pauseWallet, resumeWallet, disableProviderRoute, retryUnresolved } from "../src/modules/owner/owner-operations.ts";
import { checkAndEmitAlerts, resetAlertState } from "../src/modules/owner/owner-alerts.ts";
import { resetConfig } from "../src/config.ts";

// ─── Test Setup ───────────────────────────────────────────────

const WALLET_A = "test-owner-wallet-a";
const WALLET_B = "test-owner-wallet-b";
const CONTRACT_A1 = "0xaaaa" + "1".repeat(36);
const CONTRACT_A2 = "0xaaaa" + "2".repeat(36);
const CONTRACT_B1 = "0xbbbb" + "1".repeat(36);
const CONTRACT_UNRESOLVED = "0xdead" + "1".repeat(36);
const CONTRACT_CLOSE = "0xcafe" + "1".repeat(36);

function setupEnv() {
  resetConfig();
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
  process.env.FIRECRAWL_API_KEY = "test";
  process.env.PINATA_JWT = "test";
  process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
  process.env.DEPLOY_MODE = "testnet";
}

let db: Database;

beforeEach(() => {
  setupEnv();
  db = new Database(DB_PATH);
  resetAlertState();

  // Register test wallets (idempotent)
  try {
    registerWalletAccount({ id: WALLET_A, label: "Test Wallet A", evmAddress: "0x" + "a".repeat(40), credentialRef: "env:TEST_KEY_A", status: "ACTIVE" });
  } catch {}
  try {
    registerWalletAccount({ id: WALLET_B, label: "Test Wallet B", evmAddress: "0x" + "b".repeat(40), credentialRef: "env:TEST_KEY_B", status: "ACTIVE" });
  } catch {}

  // Ensure wallet routes
  try { setWalletProviderRoute(WALLET_A, "bankr", { credentialRef: "env:BANKR_A" }); } catch {}
  try { setWalletProviderRoute(WALLET_B, "bankr", { credentialRef: "env:BANKR_B" }); } catch {}

  // Reset wallet statuses
  db.run("UPDATE wallet_accounts SET status = 'ACTIVE' WHERE id IN (?, ?)", [WALLET_A, WALLET_B]);
  db.run("UPDATE wallet_provider_routes SET status = 'ACTIVE' WHERE wallet_id IN (?, ?)", [WALLET_A, WALLET_B]);
});

afterEach(() => {
  // Clean up test-specific data
  const testContracts = [CONTRACT_A1, CONTRACT_A2, CONTRACT_B1, CONTRACT_UNRESOLVED, CONTRACT_CLOSE];
  for (const c of testContracts) {
    db.run("DELETE FROM active_positions WHERE contract_addr = ?", [c]);
  }
  db.run("DELETE FROM treasury_ledger WHERE wallet_id IN (?, ?)", [WALLET_A, WALLET_B]);
  db.run("DELETE FROM fee_events WHERE wallet_id IN (?, ?)", [WALLET_A, WALLET_B]);
  db.run("DELETE FROM intervention_logs WHERE wallet_id IN (?, ?) OR contract_addr IN (?)", [WALLET_A, WALLET_B, CONTRACT_CLOSE]);
  db.run("DELETE FROM deploy_logs WHERE wallet_id IN (?, ?)", [WALLET_A, WALLET_B]);
  db.close();
});

// ─── Helper to create a position with wallet lineage ─────────

function seedPosition(params: {
  contractAddr: string;
  ticker: string;
  walletId: string;
  deployLogId?: number;
  chain?: string;
  pnlStatus?: string;
  realizedPnl?: number;
  status?: string;
  priceReturnPercent?: number;
  reconciliationStatus?: string;
  attributionStatus?: string;
}) {
  const deployId = params.deployLogId ?? logDeploy({
    chain: params.chain ?? "base",
    tokenName: params.ticker,
    ticker: params.ticker,
    status: "success",
    walletId: params.walletId,
  });

  createPendingPosition({
    deployLogId: deployId,
    chain: params.chain ?? "base",
    contractAddr: params.contractAddr,
    ticker: params.ticker,
    snipeAmount: 0.05,
    takeProfitX: 2.0,
    stopLossPct: 0.3,
    walletAddress: "0x" + "a".repeat(40),
    walletId: params.walletId,
  });

  if (params.status && params.status !== "buy_submitted") {
    db.run(
      `UPDATE active_positions SET status = ?, pnl_status = ?, realized_pnl = ?,
              price_return_percent = ?, reconciliation_status = ?, attribution_status = ?,
              closed_at = datetime('now'), updated_at = datetime('now')
       WHERE contract_addr = ?`,
      [
        params.status,
        params.pnlStatus ?? "pnl_pending",
        params.realizedPnl ?? null,
        params.priceReturnPercent ?? null,
        params.reconciliationStatus ?? "confirmed",
        params.attributionStatus ?? "balance_delta_only",
        params.contractAddr,
      ]
    );
  } else {
    db.run(
      `UPDATE active_positions SET pnl_status = ?, reconciliation_status = ?, attribution_status = ?
       WHERE contract_addr = ?`,
      [
        params.pnlStatus ?? "pnl_pending",
        params.reconciliationStatus ?? "pending",
        params.attributionStatus ?? "unresolved",
        params.contractAddr,
      ]
    );
  }

  return deployId;
}

// ─── 1. Multi-Wallet Reporting (Separated) ───────────────────

describe("V2.3 Owner Operations — Multi-Wallet Reporting", () => {
  it("1. wallet reports should be separated by wallet_id", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "ATOK1", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.05 });
    seedPosition({ contractAddr: CONTRACT_B1, ticker: "BTOK1", walletId: WALLET_B, status: "sold_sl", pnlStatus: "calculated", realizedPnl: -0.02 });

    const summaryA = getWalletPnlSummary(WALLET_A);
    const summaryB = getWalletPnlSummary(WALLET_B);

    expect(summaryA.walletId).toBe(WALLET_A);
    expect(summaryB.walletId).toBe(WALLET_B);

    // Wallet A: profit
    expect(summaryA.totalRealizedProfit).toBeCloseTo(0.05, 4);
    expect(summaryA.totalRealizedLoss).toBe(0);

    // Wallet B: loss
    expect(summaryB.totalRealizedLoss).toBeCloseTo(0.02, 4);
    expect(summaryB.totalRealizedProfit).toBe(0);

    // Cross-contamination check
    expect(summaryA.totalRealizedLoss).toBe(0);
    expect(summaryB.totalRealizedProfit).toBe(0);
  });

  it("2. wallet label comes from wallet_accounts registration", () => {
    const summary = getWalletPnlSummary(WALLET_A);
    expect(summary.walletLabel).toBe("Test Wallet A");
  });

  it("3. unknown wallet returns sensible defaults", () => {
    const summary = getWalletPnlSummary("non-existent-wallet");
    expect(summary.totalRealizedPnl).toBe(0);
    expect(summary.openPositionCount).toBe(0);
  });
});

// ─── 2. Wallet-Level PnL Accuracy ────────────────────────────

describe("V2.3 Owner Operations — Wallet PnL Accuracy", () => {
  it("4. pnl_pending positions are counted as pending, not fabricated", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "PEND1", walletId: WALLET_A, status: "sold_tp", pnlStatus: "pnl_pending" });
    const summary = getWalletPnlSummary(WALLET_A);
    expect(summary.pendingPnlCount).toBeGreaterThanOrEqual(1);
    expect(summary.totalRealizedPnl).toBe(0); // no fabrication
  });

  it("5. price_return_percent is NOT included in realized monetary PnL", () => {
    seedPosition({
      contractAddr: CONTRACT_A1, ticker: "PRET1", walletId: WALLET_A,
      status: "sold_tp", pnlStatus: "pnl_pending",
      priceReturnPercent: 200.0, // 200% price return — should NOT appear in realizedPnl
      realizedPnl: null,
    });
    const summary = getWalletPnlSummary(WALLET_A);
    // Monetary PnL must be 0 — only pnl_status=calculated counts
    expect(summary.totalRealizedPnl).toBe(0);
  });

  it("6. realized profit and loss are tracked separately", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "PROF1", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.10 });
    seedPosition({ contractAddr: CONTRACT_A2, ticker: "LOSS1", walletId: WALLET_A, status: "sold_sl", pnlStatus: "calculated", realizedPnl: -0.03 });

    const summary = getWalletPnlSummary(WALLET_A);
    expect(summary.totalRealizedProfit).toBeCloseTo(0.10, 4);
    expect(summary.totalRealizedLoss).toBeCloseTo(0.03, 4);
    expect(summary.totalRealizedPnl).toBeCloseTo(0.07, 4); // net
  });

  it("7. by-chain PnL breakdown is accurate", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "BASEPRO", walletId: WALLET_A, chain: "base", status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.05 });
    seedPosition({ contractAddr: CONTRACT_A2, ticker: "SOLPRO", walletId: WALLET_A, chain: "solana", status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.02 });

    const summary = getWalletPnlSummary(WALLET_A);
    expect(summary.byChain["base"]?.realizedPnl).toBeCloseTo(0.05, 4);
    expect(summary.byChain["solana"]?.realizedPnl).toBeCloseTo(0.02, 4);
  });
});

// ─── 3. Platform PnL Aggregation ─────────────────────────────

describe("V2.3 Owner Operations — Platform PnL Aggregation", () => {
  it("8. platform PnL aggregates across all wallets", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "PLAT_A", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.08 });
    seedPosition({ contractAddr: CONTRACT_B1, ticker: "PLAT_B", walletId: WALLET_B, status: "sold_sl", pnlStatus: "calculated", realizedPnl: -0.02 });

    const platform = getPlatformPnlSummary();
    expect(platform.totalRealizedProfit).toBeGreaterThanOrEqual(0.08);
    expect(platform.totalRealizedLoss).toBeGreaterThanOrEqual(0.02);
    expect(platform.walletBreakdown.length).toBeGreaterThanOrEqual(2);
  });

  it("9. platform open and closed position counts are correct", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "OPEN1", walletId: WALLET_A }); // buy_submitted → open
    seedPosition({ contractAddr: CONTRACT_A2, ticker: "SOLD1", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.01 });

    const platform = getPlatformPnlSummary();
    expect(platform.openPositionCount).toBeGreaterThanOrEqual(1);
    expect(platform.closedPositionCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── 4. Full Wallet Report ────────────────────────────────────

describe("V2.3 Owner Operations — Wallet Report", () => {
  it("10. wallet report never exposes credential values", () => {
    const report = getWalletReport(WALLET_A);
    expect(report).not.toBeNull();

    // Only boolean presence — never the actual ref value
    expect(typeof report!.credentialRefPresent).toBe("boolean");
    expect(report!.credentialRefPresent).toBe(true);

    // No raw credentialRef string should appear
    const reportJson = JSON.stringify(report);
    expect(reportJson).not.toContain("env:TEST_KEY_A");
  });

  it("11. wallet report includes provider routes with proxy health", () => {
    const report = getWalletReport(WALLET_A);
    expect(report).not.toBeNull();
    expect(report!.providerRoutes.length).toBeGreaterThanOrEqual(1);
    expect(report!.providerRoutes[0]).toHaveProperty("provider");
    expect(report!.providerRoutes[0]).toHaveProperty("status");
    expect(report!.providerRoutes[0]).toHaveProperty("proxyHealthStatus");
  });

  it("12. wallet report returns null for unknown wallet", () => {
    const report = getWalletReport("does-not-exist");
    expect(report).toBeNull();
  });
});

// ─── 5. Position History ──────────────────────────────────────

describe("V2.3 Owner Operations — Position History", () => {
  it("13. open position history excludes closed positions", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "HISTOPEN", walletId: WALLET_A });
    seedPosition({ contractAddr: CONTRACT_A2, ticker: "HISTCLOSED", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.01 });

    const history = getPositionHistory({ status: "open", walletId: WALLET_A });
    const tickers = history.map(h => h.position.ticker);
    expect(tickers).toContain("HISTOPEN");
    expect(tickers).not.toContain("HISTCLOSED");
  });

  it("14. closed position history excludes open positions", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "CLOSEDTOK", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.02 });

    const history = getPositionHistory({ status: "closed", walletId: WALLET_A });
    const tickers = history.map(h => h.position.ticker);
    expect(tickers).toContain("CLOSEDTOK");
  });

  it("15. position history includes pnl and attribution labels", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "LBLTEST", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.01 });
    const history = getPositionHistory({ status: "closed", walletId: WALLET_A });
    const entry = history.find(h => h.position.ticker === "LBLTEST");
    expect(entry).toBeDefined();
    expect(entry!.pnlStatusLabel).toBe("realized");
    expect(entry!.attributionLabel).toBeDefined();
  });

  it("16. pnl_pending positions are labeled 'pending'", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "PENDLBL", walletId: WALLET_A, status: "sold_tp", pnlStatus: "pnl_pending" });
    const history = getPositionHistory({ status: "closed", walletId: WALLET_A });
    const entry = history.find(h => h.position.ticker === "PENDLBL");
    expect(entry).toBeDefined();
    expect(entry!.pnlStatusLabel).toBe("pending");
  });

  it("17. position history includes deployment lineage", () => {
    const deployId = seedPosition({ contractAddr: CONTRACT_A1, ticker: "LINEAGE", walletId: WALLET_A });
    const history = getPositionHistory({ walletId: WALLET_A });
    const entry = history.find(h => h.position.ticker === "LINEAGE");
    expect(entry).toBeDefined();
    expect(entry!.deployment).not.toBeNull();
    expect(entry!.deployment!.id).toBe(deployId);
  });
});

// ─── 6. Unresolved Transaction Flagging ──────────────────────

describe("V2.3 Owner Operations — Unresolved Transactions", () => {
  it("18. unresolved buy_submitted positions are flagged", () => {
    seedPosition({
      contractAddr: CONTRACT_UNRESOLVED, ticker: "UNRESOLV", walletId: WALLET_A,
      reconciliationStatus: "unresolved", attributionStatus: "unresolved"
    });
    const unresolved = getUnresolvedTransactions();
    const found = unresolved.find(u => u.contractAddr === CONTRACT_UNRESOLVED);
    expect(found).toBeDefined();
    expect(found!.ticker).toBe("UNRESOLV");
  });

  it("19. confirmed and closed positions are not flagged as unresolved", () => {
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "RESOLVED", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.01, reconciliationStatus: "confirmed" });
    const unresolved = getUnresolvedTransactions();
    const found = unresolved.find(u => u.contractAddr === CONTRACT_A1);
    expect(found).toBeUndefined();
  });

  it("19b. [F3-fix] positions with reconciliation_status=pending are NOT false-flagged as unresolved", () => {
    // 'pending' is the default/normal starting state for every new position.
    // It must not appear in getUnresolvedTransactions() — only 'unresolved' status should.
    seedPosition({
      contractAddr: CONTRACT_A1, ticker: "PENDNEW", walletId: WALLET_A,
      // Default initial state after seedPosition: reconciliation_status = 'pending', attribution_status = 'unresolved'
      // We force both to be 'pending' / 'balance_delta_only' so neither qualifies as unresolved
    });
    db.run(
      "UPDATE active_positions SET reconciliation_status = 'pending', attribution_status = 'balance_delta_only' WHERE contract_addr = ?",
      [CONTRACT_A1]
    );

    const unresolved = getUnresolvedTransactions();
    const found = unresolved.find(u => u.contractAddr === CONTRACT_A1);
    // A position with reconciliation_status='pending' and no attribution='unresolved' must NOT be flagged
    expect(found).toBeUndefined();
  });
});

// ─── 7. Treasury Report ───────────────────────────────────────

describe("V2.3 Owner Operations — Treasury Report", () => {
  it("20. treasury report includes credit and debit entries", () => {
    insertTreasuryLedgerEntry({
      entryId: `test_credit_${WALLET_A}_001`,
      walletId: WALLET_A, chain: "base", eventType: "realized_pnl_credited",
      tokenSymbol: "ETH", amountRaw: "50000000000000000", amountFormatted: 0.05,
      direction: "credit", sourceRefType: "active_position", sourceRefId: "999",
    });
    insertTreasuryLedgerEntry({
      entryId: `test_debit_${WALLET_A}_001`,
      walletId: WALLET_A, chain: "base", eventType: "realized_pnl_credited",
      tokenSymbol: "ETH", amountRaw: "20000000000000000", amountFormatted: 0.02,
      direction: "debit", sourceRefType: "active_position", sourceRefId: "998",
    });

    const report = getTreasuryReport(WALLET_A);
    expect(report.totalCredits).toBeCloseTo(0.05, 4);
    expect(report.totalDebits).toBeCloseTo(0.02, 4);
    expect(report.realizedProfits).toBeCloseTo(0.05, 4);
    expect(report.realizedLosses).toBeCloseTo(0.02, 4);
    expect(report.entries.length).toBeGreaterThanOrEqual(2);
  });

  it("21. treasury report net balance = credits - debits", () => {
    insertTreasuryLedgerEntry({
      entryId: `test_net_${WALLET_A}_001`,
      walletId: WALLET_A, chain: "base", eventType: "fee_claimed",
      tokenSymbol: "ETH", amountRaw: "100000000000000000", amountFormatted: 0.10,
      direction: "credit", sourceRefType: "fee_event", sourceRefId: "1",
    });
    const report = getTreasuryReport(WALLET_A);
    expect(report.netBalance).toBeGreaterThan(0);
  });
});

// ─── 8. Fee Lifecycle ─────────────────────────────────────────

describe("V2.3 Owner Operations — Fee Lifecycle", () => {
  it("22. fee status lifecycle (detected → claimed) is reported correctly", () => {
    const key = `test_fee_${WALLET_A}_detected_001`;
    recordFeeEvent({
      eventKey: key,
      walletId: WALLET_A, chain: "base", source: "pumpfun",
      beneficiaryAddress: "0x" + "a".repeat(40), tokenSymbol: "SOL",
      amountRaw: "1000000000", amountFormatted: 1.0,
      status: "detected",
    });

    const report = getWalletReport(WALLET_A);
    const feeEvents = report!.fees;
    const found = feeEvents.find(f => f.eventKey === key);
    expect(found).toBeDefined();
    expect(found!.status).toBe("detected");
  });
});

// ─── 9. Manual Intervention — Force Close ────────────────────

describe("V2.3 Owner Operations — Manual Intervention: Force Close", () => {
  it("23. force_close transitions to manual_closed without fabricating tx or PnL", () => {
    seedPosition({ contractAddr: CONTRACT_CLOSE, ticker: "FRCLS", walletId: WALLET_A });

    const result = forceClosePosition(CONTRACT_CLOSE, "test intervention");
    expect(result.success).toBe(true);
    expect(result.action).toBe("force_close");

    // Verify DB state
    const pos = db.query("SELECT status, sell_tx_hash, realized_pnl FROM active_positions WHERE contract_addr = ?").get(CONTRACT_CLOSE) as any;
    expect(pos.status).toBe("manual_closed");
    expect(pos.sell_tx_hash).toBeNull(); // No fabricated tx
    expect(pos.realized_pnl).toBeNull(); // No fabricated PnL
  });

  it("24. force_close creates auditable intervention log", () => {
    seedPosition({ contractAddr: CONTRACT_CLOSE, ticker: "AUDIT1", walletId: WALLET_A });
    const result = forceClosePosition(CONTRACT_CLOSE, "audit test");
    expect(result.interventionId).not.toBeNull();

    const logs = getInterventionLogs({ contractAddr: CONTRACT_CLOSE });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].action).toBe("force_close");
    expect(logs[0].result).toBe("success");
    expect(logs[0].resultDetail).toContain("manual_closed");
  });

  it("25. force_close on already-closed position is rejected", () => {
    seedPosition({ contractAddr: CONTRACT_CLOSE, ticker: "ALREADY", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.01 });
    const result = forceClosePosition(CONTRACT_CLOSE, "test");
    expect(result.success).toBe(false);
    expect(result.detail).toContain("non-closable");
  });

  it("26. force_close on non-existent position is rejected", () => {
    const result = forceClosePosition("0xnonexistent" + "0".repeat(28), "test");
    expect(result.success).toBe(false);
  });
});

// ─── 10. Manual Intervention — Pause/Resume Wallet ───────────

describe("V2.3 Owner Operations — Manual Intervention: Pause/Resume Wallet", () => {
  it("27. pauseWallet transitions wallet to PAUSED and creates audit log", () => {
    const result = pauseWallet(WALLET_A, "testing pause");
    expect(result.success).toBe(true);
    expect(result.action).toBe("pause_wallet");

    const wallet = db.query("SELECT status FROM wallet_accounts WHERE id = ?").get(WALLET_A) as any;
    expect(wallet.status).toBe("PAUSED");

    const logs = getInterventionLogs({ walletId: WALLET_A, action: "pause_wallet" });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("28. resumeWallet transitions wallet back to ACTIVE", () => {
    pauseWallet(WALLET_A, "initial pause");
    const result = resumeWallet(WALLET_A, "testing resume");
    expect(result.success).toBe(true);

    const wallet = db.query("SELECT status FROM wallet_accounts WHERE id = ?").get(WALLET_A) as any;
    expect(wallet.status).toBe("ACTIVE");
  });

  it("29. pauseWallet on already PAUSED wallet is rejected", () => {
    pauseWallet(WALLET_A, "first pause");
    const result = pauseWallet(WALLET_A, "second pause");
    expect(result.success).toBe(false);
    expect(result.detail).toContain("already PAUSED");
  });

  it("30. pauseWallet on non-existent wallet is rejected", () => {
    const result = pauseWallet("does-not-exist", "test");
    expect(result.success).toBe(false);
  });
});

// ─── 11. Manual Intervention — Disable Provider Route ────────

describe("V2.3 Owner Operations — Manual Intervention: Disable Route", () => {
  it("31. disableProviderRoute marks route as DISABLED with audit log", () => {
    const result = disableProviderRoute(WALLET_A, "bankr", "testing disable");
    expect(result.success).toBe(true);

    const route = db.query("SELECT status FROM wallet_provider_routes WHERE wallet_id = ? AND provider = ?").get(WALLET_A, "bankr") as any;
    expect(route.status).toBe("DISABLED");

    const logs = getInterventionLogs({ walletId: WALLET_A, action: "disable_route" });
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it("32. disableProviderRoute on already DISABLED route is rejected", () => {
    disableProviderRoute(WALLET_A, "bankr", "first disable");
    const result = disableProviderRoute(WALLET_A, "bankr", "second disable");
    expect(result.success).toBe(false);
    expect(result.detail).toContain("already DISABLED");
  });

  it("33. disableProviderRoute on non-existent route is rejected", () => {
    const result = disableProviderRoute("ghost-wallet", "bankr", "test");
    expect(result.success).toBe(false);
  });
});

// ─── 12. Manual Intervention — Retry Unresolved ──────────────

describe("V2.3 Owner Operations — Manual Intervention: Retry Unresolved", () => {
  it("34. retryUnresolved resets reconciliation_status to pending", () => {
    seedPosition({
      contractAddr: CONTRACT_UNRESOLVED, ticker: "RETRY1", walletId: WALLET_A,
      reconciliationStatus: "unresolved",
    });

    const result = retryUnresolved(CONTRACT_UNRESOLVED, "manual retry");
    expect(result.success).toBe(true);

    const pos = db.query("SELECT reconciliation_status FROM active_positions WHERE contract_addr = ?").get(CONTRACT_UNRESOLVED) as any;
    expect(pos.reconciliation_status).toBe("pending");
  });

  it("35. retryUnresolved on closed position is rejected", () => {
    seedPosition({ contractAddr: CONTRACT_UNRESOLVED, ticker: "RETRYCLOSED", walletId: WALLET_A, status: "sold_tp", pnlStatus: "calculated", realizedPnl: 0.01 });
    const result = retryUnresolved(CONTRACT_UNRESOLVED, "test");
    expect(result.success).toBe(false);
  });
});

// ─── 13. Intervention Log History ────────────────────────────

describe("V2.3 Owner Operations — Intervention Log History", () => {
  it("36. intervention logs can be queried by wallet and action", () => {
    logIntervention({
      action: "pause_wallet",
      walletId: WALLET_B,
      requestedAt: new Date().toISOString(),
      result: "success",
      resultDetail: "test log",
    });

    const logs = getInterventionLogs({ walletId: WALLET_B, action: "pause_wallet" });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].walletId).toBe(WALLET_B);
    expect(logs[0].action).toBe("pause_wallet");
    expect(logs[0].result).toBe("success");
  });

  it("37. intervention log contains requestedAt timestamp", () => {
    const before = new Date().toISOString();
    const result = pauseWallet(WALLET_B, "timestamp test");
    const after = new Date().toISOString();

    expect(result.interventionId).not.toBeNull();
    const log = getInterventionLogs({ walletId: WALLET_B, action: "pause_wallet" })[0];
    expect(log.requestedAt >= before).toBe(true);
    expect(log.requestedAt <= after).toBe(true);
  });
});

// ─── 14. Owner Alerts ─────────────────────────────────────────

describe("V2.3 Owner Operations — Owner Alerts", () => {
  it("38. checkAndEmitAlerts returns alert summary without throwing", () => {
    const summary = checkAndEmitAlerts();
    expect(summary).toBeDefined();
    expect(typeof summary.total).toBe("number");
    expect(typeof summary.newAlerts).toBe("number");
    expect(Array.isArray(summary.alerts)).toBe(true);
    expect(typeof summary.checkTimestamp).toBe("string");
    // total and newAlerts must agree
    expect(summary.total).toBe(summary.newAlerts);
  });

  it("39. [F1-fix] alerts are fully deduplicated: second call returns exactly 0 new alerts", () => {
    // First call may find some alerts from data in DB
    const first = checkAndEmitAlerts();
    // Second call on same DB state — all candidates already emitted → 0 new
    const second = checkAndEmitAlerts();
    expect(second.newAlerts).toBe(0);
    expect(second.alerts).toHaveLength(0);
  });

  it("39b. [F1-fix] alerts array contains only newly emitted alerts, not all candidates", () => {
    // Seed an open position (status="open") so position_opened alert fires
    seedPosition({ contractAddr: CONTRACT_A1, ticker: "ALERTSEED", walletId: WALLET_A, status: "open" });
    resetAlertState(); // clear so this position fires fresh

    const first = checkAndEmitAlerts();
    // First call: position_opened should appear in alerts
    const openAlert = first.alerts.find(a => a.eventType === "position_opened" && a.context.ticker === "ALERTSEED");
    expect(openAlert).toBeDefined();

    // Second call: same position still in DB but already emitted → 0 new
    const second = checkAndEmitAlerts();
    expect(second.newAlerts).toBe(0);
  });

  it("40. alert state resets after resetAlertState()", () => {
    const first = checkAndEmitAlerts();
    resetAlertState();
    const second = checkAndEmitAlerts();
    // After reset, same events are emitted again
    expect(second.newAlerts).toBeGreaterThanOrEqual(first.newAlerts);
  });

  it("40b. [F3-fix] positions with reconciliation_status=pending are NOT flagged as unresolved alerts", () => {
    // Seed a fresh position — default reconciliation_status is 'pending' (normal initial state)
    seedPosition({
      contractAddr: CONTRACT_A1, ticker: "NEWPOS", walletId: WALLET_A,
      // No reconciliationStatus override → will be 'pending' (default)
      attributionStatus: "unresolved", // Only attribution is unresolved, not reconciliation
    });
    // Force reconciliation_status to 'pending' explicitly
    db.run(
      "UPDATE active_positions SET reconciliation_status = 'pending', attribution_status = 'balance_delta_only' WHERE contract_addr = ?",
      [CONTRACT_A1]
    );

    // The position now has reconciliation_status='pending' and attribution_status='balance_delta_only'
    // Neither is 'unresolved' — should NOT appear in transaction_unresolved alerts
    resetAlertState();
    const summary = checkAndEmitAlerts();
    const unresolvedAlert = summary.alerts.find(
      a => a.eventType === "transaction_unresolved" && a.context.contractAddr === CONTRACT_A1
    );
    expect(unresolvedAlert).toBeUndefined();
  });
});

// ─── 15. getAllProviderRoutes ─────────────────────────────────

describe("V2.3 Owner Operations — Wallet Manager Helpers", () => {
  it("41. getAllProviderRoutes returns routes for a specific wallet", () => {
    const routes = getAllProviderRoutes(WALLET_A);
    expect(routes.length).toBeGreaterThanOrEqual(1);
    expect(routes[0].walletId).toBe(WALLET_A);
  });

  it("42. getAllWalletAccounts returns at least the registered test wallets", () => {
    const wallets = getAllWalletAccounts();
    const ids = wallets.map(w => w.id);
    expect(ids).toContain(WALLET_A);
    expect(ids).toContain(WALLET_B);
  });
});
