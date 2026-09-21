import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import {
  registerWalletAccount,
  registerProxyConfig,
  setWalletProviderRoute,
  getAllProviderRoutes,
  listWalletAccounts,
} from "../src/modules/identity/wallet-manager.ts";
import { generateDashboardData } from "../scripts/dashboard.ts";
import {
  parseDaemonArgs,
  runFlywheelSinglePass,
} from "../scripts/run-flywheel-worker.ts";
import { runDualChainAudit } from "../scripts/verify-dual-chain.ts";

describe("Flywheel Daemon, Multi-Chain Dashboard & Dual-Chain Preflight Tests", () => {
  const db = new Database(DB_PATH);

  describe("1. getAllProviderRoutes Optional Argument Support", () => {
    const testWalletA = "test_wallet_route_a";
    const testWalletB = "test_wallet_route_b";
    const testProxyA = "test_proxy_route_a";

    beforeEach(() => {
      // Clean up previous test entries
      db.run("DELETE FROM wallet_provider_routes WHERE wallet_id IN (?, ?)", [testWalletA, testWalletB]);
      db.run("DELETE FROM wallet_accounts WHERE id IN (?, ?)", [testWalletA, testWalletB]);
      db.run("DELETE FROM proxy_configs WHERE id = ?", [testProxyA]);

      // Seed test data
      registerWalletAccount({ id: testWalletA, label: "Test Wallet A", status: "ACTIVE" });
      registerWalletAccount({ id: testWalletB, label: "Test Wallet B", status: "ACTIVE" });
      registerProxyConfig({
        id: testProxyA,
        protocol: "http",
        host: "10.0.0.1",
        port: 8080,
      });

      setWalletProviderRoute(testWalletA, "bankr", { proxyId: testProxyA });
      setWalletProviderRoute(testWalletB, "basedbot", { proxyId: null });
    });

    afterEach(() => {
      db.run("DELETE FROM wallet_provider_routes WHERE wallet_id IN (?, ?)", [testWalletA, testWalletB]);
      db.run("DELETE FROM wallet_accounts WHERE id IN (?, ?)", [testWalletA, testWalletB]);
      db.run("DELETE FROM proxy_configs WHERE id = ?", [testProxyA]);
    });

    it("1.1 should return all provider routes across all wallets when walletId is omitted", () => {
      const allRoutes = getAllProviderRoutes();
      expect(Array.isArray(allRoutes)).toBe(true);
      expect(allRoutes.length).toBeGreaterThanOrEqual(2);

      const routeA = allRoutes.find((r) => r.walletId === testWalletA && r.provider === "bankr");
      const routeB = allRoutes.find((r) => r.walletId === testWalletB && r.provider === "basedbot");

      expect(routeA).toBeDefined();
      expect(routeA?.proxyId).toBe(testProxyA);
      expect(routeB).toBeDefined();
      expect(routeB?.proxyId).toBeNull();
    });

    it("1.2 should return filtered provider routes when walletId is specified", () => {
      const routesForA = getAllProviderRoutes(testWalletA);
      expect(routesForA.length).toBe(1);
      expect(routesForA[0].walletId).toBe(testWalletA);
      expect(routesForA[0].provider).toBe("bankr");

      const routesForB = getAllProviderRoutes(testWalletB);
      expect(routesForB.length).toBe(1);
      expect(routesForB[0].walletId).toBe(testWalletB);
      expect(routesForB[0].provider).toBe("basedbot");
    });
  });

  describe("2. Dashboard Data Generation & Route Verification", () => {
    it("2.1 should generate complete dashboard data including routes, proxies, and wallets", () => {
      const data = generateDashboardData();

      expect(data).toHaveProperty("cfg");
      expect(data).toHaveProperty("activeChains");
      expect(data).toHaveProperty("todayDeployCount");
      expect(data).toHaveProperty("deployLogs");
      expect(data).toHaveProperty("wallets");
      expect(data).toHaveProperty("routes");
      expect(data).toHaveProperty("proxies");
      expect(data).toHaveProperty("totalAccruedWeth");
      expect(data).toHaveProperty("totalClaimedWeth");
      expect(data).toHaveProperty("flywheelSummary");

      expect(Array.isArray(data.wallets)).toBe(true);
      expect(Array.isArray(data.routes)).toBe(true);
      expect(Array.isArray(data.proxies)).toBe(true);
    });
  });

  describe("3. Flywheel Daemon Argument Parsing & Single-Pass Execution", () => {
    it("3.1 should parse default arguments when no flags are passed", () => {
      const res = parseDaemonArgs([]);
      expect(res.isDaemon).toBe(false);
      expect(res.intervalMinutes).toBe(5);
    });

    it("3.2 should parse --daemon flag with default interval", () => {
      const res = parseDaemonArgs(["--daemon"]);
      expect(res.isDaemon).toBe(true);
      expect(res.intervalMinutes).toBe(5);
    });

    it("3.3 should parse -d shorthand with interval value", () => {
      const res = parseDaemonArgs(["-d", "10"]);
      expect(res.isDaemon).toBe(true);
      expect(res.intervalMinutes).toBe(10);
    });

    it("3.4 should parse --interval=N syntax", () => {
      const res = parseDaemonArgs(["--daemon", "--interval=15"]);
      expect(res.isDaemon).toBe(true);
      expect(res.intervalMinutes).toBe(15);
    });

    it("3.5 should clamp interval to a minimum of 1 minute", () => {
      const res = parseDaemonArgs(["--daemon", "-5"]);
      expect(res.isDaemon).toBe(true);
      expect(res.intervalMinutes).toBe(1);
    });

    it("3.6 should execute runFlywheelSinglePass safely and return summary metrics", async () => {
      const result = await runFlywheelSinglePass();
      expect(result).toHaveProperty("processedCount");
      expect(result).toHaveProperty("deploymentsCount");
      expect(result).toHaveProperty("summary");
      expect(typeof result.processedCount).toBe("number");
      expect(typeof result.deploymentsCount).toBe("number");
      expect(result.summary).toHaveProperty("eventCount");
    }, 30000);
  });

  describe("4. Dual-Chain Preflight Audit Engine", () => {
    it("4.1 should run silent dual-chain audit and return structured verdicts", async () => {
      const audit = await runDualChainAudit({ silent: true });

      expect(audit).toHaveProperty("timestamp");
      expect(audit).toHaveProperty("base");
      expect(audit).toHaveProperty("solana");
      expect(audit).toHaveProperty("infrastructure");
      expect(audit).toHaveProperty("overallVerdict");

      // Verify Base fields
      expect(["READY", "WARNING", "FAILED"]).toContain(audit.base.status);
      expect(typeof audit.base.bankrApiKeyValid).toBe("boolean");
      expect(typeof audit.base.custodialEthBalance).toBe("number");
      expect(typeof audit.base.custodialUsdBalance).toBe("number");

      // Verify Solana fields
      expect(["READY", "WARNING", "FAILED"]).toContain(audit.solana.status);
      expect(typeof audit.solana.rpcConnected).toBe("boolean");
      expect(typeof audit.solana.operatorSolBalance).toBe("number");
      expect(typeof audit.solana.sufficientForLaunch).toBe("boolean");
      expect(typeof audit.solana.pumpPortalAvailable).toBe("boolean");

      // Verify Overall Verdict
      expect(["ALL_SYSTEMS_READY", "PARTIAL_READY", "BLOCKED"]).toContain(audit.overallVerdict);
    });
  });
});
