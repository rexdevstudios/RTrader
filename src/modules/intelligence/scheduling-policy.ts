/**
 * scheduling-policy.ts — Bounded Scheduling Policy Layer (V2.5.1 / V2.5.2)
 *
 * Establishes a deterministic, bounded policy layer between:
 *   SchedulingContext (Historical Observability V2.5.0)
 *         ↓
 *   SchedulingPolicy (Pure Gating & Clamping V2.5.1 + Adaptive Interval V2.5.2)
 *         ↓
 *   SchedulingDecision (Execution Recommendation)
 *
 * Hard Operational Invariants:
 *  1. Deterministic & Pure: Same inputs produce identical decisions.
 *  2. Bounded Interval: Effective interval is strictly clamped between minIntervalMinutes and maxIntervalMinutes.
 *  3. Constraint Precedence:
 *     Disabled > Daily Limit > Concurrency Lock > Cooldown > Interval Elapsed > Ready.
 *  4. Hard constraints ALWAYS win (daily limits, provider protection, kill-switch).
 *  5. ZERO Trading Logic: No token selection, chain routing, wallet selection, TP/SL, or sizing.
 *  6. Isolated from Decision Engine: Never enters DecisionInput or alters candidate evaluation.
 *  7. node-cron registration remains static. This module is pure evaluation only.
 *
 * V2.5.2 Adaptive Interval:
 *  - Primary signals: approvalRate and dailyLimitPressure.
 *  - Insufficient history → warm-up fallback (base interval).
 *  - Adaptive disabled → base interval.
 *  - Result always clamped to [minIntervalMinutes, maxIntervalMinutes].
 *  - Explicit adaptationReason explains every interval selection.
 */

import type { SchedulingContext } from "./scheduling-context.ts";

