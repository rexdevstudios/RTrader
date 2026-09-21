import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import {
  evaluateDeploymentSafetyGate,
  executeWithDeploymentSafetyGate,
  getDeploymentLockName,
  type ProductionSafetyGateInput,
} from "../src/modules/deploy-guard.ts";
import {
  acquireLock,
  releaseLock,
  isLockHeld,
  getTodayDeployCount,
  incrementTodayDeployCount,
} from "../src/db/vault.ts";
import { resetConfig } from "../src/config.ts";

const validIdentity = {
  name: "Safe Production Runner",
  ticker: "SAFEPROD",
  description: "Autonomous production token verified by safety gate with 0% tax.",
  website: "https://safeprod.io",
  twitter: "https://x.com/safeprod",
};

const validAssets = {
  imageUrl: "https://ipfs.io/ipfs/bafkreic7xwdlyoasomc552h5l3omg2o6zly3evsxd7h2x46xoxe3f22l34",
  metadataUrl: "https://ipfs.io/ipfs/bafkreiaa36k7vj3g44zmsr4nly6jvxqeqx2uclb35q25p3evr2v4754pnm",
};

describe("Production Deployment Safety Gate (P0 Hardening)", () => {
  const baseLock = getDeploymentLockName("base");
  const solanaLock = getDeploymentLockName("solana");

  beforeEach(() => {
    resetConfig();
    releaseLock(baseLock);
    releaseLock(solanaLock);
  });

  afterEach(() => {
    releaseLock(baseLock);
    releaseLock(solanaLock);
  });

  it("1. should PASS the gate for a valid Base deployment candidate in simulation mode", async () => {
    let actionExecuted = false;

    const input: ProductionSafetyGateInput = {
      chain: "base",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: true,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return { tokenAddress: "0x1234567890123456789012345678901234567890" };
    });

    expect(res.success).toBe(true);
    expect(res.gateResult.passed).toBe(true);
    expect(res.gateResult.checks.chainValid).toBe(true);
    expect(res.gateResult.checks.identityValid).toBe(true);
    expect(actionExecuted).toBe(true);

    // Lock must be released after completion
    expect(isLockHeld(baseLock)).toBe(false);
  });

  it("2. should PASS the gate for a valid Solana deployment candidate in simulation mode", async () => {
    let actionExecuted = false;

    const input: ProductionSafetyGateInput = {
      chain: "solana",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: true,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return { signature: "mockSig" };
    });

    expect(res.success).toBe(true);
    expect(res.gateResult.passed).toBe(true);
    expect(res.gateResult.checks.chainValid).toBe(true);
    expect(actionExecuted).toBe(true);
    expect(isLockHeld(solanaLock)).toBe(false);
  });

  it("3. should REJECT unsupported chain and NEVER call deployment action", async () => {
    let actionExecuted = false;

    const input: ProductionSafetyGateInput = {
      chain: "bsc_unsupported",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: true,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return {};
    });

    expect(res.success).toBe(false);
    expect(res.gateResult.passed).toBe(false);
    expect(res.gateResult.checks.chainValid).toBe(false);
    expect(res.error).toContain("UNSUPPORTED_CHAIN");
    expect(actionExecuted).toBe(false);
  });

  it("4. should REJECT invalid token identity and NEVER call deployment action", async () => {
    let actionExecuted = false;

    const input: ProductionSafetyGateInput = {
      chain: "base",
      identity: {
        name: "X", // Invalid: too short
        ticker: "1", // Invalid format
      },
      assets: validAssets,
      isSimulation: true,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return {};
    });

    expect(res.success).toBe(false);
    expect(res.gateResult.passed).toBe(false);
    expect(res.gateResult.checks.identityValid).toBe(false);
    expect(res.error).toContain("IDENTITY_REJECTED");
    expect(actionExecuted).toBe(false);
  });

  it("5. should REJECT deployment when daily limit is reached and NEVER call action", async () => {
    let actionExecuted = false;

    const input: ProductionSafetyGateInput = {
      chain: "base",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: true,
      maxDailyDeploys: 0, // Force limit exceeded immediately
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return {};
    });

    expect(res.success).toBe(false);
    expect(res.gateResult.passed).toBe(false);
    expect(res.gateResult.checks.dailyLimitOk).toBe(false);
    expect(res.error).toContain("DAILY_LIMIT_EXCEEDED");
    expect(actionExecuted).toBe(false);
  });

  it("6. should REJECT when RPC health probe fails and NEVER call action", async () => {
    let actionExecuted = false;

    const input: ProductionSafetyGateInput = {
      chain: "base",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: true,
      rpcCheck: async () => false, // Simulate dead RPC
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return {};
    });

    expect(res.success).toBe(false);
    expect(res.gateResult.passed).toBe(false);
    expect(res.gateResult.checks.rpcOk).toBe(false);
    expect(res.error).toContain("RPC_FAILURE");
    expect(actionExecuted).toBe(false);
  });

  it("7. should REJECT when balance is insufficient on Base (live mode)", async () => {
    let actionExecuted = false;

    const mockEvmClient = {
      getBalance: async () => 100000000000000n, // 0.0001 ETH (below 0.002 required)
    };

    const input: ProductionSafetyGateInput = {
      chain: "base",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: false,
      walletAddress: "0x946657D17C7e83052D50634D9dA6FF3Fc46b418a",
      requiredBalance: 0.002,
      _injectedEvmClient: mockEvmClient,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return {};
    });

    expect(res.success).toBe(false);
    expect(res.gateResult.passed).toBe(false);
    expect(res.gateResult.checks.balanceOk).toBe(false);
    expect(res.error).toContain("INSUFFICIENT_BALANCE");
    expect(actionExecuted).toBe(false);
  });

  it("8. should REJECT when balance is insufficient on Solana (live mode)", async () => {
    let actionExecuted = false;

    const mockSolConnection = {
      getBalance: async () => 5000000, // 0.005 SOL (below 0.009 required)
    };

    const input: ProductionSafetyGateInput = {
      chain: "solana",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: false,
      walletAddress: "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz",
      requiredBalance: 0.009,
      _injectedSolanaConnection: mockSolConnection,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return {};
    });

    expect(res.success).toBe(false);
    expect(res.gateResult.passed).toBe(false);
    expect(res.gateResult.checks.balanceOk).toBe(false);
    expect(res.error).toContain("INSUFFICIENT_BALANCE");
    expect(actionExecuted).toBe(false);
  });

  it("9. should BLOCK concurrent deployment when lock is already held by another process", async () => {
    // Process A acquires the lock
    const acquired = acquireLock(baseLock, 1800, "process_A");
    expect(acquired).toBe(true);

    let actionExecuted = false;

    // Process B attempts to deploy on the same chain
    const input: ProductionSafetyGateInput = {
      chain: "base",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: true,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      actionExecuted = true;
      return {};
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("CONCURRENT_DEPLOYMENT_BLOCKED");
    expect(res.gateResult.checks.concurrencyOk).toBe(false);
    expect(actionExecuted).toBe(false);

    // Release process A lock
    releaseLock(baseLock);
    expect(isLockHeld(baseLock)).toBe(false);
  });

  it("10. should GUARANTEE lock cleanup even when deployment action throws an unhandled exception", async () => {
    const input: ProductionSafetyGateInput = {
      chain: "base",
      identity: validIdentity,
      assets: validAssets,
      isSimulation: true,
    };

    const res = await executeWithDeploymentSafetyGate(input, async () => {
      throw new Error("CRITICAL_SIMULATED_NETWORK_DISASTER");
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("CRITICAL_SIMULATED_NETWORK_DISASTER");

    // Invariant: Lock MUST be released even if action throws!
    expect(isLockHeld(baseLock)).toBe(false);
  });
});
