/**
 * tests/cloudflare-cleaner.test.ts
 *
 * Automated regression test verifying the Cloudflare Pages Lifecycle & LRU Garbage Collector:
 *  1. Protected whitelist logic (never deletes confirmed live tokens).
 *  2. Threshold calculation and candidate eviction sorting (oldest first).
 *  3. Safe simulation fallback when API tokens are omitted.
 */

import { describe, it, expect } from "bun:test";
import {
  getProtectedProjectNames,
  auditAndCleanCloudflareProjects,
  deleteCloudflarePagesProject,
  listCloudflarePagesProjects,
} from "../src/modules/growth/cloudflare-cleaner.ts";

describe("Cloudflare Pages Lifecycle & LRU Garbage Collector Suite", () => {
  it("1. should whitelist and protect live on-chain tokens permanently", () => {
    const protectedSet = getProtectedProjectNames();
    expect(protectedSet.size).toBeGreaterThan(0);
    // pumprun-web3 is the live token on Base
    expect(protectedSet.has("pumprun-web3")).toBe(true);
    expect(protectedSet.has("rtrader-portal")).toBe(true);
  });

  it("2. should return mock project list in simulation mode when uncredentialed", async () => {
    const projects = await listCloudflarePagesProjects("", "");
    expect(Array.isArray(projects)).toBe(true);
    expect(projects.length).toBeGreaterThan(0);
    expect(projects.some((p) => p.name === "pumprun-web3")).toBe(true);
  });

  it("3. should accurately audit project count and recognize safety status", async () => {
    const result = await auditAndCleanCloudflareProjects({
      threshold: 85,
      targetSafeCount: 75,
      dryRun: true,
      accountId: "",
      apiToken: "",
    });

    expect(result.success).toBe(true);
    expect(result.threshold).toBe(85);
    expect(result.protectedCount).toBeGreaterThanOrEqual(1);
    expect(result.isOverThreshold).toBe(false);
    expect(result.mode).toBe("simulation");
  });

  it("4. should trigger eviction when total projects meet or exceed threshold in dry-run", async () => {
    // Set artificially low threshold to test eviction logic
    const result = await auditAndCleanCloudflareProjects({
      threshold: 2,
      targetSafeCount: 1,
      dryRun: true,
      accountId: "",
      apiToken: "",
    });

    expect(result.success).toBe(true);
    expect(result.isOverThreshold).toBe(true);
    expect(result.prunedProjects.length).toBeGreaterThan(0);
    // Verify that pumprun-web3 (protected) was NOT pruned
    expect(result.prunedProjects.includes("pumprun-web3")).toBe(false);
  });

  it("5. should simulate project deletion safely without throwing", async () => {
    const deleted = await deleteCloudflarePagesProject("test-simulation-to-delete", "", "");
    expect(deleted).toBe(true);
  });
});
