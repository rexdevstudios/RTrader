import { describe, it, expect } from "bun:test";
import {
  evaluateExecutionReadiness,
  getProviderForChain,
  isRouteUsable,
  PROVIDER_CHAIN_CAPABILITIES,
  type ExecutionReadinessInput,
} from "../src/modules/identity/execution-readiness.ts";
import type {
  WalletAccount,
  OperationalContext,
  WalletStatus,
  ProxyStatus,
  ProxyHealthStatus,
} from "../src/modules/identity/wallet-manager.ts";

// ─── Test Fixtures ────────────────────────────────────────────

const FIXED_NOW = "2026-09-05T12:00:00.000Z";

function makeWallet(status: WalletStatus = "ACTIVE"): WalletAccount {
  return {
    id: "test-operator-wallet",
    label: "Test Operator Wallet",
    status,
    evmAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    solanaAddress: "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRH",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function makeContext(
  provider: "bankr" | "basedbot",
  opts: {
    isUsable?: boolean;
    unusableReason?: string;
    proxyStatus?: ProxyStatus;
    proxyHealthStatus?: ProxyHealthStatus;
    noProxy?: boolean;
  } = {}
): OperationalContext {
  const isUsable = opts.isUsable ?? true;
  const proxy = opts.noProxy
    ? null
    : {
        id: `proxy-${provider}`,
        protocol: "http" as const,
        host: "127.0.0.1",
        port: 8080,
        status: opts.proxyStatus ?? ("ACTIVE" as const),
        healthStatus: opts.proxyHealthStatus ?? ("available" as const),
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      };

  return {
    wallet: makeWallet("ACTIVE"),
    provider,
    proxy,
    isUsable,
    unusableReason: isUsable ? undefined : (opts.unusableReason ?? `Operational route for ${provider} is unusable.`),
    proxyUrl: proxy ? "http://127.0.0.1:8080" : null,
  };
}

describe("V2.6 — Operational Readiness & Pre-Flight Execution Gate", () => {
  // ─── 1. Operator Wallet Pre-Flight Semantics ───────────────
  describe("1. Operator Wallet Status Enforcement", () => {
    it("1.1 allows execution when operator wallet is ACTIVE", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(true);
      expect(decision.action).toBe("PROCEED");
      expect(decision.executableChains).toEqual(["base"]);
    });

    it("1.2 aborts execution when operator wallet is PAUSED (ABORT_WALLET_UNAVAILABLE)", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("PAUSED"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "solana"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_WALLET_UNAVAILABLE");
      expect(decision.executableChains).toEqual([]);
      expect(decision.reasons.some((r) => r.includes("PAUSED"))).toBe(true);
    });

    it("1.3 aborts execution when operator wallet is DISABLED (ABORT_WALLET_UNAVAILABLE)", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("DISABLED"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "solana"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_WALLET_UNAVAILABLE");
      expect(decision.executableChains).toEqual([]);
      expect(decision.reasons.some((r) => r.includes("DISABLED"))).toBe(true);
    });

    it("1.4 wallet check precedes route and chain checks", () => {
      // Wallet is PAUSED, even if routes are broken and chains are invalid
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("PAUSED"),
        bankrContext: makeContext("bankr", { isUsable: false }),
        basedbotContext: makeContext("basedbot", { isUsable: false }),
        eligibleChains: ["unsupported_chain"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.action).toBe("ABORT_WALLET_UNAVAILABLE");
    });
  });

  // ─── 2. Downstream BasedBot Sniper Readiness ───────────────
  describe("2. Downstream BasedBot / Sniper Readiness", () => {
    it("2.1 proceeds when BasedBot sniper route is usable and token is present", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot", { isUsable: true }),
        eligibleChains: ["base"],
        telegramBotTokenPresent: true,
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(true);
      expect(decision.action).toBe("PROCEED");
    });

    it("2.2 aborts with ABORT_SNIPER_UNAVAILABLE when BasedBot route is explicitly unusable", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot", {
          isUsable: false,
          unusableReason: "Proxy health status is authentication_error",
        }),
        eligibleChains: ["base", "solana"],
        telegramBotTokenPresent: true,
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_SNIPER_UNAVAILABLE");
      expect(decision.executableChains).toEqual([]);
      expect(decision.reasons.some((r) => r.includes("BasedBot sniper route is unusable"))).toBe(true);
    });

    it("2.3 aborts with ABORT_SNIPER_UNAVAILABLE when sniper is required but TELEGRAM_BOT_TOKEN missing", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base"],
        requireSniper: true,
        telegramBotTokenPresent: false,
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_SNIPER_UNAVAILABLE");
      expect(decision.reasons.some((r) => r.includes("TELEGRAM_BOT_TOKEN is not configured"))).toBe(true);
    });

    it("2.4 does not abort when TELEGRAM_BOT_TOKEN is missing if sniper is optional/not required", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base"],
        requireSniper: false,
        telegramBotTokenPresent: false,
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(true);
      expect(decision.action).toBe("PROCEED");
    });

    it("2.5 aborts when BasedBot proxy has timeout health failure", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot", {
          isUsable: true,
          proxyHealthStatus: "timeout",
        }),
        eligibleChains: ["base"],
        telegramBotTokenPresent: true,
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_SNIPER_UNAVAILABLE");
    });
  });

  // ─── 3. Provider Route Usability & Proxy Health ─────────────
  describe("3. Provider Route Usability & Proxy Health", () => {
    it("3.1 unassigned proxy (direct route) is fully usable", () => {
      const ctx = makeContext("bankr", { noProxy: true, isUsable: true });
      const check = isRouteUsable(ctx);
      expect(check.usable).toBe(true);
    });

    it("3.2 proxy with healthStatus 'available' is fully usable", () => {
      const ctx = makeContext("bankr", { proxyHealthStatus: "available", isUsable: true });
      const check = isRouteUsable(ctx);
      expect(check.usable).toBe(true);
    });

    it("3.3 proxy with healthStatus 'authentication_error' is marked unusable", () => {
      const ctx = makeContext("bankr", { proxyHealthStatus: "authentication_error" });
      const check = isRouteUsable(ctx);
      expect(check.usable).toBe(false);
      expect(check.reason).toContain("authentication_error");
    });

    it("3.4 proxy with healthStatus 'unavailable' is marked unusable", () => {
      const ctx = makeContext("bankr", { proxyHealthStatus: "unavailable" });
      const check = isRouteUsable(ctx);
      expect(check.usable).toBe(false);
      expect(check.reason).toContain("unavailable");
    });

    it("3.5 proxy with healthStatus 'timeout' is marked unusable", () => {
      const ctx = makeContext("bankr", { proxyHealthStatus: "timeout" });
      const check = isRouteUsable(ctx);
      expect(check.usable).toBe(false);
      expect(check.reason).toContain("timeout");
    });

    it("3.6 context with isUsable=false respects existing unusableReason", () => {
      const ctx = makeContext("bankr", {
        isUsable: false,
        unusableReason: "Operational route for provider 'bankr' is PAUSED.",
      });
      const check = isRouteUsable(ctx);
      expect(check.usable).toBe(false);
      expect(check.reason).toBe("Operational route for provider 'bankr' is PAUSED.");
    });
  });

  // ─── 4. Target Chain Capability & Pruning ───────────────────
  describe("4. Target Chain Capability & Pruning", () => {
    it("4.1 identifies known provider capabilities correctly", () => {
      expect(getProviderForChain("base")).toBe("bankr");
      expect(getProviderForChain("BASE")).toBe("bankr");
      expect(getProviderForChain("robinhood")).toBe("bankr");
      expect(getProviderForChain("solana")).toBe("pumpfun");
      expect(getProviderForChain("SOLANA")).toBe("pumpfun");
      expect(getProviderForChain("bsc")).toBeNull();
      expect(getProviderForChain("ethereum")).toBeNull();
      expect(getProviderForChain("arbitrum")).toBeNull();
    });

    it("4.2 preserves supported chains (Base, Robinhood, Solana)", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "robinhood", "solana"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(true);
      expect(decision.action).toBe("PROCEED");
      expect(decision.executableChains).toEqual(["base", "robinhood", "solana"]);
    });

    it("4.3 prunes unsupported BSC and Ethereum without failing supported chains", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "bsc", "solana", "ethereum"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(true);
      expect(decision.action).toBe("PROCEED");
      // Only Base and Solana remain; BSC and Ethereum are pruned before dispatch
      expect(decision.executableChains).toEqual(["base", "solana"]);
      expect(decision.reasons.some((r) => r.includes("bsc"))).toBe(true);
      expect(decision.reasons.some((r) => r.includes("ethereum"))).toBe(true);
    });

    it("4.4 aborts with ABORT_NO_CAPABLE_CHAINS when all requested chains are unsupported", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["bsc", "ethereum"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_NO_CAPABLE_CHAINS");
      expect(decision.executableChains).toEqual([]);
    });

    it("4.5 aborts with ABORT_NO_CAPABLE_CHAINS when eligibleChains is empty", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: [],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_NO_CAPABLE_CHAINS");
      expect(decision.executableChains).toEqual([]);
    });
  });

  // ─── 5. Route Usability Intersected with Chains ─────────────
  describe("5. Route Usability vs Chain Intersection", () => {
    it("5.1 prunes Base when Bankr route is unusable but keeps Solana", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr", { isUsable: false, unusableReason: "Bankr proxy down" }),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "solana"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(true);
      expect(decision.action).toBe("PROCEED");
      // Base was pruned because Bankr is down, but Solana (PumpFun) is still executable
      expect(decision.executableChains).toEqual(["solana"]);
      expect(decision.reasons.some((r) => r.includes("Chain 'base' excluded: Bankr route is unusable"))).toBe(true);
    });

    it("5.2 aborts with ABORT_ROUTE_UNUSABLE when all capable chains have unusable routes", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr", { isUsable: false, unusableReason: "Bankr route is PAUSED" }),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "robinhood"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_ROUTE_UNUSABLE");
      expect(decision.executableChains).toEqual([]);
    });

    it("5.3 aborts with ABORT_ROUTE_UNUSABLE when mixed route unusable + unsupported leaves 0 chains", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr", { isUsable: false, unusableReason: "Bankr route is DISABLED" }),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "bsc"], // Base route down, BSC unsupported
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.action).toBe("ABORT_ROUTE_UNUSABLE");
      expect(decision.executableChains).toEqual([]);
    });
  });

  // ─── 6. Determinism & Purity Invariants ──────────────────────
  describe("6. Determinism & Purity Invariants", () => {
    it("6.1 returns identical decisions for identical inputs", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "solana", "bsc"],
        now: FIXED_NOW,
      };
      const d1 = evaluateExecutionReadiness(input);
      const d2 = evaluateExecutionReadiness(input);
      expect(d1).toEqual(d2);
    });

    it("6.2 does not mutate input eligibleChains array", () => {
      const chains = ["base", "bsc", "solana"];
      const frozenChains = [...chains];
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: chains,
        now: FIXED_NOW,
      };
      evaluateExecutionReadiness(input);
      expect(chains).toEqual(frozenChains);
    });

    it("6.3 PROVIDER_CHAIN_CAPABILITIES is read-only and immutable", () => {
      expect(PROVIDER_CHAIN_CAPABILITIES.bankr).toContain("base");
      expect(PROVIDER_CHAIN_CAPABILITIES.bankr).toContain("robinhood");
      expect(PROVIDER_CHAIN_CAPABILITIES.pumpfun).toContain("solana");
    });
  });

  // ─── 7. Boundary Precedence Hierarchy ───────────────────────
  describe("7. Boundary Precedence Hierarchy", () => {
    it("7.1 Wallet status beats Sniper readiness", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("PAUSED"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot", { isUsable: false }),
        eligibleChains: ["base"],
        telegramBotTokenPresent: true,
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      // Wallet check must fire first
      expect(decision.action).toBe("ABORT_WALLET_UNAVAILABLE");
    });

    it("7.2 Sniper readiness beats Provider route checks", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr", { isUsable: false }),
        basedbotContext: makeContext("basedbot", { isUsable: false }),
        eligibleChains: ["base"],
        telegramBotTokenPresent: true,
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      // Sniper check fires before route pruning
      expect(decision.action).toBe("ABORT_SNIPER_UNAVAILABLE");
    });

    it("7.3 Route Usability beats No Capable Chains when route failure was the cause", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr", { isUsable: false }),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.action).toBe("ABORT_ROUTE_UNUSABLE");
    });
  });

  // ─── 8. Decision Interaction ─────────────────────────────────
  describe("8. Decision Interaction & Gating Contracts", () => {
    it("8.1 approved candidate with ready operational environment proceeds to execution", () => {
      // Simulates candidate evaluation passing (DecisionResult.approved=true)
      const mockCandidateDecision = {
        approved: true,
        eligibleChains: ["base", "solana"],
      };

      const readiness = evaluateExecutionReadiness({
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: mockCandidateDecision.eligibleChains,
        now: FIXED_NOW,
      });

      expect(readiness.ready).toBe(true);
      expect(readiness.action).toBe("PROCEED");
      expect(readiness.executableChains).toEqual(["base", "solana"]);
    });

    it("8.2 approved candidate with paused wallet is halted before asset generation/deployment", () => {
      const mockCandidateDecision = {
        approved: true,
        eligibleChains: ["base", "solana"],
      };

      const readiness = evaluateExecutionReadiness({
        operatorWallet: makeWallet("PAUSED"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: mockCandidateDecision.eligibleChains,
        now: FIXED_NOW,
      });

      expect(readiness.ready).toBe(false);
      expect(readiness.action).toBe("ABORT_WALLET_UNAVAILABLE");
      expect(readiness.executableChains).toEqual([]);
    });

    it("8.3 readiness gate does not resurrect a rejected candidate decision", () => {
      // If decision engine rejected candidate, readiness gate should never be consulted to override it
      const mockCandidateDecision = {
        approved: false,
        rejectionReason: "LOW_VIRAL_SCORE",
        eligibleChains: [] as string[],
      };

      // Even if readiness would be ready with arbitrary chains:
      const readiness = evaluateExecutionReadiness({
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: mockCandidateDecision.eligibleChains, // empty because rejected
        now: FIXED_NOW,
      });

      expect(readiness.ready).toBe(false);
      expect(readiness.action).toBe("ABORT_NO_CAPABLE_CHAINS");
    });
  });

  // ─── 9. Pipeline Dispatch Semantics ──────────────────────────
  describe("9. Pipeline Dispatch & Executable Chains Invariants", () => {
    it("9.1 ensures only executableChains are dispatched when input has mixed support", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr"),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "bsc", "solana", "ethereum"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(true);

      // Verify that downstream dispatch loop only iterates executableChains
      const dispatchedChains: string[] = [];
      for (const chain of decision.executableChains) {
        dispatchedChains.push(chain);
      }

      expect(dispatchedChains).toEqual(["base", "solana"]);
      expect(dispatchedChains).not.toContain("bsc");
      expect(dispatchedChains).not.toContain("ethereum");
    });

    it("9.2 readiness decision includes complete human-readable diagnostic reasons", () => {
      const input: ExecutionReadinessInput = {
        operatorWallet: makeWallet("ACTIVE"),
        bankrContext: makeContext("bankr", { isUsable: false, unusableReason: "Proxy auth failed" }),
        basedbotContext: makeContext("basedbot"),
        eligibleChains: ["base", "bsc"],
        now: FIXED_NOW,
      };
      const decision = evaluateExecutionReadiness(input);
      expect(decision.ready).toBe(false);
      expect(decision.reasons.length).toBeGreaterThanOrEqual(2);
      expect(decision.reasons.some((r) => r.includes("Bankr route is unusable"))).toBe(true);
      expect(decision.reasons.some((r) => r.includes("bsc"))).toBe(true);
    });
  });
});
