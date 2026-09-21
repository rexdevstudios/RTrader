import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import {
  registerWalletAccount,
  getWalletAccount,
  registerProxyConfig,
  getProxyConfig,
  listProxyConfigs,
  updateProxyStatus,
  deleteProxyConfig,
  setWalletProviderRoute,
  getWalletProviderRoute,
  autoFailoverUnhealthyRoutes,
} from "../src/modules/identity/wallet-manager.ts";
import {
  pruneDeadProxies,
  recheckProxyHealth,
  broadcastProxyAlert,
  type PruneOptions,
  type PruneResult,
  type RecheckSummary,
  type ProxyAlertParams,
} from "../scripts/manage-wallets.ts";
import { resolveExecutableWalletForCycle } from "../src/modules/identity/execution-wallet-resolver.ts";
import { resetConfig } from "../src/config.ts";

const db = new Database(DB_PATH);

describe("Dead Proxy Auto-Prune & Pre-Deploy Auto-Failover Gate Test Suite", () => {
  const PREFIX = "prune_test_";

  beforeEach(() => {
    resetConfig();
    cleanupTestData();
  });

  afterEach(() => {
    cleanupTestData();
  });

  function cleanupTestData() {
    db.run(`DELETE FROM wallet_provider_routes WHERE wallet_id LIKE '${PREFIX}%'`);
    db.run(`DELETE FROM proxy_audit_logs WHERE wallet_id LIKE '${PREFIX}%'`);
    db.run(`DELETE FROM wallet_accounts WHERE id LIKE '${PREFIX}%'`);
    db.run(`DELETE FROM proxy_configs WHERE id LIKE '${PREFIX}%'`);
  }

  describe("1. Dead Proxy Prune & Quarantine (pruneDeadProxies)", () => {
    it("1.1 should soft-quarantine (status = DISABLED) proxies that have been dead for > 24 hours", async () => {
      const deadProxyId = `${PREFIX}dead_24h`;
      const healthyProxyId = `${PREFIX}healthy`;

      // Register dead proxy
      registerProxyConfig({
        id: deadProxyId,
        protocol: "http",
        host: "10.0.0.1",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "unavailable",
      });
      // Backdate last_checked_at and updated_at to 30 hours ago
      db.run(
        `UPDATE proxy_configs SET last_checked_at = datetime('now', '-30 hours'), updated_at = datetime('now', '-30 hours') WHERE id = ?`,
        [deadProxyId]
      );

      // Register healthy proxy
      registerProxyConfig({
        id: healthyProxyId,
        protocol: "http",
        host: "10.0.0.2",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "available",
      });

      const res = await pruneDeadProxies({ quarantineHours: 24 });

      expect(res.quarantinedCount).toBe(1);
      expect(res.deletedCount).toBe(0);

      const deadUpdated = getProxyConfig(deadProxyId);
      expect(deadUpdated).not.toBeNull();
      expect(deadUpdated!.status).toBe("DISABLED");

      const healthy = getProxyConfig(healthyProxyId);
      expect(healthy!.status).toBe("ACTIVE");
    });

    it("1.2 should permanently delete proxy when hardDelete is requested", async () => {
      const deadProxyId = `${PREFIX}dead_delete`;

      registerProxyConfig({
        id: deadProxyId,
        protocol: "http",
        host: "10.0.0.3",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "timeout",
      });
      db.run(
        `UPDATE proxy_configs SET last_checked_at = datetime('now', '-48 hours'), updated_at = datetime('now', '-48 hours') WHERE id = ?`,
        [deadProxyId]
      );

      const res = await pruneDeadProxies({ hardDelete: true, quarantineHours: 24 });

      expect(res.deletedCount).toBe(1);
      expect(res.quarantinedCount).toBe(0);

      const deleted = getProxyConfig(deadProxyId);
      expect(deleted).toBeNull();
    });

    it("1.3 should respect dryRun mode without modifying database state", async () => {
      const deadProxyId = `${PREFIX}dead_dry`;

      registerProxyConfig({
        id: deadProxyId,
        protocol: "http",
        host: "10.0.0.4",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "authentication_error",
      });
      db.run(
        `UPDATE proxy_configs SET last_checked_at = datetime('now', '-50 hours'), updated_at = datetime('now', '-50 hours') WHERE id = ?`,
        [deadProxyId]
      );

      const res = await pruneDeadProxies({ dryRun: true, quarantineHours: 24 });

      expect(res.dryRunCount).toBe(1);
      expect(res.quarantinedCount).toBe(0);
      expect(res.deletedCount).toBe(0);

      const unchanged = getProxyConfig(deadProxyId);
      expect(unchanged).not.toBeNull();
      expect(unchanged!.status).toBe("ACTIVE");
    });

    it("1.4 should skip dead proxies younger than quarantineHours unless allDead is specified", async () => {
      const recentDeadId = `${PREFIX}dead_recent`;

      registerProxyConfig({
        id: recentDeadId,
        protocol: "http",
        host: "10.0.0.5",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "unavailable",
      });
      // Backdate to only 2 hours ago (less than default 24h)
      db.run(
        `UPDATE proxy_configs SET last_checked_at = datetime('now', '-2 hours'), updated_at = datetime('now', '-2 hours') WHERE id = ?`,
        [recentDeadId]
      );

      // Normal run: should skip
      const resNormal = await pruneDeadProxies({ quarantineHours: 24, allDead: false });
      expect(resNormal.quarantinedCount).toBe(0);
      const stillActive = getProxyConfig(recentDeadId);
      expect(stillActive!.status).toBe("ACTIVE");

      // With allDead: true -> should quarantine immediately
      const resAllDead = await pruneDeadProxies({ allDead: true });
      expect(resAllDead.quarantinedCount).toBe(1);
      const nowDisabled = getProxyConfig(recentDeadId);
      expect(nowDisabled!.status).toBe("DISABLED");
    });

    it("1.5 should automatically protect active wallet routes by running auto-failover before pruning", async () => {
      const walletId = `${PREFIX}wallet_1`;
      const deadProxyId = `${PREFIX}bound_dead`;
      const backupProxyId = `${PREFIX}backup_healthy`;

      // 1. Register dead proxy
      registerProxyConfig({
        id: deadProxyId,
        protocol: "http",
        host: "10.0.0.6",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "unavailable",
      });
      // 2. Register healthy backup proxy
      registerProxyConfig({
        id: backupProxyId,
        protocol: "http",
        host: "10.0.0.7",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "available",
      });
      // 3. Register wallet and bind route to dead proxy
      registerWalletAccount({
        id: walletId,
        label: "Prune Test Wallet",
        evmAddress: "0x1111111111111111111111111111111111111111",
      });
      setWalletProviderRoute(walletId, "bankr", {
        proxyId: deadProxyId,
        status: "ACTIVE",
      });

      const initialRoute = getWalletProviderRoute(walletId, "bankr");
      expect(initialRoute?.proxyId).toBe(deadProxyId);

      // Run prune on dead proxies
      const res = await pruneDeadProxies({ allDead: true });

      expect(res.routesProtected).toBeGreaterThanOrEqual(1);
      expect(res.quarantinedCount).toBe(1);

      // Verify the wallet route was failed over to the healthy backup!
      const updatedRoute = getWalletProviderRoute(walletId, "bankr");
      expect(updatedRoute?.proxyId).toBe(backupProxyId);

      // Verify dead proxy is now DISABLED
      const prunedProxy = getProxyConfig(deadProxyId);
      expect(prunedProxy!.status).toBe("DISABLED");
    });
  });

  describe("2. Pre-Deploy Auto-Failover Gate (resolveExecutableWalletForCycle)", () => {
    it("2.1 should auto-recover when candidate wallet has an unhealthy proxy and backup exists", async () => {
      const walletId = `${PREFIX}wallet_predeploy`;
      const brokenProxyId = `${PREFIX}broken_proxy`;
      const healthyBackupId = `${PREFIX}healthy_backup`;

      // Register broken proxy
      registerProxyConfig({
        id: brokenProxyId,
        protocol: "http",
        host: "10.0.0.8",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "unavailable",
      });

      // Register healthy backup proxy
      registerProxyConfig({
        id: healthyBackupId,
        protocol: "http",
        host: "10.0.0.9",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "available",
      });

      // Register wallet
      registerWalletAccount({
        id: walletId,
        label: "Pre-Deploy Test Wallet",
        evmAddress: "0x2222222222222222222222222222222222222222",
      });

      // Bind route to broken proxy
      setWalletProviderRoute(walletId, "bankr", {
        proxyId: brokenProxyId,
        status: "ACTIVE",
      });
      setWalletProviderRoute(walletId, "basedbot", {
        status: "ACTIVE",
      });

      // Mock balance evaluator returning valid PreflightBalanceReport
      const mockBalanceEvaluator = async () => ({
        passed: true,
        passedChains: ["base"],
        failedChains: [],
        rpcFailureChains: [],
        results: [
          { chain: "base", outcome: "sufficient" as const, actualBalance: 0.5, requiredBalance: 0.05 },
        ],
      });

      // Execute resolver
      const resolution = await resolveExecutableWalletForCycle({
        requiredProvider: "bankr",
        targetChains: ["base"],
        minEth: 0.05,
        minSol: 0.05,
        telegramBotTokenPresent: true,
        initialCandidateWalletIds: [walletId],
        balanceEvaluator: mockBalanceEvaluator,
      });

      // Resolution must succeed because auto-failover recovered the proxy!
      expect(resolution.success).toBe(true);
      expect(resolution.operatorWallet?.id).toBe(walletId);
      expect(resolution.bankrContext?.isUsable).toBe(true);
      expect(resolution.bankrContext?.proxy?.id).toBe(healthyBackupId);

      // Database route must reflect the new proxy
      const finalRoute = getWalletProviderRoute(walletId, "bankr");
      expect(finalRoute?.proxyId).toBe(healthyBackupId);
    });
  });

  describe("3. Auto-Unquarantine Probe for Healed Proxies (recheckProxyHealth)", () => {
    it("3.1 should skip DISABLED proxies by default when probeQuarantined is false", async () => {
      const activeId = `${PREFIX}active_proxy`;
      const disabledId = `${PREFIX}disabled_proxy`;

      registerProxyConfig({
        id: activeId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1080,
        status: "ACTIVE",
        healthStatus: "available",
      });

      registerProxyConfig({
        id: disabledId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1081,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), { status: 200 })
      );

      try {
        const res = await recheckProxyHealth();

        // The DISABLED proxy must remain untouched and DISABLED
        expect(res.unquarantinedCount).toBe(0);
        const disabledProxy = getProxyConfig(disabledId);
        expect(disabledProxy?.status).toBe("DISABLED");
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("3.2 should probe quarantined proxies and promote healed ones to ACTIVE when probeQuarantined is true", async () => {
      const disabledHealedId = `${PREFIX}disabled_healed`;

      registerProxyConfig({
        id: disabledHealedId,
        protocol: "socks5",
        host: "127.0.0.1",
        port: 1082,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ status: "ok" }), { status: 200 })
      );

      try {
        const res = await recheckProxyHealth({ probeQuarantined: true });

        expect(res.unquarantinedCount).toBeGreaterThanOrEqual(1);
        expect(res.unquarantinedDetails?.some((d) => d.includes(disabledHealedId))).toBe(true);

        const healedProxy = getProxyConfig(disabledHealedId);
        expect(healedProxy?.status).toBe("ACTIVE");
        expect(healedProxy?.healthStatus).toBe("available");
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("3.3 should leave still-broken quarantined proxies as DISABLED when probeQuarantined is true", async () => {
      const disabledBrokenId = `${PREFIX}disabled_broken`;

      registerProxyConfig({
        id: disabledBrokenId,
        protocol: "http",
        host: "127.0.0.1",
        port: 9999,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Mock fetch to reject (simulate broken proxy)
      const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("Connection refused (ECONNREFUSED)")
      );

      try {
        const res = await recheckProxyHealth({ probeQuarantined: true });

        // Broken proxy should NOT be unquarantined
        expect(res.unquarantinedDetails?.some((d) => d.includes(disabledBrokenId))).toBe(false);

        const stillDead = getProxyConfig(disabledBrokenId);
        expect(stillDead?.status).toBe("DISABLED");
        expect(stillDead?.healthStatus).toBe("unavailable");
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });

  describe("4. Integrated Proxy Alert Broadcaster (broadcastProxyAlert)", () => {
    it("4.1 should format alert cards and return fail-safe success without throwing even when webhooks are unset", async () => {
      delete process.env.COMMUNITY_TELEGRAM_WEBHOOK;
      delete process.env.COMMUNITY_DISCORD_WEBHOOK;
      delete process.env.COMMUNITY_TELEGRAM_CHANNEL;
      delete process.env.COMMUNITY_TELEGRAM_CHAT_ID;
      delete process.env.TELEGRAM_BOT_TOKEN;

      const alertRes = await broadcastProxyAlert({
        type: "UNQUARANTINE",
        title: "1 Proxy Karantina Pulih",
        details: ["Proxy 'proxy_alpha' (10.0.0.1:8080) kembali responsif (45ms)"],
        totalAffected: 1,
      });

      expect(alertRes.cardText).toBeDefined();
      expect(alertRes.cardText).toContain("[PROXY ALERT - UNQUARANTINE]");
      expect(alertRes.cardText).toContain("1 Proxy Karantina Pulih");
      expect(alertRes.cardText).toContain("proxy_alpha");
    });

    it("4.2 should support FAILOVER and PRUNE alert types correctly", async () => {
      const failoverRes = await broadcastProxyAlert({
        type: "FAILOVER",
        title: "Auto-Failover Rute Terlaksana",
        details: ["Wallet 'wallet_main' beralih ke proxy cadangan 'proxy_backup'"],
        totalAffected: 1,
      });

      expect(failoverRes.cardText).toContain("[PROXY ALERT - FAILOVER]");
      expect(failoverRes.cardText).toContain("Auto-Failover Rute Terlaksana");

      const pruneRes = await broadcastProxyAlert({
        type: "PRUNE",
        title: "Pembersihan Proxy Mati Selesai",
        details: ["2 proxy mati dialihkan ke karantina"],
        totalAffected: 2,
      });

      expect(pruneRes.cardText).toContain("[PROXY ALERT - PRUNE]");
      expect(pruneRes.cardText).toContain("Pembersihan Proxy Mati Selesai");
    });

    it("4.3 should attempt direct Telegram API call when token & channel are configured, handling errors gracefully", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "mock_telegram_token_12345";
      process.env.COMMUNITY_TELEGRAM_CHANNEL = "@mock_channel";

      const axiosPostSpy = spyOn(axios, "post").mockImplementation(async () => {
        throw new Error("Telegram API network timeout");
      });

      try {
        const res = await broadcastProxyAlert({
          type: "FAILOVER",
          title: "Telegram Alert Test",
          details: ["Testing Telegram dispatch resilience"],
        });

        expect(res.cardText).toBeDefined();
        expect(axiosPostSpy).toHaveBeenCalled();
      } finally {
        axiosPostSpy.mockRestore();
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.COMMUNITY_TELEGRAM_CHANNEL;
      }
    });
  });
});

