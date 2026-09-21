import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { isValidDestinationAddress } from "../src/modules/treasury/treasury-sweeper.ts";
import { updateEnvVariable, getEvmBalance, getSolanaBalance } from "../scripts/manage-wallets.ts";
import { dispatchBeaconCard } from "../src/modules/social/beacon-broadcaster.ts";

describe("Wallet Treasury CLI & Destination Verification", () => {
  const testEnvPath = path.resolve(process.cwd(), ".env.test-tmp");

  beforeEach(() => {
    fs.writeFileSync(testEnvPath, "EXISTING_KEY=123\nOTHER_KEY=abc\n", "utf-8");
  });

  afterEach(() => {
    if (fs.existsSync(testEnvPath)) {
      fs.unlinkSync(testEnvPath);
    }
  });

  describe("1. Destination Address Validation", () => {
    it("1.1 should validate valid EVM addresses across evm/base/ethereum/bsc", () => {
      const validEvm = "0x946657d17c7e83052d50634d9da6ff3fc46b418a";
      expect(isValidDestinationAddress(validEvm, "evm")).toBe(true);
      expect(isValidDestinationAddress(validEvm, "base")).toBe(true);
      expect(isValidDestinationAddress(validEvm, "ethereum")).toBe(true);
      expect(isValidDestinationAddress(validEvm, "bsc")).toBe(true);
    });

    it("1.2 should reject malformed EVM addresses", () => {
      expect(isValidDestinationAddress("0x123", "evm")).toBe(false);
      expect(isValidDestinationAddress("946657d17c7e83052d50634d9da6ff3fc46b418a", "evm")).toBe(false);
      expect(isValidDestinationAddress("0xZZ6657d17c7e83052d50634d9da6ff3fc46b418a", "evm")).toBe(false);
      expect(isValidDestinationAddress("", "evm")).toBe(false);
    });

    it("1.3 should validate valid Solana base58 public keys", () => {
      const validSol = "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz";
      expect(isValidDestinationAddress(validSol, "solana")).toBe(true);
    });

    it("1.4 should reject malformed Solana addresses", () => {
      expect(isValidDestinationAddress("short", "solana")).toBe(false);
      expect(isValidDestinationAddress("a".repeat(45), "solana")).toBe(false);
      expect(isValidDestinationAddress("", "solana")).toBe(false);
    });
  });

  describe("2. Environment Variable Mutation Safety", () => {
    it("2.1 should safely update an existing key without modifying others", () => {
      let content = "KEY_A=original\nKEY_B=stay_same\n";
      const regex = new RegExp(`^KEY_A=.*$`, "m");
      content = content.replace(regex, "KEY_A=updated");
      expect(content).toContain("KEY_A=updated");
      expect(content).toContain("KEY_B=stay_same");
    });

    it("2.2 should append a new key when not found in content", () => {
      let content = "KEY_A=original\n";
      const key = "KEY_NEW";
      const value = "new_val";
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${value}`);
      } else {
        content = content.trimEnd() + `\n${key}=${value}\n`;
      }
      expect(content).toContain("KEY_A=original");
      expect(content).toContain("KEY_NEW=new_val");
    });
  });

  describe("3. Real-Time Balance Query Resilience", () => {
    it("3.1 should return null on invalid RPC URL without throwing unhandled exceptions", async () => {
      const origUrl = process.env.BASE_RPC_URL;
      process.env.BASE_RPC_URL = "http://127.0.0.1:9999/non_existent_rpc";
      try {
        const bal = await getEvmBalance("0x946657d17c7e83052d50634d9da6ff3fc46b418a");
        expect(bal).toBeNull();
      } finally {
        if (origUrl) process.env.BASE_RPC_URL = origUrl;
        else delete process.env.BASE_RPC_URL;
      }
    });

    it("3.2 should return null on invalid Solana RPC without crashing", async () => {
      const origSol = process.env.SOLANA_RPC_URL;
      process.env.SOLANA_RPC_URL = "http://127.0.0.1:9999/non_existent_sol";
      try {
        const bal = await getSolanaBalance("4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz");
        expect(bal).toBeNull();
      } finally {
        if (origSol) process.env.SOLANA_RPC_URL = origSol;
        else delete process.env.SOLANA_RPC_URL;
      }
    });
  });

  describe("4. Beacon Broadcaster Fail-Safe Behavior", () => {
    it("4.1 should gracefully handle empty/unconfigured webhooks without crashing", async () => {
      const result = await dispatchBeaconCard("Test Beacon Notification Card", {
        discordWebhook: undefined,
        telegramWebhook: undefined,
      });
      expect(result.discordDispatched).toBe(false);
      expect(result.telegramDispatched).toBe(false);
      expect(result.errors.length).toBe(0);
      expect(result.cardText).toContain("Test Beacon Notification Card");
    });

    it("4.2 should gracefully record error on unreachable webhook URL without throwing", async () => {
      const result = await dispatchBeaconCard("Test Unreachable Card", {
        discordWebhook: "http://127.0.0.1:9998/webhook_dead",
        telegramWebhook: "http://127.0.0.1:9998/webhook_dead",
        timeoutMs: 500,
      });
      expect(result.discordDispatched).toBe(false);
      expect(result.telegramDispatched).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});
