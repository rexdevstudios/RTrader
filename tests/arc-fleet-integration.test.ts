/**
 * tests/arc-fleet-integration.test.ts
 *
 * Automated Integration Test Suite for Arc Chain Fleet Classification,
 * Tri-Chain Preflight Audit, and On-Chain Reconciler Client Resolution.
 */

import { describe, it, expect } from "bun:test";
import {
  isLiveDeployment,
  isSimulatedDeployment,
  isTestFixture,
  classifyDeployment,
  getProductionFleet,
} from "../src/modules/fleet/fleet-registry.ts";
import {
  getEvmPublicClient,
  verifyEvmTransactionReceipt,
} from "../src/modules/reconciliation/evm-verifier.ts";
import { runDualChainAudit } from "../scripts/verify-dual-chain.ts";
import { runArcSimulation } from "../scripts/test-arc-simulation.ts";
import { ARC_CHAIN_ID } from "../src/modules/arc/index.ts";
import type { DeployLog, DeployLogRow } from "../src/db/vault.ts";

describe("Arc Chain Fleet & Reconciler Integration Test Suite", () => {
  // ─── 1. Fleet Registry Classification ───────────────────────────────────────
  describe("1. Fleet Registry Classification for Arc Chain", () => {
    const liveArcToken: DeployLogRow = {
      id: 7001,
      chain: "arc",
      tokenName: "Arc Official Token",
      ticker: "ARCOFF",
      contractAddr: "0xbc43ce8dec648ea298c4275559b81d6261c90b67",
      txHash: "0x85f9c6ad37917ac660678df25a6d0fcfbfcdde1de3d09b8316b08d29c9809279",
      status: "confirmed",
      lifecycleState: "DEPLOY_CONFIRMED",
      simulated: false,
      deployCost: 0.1,
      poolId: "0x1234567890123456789012345678901234567890",
      createdAt: "2026-09-16 12:00:00",
    };

    const simArcToken: DeployLogRow = {
      id: 7002,
      chain: "arc",
      tokenName: "Arc Quantum Meme",
      ticker: "AQM",
      contractAddr: "0x0000000000000000000000000000000000000000",
      txHash: "0xsimulated_arc_tx",
      status: "confirmed",
      lifecycleState: "DEPLOY_SIMULATED",
      simulated: true,
      deployCost: 0,
      createdAt: "2026-09-16 12:00:00",
    };

    const failedArcToken: DeployLogRow = {
      id: 7003,
      chain: "arc",
      tokenName: "Arc Failed Token",
      ticker: "ARCFAIL",
      contractAddr: "0x0000000000000000000000000000000000000000",
      txHash: "0x1234",
      status: "failed",
      lifecycleState: "FAILED",
      simulated: false,
      createdAt: "2026-09-16 12:00:00",
    };

    const fixtureArcToken: DeployLogRow = {
      id: 7004,
      chain: "arc",
      tokenName: "Arc Ephemeral Fixture",
      ticker: "FIX",
      contractAddr: null as any,
      txHash: null as any,
      status: "pending",
      lifecycleState: "DEPLOY_SUBMITTED",
      simulated: false,
      createdAt: "2026-09-16 12:00:00",
    };

    it("should classify confirmed live Arc token as LIVE", () => {
      expect(isLiveDeployment(liveArcToken)).toBe(true);
      expect(isSimulatedDeployment(liveArcToken)).toBe(false);
      expect(classifyDeployment(liveArcToken)).toBe("LIVE");
    });

    it("should classify simulated Arc token as SIMULATED", () => {
      expect(isLiveDeployment(simArcToken)).toBe(false);
      expect(isSimulatedDeployment(simArcToken)).toBe(true);
      expect(classifyDeployment(simArcToken)).toBe("SIMULATED");
    });

    it("should classify failed Arc token as FAILED", () => {
      expect(isLiveDeployment(failedArcToken)).toBe(false);
      expect(classifyDeployment(failedArcToken)).toBe("FAILED");
    });

    it("should classify Arc record without address as TEST_FIXTURE", () => {
      expect(isTestFixture(fixtureArcToken)).toBe(true);
      expect(classifyDeployment(fixtureArcToken)).toBe("TEST_FIXTURE");
    });
  });

  // ─── 2. On-Chain Reconciler & Client Resolution ─────────────────────────────
  describe("2. On-Chain EVM Reconciler Resolution for Arc Chain", () => {
    it("should resolve a valid Viem PublicClient for 'arc' with Chain ID 5042", async () => {
      const client = getEvmPublicClient("arc");
      expect(client).not.toBeNull();
      expect(client?.chain?.id).toBe(ARC_CHAIN_ID);

      const chainId = await client!.getChainId();
      expect(chainId).toBe(5042);
    });

    it("should be case-insensitive and handle whitespace in chain name", () => {
      const clientUpper = getEvmPublicClient("ARC");
      const clientSpaces = getEvmPublicClient("  arc  ");

      expect(clientUpper).not.toBeNull();
      expect(clientUpper?.chain?.id).toBe(5042);
      expect(clientSpaces).not.toBeNull();
      expect(clientSpaces?.chain?.id).toBe(5042);
    });

    it("should defensively handle malformed transaction hash without throwing", async () => {
      const res = await verifyEvmTransactionReceipt("0xinvalid", "arc");
      expect(res.status).toBe("error");
      expect(res.reason).toContain("Malformed EVM transaction hash");
    });

    it("should return pending for an unmined transaction hash on Arc", async () => {
      const unminedHash = "0x" + "0".repeat(64);
      const res = await verifyEvmTransactionReceipt(unminedHash, "arc");
      expect(res.status).toBe("pending");
      expect(res.reason).toContain("not yet mined");
    });
  });

  // ─── 3. Tri-Chain Preflight Audit Compatibility ─────────────────────────────
  describe("3. Tri-Chain Readiness Preflight Audit", () => {
    it("should return complete Tri-Chain audit result including Arc Mainnet", async () => {
      const audit = await runDualChainAudit({ silent: true });

      // Invariant: Backward-compatibility for Base and Solana
      expect(audit.base).toBeDefined();
      expect(audit.solana).toBeDefined();
      expect(audit.infrastructure).toBeDefined();
      expect(audit.overallVerdict).toBeDefined();

      // Invariant: Arc chain extension
      expect(audit.arc).toBeDefined();
      expect(audit.arc?.chainId).toBe(5042);
      expect(typeof audit.arc?.rpcConnected).toBe("boolean");
      expect(audit.arc?.rpcConnected).toBe(true);
      expect(typeof audit.arc?.operatorNativeUsdcBalance).toBe("number");
      expect(typeof audit.arc?.arcPadApiReady).toBe("boolean");
    }, 15000);
  });

  // ─── 4. End-to-End Zero-Gas Simulation Verification ─────────────────────────
  describe("4. Programmatic E2E Zero-Gas Simulation", () => {
    it("should execute all 5 phases of runArcSimulation successfully", async () => {
      const report = await runArcSimulation();

      expect(report.overallSuccess).toBe(true);
      expect(report.rpc.connected).toBe(true);
      expect(report.rpc.chainId).toBe(5042);
      expect(report.operator.address.startsWith("0x")).toBe(true);
      expect(report.simulation.success).toBe(true);
      expect(report.simulation.symbol).toBe("TESTARC");
      expect(report.database.simulatedFlag).toBe(true);
      expect(report.fleetClassification.category).toBe("SIMULATED");
      expect(report.fleetClassification.reconcilerChainMatch).toBe(true);
    }, 15000);
  });
});
