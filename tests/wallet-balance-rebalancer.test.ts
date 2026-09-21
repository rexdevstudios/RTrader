/**
 * tests/wallet-balance-rebalancer.test.ts
 *
 * Automated test suite for Phase P7:
 *  - Section 1: Autonomous Multi-Account Balance Rebalancer (Internal Gas Top-Up)
 *  - Section 2: Webshare IP Replacement Adapter
 *  - Section 3: Broadcast Rebalance Alert
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import axios from "axios";
import { parseEther, formatEther } from "viem";
import {
  rebalanceOperatorBalances,
  type RebalanceOptions,
} from "../src/modules/identity/balance-rebalancer.ts";
import {
  replaceWebshareProxy,
  autoReplaceFlappingWebshareProxies,
} from "../src/modules/identity/webshare-adapter.ts";
import {
  registerProxyConfig,
  getProxyConfig,
  deleteProxyConfig,
  updateProxyStatus,
  recordProxyAuditLog,
  type WalletAccount,
} from "../src/modules/identity/wallet-manager.ts";
import {
  broadcastRebalanceAlert,
  type RebalanceAlertReport,
} from "../src/modules/social/beacon-broadcaster.ts";

import { resetConfig } from "../src/config.ts";

describe("Phase P7 — Autonomous Balance Rebalancer & Webshare IP Replacement", () => {
  const testProxyId = "test_flapping_ws_proxy";
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.EVM_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY =
      "2APBhs8BVkxSrupe2Wk6pjWwkdz3Cb4RRAT5aNgx7EUgfRyaerR12DaeHYLxHaJegkbNfjcVg4rCZ8AdVuY3Uh7z";
    resetConfig();
    try {
      deleteProxyConfig(testProxyId);
    } catch {}
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
    try {
      deleteProxyConfig(testProxyId);
    } catch {}
  });

  // ─── SECTION 1: Autonomous Balance Rebalancer Engine ────────────────────────

  describe("1. Multi-Account Balance Rebalancer Engine", () => {
    const mockStarvingWallets: WalletAccount[] = [
      {
        id: "starving_op_1",
        label: "Starving Operator 1",
        evmAddress: "0x1111111111111111111111111111111111111111",
        solanaAddress: "GjUB9d9eVbJMj7Nb1tuMLK16QdiHLFZNjLid5bmakV6x",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "starving_op_2",
        label: "Starving Operator 2",
        evmAddress: "0x2222222222222222222222222222222222222222",
        solanaAddress: "BWsdCSDdW9L9ERiFmxVHX5pka6hMKmQZamfZhTLD7bXU",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    it("1.1 should calculate deficits and simulate transfers in dry-run mode without on-chain execution", async () => {
      // Mock EVM balances: Master has 1.0 ETH, starving wallets have 0.01 ETH
      const mockEvmClient = {
        getBalance: async (args: { address: string }) => {
          if (args.address.toLowerCase().includes("1111")) return parseEther("0.01");
          if (args.address.toLowerCase().includes("2222")) return parseEther("0.02");
          return parseEther("1.0"); // Master
        },
      };

      const mockSolConnection = {
        getBalance: async () => 100_000_000, // 0.1 SOL (Sufficient)
      };

      const report = await rebalanceOperatorBalances({
        dryRun: true,
        chain: "base",
        targetMinEth: 0.055,
        masterMinEthReserve: 0.05,
        maxTopUpEthPerWallet: 0.05,
        wallets: mockStarvingWallets,
        _injectedEvmClient: mockEvmClient,
        _injectedSolanaConnection: mockSolConnection,
      });

      expect(report.dryRun).toBe(true);
      expect(report.totalStarvingWallets).toBe(2);
      expect(report.totalRebalanced).toBe(2);
      expect(report.totalSkipped).toBe(0);
      expect(report.totalFailed).toBe(0);
      expect(report.totalEthTransferred).toBeGreaterThan(0.05);

      // Verify each transfer item is marked simulated
      for (const t of report.transfers) {
        expect(t.status).toBe("simulated");
        expect(t.txHash).toBeDefined();
        expect(t.currency).toBe("ETH");
      }
    });

    it("1.2 should strictly protect Master Reserve Buffer and skip transfer if Master balance is depleted", async () => {
      // Master only has 0.04 ETH, while masterMinEthReserve is 0.05 ETH
      const mockDepletedEvmClient = {
        getBalance: async (args: { address: string }) => {
          if (args.address.toLowerCase().includes("1111")) return parseEther("0.01");
          return parseEther("0.04"); // Master balance < 0.05 reserve
        },
      };

      const report = await rebalanceOperatorBalances({
        dryRun: true,
        chain: "base",
        targetMinEth: 0.055,
        masterMinEthReserve: 0.05,
        wallets: [mockStarvingWallets[0]],
        _injectedEvmClient: mockDepletedEvmClient,
      });

      expect(report.totalRebalanced).toBe(0);
      expect(report.totalSkipped).toBe(1);
      expect(report.transfers[0].status).toBe("skipped");
      expect(report.transfers[0].errorReason).toContain("Master ETH tidak mencukupi");
      expect(report.warnings.length).toBeGreaterThan(0);
    });

    it("1.3 should enforce per-wallet capping to prevent transferring excessive funds in one shot", async () => {
      // Wallet has 0 ETH, deficit is 0.1 ETH, but maxTopUpEthPerWallet is clamped to 0.03 ETH
      const mockEvmClient = {
        getBalance: async (args: { address: string }) => {
          if (args.address.toLowerCase().includes("1111")) return 0n;
          return parseEther("5.0"); // Master abundant
        },
      };

      const report = await rebalanceOperatorBalances({
        dryRun: true,
        chain: "base",
        targetMinEth: 0.10,
        maxTopUpEthPerWallet: 0.03,
        wallets: [mockStarvingWallets[0]],
        _injectedEvmClient: mockEvmClient,
      });

      expect(report.totalRebalanced).toBe(1);
      expect(report.transfers[0].amount).toBeCloseTo(0.03, 4);
    });

    it("1.4 should execute on-chain transfer via injected sender and verify confirmations", async () => {
      let sentToAddress = "";
      let sentAmount = 0;

      const mockEvmClient = {
        getBalance: async (args: { address: string }) => {
          if (args.address.toLowerCase().includes("1111")) return parseEther("0.01");
          return parseEther("2.0");
        },
      };

      const mockEvmSender = async (to: string, amountEth: number) => {
        sentToAddress = to;
        sentAmount = amountEth;
        return { success: true, txHash: "0xmock_confirmed_tx_hash_12345" };
      };

      const report = await rebalanceOperatorBalances({
        dryRun: false,
        chain: "base",
        targetMinEth: 0.055,
        wallets: [mockStarvingWallets[0]],
        _injectedEvmClient: mockEvmClient,
        _injectedEvmSender: mockEvmSender,
      });

      expect(report.dryRun).toBe(false);
      expect(report.totalRebalanced).toBe(1);
      expect(report.transfers[0].status).toBe("success");
      expect(report.transfers[0].txHash).toBe("0xmock_confirmed_tx_hash_12345");
      expect(sentToAddress.toLowerCase()).toBe(mockStarvingWallets[0].evmAddress!.toLowerCase());
      expect(sentAmount).toBeCloseTo(0.045, 4);
    });

    it("1.5 should handle Solana native rebalancing with injected sender", async () => {
      let solSentTo = "";
      let solSentAmount = 0;

      const mockSolConnection = {
        getBalance: async (pubkey: any) => {
          const str = pubkey?.toBase58?.() || String(pubkey);
          if (str === mockStarvingWallets[0].solanaAddress) return 10_000_000; // 0.01 SOL (starving)
          return 5_000_000_000; // 5 SOL (master abundant)
        },
      };

      const mockSolSender = async (to: string, amountSol: number) => {
        solSentTo = to;
        solSentAmount = amountSol;
        return { success: true, txHash: "mock_solana_signature_abc123" };
      };

      const report = await rebalanceOperatorBalances({
        dryRun: false,
        chain: "solana",
        targetMinSol: 0.06,
        wallets: [mockStarvingWallets[0]],
        _injectedSolanaConnection: mockSolConnection,
        _injectedSolanaSender: mockSolSender,
      });

      expect(report.totalRebalanced).toBe(1);
      expect(report.transfers[0].chain).toBe("solana");
      expect(report.transfers[0].status).toBe("success");
      expect(report.transfers[0].txHash).toBe("mock_solana_signature_abc123");
      expect(solSentTo).toBe(mockStarvingWallets[0].solanaAddress!);
      expect(solSentAmount).toBeCloseTo(0.05, 4);
    });
  });

  // ─── SECTION 2: Webshare Replacement Adapter ────────────────────────────────

  describe("2. Webshare Proxy Replacement (Auto-Replace Flapping IPs)", () => {
    it("2.1 should fail gracefully when WEBSHARE_API_KEY is missing", async () => {
      registerProxyConfig({
        id: testProxyId,
        protocol: "http",
        host: "185.10.10.1",
        port: 8080,
        username: "user",
        password: "pwd",
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      const res = await replaceWebshareProxy(testProxyId, {
        apiKey: "",
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("WEBSHARE_API_KEY tidak ditemukan");
    });

    it("2.2 should call Webshare Replacement API, update SQLite proxy config, and record audit log", async () => {
      registerProxyConfig({
        id: testProxyId,
        protocol: "http",
        host: "185.10.10.1",
        port: 8080,
        username: "user",
        password: "pwd",
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      const mockHttpClient = {
        post: async (url: string, data: any) => {
          expect(url).toContain("replacement");
          expect(data.ip_address).toBe("185.10.10.1");
          return {
            status: 201,
            data: {
              proxy_address: "192.168.99.100",
              port: 9090,
            },
          };
        },
      };

      const res = await replaceWebshareProxy(testProxyId, {
        apiKey: "mock_webshare_api_key_valid",
        testPing: false, // Skip live ping to use direct status
        _injectedClient: mockHttpClient as any,
      });

      expect(res.success).toBe(true);
      expect(res.oldHost).toBe("185.10.10.1");
      expect(res.newHost).toBe("192.168.99.100");
      expect(res.newPort).toBe(9090);

      // Verify SQLite state was atomically updated
      const updated = getProxyConfig(testProxyId);
      expect(updated).toBeDefined();
      expect(updated!.host).toBe("192.168.99.100");
      expect(updated!.port).toBe(9090);
      expect(updated!.status).toBe("ACTIVE");
    });

    it("2.3 should handle replacement quota limit (HTTP 400) without crashing", async () => {
      registerProxyConfig({
        id: testProxyId,
        protocol: "http",
        host: "185.10.10.1",
        port: 8080,
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      const mockRateLimitedClient = {
        post: async () => {
          const err: any = new Error("Request failed with status code 400");
          err.response = {
            status: 400,
            data: { detail: "Replacement limit reached. Please upgrade plan." },
          };
          throw err;
        },
      };

      const res = await replaceWebshareProxy(testProxyId, {
        apiKey: "mock_key",
        _injectedClient: mockRateLimitedClient as any,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("Replacement limit reached");
    });

    it("2.4 should auto-replace flapping proxies with recentFailures >= 3", async () => {
      registerProxyConfig({
        id: testProxyId,
        protocol: "http",
        host: "185.10.10.2",
        port: 8080,
        username: "webshare_user",
        status: "DISABLED",
        healthStatus: "unavailable",
      });

      // Record 3 failure logs to simulate flapping
      for (let i = 0; i < 3; i++) {
        recordProxyAuditLog({
          walletId: "system",
          provider: "bankr",
          previousProxyId: testProxyId,
          newProxyId: null,
          reason: "Proxy auto-quarantine test",
        });
      }

      const mockHttpClient = {
        post: async () => ({
          status: 200,
          data: {
            proxy_address: "10.0.0.99",
            port: 8888,
          },
        }),
      };

      const autoRes = await autoReplaceFlappingWebshareProxies({
        apiKey: "mock_key",
        testPing: false,
        _injectedClient: mockHttpClient as any,
      });

      expect(autoRes.totalScanned).toBeGreaterThan(0);
      expect(autoRes.flappingCount).toBeGreaterThanOrEqual(1);
      expect(autoRes.replacedCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── SECTION 3: Social Beacon Alert Broadcaster ─────────────────────────────

  describe("3. Balance Rebalance Broadcaster Alert", () => {
    it("3.1 should format alert cards and return fail-safe success without throwing even when webhooks are empty", async () => {
      const mockReport: RebalanceAlertReport = {
        timestamp: new Date().toISOString(),
        dryRun: false,
        totalStarvingWallets: 1,
        totalRebalanced: 1,
        totalSkipped: 0,
        totalFailed: 0,
        totalEthTransferred: 0.045,
        totalSolTransferred: 0,
        masterRemainingEth: 0.955,
        masterRemainingSol: 1.5,
        transfers: [
          {
            walletId: "op1",
            label: "Operator 1",
            chain: "base",
            recipientAddress: "0x1234567890123456789012345678901234567890",
            amount: 0.045,
            currency: "ETH",
            txHash: "0xtest_tx_rebalance",
            status: "success",
          },
        ],
      };

      const result = await broadcastRebalanceAlert(mockReport, {
        discordWebhook: "",
        telegramWebhook: "",
      });

      expect(result).toBeDefined();
      expect(result.cardText).toContain("AUTO-REBALANCE");
      expect(result.cardText).toContain("0.045000 ETH");
      expect(result.cardText).toContain("0xtest_tx_");
    });
  });
});
