import { describe, it, expect, beforeAll } from "bun:test";
import { auditCleanFunding } from "../scripts/audit-clean-funding.ts";
import {
  checkUrlHealth,
  queryGeckoTerminalProfile,
  queryDexScreenerProfile,
} from "../scripts/verify-token-profiling.ts";
import { runGeckoTerminalTicketHelper } from "../scripts/submit-geckoterminal-ticket.ts";
import { bootstrapDefaultWallet, registerWalletAccount, getWalletAccount } from "../src/modules/identity/wallet-manager.ts";

describe("Clean Funding & Token Profiling Suite", () => {
  beforeAll(() => {
    bootstrapDefaultWallet();
    if (!getWalletAccount("test-sub-1")) {
      try {
        registerWalletAccount({
          id: "test-sub-1",
          label: "Test Sub-Wallet #1",
          evmAddress: "0x1111111111111111111111111111111111111111",
          status: "ACTIVE",
        });
      } catch {}
    }
  });

  const mockEvmClient = {
    getBalance: async ({ address }: { address: string }) => {
      return address.toLowerCase() === "0x946657d17c7e83052d50634d9da6ff3fc46b418a"
        ? 448380000000000n
        : 0n;
    },
  };

  describe("1. auditCleanFunding", () => {
    it("should return a valid structured audit summary for registered wallets", async () => {
      const summary = await auditCleanFunding(0.0002, mockEvmClient);

      expect(summary).toBeDefined();
      expect(summary.totalWalletsScanned).toBeGreaterThanOrEqual(1);
      expect(summary.devWalletsCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(summary.items)).toBe(true);

      for (const item of summary.items) {
        expect(item.id).toBeDefined();
        expect(item.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(typeof item.balanceEth).toBe("number");
        expect(typeof item.isDev).toBe("boolean");
        expect(item.cluster).toBeDefined();
        expect(typeof item.isReadyForLive).toBe("boolean");
      }
    });

    it("should classify dev operator wallet as isDev = true with cluster warning", async () => {
      const summary = await auditCleanFunding(0.0002, mockEvmClient);
      const devItem = summary.items.find((i) => i.id === "default-operator");

      expect(devItem).toBeDefined();
      expect(devItem!.isDev).toBe(true);
      expect(devItem!.cluster.isClustered).toBe(true);
      expect(devItem!.cluster.warning).toContain("CLUSTER WARNING");
    });

    it("should classify sub-wallets as isDev = false and bebas cluster", async () => {
      const summary = await auditCleanFunding(0.0002, mockEvmClient);
      const subItems = summary.items.filter((i) => !i.isDev);

      expect(subItems.length).toBeGreaterThanOrEqual(1);
      for (const sub of subItems) {
        expect(sub.isDev).toBe(false);
        expect(sub.cluster.isClustered).toBe(false);
        expect(sub.cluster.warning).toBeUndefined();
      }
    });
  });

  describe("2. checkUrlHealth", () => {
    it("should verify online reachable URLs with HTTP 200", async () => {
      const result = await checkUrlHealth("Example Domain", "https://example.com");
      expect(result.name).toBe("Example Domain");
      expect(result.url).toBe("https://example.com");
      expect(result.status).toBe("OK");
      expect(result.httpCode).toBe(200);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("should gracefully handle unreachable or malformed domains without throwing", async () => {
      const result = await checkUrlHealth(
        "Invalid Domain",
        "https://domain-pasti-tidak-ada-123456789.invalid"
      );
      expect(result.status).toBe("UNREACHABLE");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("3. queryGeckoTerminalProfile & queryDexScreenerProfile", () => {
    it("should query GeckoTerminal API and return structured indexing status", async () => {
      const result = await queryGeckoTerminalProfile("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(typeof result.isIndexed).toBe("boolean");
      expect(typeof result.hasWebsite).toBe("boolean");
      expect(typeof result.hasTelegram).toBe("boolean");
      expect(typeof result.hasTwitter).toBe("boolean");
      expect(typeof result.infoPenaltyResolved).toBe("boolean");
    });

    it("should query DexScreener API and return structured pair status", async () => {
      const result = await queryDexScreenerProfile("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
      expect(typeof result.isIndexed).toBe("boolean");
      expect(typeof result.pairCount).toBe("number");
      expect(typeof result.hasSocials).toBe("boolean");
      expect(typeof result.hasWebsite).toBe("boolean");
    });
  });

  describe("4. runGeckoTerminalTicketHelper", () => {
    it("should execute ticket helper cleanly without throwing in headless mode", async () => {
      let threw = false;
      try {
        await runGeckoTerminalTicketHelper({ openBrowser: false });
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });
  });
});
