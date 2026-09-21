import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import {
  parseReconcileArgs,
  runFleetReconcilePass,
} from "../scripts/reconcile-fleet.ts";
import { acquireLock, releaseLock, isLockHeld } from "../src/db/vault.ts";

describe("Fleet Reconciliation Worker Tests (Phase 4 P1)", () => {
  beforeEach(() => {
    releaseLock("reconcile_fleet_worker");
  });

  afterEach(() => {
    releaseLock("reconcile_fleet_worker");
  });

  it("1. should parse CLI arguments for daemon and one-shot modes correctly", () => {
    const defaultArgs = parseReconcileArgs([]);
    expect(defaultArgs.isDaemon).toBe(false);
    expect(defaultArgs.intervalMinutes).toBe(5);
    expect(defaultArgs.limit).toBe(50);
    expect(defaultArgs.fetchDex).toBe(true);

    const daemonArgs = parseReconcileArgs(["--daemon", "10", "--limit", "25", "--no-dex"]);
    expect(daemonArgs.isDaemon).toBe(true);
    expect(daemonArgs.intervalMinutes).toBe(10);
    expect(daemonArgs.limit).toBe(25);
    expect(daemonArgs.fetchDex).toBe(false);

    const shortArgs = parseReconcileArgs(["-d", "2", "-l", "15"]);
    expect(shortArgs.isDaemon).toBe(true);
    expect(shortArgs.intervalMinutes).toBe(2);
    expect(shortArgs.limit).toBe(15);
  });

  it("2. should skip reconciliation and report cleanly when lock is already held", async () => {
    // Acquire lock manually
    const acquired = acquireLock("reconcile_fleet_worker", 60, "test_holder");
    expect(acquired).toBe(true);

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const res = await runFleetReconcilePass();
    logSpy.mockRestore();

    expect(res.reconciledCount).toBe(0);
    expect(res.results.length).toBe(0);
  });

  it("3. should execute reconciliation pass and release lock cleanly in finally block", async () => {
    expect(isLockHeld("reconcile_fleet_worker")).toBe(false);

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const res = await runFleetReconcilePass({ limit: 5, fetchDex: false });
    logSpy.mockRestore();

    expect(res).toBeDefined();
    expect(typeof res.totalFleet).toBe("number");
    expect(Array.isArray(res.results)).toBe(true);

    // Lock must be released
    expect(isLockHeld("reconcile_fleet_worker")).toBe(false);
  });
});
