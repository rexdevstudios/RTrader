import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import {
  parseRehearsalArgs,
  rehearseChainDeployment,
  runRehearsalSuite,
} from "../scripts/rehearse-deployment.ts";
import { releaseLock, isLockHeld } from "../src/db/vault.ts";

describe("Guided Preflight Dry-Run Rehearsal Suite (Phase 5 P0)", () => {
  beforeEach(() => {
    releaseLock("deploy_lock_base");
    releaseLock("deploy_lock_solana");
  });

  afterEach(() => {
    releaseLock("deploy_lock_base");
    releaseLock("deploy_lock_solana");
  });

  it("1. should parse rehearsal CLI flags correctly", () => {
    const defaultArgs = parseRehearsalArgs([]);
    expect(defaultArgs.chains).toEqual(["base", "solana"]);
    expect(defaultArgs.fastMock).toBe(false);

    const baseArgs = parseRehearsalArgs(["--chain", "base", "--fast"]);
    expect(baseArgs.chains).toEqual(["base"]);
    expect(baseArgs.fastMock).toBe(true);

    const solanaArgs = parseRehearsalArgs(["-c", "solana", "--mock"]);
    expect(solanaArgs.chains).toEqual(["solana"]);
    expect(solanaArgs.fastMock).toBe(true);
  });

  it("2. should rehearse Base deployment with zero gas and pass safety gate", async () => {
    const res = await rehearseChainDeployment("base", { fastMock: true });
    expect(res.chain).toBe("base");
    expect(res.identity).toBeDefined();
    expect(res.safetyGate.passed).toBe(true);
    expect(res.lockHealth.passed).toBe(true);
    expect(res.offerGenerated).toBe(true);
    expect(res.launchPack).toBeDefined();
    expect(res.launchPack?.powerTweetFits).toBe(true);
    expect(res.readinessScore).toBeDefined();
    expect(res.readinessScore?.overallScore).toBeGreaterThan(0);
    expect(res.readinessScore?.verdict).toBeDefined();
    expect(res.success).toBe(true);
    expect(isLockHeld("deploy_lock_base")).toBe(false);
  });

  it("3. should rehearse Solana deployment with zero gas and pass safety gate", async () => {
    const res = await rehearseChainDeployment("solana", { fastMock: true });
    expect(res.chain).toBe("solana");
    expect(res.identity).toBeDefined();
    expect(res.safetyGate.passed).toBe(true);
    expect(res.lockHealth.passed).toBe(true);
    expect(res.offerGenerated).toBe(true);
    expect(res.launchPack).toBeDefined();
    expect(res.launchPack?.powerTweetFits).toBe(true);
    expect(res.readinessScore).toBeDefined();
    expect(res.predictedCa).toBeDefined();
    expect(res.success).toBe(true);
    expect(isLockHeld("deploy_lock_solana")).toBe(false);
  });

  it("4. should run complete suite across all chains and produce scorecard", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const suite = await runRehearsalSuite({ chains: ["base", "solana"], fastMock: true });
    logSpy.mockRestore();

    expect(suite.overallSuccess).toBe(true);
    expect(suite.checks.base).toBeDefined();
    expect(suite.checks.solana).toBeDefined();
    expect(suite.checks.base.success).toBe(true);
    expect(suite.checks.solana.success).toBe(true);
  });
});
