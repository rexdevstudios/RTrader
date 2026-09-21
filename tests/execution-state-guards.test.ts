/**
 * tests/execution-state-guards.test.ts
 *
 * Test suite for Milestone V2.1 — Task 2:
 * 1. simulation deployment -> no buy
 * 2. unknown deployment -> no buy
 * 3. failed deployment -> no buy
 * 4. missing contract address -> no buy
 * 5. unconfirmed deployment -> no buy
 * 6. confirmed deployment -> buy path allowed
 * 7. duplicate position prevented
 * 8. duplicate execution prevented (via locks)
 * 9. cron lock released after exception
 * 10. concurrent execution cannot both acquire lock
 * 11. concurrent exit cannot both submit sell
 * 12. sell request without confirmation does not close position
 * 13. restart/recovery does not create duplicate position
 * 14. malformed deployment result fails safely
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { confirmDeployment } from "../src/modules/deploy-guard.ts";
import {
  acquireLock,
  releaseLock,
  isLockHeld,
  createPendingPosition,
  hasActiveOrPendingPosition,
  transitionPositionState,
  getPositionsByStatus,
} from "../src/db/vault.ts";
import { handlePosition } from "../src/modules/market/price-monitor.ts";
import * as sniperModule from "../src/modules/sniper/basedbot-sniper.ts";
import axios from "axios";

describe("Milestone V2.1 Task 2 — Execution State & Safety Guards", () => {
  beforeEach(() => {
    // Release test locks
    releaseLock("test_deploy_lock");
    releaseLock("test_pipeline_lock");
    releaseLock("test_crash_lock");
  });

  afterEach(() => {
    releaseLock("test_deploy_lock");
    releaseLock("test_pipeline_lock");
    releaseLock("test_crash_lock");
  });

  // 1. simulation deployment -> no buy
  it("1. should guard simulation deployment: confirmed = false, isSimulation = true (NO BUY)", () => {
    const simResult = {
      success: true,
      contractAddress: "0x1111111111111111111111111111111111111111",
      poolId: "0xpool123",
      simulated: true,
      chain: "base",
    };

    const confirmation = confirmDeployment(simResult as any, "base");
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.isSimulation).toBe(true);
    expect(confirmation.isUnknown).toBe(false);
    expect(confirmation.reason).toContain("simulation");
  });

  // 2. unknown deployment -> no buy
  it("2. should guard unknown deployment: confirmed = false, isUnknown = true (NO BUY)", () => {
    const unknownResult = {
      success: false,
      status: "unknown" as const,
      error: "DEPLOYMENT_OUTCOME_UNKNOWN: Request timed out",
    };

    const confirmation = confirmDeployment(unknownResult as any, "base");
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.isSimulation).toBe(false);
    expect(confirmation.isUnknown).toBe(true);
    expect(confirmation.reason).toContain("DEPLOYMENT_OUTCOME_UNKNOWN");
  });

  // 3. failed deployment -> no buy
  it("3. should guard failed deployment: confirmed = false (NO BUY)", () => {
    const failedResult = {
      success: false,
      status: "failed" as const,
      error: "Insufficient native ETH balance for launch",
    };

    const confirmation = confirmDeployment(failedResult as any, "base");
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.isSimulation).toBe(false);
    expect(confirmation.isUnknown).toBe(false);
    expect(confirmation.reason).toContain("Insufficient native ETH");
  });

  // 4. missing contract address -> no buy
  it("4. should guard missing contract address: confirmed = false (NO BUY)", () => {
    const missingAddrResult = {
      success: true,
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      // missing contractAddress
    };

    const confirmation = confirmDeployment(missingAddrResult as any, "base");
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.reason).toContain("Missing contract address");
  });

  // 5. unconfirmed deployment (missing txHash for on-chain) -> no buy
  it("5. should guard unconfirmed deployment lacking txHash: confirmed = false (NO BUY)", () => {
    const unconfirmedResult = {
      success: true,
      contractAddress: "0x2222222222222222222222222222222222222222",
      // missing txHash
    };

    const confirmation = confirmDeployment(unconfirmedResult as any, "base");
    expect(confirmation.confirmed).toBe(false);
    expect(confirmation.reason).toContain("requires a valid transaction hash");
  });

  // 6. confirmed deployment -> buy path allowed
  it("6. should verify valid on-chain confirmed deployment: confirmed = true (BUY ALLOWED)", () => {
    const confirmedResult = {
      success: true,
      status: "success" as const,
      contractAddress: "0x2222222222222222222222222222222222222222",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      poolId: "0xpool123",
      simulated: false,
    };

    const confirmation = confirmDeployment(confirmedResult as any, "base");
    expect(confirmation.confirmed).toBe(true);
    expect(confirmation.isSimulation).toBe(false);
    expect(confirmation.isUnknown).toBe(false);
  });

  // 7. duplicate position prevented
  it("7. should prevent creating duplicate active or pending positions for same contract", () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    // First creation should succeed
    const first = createPendingPosition({
      deployLogId: 101,
      chain: "base",
      contractAddr: testContract,
      ticker: "TEST1",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
    });
    expect(first).toBe(true);
    expect(hasActiveOrPendingPosition(testContract)).toBe(true);

    // Second creation for same contract MUST fail (atomic unique constraint)
    const duplicate = createPendingPosition({
      deployLogId: 102,
      chain: "base",
      contractAddr: testContract,
      ticker: "TEST1",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
    });
    expect(duplicate).toBe(false);
  });

  // 8. duplicate execution prevented via lock
  it("8. should prevent duplicate execution when lock is already held", () => {
    const acquired1 = acquireLock("test_pipeline_lock", 60, "worker_1");
    expect(acquired1).toBe(true);
    expect(isLockHeld("test_pipeline_lock")).toBe(true);

    // Second worker attempts to acquire same lock -> MUST return false
    const acquired2 = acquireLock("test_pipeline_lock", 60, "worker_2");
    expect(acquired2).toBe(false);

    // Release lock
    releaseLock("test_pipeline_lock");
    expect(isLockHeld("test_pipeline_lock")).toBe(false);

    // Now it can be acquired again
    const acquired3 = acquireLock("test_pipeline_lock", 60, "worker_3");
    expect(acquired3).toBe(true);
  });

  // 9. cron lock released after exception in try-finally
  it("9. should guarantee lock release even when execution throws an unhandled exception", () => {
    const runPipelineWithException = () => {
      if (!acquireLock("test_crash_lock", 60)) {
        return false;
      }
      try {
        throw new Error("Simulated fatal pipeline crash");
      } finally {
        releaseLock("test_crash_lock");
      }
    };

    expect(() => runPipelineWithException()).toThrow("Simulated fatal pipeline crash");

    // Lock MUST be released
    expect(isLockHeld("test_crash_lock")).toBe(false);

    // Subsequent run can acquire without deadlock
    expect(acquireLock("test_crash_lock", 60)).toBe(true);
  });

  // 10. concurrent execution cannot both acquire lock
  it("10. should ensure atomic mutual exclusion across concurrent invocations", () => {
    const attempts = [
      acquireLock("test_deploy_lock", 60, "cycle_A"),
      acquireLock("test_deploy_lock", 60, "cycle_B"),
      acquireLock("test_deploy_lock", 60, "cycle_C"),
    ];

    const successes = attempts.filter((res) => res === true);
    const failures = attempts.filter((res) => res === false);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);
  });

  // 11. concurrent exit cannot both submit sell
  it("11. should atomically allow only one worker to transition POSITION_OPEN -> POSITION_CLOSING", () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 201,
      chain: "base",
      contractAddr: testContract,
      ticker: "RACE",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
    });

    // Move to 'open'
    transitionPositionState(testContract, "buy_submitted", "open", { entryPrice: 1.0 });

    // Concurrent exit attempts
    const worker1Transition = transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
    });
    const worker2Transition = transitionPositionState(testContract, "open", "closing", {
      exitReason: "take_profit",
    });

    expect(worker1Transition).toBe(true);
    // Worker 2 must receive false / no-op (conflict prevented)
    expect(worker2Transition).toBe(false);
  });

  // 12. sell request without confirmation does not close position
  it("12. should maintain POSITION_CLOSING state when sell request is sent without on-chain confirmation", async () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    createPendingPosition({
      deployLogId: 301,
      chain: "base",
      contractAddr: testContract,
      ticker: "EXIT_TEST",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
    });

    // Move to open with entry price $1.00
    transitionPositionState(testContract, "buy_submitted", "open", { entryPrice: 1.0 });

    // Mock DexScreener returning price $2.50 (triggering 2.0x TP)
    const axiosGetSpy = spyOn(axios, "get").mockResolvedValueOnce({
      status: 200,
      data: {
        pairs: [{ priceUsd: "2.50" }],
      },
    });

    // Mock sellToken returning true (message sent to telegram)
    const sellTokenSpy = spyOn(sniperModule, "sellToken").mockResolvedValueOnce(true);

    const pos = getPositionsByStatus("open").find((p) => p.contractAddr === testContract);
    expect(pos).toBeDefined();

    await handlePosition(pos!);

    // Position MUST be in 'closing' (NOT marked 'closed_tp' prematurely)
    const closingPositions = getPositionsByStatus("closing");
    const updated = closingPositions.find((p) => p.contractAddr === testContract);

    expect(updated).toBeDefined();
    expect(updated?.status).toBe("closing");
    expect(updated?.exitReason).toBe("take_profit");

    axiosGetSpy.mockRestore();
    sellTokenSpy.mockRestore();
  });

  // 13. restart/recovery does not create duplicate position
  it("13. should ensure process restart/recovery detects existing positions and skips duplicate creation", () => {
    const testContract = `0x${Math.random().toString(16).slice(2, 42).padEnd(40, "0")}`;

    // Cycle 1: position was created in buy_submitted
    createPendingPosition({
      deployLogId: 401,
      chain: "base",
      contractAddr: testContract,
      ticker: "RESTART_TEST",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
    });

    // Simulated restart: subsequent cycle checks if active/pending position exists
    const alreadyExists = hasActiveOrPendingPosition(testContract);
    expect(alreadyExists).toBe(true);

    // If bot attempts to re-create on restart, creation must return false
    const reCreate = createPendingPosition({
      deployLogId: 402,
      chain: "base",
      contractAddr: testContract,
      ticker: "RESTART_TEST",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
    });
    expect(reCreate).toBe(false);
  });

  // 14. malformed deployment result fails safely
  it("14. should safely reject malformed deployment results (null, undefined, invalid address format)", () => {
    expect(confirmDeployment(null, "base").confirmed).toBe(false);
    expect(confirmDeployment(undefined, "base").confirmed).toBe(false);
    expect(confirmDeployment({} as any, "base").confirmed).toBe(false);

    // Invalid EVM contract address format
    const malformedEvm = {
      success: true,
      status: "success" as const,
      contractAddress: "invalid_not_hex_address",
      txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const evmConf = confirmDeployment(malformedEvm as any, "base");
    expect(evmConf.confirmed).toBe(false);
    expect(evmConf.reason).toContain("Invalid contract address format");

    // Invalid Solana address format
    const malformedSolana = {
      success: true,
      status: "success" as const,
      contractAddress: "0xInvalidSolanaWith0x",
      txHash: "5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const solConf = confirmDeployment(malformedSolana as any, "solana");
    expect(solConf.confirmed).toBe(false);
    expect(solConf.reason).toContain("Invalid contract address format");
  });
});
