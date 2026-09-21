import { describe, it, expect } from "bun:test";
import {
  validateSchedulingPolicyConfig,
  clampInterval,
  createDefaultSchedulingPolicyConfig,
  evaluateSchedulingDecision,
  type SchedulingPolicyConfig,
  type SchedulingEvaluationInput,
} from "../src/modules/intelligence/scheduling-policy.ts";
import type { SchedulingContext } from "../src/modules/intelligence/scheduling-context.ts";

describe("V2.5.1 — Bounded Scheduling Policy Layer", () => {
  const validConfig: SchedulingPolicyConfig = {
    enabled: true,
    baseIntervalMinutes: 30,
    minIntervalMinutes: 10,
    maxIntervalMinutes: 60,
    cooldownMinutes: 5,
    maxDeploysPerDay: 10,
  };

  const fixedNow = "2026-09-05T12:00:00.000Z";
  const fixedNowMs = new Date(fixedNow).getTime();

  // ─── 1. Disabled Scheduler ─────────────────────────────────
  describe("1. Disabled Scheduler Kill-Switch", () => {
    it("1.1 returns DISABLED action and canExecute=false when enabled is false", () => {
      const config = { ...validConfig, enabled: false };
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: null,
      };

      const decision = evaluateSchedulingDecision(config, input);

      expect(decision.action).toBe("DISABLED");
      expect(decision.canExecute).toBe(false);
      expect(decision.reason).toBe("SCHEDULER_DISABLED");
      expect(decision.nextRunAt).toBeNull();
      expect(decision.waitDurationMs).toBe(Infinity);
      expect(decision.evaluatedAt).toBe(fixedNow);
    });

    it("1.2 disabled kill-switch overrides all other ready states", () => {
      const config = { ...validConfig, enabled: false };
      // Even with cooldown long expired and 0 deploys
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: new Date(fixedNowMs - 120 * 60 * 1000).toISOString(),
        isLockHeld: false,
      };

      const decision = evaluateSchedulingDecision(config, input);
      expect(decision.action).toBe("DISABLED");
      expect(decision.canExecute).toBe(false);
    });
  });

  // ─── 2. Minimum Interval & Clamping ────────────────────────
  describe("2. Minimum Interval Clamping", () => {
    it("2.1 clamps proposed interval up to minIntervalMinutes if proposed is too low", () => {
      expect(clampInterval(5, 10, 60)).toBe(10);
      expect(clampInterval(0, 10, 60)).toBe(10);
      expect(clampInterval(-15, 10, 60)).toBe(10);
    });

    it("2.2 effectiveIntervalMinutes is strictly >= minIntervalMinutes", () => {
      const decision = evaluateSchedulingDecision(validConfig, {
        now: fixedNow,
        todayDeployCount: 0,
      });
      expect(decision.effectiveIntervalMinutes).toBeGreaterThanOrEqual(validConfig.minIntervalMinutes);
    });
  });

  // ─── 3. Maximum Interval & Clamping ────────────────────────
  describe("3. Maximum Interval Clamping", () => {
    it("3.1 clamps proposed interval down to maxIntervalMinutes if proposed is too high", () => {
      expect(clampInterval(120, 10, 60)).toBe(60);
      expect(clampInterval(9999, 10, 60)).toBe(60);
    });

    it("3.2 effectiveIntervalMinutes is strictly <= maxIntervalMinutes", () => {
      const decision = evaluateSchedulingDecision(validConfig, {
        now: fixedNow,
        todayDeployCount: 0,
      });
      expect(decision.effectiveIntervalMinutes).toBeLessThanOrEqual(validConfig.maxIntervalMinutes);
    });
  });

  // ─── 4. Cooldown Active & Expired ──────────────────────────
  describe("4. Cooldown Active vs Expired", () => {
    it("4.1 returns WAIT with COOLDOWN_ACTIVE when elapsed time < cooldownMinutes", () => {
      // Completed 2 minutes ago; cooldown is 5 minutes
      const completedAt = new Date(fixedNowMs - 2 * 60 * 1000).toISOString();
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: completedAt,
      };

      const decision = evaluateSchedulingDecision(validConfig, input);

      expect(decision.action).toBe("WAIT");
      expect(decision.canExecute).toBe(false);
      expect(decision.reason).toBe("COOLDOWN_ACTIVE");
      expect(decision.waitDurationMs).toBe(3 * 60 * 1000);
      expect(decision.nextRunAt).toBe(new Date(fixedNowMs + 3 * 60 * 1000).toISOString());
    });

    it("4.2 transitions to INTERVAL_NOT_ELAPSED when cooldown is expired but interval is not yet reached", () => {
      // Completed 10 minutes ago; cooldown (5m) is expired, but baseInterval (30m) is not reached
      const completedAt = new Date(fixedNowMs - 10 * 60 * 1000).toISOString();
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: completedAt,
      };

      const decision = evaluateSchedulingDecision(validConfig, input);

      expect(decision.action).toBe("WAIT");
      expect(decision.canExecute).toBe(false);
      expect(decision.reason).toBe("INTERVAL_NOT_ELAPSED");
      expect(decision.waitDurationMs).toBe(20 * 60 * 1000);
      expect(decision.nextRunAt).toBe(new Date(fixedNowMs + 20 * 60 * 1000).toISOString());
    });

    it("4.3 returns RUN with READY when both cooldown and interval have fully elapsed", () => {
      // Completed 35 minutes ago; both cooldown (5m) and interval (30m) have elapsed
      const completedAt = new Date(fixedNowMs - 35 * 60 * 1000).toISOString();
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: completedAt,
      };

      const decision = evaluateSchedulingDecision(validConfig, input);

      expect(decision.action).toBe("RUN");
      expect(decision.canExecute).toBe(true);
      expect(decision.reason).toBe("READY");
      expect(decision.waitDurationMs).toBe(0);
      expect(decision.nextRunAt).toBe(fixedNow);
    });
  });

  // ─── 5. Context Handling (Empty vs Normal) ─────────────────
  describe("5. Context Handling", () => {
    it("5.1 evaluates safely when context is omitted", () => {
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        context: undefined,
      };

      const decision = evaluateSchedulingDecision(validConfig, input);
      expect(decision.action).toBe("RUN");
      expect(decision.canExecute).toBe(true);
    });

    it("5.2 evaluates safely when context is empty (0 cycles)", () => {
      const emptyContext: SchedulingContext = {
        generatedAt: fixedNow,
        recentCycles: {
          count: 0,
          avgDurationMs: null,
          approvalRate: null,
          deploymentRate: null,
          dailyLimitHits: 0,
          lockSkips: 0,
        },
        candidateFunnel: {
          windowDays: 7,
          discovered: 0,
          analyzed: 0,
          approved: 0,
          rejectedLowScore: 0,
          rejectedSaturated: 0,
          deployed: 0,
          deploymentsConfirmed: 0,
        },
      };

      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        context: emptyContext,
      };

      const decision = evaluateSchedulingDecision(validConfig, input);
      expect(decision.canExecute).toBe(true);
      expect(decision.reason).toBe("READY");
    });

    it("5.3 evaluates cleanly when context has populated cycle metrics", () => {
      const populatedContext: SchedulingContext = {
        generatedAt: fixedNow,
        recentCycles: {
          count: 15,
          avgDurationMs: 4200,
          approvalRate: 0.6,
          deploymentRate: 0.8,
          dailyLimitHits: 1,
          lockSkips: 2,
        },
        candidateFunnel: {
          windowDays: 7,
          discovered: 15,
          analyzed: 15,
          approved: 9,
          rejectedLowScore: 4,
          rejectedSaturated: 2,
          deployed: 18,
          deploymentsConfirmed: 14,
        },
      };

      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 2,
        context: populatedContext,
      };

      const decision = evaluateSchedulingDecision(validConfig, input);
      expect(decision.canExecute).toBe(true);
      expect(decision.effectiveIntervalMinutes).toBe(30);
    });
  });

  // ─── 6. Hard-Constraint Precedence ─────────────────────────
  describe("6. Hard-Constraint Precedence Hierarchy", () => {
    it("6.1 Precedence 1: Disabled beats Daily Limit and Lock", () => {
      const config = { ...validConfig, enabled: false };
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 15, // over limit
        isLockHeld: true,     // lock held
      };

      const decision = evaluateSchedulingDecision(config, input);
      expect(decision.reason).toBe("SCHEDULER_DISABLED");
    });

    it("6.2 Precedence 2: Daily Limit beats Concurrency Lock and Cooldown", () => {
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 10, // at limit
        isLockHeld: true,
        lastCycleCompletedAt: new Date(fixedNowMs - 1 * 60 * 1000).toISOString(), // in cooldown
      };

      const decision = evaluateSchedulingDecision(validConfig, input);
      expect(decision.reason).toBe("DAILY_LIMIT_REACHED");
      expect(decision.action).toBe("SKIP_DAILY_LIMIT");
    });

    it("6.3 Precedence 3: Concurrency Lock beats Cooldown and Interval", () => {
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        isLockHeld: true,
        lastCycleCompletedAt: new Date(fixedNowMs - 1 * 60 * 1000).toISOString(), // in cooldown
      };

      const decision = evaluateSchedulingDecision(validConfig, input);
      expect(decision.reason).toBe("CONCURRENCY_LOCK_ACTIVE");
      expect(decision.action).toBe("WAIT");
    });

    it("6.4 Precedence 4: Cooldown beats Interval", () => {
      // If config had baseInterval=3m and cooldown=5m, cooldown must hold until 5m
      const fastConfig: SchedulingPolicyConfig = {
        ...validConfig,
        minIntervalMinutes: 2,
        baseIntervalMinutes: 3,
        cooldownMinutes: 5,
      };
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: new Date(fixedNowMs - 4 * 60 * 1000).toISOString(), // 4m elapsed: >3m interval, but <5m cooldown
      };

      const decision = evaluateSchedulingDecision(fastConfig, input);
      expect(decision.reason).toBe("COOLDOWN_ACTIVE");
      expect(decision.action).toBe("WAIT");
    });
  });

  // ─── 7. Deterministic Output ───────────────────────────────
  describe("7. Deterministic Idempotency", () => {
    it("7.1 returns identical decisions for identical inputs across repeated evaluations", () => {
      const input: SchedulingEvaluationInput = {
        now: fixedNow,
        todayDeployCount: 3,
        lastCycleCompletedAt: new Date(fixedNowMs - 20 * 60 * 1000).toISOString(),
      };

      const d1 = evaluateSchedulingDecision(validConfig, input);
      const d2 = evaluateSchedulingDecision(validConfig, input);

      expect(d1).toEqual(d2);
    });
  });

  // ─── 8. Configuration Validation ───────────────────────────
  describe("8. Configuration Validation & Error Handling", () => {
    it("8.1 rejects non-positive minIntervalMinutes", () => {
      const result = validateSchedulingPolicyConfig({
        ...validConfig,
        minIntervalMinutes: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("minIntervalMinutes"))).toBe(true);
    });

    it("8.2 rejects maxIntervalMinutes < minIntervalMinutes", () => {
      const result = validateSchedulingPolicyConfig({
        ...validConfig,
        minIntervalMinutes: 30,
        maxIntervalMinutes: 20,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("maxIntervalMinutes"))).toBe(true);
    });

    it("8.3 rejects baseIntervalMinutes outside [min, max]", () => {
      const resultTooLow = validateSchedulingPolicyConfig({
        ...validConfig,
        minIntervalMinutes: 15,
        baseIntervalMinutes: 10,
        maxIntervalMinutes: 60,
      });
      expect(resultTooLow.valid).toBe(false);

      const resultTooHigh = validateSchedulingPolicyConfig({
        ...validConfig,
        minIntervalMinutes: 10,
        baseIntervalMinutes: 75,
        maxIntervalMinutes: 60,
      });
      expect(resultTooHigh.valid).toBe(false);
    });

    it("8.4 rejects negative cooldownMinutes and non-positive maxDeploysPerDay", () => {
      const res = validateSchedulingPolicyConfig({
        ...validConfig,
        cooldownMinutes: -1,
        maxDeploysPerDay: 0,
      });
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("8.5 evaluateSchedulingDecision throws on invalid configuration", () => {
      const badConfig = { ...validConfig, minIntervalMinutes: -5 };
      expect(() =>
        evaluateSchedulingDecision(badConfig, { todayDeployCount: 0 })
      ).toThrow("Invalid SchedulingPolicyConfig");
    });

    it("8.6 createDefaultSchedulingPolicyConfig creates valid config with overrides", () => {
      const config = createDefaultSchedulingPolicyConfig({ baseIntervalMinutes: 45 });
      expect(config.baseIntervalMinutes).toBe(45);
      expect(config.minIntervalMinutes).toBe(10);
      expect(config.enabled).toBe(true);
    });
  });

  // ─── 9. Exact Boundary Values ──────────────────────────────
  describe("9. Exact Boundary Value Behavior", () => {
    it("9.1 todayDeployCount exactly at maxDeploysPerDay triggers SKIP_DAILY_LIMIT", () => {
      const atLimit = evaluateSchedulingDecision(validConfig, {
        now: fixedNow,
        todayDeployCount: 10, // max is 10
      });
      expect(atLimit.action).toBe("SKIP_DAILY_LIMIT");
      expect(atLimit.canExecute).toBe(false);

      const belowLimit = evaluateSchedulingDecision(validConfig, {
        now: fixedNow,
        todayDeployCount: 9,
      });
      expect(belowLimit.canExecute).toBe(true);
    });

    it("9.2 elapsed time exactly equals cooldown: cooldown is satisfied", () => {
      // Cooldown is 5 minutes (300,000 ms). If interval is 5 minutes and elapsed is exactly 300,000 ms:
      const fastConfig: SchedulingPolicyConfig = {
        ...validConfig,
        minIntervalMinutes: 5,
        baseIntervalMinutes: 5,
        cooldownMinutes: 5,
      };

      const completedAt = new Date(fixedNowMs - 5 * 60 * 1000).toISOString();
      const decision = evaluateSchedulingDecision(fastConfig, {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: completedAt,
      });

      expect(decision.canExecute).toBe(true);
      expect(decision.reason).toBe("READY");
    });

    it("9.3 elapsed time 1 millisecond before cooldown: still in cooldown", () => {
      const fastConfig: SchedulingPolicyConfig = {
        ...validConfig,
        minIntervalMinutes: 5,
        baseIntervalMinutes: 5,
        cooldownMinutes: 5,
      };

      const completedAt = new Date(fixedNowMs - (5 * 60 * 1000 - 1)).toISOString();
      const decision = evaluateSchedulingDecision(fastConfig, {
        now: fixedNow,
        todayDeployCount: 0,
        lastCycleCompletedAt: completedAt,
      });

      expect(decision.canExecute).toBe(false);
      expect(decision.reason).toBe("COOLDOWN_ACTIVE");
    });
  });

  // ─── 10. Interval Invariant: Never Below Min, Never Above Max 
  describe("10. Interval Invariant Enforcement", () => {
    it("10.1 guarantees interval is strictly within [minIntervalMinutes, maxIntervalMinutes] for all inputs", () => {
      const testInputs = [-1000, -1, 0, 1, 5, 9, 10, 25, 30, 59, 60, 61, 100, 100000];

      for (const val of testInputs) {
        const clamped = clampInterval(val, 10, 60);
        expect(clamped).toBeGreaterThanOrEqual(10);
        expect(clamped).toBeLessThanOrEqual(60);
      }
    });
  });
});
