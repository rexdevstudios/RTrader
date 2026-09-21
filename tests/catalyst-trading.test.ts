/**
 * tests/catalyst-trading.test.ts
 *
 * Test suite for Catalyst Trading, Multi-Wallet CLI Resolution, and Safe Volume Sparking.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resetConfig } from "../src/config.ts";
import {
  selectExecutionWallet,
  registerWalletAccount,
  getWalletAccount,
  bootstrapDefaultWallet,
} from "../src/modules/identity/wallet-manager.ts";
import {
  createPendingPosition,
  transitionPositionState,
  getOpenPositions,
} from "../src/db/vault.ts";

describe("Catalyst Trading & Multi-Wallet Integration Suite", () => {
  beforeEach(() => {
    resetConfig();
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.BANKR_API_KEY = "bk_usr_mock_test";
  });

  afterEach(() => {
    resetConfig();
  });

  it("1. should support multi-wallet selection with explicit wallet ID", () => {
    const testId = `test-op-${Date.now()}`;
    registerWalletAccount({
      id: testId,
      label: "Catalyst Sub-Operator",
      evmAddress: "0x1111111111111111111111111111111111111111",
      status: "ACTIVE",
    });

    const resolved = getWalletAccount(testId);
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe(testId);
    expect(resolved?.evmAddress).toBe("0x1111111111111111111111111111111111111111");
  });

  it("2. selectExecutionWallet should fallback gracefully if preferred wallet not found", () => {
    const selected = selectExecutionWallet({
      preferredWalletId: "non-existent-wallet-id",
      requiredProvider: "bankr",
      targetChains: ["base"],
    });

    expect(selected).toBeDefined();
    expect(selected.status).toBe("ACTIVE");
  });

  it("3. should create pending catalyst position and transition to open with entry price", () => {
    const mockCa = `0xcat_${Date.now()}_test`;
    const created = createPendingPosition({
      deployLogId: 0,
      chain: "base",
      contractAddr: mockCa,
      ticker: "CATALYST",
      snipeAmount: 0.00041,
      takeProfitX: 1.5,
      stopLossPct: 0.30,
    });

    expect(created).toBe(true);

    // Transition to open with entry price $0.00001
    const transitioned = transitionPositionState(mockCa, "buy_submitted", "open", {
      entryPrice: 0.00001,
    });

    expect(transitioned).toBe(true);

    const positions = getOpenPositions().filter((p) => p.contractAddr === mockCa);
    expect(positions.length).toBe(1);
    expect(positions[0].status).toBe("open");
    expect(positions[0].entryPrice).toBe(0.00001);
    expect(positions[0].takeProfitX).toBe(1.5);
    expect(positions[0].stopLossPct).toBe(0.30);
  });

  it("4. should enforce laddered exit state transition when take profit hits", () => {
    const mockCa = `0xcat_tp_${Date.now()}`;
    createPendingPosition({
      deployLogId: 0,
      chain: "base",
      contractAddr: mockCa,
      ticker: "CATT",
      snipeAmount: 0.00041,
      takeProfitX: 1.5,
      stopLossPct: 0.30,
    });

    transitionPositionState(mockCa, "buy_submitted", "open", {
      entryPrice: 0.00001,
    });

    // Exit transition to closing
    const closingTransition = transitionPositionState(mockCa, "open", "closing", {
      exitReason: "take_profit_laddered_50",
      exitPrice: 0.000015,
    });
    expect(closingTransition).toBe(true);
  });

  it("5. resolveTargetToken should dynamically resolve target token by index, address, or fallback", () => {
    const { resolveTargetToken } = require("../scripts/execute-catalyst-trading.ts");
    
    // Test index resolution
    const byIndex = resolveTargetToken("1");
    expect(byIndex).toBeDefined();
    expect(byIndex.address).toBeDefined();

    // Test explicit address resolution
    const byAddr = resolveTargetToken("0x7CE19E4F978009EB644c27946B47221b824C0bA3");
    expect(byAddr.ticker).toBe("PUMPRUN");
    expect(byAddr.address.toLowerCase()).toBe("0x7ce19e4f978009eb644c27946b47221b824c0ba3");
  });
});
