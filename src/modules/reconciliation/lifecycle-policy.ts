/**
 * lifecycle-policy.ts — V2.7 Execution Lifecycle State Machine & Terminal Resolution Policy
 *
 * Pure, deterministic evaluation of position lifecycle transitions, timeouts,
 * and dispatch rollbacks. Follows the architectural patterns of scheduling-policy.ts
 * and execution-readiness.ts:
 *   - No network calls
 *   - No database queries
 *   - No side effects
 *   - Deterministic and pure evaluation
 *   - Explicit distinction between TIMEOUT and UNRESOLVED
 */

// ─── Types & Actions ──────────────────────────────────────────

export type LifecycleAction =
  | "MAINTAIN"       // Within window without trigger; keep current state
  | "CONFIRM_BUY"    // On-chain balance strictly increased; transition to 'open'
  | "TIMEOUT_BUY"    // Buy window expired without balance evidence; transition to 'buy_timeout'
  | "ROLLBACK_SELL"  // Sell dispatch failed before on-chain submission; rollback 'closing' -> 'open'
  | "CONFIRM_EXIT"   // On-chain balance verified at or below dust; transition to 'sold_tp' / 'sold_sl'
  | "TIMEOUT_EXIT";  // Exit window expired without balance clearance; transition to 'unresolved'

export interface LifecycleEvaluationResult {
  action: LifecycleAction;
  targetState: string;
  isTerminal: boolean;
  reason: string;
}

// ─── Buy Lifecycle Input ──────────────────────────────────────

export interface BuyLifecycleInput {
  status: string;                  // Expected: 'buy_submitted'
  hasBalanceIncrease: boolean;     // Strict net inflow: currentRaw > beforeRaw
  elapsedMs: number;               // nowMs - createdAtMs
  timeoutMs: number;               // Configured buy timeout in ms
}

// ─── Sell Dispatch Input ──────────────────────────────────────

export interface SellDispatchInput {
  status: string;                  // Expected: 'closing'
  dispatchSuccess: boolean;        // Whether transport dispatch (e.g. BasedBot) succeeded
}

// ─── Exit Lifecycle Input ─────────────────────────────────────

export interface ExitLifecycleInput {
  status: string;                  // Expected: 'closing'
  isExitConfirmed: boolean;        // currentRaw <= dustThreshold (full exit)
  isPartialExit?: boolean;         // currentRaw < entryRaw (partial exit)
  elapsedMs: number;               // nowMs - closingStartedAtMs
  timeoutMs: number;               // Configured exit timeout in ms
  exitReason?: "take_profit" | "stop_loss" | string;
}

// ─── Unified Lifecycle Evaluation Input ───────────────────────

export interface UnifiedLifecycleInput {
  stage: "buy_confirmation" | "sell_dispatch" | "exit_confirmation";
  status: string;
  elapsedMs?: number;
  timeoutMs?: number;
  hasBalanceIncrease?: boolean;
  dispatchSuccess?: boolean;
  isExitConfirmed?: boolean;
  isPartialExit?: boolean;
  exitReason?: string;
}

// ─── Pure Evaluators ──────────────────────────────────────────

/**
 * Evaluates pending buy state.
 *
 * Invariants:
 * 1. Strict net inflow (hasBalanceIncrease === true) confirms buy -> CONFIRM_BUY (open).
 * 2. If no balance increase and elapsedMs >= timeoutMs -> TIMEOUT_BUY (buy_timeout).
 * 3. If no balance increase and elapsedMs < timeoutMs -> MAINTAIN (buy_submitted).
 */
export function evaluateBuyLifecycle(input: Readonly<BuyLifecycleInput>): LifecycleEvaluationResult {
  if (input.status !== "buy_submitted") {
    return {
      action: "MAINTAIN",
      targetState: input.status,
      isTerminal: false,
      reason: `Position is not in 'buy_submitted' state (current: '${input.status}'). No buy evaluation applied.`,
    };
  }

  // 1. Valid on-chain evidence confirms buy
  if (input.hasBalanceIncrease) {
    return {
      action: "CONFIRM_BUY",
      targetState: "open",
      isTerminal: false,
      reason: "Valid on-chain balance increase verified against baseline.",
    };
  }

  // 2. Confirmation window expired without sufficient evidence
  if (input.elapsedMs >= input.timeoutMs) {
    return {
      action: "TIMEOUT_BUY",
      targetState: "buy_timeout",
      isTerminal: true,
      reason: `Buy confirmation window expired (${Math.round(input.elapsedMs / 1000)}s >= ${Math.round(input.timeoutMs / 1000)}s) without on-chain balance increase.`,
    };
  }

  // 3. Still within confirmation window
  return {
    action: "MAINTAIN",
    targetState: "buy_submitted",
    isTerminal: false,
    reason: `Within buy confirmation window (${Math.round(input.elapsedMs / 1000)}s < ${Math.round(input.timeoutMs / 1000)}s). Awaiting on-chain balance increase.`,
  };
}

