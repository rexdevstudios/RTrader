import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import {
  evaluateFleetAlerts,
  formatFleetAlertCard,
  checkAndDispatchFleetAlerts,
  clearFleetAlertCooldown,
  type FleetAlert,
} from "../src/modules/fleet/fleet-alerts.ts";
import type { FleetReconciliationResult } from "../src/modules/reconciliation/onchain-reconciler.ts";

describe("Automated Fleet Health & Liquidity Alerting (Phase 5 P1)", () => {
  beforeEach(() => {
    clearFleetAlertCooldown();
  });

  afterEach(() => {
    clearFleetAlertCooldown();
  });

  it("1. should detect low liquidity anomaly and flag correct severity", () => {
    const warningItem: FleetReconciliationResult = {
      contractAddress: "0x1111111111111111111111111111111111111111",
      chain: "base",
      onChainVerified: true,
      onChainStatus: "confirmed",
      liquidityUsd: 65, // Below $100 default threshold -> warning
      priceUsd: "0.00005",
      lifecycleState: "DEPLOY_CONFIRMED",
      poolUpdated: false,
      lifecycleUpdated: false,
      reconciledAt: new Date().toISOString(),
    };

    const alerts = evaluateFleetAlerts(warningItem, { minLiquidityUsd: 100 });
    expect(alerts.length).toBe(1);
    expect(alerts[0].alertType).toBe("LOW_LIQUIDITY");
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].liquidityUsd).toBe(65);

    const criticalItem: FleetReconciliationResult = {
      ...warningItem,
      contractAddress: "0x2222222222222222222222222222222222222222",
      liquidityUsd: 10, // Below $25 -> critical
    };

    const critAlerts = evaluateFleetAlerts(criticalItem);
    expect(critAlerts.length).toBe(1);
    expect(critAlerts[0].severity).toBe("critical");
  });

  it("2. should return zero alerts for healthy tokens with adequate liquidity", () => {
    const healthyItem: FleetReconciliationResult = {
      contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      chain: "base",
      onChainVerified: true,
      onChainStatus: "confirmed",
      liquidityUsd: 15000, // Healthy
      priceUsd: "0.0012",
      lifecycleState: "DEPLOY_CONFIRMED",
      poolUpdated: false,
      lifecycleUpdated: false,
      reconciledAt: new Date().toISOString(),
    };

    const alerts = evaluateFleetAlerts(healthyItem);
    expect(alerts.length).toBe(0);
  });

  it("3. should format readable markdown alert cards", () => {
    const mockAlert: FleetAlert = {
      tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      chain: "base",
      alertType: "LOW_LIQUIDITY",
      severity: "critical",
      message: "Pool liquidity dropped to $15 USD",
      liquidityUsd: 15,
      priceUsd: "$0.000001",
      detectedAt: "2026-09-08T12:00:00Z",
    };

    const card = formatFleetAlertCard(mockAlert);
    expect(card).toContain("🚨");
    expect(card).toContain("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    expect(card).toContain("CRITICAL");
    expect(card).toContain("Pool liquidity dropped to $15 USD");
  });

  it("4. should enforce alert cooldown to prevent duplicate notifications", async () => {
    const unhealthyItem: FleetReconciliationResult = {
      contractAddress: "0x3333333333333333333333333333333333333333",
      chain: "base",
      onChainVerified: true,
      onChainStatus: "confirmed",
      liquidityUsd: 30,
      lifecycleState: "DEPLOY_CONFIRMED",
      poolUpdated: false,
      lifecycleUpdated: false,
      reconciledAt: new Date().toISOString(),
    };

    // First call: detected
    const firstPass = await checkAndDispatchFleetAlerts([unhealthyItem], { cooldownMs: 10000 });
    expect(firstPass.alertsDetected.length).toBe(1);

    // Second immediate call: alert is detected but suppressed by cooldown
    const secondPass = await checkAndDispatchFleetAlerts([unhealthyItem], { cooldownMs: 10000 });
    expect(secondPass.alertsDetected.length).toBe(1);
    expect(secondPass.broadcastResults.length).toBe(0); // Suppressed by cooldown

    // Third call with disableCooldown: true: dispatched
    const thirdPass = await checkAndDispatchFleetAlerts([unhealthyItem], { disableCooldown: true });
    expect(thirdPass.alertsDetected.length).toBe(1);
    expect(thirdPass.broadcastResults.length).toBe(1);
  });
});
