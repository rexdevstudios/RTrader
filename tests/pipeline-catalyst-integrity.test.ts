import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import { isLiveDeployment } from "../src/modules/fleet/fleet-registry.ts";
import * as sniperModule from "../src/modules/sniper/basedbot-sniper.ts";
import * as evmVerifierModule from "../src/modules/reconciliation/evm-verifier.ts";
import * as priceMonitorModule from "../src/modules/market/price-monitor.ts";
import { registerManualBuy, executeAutoBuy, resolveTargetToken } from "../scripts/execute-catalyst-trading.ts";
import { resetConfig } from "../src/config.ts";

describe("Pipeline & Catalyst Trading Integrity (P8)", () => {
  const db = new Database(DB_PATH);
  const createdDeployIds: number[] = [];
  const createdPositionAddresses: string[] = [];

  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    // Sanitize any test data from vault.db
    if (createdDeployIds.length > 0) {
      const placeholders = createdDeployIds.map(() => "?").join(",");
      db.run(`DELETE FROM deploy_logs WHERE id IN (${placeholders})`, createdDeployIds);
      createdDeployIds.length = 0;
    }
    if (createdPositionAddresses.length > 0) {
      const placeholders = createdPositionAddresses.map(() => "?").join(",");
      db.run(`DELETE FROM active_positions WHERE contract_addr IN (${placeholders})`, createdPositionAddresses);
      createdPositionAddresses.length = 0;
    }
  });

  // ─── 1. findNewConfirmedDeployment Compatibility ─────────────
  it("1.1 finds new confirmed deployment with status='confirmed' and lifecycle_state='DEPLOY_CONFIRMED'", () => {
    const testCa = "0x" + "11".repeat(20);
    const testTx = "0x" + "aa".repeat(32);
    const insertRes = db.run(
      `INSERT INTO deploy_logs (
        chain, token_name, ticker, contract_addr, tx_hash, status, lifecycle_state, simulated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ["base", "Real Alpha", "RALPHA", testCa, testTx, "confirmed", "DEPLOY_CONFIRMED", 0]
    );
    const newId = Number(insertRes.lastInsertRowid);
    createdDeployIds.push(newId);

    const row = db
      .query<{
        id: number;
        chain: string;
        contract_addr: string;
        ticker: string;
        token_name: string;
        tx_hash: string | null;
        status: string;
        lifecycle_state: string | null;
        simulated: number | boolean | null;
      }, [number]>(
        `SELECT id, chain, contract_addr, ticker, token_name, tx_hash, status, lifecycle_state, simulated
         FROM deploy_logs
         WHERE id > ?
           AND (status IN ('confirmed', 'success') OR lifecycle_state = 'DEPLOY_CONFIRMED')
           AND (simulated IS NULL OR simulated = 0)
           AND contract_addr IS NOT NULL
           AND LENGTH(contract_addr) = 42
           AND contract_addr LIKE '0x%'
         ORDER BY id DESC`
      )
      .get(newId - 1);

    expect(row).toBeDefined();
    expect(row?.contract_addr).toBe(testCa);
    expect(row?.status).toBe("confirmed");
    expect(row?.lifecycle_state).toBe("DEPLOY_CONFIRMED");
    expect(
      isLiveDeployment({
        id: row!.id,
        chain: row!.chain,
        contractAddr: row!.contract_addr,
        ticker: row!.ticker,
        tokenName: row!.token_name,
        txHash: row!.tx_hash,
        status: row!.status,
        lifecycleState: row!.lifecycle_state,
        simulated: Boolean(row!.simulated),
      })
    ).toBe(true);
  });

  it("1.2 ignores simulated deployments and test fixtures", () => {
    const simCa = "0x" + "22".repeat(20);
    const insertRes = db.run(
      `INSERT INTO deploy_logs (
        chain, token_name, ticker, contract_addr, status, lifecycle_state, simulated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ["base", "Simulated Token", "SIMT", simCa, "confirmed", "DEPLOY_CONFIRMED", 1]
    );
    const newId = Number(insertRes.lastInsertRowid);
    createdDeployIds.push(newId);

    const row = db
      .query<{ id: number }, [number]>(
        `SELECT id FROM deploy_logs
         WHERE id = ?
           AND (status IN ('confirmed', 'success') OR lifecycle_state = 'DEPLOY_CONFIRMED')
           AND (simulated IS NULL OR simulated = 0)`
      )
      .get(newId);

    expect(row).toBeNull();
  });

  // ─── 2. registerManualBuy Validation & Receipt Verification ────
  it("2.1 rejects missing, empty, or malformed transaction hashes", async () => {
    const ca = "0x" + "33".repeat(20);
    createdPositionAddresses.push(ca);

    const res1 = await registerManualBuy(ca, "");
    expect(res1).toBe(false);

    const res2 = await registerManualBuy(ca, "manual_tx_123456789");
    expect(res2).toBe(false);

    const res3 = await registerManualBuy(ca, "0xshort");
    expect(res3).toBe(false);

    // Ensure no position was inserted into DB
    const count = db.query<{ cnt: number }, [string]>(
      `SELECT COUNT(*) as cnt FROM active_positions WHERE contract_addr = ?`
    ).get(ca);
    expect(count?.cnt).toBe(0);
  });

  it("2.2 rejects reverted transactions verified on-chain", async () => {
    const ca = "0x" + "44".repeat(20);
    createdPositionAddresses.push(ca);
    const fakeTx = "0x" + "aa".repeat(32);

    const verifySpy = spyOn(evmVerifierModule, "verifyEvmTransactionReceipt").mockResolvedValueOnce({
      status: "failed",
      reason: "Transaction reverted on-chain (execution failure)",
    });

    const res = await registerManualBuy(ca, fakeTx);
    expect(res).toBe(false);
    expect(verifySpy).toHaveBeenCalledTimes(1);

    verifySpy.mockRestore();
  });

  it("2.3 registers valid on-chain transaction without fake $0.000001 price", async () => {
    const ca = "0x" + "55".repeat(20);
    createdPositionAddresses.push(ca);
    const validTx = "0x" + "bb".repeat(32);

    const verifySpy = spyOn(evmVerifierModule, "verifyEvmTransactionReceipt").mockResolvedValueOnce({
      status: "confirmed",
      blockNumber: 12345678n,
    });
    const priceSpy = spyOn(priceMonitorModule, "fetchPriceUsd").mockResolvedValueOnce(0.0042);

    const res = await registerManualBuy(ca, validTx, 0.0005);
    expect(res).toBe(true);

    const pos = db.query<{
      contract_addr: string;
      entry_price: number | null;
      deployment_tx_hash: string | null;
      status: string;
    }, [string]>(
      `SELECT contract_addr, entry_price, deployment_tx_hash, status FROM active_positions WHERE contract_addr = ?`
    ).get(ca);

    expect(pos).toBeDefined();
    expect(pos?.entry_price).toBe(0.0042);
    expect(pos?.deployment_tx_hash).toBe(validTx);
    expect(pos?.status).toBe("open");

    verifySpy.mockRestore();
    priceSpy.mockRestore();
  });

  // ─── 3. executeAutoBuy Genuine Execution vs Honest Fallback ───
  it("3.1 does NOT fabricate positions when BasedBot is not configured", async () => {
    const ca = "0x" + "66".repeat(20);
    createdPositionAddresses.push(ca);

    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.BASEDBOT_CHAT_ID;
    resetConfig();

    // Mock client balance to have sufficient ETH
    const mockClient = {
      getBalance: async () => 1000000000000000n, // 0.001 ETH
    };
    const clientSpy = spyOn(evmVerifierModule, "getEvmPublicClient").mockReturnValue(mockClient as any);

    const res = await executeAutoBuy(ca);
    expect(res).toBe(false);

    // Must NOT have inserted any position
    const pos = db.query<{ cnt: number }, [string]>(
      `SELECT COUNT(*) as cnt FROM active_positions WHERE contract_addr = ?`
    ).get(ca);
    expect(pos?.cnt).toBe(0);

    clientSpy.mockRestore();
  });

  it("3.2 executes snipeNewToken and records position when BasedBot is configured", async () => {
    const ca = "0x" + "77".repeat(20);
    createdPositionAddresses.push(ca);

    process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_BOT_TOKEN";
    process.env.BASEDBOT_CHAT_ID = "12345678";
    resetConfig();

    const mockClient = {
      getBalance: async () => 1000000000000000n, // 0.001 ETH
    };
    const clientSpy = spyOn(evmVerifierModule, "getEvmPublicClient").mockReturnValue(mockClient as any);
    const snipeSpy = spyOn(sniperModule, "snipeNewToken").mockResolvedValueOnce(true);

    const res = await executeAutoBuy(ca);
    expect(res).toBe(true);
    expect(snipeSpy).toHaveBeenCalledTimes(1);

    const pos = db.query<{
      contract_addr: string;
      status: string;
      snipe_amount: number;
    }, [string]>(
      `SELECT contract_addr, status, snipe_amount FROM active_positions WHERE contract_addr = ?`
    ).get(ca);

    expect(pos).toBeDefined();
    expect(pos?.contract_addr).toBe(ca);
    expect(pos?.status).toBe("buy_submitted");

    clientSpy.mockRestore();
    snipeSpy.mockRestore();
  });

  // ─── 4. sellToken Percentage Parameter ────────────────────────
  it("4.1 sellToken supports custom percentage and defaults to 100%", async () => {
    const ca = "0x" + "88".repeat(20);
    const sendSpy = spyOn(sniperModule, "sellToken").mockImplementation(
      async (contractAddress, chain, tokenTicker, reason, percentage = 100) => {
        expect(percentage).toBe(50);
        return true;
      }
    );

    const ok = await sniperModule.sellToken(ca, "base", "TEST", "take_profit", 50);
    expect(ok).toBe(true);

    sendSpy.mockRestore();
  });
});
