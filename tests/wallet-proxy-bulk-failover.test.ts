import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import {
  registerWalletAccount,
  getWalletAccount,
  registerProxyConfig,
  getProxyConfig,
  listProxyConfigs,
  updateProxyStatus,
  setWalletProviderRoute,
  getWalletProviderRoute,
  getProxyAuditHistory,
  resolveOperationalContext,
  buildProxyUrl,
} from "../src/modules/identity/wallet-manager.ts";
import {
  parseBulkProxyContent,
  executeBulkProxyImport,
  autoFailoverUnhealthyRoutes,
  recheckProxyHealth,
  parseRecheckArgs,
  pingProxyEndpoint,
  type ProxyPingResult,
} from "../scripts/manage-wallets.ts";

const db = new Database(DB_PATH);

describe("Bulk Proxy Import & Health Recheck with Auto-Failover Test Suite", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db.run("DELETE FROM wallet_provider_routes WHERE wallet_id LIKE 'bulk_test_%'");
    db.run("DELETE FROM proxy_audit_logs WHERE wallet_id LIKE 'bulk_test_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'bulk_test_%'");
    db.run("DELETE FROM proxy_configs WHERE id LIKE 'proxy_bulk_test_%'");
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    db.run("DELETE FROM wallet_provider_routes WHERE wallet_id LIKE 'bulk_test_%'");
    db.run("DELETE FROM proxy_audit_logs WHERE wallet_id LIKE 'bulk_test_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'bulk_test_%'");
    db.run("DELETE FROM proxy_configs WHERE id LIKE 'proxy_bulk_test_%'");
  });

  describe("1. Bulk Proxy Content Parsing (parseBulkProxyContent)", () => {
    it("1.1 should parse plain text list ignoring empty lines and comments", () => {
      const rawText = `
# Daftar Proxy Webshare
104.28.1.1:8080:usr1:pwd1
// Komentar cadangan
104.28.1.2:8080:usr2:pwd2

104.28.1.3:3128
http://alice:secret@10.0.0.1:9090
      `;

      const parsed = parseBulkProxyContent(rawText);
      expect(parsed.length).toBe(4);
      expect(parsed[0].rawProxy).toBe("104.28.1.1:8080:usr1:pwd1");
      expect(parsed[1].rawProxy).toBe("104.28.1.2:8080:usr2:pwd2");
      expect(parsed[2].rawProxy).toBe("104.28.1.3:3128");
      expect(parsed[3].rawProxy).toBe("http://alice:secret@10.0.0.1:9090");
    });

    it("1.2 should parse CSV content with custom columns", () => {
      const csvContent = `proxy,id,label,key,evm,solana
192.168.1.10:8080:u1:p1,bulk_test_custom1,Operator Custom 1,env:CUSTOM_KEY_1,0x1111111111111111111111111111111111111111,
192.168.1.20:8080:u2:p2,bulk_test_custom2,Operator Custom 2,,0x2222222222222222222222222222222222222222,4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz
`;

      const parsed = parseBulkProxyContent(csvContent, "proxies.csv");
      expect(parsed.length).toBe(2);
      expect(parsed[0].id).toBe("bulk_test_custom1");
      expect(parsed[0].label).toBe("Operator Custom 1");
      expect(parsed[0].credentialRef).toBe("env:CUSTOM_KEY_1");
      expect(parsed[0].evmAddress).toBe("0x1111111111111111111111111111111111111111");

      expect(parsed[1].id).toBe("bulk_test_custom2");
      expect(parsed[1].solanaAddress).toBe("4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz");
    });
  });

  describe("2. Bulk Ingestion Engine (executeBulkProxyImport)", () => {
    it("2.1 should import and provision accounts with skipPing=true", async () => {
      const items = [
        { rawProxy: "10.1.1.1:8080:usr1:pwd1", id: "bulk_test_acc1" },
        { rawProxy: "10.1.1.2:8080:usr2:pwd2", id: "bulk_test_acc2" },
      ];

      const res = await executeBulkProxyImport(items, { skipPing: true });

      expect(res.totalParsed).toBe(2);
      expect(res.totalRegistered).toBe(2);
      expect(res.totalFailed).toBe(0);

      // Verify wallet 1 in SQLite
      const w1 = getWalletAccount("bulk_test_acc1");
      expect(w1).not.toBeNull();
      expect(w1?.status).toBe("ACTIVE");

      // Verify proxy 1 in SQLite
      const p1 = getProxyConfig("proxy_bulk_test_acc1");
      expect(p1).not.toBeNull();
      expect(p1?.host).toBe("10.1.1.1");
      expect(p1?.port).toBe(8080);
      expect(p1?.healthStatus).toBe("available");

      // Verify provider route in SQLite
      const r1 = getWalletProviderRoute("bulk_test_acc1", "bankr");
      expect(r1).not.toBeNull();
      expect(r1?.proxyId).toBe("proxy_bulk_test_acc1");
      expect(r1?.status).toBe("ACTIVE");
    });

    it("2.2 should handle preflight test failures gracefully and report them", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        const proxyStr = String((init as any)?.proxy || "");
        if (proxyStr.includes("10.2.2.1")) {
          return new Response(JSON.stringify({ success: true, balances: {} }), { status: 200 });
        }
        return new Response("WAF Block", { status: 403 });
      });

      const items = [
        { rawProxy: "10.2.2.1:8080:u1:p1", id: "bulk_test_ok" },
        { rawProxy: "10.2.2.2:8080:u2:p2", id: "bulk_test_blocked" },
      ];

      const res = await executeBulkProxyImport(items, { skipPing: false });

      expect(res.totalParsed).toBe(2);
      expect(res.totalRegistered).toBe(1);
      expect(res.totalFailed).toBe(1);

      expect(getWalletAccount("bulk_test_ok")).not.toBeNull();
      expect(getWalletAccount("bulk_test_blocked")).toBeNull();
    });

    it("2.3 should auto-generate sequential IDs when ID is omitted", async () => {
      const items = [
        { rawProxy: "10.3.3.1:8080:u1:p1" },
        { rawProxy: "10.3.3.2:8080:u2:p2" },
      ];

      const res = await executeBulkProxyImport(items, { prefix: "bulk_test_auto", skipPing: true });

      expect(res.totalRegistered).toBe(2);
      expect(res.entries[0].id).toContain("bulk_test_auto");
      expect(res.entries[1].id).toContain("bulk_test_auto");

      const w = getWalletAccount(res.entries[0].id);
      expect(w).not.toBeNull();
    });
  });

  describe("3. Scheduled Recheck & Auto-Failover (autoFailoverUnhealthyRoutes)", () => {
    it("3.1 should do nothing when all active routes have healthy proxies", async () => {
      const wId = "bulk_test_healthy_w";
      const pId = "proxy_bulk_test_healthy";

      registerProxyConfig({
        id: pId,
        protocol: "http",
        host: "10.4.4.1",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "available",
        latencyMs: 50,
      });

      registerWalletAccount({ id: wId, label: "Healthy Wallet" });
      setWalletProviderRoute(wId, "bankr", { proxyId: pId, status: "ACTIVE" });

      const res = await autoFailoverUnhealthyRoutes();
      expect(res.unhealthyRoutesCount).toBe(0);
      expect(res.failoversExecuted).toBe(0);

      const route = getWalletProviderRoute(wId, "bankr");
      expect(route?.proxyId).toBe(pId);
    });

    it("3.2 should auto-failover unhealthy route to an unassigned healthy proxy", async () => {
      const wId = "bulk_test_unhealthy_w";
      const brokenProxyId = "proxy_bulk_test_broken";
      const backupProxyId = "proxy_bulk_test_backup";

      // 1. Broken proxy
      registerProxyConfig({
        id: brokenProxyId,
        protocol: "http",
        host: "10.5.5.1",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "unavailable",
      });

      // 2. Backup healthy proxy
      registerProxyConfig({
        id: backupProxyId,
        protocol: "http",
        host: "10.5.5.2",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "available",
        latencyMs: 75,
      });

      registerWalletAccount({ id: wId, label: "Unhealthy Wallet" });
      setWalletProviderRoute(wId, "bankr", { proxyId: brokenProxyId, status: "ACTIVE" });

      // Run auto-failover
      const res = await autoFailoverUnhealthyRoutes();

      expect(res.unhealthyRoutesCount).toBe(1);
      expect(res.failoversExecuted).toBe(1);
      expect(res.details[0].walletId).toBe(wId);
      expect(res.details[0].previousProxyId).toBe(brokenProxyId);
      expect(res.details[0].newProxyId).toBe(backupProxyId);

      // Verify route in SQLite has been updated to backup proxy
      const updatedRoute = getWalletProviderRoute(wId, "bankr");
      expect(updatedRoute?.proxyId).toBe(backupProxyId);

      // Verify audit log exists
      const audit = getProxyAuditHistory(wId, "bankr");
      expect(audit.length).toBeGreaterThanOrEqual(1);
      expect(audit[0].newProxyId).toBe(backupProxyId);
      expect(audit[0].previousProxyId).toBe(brokenProxyId);
    });

    it("3.3 should fall back to lowest-latency shared healthy proxy if all are assigned", async () => {
      const w1 = "bulk_test_w1";
      const w2 = "bulk_test_w2";
      const brokenProxy = "proxy_bulk_test_dead";
      const sharedProxy = "proxy_bulk_test_shared";

      registerProxyConfig({
        id: brokenProxy,
        protocol: "http",
        host: "10.6.6.1",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "timeout",
      });

      registerProxyConfig({
        id: sharedProxy,
        protocol: "http",
        host: "10.6.6.2",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "available",
        latencyMs: 40,
      });

      registerWalletAccount({ id: w1, label: "Wallet 1" });
      registerWalletAccount({ id: w2, label: "Wallet 2" });

      setWalletProviderRoute(w1, "bankr", { proxyId: sharedProxy, status: "ACTIVE" });
      setWalletProviderRoute(w2, "bankr", { proxyId: brokenProxy, status: "ACTIVE" });

      const res = await autoFailoverUnhealthyRoutes();

      expect(res.unhealthyRoutesCount).toBe(1);
      expect(res.failoversExecuted).toBe(1);
      expect(res.details[0].walletId).toBe(w2);
      expect(res.details[0].newProxyId).toBe(sharedProxy);

      const route2 = getWalletProviderRoute(w2, "bankr");
      expect(route2?.proxyId).toBe(sharedProxy);
    });

    it("3.4 should fail-safe and report NO_HEALTHY_BACKUP when no healthy proxies exist", async () => {
      const wId = "bulk_test_isolated_w";
      const deadProxy = "proxy_bulk_test_sole_dead";

      registerProxyConfig({
        id: deadProxy,
        protocol: "http",
        host: "10.7.7.1",
        port: 8080,
        status: "ACTIVE",
        healthStatus: "authentication_error",
      });

      registerWalletAccount({ id: wId, label: "Isolated Wallet" });
      setWalletProviderRoute(wId, "bankr", { proxyId: deadProxy, status: "ACTIVE" });

      const res = await autoFailoverUnhealthyRoutes();

      expect(res.unhealthyRoutesCount).toBe(1);
      expect(res.failoversExecuted).toBe(0);
      expect(res.failoversFailed).toBe(1);
      expect(res.details[0].action).toBe("NO_HEALTHY_BACKUP");

      // Verify route remains strictly unchanged
      const preservedRoute = getWalletProviderRoute(wId, "bankr");
      expect(preservedRoute?.proxyId).toBe(deadProxy);
    });
  });

  describe("4. CLI Daemon & Argument Parsing (parseRecheckArgs)", () => {
    it("4.1 should parse default recheck arguments", () => {
      const opts = parseRecheckArgs([]);
      expect(opts.autoFailover).toBe(false);
      expect(opts.isDaemon).toBe(false);
      expect(opts.intervalMinutes).toBe(15);
      expect(opts.concurrency).toBe(5);
    });

    it("4.2 should parse flags for auto-failover, daemon, interval, and concurrency", () => {
      const opts = parseRecheckArgs([
        "--auto-failover",
        "--daemon",
        "--interval",
        "30",
        "--concurrency",
        "10",
      ]);
      expect(opts.autoFailover).toBe(true);
      expect(opts.isDaemon).toBe(true);
      expect(opts.intervalMinutes).toBe(30);
      expect(opts.concurrency).toBe(10);
    });
  });
});
