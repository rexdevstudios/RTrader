import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import { parseEther } from "viem";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  scanAllWalletBalances,
  type WalletBalanceEvaluation,
  type MultiWalletBalanceReport,
} from "../src/modules/identity/preflight-balance.ts";
import {
  broadcastLowBalanceAlert,
  type BalanceAlertParams,
} from "../src/modules/social/beacon-broadcaster.ts";
import {
  fetchWebshareProxyList,
  syncWebshareProxiesToVault,
} from "../src/modules/identity/webshare-adapter.ts";
import {
  registerWalletAccount,
  registerProxyConfig,
  updateProxyStatus,
  getProxyConfig,
  listProxyConfigs,
  getAllProviderRoutes,
  setWalletProviderRoute,
  probeAndResupplyQuarantinedPool,
  type WalletAccount,
} from "../src/modules/identity/wallet-manager.ts";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import { resetConfig } from "../src/config.ts";

const db = new Database(DB_PATH);

describe("Multi-Account Balance Distribution & Webshare Proxy Sync Test Suite", () => {
  const PREFIX = "wstest_";
  let axiosPostSpy: ReturnType<typeof spyOn>;
  let axiosGetSpy: ReturnType<typeof spyOn>;
  const originalEnv = { ...process.env };

  function cleanupTestData() {
    try {
      db.run(`DELETE FROM wallet_provider_routes WHERE wallet_id LIKE '${PREFIX}%' OR proxy_id LIKE '${PREFIX}%'`);
      db.run(`DELETE FROM wallet_provider_routes WHERE wallet_id LIKE 'ws_%' OR proxy_id LIKE 'ws_%'`);
      db.run(
        `DELETE FROM proxy_audit_logs WHERE wallet_id LIKE '${PREFIX}%' OR previous_proxy_id LIKE '${PREFIX}%' OR new_proxy_id LIKE '${PREFIX}%'`
      );
      db.run(
        `DELETE FROM proxy_audit_logs WHERE wallet_id LIKE 'ws_%' OR previous_proxy_id LIKE 'ws_%' OR new_proxy_id LIKE 'ws_%'`
      );
      db.run(`DELETE FROM wallet_accounts WHERE id LIKE '${PREFIX}%' OR id LIKE 'ws_%'`);
      db.run(`DELETE FROM proxy_configs WHERE id LIKE '${PREFIX}%' OR id LIKE 'ws_%'`);
    } catch {
      // ignore
    }
  }

  beforeEach(() => {
    resetConfig();
    cleanupTestData();
    process.env = { ...originalEnv };
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_ai_key";
    process.env.FIRECRAWL_API_KEY = "test_firecrawl";
    process.env.PINATA_JWT = "test_pinata";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    delete process.env.COMMUNITY_DISCORD_WEBHOOK;
    delete process.env.COMMUNITY_TELEGRAM_WEBHOOK;
    delete process.env.COMMUNITY_TELEGRAM_CHANNEL;
    delete process.env.WEBSHARE_API_KEY;
  });

  afterEach(() => {
    cleanupTestData();
    axiosPostSpy?.mockRestore();
    axiosGetSpy?.mockRestore();
    process.env = { ...originalEnv };
  });

  // ─── 1. Multi-Account Balance Scanning ───────────────────────
  describe("1. Multi-Account Balance Scanning (scanAllWalletBalances)", () => {
    it("1.1 should evaluate wallets with sufficient balances on both chains as healthy", async () => {
      const mockWallets: WalletAccount[] = [
        {
          id: "op_healthy",
          label: "Healthy Operator",
          status: "ACTIVE",
          evmAddress: "0x946657d17c7e83052d50634d9da6ff3fc46b418a",
          solanaAddress: "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz",
        },
      ];

      const mockEvmClient = {
        getBalance: async () => parseEther("0.1"), // 0.1 ETH > 0.055 min
      };
      const mockSolConnection = {
        getBalance: async () => 0.2 * LAMPORTS_PER_SOL, // 0.2 SOL > 0.06 min
      };

      const report = await scanAllWalletBalances({
        wallets: mockWallets,
        minEth: 0.055,
        minSol: 0.06,
        injectedEvmClient: mockEvmClient as any,
        injectedSolanaConnection: mockSolConnection as any,
      });

      expect(report.totalScanned).toBe(1);
      expect(report.healthyCount).toBe(1);
      expect(report.starvingCount).toBe(0);
      expect(report.starvingWallets.length).toBe(0);

      const ev = report.evaluations[0];
      expect(ev.evmSufficient).toBe(true);
      expect(ev.solanaSufficient).toBe(true);
      expect(ev.isStarving).toBe(false);
      expect(ev.evmBalance).toBeCloseTo(0.1, 4);
      expect(ev.solanaBalance).toBeCloseTo(0.2, 4);
      expect(ev.deficitEth).toBe(0);
      expect(ev.deficitSol).toBe(0);
    });

    it("1.2 should detect starving wallet when Base L2 balance is below minEth", async () => {
      const mockWallets: WalletAccount[] = [
        {
          id: "op_low_eth",
          label: "Low ETH Operator",
          status: "ACTIVE",
          evmAddress: "0x946657d17c7e83052d50634d9da6ff3fc46b418a",
          solanaAddress: "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz",
        },
      ];

      const mockEvmClient = {
        getBalance: async () => parseEther("0.02"), // 0.02 ETH < 0.055 min (deficit = 0.035)
      };
      const mockSolConnection = {
        getBalance: async () => 0.1 * LAMPORTS_PER_SOL, // 0.1 SOL >= 0.06 min
      };

      const report = await scanAllWalletBalances({
        wallets: mockWallets,
        minEth: 0.055,
        minSol: 0.06,
        injectedEvmClient: mockEvmClient as any,
        injectedSolanaConnection: mockSolConnection as any,
      });

      expect(report.totalScanned).toBe(1);
      expect(report.healthyCount).toBe(0);
      expect(report.starvingCount).toBe(1);
      expect(report.starvingWallets.length).toBe(1);

      const ev = report.evaluations[0];
      expect(ev.evmSufficient).toBe(false);
      expect(ev.solanaSufficient).toBe(true);
      expect(ev.isStarving).toBe(true);
      expect(ev.evmBalance).toBeCloseTo(0.02, 4);
      expect(ev.deficitEth).toBeCloseTo(0.035, 4);
      expect(ev.starvingReasons.some((r) => r.includes("Base L2"))).toBe(true);
    });

    it("1.3 should detect starving wallet when Solana balance is below minSol", async () => {
      const mockWallets: WalletAccount[] = [
        {
          id: "op_low_sol",
          label: "Low SOL Operator",
          status: "ACTIVE",
          evmAddress: "0x946657d17c7e83052d50634d9da6ff3fc46b418a",
          solanaAddress: "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz",
        },
      ];

      const mockEvmClient = {
        getBalance: async () => parseEther("0.08"), // 0.08 ETH >= 0.055 min
      };
      const mockSolConnection = {
        getBalance: async () => 0.01 * LAMPORTS_PER_SOL, // 0.01 SOL < 0.06 min (deficit = 0.05)
      };

      const report = await scanAllWalletBalances({
        wallets: mockWallets,
        minEth: 0.055,
        minSol: 0.06,
        injectedEvmClient: mockEvmClient as any,
        injectedSolanaConnection: mockSolConnection as any,
      });

      expect(report.totalScanned).toBe(1);
      expect(report.healthyCount).toBe(0);
      expect(report.starvingCount).toBe(1);

      const ev = report.evaluations[0];
      expect(ev.evmSufficient).toBe(true);
      expect(ev.solanaSufficient).toBe(false);
      expect(ev.isStarving).toBe(true);
      expect(ev.solanaBalance).toBeCloseTo(0.01, 4);
      expect(ev.deficitSol).toBeCloseTo(0.05, 4);
      expect(ev.starvingReasons.some((r) => r.includes("Solana"))).toBe(true);
    });

    it("1.4 should filter out non-active wallets by default when onlyActive is true", async () => {
      const mockWallets: WalletAccount[] = [
        {
          id: "op_active",
          label: "Active Op",
          status: "ACTIVE",
          evmAddress: "0x946657d17c7e83052d50634d9da6ff3fc46b418a",
        },
        {
          id: "op_paused",
          label: "Paused Op",
          status: "PAUSED",
          evmAddress: "0x946657d17c7e83052d50634d9da6ff3fc46b418a",
        },
      ];

      const mockEvmClient = {
        getBalance: async () => parseEther("0.1"),
      };

      const report = await scanAllWalletBalances({
        wallets: mockWallets,
        onlyActive: true,
        injectedEvmClient: mockEvmClient as any,
      });

      expect(report.totalScanned).toBe(1);
      expect(report.evaluations[0].walletId).toBe("op_active");
    });
  });

  // ─── 2. Low-Balance Alert Broadcaster ────────────────────────
  describe("2. Low-Balance Alert Broadcaster (broadcastLowBalanceAlert)", () => {
    it("2.1 should format alert card with wallet deficit details and return non-blocking success", async () => {
      const alertParams: BalanceAlertParams = {
        title: "Peringatan Defisit Saldo Operator",
        wallets: [
          {
            id: "op1",
            label: "Operator 1",
            chain: "base",
            address: "0x946657d17c7e83052d50634d9da6ff3fc46b418a",
            actualBalance: 0.015,
            requiredBalance: 0.055,
            deficit: 0.04,
          },
        ],
        totalStarving: 1,
      };

      const result = await broadcastLowBalanceAlert(alertParams);
      expect(result.cardText).toContain("BALANCE ALERT - LOW OPERATOR BALANCE");
      expect(result.cardText).toContain("Operator 1");
      expect(result.cardText).toContain("0.015000 ETH < min 0.0550 ETH");
      expect(result.cardText).toContain("Defisit: -0.040000 ETH");
      expect(result.errors.length).toBe(0);
    });

    it("2.2 should dispatch direct Telegram message when token and channel are set", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";
      process.env.COMMUNITY_TELEGRAM_CHANNEL = "@test_channel";
      resetConfig();

      axiosPostSpy = spyOn(axios, "post").mockResolvedValue({
        status: 200,
        data: { ok: true },
      });

      const alertParams: BalanceAlertParams = {
        title: "Saldo Kritis",
        wallets: [
          {
            id: "op_sol",
            label: "Solana Bot",
            chain: "solana",
            address: "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz",
            actualBalance: 0.005,
            requiredBalance: 0.06,
            deficit: 0.055,
          },
        ],
        totalStarving: 1,
      };

      const result = await broadcastLowBalanceAlert(alertParams);
      expect(axiosPostSpy).toHaveBeenCalled();
      const firstCall = axiosPostSpy.mock.calls[0];
      expect(firstCall[0]).toContain("api.telegram.org");
      expect(firstCall[1].chat_id).toBe("@test_channel");
      expect(firstCall[1].text).toContain("SOLANA");
      expect(firstCall[1].text).toContain("-0.055000 SOL");
    });
  });

  // ─── 3. Webshare Proxy API Adapter ───────────────────────────
  describe("3. Webshare Proxy API Adapter (webshare-adapter.ts)", () => {
    it("3.1 fetchWebshareProxyList should return error when API key is not configured", async () => {
      delete process.env.WEBSHARE_API_KEY;
      resetConfig();

      const result = await fetchWebshareProxyList();
      expect(result.proxies.length).toBe(0);
      expect(result.error).toContain("WEBSHARE_API_KEY tidak ditemukan");
    });

    it("3.2 fetchWebshareProxyList should parse valid Webshare API response", async () => {
      const mockResponse = {
        status: 200,
        data: {
          count: 2,
          results: [
            {
              proxy_address: "198.105.121.200",
              port: 6462,
              username: "testuser1",
              password: "testpass1",
              valid: true,
              country_code: "US",
              city_name: "Dallas",
            },
            {
              proxy_address: "64.137.96.74",
              port: 6641,
              username: "testuser2",
              password: "testpass2",
              valid: true,
              country_code: "US",
              city_name: "Chicago",
            },
          ],
        },
      };

      const mockClient = {
        get: async () => mockResponse,
      };

      const result = await fetchWebshareProxyList({
        apiKey: "valid_test_key",
        _injectedClient: mockClient as any,
      });

      expect(result.error).toBeUndefined();
      expect(result.totalCount).toBe(2);
      expect(result.proxies.length).toBe(2);
      expect(result.proxies[0].ip).toBe("198.105.121.200");
      expect(result.proxies[0].port).toBe(6462);
      expect(result.proxies[0].username).toBe("testuser1");
      expect(result.proxies[0].countryCode).toBe("US");
    });

    it("3.3 syncWebshareProxiesToVault should register proxies into SQLite vault.db", async () => {
      const mockResponse = {
        status: 200,
        data: {
          count: 1,
          results: [
            {
              proxy_address: "31.59.20.176",
              port: 6754,
              username: "waqvuqeu",
              password: "secret_password",
              valid: true,
            },
          ],
        },
      };

      const mockClient = {
        get: async () => mockResponse,
      };

      const syncResult = await syncWebshareProxiesToVault({
        apiKey: "test_sync_key",
        testPings: false, // Skip live network call in unit test
        _injectedClient: mockClient as any,
        prefix: "ws_test",
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.importedCount).toBe(1);
      const expectedId = "ws_test_31_59_20_176_6754";
      expect(syncResult.importedProxyIds).toContain(expectedId);

      const saved = getProxyConfig(expectedId);
      expect(saved).not.toBeNull();
      expect(saved?.host).toBe("31.59.20.176");
      expect(saved?.port).toBe(6754);
      expect(saved?.username).toBe("waqvuqeu");
      expect(saved?.status).toBe("ACTIVE");
    });

    it("3.4 syncWebshareProxiesToVault should auto-bind imported proxy to wallet needing route", async () => {
      // Register a wallet with an unassigned route
      const walletId = `ws_bind_test_${Date.now()}`;
      registerWalletAccount({
        id: walletId,
        label: "Webshare Auto-Bind Test",
        status: "ACTIVE",
      });

      // Configure a route without proxy
      setWalletProviderRoute(walletId, "bankr", {
        credentialRef: "env:TEST_KEY",
        proxyId: null,
      });

      const mockResponse = {
        status: 200,
        data: {
          count: 1,
          results: [
            {
              proxy_address: "45.38.107.97",
              port: 6014,
              username: "user_bind",
              password: "pass_bind",
              valid: true,
            },
          ],
        },
      };

      const mockClient = {
        get: async () => mockResponse,
      };

      const syncResult = await syncWebshareProxiesToVault({
        apiKey: "test_bind_key",
        testPings: false,
        autoBind: true,
        _injectedClient: mockClient as any,
        prefix: "ws_bind",
      });

      expect(syncResult.success).toBe(true);
      expect(syncResult.boundCount).toBeGreaterThanOrEqual(1);

      const routes = getAllProviderRoutes(walletId);
      expect(routes.length).toBe(1);
      expect(routes[0].proxyId).toContain("ws_bind_45_38_107_97_6014");
    });
  });

  // ─── 4. Fallback Resupply Integration ────────────────────────
  describe("4. Proactive Pool Resupply with Webshare Fallback", () => {
    it("4.1 probeAndResupplyQuarantinedPool should attempt Webshare fallback if healthy < threshold and key is present", async () => {
      process.env.WEBSHARE_API_KEY = "test_resupply_key";

      // Mock axios GET for Webshare API
      axiosGetSpy = spyOn(axios, "get").mockResolvedValue({
        status: 200,
        data: {
          count: 1,
          results: [
            {
              proxy_address: "142.111.67.146",
              port: 5611,
              username: "resupply_user",
              password: "resupply_pass",
              valid: true,
            },
          ],
        },
      });

      const result = await probeAndResupplyQuarantinedPool({
        minActiveThreshold: 9999, // Force threshold higher than pool
        enableWebshareFallback: true,
        testWebsharePings: false,
        timeoutMs: 1000,
      });

      expect(axiosGetSpy).toHaveBeenCalled();
      expect(result.details.some((d) => d.includes("Webshare Fallback Sync"))).toBe(true);
    });
  });
});
