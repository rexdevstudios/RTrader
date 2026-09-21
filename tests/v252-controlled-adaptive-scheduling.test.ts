import { describe, it, expect } from "bun:test";
import {
  validateSchedulingPolicyConfig,
  clampInterval,
  createDefaultSchedulingPolicyConfig,
  evaluateSchedulingDecision,
  computeAdaptiveInterval,
  type SchedulingPolicyConfig,
  type SchedulingEvaluationInput,
} from "../src/modules/intelligence/scheduling-policy.ts";
import type { SchedulingContext } from "../src/modules/intelligence/scheduling-context.ts";

// ─── Test Fixtures ────────────────────────────────────────────

const BASE_CONFIG: SchedulingPolicyConfig = {
  enabled: true,
  baseIntervalMinutes: 30,
  minIntervalMinutes: 10,
  maxIntervalMinutes: 120,
  cooldownMinutes: 5,
  maxDeploysPerDay: 10,
  adaptiveEnabled: true,
  adaptationFactor: 0.5,
  warmupCycles: 5,
};

const FIXED_NOW = "2026-09-05T12:00:00.000Z";
const FIXED_NOW_MS = new Date(FIXED_NOW).getTime();

/** Helper: build a SchedulingContext with given recentCycles metrics */
function makeContext(overrides: {
  count?: number;
  approvalRate?: number | null;
  dailyLimitHits?: number;
  lockSkips?: number;
  avgDurationMs?: number | null;
  deploymentRate?: number | null;
}): SchedulingContext {
  const count = overrides.count ?? 10;
  return {
    generatedAt: FIXED_NOW,
    recentCycles: {
      count,
      avgDurationMs: overrides.avgDurationMs ?? 15000,
      approvalRate: overrides.approvalRate ?? 0.5,
      deploymentRate: overrides.deploymentRate ?? 0.8,
      dailyLimitHits: overrides.dailyLimitHits ?? 0,
      lockSkips: overrides.lockSkips ?? 0,
    },
    candidateFunnel: {
      windowDays: 1,
      discovered: count,
      analyzed: count,
      approved: Math.round(count * (overrides.approvalRate ?? 0.5)),
      rejectedLowScore: 0,
      rejectedSaturated: 0,
      deployed: 0,
      deploymentsConfirmed: 0,
    },
  };
}

/** ISO timestamp N minutes before FIXED_NOW */
function minutesBefore(n: number): string {
  return new Date(FIXED_NOW_MS - n * 60 * 1000).toISOString();
}

// ─── 1. Policy: Adaptive Disabled ────────────────────────────

