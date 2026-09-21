import { describe, it, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "path";
import { existsSync } from "fs";
import {
  DB_PATH,
  resolveDbPath,
  logDeploy,
  getDeployLogById,
} from "../src/db/vault.ts";

describe("Test / Production Database Isolation (Phase 3 P2)", () => {
  const prodDbPath = join(process.cwd(), ".eliza", "vault.db");
  const testDbPath = join(process.cwd(), ".eliza", "test_vault.db");

  beforeAll(() => {
    delete process.env.VAULT_DB_PATH;
  });

  it("1. resolveDbPath should point to test_vault.db during test execution", () => {
    expect(process.env.NODE_ENV).toBe("test");
    const path = resolveDbPath();
    expect(path).toBe(testDbPath);
  });

  it("2. DB_PATH module constant must resolve to test_vault.db, not production vault.db", () => {
    expect(DB_PATH).toBe(testDbPath);
    expect(DB_PATH).not.toBe(prodDbPath);
  });

  it("3. resolveDbPath should respect VAULT_DB_PATH override", () => {
    const orig = process.env.VAULT_DB_PATH;
    try {
      process.env.VAULT_DB_PATH = ".eliza/custom_temp.db";
      expect(resolveDbPath()).toBe(join(process.cwd(), ".eliza", "custom_temp.db"));
    } finally {
      if (orig) {
        process.env.VAULT_DB_PATH = orig;
      } else {
        delete process.env.VAULT_DB_PATH;
      }
    }
  });

  it("4. logDeploy during test must write ONLY to test database and leave production vault.db untouched", () => {
    // Check if production vault.db exists
    if (!existsSync(prodDbPath)) {
      return; // If no prod db in this environment, skip check
    }

    const prodDb = new Database(prodDbPath);
    const countBefore = (prodDb.query("SELECT COUNT(*) as count FROM deploy_logs").get() as { count: number }).count;
    prodDb.close();

    // Perform a test insert via vault.ts
    const testId = logDeploy({
      chain: "base",
      tokenName: "Isolation Verification Token",
      ticker: "ISOLATION",
      contractAddr: "0x" + "9".repeat(40),
      status: "success",
      simulated: true,
    });

    expect(testId).toBeGreaterThan(0);

    // Verify the record is in test_vault.db
    const retrieved = getDeployLogById(testId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.ticker).toBe("ISOLATION");

    // CRITICAL ASSERTION: Production database row count must remain 100% IDENTICAL
    const prodDbAfter = new Database(prodDbPath);
    const countAfter = (prodDbAfter.query("SELECT COUNT(*) as count FROM deploy_logs").get() as { count: number }).count;
    prodDbAfter.close();

    expect(countAfter).toBe(countBefore);
  });
});
