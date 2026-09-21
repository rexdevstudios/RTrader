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
  resolveCredential,
  buildProxyUrl,
} from "../src/modules/identity/wallet-manager.ts";
import {
  pingProxyEndpoint,
  executeBindRouteWithHealthCheck,
  parseUniversalProxy,
  type ProxyPingResult,
} from "../scripts/manage-wallets.ts";

const db = new Database(DB_PATH);

describe("Multi-Account Proxy Wizard & Diagnostics Test Suite", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Clean up test data
    db.run("DELETE FROM wallet_provider_routes WHERE wallet_id LIKE 'wiz_test_%'");
    db.run("DELETE FROM proxy_audit_logs WHERE wallet_id LIKE 'wiz_test_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'wiz_test_%'");
    db.run("DELETE FROM proxy_configs WHERE id LIKE 'proxy_wiz_test_%'");
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    db.run("DELETE FROM wallet_provider_routes WHERE wallet_id LIKE 'wiz_test_%'");
    db.run("DELETE FROM proxy_audit_logs WHERE wallet_id LIKE 'wiz_test_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'wiz_test_%'");
    db.run("DELETE FROM proxy_configs WHERE id LIKE 'proxy_wiz_test_%'");
  });

  describe("1. Proxy Preflight Ping Diagnostics (pingProxyEndpoint)", () => {
    it("1.1 should return available and apiKeyValid=true when Bankr server responds 200 OK", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        JSON.stringify({ success: true, evmAddress: "0x123", balances: {} }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));

      const res = await pingProxyEndpoint(
        { protocol: "http", host: "127.0.0.1", port: 8080, username: "user", password: "pwd" },
        "bk_usr_valid_key"
      );

      expect(res.reachable).toBe(true);
      expect(res.status).toBe(200);
      expect(res.healthStatus).toBe("available");
      expect(res.apiKeyValid).toBe(true);
      expect(res.message).toContain("Koneksi Berhasil");
    });

    it("1.2 should return available but apiKeyValid=false when server responds 401 Unauthorized", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      ));

      const res = await pingProxyEndpoint(
        { protocol: "http", host: "127.0.0.1", port: 8080 },
        undefined
      );

      expect(res.reachable).toBe(true);
      expect(res.status).toBe(401);
      expect(res.healthStatus).toBe("available");
      expect(res.apiKeyValid).toBe(false);
      expect(res.message).toContain("401");
    });

    it("1.3 should detect Cloudflare WAF block (HTTP 403) and mark unavailable", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        "Cloudflare Turnstile Access Denied",
        { status: 403 }
      ));

      const res = await pingProxyEndpoint(
        { protocol: "http", host: "192.168.1.1", port: 3128 }
      );

      expect(res.reachable).toBe(false);
      expect(res.status).toBe(403);
      expect(res.healthStatus).toBe("unavailable");
      expect(res.message).toContain("Cloudflare WAF");
    });

    it("1.4 should detect Proxy Authentication Error (HTTP 407)", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        "Proxy Authentication Required",
        { status: 407 }
      ));

      const res = await pingProxyEndpoint(
        { protocol: "http", host: "192.168.1.1", port: 3128, username: "wrong", password: "bad" }
      );

      expect(res.reachable).toBe(false);
      expect(res.status).toBe(407);
      expect(res.healthStatus).toBe("authentication_error");
      expect(res.message).toContain("HTTP 407");
    });

    it("1.5 should handle connection timeout and mark healthStatus as timeout", async () => {
      const timeoutError = new Error("The operation was aborted due to timeout");
      timeoutError.name = "TimeoutError";
      fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(timeoutError);

      const res = await pingProxyEndpoint(
        { protocol: "http", host: "10.255.255.1", port: 8080 },
        undefined,
        1000
      );

      expect(res.reachable).toBe(false);
      expect(res.healthStatus).toBe("timeout");
      expect(res.message).toContain("Timeout");
    });

    it("1.6 should accept socks5 with safe registry notice", async () => {
      const res = await pingProxyEndpoint(
        { protocol: "socks5", host: "127.0.0.1", port: 1080 }
      );

      expect(res.reachable).toBe(true);
      expect(res.healthStatus).toBe("available");
      expect(res.message).toContain("socks5");
    });
  });

  describe("2. Multi-Account Atomic Setup & Binding", () => {
    it("2.1 should register wallet, proxy, and configure provider route with isolated proxy", () => {
      const walletId = "wiz_test_acc1";
      const proxyId = "proxy_wiz_test_acc1";

      // 1. Register proxy
      const proxy = registerProxyConfig({
        id: proxyId,
        protocol: "http",
        host: "104.28.1.50",
        port: 8080,
        username: "myuser",
        password: "mypassword",
        status: "ACTIVE",
        healthStatus: "available",
      });
      expect(proxy.id).toBe(proxyId);
      expect(buildProxyUrl(proxy, true)).toBe("http://myuser:****@104.28.1.50:8080");

      // 2. Register wallet
      const wallet = registerWalletAccount({
        id: walletId,
        label: "Operator Account 1",
        evmAddress: "0x1234567890123456789012345678901234567890",
        solanaAddress: "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz",
        credentialRef: "env:BANKR_API_KEY_ACC1",
        status: "ACTIVE",
      });
      expect(wallet.id).toBe(walletId);

      // 3. Bind route
      const bound = setWalletProviderRoute(walletId, "bankr", {
        credentialRef: "env:BANKR_API_KEY_ACC1",
        proxyId,
        status: "ACTIVE",
      });
      expect(bound).toBe(true);

      // 4. Verify operational context
      const opCtx = resolveOperationalContext(walletId, "bankr");
      expect(opCtx.isUsable).toBe(true);
      expect(opCtx.proxy).not.toBeNull();
      expect(opCtx.proxy?.id).toBe(proxyId);
      expect(opCtx.maskedProxyUrl).toBe("http://myuser:****@104.28.1.50:8080");
    });

    it("2.2 should maintain audit trail when rotating proxy on existing account", () => {
      const walletId = "wiz_test_acc2";
      const proxyOld = "proxy_wiz_test_old";
      const proxyNew = "proxy_wiz_test_new";

      registerProxyConfig({ id: proxyOld, protocol: "http", host: "1.1.1.1", port: 8080 });
      registerProxyConfig({ id: proxyNew, protocol: "http", host: "2.2.2.2", port: 8080 });

      registerWalletAccount({
        id: walletId,
        label: "Operator Account 2",
        status: "ACTIVE",
      });

      // Initial route
      setWalletProviderRoute(walletId, "bankr", { proxyId: proxyOld });

      // Rotate route
      setWalletProviderRoute(walletId, "bankr", { proxyId: proxyNew });

      // Check audit logs
      const history = getProxyAuditHistory(walletId, "bankr");
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].previousProxyId).toBe(proxyOld);
      expect(history[0].newProxyId).toBe(proxyNew);
    });

    it("2.3 should update proxy latency and health status without mutating wallet identity", () => {
      const proxyId = "proxy_wiz_test_health";
      const walletId = "wiz_test_acc3";

      registerProxyConfig({ id: proxyId, protocol: "http", host: "3.3.3.3", port: 8080 });
      registerWalletAccount({ id: walletId, label: "Operator Account 3" });
      setWalletProviderRoute(walletId, "bankr", { proxyId });

      // Update proxy status to available with 120ms latency
      updateProxyStatus(proxyId, "ACTIVE", "available", 120);

      const updatedProxy = getProxyConfig(proxyId);
      expect(updatedProxy?.healthStatus).toBe("available");
      expect(updatedProxy?.latencyMs).toBe(120);

      // Verify wallet account identity is strictly unchanged
      const wallet = getWalletAccount(walletId);
      expect(wallet?.status).toBe("ACTIVE");
    });

    it("2.4 should correctly resolve credential reference from injected environment key", () => {
      const walletId = "wiz_test_acc4";
      const customKeyName = "BANKR_API_KEY_WIZ_TEST_ACC4";
      const customKeyValue = "bk_usr_test_secret_key_12345";
      process.env[customKeyName] = customKeyValue;

      registerWalletAccount({
        id: walletId,
        label: "Operator Account 4",
        credentialRef: `env:${customKeyName}`,
        status: "ACTIVE",
      });

      setWalletProviderRoute(walletId, "bankr", {
        credentialRef: `env:${customKeyName}`,
        status: "ACTIVE",
      });

      const opCtx = resolveOperationalContext(walletId, "bankr");
      expect(opCtx.isUsable).toBe(true);
      expect(opCtx.credentialRef).toBe(`env:${customKeyName}`);
      expect(resolveCredential(opCtx.credentialRef)).toBe(customKeyValue);

      delete process.env[customKeyName];
    });
  });

  describe("3. Pre-Bind Proxy Health Check & Fail-Closed Safety (executeBindRouteWithHealthCheck)", () => {
    // TEST 1: Healthy proxy (available) -> bind berhasil, route tersimpan
    it("3.1 [TEST 1] should successfully bind route when target proxy is healthy (available)", async () => {
      const walletId = "wiz_test_w1";
      const proxyId = "proxy_wiz_test_p1";

      registerWalletAccount({ id: walletId, label: "Test Wallet 1" });
      registerProxyConfig({ id: proxyId, protocol: "http", host: "127.0.0.1", port: 8080 });

      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        JSON.stringify({ success: true, balances: {} }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));

      const result = await executeBindRouteWithHealthCheck(walletId, proxyId, "bankr");

      expect(result.success).toBe(true);
      expect(result.pingResult?.reachable).toBe(true);
      expect(result.pingResult?.healthStatus).toBe("available");

      const route = getWalletProviderRoute(walletId, "bankr");
      expect(route).not.toBeNull();
      expect(route?.proxyId).toBe(proxyId);
      expect(route?.status).toBe("ACTIVE");

      const proxyInDb = getProxyConfig(proxyId);
      expect(proxyInDb?.healthStatus).toBe("available");
    });

    // TEST 2: Unhealthy proxy (unavailable / 403 WAF) -> bind gagal, route tidak berubah
    it("3.2 [TEST 2] should fail-closed and reject binding when proxy encounters 403 WAF block", async () => {
      const walletId = "wiz_test_w2";
      const proxyId = "proxy_wiz_test_p2";

      registerWalletAccount({ id: walletId, label: "Test Wallet 2" });
      registerProxyConfig({ id: proxyId, protocol: "http", host: "127.0.0.1", port: 8080 });

      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        "Cloudflare WAF Block",
        { status: 403 }
      ));

      const result = await executeBindRouteWithHealthCheck(walletId, proxyId, "bankr");

      expect(result.success).toBe(false);
      expect(result.error).toContain("tidak sehat");
      expect(result.pingResult?.reachable).toBe(false);
      expect(result.pingResult?.healthStatus).toBe("unavailable");

      const route = getWalletProviderRoute(walletId, "bankr");
      expect(route).toBeNull();

      const proxyInDb = getProxyConfig(proxyId);
      expect(proxyInDb?.healthStatus).toBe("unavailable");
    });

    // TEST 3: Proxy timeout (timeout) -> bind gagal, route tidak berubah
    it("3.3 [TEST 3] should fail-closed and reject binding when proxy health check times out", async () => {
      const walletId = "wiz_test_w3";
      const proxyId = "proxy_wiz_test_p3";

      registerWalletAccount({ id: walletId, label: "Test Wallet 3" });
      registerProxyConfig({ id: proxyId, protocol: "http", host: "10.255.255.1", port: 8080 });

      const timeoutErr = new Error("The operation was aborted due to timeout");
      timeoutErr.name = "TimeoutError";
      fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(timeoutErr);

      const result = await executeBindRouteWithHealthCheck(walletId, proxyId, "bankr", { timeoutMs: 500 });

      expect(result.success).toBe(false);
      expect(result.error).toContain("tidak sehat");
      expect(result.pingResult?.reachable).toBe(false);
      expect(result.pingResult?.healthStatus).toBe("timeout");

      const route = getWalletProviderRoute(walletId, "bankr");
      expect(route).toBeNull();

      const proxyInDb = getProxyConfig(proxyId);
      expect(proxyInDb?.healthStatus).toBe("timeout");
    });

    // TEST 4: Proxy tidak ditemukan -> bind gagal, route tidak berubah
    it("3.4 [TEST 4] should reject binding when target proxy is not found in vault", async () => {
      const walletId = "wiz_test_w4";
      registerWalletAccount({ id: walletId, label: "Test Wallet 4" });

      const result = await executeBindRouteWithHealthCheck(walletId, "proxy_non_existent", "bankr");

      expect(result.success).toBe(false);
      expect(result.error).toContain("tidak ditemukan di vault");

      const route = getWalletProviderRoute(walletId, "bankr");
      expect(route).toBeNull();
    });

    // TEST 5: Existing route tetap utuh jika replacement proxy tidak sehat
    it("3.5 [TEST 5] should keep existing route safe and unchanged when replacement proxy fails health check", async () => {
      const walletId = "wiz_test_w5";
      const healthyProxyId = "proxy_wiz_test_healthy";
      const brokenProxyId = "proxy_wiz_test_broken";

      registerWalletAccount({ id: walletId, label: "Test Wallet 5" });
      registerProxyConfig({ id: healthyProxyId, protocol: "http", host: "1.1.1.1", port: 8080, healthStatus: "available" });
      registerProxyConfig({ id: brokenProxyId, protocol: "http", host: "2.2.2.2", port: 8080 });

      // Establish existing valid route
      setWalletProviderRoute(walletId, "bankr", { proxyId: healthyProxyId });
      const initialRoute = getWalletProviderRoute(walletId, "bankr");
      expect(initialRoute?.proxyId).toBe(healthyProxyId);

      // Attempt to bind broken proxy (fails with 407 proxy auth error)
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        "Proxy Auth Required",
        { status: 407 }
      ));

      const result = await executeBindRouteWithHealthCheck(walletId, brokenProxyId, "bankr");

      expect(result.success).toBe(false);
      expect(result.pingResult?.healthStatus).toBe("authentication_error");

      // Verify existing route remains strictly unchanged
      const preservedRoute = getWalletProviderRoute(walletId, "bankr");
      expect(preservedRoute?.proxyId).toBe(healthyProxyId);

      // Verify no rotation audit log was recorded for the failed replacement
      const auditHistory = getProxyAuditHistory(walletId, "bankr");
      const failedRotations = auditHistory.filter((a) => a.newProxyId === brokenProxyId);
      expect(failedRotations.length).toBe(0);
    });

    // TEST 6: Replacement proxy sehat -> existing route berhasil diganti dan diaudit
    it("3.6 [TEST 6] should replace existing route and record audit log when replacement proxy is healthy", async () => {
      const walletId = "wiz_test_w6";
      const oldProxyId = "proxy_wiz_test_old6";
      const newProxyId = "proxy_wiz_test_new6";

      registerWalletAccount({ id: walletId, label: "Test Wallet 6" });
      registerProxyConfig({ id: oldProxyId, protocol: "http", host: "3.3.3.3", port: 8080, healthStatus: "available" });
      registerProxyConfig({ id: newProxyId, protocol: "http", host: "4.4.4.4", port: 8080 });

      // Establish initial route
      setWalletProviderRoute(walletId, "bankr", { proxyId: oldProxyId });

      // Mock healthy ping for replacement proxy
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
        JSON.stringify({ success: true, balances: {} }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));

      const result = await executeBindRouteWithHealthCheck(walletId, newProxyId, "bankr");

      expect(result.success).toBe(true);
      expect(result.pingResult?.reachable).toBe(true);
      expect(result.pingResult?.healthStatus).toBe("available");

      // Verify route was updated
      const updatedRoute = getWalletProviderRoute(walletId, "bankr");
      expect(updatedRoute?.proxyId).toBe(newProxyId);

      // Verify audit trail was recorded
      const auditHistory = getProxyAuditHistory(walletId, "bankr");
      const rotationEntry = auditHistory.find(
        (a) => a.previousProxyId === oldProxyId && a.newProxyId === newProxyId
      );
      expect(rotationEntry).toBeDefined();
    });

    // Extra check: --force / skipPing bypass
    it("3.7 [EXTRA] should allow route binding when skipPing (--force) is explicitly requested", async () => {
      const walletId = "wiz_test_w7";
      const proxyId = "proxy_wiz_test_p7";

      registerWalletAccount({ id: walletId, label: "Test Wallet 7" });
      registerProxyConfig({ id: proxyId, protocol: "http", host: "5.5.5.5", port: 8080 });

      // No fetch spy needed because ping is skipped
      const result = await executeBindRouteWithHealthCheck(walletId, proxyId, "bankr", { skipPing: true });

      expect(result.success).toBe(true);
      expect(result.pingResult?.message).toContain("Pre-bind ping dilewati");

      const route = getWalletProviderRoute(walletId, "bankr");
      expect(route?.proxyId).toBe(proxyId);
    });
  });

  describe("4. Universal Proxy String Parser (parseUniversalProxy)", () => {
    it("4.1 should parse standard vendor format (host:port:user:pass)", () => {
      const parsed = parseUniversalProxy("192.168.1.100:8080:myuser:mypassword");
      expect(parsed.protocol).toBe("http");
      expect(parsed.host).toBe("192.168.1.100");
      expect(parsed.port).toBe(8080);
      expect(parsed.username).toBe("myuser");
      expect(parsed.password).toBe("mypassword");
      expect(parsed.proxyUrl).toBe("http://myuser:mypassword@192.168.1.100:8080");
    });

    it("4.2 should parse vendor format with custom protocol fallback", () => {
      const parsed = parseUniversalProxy("10.0.0.1:1080:proxyusr:secret", "socks5");
      expect(parsed.protocol).toBe("socks5");
      expect(parsed.host).toBe("10.0.0.1");
      expect(parsed.port).toBe(1080);
      expect(parsed.username).toBe("proxyusr");
      expect(parsed.password).toBe("secret");
      expect(parsed.proxyUrl).toBe("socks5://proxyusr:secret@10.0.0.1:1080");
    });

    it("4.3 should parse unauthenticated host:port format", () => {
      const parsed = parseUniversalProxy("104.28.1.1:3128");
      expect(parsed.protocol).toBe("http");
      expect(parsed.host).toBe("104.28.1.1");
      expect(parsed.port).toBe(3128);
      expect(parsed.username).toBeUndefined();
      expect(parsed.password).toBeUndefined();
      expect(parsed.proxyUrl).toBe("http://104.28.1.1:3128");
    });

    it("4.4 should parse user:pass@host:port format without protocol scheme", () => {
      const parsed = parseUniversalProxy("alice:secret123@45.33.32.156:9000");
      expect(parsed.protocol).toBe("http");
      expect(parsed.host).toBe("45.33.32.156");
      expect(parsed.port).toBe(9000);
      expect(parsed.username).toBe("alice");
      expect(parsed.password).toBe("secret123");
      expect(parsed.proxyUrl).toBe("http://alice:secret123@45.33.32.156:9000");
    });

    it("4.5 should parse full URL with protocol scheme", () => {
      const parsed = parseUniversalProxy("https://admin:token@gateway.proxy.net:443");
      expect(parsed.protocol).toBe("https");
      expect(parsed.host).toBe("gateway.proxy.net");
      expect(parsed.port).toBe(443);
      expect(parsed.username).toBe("admin");
      expect(parsed.password).toBe("token");
    });

    it("4.6 should throw error on empty input or invalid proxy format", () => {
      expect(() => parseUniversalProxy("")).toThrow("Proxy input tidak boleh kosong");
      expect(() => parseUniversalProxy("   ")).toThrow("Proxy input tidak boleh kosong");
      expect(() => parseUniversalProxy("ftp://badprotocol.com:21")).toThrow("tidak didukung");
    });
  });
});

