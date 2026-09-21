/**
 * tests/dexscreener-fasttrack-poller.test.ts
 *
 * Automated tests for DexScreener Fast-Track Poller & GoPlus Security Audit.
 */

import { describe, it, expect } from "bun:test";
import {
  pollTokenFastTrackStatus,
  type FastTrackPollingResult,
} from "../src/modules/intelligence/dexscreener-fasttrack-poller.ts";

describe("DexScreener Fast-Track Poller & Audit Suite", () => {
  it("should poll status for a valid Base token and calculate safety and bot readiness", async () => {
    const mockCa = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
    const result: FastTrackPollingResult = await pollTokenFastTrackStatus(mockCa, "base");

    expect(result).toBeDefined();
    expect(result.contractAddress.toLowerCase()).toBe(mockCa.toLowerCase());
    expect(result.chain).toBe("base");
    expect(typeof result.safetyScore).toBe("number");
    expect(result.safetyScore).toBeGreaterThanOrEqual(0);
    expect(result.safetyScore).toBeLessThanOrEqual(100);
    expect(result.safetyVerdict).toBeDefined();
    expect(typeof result.sniperBotReady).toBe("boolean");
    expect(typeof result.pairCreated).toBe("boolean");
    expect(result.timestamp).toBeDefined();
  }, 30000);

  it("should handle unindexed simulated tokens safely without crashing", async () => {
    const mockSimulatedCa = "0x0000000000000000000000000000000000000001";
    const result = await pollTokenFastTrackStatus(mockSimulatedCa, "base");

    expect(result).toBeDefined();
    expect(result.contractAddress).toBe(mockSimulatedCa);
    expect(result.pairCreated).toBe(false);
    expect(result.isDexScreenerPaid).toBe(false);
  }, 30000);
});