export interface SchedulingPolicyConfig {
  enabled: boolean;                      // Global scheduler kill-switch
  baseIntervalMinutes: number;           // Standard configured scan interval (e.g. 30 min)
  minIntervalMinutes: number;            // Hard minimum interval bound (e.g. 10 min)
  maxIntervalMinutes: number;            // Hard maximum interval bound (e.g. 120 min)
  cooldownMinutes: number;               // Required rest period after cycle completion (e.g. 5 min)
  maxDeploysPerDay: number;              // Hard operational limit from config (e.g. 10)
  // V2.5.2 Adaptive fields
  adaptiveEnabled: boolean;             // Enable context-aware interval adaptation
  adaptationFactor: number;             // Scaling factor 0.0 (no adaptation) to 1.0 (full adaptation)
  warmupCycles: number;                 // Minimum completed cycles required before adaptation activates
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export interface SchedulingEvaluationInput {
  now?: string;                          // ISO timestamp of evaluation (defaults to current time)
  lastCycleCompletedAt?: string | null;  // When previous cycle finished (ISO string)
  todayDeployCount: number;              // Current deploy count for today
  isLockHeld?: boolean;                  // Whether concurrency lock is currently held
  context?: SchedulingContext;           // Read-only V2.5.0 SchedulingContext (optional)
}

export type SchedulingAction =
  | "RUN"
  | "WAIT"
  | "SKIP_DAILY_LIMIT"
  | "DISABLED";

export type SchedulingConstraintReason =
  | "SCHEDULER_DISABLED"
  | "DAILY_LIMIT_REACHED"
  | "CONCURRENCY_LOCK_ACTIVE"
  | "COOLDOWN_ACTIVE"
  | "INTERVAL_NOT_ELAPSED"
  | "READY";

/**
 * V2.5.2: Explains how the effective interval was determined.
 * Present on every SchedulingDecision for full observability.
 */
export type IntervalAdaptationReason =
  | "WARMUP_BASE_INTERVAL"      // Not enough historical cycles yet
  | "ADAPTIVE_DISABLED"          // adaptiveEnabled = false; using base interval
  | "NO_CONTEXT"                 // No SchedulingContext provided; using base interval
  | "HIGH_APPROVAL_RATE"         // High success rate → shorter interval (more frequent)
  | "LOW_APPROVAL_RATE"          // Low success rate → longer interval (less frequent)
  | "HIGH_DAILY_LIMIT_PRESSURE"  // Hitting daily cap often → longer interval
  | "NEUTRAL_CONTEXT";           // Signals within neutral range; base interval retained

export interface SchedulingDecision {
  action: SchedulingAction;
  canExecute: boolean;                   // true strictly when action === 'RUN'
  effectiveIntervalMinutes: number;      // Clamped interval [minIntervalMinutes, maxIntervalMinutes]
  nextRunAt: string | null;              // Projected ISO timestamp when next execution is permitted
  waitDurationMs: number;                // Milliseconds remaining to wait (0 if canExecute is true)
  reason: SchedulingConstraintReason;
  message: string;
  evaluatedAt: string;
  // V2.5.2: Adaptive interval explanation
  adaptationReason: IntervalAdaptationReason;
  adaptationDetails: {                   // Diagnostic values used in interval computation
    approvalRate: number | null;
    dailyLimitPressure: number | null;
    baseIntervalMinutes: number;
    proposedIntervalMinutes: number;
  };
}

/**
 * Validates the integrity of a SchedulingPolicyConfig.
 * Enforces strictly positive values, min <= base <= max constraints,
 * and valid V2.5.2 adaptive configuration.
 */
export function validateSchedulingPolicyConfig(config: SchedulingPolicyConfig): ConfigValidationResult {
  const errors: string[] = [];

  if (config.minIntervalMinutes <= 0) {
    errors.push("minIntervalMinutes must be greater than 0");
  }
  if (config.maxIntervalMinutes < config.minIntervalMinutes) {
    errors.push("maxIntervalMinutes must be greater than or equal to minIntervalMinutes");
  }
  if (
    config.baseIntervalMinutes < config.minIntervalMinutes ||
    config.baseIntervalMinutes > config.maxIntervalMinutes
  ) {
    errors.push(
      `baseIntervalMinutes (${config.baseIntervalMinutes}) must be between minIntervalMinutes (${config.minIntervalMinutes}) and maxIntervalMinutes (${config.maxIntervalMinutes})`
    );
  }
  if (config.cooldownMinutes < 0) {
    errors.push("cooldownMinutes must be non-negative");
  }
  if (config.maxDeploysPerDay <= 0) {
    errors.push("maxDeploysPerDay must be greater than 0");
  }
  // V2.5.2 adaptive field validation
  if (config.adaptationFactor < 0 || config.adaptationFactor > 1) {
    errors.push("adaptationFactor must be between 0.0 and 1.0 inclusive");
  }
  if (config.warmupCycles < 1) {
    errors.push("warmupCycles must be at least 1");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Clamps any proposed interval to the strict [minIntervalMinutes, maxIntervalMinutes] bounds.
 */
export function clampInterval(
  proposedMinutes: number,
  minMinutes: number,
  maxMinutes: number
): number {
  if (minMinutes > maxMinutes) {
    throw new Error(`minMinutes (${minMinutes}) cannot be greater than maxMinutes (${maxMinutes})`);
  }
  return Math.max(minMinutes, Math.min(maxMinutes, proposedMinutes));
}

/**
 * Creates a valid default SchedulingPolicyConfig with safe operational bounds.
 */
export function createDefaultSchedulingPolicyConfig(
  overrides?: Partial<SchedulingPolicyConfig>
): SchedulingPolicyConfig {
  const base: SchedulingPolicyConfig = {
    enabled: true,
    baseIntervalMinutes: 30,
    minIntervalMinutes: 10,
    maxIntervalMinutes: 120,
    cooldownMinutes: 5,
    maxDeploysPerDay: 10,
    // V2.5.2 adaptive defaults
    adaptiveEnabled: true,
    adaptationFactor: 0.5,
    warmupCycles: 5,
    ...overrides,
  };

  const validation = validateSchedulingPolicyConfig(base);
  if (!validation.valid) {
    throw new Error(`Invalid SchedulingPolicyConfig: ${validation.errors.join("; ")}`);
  }

  return base;
}

/**
 * V2.5.2: Computes an adaptive interval from SchedulingContext signals.
 *
 * Algorithm (simple, explainable):
 *  1. If no context or count < warmupCycles → base interval (WARMUP_BASE_INTERVAL or NO_CONTEXT)
 *  2. If adaptiveEnabled = false → base interval (ADAPTIVE_DISABLED)
 *  3. Daily limit pressure > 0.3 → push interval toward max (HIGH_DAILY_LIMIT_PRESSURE)
 *  4. approvalRate >= 0.7 → pull interval toward min (HIGH_APPROVAL_RATE)
 *  5. approvalRate < 0.3 → pull interval toward max (LOW_APPROVAL_RATE)
 *  6. Otherwise → base interval (NEUTRAL_CONTEXT)
 *  Result always clamped to [minIntervalMinutes, maxIntervalMinutes].
 *
 * Formula:
 *  approvalAdjustment = (0.5 - approvalRate) * adaptationFactor * (maxInterval - minInterval)
 *  proposed           = baseInterval + approvalAdjustment
 *  if dailyLimitPressure > 0.3:
 *    dailyAdjustment  = dailyLimitPressure * adaptationFactor * (maxInterval - baseInterval)
 *    proposed         = max(proposed, baseInterval + dailyAdjustment)
 */
export function computeAdaptiveInterval(
  config: SchedulingPolicyConfig,
  context?: SchedulingContext
): { intervalMinutes: number; adaptationReason: IntervalAdaptationReason; approvalRate: number | null; dailyLimitPressure: number | null; proposedIntervalMinutes: number } {
  const base = config.baseIntervalMinutes;
  const min = config.minIntervalMinutes;
  const max = config.maxIntervalMinutes;

  // No context provided
  if (!context) {
    return {
      intervalMinutes: clampInterval(base, min, max),
      adaptationReason: "NO_CONTEXT",
      approvalRate: null,
      dailyLimitPressure: null,
      proposedIntervalMinutes: base,
    };
  }

  // Warm-up: not enough cycles for meaningful adaptation
  if (context.recentCycles.count < config.warmupCycles) {
    return {
      intervalMinutes: clampInterval(base, min, max),
      adaptationReason: "WARMUP_BASE_INTERVAL",
      approvalRate: context.recentCycles.approvalRate,
      dailyLimitPressure: context.recentCycles.count > 0
        ? context.recentCycles.dailyLimitHits / context.recentCycles.count
        : null,
      proposedIntervalMinutes: base,
    };
  }

  // Adaptive disabled
  if (!config.adaptiveEnabled) {
    const dailyLimitPressure = context.recentCycles.dailyLimitHits / context.recentCycles.count;
    return {
      intervalMinutes: clampInterval(base, min, max),
      adaptationReason: "ADAPTIVE_DISABLED",
      approvalRate: context.recentCycles.approvalRate,
      dailyLimitPressure,
      proposedIntervalMinutes: base,
    };
  }

  // Compute adaptive signals
  const approvalRate = context.recentCycles.approvalRate ?? 0.5; // treat unknown as neutral
  const dailyLimitPressure = context.recentCycles.dailyLimitHits / context.recentCycles.count;

  // Step 1: Approval-rate adjustment
  // At 0.5 → no adjustment; at 0.0 → push toward max; at 1.0 → push toward min
  const approvalAdjustment = (0.5 - approvalRate) * config.adaptationFactor * (max - min);
  let proposed = base + approvalAdjustment;

  // Step 2: Daily-limit pressure adjustment (independent push upward)
  // If > 30% of recent cycles hit the daily cap, push the interval higher
  let adaptationReason: IntervalAdaptationReason;
  if (dailyLimitPressure > 0.3) {
    const dailyAdjustment = dailyLimitPressure * config.adaptationFactor * (max - base);
    proposed = Math.max(proposed, base + dailyAdjustment);
    adaptationReason = "HIGH_DAILY_LIMIT_PRESSURE";
  } else if (approvalRate >= 0.7) {
    adaptationReason = "HIGH_APPROVAL_RATE";
  } else if (approvalRate < 0.3) {
    adaptationReason = "LOW_APPROVAL_RATE";
  } else {
    adaptationReason = "NEUTRAL_CONTEXT";
  }

  const intervalMinutes = clampInterval(proposed, min, max);

  return {
    intervalMinutes,
    adaptationReason,
    approvalRate: context.recentCycles.approvalRate,
    dailyLimitPressure,
    proposedIntervalMinutes: proposed,
  };
}

/**
 * Evaluates scheduling decision based on config, current state, and operational constraints.
 *
 * Strict Constraint Precedence:
 *  1. SCHEDULER_DISABLED: If enabled is false -> DISABLED immediately.
 *  2. DAILY_LIMIT_REACHED: If todayDeployCount >= maxDeploysPerDay -> SKIP_DAILY_LIMIT.
 *  3. CONCURRENCY_LOCK_ACTIVE: If isLockHeld is true -> WAIT.
 *  4. COOLDOWN_ACTIVE: If time since last completion < cooldown -> WAIT.
 *  5. INTERVAL_NOT_ELAPSED: If time since last completion < effectiveInterval -> WAIT.
 *  6. READY: All constraints satisfied -> RUN.
 *
 * V2.5.2: effectiveIntervalMinutes is now adaptive (context-aware) when adaptiveEnabled=true
 * and sufficient historical cycles exist. The adaptationReason field explains every selection.
 */
export function evaluateSchedulingDecision(
  config: SchedulingPolicyConfig,
  input: SchedulingEvaluationInput
): SchedulingDecision {
  const validation = validateSchedulingPolicyConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid SchedulingPolicyConfig: ${validation.errors.join("; ")}`);
  }

  const evaluatedAt = input.now ?? new Date().toISOString();
  const nowMs = new Date(evaluatedAt).getTime();

  // V2.5.2: Compute adaptive interval from SchedulingContext
  const adaptiveResult = computeAdaptiveInterval(config, input.context);
  const effectiveIntervalMinutes = adaptiveResult.intervalMinutes;
  const effectiveIntervalMs = effectiveIntervalMinutes * 60 * 1000;
  const cooldownMs = config.cooldownMinutes * 60 * 1000;

  const adaptationDetails = {
    approvalRate: adaptiveResult.approvalRate,
    dailyLimitPressure: adaptiveResult.dailyLimitPressure,
    baseIntervalMinutes: config.baseIntervalMinutes,
    proposedIntervalMinutes: adaptiveResult.proposedIntervalMinutes,
  };

  // 1. Precedence 1: SCHEDULER_DISABLED
  if (!config.enabled) {
    return {
      action: "DISABLED",
      canExecute: false,
      effectiveIntervalMinutes,
      nextRunAt: null,
      waitDurationMs: Infinity,
      reason: "SCHEDULER_DISABLED",
      message: "Scheduler is disabled via policy configuration.",
      evaluatedAt,
      adaptationReason: adaptiveResult.adaptationReason,
      adaptationDetails,
    };
  }

  // 2. Precedence 2: DAILY_LIMIT_REACHED
  if (input.todayDeployCount >= config.maxDeploysPerDay) {
    // Project next midnight UTC
    const currentDate = new Date(evaluatedAt);
    const tomorrowUtc = new Date(
      Date.UTC(
        currentDate.getUTCFullYear(),
        currentDate.getUTCMonth(),
        currentDate.getUTCDate() + 1,
        0,
        0,
        0,
        0
      )
    );
    const waitDurationMs = Math.max(0, tomorrowUtc.getTime() - nowMs);

    return {
      action: "SKIP_DAILY_LIMIT",
      canExecute: false,
      effectiveIntervalMinutes,
      nextRunAt: tomorrowUtc.toISOString(),
      waitDurationMs,
      reason: "DAILY_LIMIT_REACHED",
      message: `Daily deployment limit reached (${input.todayDeployCount}/${config.maxDeploysPerDay}). Suspended until next UTC day.`,
      evaluatedAt,
      adaptationReason: adaptiveResult.adaptationReason,
      adaptationDetails,
    };
  }

  // 3. Precedence 3: CONCURRENCY_LOCK_ACTIVE
  if (input.isLockHeld) {
    return {
      action: "WAIT",
      canExecute: false,
      effectiveIntervalMinutes,
      nextRunAt: null,
      waitDurationMs: 60000, // Recommend recheck in 1 minute
      reason: "CONCURRENCY_LOCK_ACTIVE",
      message: "Concurrency lock is held by an active pipeline cycle. Must wait.",
      evaluatedAt,
      adaptationReason: adaptiveResult.adaptationReason,
      adaptationDetails,
    };
  }

  // Check timing relative to last cycle completion
  if (input.lastCycleCompletedAt) {
    const lastCompletedMs = new Date(input.lastCycleCompletedAt).getTime();
    const elapsedMs = nowMs - lastCompletedMs;

    // 4. Precedence 4: COOLDOWN_ACTIVE
    if (elapsedMs < cooldownMs) {
      const waitDurationMs = cooldownMs - elapsedMs;
      const nextRunAt = new Date(nowMs + waitDurationMs).toISOString();
      return {
        action: "WAIT",
        canExecute: false,
        effectiveIntervalMinutes,
        nextRunAt,
        waitDurationMs,
        reason: "COOLDOWN_ACTIVE",
        message: `Cooldown period active. ${(waitDurationMs / 1000).toFixed(0)}s remaining.`,
        evaluatedAt,
        adaptationReason: adaptiveResult.adaptationReason,
        adaptationDetails,
      };
    }

    // 5. Precedence 5: INTERVAL_NOT_ELAPSED
    if (elapsedMs < effectiveIntervalMs) {
      const waitDurationMs = effectiveIntervalMs - elapsedMs;
      const nextRunAt = new Date(nowMs + waitDurationMs).toISOString();
      return {
        action: "WAIT",
        canExecute: false,
        effectiveIntervalMinutes,
        nextRunAt,
        waitDurationMs,
        reason: "INTERVAL_NOT_ELAPSED",
        message: `Interval of ${effectiveIntervalMinutes}m not elapsed. ${(waitDurationMs / 1000 / 60).toFixed(1)}m remaining.`,
        evaluatedAt,
        adaptationReason: adaptiveResult.adaptationReason,
        adaptationDetails,
      };
    }
  }

  // 6. Precedence 6: READY
  return {
    action: "RUN",
    canExecute: true,
    effectiveIntervalMinutes,
    nextRunAt: evaluatedAt,
    waitDurationMs: 0,
    reason: "READY",
    message: "All operational constraints and interval requirements satisfied. Ready to run.",
    evaluatedAt,
    adaptationReason: adaptiveResult.adaptationReason,
    adaptationDetails,
  };
}
