/**
 * tests/wallet-proxy-flapping-guard.test.ts
 *
 * Test suite for:
 * 1. Flapping Penalty Calculation & Exponential Backoff (evaluateQuarantineCooldown)
 * 2. Health Recheck Flapping Guard (recheckProxyHealth with flapping protection)
 * 3. Proactive Pre-Flight Pool Resupply (probeAndResupplyQuarantinedPool & resolveExecutableWalletForCycle)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import {
  registerWalletAccount,
  registerProxyConfig,
  getProxyConfig,
  evaluateQuarantineCooldown,
  probeAndResupplyQuarantinedPool,
  setWalletProviderRoute,
} from "../src/modules/identity/wallet-manager.ts";
import { recheckProxyHealth } from "../scripts/manage-wallets.ts";
import { resolveExecutableWalletForCycle } from "../src/modules/identity/execution-wallet-resolver.ts";
import { resetConfig } from "../src/config.ts";

const db = new Database(DB_PATH);

describe("Proxy Health Flapping Guard & Proactive Pool Resupply Test Suite", () => {
  const PREFIX = "flapping_test_";

  beforeEach(() => {
    resetConfig();
    cleanupTestData();
  });

  afterEach(() => {
    cleanupTestData();
  });

  function cleanupTestData() {
    db.run(`DELETE FROM wallet_provider_routes WHERE wallet_id LIKE '${PREFIX}%'`);
    db.run(
      `DELETE FROM proxy_audit_logs WHERE wallet_id LIKE '${PREFIX}%' OR previous_proxy_id LIKE '${PREFIX}%' OR new_proxy_id LIKE '${PREFIX}%'`
    );
    db.run(`DELETE FROM wallet_accounts WHERE id LIKE '${PREFIX}%'`);
    db.run(`DELETE FROM proxy_configs WHERE id LIKE '${PREFIX}%'`);
  }

  describe("1. Flapping Penalty Calculation (evaluateQuarantineCooldown)", () => {
    it("1.1 should return eligible with 0 hours penalty when proxy has zero failure history", () => {
      const proxyId = `${PREFIX}clean_proxy`;
      registerProxyConfig({
        id: proxyId,
        protocol: "http",
        host: "192.168.1.1",
        port: 8080,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      const report = evaluateQuarantineCooldown(proxyId);
      expect(report.isEligible).toBe(true);
      expect(report.penaltyHours).toBe(0);
      expect(report.remainingMinutes).toBe(0);
      expect(report.recentFailures).toBe(0);
    });

    it("1.2 should apply 1 hour penalty for 1 recent failure and report ineligible within cooldown", () => {
      const proxyId = `${PREFIX}fail_1x`;
      registerProxyConfig({
        id: proxyId,
        protocol: "http",
        host: "192.168.1.2",
        port: 8080,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Insert 1 audit log 15 minutes ago
      db.run(
        `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
         VALUES (?, 'bankr', ?, NULL, 'Auto-failover: timeout', datetime('now', '-15 minutes'))`,
        [`${PREFIX}wallet_1`, proxyId]
      );

      const report = evaluateQuarantineCooldown(proxyId);
      expect(report.isEligible).toBe(false);
      expect(report.penaltyHours).toBe(1);
      expect(report.recentFailures).toBe(1);
      expect(report.remainingMinutes).toBeGreaterThan(0);
      expect(report.remainingMinutes).toBeLessThanOrEqual(46);
    });

    it("1.3 should apply 6 hours penalty for 2 recent failures", () => {
      const proxyId = `${PREFIX}fail_2x`;
      registerProxyConfig({
        id: proxyId,
        protocol: "http",
        host: "192.168.1.3",
        port: 8080,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Insert 2 audit logs within recent hours
      db.run(
        `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
         VALUES (?, 'bankr', ?, NULL, 'Failover 1', datetime('now', '-3 hours'))`,
        [`${PREFIX}wallet_1`, proxyId]
      );
      db.run(
        `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
         VALUES (?, 'bankr', ?, NULL, 'Failover 2', datetime('now', '-30 minutes'))`,
        [`${PREFIX}wallet_1`, proxyId]
      );

      const report = evaluateQuarantineCooldown(proxyId);
      expect(report.isEligible).toBe(false);
      expect(report.penaltyHours).toBe(6);
      expect(report.recentFailures).toBe(2);
      expect(report.remainingMinutes).toBeGreaterThan(300);
    });

    it("1.4 should apply 24 hours penalty for 3 or more recent failures (severe flapping)", () => {
      const proxyId = `${PREFIX}fail_3x`;
      registerProxyConfig({
        id: proxyId,
        protocol: "http",
        host: "192.168.1.4",
        port: 8080,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      for (let i = 1; i <= 3; i++) {
        db.run(
          `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
           VALUES (?, 'bankr', ?, NULL, ?, datetime('now', '-${i} hours'))`,
          [`${PREFIX}wallet_1`, proxyId, `Failover ${i}`]
        );
      }

      const report = evaluateQuarantineCooldown(proxyId);
      expect(report.isEligible).toBe(false);
      expect(report.penaltyHours).toBe(24);
      expect(report.recentFailures).toBe(3);
      expect(report.remainingMinutes).toBeGreaterThan(1200);
    });

    it("1.5 should mark proxy eligible once penalty window has fully elapsed", () => {
      const proxyId = `${PREFIX}expired_cooldown`;
      registerProxyConfig({
        id: proxyId,
        protocol: "http",
        host: "192.168.1.5",
        port: 8080,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // 1 failure occurred 2 hours ago (penalty for 1 failure is 1 hour)
      db.run(
        `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
         VALUES (?, 'bankr', ?, NULL, 'Old failover', datetime('now', '-2 hours'))`,
        [`${PREFIX}wallet_1`, proxyId]
      );

      const report = evaluateQuarantineCooldown(proxyId);
      expect(report.isEligible).toBe(true);
      expect(report.penaltyHours).toBe(1);
      expect(report.remainingMinutes).toBe(0);
      expect(report.recentFailures).toBe(1);
    });
  });

  describe("2. Health Recheck Flapping Guard (recheckProxyHealth)", () => {
    it("2.1 should keep responsive proxy in DISABLED status when still in flapping cooldown", async () => {
      const flappingId = `${PREFIX}flapping_proxy`;

      registerProxyConfig({
        id: flappingId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1080,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Record recent failure (1 failure -> 1h penalty)
      db.run(
        `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
         VALUES (?, 'bankr', ?, NULL, 'Recent failover', datetime('now', '-10 minutes'))`,
        [`${PREFIX}wallet_guard`, flappingId]
      );

      // Probe quarantined (socks5 returns available naturally without live network)
      const res = await recheckProxyHealth({ probeQuarantined: true });

      // Flapping proxy was prevented from unquarantining!
      expect(res.unquarantinedDetails?.some((d) => d.includes(flappingId))).toBe(false);

      const proxyAfter = getProxyConfig(flappingId);
      expect(proxyAfter?.status).toBe("DISABLED");
      expect(proxyAfter?.healthStatus).toBe("available");
    });

    it("2.2 should unquarantine responsive proxy when flapping cooldown has elapsed", async () => {
      const healedId = `${PREFIX}healed_proxy`;

      registerProxyConfig({
        id: healedId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1081,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Record failure 2 hours ago (1 failure -> 1h penalty which is now expired)
      db.run(
        `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
         VALUES (?, 'bankr', ?, NULL, 'Expired failover', datetime('now', '-2 hours'))`,
        [`${PREFIX}wallet_guard`, healedId]
      );

      const res = await recheckProxyHealth({ probeQuarantined: true });

      expect(res.unquarantinedDetails?.some((d) => d.includes(healedId))).toBe(true);

      const proxyAfter = getProxyConfig(healedId);
      expect(proxyAfter?.status).toBe("ACTIVE");
      expect(proxyAfter?.healthStatus).toBe("available");
    });

    it("2.3 should bypass flapping cooldown when forceUnquarantine is true", async () => {
      const forceId = `${PREFIX}forced_proxy`;

      registerProxyConfig({
        id: forceId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1082,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Severe failure (3x failures -> 24h penalty)
      for (let i = 1; i <= 3; i++) {
        db.run(
          `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
           VALUES (?, 'bankr', ?, NULL, 'Severe failover', datetime('now', '-10 minutes'))`,
          [`${PREFIX}wallet_guard`, forceId]
        );
      }

      // With forceUnquarantine: true, operator override takes effect!
      const res = await recheckProxyHealth({ probeQuarantined: true, forceUnquarantine: true });

      expect(res.unquarantinedDetails?.some((d) => d.includes(forceId))).toBe(true);

      const proxyAfter = getProxyConfig(forceId);
      expect(proxyAfter?.status).toBe("ACTIVE");
    });
  });

  describe("3. Proactive Pre-Flight Pool Resupply", () => {
    it("3.1 probeAndResupplyQuarantinedPool should restore healthy quarantined proxy when active count < threshold", async () => {
      const resupplyId = `${PREFIX}resupply_candidate`;

      registerProxyConfig({
        id: resupplyId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1083,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      const res = await probeAndResupplyQuarantinedPool({ minActiveThreshold: 999 });

      expect(res.probedCount).toBeGreaterThanOrEqual(1);
      expect(res.resuppliedCount).toBeGreaterThanOrEqual(1);
      expect(res.resuppliedIds).toContain(resupplyId);

      const proxyAfter = getProxyConfig(resupplyId);
      expect(proxyAfter?.status).toBe("ACTIVE");
      expect(proxyAfter?.healthStatus).toBe("available");
    });

    it("3.2 probeAndResupplyQuarantinedPool should respect flapping cooldown and skip ineligible proxies", async () => {
      const delayedId = `${PREFIX}resupply_delayed`;

      registerProxyConfig({
        id: delayedId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1084,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Add recent failure within 5 minutes
      db.run(
        `INSERT INTO proxy_audit_logs (wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at)
         VALUES (?, 'bankr', ?, NULL, 'Recent failover', datetime('now', '-5 minutes'))`,
        [`${PREFIX}wallet_resupply`, delayedId]
      );

      const res = await probeAndResupplyQuarantinedPool({ minActiveThreshold: 999 });

      expect(res.delayedByCooldownCount).toBeGreaterThanOrEqual(1);
      expect(res.resuppliedIds).not.toContain(delayedId);

      const proxyAfter = getProxyConfig(delayedId);
      expect(proxyAfter?.status).toBe("DISABLED");
    });

    it("3.3 resolveExecutableWalletForCycle should trigger proactive pool resupply when active healthy proxies are critical", async () => {
      const walletId = `${PREFIX}wallet_resupply_cycle`;
      const criticalCandidateId = `${PREFIX}critical_resupply_proxy`;

      // Temporarily mark all existing proxies in DB to DISABLED to simulate critical active pool
      const existingActive = db.query(`SELECT id FROM proxy_configs WHERE status = 'ACTIVE'`).all() as { id: string }[];
      db.run(`UPDATE proxy_configs SET status = 'DISABLED' WHERE status = 'ACTIVE'`);

      try {
        // Register healthy candidate in karantina (DISABLED, but no failure history -> eligible)
        registerProxyConfig({
          id: criticalCandidateId,
          protocol: "socks5",
          host: "127.0.0.1",
          port: 1085,
          status: "DISABLED",
          healthStatus: "unavailable",
        });

        registerWalletAccount({
          id: walletId,
          label: "Proactive Resupply Wallet",
          evmAddress: "0x3333333333333333333333333333333333333333",
        });

        setWalletProviderRoute(walletId, "bankr", {
          status: "ACTIVE",
        });
        setWalletProviderRoute(walletId, "basedbot", {
          status: "ACTIVE",
        });

        const mockBalanceEvaluator = async () => ({
          passed: true,
          passedChains: ["base"],
          failedChains: [],
          rpcFailureChains: [],
          results: [
            { chain: "base", outcome: "sufficient" as const, actualBalance: 0.5, requiredBalance: 0.05 },
          ],
        });

        const resolution = await resolveExecutableWalletForCycle({
          requiredProvider: "bankr",
          targetChains: ["base"],
          minEth: 0.05,
          minSol: 0.05,
          telegramBotTokenPresent: true,
          initialCandidateWalletIds: [walletId],
          balanceEvaluator: mockBalanceEvaluator,
        });

        // The critical candidate should have been restored proactively
        const candidateAfter = getProxyConfig(criticalCandidateId);
        expect(candidateAfter?.status).toBe("ACTIVE");
        expect(candidateAfter?.healthStatus).toBe("available");
      } finally {
        // Restore original active proxies
        for (const p of existingActive) {
          db.run(`UPDATE proxy_configs SET status = 'ACTIVE' WHERE id = ?`, [p.id]);
        }
      }
    });
  });
});
