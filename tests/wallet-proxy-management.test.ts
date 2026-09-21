/**
 * tests/wallet-proxy-management.test.ts
 *
 * Test suite for Wallet Management Foundation & Proxy Management.
 *
 * Scenarios:
 *  1. Register WalletAccount with valid EVM & Solana addresses
 *  2. Reject WalletAccount with malformed ID
 *  3. Reject duplicate WalletAccount ID
 *  4. Reject WalletAccount with malformed EVM address
 *  5. Retrieve WalletAccount by ID and by EVM/Solana address (case-insensitive)
 *  6. Update WalletAccount status (ACTIVE -> PAUSED -> DISABLED)
 *  7. List WalletAccounts with status filtering
 *  8. Register ProxyConfig with HTTP protocol
 *  9. Register ProxyConfig with SOCKS5 protocol and credentials
 *  10. Reject ProxyConfig with unsupported protocol
 *  11. Reject ProxyConfig with out-of-range port
 *  12. Build proxy URL formatting without credentials
 *  13. Build proxy URL formatting with credentials
 *  14. Build masked proxy URL (sanitizes password for safe logging)
 *  15. Update ProxyConfig status, health status, and latency
 *  16. Set provider route for Bankr with specific proxy
 *  17. Set provider route for BasedBot with different proxy on same wallet
 *  18. Reject setting route for non-existent wallet
 *  19. Reject setting route with non-existent proxy
 *  20. Rotate proxy and verify audit log record created with previous and new IDs
 *  21. Chronological audit history records multiple rotations with reasons
 *  22. Rotating to the same proxy is a no-op without duplicate audit logging
 *  23. Proxy rotation leaves wallet address and identity strictly unchanged
 *  24. Operational Context: route usable when wallet is ACTIVE and proxy is ACTIVE & available
 *  25. Independent Lifecycle: Wallet ACTIVE + Proxy ERROR -> route unusable, wallet remains ACTIVE
 *  26. Independent Lifecycle: Wallet ACTIVE + Proxy PAUSED -> route unusable, wallet remains ACTIVE
 *  27. Independent Lifecycle: Wallet PAUSED + Proxy ACTIVE -> route unusable, proxy remains ACTIVE
 *  28. Independent Lifecycle: Proxy health authentication_error -> route unusable, wallet remains ACTIVE
 *  29. Direct Route: Wallet ACTIVE with null proxy -> route usable via direct connection
 *  30. Bootstrap default wallet from environment configuration when no accounts exist
 *  31. Financial lineage continuity: deploy_logs records wallet_id and proxy_id
 *  32. Financial lineage continuity: active_positions records wallet_id and proxy_id
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import {
  registerWalletAccount,
  getWalletAccount,
  getWalletByAddress,
  listWalletAccounts,
  updateWalletStatus,
  registerProxyConfig,
  getProxyConfig,
  listProxyConfigs,
  updateProxyStatus,
  buildProxyUrl,
  setWalletProviderRoute,
  getWalletProviderRoute,
  rotateWalletProxy,
  getProxyAuditHistory,
  resolveOperationalContext,
  bootstrapDefaultWallet,
} from "../src/modules/identity/wallet-manager.ts";
import {
  DB_PATH,
  logDeploy,
  createPendingPosition,
  getPositionByContract,
} from "../src/db/vault.ts";

const db = new Database(DB_PATH);

describe("Wallet Management Foundation & Proxy Management", () => {
  beforeEach(() => {
    // Reset test data
    db.run("DELETE FROM proxy_audit_logs");
    db.run("DELETE FROM wallet_provider_routes");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'test_%' OR id = 'default-operator'");
    db.run("DELETE FROM proxy_configs WHERE id LIKE 'test_%'");
  });

  afterAll(() => {
    // Clean up
    db.run("DELETE FROM proxy_audit_logs");
    db.run("DELETE FROM wallet_provider_routes");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'test_%' OR id = 'default-operator'");
    db.run("DELETE FROM proxy_configs WHERE id LIKE 'test_%'");
    db.run("DELETE FROM deploy_logs WHERE ticker = 'LINEAGE_TEST'");
    db.run("DELETE FROM active_positions WHERE ticker = 'LINEAGE_TEST'");
  });

  // 1. Register WalletAccount with valid addresses
  it("1. should register and retrieve a valid multi-chain WalletAccount", () => {
    const account = registerWalletAccount({
      id: "test_wallet_1",
      label: "Treasury Wallet",
      evmAddress: "0x1111111111111111111111111111111111111111",
      solanaAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      credentialRef: "vault:secret/treasury-key",
      status: "ACTIVE",
    });

    expect(account.id).toBe("test_wallet_1");
    expect(account.label).toBe("Treasury Wallet");
    expect(account.evmAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(account.status).toBe("ACTIVE");
  });

  // 2. Reject malformed ID
  it("2. should reject WalletAccount registration with invalid characters in ID", () => {
    expect(() =>
      registerWalletAccount({
        id: "invalid id with spaces!",
        label: "Bad ID",
      })
    ).toThrow("Invalid wallet ID");
  });

  // 3. Reject duplicate ID
  it("3. should reject duplicate WalletAccount ID", () => {
    registerWalletAccount({
      id: "test_wallet_dup",
      label: "First Instance",
    });

    expect(() =>
      registerWalletAccount({
        id: "test_wallet_dup",
        label: "Second Instance",
      })
    ).toThrow("already exists");
  });

  // 4. Reject malformed EVM address
  it("4. should reject WalletAccount with malformed EVM address", () => {
    expect(() =>
      registerWalletAccount({
        id: "test_bad_evm",
        label: "Bad EVM",
        evmAddress: "0x123not40hexchars",
      })
    ).toThrow("Invalid EVM address format");
  });

  // 5. Retrieve WalletAccount by ID and Address
  it("5. should retrieve WalletAccount by ID and by EVM address case-insensitively", () => {
    registerWalletAccount({
      id: "test_wallet_lookup",
      label: "Lookup Wallet",
      evmAddress: "0xAbCdEf1234567890123456789012345678901234",
    });

    const byId = getWalletAccount("test_wallet_lookup");
    expect(byId).not.toBeNull();
    expect(byId?.id).toBe("test_wallet_lookup");

    const byAddr = getWalletByAddress("0xabcdef1234567890123456789012345678901234");
    expect(byAddr).not.toBeNull();
    expect(byAddr?.id).toBe("test_wallet_lookup");
  });

  // 6. Update WalletAccount status
  it("6. should update WalletAccount status from ACTIVE to PAUSED to DISABLED", () => {
    registerWalletAccount({
      id: "test_wallet_status",
      label: "Status Test",
      status: "ACTIVE",
    });

    updateWalletStatus("test_wallet_status", "PAUSED");
    expect(getWalletAccount("test_wallet_status")?.status).toBe("PAUSED");

    updateWalletStatus("test_wallet_status", "DISABLED");
    expect(getWalletAccount("test_wallet_status")?.status).toBe("DISABLED");
  });

  // 7. List WalletAccounts with filtering
  it("7. should list WalletAccounts and filter by status", () => {
    registerWalletAccount({ id: "test_w_act", label: "A", status: "ACTIVE" });
    registerWalletAccount({ id: "test_w_dis", label: "B", status: "DISABLED" });

    const activeList = listWalletAccounts("ACTIVE");
    expect(activeList.some((w) => w.id === "test_w_act")).toBe(true);
    expect(activeList.some((w) => w.id === "test_w_dis")).toBe(false);
  });

  // 8. Register ProxyConfig with HTTP protocol
  it("8. should register a valid HTTP ProxyConfig", () => {
    const proxy = registerProxyConfig({
      id: "test_proxy_http",
      protocol: "http",
      host: "10.0.0.1",
      port: 8080,
    });

    expect(proxy.id).toBe("test_proxy_http");
    expect(proxy.protocol).toBe("http");
    expect(proxy.host).toBe("10.0.0.1");
    expect(proxy.port).toBe(8080);
    expect(proxy.status).toBe("ACTIVE");
    expect(proxy.healthStatus).toBe("available");
  });

  // 9. Register ProxyConfig with SOCKS5 protocol and credentials
  it("9. should register a SOCKS5 ProxyConfig with auth credentials", () => {
    const proxy = registerProxyConfig({
      id: "test_proxy_socks5",
      protocol: "socks5",
      host: "192.168.1.100",
      port: 1080,
      username: "proxy_user",
      password: "secret_password",
    });

    expect(proxy.protocol).toBe("socks5");
    expect(proxy.username).toBe("proxy_user");
    expect(proxy.password).toBe("secret_password");
  });

  // 10. Reject unsupported proxy protocol
  it("10. should reject ProxyConfig with unsupported protocol", () => {
    expect(() =>
      registerProxyConfig({
        id: "test_proxy_ftp",
        protocol: "ftp" as any,
        host: "10.0.0.1",
        port: 21,
      })
    ).toThrow("Invalid proxy protocol");
  });

  // 11. Reject out-of-range port
  it("11. should reject ProxyConfig with port out of range", () => {
    expect(() =>
      registerProxyConfig({
        id: "test_proxy_badport",
        protocol: "http",
        host: "10.0.0.1",
        port: 70000,
      })
    ).toThrow("Invalid proxy port");
  });

  // 12. Build proxy URL without credentials
  it("12. should build correct proxy URL without credentials", () => {
    const proxy = registerProxyConfig({
      id: "test_proxy_noauth",
      protocol: "http",
      host: "proxy.network.internal",
      port: 3128,
    });

    expect(buildProxyUrl(proxy)).toBe("http://proxy.network.internal:3128");
  });

  // 13. Build proxy URL with credentials
  it("13. should build correct proxy URL with credentials", () => {
    const proxy = registerProxyConfig({
      id: "test_proxy_auth",
      protocol: "http",
      host: "proxy.network.internal",
      port: 3128,
      username: "alice",
      password: "my_clear_password",
    });

    expect(buildProxyUrl(proxy)).toBe("http://alice:my_clear_password@proxy.network.internal:3128");
  });

  // 14. Build masked proxy URL (sanitizes password)
  it("14. should mask proxy password when maskPassword is true for safe logging", () => {
    const proxy = registerProxyConfig({
      id: "test_proxy_mask",
      protocol: "http",
      host: "proxy.network.internal",
      port: 3128,
      username: "alice",
      password: "my_super_secret_password",
    });

    const masked = buildProxyUrl(proxy, true);
    expect(masked).toBe("http://alice:****@proxy.network.internal:3128");
    expect(masked).not.toContain("my_super_secret_password");
  });

  // 15. Update ProxyConfig status, health, and latency
  it("15. should update proxy status, health status, and latency", () => {
    registerProxyConfig({
      id: "test_proxy_health",
      protocol: "http",
      host: "10.0.0.2",
      port: 8080,
    });

    updateProxyStatus("test_proxy_health", "ACTIVE", "timeout", 1500);

    const updated = getProxyConfig("test_proxy_health");
    expect(updated?.healthStatus).toBe("timeout");
    expect(updated?.latencyMs).toBe(1500);
    expect(updated?.lastCheckedAt).not.toBeNull();
  });

  // 16. Set provider route for Bankr
  it("16. should configure provider route for Bankr on a wallet", () => {
    registerWalletAccount({ id: "test_w_route", label: "Routed Wallet" });
    registerProxyConfig({ id: "test_p_bankr", protocol: "http", host: "1.1.1.1", port: 8080 });

    setWalletProviderRoute("test_w_route", "bankr", {
      credentialRef: "vault:bankr-key-1",
      proxyId: "test_p_bankr",
    });

    const route = getWalletProviderRoute("test_w_route", "bankr");
    expect(route).not.toBeNull();
    expect(route?.provider).toBe("bankr");
    expect(route?.credentialRef).toBe("vault:bankr-key-1");
    expect(route?.proxyId).toBe("test_p_bankr");
  });

  // 17. Set different route for BasedBot on same wallet
  it("17. should configure separate BasedBot route with different proxy on same wallet", () => {
    registerWalletAccount({ id: "test_w_multi", label: "Multi Route Wallet" });
    registerProxyConfig({ id: "test_p_one", protocol: "http", host: "1.1.1.1", port: 8080 });
    registerProxyConfig({ id: "test_p_two", protocol: "socks5", host: "2.2.2.2", port: 1080 });

    setWalletProviderRoute("test_w_multi", "bankr", { proxyId: "test_p_one" });
    setWalletProviderRoute("test_w_multi", "basedbot", { proxyId: "test_p_two" });

    const bankrRoute = getWalletProviderRoute("test_w_multi", "bankr");
    const basedbotRoute = getWalletProviderRoute("test_w_multi", "basedbot");

    expect(bankrRoute?.proxyId).toBe("test_p_one");
    expect(basedbotRoute?.proxyId).toBe("test_p_two");
  });

  // 18. Reject setting route for non-existent wallet
  it("18. should reject setting route for non-existent wallet", () => {
    expect(() =>
      setWalletProviderRoute("test_w_ghost", "bankr", { proxyId: null })
    ).toThrow("does not exist");
  });

  // 19. Reject setting route with non-existent proxy
  it("19. should reject setting route with non-existent proxy", () => {
    registerWalletAccount({ id: "test_w_valid", label: "Valid" });
    expect(() =>
      setWalletProviderRoute("test_w_valid", "bankr", { proxyId: "ghost_proxy" })
    ).toThrow("does not exist");
  });

  // 20. Rotate proxy and verify audit log
  it("20. should record rotation audit log when proxy is rotated on a wallet route", () => {
    registerWalletAccount({ id: "test_w_rot", label: "Rotation Test" });
    registerProxyConfig({ id: "test_p_old", protocol: "http", host: "1.1.1.1", port: 8080 });
    registerProxyConfig({ id: "test_p_new", protocol: "http", host: "2.2.2.2", port: 8080 });

    setWalletProviderRoute("test_w_rot", "bankr", { proxyId: "test_p_old" });

    // Rotate to new proxy
    const rotated = rotateWalletProxy(
      "test_w_rot",
      "bankr",
      "test_p_new",
      "Migrating to low-latency datacenter proxy"
    );

    expect(rotated).toBe(true);

    const history = getProxyAuditHistory("test_w_rot", "bankr");
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].previousProxyId).toBe("test_p_old");
    expect(history[0].newProxyId).toBe("test_p_new");
    expect(history[0].reason).toContain("Migrating to low-latency");

    const updatedRoute = getWalletProviderRoute("test_w_rot", "bankr");
    expect(updatedRoute?.proxyId).toBe("test_p_new");
  });

  // 21. Chronological audit history
  it("21. should maintain chronological order of multiple proxy rotations", () => {
    registerWalletAccount({ id: "test_w_multi_rot", label: "Multi Rotation" });
    registerProxyConfig({ id: "test_p_a", protocol: "http", host: "1.1.1.1", port: 8080 });
    registerProxyConfig({ id: "test_p_b", protocol: "http", host: "2.2.2.2", port: 8080 });
    registerProxyConfig({ id: "test_p_c", protocol: "http", host: "3.3.3.3", port: 8080 });

    setWalletProviderRoute("test_w_multi_rot", "bankr", { proxyId: "test_p_a" });
    rotateWalletProxy("test_w_multi_rot", "bankr", "test_p_b", "First rotation");
    rotateWalletProxy("test_w_multi_rot", "bankr", "test_p_c", "Second rotation");

    const history = getProxyAuditHistory("test_w_multi_rot", "bankr");
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].newProxyId).toBe("test_p_c");
    expect(history[0].previousProxyId).toBe("test_p_b");
    expect(history[1].newProxyId).toBe("test_p_b");
    expect(history[1].previousProxyId).toBe("test_p_a");
  });

  // 22. Rotating to same proxy is a no-op
  it("22. should not record redundant audit logs when rotating to the same proxy", () => {
    registerWalletAccount({ id: "test_w_noop", label: "Noop Test" });
    registerProxyConfig({ id: "test_p_same", protocol: "http", host: "1.1.1.1", port: 8080 });

    setWalletProviderRoute("test_w_noop", "bankr", { proxyId: "test_p_same" });
    const countBefore = getProxyAuditHistory("test_w_noop", "bankr").length;

    rotateWalletProxy("test_w_noop", "bankr", "test_p_same", "Redundant call");
    const countAfter = getProxyAuditHistory("test_w_noop", "bankr").length;

    expect(countAfter).toBe(countBefore);
  });

  // 23. Proxy rotation preserves wallet identity
  it("23. should leave wallet address and identity strictly unchanged after proxy rotation", () => {
    const initialWallet = registerWalletAccount({
      id: "test_w_preserve",
      label: "Preserve Identity",
      evmAddress: "0x1234567890123456789012345678901234567890",
      solanaAddress: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    });

    registerProxyConfig({ id: "test_p_rot1", protocol: "http", host: "1.1.1.1", port: 8080 });
    registerProxyConfig({ id: "test_p_rot2", protocol: "http", host: "2.2.2.2", port: 8080 });

    setWalletProviderRoute("test_w_preserve", "bankr", { proxyId: "test_p_rot1" });
    rotateWalletProxy("test_w_preserve", "bankr", "test_p_rot2", "Routine maintenance");

    const walletAfter = getWalletAccount("test_w_preserve");
    expect(walletAfter?.evmAddress).toBe(initialWallet.evmAddress);
    expect(walletAfter?.solanaAddress).toBe(initialWallet.solanaAddress);
    expect(walletAfter?.id).toBe(initialWallet.id);
  });

  // 24. Operational Context: Usable route
  it("24. should resolve usable operational context when wallet and proxy are both ACTIVE", () => {
    registerWalletAccount({ id: "test_w_ctx_ok", label: "OK Wallet", status: "ACTIVE" });
    registerProxyConfig({
      id: "test_p_ctx_ok",
      protocol: "http",
      host: "10.0.0.5",
      port: 8080,
      status: "ACTIVE",
      healthStatus: "available",
    });

    setWalletProviderRoute("test_w_ctx_ok", "bankr", {
      credentialRef: "vault:bankr-key",
      proxyId: "test_p_ctx_ok",
    });

    const ctx = resolveOperationalContext("test_w_ctx_ok", "bankr");
    expect(ctx.isUsable).toBe(true);
    expect(ctx.proxyUrl).toBe("http://10.0.0.5:8080");
    expect(ctx.credentialRef).toBe("vault:bankr-key");
  });

  // 25. Independent Lifecycle: Wallet ACTIVE + Proxy ERROR
  it("25. should mark route unusable when Proxy is ERROR without disabling Wallet", () => {
    registerWalletAccount({ id: "test_w_indep1", label: "Active Wallet", status: "ACTIVE" });
    registerProxyConfig({
      id: "test_p_err",
      protocol: "http",
      host: "10.0.0.6",
      port: 8080,
      status: "ERROR",
    });

    setWalletProviderRoute("test_w_indep1", "bankr", { proxyId: "test_p_err" });

    const ctx = resolveOperationalContext("test_w_indep1", "bankr");
    expect(ctx.isUsable).toBe(false);
    expect(ctx.unusableReason).toContain("Proxy 'test_p_err' is in ERROR state");

    // Wallet status MUST remain ACTIVE!
    const wallet = getWalletAccount("test_w_indep1");
    expect(wallet?.status).toBe("ACTIVE");
  });

  // 26. Independent Lifecycle: Wallet ACTIVE + Proxy PAUSED
  it("26. should mark route unusable when Proxy is PAUSED without disabling Wallet", () => {
    registerWalletAccount({ id: "test_w_indep2", label: "Active Wallet", status: "ACTIVE" });
    registerProxyConfig({
      id: "test_p_pause",
      protocol: "http",
      host: "10.0.0.7",
      port: 8080,
      status: "PAUSED",
    });

    setWalletProviderRoute("test_w_indep2", "bankr", { proxyId: "test_p_pause" });

    const ctx = resolveOperationalContext("test_w_indep2", "bankr");
    expect(ctx.isUsable).toBe(false);
    expect(ctx.unusableReason).toContain("is in PAUSED state");
    expect(getWalletAccount("test_w_indep2")?.status).toBe("ACTIVE");
  });

  // 27. Independent Lifecycle: Wallet PAUSED + Proxy ACTIVE
  it("27. should mark route unusable when Wallet is PAUSED without disabling Proxy", () => {
    registerWalletAccount({ id: "test_w_pause", label: "Paused Wallet", status: "PAUSED" });
    registerProxyConfig({
      id: "test_p_live",
      protocol: "http",
      host: "10.0.0.8",
      port: 8080,
      status: "ACTIVE",
    });

    setWalletProviderRoute("test_w_pause", "bankr", { proxyId: "test_p_live" });

    const ctx = resolveOperationalContext("test_w_pause", "bankr");
    expect(ctx.isUsable).toBe(false);
    expect(ctx.unusableReason).toContain("is currently PAUSED");
    expect(getProxyConfig("test_p_live")?.status).toBe("ACTIVE");
  });

  // 28. Independent Lifecycle: Proxy health authentication_error
  it("28. should mark route unusable when Proxy healthStatus is authentication_error", () => {
    registerWalletAccount({ id: "test_w_auth_err", label: "Wallet", status: "ACTIVE" });
    registerProxyConfig({
      id: "test_p_auth_err",
      protocol: "http",
      host: "10.0.0.9",
      port: 8080,
      status: "ACTIVE",
      healthStatus: "authentication_error",
    });

    setWalletProviderRoute("test_w_auth_err", "bankr", { proxyId: "test_p_auth_err" });

    const ctx = resolveOperationalContext("test_w_auth_err", "bankr");
    expect(ctx.isUsable).toBe(false);
    expect(ctx.unusableReason).toContain("health status is authentication_error");
  });

  // 29. Direct Route: Wallet ACTIVE with null proxy
  it("29. should resolve usable direct route when no proxy is assigned", () => {
    registerWalletAccount({
      id: "test_w_direct",
      label: "Direct Wallet",
      status: "ACTIVE",
      credentialRef: "vault:default",
    });

    setWalletProviderRoute("test_w_direct", "basedbot", { proxyId: null });

    const ctx = resolveOperationalContext("test_w_direct", "basedbot");
    expect(ctx.isUsable).toBe(true);
    expect(ctx.proxy).toBeNull();
    expect(ctx.proxyUrl).toBeUndefined();
  });

  // 30. Bootstrap default wallet
  it("30. should bootstrap default operator wallet from environment configuration", () => {
    // Ensure table is empty of non-test wallets
    db.run("DELETE FROM wallet_accounts WHERE id = 'default-operator'");

    const defaultWallet = bootstrapDefaultWallet();
    expect(defaultWallet).not.toBeNull();
    expect(defaultWallet.id).toBe("default-operator");
    expect(defaultWallet.status).toBe("ACTIVE");

    // Routes should exist for Bankr and BasedBot
    const bankrRoute = getWalletProviderRoute("default-operator", "bankr");
    const basedbotRoute = getWalletProviderRoute("default-operator", "basedbot");

    expect(bankrRoute).not.toBeNull();
    expect(basedbotRoute).not.toBeNull();
  });

  // 31. Financial lineage continuity: deploy_logs records wallet_id and proxy_id
  it("31. should persist wallet_id and proxy_id in deploy_logs maintaining historical lineage", () => {
    const deployLogId = logDeploy({
      chain: "base",
      tokenName: "Lineage Token",
      ticker: "LINEAGE_TEST",
      status: "pending",
      walletId: "test_wallet_1",
      proxyId: "test_proxy_http",
    });

    const row = db
      .query("SELECT wallet_id, proxy_id FROM deploy_logs WHERE id = ?")
      .get(deployLogId) as { wallet_id: string; proxy_id: string };

    expect(row.wallet_id).toBe("test_wallet_1");
    expect(row.proxy_id).toBe("test_proxy_http");
  });

  // 32. Financial lineage continuity: active_positions records wallet_id and proxy_id
  it("32. should persist wallet_id and proxy_id in active_positions maintaining historical lineage", () => {
    const testContract = "0x" + "9".repeat(40);

    createPendingPosition({
      deployLogId: 999,
      chain: "base",
      contractAddr: testContract,
      ticker: "LINEAGE_TEST",
      snipeAmount: 0.05,
      takeProfitX: 2.0,
      stopLossPct: 0.3,
      walletId: "test_wallet_1",
      proxyId: "test_proxy_http",
    });

    const pos = getPositionByContract(testContract);
    expect(pos?.walletId).toBe("test_wallet_1");
    expect(pos?.proxyId).toBe("test_proxy_http");
  });
});
