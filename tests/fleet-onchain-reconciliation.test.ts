import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios from "axios";
import {
  verifyEvmContractExists,
} from "../src/modules/reconciliation/evm-verifier.ts";
import {
  verifySolanaAccountExists,
} from "../src/modules/reconciliation/solana-verifier.ts";
import {
  reconcileFleetOnChain,
  reconcileFleetArmada,
} from "../src/modules/reconciliation/onchain-reconciler.ts";
import {
  logDeploy,
  getDeployLogByContract,
  getDeployLogById,
  updateDeployLifecycle,
} from "../src/db/vault.ts";

import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";

describe("Vault <-> On-Chain Reconciliation Engine (Phase 3 P1)", () => {
  let axiosGetSpy: ReturnType<typeof spyOn>;
  const createdDeployIds: number[] = [];

  beforeEach(() => {
    axiosGetSpy = spyOn(axios, "get");
  });

  afterEach(() => {
    axiosGetSpy?.mockRestore();
    if (createdDeployIds.length > 0) {
      const db = new Database(DB_PATH);
      try {
        for (const id of createdDeployIds) {
          db.run("DELETE FROM deploy_logs WHERE id = ?", [id]);
        }
      } finally {
        db.close();
      }
      createdDeployIds.length = 0;
    }
  });

  // === 1. EVM Contract Existence ===
  it("1. verifyEvmContractExists should return confirmed when contract has bytecode", async () => {
    const mockClient = {
      getBytecode: async () => "0x608060405234801561001057600080fd5b50",
    } as any;

    const result = await verifyEvmContractExists(
      "0x1234567890123456789012345678901234567890",
      "base",
      mockClient
    );
    expect(result.exists).toBe(true);
    expect(result.status).toBe("confirmed");
    expect(result.bytecodeSize).toBeGreaterThan(0);
  });

  it("2. verifyEvmContractExists should return not_found when bytecode is null or 0x", async () => {
    const mockClient = {
      getBytecode: async () => "0x",
    } as any;

    const result = await verifyEvmContractExists(
      "0x1234567890123456789012345678901234567890",
      "base",
      mockClient
    );
    expect(result.exists).toBe(false);
    expect(result.status).toBe("not_found");
  });

  it("3. verifyEvmContractExists should return unknown on RPC failure (fail-safe)", async () => {
    const mockClient = {
      getBytecode: async () => {
        throw new Error("ETIMEDOUT: Connection refused to RPC");
      },
    } as any;

    const result = await verifyEvmContractExists(
      "0x1234567890123456789012345678901234567890",
      "base",
      mockClient
    );
    expect(result.exists).toBe(false);
    expect(result.status).toBe("unknown");
    expect(result.reason).toContain("RPC_FAILURE");
  });

  // === 2. Solana Account Existence ===
  it("4. verifySolanaAccountExists should return confirmed when account exists", async () => {
    const mockConnection = {
      getAccountInfo: async () => ({
        lamports: 1000000,
        owner: { toBase58: () => "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      }),
    } as any;

    const result = await verifySolanaAccountExists(
      "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRH",
      mockConnection
    );
    expect(result.exists).toBe(true);
    expect(result.status).toBe("confirmed");
  });

  it("5. verifySolanaAccountExists should return not_found when account is null", async () => {
    const mockConnection = {
      getAccountInfo: async () => null,
    } as any;

    const result = await verifySolanaAccountExists(
      "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRH",
      mockConnection
    );
    expect(result.exists).toBe(false);
    expect(result.status).toBe("not_found");
  });

  it("6. verifySolanaAccountExists should return unknown on RPC failure", async () => {
    const mockConnection = {
      getAccountInfo: async () => {
        throw new Error("RPC node blockhash expired");
      },
    } as any;

    const result = await verifySolanaAccountExists(
      "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRH",
      mockConnection
    );
    expect(result.exists).toBe(false);
    expect(result.status).toBe("unknown");
  });

  // === 3. Vault <-> On-Chain Reconciliation Integration ===
  it("7. reconcileFleetOnChain should discover DEX pair and promote DEPLOY_SUBMITTED to DEPLOY_CONFIRMED", async () => {
    const testCa = `0x${Math.random().toString(16).slice(2, 10)}${"0".repeat(32)}`;
    const deployId = logDeploy({
      chain: "base",
      tokenName: "Reconciliation Test Token",
      ticker: "RECTEST",
      contractAddr: testCa,
      status: "pending",
      lifecycleState: "DEPLOY_SUBMITTED",
      simulated: false,
    });
    createdDeployIds.push(deployId);

    const mockClient = {
      getBytecode: async () => "0x608060405234801561001057600080fd5b50",
    } as any;

    const mockPairAddress = "0x9876543210987654321098765432109876543210";
    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        pairs: [
          {
            pairAddress: mockPairAddress,
            dexId: "aerodrome",
            priceUsd: "0.000456",
            liquidity: { usd: 25000 },
          },
        ],
      },
    });

    const report = await reconcileFleetOnChain(testCa, "base", {
      customClient: mockClient,
      fetchDex: true,
    });

    expect(report.onChainVerified).toBe(true);
    expect(report.onChainStatus).toBe("confirmed");
    expect(report.poolId).toBe(mockPairAddress);
    expect(report.liquidityUsd).toBe(25000);
    expect(report.poolUpdated).toBe(true);
    expect(report.lifecycleUpdated).toBe(true);
    expect(report.lifecycleState).toBe("DEPLOY_CONFIRMED");

    // Verify database was updated
    const updated = getDeployLogById(deployId);
    expect(updated?.poolId).toBe(mockPairAddress);
    expect(updated?.lifecycleState).toBe("DEPLOY_CONFIRMED");
    expect(updated?.status).toBe("success");
    expect(updated?.attributionStatus).toBe("transaction_verified");
  });

  it("8. reconcileFleetOnChain should NOT downgrade DEPLOY_CONFIRMED if RPC fails", async () => {
    const testCa = `0x${Math.random().toString(16).slice(2, 10)}${"a".repeat(32)}`;
    const deployId = logDeploy({
      chain: "base",
      tokenName: "Confirmed Token",
      ticker: "CONF",
      contractAddr: testCa,
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
      poolId: "0xexisting_pool",
      simulated: false,
    });
    createdDeployIds.push(deployId);

    // RPC fails
    const mockClient = {
      getBytecode: async () => {
        throw new Error("RPC timeout");
      },
    } as any;

    // DEX query fails
    axiosGetSpy.mockRejectedValueOnce(new Error("Network timeout"));

    const report = await reconcileFleetOnChain(testCa, "base", {
      customClient: mockClient,
      fetchDex: true,
    });

    expect(report.onChainStatus).toBe("unknown");
    expect(report.lifecycleState).toBe("DEPLOY_CONFIRMED"); // preserved
    expect(report.poolId).toBe("0xexisting_pool"); // preserved

    const inDb = getDeployLogById(deployId);
    expect(inDb?.lifecycleState).toBe("DEPLOY_CONFIRMED");
    expect(inDb?.poolId).toBe("0xexisting_pool");
  });
});
