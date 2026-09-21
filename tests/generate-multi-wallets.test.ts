import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateMultiWallets } from "../scripts/generate-multi-wallets.ts";

describe("Multi-Wallet Generator Suite", () => {
  const testOutputDir = path.join(process.cwd(), "wallets", "test-run");

  afterAll(() => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  it("should generate specified number of EVM wallets with valid format", () => {
    const result = generateMultiWallets("evm", 3, testOutputDir, "Test-EVM");

    expect(result.count).toBe(3);
    expect(result.chain).toBe("evm");
    expect(result.wallets.length).toBe(3);

    for (const w of result.wallets) {
      expect(w.evmAddress).toBeDefined();
      expect(w.evmAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(w.evmPrivateKey).toBeDefined();
      expect(w.evmPrivateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(w.solanaAddress).toBeUndefined();
    }

    expect(fs.existsSync(result.jsonPath)).toBe(true);
    expect(fs.existsSync(result.csvPath)).toBe(true);

    const jsonContent = JSON.parse(fs.readFileSync(result.jsonPath, "utf-8"));
    expect(jsonContent.totalWallets).toBe(3);
    expect(jsonContent.chainType).toBe("evm");

    const csvContent = fs.readFileSync(result.csvPath, "utf-8");
    expect(csvContent).toContain("Index,Label,Chain,EVM_Address,EVM_PrivateKey,CreatedAt");
    expect(csvContent.split("\n").filter(Boolean).length).toBe(4); // 1 header + 3 rows
  });

  it("should generate specified number of Solana wallets with valid format", () => {
    const result = generateMultiWallets("solana", 2, testOutputDir, "Test-Solana");

    expect(result.count).toBe(2);
    expect(result.chain).toBe("solana");
    expect(result.wallets.length).toBe(2);

    for (const w of result.wallets) {
      expect(w.solanaAddress).toBeDefined();
      expect(w.solanaAddress!.length).toBeGreaterThanOrEqual(32);
      expect(w.solanaPrivateKey).toBeDefined();
      expect(w.evmAddress).toBeUndefined();
    }

    expect(fs.existsSync(result.jsonPath)).toBe(true);
    expect(fs.existsSync(result.csvPath)).toBe(true);

    const jsonContent = JSON.parse(fs.readFileSync(result.jsonPath, "utf-8"));
    expect(jsonContent.totalWallets).toBe(2);
    expect(jsonContent.chainType).toBe("solana");
  });

  it("should generate dual-chain pairs (1 EVM + 1 Solana per account)", () => {
    const result = generateMultiWallets("dual", 2, testOutputDir, "Test-Dual");

    expect(result.count).toBe(2);
    expect(result.chain).toBe("dual");

    for (const w of result.wallets) {
      expect(w.evmAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(w.evmPrivateKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(w.solanaAddress).toBeDefined();
      expect(w.solanaPrivateKey).toBeDefined();
    }

    const csvContent = fs.readFileSync(result.csvPath, "utf-8");
    expect(csvContent).toContain("EVM_Address,EVM_PrivateKey,Solana_Address,Solana_PrivateKey");
  });

  it("should reject invalid count <= 0", () => {
    expect(() => generateMultiWallets("evm", 0, testOutputDir)).toThrow();
    expect(() => generateMultiWallets("evm", -1, testOutputDir)).toThrow();
  });
});
