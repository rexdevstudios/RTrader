/**
 * execution-readiness.ts — Operational Readiness & Pre-Flight Execution Gate (V2.6)
 *
 * Establishes an authoritative runtime execution boundary between:
 *   Candidate Decision Engine (V2.4.4 — Approved?)
 *         ↓
 *   Execution Readiness Gate (V2.6 — Environment Runnable?)
 *         ↓
 *   Asset Generation & Deployment Dispatch (V2.1 - V2.3 — Execution)
 *
 * Architecture Invariants:
 *  1. Pure & Deterministic: Same inputs produce identical decisions. No DB/network calls, no side effects.
 *  2. Non-Mutating: Does not alter input objects (wallet, contexts, chains).
 *  3. Actionable Operational Context: Turns V2.3 `OperationalContext.isUsable` and `WalletAccount.status`
 *     into an authoritative execution block.
 *  4. Pre-Asset Placement: Evaluated before expensive external calls (AI logo generation, IPFS upload).
 *  5. Explicit Capability Mapping: Prunes unsupported chains (e.g. BSC, Ethereum) before deployment dispatch,
 *     preventing artificial deployment failure telemetry.
 *  6. Isolated from Strategy: ZERO token selection, viral score, saturation, TP/SL, or sizing logic.
 */

import type { WalletAccount, OperationalContext } from "./wallet-manager.ts";

export type ReadinessAction =
  | "PROCEED"
  | "ABORT_WALLET_UNAVAILABLE"
  | "ABORT_ROUTE_UNUSABLE"
  | "ABORT_SNIPER_UNAVAILABLE"
  | "ABORT_NO_CAPABLE_CHAINS";

export interface ExecutionReadinessInput {
  operatorWallet: WalletAccount;
  bankrContext?: OperationalContext | null;
  basedbotContext?: OperationalContext | null;
  eligibleChains: string[];
  requireSniper?: boolean;
  telegramBotTokenPresent?: boolean;
  now?: string;
}

export interface ExecutionReadinessDecision {
  ready: boolean;
  action: ReadinessAction;
  executableChains: string[];
  reasons: string[];
  evaluatedAt: string;
}

/**
 * Provider capability mapping.
 * Explicitly declares which chains are supported by available deployment engines.
 */
export const PROVIDER_CHAIN_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  bankr: ["base", "robinhood"],
  pumpfun: ["solana"],
};

/**
 * Resolves which provider is responsible for deploying to a given chain.
 * Returns null if no known provider supports the chain.
 */
export function getProviderForChain(chain: string): "bankr" | "pumpfun" | null {
  const normalized = chain.trim().toLowerCase();
  if (PROVIDER_CHAIN_CAPABILITIES.bankr.includes(normalized)) {
    return "bankr";
  }
  if (PROVIDER_CHAIN_CAPABILITIES.pumpfun.includes(normalized)) {
    return "pumpfun";
  }
  return null;
}

/**
 * Checks whether an OperationalContext is usable for execution.
 * Respects existing `OperationalContext.isUsable` and adds explicit proxy health error checks.
 */
export function isRouteUsable(context: OperationalContext): { usable: boolean; reason?: string } {
  // Check 1: Existing OperationalContext determination
  if (!context.isUsable) {
    return {
      usable: false,
      reason: context.unusableReason ?? `Operational route for provider '${context.provider}' is unusable`,
    };
  }

  // Check 2: Explicit proxy health failures
  if (context.proxy) {
    const health = context.proxy.healthStatus;
    if (health === "authentication_error" || health === "unavailable" || health === "timeout") {
      return {
        usable: false,
        reason: `Proxy '${context.proxy.id}' health status is ${health}`,
      };
    }
  }

  return { usable: true };
}

/**
 * Pure evaluation function for operational readiness.
 *
 * Deterministic Evaluation Precedence:
 *  1. Operator wallet status check (ACTIVE vs PAUSED/DISABLED)
 *  2. Downstream BasedBot sniper readiness check
 *  3. Provider route usability and target-chain capability intersection
 *  4. Final action and executableChains determination
 */
export function evaluateExecutionReadiness(
  input: ExecutionReadinessInput
): ExecutionReadinessDecision {
  const evaluatedAt = input.now ?? new Date().toISOString();
  const reasons: string[] = [];

  // ─── 1. Operator Wallet Check ──────────────────────────────
  if (input.operatorWallet.status !== "ACTIVE") {
    return {
      ready: false,
      action: "ABORT_WALLET_UNAVAILABLE",
      executableChains: [],
      reasons: [`Operator wallet '${input.operatorWallet.id}' is ${input.operatorWallet.status}.`],
      evaluatedAt,
    };
  }

  // ─── 2. Downstream BasedBot Sniper Readiness Check ─────────
  const sniperRequired = input.requireSniper ?? (input.telegramBotTokenPresent ?? false);

  if (sniperRequired) {
    // Missing required bot token when sniper is explicitly required
    if (input.requireSniper && input.telegramBotTokenPresent === false) {
      return {
        ready: false,
        action: "ABORT_SNIPER_UNAVAILABLE",
        executableChains: [],
        reasons: ["BasedBot sniper is required but TELEGRAM_BOT_TOKEN is not configured."],
        evaluatedAt,
      };
    }

    // Check BasedBot operational route usability
    if (input.basedbotContext) {
      const sniperCheck = isRouteUsable(input.basedbotContext);
      if (!sniperCheck.usable) {
        return {
          ready: false,
          action: "ABORT_SNIPER_UNAVAILABLE",
          executableChains: [],
          reasons: [`BasedBot sniper route is unusable: ${sniperCheck.reason}`],
          evaluatedAt,
        };
      }
    }
  }

  // ─── 3. Provider Route Usability & Chain Capability Filter ─
  const executableChains: string[] = [];
  let routeUnusableCount = 0;
  let unsupportedChainCount = 0;

  for (const rawChain of input.eligibleChains) {
    const chain = rawChain.trim().toLowerCase();
    const provider = getProviderForChain(chain);

    if (!provider) {
      unsupportedChainCount++;
      reasons.push(
        `Chain '${chain}' excluded: no deployer capability (only base, robinhood, solana supported).`
      );
      continue;
    }

    if (provider === "bankr") {
      if (input.bankrContext) {
        const routeCheck = isRouteUsable(input.bankrContext);
        if (!routeCheck.usable) {
          routeUnusableCount++;
          reasons.push(`Chain '${chain}' excluded: Bankr route is unusable (${routeCheck.reason}).`);
          continue;
        }
      }
      executableChains.push(chain);
    } else if (provider === "pumpfun") {
      // Pump.fun handles Solana deployment directly via RPC/disposable wallets
      executableChains.push(chain);
    }
  }

  // ─── 4. Final Action Determination ─────────────────────────
  if (executableChains.length === 0) {
    if (routeUnusableCount > 0) {
      return {
        ready: false,
        action: "ABORT_ROUTE_UNUSABLE",
        executableChains: [],
        reasons: reasons.length > 0 ? reasons : ["Provider routes are unusable for capable chains."],
        evaluatedAt,
      };
    }

    return {
      ready: false,
      action: "ABORT_NO_CAPABLE_CHAINS",
      executableChains: [],
      reasons: reasons.length > 0 ? reasons : ["No requested chains are capable of execution."],
      evaluatedAt,
    };
  }

  return {
    ready: true,
    action: "PROCEED",
    executableChains,
    reasons,
    evaluatedAt,
  };
}