/**
 * Evaluates sell dispatch outcome.
 *
 * Invariants:
 * 1. If dispatch failed (!dispatchSuccess), the sell order never reached the execution
 *    transport. Must rollback 'closing' -> 'open' to prevent freezing.
 * 2. If dispatch succeeded, maintain 'closing' awaiting on-chain exit evidence.
 */
export function evaluateSellDispatch(input: Readonly<SellDispatchInput>): LifecycleEvaluationResult {
  if (input.status !== "closing") {
    return {
      action: "MAINTAIN",
      targetState: input.status,
      isTerminal: false,
      reason: `Position is not in 'closing' state (current: '${input.status}'). No sell dispatch evaluation applied.`,
    };
  }

  if (!input.dispatchSuccess) {
    return {
      action: "ROLLBACK_SELL",
      targetState: "open",
      isTerminal: false,
      reason: "Sell dispatch failed before execution submission. Rolled back closing -> open to re-enable price monitoring.",
    };
  }

  return {
    action: "MAINTAIN",
    targetState: "closing",
    isTerminal: false,
    reason: "Sell order dispatched successfully. Maintaining closing state awaiting on-chain exit evidence.",
  };
}

/**
 * Evaluates closing / exit confirmation outcome.
 *
 * Invariants:
 * 1. On-chain balance <= dust confirms exit -> CONFIRM_EXIT (sold_tp / sold_sl).
 * 2. Partial balance reduction -> CONFIRM_EXIT (open, for re-monitoring remainder).
 * 3. Window expired with tokens still on-chain -> TIMEOUT_EXIT (unresolved).
 *    Semantics: unresolved means the system cannot safely establish final outcome
 *    and requires operator reconciliation. Never manufacture certainty.
 * 4. Window active with tokens on-chain -> MAINTAIN (closing).
 */
export function evaluateExitLifecycle(input: Readonly<ExitLifecycleInput>): LifecycleEvaluationResult {
  if (input.status !== "closing") {
    return {
      action: "MAINTAIN",
      targetState: input.status,
      isTerminal: false,
      reason: `Position is not in 'closing' state (current: '${input.status}'). No exit evaluation applied.`,
    };
  }

  // 1. Full exit confirmed
  if (input.isExitConfirmed) {
    const finalState = input.exitReason === "stop_loss" ? "sold_sl" : "sold_tp";
    return {
      action: "CONFIRM_EXIT",
      targetState: finalState,
      isTerminal: true,
      reason: `On-chain balance verified to have exited (<= dust threshold). Final state: '${finalState}'.`,
    };
  }

  // 2. Partial exit confirmed
  if (input.isPartialExit) {
    return {
      action: "CONFIRM_EXIT",
      targetState: "open",
      isTerminal: false,
      reason: "Partial on-chain exit verified. Remainder returned to 'open' for continued monitoring.",
    };
  }

  // 3. Confirmation window expired without balance clearance
  if (input.elapsedMs >= input.timeoutMs) {
    return {
      action: "TIMEOUT_EXIT",
      targetState: "unresolved",
      isTerminal: true,
      reason: `Exit confirmation window expired (${Math.round(input.elapsedMs / 1000)}s >= ${Math.round(input.timeoutMs / 1000)}s) with tokens remaining on-chain. Marked unresolved for operator investigation.`,
    };
  }

  // 4. Still within confirmation window
  return {
    action: "MAINTAIN",
    targetState: "closing",
    isTerminal: false,
    reason: `Within exit confirmation window (${Math.round(input.elapsedMs / 1000)}s < ${Math.round(input.timeoutMs / 1000)}s). Awaiting on-chain exit confirmation.`,
  };
}

/**
 * Unified entrypoint for lifecycle policy evaluation.
 */
export function evaluateLifecyclePolicy(input: Readonly<UnifiedLifecycleInput>): LifecycleEvaluationResult {
  switch (input.stage) {
    case "buy_confirmation":
      return evaluateBuyLifecycle({
        status: input.status,
        hasBalanceIncrease: Boolean(input.hasBalanceIncrease),
        elapsedMs: input.elapsedMs ?? 0,
        timeoutMs: input.timeoutMs ?? 900000,
      });

    case "sell_dispatch":
      return evaluateSellDispatch({
        status: input.status,
        dispatchSuccess: Boolean(input.dispatchSuccess),
      });

    case "exit_confirmation":
      return evaluateExitLifecycle({
        status: input.status,
        isExitConfirmed: Boolean(input.isExitConfirmed),
        isPartialExit: Boolean(input.isPartialExit),
        elapsedMs: input.elapsedMs ?? 0,
        timeoutMs: input.timeoutMs ?? 900000,
        exitReason: input.exitReason,
      });

    default:
      return {
        action: "MAINTAIN",
        targetState: input.status,
        isTerminal: false,
        reason: `Unknown lifecycle stage '${(input as any).stage}'. Maintaining state.`,
      };
  }
}
