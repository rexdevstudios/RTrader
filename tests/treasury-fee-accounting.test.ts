/**
 * tests/treasury-fee-accounting.test.ts
 *
 * Test suite for Milestone V2.2 — Treasury & Fee Accounting
 *
 * 30 Comprehensive Scenarios:
 *  1. Fee Scanner: Detect claimable creator fee on EVM deployment
 *  2. Fee Scanner: Detect claimable reward on Solana deployment
 *  3. Idempotency: Repeated scans for same deployment produce zero duplicate fee events
 *  4. Fee Lifecycle: Classifies fees into 'detected', 'claimable', or 'claimed'
 *  5. Re-recording existing event_key returns existing FeeEvent without mutation
 *  6. Fee Claimer: Successfully claims claimable fee when on-chain tx is verified
 *  7. Fee Claimer: Rejects claiming a fee that is already in 'claimed' status
 *  8. Fee Claimer: Rejects claiming a fee in 'detected' status (must be 'claimable')
 *  9. Fee Claimer: Rejects claim if wallet is missing or disabled
 *  10. Fee Claimer: Rejects claim if no transaction hash is provided
 *  11. Fee Claimer: On-chain transaction failure transitions fee event to 'failed'
 *  12. Fee Claimer: Failed claim does NOT write any credit entry to treasury_ledger
 *  13. Treasury Ledger: Claimed fee automatically posts an immutable credit entry
 *  14. Treasury Ledger: Verified positive Realized PnL from position posts credit entry
 *  15. Treasury Ledger: Non-positive or unverified PnL is NOT credited to treasury
 *  16. Treasury Ledger: Repeated posting of same position PnL is idempotent
 *  17. Treasury Ledger: Repeated posting of same fee claim is idempotent
 *  18. Treasury Sweeper: Validates destination address and rejects invalid address format
 *  19. Treasury Sweeper: Rejects sweep when destination address is missing
 *  20. Treasury Sweeper: Rejects sweep when balance is below minimum threshold
 *  21. Treasury Sweeper: Accurately subtracts gas reserve buffer from swept amount
 *  22. Treasury Sweeper: Successfully executes and records confirmed sweep with verified tx
 *  23. Treasury Sweeper: Confirmed sweep automatically posts debit entry to treasury_ledger
 *  24. Treasury Sweeper: Failed on-chain sweep transaction marks sweep as 'failed'
 *  25. Treasury Sweeper: Failed sweep does NOT post debit entry to treasury_ledger
 *  26. Multi-Wallet Isolation: Fee events are strictly segregated by wallet_id
 *  27. Multi-Wallet Isolation: Treasury ledger summary for Wallet A isolates from Wallet B
 *  28. Treasury Summary: Accurately aggregates total fees, PnL, sweeps, and net balance by asset
 *  29. Financial Lineage: End-to-end trace from Wallet -> Deployment -> Position -> PnL -> Treasury
 *  30. Dynamic Wallet: Works with dynamically registered WalletAccounts without relying on env keys
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import {
  scanCreatorFees,
  type FeeSourceAdapter,
  type DetectedFee,
} from "../src/modules/treasury/fee-scanner.ts";
import {
  claimAvailableFee,
  claimAllAvailableFees,
} from "../src/modules/treasury/fee-claimer.ts";
import {
  recordFeeClaimedToLedger,
  recordRealizedPnlToLedger,
  recordSweepToLedger,
  getTreasuryBalanceSummary,
  getTreasuryLedgerEntries,
} from "../src/modules/treasury/treasury-ledger.ts";
import {
  executeTreasurySweep,
  isValidDestinationAddress,
  getTreasurySweeps,
} from "../src/modules/treasury/treasury-sweeper.ts";
import {
  registerWalletAccount,
  getWalletAccount,
  updateWalletStatus,
} from "../src/modules/identity/wallet-manager.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  createPendingPosition,
  transitionPositionState,
  getPositionByContract,
  recordFeeEvent,
  getFeeEvents,
  getFeeEventById,
  getFeeEventByKey,
  updateFeeEventStatus,
  type DeployLog,
  type FeeEvent,
  type ActivePosition,
  DB_PATH,
} from "../src/db/vault.ts";
import * as evmVerifier from "../src/modules/reconciliation/evm-verifier.ts";
import * as solanaVerifier from "../src/modules/reconciliation/solana-verifier.ts";

const db = new Database(DB_PATH);

describe("Milestone V2.2 — Treasury & Fee Accounting", () => {
  beforeEach(() => {
    // Reset test data
    db.run("DELETE FROM treasury_ledger");
    db.run("DELETE FROM treasury_sweeps");
    db.run("DELETE FROM fee_events");
    db.run("DELETE FROM active_positions WHERE ticker LIKE 'TEST_TREASURY_%'");
    db.run("DELETE FROM deploy_logs WHERE ticker LIKE 'TEST_TREASURY_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'test_w_%'");
  });

  afterAll(() => {
    // Clean up
    db.run("DELETE FROM treasury_ledger");
    db.run("DELETE FROM treasury_sweeps");
    db.run("DELETE FROM fee_events");
    db.run("DELETE FROM active_positions WHERE ticker LIKE 'TEST_TREASURY_%'");
    db.run("DELETE FROM deploy_logs WHERE ticker LIKE 'TEST_TREASURY_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'test_w_%'");
  });

  // 1. Fee Scanner: Detect claimable creator fee on EVM deployment
  it("1. should detect and record claimable creator fees on an EVM deployment", async () => {
    registerWalletAccount({
      id: "test_w_evm",
      label: "EVM Deployer",
      evmAddress: "0x1111111111111111111111111111111111111111",
      status: "ACTIVE",
    });

    const deployId = logDeploy({
      chain: "base",
      tokenName: "Treasury EVM Token",
      ticker: "TEST_TREASURY_EVM",
      contractAddr: "0x2222222222222222222222222222222222222222",
      poolId: "pool_evm_123",
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: "test_w_evm",
    });

    // Mock Adapter returning claimable creator fee
    const mockEvmAdapter: FeeSourceAdapter = {
      name: "bankr_creator_fee",
      supportsChain: (c) => c === "base",
      scanFees: async (dep, wallet) => [
        {
          source: "bankr_creator_fee",
          chain: "base",
          tokenAddress: dep.contractAddr,
          poolId: dep.poolId,
          beneficiaryAddress: wallet.evmAddress!,
          tokenSymbol: "ETH",
          amountRaw: "50000000000000000", // 0.05 ETH
          amountFormatted: 0.05,
          status: "claimable",
          epochOrIdentifier: "epoch_1",
        },
      ],
    };

    const fees = await scanCreatorFees({
      walletId: "test_w_evm",
      chain: "base",
      customAdapters: [mockEvmAdapter],
    });

    expect(fees.length).toBe(1);
    expect(fees[0].walletId).toBe("test_w_evm");
    expect(fees[0].tokenSymbol).toBe("ETH");
    expect(fees[0].amountFormatted).toBe(0.05);
    expect(fees[0].status).toBe("claimable");
    expect(fees[0].beneficiaryAddress).toBe("0x1111111111111111111111111111111111111111");
  });

  // 2. Fee Scanner: Detect claimable reward on Solana deployment
  it("2. should detect and record claimable creator reward on a Solana deployment", async () => {
    registerWalletAccount({
      id: "test_w_sol",
      label: "Solana Creator",
      solanaAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      status: "ACTIVE",
    });

    logDeploy({
      chain: "solana",
      tokenName: "Treasury Solana Token",
      ticker: "TEST_TREASURY_SOL",
      contractAddr: "SolMintAddress1111111111111111111111111111111",
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: "test_w_sol",
    });

    const mockSolAdapter: FeeSourceAdapter = {
      name: "pumpfun_creator_reward",
      supportsChain: (c) => c === "solana",
      scanFees: async (dep, wallet) => [
        {
          source: "pumpfun_creator_reward",
          chain: "solana",
          tokenAddress: dep.contractAddr,
          beneficiaryAddress: wallet.solanaAddress!,
          tokenSymbol: "SOL",
          amountRaw: "1500000000", // 1.5 SOL
          amountFormatted: 1.5,
          status: "claimable",
          epochOrIdentifier: "curve_completion",
        },
      ],
    };

    const fees = await scanCreatorFees({
      walletId: "test_w_sol",
      chain: "solana",
      customAdapters: [mockSolAdapter],
    });

    expect(fees.length).toBe(1);
    expect(fees[0].walletId).toBe("test_w_sol");
    expect(fees[0].tokenSymbol).toBe("SOL");
    expect(fees[0].amountFormatted).toBe(1.5);
    expect(fees[0].status).toBe("claimable");
  });

  // 3. Idempotency: Repeated scans produce zero duplicate fee events
  it("3. should enforce idempotency so repeated scans never duplicate fee events", async () => {
    registerWalletAccount({
      id: "test_w_idemp",
      label: "Idempotent Wallet",
      evmAddress: "0x3333333333333333333333333333333333333333",
    });

    logDeploy({
      chain: "base",
      tokenName: "Idemp Token",
      ticker: "TEST_TREASURY_IDEMP",
      contractAddr: "0x4444444444444444444444444444444444444444",
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: "test_w_idemp",
    });

    const mockAdapter: FeeSourceAdapter = {
      name: "bankr_creator_fee",
      supportsChain: () => true,
      scanFees: async (dep, wallet) => [
        {
          source: "bankr_creator_fee",
          chain: "base",
          tokenAddress: dep.contractAddr,
          beneficiaryAddress: wallet.evmAddress!,
          tokenSymbol: "ETH",
          amountRaw: "10000000000000000",
          amountFormatted: 0.01,
          status: "claimable",
          epochOrIdentifier: "repeatable_epoch_10",
        },
      ],
    };

    // First scan
    await scanCreatorFees({ walletId: "test_w_idemp", customAdapters: [mockAdapter] });
    const countFirst = getFeeEvents({ walletId: "test_w_idemp" }).length;

    // Second scan (identical state)
    await scanCreatorFees({ walletId: "test_w_idemp", customAdapters: [mockAdapter] });
    const countSecond = getFeeEvents({ walletId: "test_w_idemp" }).length;

    expect(countFirst).toBe(1);
    expect(countSecond).toBe(1); // No new rows created!
  });

  // 4. Fee Lifecycle: Classifies fees into 'detected', 'claimable', or 'claimed'
  it("4. should accurately store and filter fees by lifecycle status", () => {
    recordFeeEvent({
      eventKey: "test_fee_det",
      walletId: "test_w_1",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.0001,
      status: "detected",
    });

    recordFeeEvent({
      eventKey: "test_fee_cla",
      walletId: "test_w_1",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "200",
      amountFormatted: 0.0002,
      status: "claimable",
    });

    const detected = getFeeEvents({ status: "detected" });
    const claimable = getFeeEvents({ status: "claimable" });

    expect(detected.some((f) => f.eventKey === "test_fee_det")).toBe(true);
    expect(claimable.some((f) => f.eventKey === "test_fee_cla")).toBe(true);
  });

  // 5. Re-recording existing event_key returns existing FeeEvent without mutation
  it("5. should return existing FeeEvent when re-recording with matching event_key", () => {
    const first = recordFeeEvent({
      eventKey: "test_key_unique",
      walletId: "test_w_1",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "500",
      amountFormatted: 0.0005,
      status: "claimable",
    });

    const second = recordFeeEvent({
      eventKey: "test_key_unique",
      walletId: "test_w_1",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "9999", // Different amount should NOT overwrite existing row
      amountFormatted: 9.999,
      status: "claimable",
    });

    expect(second.id).toBe(first.id);
    expect(second.amountFormatted).toBe(0.0005);
  });

  // 6. Fee Claimer: Successfully claims claimable fee when on-chain tx is verified
  it("6. should claim a claimable fee and update status to 'claimed' with verified tx", async () => {
    registerWalletAccount({
      id: "test_w_claim_ok",
      label: "Claim OK",
      evmAddress: "0x1234567890123456789012345678901234567890",
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_fee_to_claim",
      walletId: "test_w_claim_ok",
      chain: "base",
      source: "bankr_creator_fee",
      beneficiaryAddress: "0x1234567890123456789012345678901234567890",
      tokenSymbol: "ETH",
      amountRaw: "25000000000000000",
      amountFormatted: 0.025,
      status: "claimable",
    });

    // Mock EVM receipt verification as confirmed
    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
      blockNumber: 12345678n,
    });

    const result = await claimAvailableFee(fee.id, {
      customTxHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("claimed");

    const updated = getFeeEventById(fee.id);
    expect(updated?.status).toBe("claimed");
    expect(updated?.claimTxHash).toContain("0xabcdef");
    expect(updated?.claimedAt).not.toBeNull();

    spy.mockRestore();
  });

  // 7. Fee Claimer: Rejects claiming a fee that is already in 'claimed' status
  it("7. should reject claiming a fee event that is already 'claimed'", async () => {
    registerWalletAccount({ id: "test_w_already", label: "Already Claimed" });
    const fee = recordFeeEvent({
      eventKey: "test_fee_already_claimed",
      walletId: "test_w_already",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.0001,
      status: "claimed",
    });

    const res = await claimAvailableFee(fee.id, { customTxHash: "0x123" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("must be 'claimable'");
  });

  // 8. Fee Claimer: Rejects claiming a fee in 'detected' status
  it("8. should reject claiming a fee event that is only 'detected' and not yet 'claimable'", async () => {
    registerWalletAccount({ id: "test_w_det", label: "Detected Only" });
    const fee = recordFeeEvent({
      eventKey: "test_fee_detected_only",
      walletId: "test_w_det",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.0001,
      status: "detected",
    });

    const res = await claimAvailableFee(fee.id, { customTxHash: "0x123" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("must be 'claimable'");
  });

  // 9. Fee Claimer: Rejects claim if wallet is missing or disabled
  it("9. should reject claim if associated wallet is DISABLED", async () => {
    registerWalletAccount({
      id: "test_w_disabled",
      label: "Disabled Wallet",
      status: "DISABLED",
    });

    const fee = recordFeeEvent({
      eventKey: "test_fee_dis_wallet",
      walletId: "test_w_disabled",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.0001,
      status: "claimable",
    });

    const res = await claimAvailableFee(fee.id, { customTxHash: "0x123" });
    expect(res.success).toBe(false);
    expect(res.error).toContain("DISABLED");
  });

  // 10. Fee Claimer: Rejects claim if no transaction hash is provided
  it("10. should reject claim if no transaction hash is provided", async () => {
    registerWalletAccount({ id: "test_w_notx", label: "No Tx" });
    const fee = recordFeeEvent({
      eventKey: "test_fee_notx",
      walletId: "test_w_notx",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.0001,
      status: "claimable",
    });

    const res = await claimAvailableFee(fee.id);
    expect(res.success).toBe(false);
    expect(res.error).toContain("No claim transaction hash provided");
  });

  // 11. Fee Claimer: On-chain transaction failure transitions fee event to 'failed'
  it("11. should transition fee event status to 'failed' if on-chain transaction reverts", async () => {
    registerWalletAccount({ id: "test_w_fail_tx", label: "Fail Tx" });
    const fee = recordFeeEvent({
      eventKey: "test_fee_revert",
      walletId: "test_w_fail_tx",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.0001,
      status: "claimable",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "failed",
      reason: "Transaction reverted: Execution reverted",
    });

    const res = await claimAvailableFee(fee.id, { customTxHash: "0xrevertedtx" });
    expect(res.success).toBe(false);
    expect(res.status).toBe("failed");

    const updated = getFeeEventById(fee.id);
    expect(updated?.status).toBe("failed");

    spy.mockRestore();
  });

  // 12. Fee Claimer: Failed claim does NOT write any credit entry to treasury_ledger
  it("12. should NOT write any credit to treasury_ledger when claim fails", async () => {
    registerWalletAccount({ id: "test_w_no_credit", label: "No Credit" });
    const fee = recordFeeEvent({
      eventKey: "test_fee_nocredit",
      walletId: "test_w_no_credit",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.0001,
      status: "claimable",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "failed",
    });

    await claimAvailableFee(fee.id, { customTxHash: "0xfail" });

    const ledgerEntries = getTreasuryLedgerEntries({ walletId: "test_w_no_credit" });
    expect(ledgerEntries.length).toBe(0);

    spy.mockRestore();
  });

  // 13. Treasury Ledger: Claimed fee automatically posts an immutable credit entry
  it("13. should post an immutable credit entry to treasury_ledger on confirmed claim", () => {
    const fee: FeeEvent = {
      id: 888,
      eventKey: "test_key_888",
      walletId: "test_w_ledger",
      chain: "base",
      source: "bankr_creator_fee",
      beneficiaryAddress: "0xbeneficiary",
      tokenSymbol: "ETH",
      amountRaw: "50000000000000000",
      amountFormatted: 0.05,
      status: "claimed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const entry = recordFeeClaimedToLedger(fee, "0xtx12345");

    expect(entry.walletId).toBe("test_w_ledger");
    expect(entry.eventType).toBe("fee_claimed");
    expect(entry.direction).toBe("credit");
    expect(entry.amountFormatted).toBe(0.05);
    expect(entry.tokenSymbol).toBe("ETH");
    expect(entry.txHash).toBe("0xtx12345");
  });

  // 14. Treasury Ledger: Verified positive Realized PnL from position posts credit entry
  it("14. should post credit entry to treasury_ledger when position closes with verified positive PnL", () => {
    const pos: ActivePosition = {
      id: 777,
      deployLogId: 1,
      chain: "base",
      contractAddr: "0xcontract777",
      ticker: "TEST_TREASURY_PNL",
      snipeAmount: 0.05,
      entryPrice: 0.001,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      status: "sold_tp",
      walletId: "test_w_pnl",
      walletAddress: "0xwallet777",
      realizedPnl: 0.045, // Net profit of +0.045 ETH
      pnlStatus: "calculated",
      sellTxHash: "0xselltx123",
    };

    const entry = recordRealizedPnlToLedger(pos);
    expect(entry).not.toBeNull();
    expect(entry?.walletId).toBe("test_w_pnl");
    expect(entry?.eventType).toBe("realized_pnl_credited");
    expect(entry?.direction).toBe("credit");
    expect(entry?.amountFormatted).toBe(0.045);
    expect(entry?.tokenSymbol).toBe("ETH");
  });

  // 15. Treasury Ledger: Non-positive or unverified PnL is NOT credited to treasury
  it("15. should handle treasury ledger correctly for losses and unverified PnL", () => {
    const lossPos: ActivePosition = {
      id: 778,
      deployLogId: 1,
      chain: "base",
      contractAddr: "0xloss",
      ticker: "TEST_TREASURY_LOSS",
      snipeAmount: 0.05,
      entryPrice: 0.001,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      status: "sold_sl",
      walletId: "test_w_loss",
      realizedPnl: -0.015, // Loss
      pnlStatus: "calculated",
    };

    // M3 FIX: Losses now create debit entries for accurate accounting
    const entry = recordRealizedPnlToLedger(lossPos);
    expect(entry).not.toBeNull();
    expect(entry!.direction).toBe("debit");
    expect(entry!.amountFormatted).toBeCloseTo(0.015, 4);

    const unverifiedPos: ActivePosition = {
      ...lossPos,
      id: 779,
      realizedPnl: 0.05,
      pnlStatus: "pending", // Unverified — must be rejected
    };

    const entry2 = recordRealizedPnlToLedger(unverifiedPos);
    expect(entry2).toBeNull();
  });

  // 16. Treasury Ledger: Repeated posting of same position PnL is idempotent
  it("16. should enforce idempotency when posting position PnL to ledger multiple times", () => {
    const pos: ActivePosition = {
      id: 780,
      deployLogId: 1,
      chain: "base",
      contractAddr: "0xidemp_pos",
      ticker: "TEST_TREASURY_IDEMP_POS",
      snipeAmount: 0.05,
      entryPrice: 0.001,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      status: "sold_tp",
      walletId: "test_w_idemp_pos",
      realizedPnl: 0.02,
      pnlStatus: "calculated",
    };

    recordRealizedPnlToLedger(pos);
    const countBefore = getTreasuryLedgerEntries({ walletId: "test_w_idemp_pos" }).length;

    recordRealizedPnlToLedger(pos);
    const countAfter = getTreasuryLedgerEntries({ walletId: "test_w_idemp_pos" }).length;

    expect(countBefore).toBe(1);
    expect(countAfter).toBe(1);
  });

  // 17. Treasury Ledger: Repeated posting of same fee claim is idempotent
  it("17. should enforce idempotency when posting fee claim to ledger multiple times", () => {
    const fee: FeeEvent = {
      id: 889,
      eventKey: "test_key_889",
      walletId: "test_w_idemp_fee",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0x111",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.001,
      status: "claimed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    recordFeeClaimedToLedger(fee, "0xtx_repeat");
    const countBefore = getTreasuryLedgerEntries({ walletId: "test_w_idemp_fee" }).length;

    recordFeeClaimedToLedger(fee, "0xtx_repeat");
    const countAfter = getTreasuryLedgerEntries({ walletId: "test_w_idemp_fee" }).length;

    expect(countBefore).toBe(1);
    expect(countAfter).toBe(1);
  });

  // 18. Treasury Sweeper: Validates destination address and rejects invalid address format
  it("18. should validate destination address format according to chain", () => {
    expect(isValidDestinationAddress("0x1234567890123456789012345678901234567890", "base")).toBe(true);
    expect(isValidDestinationAddress("invalid_evm_address", "base")).toBe(false);
    expect(isValidDestinationAddress("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", "solana")).toBe(true);
    expect(isValidDestinationAddress("tooshort", "solana")).toBe(false);
  });

  // 19. Treasury Sweeper: Rejects sweep when destination address is missing
  it("19. should reject treasury sweep if destination address is not configured", async () => {
    registerWalletAccount({
      id: "test_w_sweep_nodest",
      label: "No Dest",
      evmAddress: "0x1234567890123456789012345678901234567890",
    });

    const res = await executeTreasurySweep({
      walletId: "test_w_sweep_nodest",
      chain: "base",
      tokenSymbol: "ETH",
      amountFormatted: 0.5,
      customDestination: undefined, // No destination provided
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("destination address");
  });

  // 20. Treasury Sweeper: Rejects sweep when balance is below minimum threshold
  it("20. should reject sweep when amount is below configured minimum threshold", async () => {
    registerWalletAccount({
      id: "test_w_sweep_low",
      label: "Low Balance",
      evmAddress: "0x1234567890123456789012345678901234567890",
    });

    const res = await executeTreasurySweep({
      walletId: "test_w_sweep_low",
      chain: "base",
      tokenSymbol: "ETH",
      amountFormatted: 0.01, // Below min threshold (0.1 ETH)
      customDestination: "0x9999999999999999999999999999999999999999",
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("below minimum threshold");
  });

  // 21. Treasury Sweeper: Accurately subtracts gas reserve buffer from swept amount
  it("21. should reserve gas buffer from native amount during sweep", async () => {
    registerWalletAccount({
      id: "test_w_sweep_reserve",
      label: "Reserve Wallet",
      evmAddress: "0x1234567890123456789012345678901234567890",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
    });

    const res = await executeTreasurySweep({
      walletId: "test_w_sweep_reserve",
      chain: "base",
      tokenSymbol: "ETH",
      amountFormatted: 1.0, // 1.0 ETH total
      customDestination: "0x9999999999999999999999999999999999999999",
      mockTxHash: "0xsweeptx123",
    });

    expect(res.success).toBe(true);
    // Total 1.0 - 0.01 reserve = 0.99 ETH swept
    expect(res.sweep?.amountFormatted).toBeCloseTo(0.99, 4);

    spy.mockRestore();
  });

  // 22. Treasury Sweeper: Successfully executes and records confirmed sweep with verified tx
  it("22. should record confirmed sweep in treasury_sweeps with on-chain tx attribution", async () => {
    registerWalletAccount({
      id: "test_w_sweep_ok",
      label: "Sweep OK",
      evmAddress: "0x1234567890123456789012345678901234567890",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
    });

    const res = await executeTreasurySweep({
      walletId: "test_w_sweep_ok",
      chain: "base",
      tokenSymbol: "ETH",
      amountFormatted: 0.5,
      customDestination: "0x9999999999999999999999999999999999999999",
      mockTxHash: "0xsweepconfirmedtx",
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe("confirmed");
    expect(res.txHash).toBe("0xsweepconfirmedtx");

    const sweeps = getTreasurySweeps("test_w_sweep_ok");
    expect(sweeps.length).toBe(1);
    expect(sweeps[0].status).toBe("confirmed");
    expect(sweeps[0].destinationAddress).toBe("0x9999999999999999999999999999999999999999");

    spy.mockRestore();
  });

  // 23. Treasury Sweeper: Confirmed sweep automatically posts debit entry to treasury_ledger
  it("23. should post debit entry to treasury_ledger when sweep is confirmed", async () => {
    registerWalletAccount({
      id: "test_w_sweep_debit",
      label: "Sweep Debit",
      evmAddress: "0x1234567890123456789012345678901234567890",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
    });

    await executeTreasurySweep({
      walletId: "test_w_sweep_debit",
      chain: "base",
      tokenSymbol: "ETH",
      amountFormatted: 0.5,
      customDestination: "0x9999999999999999999999999999999999999999",
      mockTxHash: "0xdebittx",
    });

    const entries = getTreasuryLedgerEntries({ walletId: "test_w_sweep_debit" });
    expect(entries.length).toBe(1);
    expect(entries[0].direction).toBe("debit");
    expect(entries[0].eventType).toBe("treasury_sweep");
    expect(entries[0].destinationAddress).toBe("0x9999999999999999999999999999999999999999");

    spy.mockRestore();
  });

  // 24. Treasury Sweeper: Failed on-chain sweep transaction marks sweep as 'failed'
  it("24. should mark sweep status as 'failed' if on-chain transaction reverts", async () => {
    registerWalletAccount({
      id: "test_w_sweep_fail",
      label: "Sweep Fail",
      evmAddress: "0x1234567890123456789012345678901234567890",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "failed",
    });

    const res = await executeTreasurySweep({
      walletId: "test_w_sweep_fail",
      chain: "base",
      tokenSymbol: "ETH",
      amountFormatted: 0.5,
      customDestination: "0x9999999999999999999999999999999999999999",
      mockTxHash: "0xreverted_sweep",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("failed");

    const sweeps = getTreasurySweeps("test_w_sweep_fail");
    expect(sweeps[0].status).toBe("failed");

    spy.mockRestore();
  });

  // 25. Treasury Sweeper: Failed sweep does NOT post debit entry to treasury_ledger
  it("25. should NOT post debit to treasury_ledger if sweep fails", async () => {
    registerWalletAccount({
      id: "test_w_sweep_no_debit",
      label: "No Debit",
      evmAddress: "0x1234567890123456789012345678901234567890",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "failed",
    });

    await executeTreasurySweep({
      walletId: "test_w_sweep_no_debit",
      chain: "base",
      tokenSymbol: "ETH",
      amountFormatted: 0.5,
      customDestination: "0x9999999999999999999999999999999999999999",
      mockTxHash: "0xfail_sweep",
    });

    const entries = getTreasuryLedgerEntries({ walletId: "test_w_sweep_no_debit" });
    expect(entries.length).toBe(0);

    spy.mockRestore();
  });

  // 26. Multi-Wallet Isolation: Fee events are strictly segregated by wallet_id
  it("26. should isolate fee events between different wallet IDs", () => {
    recordFeeEvent({
      eventKey: "test_fee_wA",
      walletId: "test_w_A",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0xA",
      tokenSymbol: "ETH",
      amountRaw: "100",
      amountFormatted: 0.1,
      status: "claimable",
    });

    recordFeeEvent({
      eventKey: "test_fee_wB",
      walletId: "test_w_B",
      chain: "base",
      source: "bankr",
      beneficiaryAddress: "0xB",
      tokenSymbol: "ETH",
      amountRaw: "200",
      amountFormatted: 0.2,
      status: "claimable",
    });

    const feesA = getFeeEvents({ walletId: "test_w_A" });
    const feesB = getFeeEvents({ walletId: "test_w_B" });

    expect(feesA.length).toBe(1);
    expect(feesA[0].walletId).toBe("test_w_A");
    expect(feesB.length).toBe(1);
    expect(feesB[0].walletId).toBe("test_w_B");
  });

  // 27. Multi-Wallet Isolation: Treasury ledger summary isolates Wallet A from Wallet B
  it("27. should isolate ledger entries and balance summaries between distinct wallets", () => {
    // Credit 0.5 ETH to Wallet A
    recordFeeClaimedToLedger(
      {
        id: 101,
        eventKey: "test_iso_101",
        walletId: "test_w_iso_A",
        chain: "base",
        source: "bankr",
        beneficiaryAddress: "0xA",
        tokenSymbol: "ETH",
        amountRaw: "500000000000000000",
        amountFormatted: 0.5,
        status: "claimed",
        createdAt: "",
        updatedAt: "",
      },
      "0xtxA"
    );

    // Credit 1.2 ETH to Wallet B
    recordFeeClaimedToLedger(
      {
        id: 102,
        eventKey: "test_iso_102",
        walletId: "test_w_iso_B",
        chain: "base",
        source: "bankr",
        beneficiaryAddress: "0xB",
        tokenSymbol: "ETH",
        amountRaw: "1200000000000000000",
        amountFormatted: 1.2,
        status: "claimed",
        createdAt: "",
        updatedAt: "",
      },
      "0xtxB"
    );

    const summaryA = getTreasuryBalanceSummary("test_w_iso_A");
    const summaryB = getTreasuryBalanceSummary("test_w_iso_B");

    expect(summaryA.totalFeesClaimedFormatted).toBe(0.5);
    expect(summaryA.netTreasuryBalanceFormatted).toBe(0.5);

    expect(summaryB.totalFeesClaimedFormatted).toBe(1.2);
    expect(summaryB.netTreasuryBalanceFormatted).toBe(1.2);
  });

  // 28. Treasury Summary: Accurately aggregates fees + PnL - sweeps
  it("28. should accurately compute net treasury balance: (fees + PnL) - sweeps", () => {
    const walletId = "test_w_balance_calc";

    // 1. Fee claim credit: +0.2 ETH
    recordFeeClaimedToLedger(
      {
        id: 201,
        eventKey: "test_sum_201",
        walletId,
        chain: "base",
        source: "bankr",
        beneficiaryAddress: "0xuser",
        tokenSymbol: "ETH",
        amountRaw: "200000000000000000",
        amountFormatted: 0.2,
        status: "claimed",
        createdAt: "",
        updatedAt: "",
      },
      "0xclaim"
    );

    // 2. Realized PnL credit: +0.3 ETH
    recordRealizedPnlToLedger({
      id: 555,
      deployLogId: 1,
      chain: "base",
      contractAddr: "0xtrade",
      ticker: "TEST_TREASURY_CALC",
      snipeAmount: 0.05,
      entryPrice: 1,
      takeProfitX: 2,
      stopLossPct: 0.3,
      status: "sold_tp",
      walletId,
      realizedPnl: 0.3,
      pnlStatus: "calculated",
    });

    // 3. Sweep debit: -0.15 ETH
    recordSweepToLedger({
      id: 301,
      sweepId: "test_sweep_301",
      walletId,
      chain: "base",
      tokenSymbol: "ETH",
      amountRaw: "150000000000000000",
      amountFormatted: 0.15,
      sourceAddress: "0xuser",
      destinationAddress: "0xcold",
      status: "confirmed",
      createdAt: "",
      updatedAt: "",
    });

    const summary = getTreasuryBalanceSummary(walletId);
    expect(summary.totalFeesClaimedFormatted).toBe(0.2);
    expect(summary.totalPnlCreditedFormatted).toBe(0.3);
    expect(summary.totalSweptFormatted).toBe(0.15);

    // 0.2 + 0.3 - 0.15 = 0.35
    expect(summary.netTreasuryBalanceFormatted).toBeCloseTo(0.35, 4);
    expect(summary.byAsset["ETH"].net).toBeCloseTo(0.35, 4);
  });

  // 29. Financial Lineage: End-to-end trace from Wallet -> Deployment -> Position -> PnL -> Treasury
  it("29. should preserve complete financial lineage from wallet to treasury ledger", () => {
    const wallet = registerWalletAccount({
      id: "test_w_lineage",
      label: "Lineage Master",
      evmAddress: "0x5555555555555555555555555555555555555555",
    });

    const deployLogId = logDeploy({
      chain: "base",
      tokenName: "Lineage Coin",
      ticker: "TEST_TREASURY_LINEAGE",
      contractAddr: "0x6666666666666666666666666666666666666666",
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      walletId: wallet.id,
    });

    createPendingPosition({
      deployLogId,
      chain: "base",
      contractAddr: "0x6666666666666666666666666666666666666666",
      ticker: "TEST_TREASURY_LINEAGE",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletId: wallet.id,
    });

    transitionPositionState(
      "0x6666666666666666666666666666666666666666",
      "buy_submitted",
      "sold_tp",
      {
        realizedPnl: 0.08,
        pnlStatus: "calculated",
      }
    );

    const pos = getPositionByContract("0x6666666666666666666666666666666666666666")!;
    expect(pos.walletId).toBe("test_w_lineage");

    const ledgerEntry = recordRealizedPnlToLedger(pos)!;
    expect(ledgerEntry.walletId).toBe("test_w_lineage");
    expect(ledgerEntry.sourceRefType).toBe("active_position");
    expect(ledgerEntry.sourceRefId).toBe(String(pos.id));
  });

  // 30. Dynamic Wallet: Operates with dynamic accounts without global private keys
  it("30. should execute fee and treasury operations with dynamically created WalletAccount", async () => {
    const dynamicWallet = registerWalletAccount({
      id: "test_w_dynamic_operator",
      label: "Secondary Dynamic Operator",
      evmAddress: "0x7777777777777777777777777777777777777777",
      solanaAddress: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
      status: "ACTIVE",
    });

    expect(dynamicWallet.id).toBe("test_w_dynamic_operator");

    const fee = recordFeeEvent({
      eventKey: "test_fee_dyn",
      walletId: dynamicWallet.id,
      chain: "base",
      source: "bankr_creator_fee",
      beneficiaryAddress: dynamicWallet.evmAddress!,
      tokenSymbol: "ETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claimable",
    });

    const spy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
    });

    const claimRes = await claimAvailableFee(fee.id, { customTxHash: "0xdyntx" });
    expect(claimRes.success).toBe(true);

    const summary = getTreasuryBalanceSummary(dynamicWallet.id);
    expect(summary.totalFeesClaimedFormatted).toBe(0.01);
    expect(summary.walletId).toBe("test_w_dynamic_operator");

    spy.mockRestore();
  });
});