describe("V2.5.2 — Controlled Adaptive Scheduling", () => {
  describe("1. computeAdaptiveInterval — Adaptive Disabled", () => {
    it("1.1 returns base interval when adaptiveEnabled=false (ADAPTIVE_DISABLED)", () => {
      const config = { ...BASE_CONFIG, adaptiveEnabled: false };
      const ctx = makeContext({ count: 10, approvalRate: 0.9 }); // high approval but disabled
      const result = computeAdaptiveInterval(config, ctx);
      expect(result.adaptationReason).toBe("ADAPTIVE_DISABLED");
      expect(result.intervalMinutes).toBe(config.baseIntervalMinutes);
    });

    it("1.2 adaptiveEnabled=false ignores all context signals", () => {
      const config = { ...BASE_CONFIG, adaptiveEnabled: false };
      const ctx = makeContext({ count: 20, approvalRate: 0.0, dailyLimitHits: 15 }); // extreme signals
      const result = computeAdaptiveInterval(config, ctx);
      expect(result.intervalMinutes).toBe(config.baseIntervalMinutes);
      expect(result.adaptationReason).toBe("ADAPTIVE_DISABLED");
    });
  });

  // ─── 2. Policy: Warm-Up Behavior ─────────────────────────────

  describe("2. computeAdaptiveInterval — Warm-Up Behavior", () => {
    it("2.1 returns base interval when no context provided (NO_CONTEXT)", () => {
      const result = computeAdaptiveInterval(BASE_CONFIG, undefined);
      expect(result.adaptationReason).toBe("NO_CONTEXT");
      expect(result.intervalMinutes).toBe(BASE_CONFIG.baseIntervalMinutes);
      expect(result.approvalRate).toBeNull();
      expect(result.dailyLimitPressure).toBeNull();
    });

    it("2.2 returns base interval when count < warmupCycles (WARMUP_BASE_INTERVAL)", () => {
      const ctx = makeContext({ count: 4, approvalRate: 0.9 }); // count < warmupCycles=5
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("WARMUP_BASE_INTERVAL");
      expect(result.intervalMinutes).toBe(BASE_CONFIG.baseIntervalMinutes);
    });

    it("2.3 warm-up with count exactly = warmupCycles - 1 uses base interval", () => {
      const cfg = { ...BASE_CONFIG, warmupCycles: 5 };
      const ctx = makeContext({ count: 4 }); // 4 < 5
      const result = computeAdaptiveInterval(cfg, ctx);
      expect(result.adaptationReason).toBe("WARMUP_BASE_INTERVAL");
    });

    it("2.4 adaptation activates when count >= warmupCycles", () => {
      const cfg = { ...BASE_CONFIG, warmupCycles: 5 };
      const ctx = makeContext({ count: 5, approvalRate: 0.9 }); // exactly 5 = warmupCycles
      const result = computeAdaptiveInterval(cfg, ctx);
      // approvalRate 0.9 → HIGH_APPROVAL_RATE, interval should drop
      expect(result.adaptationReason).toBe("HIGH_APPROVAL_RATE");
      expect(result.intervalMinutes).toBeLessThan(cfg.baseIntervalMinutes);
    });

    it("2.5 warmupCycles=1 activates adaptation after first cycle", () => {
      const cfg = { ...BASE_CONFIG, warmupCycles: 1 };
      const ctx = makeContext({ count: 1, approvalRate: 0.8 });
      const result = computeAdaptiveInterval(cfg, ctx);
      expect(result.adaptationReason).toBe("HIGH_APPROVAL_RATE");
    });
  });

  // ─── 3. Policy: High Approval Rate ───────────────────────────

  describe("3. computeAdaptiveInterval — High Approval Rate", () => {
    it("3.1 HIGH_APPROVAL_RATE when approvalRate >= 0.7 → shorter interval", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.9 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("HIGH_APPROVAL_RATE");
      expect(result.intervalMinutes).toBeLessThan(BASE_CONFIG.baseIntervalMinutes);
    });

    it("3.2 approvalRate=1.0 pushes interval toward minimum", () => {
      const ctx = makeContext({ count: 10, approvalRate: 1.0 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.intervalMinutes).toBeLessThan(BASE_CONFIG.baseIntervalMinutes);
      expect(result.intervalMinutes).toBeGreaterThanOrEqual(BASE_CONFIG.minIntervalMinutes);
    });

    it("3.3 approvalRate=0.7 boundary triggers HIGH_APPROVAL_RATE", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.7 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("HIGH_APPROVAL_RATE");
    });
  });

  // ─── 4. Policy: Low Approval Rate ────────────────────────────

  describe("4. computeAdaptiveInterval — Low Approval Rate", () => {
    it("4.1 LOW_APPROVAL_RATE when approvalRate < 0.3 → longer interval", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.1 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("LOW_APPROVAL_RATE");
      expect(result.intervalMinutes).toBeGreaterThan(BASE_CONFIG.baseIntervalMinutes);
    });

    it("4.2 approvalRate=0.0 pushes interval toward maximum", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.0 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.intervalMinutes).toBeGreaterThan(BASE_CONFIG.baseIntervalMinutes);
      expect(result.intervalMinutes).toBeLessThanOrEqual(BASE_CONFIG.maxIntervalMinutes);
    });

    it("4.3 approvalRate=0.29 (just below 0.3) triggers LOW_APPROVAL_RATE", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.29 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("LOW_APPROVAL_RATE");
    });
  });

  // ─── 5. Policy: Neutral Approval Rate ────────────────────────

  describe("5. computeAdaptiveInterval — Neutral Context", () => {
    it("5.1 NEUTRAL_CONTEXT when approvalRate=0.5, no daily pressure", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.5, dailyLimitHits: 0 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("NEUTRAL_CONTEXT");
      expect(result.intervalMinutes).toBe(BASE_CONFIG.baseIntervalMinutes);
    });

    it("5.2 approvalRate between 0.3 and 0.7 with no daily pressure → NEUTRAL_CONTEXT", () => {
      for (const rate of [0.3, 0.4, 0.5, 0.6, 0.69]) {
        const ctx = makeContext({ count: 10, approvalRate: rate, dailyLimitHits: 0 });
        const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
        expect(result.adaptationReason).toBe("NEUTRAL_CONTEXT");
      }
    });

    it("5.3 null approvalRate is treated as 0.5 (neutral) → NEUTRAL_CONTEXT", () => {
      const ctx = makeContext({ count: 10, approvalRate: null, dailyLimitHits: 0 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("NEUTRAL_CONTEXT");
      expect(result.intervalMinutes).toBe(BASE_CONFIG.baseIntervalMinutes);
    });
  });

  // ─── 6. Policy: Daily Limit Pressure ─────────────────────────

  describe("6. computeAdaptiveInterval — Daily Limit Pressure", () => {
    it("6.1 HIGH_DAILY_LIMIT_PRESSURE when > 30% of cycles hit daily cap", () => {
      // 4 out of 10 cycles = 40% pressure → > 0.3 threshold
      const ctx = makeContext({ count: 10, approvalRate: 0.5, dailyLimitHits: 4 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("HIGH_DAILY_LIMIT_PRESSURE");
      expect(result.intervalMinutes).toBeGreaterThanOrEqual(BASE_CONFIG.baseIntervalMinutes);
    });

    it("6.2 daily limit pressure pushes interval upward from base", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.5, dailyLimitHits: 5 }); // 50% pressure
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.intervalMinutes).toBeGreaterThan(BASE_CONFIG.baseIntervalMinutes);
    });

    it("6.3 daily limit pressure takes priority over HIGH_APPROVAL_RATE signal", () => {
      // High approval (would normally shorten interval) but high daily pressure
      const ctx = makeContext({ count: 10, approvalRate: 0.9, dailyLimitHits: 5 });
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("HIGH_DAILY_LIMIT_PRESSURE");
    });

    it("6.4 daily pressure exactly at threshold (3/10 = 0.30) does NOT trigger HIGH_DAILY_LIMIT_PRESSURE", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.9, dailyLimitHits: 3 }); // 30% = not > 0.3
      const result = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(result.adaptationReason).toBe("HIGH_APPROVAL_RATE"); // approvalRate takes over
    });
  });

  // ─── 7. Adaptation Factor ─────────────────────────────────────

  describe("7. computeAdaptiveInterval — Adaptation Factor", () => {
    it("7.1 adaptationFactor=0.0 produces no adaptation (base interval always)", () => {
      const config = { ...BASE_CONFIG, adaptationFactor: 0.0 };
      for (const rate of [0.0, 0.1, 0.5, 0.9, 1.0]) {
        const ctx = makeContext({ count: 10, approvalRate: rate });
        const result = computeAdaptiveInterval(config, ctx);
        expect(result.intervalMinutes).toBe(config.baseIntervalMinutes);
      }
    });

    it("7.2 adaptationFactor=1.0 produces maximum adaptation for extreme signals", () => {
      const config = { ...BASE_CONFIG, adaptationFactor: 1.0 };
      // approvalRate=0.0 with factor=1.0 → maximum upward adjustment
      const ctxLow = makeContext({ count: 10, approvalRate: 0.0 });
      const resultLow = computeAdaptiveInterval(config, ctxLow);
      expect(resultLow.intervalMinutes).toBeGreaterThan(config.baseIntervalMinutes);

      // approvalRate=1.0 with factor=1.0 → maximum downward adjustment
      const ctxHigh = makeContext({ count: 10, approvalRate: 1.0 });
      const resultHigh = computeAdaptiveInterval(config, ctxHigh);
      expect(resultHigh.intervalMinutes).toBeLessThan(config.baseIntervalMinutes);
    });

    it("7.3 adaptationFactor=0.5 produces moderate (not extreme) adjustment", () => {
      const config = { ...BASE_CONFIG, adaptationFactor: 0.5 };
      const ctx = makeContext({ count: 10, approvalRate: 0.0 });
      const result = computeAdaptiveInterval(config, ctx);
      // Should be between base and max, not at max
      expect(result.intervalMinutes).toBeGreaterThan(config.baseIntervalMinutes);
      expect(result.intervalMinutes).toBeLessThan(config.maxIntervalMinutes);
    });
  });

  // ─── 8. Min/Max Clamping Invariant ───────────────────────────

  describe("8. Interval Bounds — Clamping Invariant", () => {
    it("8.1 effectiveInterval is always >= minIntervalMinutes for any inputs", () => {
      const extremeApprovals = [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0];
      const extremeFactors = [0.0, 0.25, 0.5, 0.75, 1.0];
      for (const rate of extremeApprovals) {
        for (const factor of extremeFactors) {
          const config = { ...BASE_CONFIG, adaptationFactor: factor };
          const ctx = makeContext({ count: 10, approvalRate: rate });
          const result = computeAdaptiveInterval(config, ctx);
          expect(result.intervalMinutes).toBeGreaterThanOrEqual(config.minIntervalMinutes);
        }
      }
    });

    it("8.2 effectiveInterval is always <= maxIntervalMinutes for any inputs", () => {
      const extremeApprovals = [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0];
      const extremeFactors = [0.0, 0.25, 0.5, 0.75, 1.0];
      for (const rate of extremeApprovals) {
        for (const factor of extremeFactors) {
          const config = { ...BASE_CONFIG, adaptationFactor: factor };
          const ctx = makeContext({ count: 10, approvalRate: rate });
          const result = computeAdaptiveInterval(config, ctx);
          expect(result.intervalMinutes).toBeLessThanOrEqual(config.maxIntervalMinutes);
        }
      }
    });

    it("8.3 high daily pressure combined with extreme factor is still within bounds", () => {
      const config = { ...BASE_CONFIG, adaptationFactor: 1.0 };
      const ctx = makeContext({ count: 10, approvalRate: 0.0, dailyLimitHits: 10 });
      const result = computeAdaptiveInterval(config, ctx);
      expect(result.intervalMinutes).toBeGreaterThanOrEqual(config.minIntervalMinutes);
      expect(result.intervalMinutes).toBeLessThanOrEqual(config.maxIntervalMinutes);
    });
  });

  // ─── 9. Deterministic Repeated Evaluation ────────────────────

  describe("9. Determinism", () => {
    it("9.1 identical inputs produce identical computeAdaptiveInterval outputs", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.8, dailyLimitHits: 2 });
      const r1 = computeAdaptiveInterval(BASE_CONFIG, ctx);
      const r2 = computeAdaptiveInterval(BASE_CONFIG, ctx);
      expect(r1.intervalMinutes).toBe(r2.intervalMinutes);
      expect(r1.adaptationReason).toBe(r2.adaptationReason);
    });

    it("9.2 identical evaluateSchedulingDecision inputs produce identical decisions", () => {
      const lastCompleted = minutesBefore(60); // 60 min ago — well beyond cooldown + interval
      const ctx = makeContext({ count: 10, approvalRate: 0.8 });
      const input: SchedulingEvaluationInput = {
        now: FIXED_NOW,
        lastCycleCompletedAt: lastCompleted,
        todayDeployCount: 2,
        isLockHeld: false,
        context: ctx,
      };
      const d1 = evaluateSchedulingDecision(BASE_CONFIG, input);
      const d2 = evaluateSchedulingDecision(BASE_CONFIG, input);
      expect(d1.action).toBe(d2.action);
      expect(d1.effectiveIntervalMinutes).toBe(d2.effectiveIntervalMinutes);
      expect(d1.adaptationReason).toBe(d2.adaptationReason);
      expect(d1.canExecute).toBe(d2.canExecute);
    });
  });

  // ─── 10. Invalid Configuration ───────────────────────────────

  describe("10. Invalid Configuration", () => {
    it("10.1 rejects adaptationFactor > 1.0", () => {
      const result = validateSchedulingPolicyConfig({ ...BASE_CONFIG, adaptationFactor: 1.1 });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("adaptationFactor"))).toBe(true);
    });

    it("10.2 rejects adaptationFactor < 0.0", () => {
      const result = validateSchedulingPolicyConfig({ ...BASE_CONFIG, adaptationFactor: -0.1 });
      expect(result.valid).toBe(false);
    });

    it("10.3 rejects warmupCycles < 1", () => {
      const result = validateSchedulingPolicyConfig({ ...BASE_CONFIG, warmupCycles: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("warmupCycles"))).toBe(true);
    });

    it("10.4 evaluateSchedulingDecision throws on invalid config — does not silently RUN", () => {
      const badConfig = { ...BASE_CONFIG, adaptationFactor: 2.0 };
      expect(() =>
        evaluateSchedulingDecision(badConfig, { todayDeployCount: 0 })
      ).toThrow();
    });

    it("10.5 createDefaultSchedulingPolicyConfig throws on invalid overrides", () => {
      expect(() =>
        createDefaultSchedulingPolicyConfig({ adaptationFactor: -1 })
      ).toThrow();
    });

    it("10.6 createDefaultSchedulingPolicyConfig succeeds with valid V2.5.2 defaults", () => {
      const cfg = createDefaultSchedulingPolicyConfig();
      expect(cfg.adaptiveEnabled).toBe(true);
      expect(cfg.adaptationFactor).toBe(0.5);
      expect(cfg.warmupCycles).toBe(5);
      const validation = validateSchedulingPolicyConfig(cfg);
      expect(validation.valid).toBe(true);
    });
  });

  // ─── 11. Gate Behavior: RUN allows existing pipeline ─────────

  describe("11. Gate Decisions — Constraint Precedence", () => {
    it("11.1 canExecute=true when no lastCycleCompletedAt (first boot / cold start)", () => {
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: null,
        todayDeployCount: 0,
        isLockHeld: false,
        context: undefined,
      });
      expect(decision.canExecute).toBe(true);
      expect(decision.action).toBe("RUN");
      expect(decision.reason).toBe("READY");
    });

    it("11.2 canExecute=false when DISABLED (action=DISABLED, waitDurationMs=Infinity)", () => {
      const config = { ...BASE_CONFIG, enabled: false };
      const decision = evaluateSchedulingDecision(config, {
        now: FIXED_NOW,
        todayDeployCount: 0,
        isLockHeld: false,
      });
      expect(decision.canExecute).toBe(false);
      expect(decision.action).toBe("DISABLED");
      expect(decision.waitDurationMs).toBe(Infinity);
    });

    it("11.3 canExecute=false when daily limit reached (action=SKIP_DAILY_LIMIT)", () => {
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        todayDeployCount: 10, // == maxDeploysPerDay
        isLockHeld: false,
      });
      expect(decision.canExecute).toBe(false);
      expect(decision.action).toBe("SKIP_DAILY_LIMIT");
      expect(decision.nextRunAt).not.toBeNull();
    });

    it("11.4 canExecute=false when concurrency lock is held (action=WAIT)", () => {
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        todayDeployCount: 0,
        isLockHeld: true,
      });
      expect(decision.canExecute).toBe(false);
      expect(decision.action).toBe("WAIT");
      expect(decision.reason).toBe("CONCURRENCY_LOCK_ACTIVE");
    });

    it("11.5 canExecute=false during cooldown period", () => {
      const recentCompletion = minutesBefore(2); // 2 min ago, cooldown=5 min
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: recentCompletion,
        todayDeployCount: 0,
        isLockHeld: false,
      });
      expect(decision.canExecute).toBe(false);
      expect(decision.reason).toBe("COOLDOWN_ACTIVE");
      expect(decision.waitDurationMs).toBeGreaterThan(0);
    });

    it("11.6 canExecute=false when interval has not elapsed (action=WAIT, INTERVAL_NOT_ELAPSED)", () => {
      // cooldown satisfied (6 min ago), but base interval 30 min not elapsed
      const recentCompletion = minutesBefore(10);
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: recentCompletion,
        todayDeployCount: 0,
        isLockHeld: false,
        context: undefined, // no context → base interval 30 min
      });
      expect(decision.canExecute).toBe(false);
      expect(decision.reason).toBe("INTERVAL_NOT_ELAPSED");
    });

    it("11.7 canExecute=true when cooldown and interval have both elapsed", () => {
      const recentCompletion = minutesBefore(35); // 35 min ago, both satisfied
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: recentCompletion,
        todayDeployCount: 0,
        isLockHeld: false,
      });
      expect(decision.canExecute).toBe(true);
      expect(decision.action).toBe("RUN");
    });
  });

  // ─── 12. Restart / Recent-Cycle Behavior ─────────────────────

  describe("12. Restart / Recent-Cycle Behavior", () => {
    it("12.1 first boot with empty pipeline_cycles → READY (no lastCycleCompletedAt)", () => {
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: null,
        todayDeployCount: 0,
        isLockHeld: false,
      });
      expect(decision.canExecute).toBe(true);
      expect(decision.action).toBe("RUN");
    });

    it("12.2 restart within cooldown window → WAIT", () => {
      const recentCompletion = minutesBefore(3); // 3 min ago, within 5 min cooldown
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: recentCompletion,
        todayDeployCount: 0,
        isLockHeld: false,
      });
      expect(decision.canExecute).toBe(false);
      expect(decision.reason).toBe("COOLDOWN_ACTIVE");
    });

    it("12.3 restart well after cooldown and interval → READY", () => {
      const recentCompletion = minutesBefore(60); // 60 min ago
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: recentCompletion,
        todayDeployCount: 1,
        isLockHeld: false,
      });
      expect(decision.canExecute).toBe(true);
    });
  });

  // ─── 13. Context Failure Fallback ────────────────────────────

  describe("13. Context Failure Fallback", () => {
    it("13.1 undefined context uses base interval (NO_CONTEXT)", () => {
      const recentCompletion = minutesBefore(35);
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: recentCompletion,
        todayDeployCount: 0,
        isLockHeld: false,
        context: undefined,
      });
      expect(decision.adaptationReason).toBe("NO_CONTEXT");
      expect(decision.effectiveIntervalMinutes).toBe(BASE_CONFIG.baseIntervalMinutes);
    });

    it("13.2 context with 0 cycles uses base interval (WARMUP_BASE_INTERVAL)", () => {
      const ctx = makeContext({ count: 0 });
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: null,
        todayDeployCount: 0,
        isLockHeld: false,
        context: ctx,
      });
      expect(decision.adaptationReason).toBe("WARMUP_BASE_INTERVAL");
      expect(decision.effectiveIntervalMinutes).toBe(BASE_CONFIG.baseIntervalMinutes);
    });

    it("13.3 canExecute=true on first boot even with empty context", () => {
      const ctx = makeContext({ count: 0 });
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: null,
        todayDeployCount: 0,
        isLockHeld: false,
        context: ctx,
      });
      expect(decision.canExecute).toBe(true);
      expect(decision.action).toBe("RUN");
    });
  });

  // ─── 14. Lock TTL Semantics ───────────────────────────────────

  describe("14. Lock TTL Semantics (unchanged)", () => {
    it("14.1 scheduling policy does not read or set lock TTL", () => {
      // The policy only evaluates isLockHeld as a boolean input.
      // It does not compute, override, or derive TTL values.
      // This test verifies that SchedulingDecision never contains a lockTtl field.
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        todayDeployCount: 0,
        isLockHeld: false,
      });
      expect((decision as Record<string, unknown>).lockTtl).toBeUndefined();
      expect((decision as Record<string, unknown>).lockTtlSeconds).toBeUndefined();
    });

    it("14.2 effective interval change does not propagate to lock semantics", () => {
      // Even if the adaptive interval changes to minIntervalMinutes, the lock TTL
      // must remain independent. Policy only observes isLockHeld, never sets it.
      const ctx = makeContext({ count: 10, approvalRate: 1.0 }); // tries to minimize interval
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: minutesBefore(15),
        todayDeployCount: 0,
        isLockHeld: false,
        context: ctx,
      });
      // Interval may have changed but lock concern is absent from decision
      expect(decision.effectiveIntervalMinutes).toBeGreaterThanOrEqual(BASE_CONFIG.minIntervalMinutes);
      expect((decision as Record<string, unknown>).lockTtl).toBeUndefined();
    });
  });

  // ─── 15. SchedulingDecision includes adaptationDetails ────────

  describe("15. SchedulingDecision — adaptationReason & adaptationDetails", () => {
    it("15.1 RUN decision includes adaptationReason and adaptationDetails", () => {
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: null,
        todayDeployCount: 0,
        isLockHeld: false,
      });
      expect(decision.adaptationReason).toBeDefined();
      expect(decision.adaptationDetails).toBeDefined();
      expect(decision.adaptationDetails.baseIntervalMinutes).toBe(BASE_CONFIG.baseIntervalMinutes);
    });

    it("15.2 DISABLED decision still includes adaptationDetails", () => {
      const config = { ...BASE_CONFIG, enabled: false };
      const decision = evaluateSchedulingDecision(config, { todayDeployCount: 0 });
      expect(decision.adaptationReason).toBeDefined();
      expect(decision.adaptationDetails.baseIntervalMinutes).toBe(config.baseIntervalMinutes);
    });

    it("15.3 WAIT decision with high approval rate has correct adaptationReason", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.9 });
      const recentCompletion = minutesBefore(5); // within 30-min interval but past cooldown
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: recentCompletion,
        todayDeployCount: 0,
        isLockHeld: false,
        context: ctx,
      });
      expect(decision.canExecute).toBe(false);
      expect(decision.adaptationReason).toBe("HIGH_APPROVAL_RATE");
      // Effective interval should be shorter than base due to high approval
      expect(decision.effectiveIntervalMinutes).toBeLessThanOrEqual(BASE_CONFIG.baseIntervalMinutes);
    });

    it("15.4 adaptationDetails contains approvalRate and dailyLimitPressure when context is provided", () => {
      const ctx = makeContext({ count: 10, approvalRate: 0.8, dailyLimitHits: 1 });
      const decision = evaluateSchedulingDecision(BASE_CONFIG, {
        now: FIXED_NOW,
        lastCycleCompletedAt: null,
        todayDeployCount: 0,
        isLockHeld: false,
        context: ctx,
      });
      expect(decision.adaptationDetails.approvalRate).toBe(0.8);
      expect(decision.adaptationDetails.dailyLimitPressure).toBeCloseTo(0.1, 5);
    });
  });
});
