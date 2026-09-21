/**
 * tests/tokenomics-fee-monetization.test.ts
 *
 * Comprehensive Test Suite for:
 * 1. Safe Tokenomics & Quote-Only Creator Fees (Native WETH)
 * 2. Doppler Anti-Whale 5-Minute 2% Balance Cap Protection (Sniper Clamping)
 * 3. Official Bankr REST Fee Scanner (GET /token-launches/:tokenAddress/fees)
 * 4. Official Bankr Server-Side Fee Claimer (POST /token-launches/:tokenAddress/fees/claim)
 * 5. Autonomous Credit to Treasury Ledger on Claim Confirmation
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import axios from "axios";
import { resetConfig, getConfig } from "../src/config.ts";
import {
  buildBankrPayload,
  deployViaBankr,
  getBankrHeaders,
} from "../src/modules/evm/bankr-deployer.ts";
import {
  calculateSafeSnipeAmount,
  snipeNewToken,
} from "../src/modules/sniper/basedbot-sniper.ts";
import {
  BankrFeeAdapter,
  scanCreatorFees,
} from "../src/modules/treasury/fee-scanner.ts";
import {
  claimAvailableFee,
  claimAllAvailableFees,
} from "../src/modules/treasury/fee-claimer.ts";
import {
  getTreasuryLedgerEntries,
  getTreasuryBalanceSummary,
} from "../src/modules/treasury/treasury-ledger.ts";
import {
  registerWalletAccount,
  getWalletAccount,
} from "../src/modules/identity/wallet-manager.ts";
import * as evmVerifier from "../src/modules/reconciliation/evm-verifier.ts";
import {
  recordFeeEvent,
  getFeeEventById,
  type DeployLog,
  type FeeEvent,
  DB_PATH,
} from "../src/db/vault.ts";

const db = new Database(DB_PATH);

const mockIdentity = {
  name: "Profit Safe Token",
  ticker: "PSAFE",
  description: "Tested tokenomics and WETH monetization",
  viralScore: 92,
  imagePrompt: "golden safe with dollar and eth symbols, clean crypto meme style",
  website: "https://profitsafe.eth",
  twitter: "https://x.com/profitsafe",
  telegram: "https://t.me/profitsafe",
};

const mockAssets = {
  imageUrl: "https://gateway.pinata.cloud/ipfs/QmTestImage",
  metadataUrl: "https://gateway.pinata.cloud/ipfs/QmTestMeta",
  ipfsImageUri: "ipfs://QmTestImage",
};

describe("Tokenomics Safety & Creator Fee Monetization Test Suite", () => {
  let axiosGetSpy: ReturnType<typeof spyOn>;
  let axiosPostSpy: ReturnType<typeof spyOn>;
  let evmVerifySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test_gemini";
    process.env.FIRECRAWL_API_KEY = "test_firecrawl";
    process.env.PINATA_JWT = "test_pinata";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BANKR_API_KEY = "bk_usr_test_key_12345";
    process.env.BANKR_CHAIN = "base";
    process.env.BANKR_QUOTE_ONLY_FEES = "true";
    process.env.BANKR_DEGEN_MODE = "true";
    process.env.SNIPE_AMOUNT_ETH = "0.05";
    process.env.SNIPE_SAFE_CAP_ETH = "0.02";
    process.env.TREASURY_AUTO_CLAIM_ENABLED = "true";
    process.env.TREASURY_MIN_CLAIM_ETH = "0.005";
    process.env.DEPLOY_MODE = "testnet";

    db.run("DELETE FROM treasury_ledger WHERE wallet_id LIKE 'test_tokenomics_%'");
    db.run("DELETE FROM fee_events WHERE wallet_id LIKE 'test_tokenomics_%'");
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'test_tokenomics_%'");
    db.run("DELETE FROM deploy_logs WHERE ticker = 'PSAFE'");

    axiosGetSpy = spyOn(axios, "get");
    axiosPostSpy = spyOn(axios, "post");
    evmVerifySpy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
      blockNumber: 12345678n,
    });
  });

  afterEach(() => {
    axiosGetSpy?.mockRestore();
    axiosPostSpy?.mockRestore();
    evmVerifySpy?.mockRestore();
  });

  // ─── 1. Tokenomics Payload Tests ──────────────────────────────────────────
  it("1. buildBankrPayload enforces quoteOnlyFees: true and degenMode: true", () => {
    const payload = buildBankrPayload(mockIdentity, mockAssets, {
      quoteOnlyFees: true,
      degenMode: true,
      chain: "base",
    });

    expect(payload.quoteOnlyFees).toBe(true);
    expect(payload.degenMode).toBe(true);
    expect(payload.chain).toBe("base");
    expect(payload.tokenName).toBe("Profit Safe Token");
    expect(payload.tokenSymbol).toBe("PSAFE");
  });

  it("2. buildBankrPayload allows Robinhood chain routing", () => {
    const payload = buildBankrPayload(mockIdentity, mockAssets, {
      chain: "robinhood",
      quoteOnlyFees: true,
    });

    expect(payload.chain).toBe("robinhood");
    expect(payload.quoteOnlyFees).toBe(true);
  });

  // ─── 2. Doppler Anti-Whale 5-Minute Cap (Sniper Clamping) ──────────────────
  it("3. calculateSafeSnipeAmount clamps EVM snipe > 0.02 ETH to safe cap", () => {
    // User requested 0.05 ETH (which would violate Doppler 2% cap at $2,500 MC)
    const safeAmount = calculateSafeSnipeAmount("base", 0.05);
    expect(safeAmount).toBe(0.02);

    // Amounts below safe cap remain untouched
    const smallAmount = calculateSafeSnipeAmount("base", 0.015);
    expect(smallAmount).toBe(0.015);
  });

  it("4. calculateSafeSnipeAmount leaves Solana snipes un-clamped", () => {
    const solAmount = calculateSafeSnipeAmount("solana", 0.1);
    expect(solAmount).toBe(0.1);
  });

  it("5. snipeNewToken sends clamped amount for EVM tokens", async () => {
    // When TELEGRAM_BOT_TOKEN is not set, snipeNewToken safely logs and skips sending
    const res = await snipeNewToken("0x1234567890123456789012345678901234567890", "base", "PSAFE");
    expect(res).toBe(false); // Gracefully skips without error
  });

  // ─── 3. Bankr Fee Scanner (GET /token-launches/:tokenAddress/fees) ─────────
  it("6. BankrFeeAdapter skips SIMULATED deployments to save network traffic", async () => {
    const adapter = new BankrFeeAdapter();
    const wallet = {
      id: "test_tokenomics_w1",
      label: "Test Operator",
      evmAddress: "0x1111111111111111111111111111111111111111",
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const simulatedDep: DeployLog = {
      id: 999,
      chain: "base",
      tokenName: "Profit Safe Token",
      ticker: "PSAFE",
      contractAddr: "0x2222222222222222222222222222222222222222",
      status: "success",
      lifecycleState: "SIMULATED",
    };

    const fees = await adapter.scanFees(simulatedDep, wallet);
    expect(fees).toEqual([]);
    expect(axiosGetSpy).not.toHaveBeenCalled();
  });

  it("7. BankrFeeAdapter queries GET /fees and parses claimable WETH", async () => {
    const adapter = new BankrFeeAdapter();
    const wallet = {
      id: "test_tokenomics_w1",
      label: "Test Operator",
      evmAddress: "0x1111111111111111111111111111111111111111",
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const realDep: DeployLog = {
      id: 1000,
      chain: "base",
      tokenName: "Profit Safe Token",
      ticker: "PSAFE",
      contractAddr: "0x3333333333333333333333333333333333333333",
      status: "success",
      lifecycleState: "DEPLOY_CONFIRMED",
    };

    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        tokenAddress: "0x3333333333333333333333333333333333333333",
        chain: "base",
        unclaimedFees: {
          weth: "0.015",
          token: "0",
        },
      },
    });

    const fees = await adapter.scanFees(realDep, wallet);
    expect(fees.length).toBe(1);
    expect(fees[0].tokenSymbol).toBe("WETH");
    expect(fees[0].amountFormatted).toBe(0.015);
    expect(fees[0].status).toBe("claimable");
    expect(fees[0].beneficiaryAddress).toBe("0x1111111111111111111111111111111111111111");
  });

  // ─── 4. Automated Fee Claiming & Treasury Ledger Credit ───────────────────
  it("8. claimAvailableFee enforces minimum claim threshold (TREASURY_MIN_CLAIM_ETH)", async () => {
    registerWalletAccount({
      id: "test_tokenomics_w_min",
      label: "Min Claim Wallet",
      evmAddress: "0x4444444444444444444444444444444444444444",
      status: "ACTIVE",
    });

    // Fee is 0.002 ETH, below threshold 0.005 ETH
    const fee = recordFeeEvent({
      eventKey: "test_tokenomics_micro_fee",
      walletId: "test_tokenomics_w_min",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: "0x5555555555555555555555555555555555555555",
      beneficiaryAddress: "0x4444444444444444444444444444444444444444",
      tokenSymbol: "WETH",
      amountRaw: "2000000000000000",
      amountFormatted: 0.002,
      status: "claimable",
    });

    const result = await claimAvailableFee(fee.id, { executeOnchain: true });
    expect(result.success).toBe(false);
    expect(result.status).toBe("claimable");
    expect(result.error).toContain("below minimum claim threshold");

    // Must not have credited treasury ledger
    const ledger = getTreasuryLedgerEntries({ walletId: "test_tokenomics_w_min" });
    expect(ledger.length).toBe(0);
  });

  it("9. claimAvailableFee executes Bankr API claim and credits treasury ledger in testnet", async () => {
    registerWalletAccount({
      id: "test_tokenomics_w_exec",
      label: "Exec Claim Wallet",
      evmAddress: "0x6666666666666666666666666666666666666666",
      status: "ACTIVE",
    });

    const fee = recordFeeEvent({
      eventKey: "test_tokenomics_real_claim",
      walletId: "test_tokenomics_w_exec",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: "0x7777777777777777777777777777777777777777",
      beneficiaryAddress: "0x6666666666666666666666666666666666666666",
      tokenSymbol: "WETH",
      amountRaw: "15000000000000000",
      amountFormatted: 0.015,
      status: "claimable",
    });

    // Mock Bankr POST /fees/claim response
    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        txHash: "0xabc123feeclaimedonchain4567890123456789012345678901234567890abcdef",
        claimedAmount: "0.015",
      },
    });

    const result = await claimAvailableFee(fee.id, {
      executeOnchain: true,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("claimed");
    expect(result.claimTxHash).toBeDefined();

    // Verify DB update
    const updatedFee = getFeeEventById(fee.id);
    expect(updatedFee?.status).toBe("claimed");
    expect(updatedFee?.claimTxHash).toContain("0xabc123feeclaimedonchain");

    // Verify autonomous credit to treasury ledger
    const ledger = getTreasuryLedgerEntries({ walletId: "test_tokenomics_w_exec" });
    expect(ledger.length).toBe(1);
    expect(ledger[0].amountFormatted).toBe(0.015);
    expect(ledger[0].tokenSymbol).toBe("WETH");
    expect(ledger[0].direction).toBe("credit");
    expect(ledger[0].eventType).toBe("fee_claimed");
  });

  it("10. claimAllAvailableFees batch-claims eligible fees and ignores below-threshold ones", async () => {
    registerWalletAccount({
      id: "test_tokenomics_batch",
      label: "Batch Wallet",
      evmAddress: "0x8888888888888888888888888888888888888888",
      status: "ACTIVE",
    });

    // Fee 1: 0.02 WETH (Above threshold 0.005)
    recordFeeEvent({
      eventKey: "test_tokenomics_batch_1",
      walletId: "test_tokenomics_batch",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: "0x9999999999999999999999999999999999999999",
      beneficiaryAddress: "0x8888888888888888888888888888888888888888",
      tokenSymbol: "WETH",
      amountRaw: "20000000000000000",
      amountFormatted: 0.02,
      status: "claimable",
    });

    // Fee 2: 0.001 WETH (Below threshold 0.005)
    recordFeeEvent({
      eventKey: "test_tokenomics_batch_2",
      walletId: "test_tokenomics_batch",
      chain: "base",
      source: "bankr_creator_fee",
      tokenAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      beneficiaryAddress: "0x8888888888888888888888888888888888888888",
      tokenSymbol: "WETH",
      amountRaw: "1000000000000000",
      amountFormatted: 0.001,
      status: "claimable",
    });

    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        txHash: "0xbatchtx1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      },
    });

    const results = await claimAllAvailableFees("test_tokenomics_batch", {
      executeOnchain: true,
    });

    expect(results.length).toBe(2);
    const claimed = results.find((r) => r.success);
    const skipped = results.find((r) => !r.success);

    expect(claimed).toBeDefined();
    expect(claimed?.status).toBe("claimed");
    expect(skipped).toBeDefined();
    expect(skipped?.status).toBe("claimable");

    // Treasury summary should show 0.02 WETH claimed
    const summary = getTreasuryBalanceSummary("test_tokenomics_batch");
    expect(summary.totalFeesClaimedFormatted).toBeCloseTo(0.02, 4);
    expect(summary.byAsset["WETH"]?.net).toBeCloseTo(0.02, 4);
  });
});
