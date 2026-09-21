import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios from "axios";
import {
  buildBankrPayload,
  deployViaBankr,
  fetchBankrBalances,
  fetchClaimableFees,
  fetchTokenFees,
  fetchCreatorFees,
  BANKR_DEPLOY_URL,
} from "../src/modules/evm/bankr-deployer.ts";
import { claimAvailableFee } from "../src/modules/treasury/fee-claimer.ts";
import { BankrFeeAdapter } from "../src/modules/treasury/fee-scanner.ts";
import { recordFeeEvent, getFeeEventById, type FeeEventInput } from "../src/db/vault.ts";
import { bootstrapDefaultWallet } from "../src/modules/identity/wallet-manager.ts";
import * as evmVerifier from "../src/modules/reconciliation/evm-verifier.ts";
import { resetConfig } from "../src/config.ts";

const mockIdentity = {
  name: "Test Compliance Token",
  ticker: "TCOMP",
  description: "Bankr docs compliance test token",
  viralScore: 92,
  imagePrompt: "test",
  website: "https://compliance.test",
  twitter: "https://x.com/compliance",
};

const mockAssets = {
  imageUrl: "https://img.test/logo.png",
  metadataUrl: "https://ipfs.test/meta.json",
  ipfsImageUri: "ipfs://test",
};

describe("Bankr Documentation Compliance (docs.bankr.bot)", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;
  let axiosGetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
    process.env.FIRECRAWL_API_KEY = "test";
    process.env.PINATA_JWT = "test";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BANKR_API_KEY = "bk_usr_test_compliance_key";
    process.env.DEPLOY_MODE = "testnet";

    bootstrapDefaultWallet();
    axiosPostSpy = spyOn(axios, "post");
    axiosGetSpy = spyOn(axios, "get");
  });

  afterEach(() => {
    axiosPostSpy?.mockRestore();
    axiosGetSpy?.mockRestore();
  });

  // 1. Chain Support Compliance (Base, Robinhood, Arbitrum)
  it("1.1 should construct valid payload for Arbitrum chain according to docs", () => {
    const payload = buildBankrPayload(mockIdentity, mockAssets, { chain: "arbitrum" });
    expect(payload.chain).toBe("arbitrum");
    expect(payload.tokenName).toBe("Test Compliance Token");
    expect(payload.tokenSymbol).toBe("TCOMP");
  });

  it("1.2 should construct valid payload for Base and Robinhood chains", () => {
    const payloadBase = buildBankrPayload(mockIdentity, mockAssets, { chain: "base" });
    expect(payloadBase.chain).toBe("base");

    const payloadRobinhood = buildBankrPayload(mockIdentity, mockAssets, { chain: "robinhood" });
    expect(payloadRobinhood.chain).toBe("robinhood");
  });

  it("1.3 should construct valid payload for Arc chain according to Bankr UI", () => {
    const payloadArc = buildBankrPayload(mockIdentity, mockAssets, { chain: "arc" });
    expect(payloadArc.chain).toBe("arc");
    expect(payloadArc.tokenName).toBe("Test Compliance Token");
    expect(payloadArc.tokenSymbol).toBe("TCOMP");
  });

  // 2. Base Quote Tokens Compliance
  it("2.1 should support all 5 official Base quote tokens in pairedTokenAddress", () => {
    const quoteTokens = [
      "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b", // BNKR
      "0x5577a294ae5a21446a11b0e4100ca83803995720", // ba3Pump
      "0xB200000000000000000000451d033a5000cb479e", // cbHYPE
      "0xB2000000000000000000008501b13360000cb2EC", // cbZEC
      "0xf3081494b87e8d5fb7960f066e931d1d0e6e3d67", // TAO
    ];

    for (const pairedTokenAddress of quoteTokens) {
      const payload = buildBankrPayload(mockIdentity, mockAssets, {
        chain: "base",
        pairedTokenAddress,
      });
      expect(payload.pairedTokenAddress).toBe(pairedTokenAddress);
    }
  });

  // 3. Dynamic Fee Recipient Routing
  it("3.1 should pass feeRecipient when configured in options", () => {
    const payload = buildBankrPayload(mockIdentity, mockAssets, {
      feeRecipient: {
        type: "wallet",
        value: "0x975064031e347669fe88a6e1630f03db93e21c1f",
      },
    });
    expect(payload.feeRecipient).toBeDefined();
    expect(payload.feeRecipient?.type).toBe("wallet");
    expect(payload.feeRecipient?.value).toBe("0x975064031e347669fe88a6e1630f03db93e21c1f");
  });

  // 4. Fetch Bankr Balances Helper
  it("4.1 should parse cross-chain balances from GET /wallet/balances", async () => {
    axiosGetSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        evmAddress: "0x1e130ec63174d4258473366b762f197560942760",
        solAddress: "7zs6iNGkyUQAfswubAv5SwBSjaH2esFiTaYhq7XNTgaY",
        balances: {
          base: {
            nativeBalance: "0.0031",
            nativeUsd: "7.75",
            total: "7.75",
          },
        },
      },
    });

    const result = await fetchBankrBalances("bk_usr_mock_key");
    expect(result.success).toBe(true);
    expect(result.evmAddress).toBe("0x1e130ec63174d4258473366b762f197560942760");
    expect(result.balances?.base?.nativeBalance).toBe("0.0031");
    expect(result.balances?.base?.nativeUsd).toBe("7.75");
  });

  // 5. Fee Claimer accepts transactionHash field (Official Bankr response shape)
  it("5.1 should accept transactionHash from Bankr fee claim response", async () => {
    const feeEvent = recordFeeEvent({
      eventKey: `compliance_test_event_${Date.now()}`,
      walletId: "default-operator",
      source: "bankr_creator_fee",
      chain: "base",
      tokenAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
      beneficiaryAddress: "0x1e130ec63174d4258473366b762f197560942760",
      tokenSymbol: "WETH",
      amountRaw: "10000000000000000",
      amountFormatted: 0.01,
      status: "claimable",
    });

    const feeId = feeEvent.id;

    axiosPostSpy.mockResolvedValueOnce({
      status: 200,
      data: {
        success: true,
        transactionHash: "0xcompliance_claim_tx_hash_1234567890abcdef1234567890abcdef12345678",
        status: "success",
        signer: "0x1e130ec63174d4258473366b762f197560942760",
      },
    });

    const evmSpy = spyOn(evmVerifier, "verifyEvmTransactionReceipt").mockResolvedValue({
      status: "confirmed",
      blockNumber: 12345678n,
    });

    const claimResult = await claimAvailableFee(feeId, { executeOnchain: true });
    expect(claimResult.success).toBe(true);
    expect(claimResult.claimTxHash).toBe("0xcompliance_claim_tx_hash_1234567890abcdef1234567890abcdef12345678");

    const updatedEvent = getFeeEventById(feeId);
    expect(updatedEvent?.status).toBe("claimed");
    expect(updatedEvent?.claimTxHash).toBe("0xcompliance_claim_tx_hash_1234567890abcdef1234567890abcdef12345678");
    evmSpy.mockRestore();
  });

  // 6. Fee Scanner Arbitrum Support
  it("6.1 should support arbitrum chain in BankrFeeAdapter", () => {
    const adapter = new BankrFeeAdapter();
    expect(adapter.supportsChain("arbitrum")).toBe(true);
    expect(adapter.supportsChain("base")).toBe(true);
    expect(adapter.supportsChain("robinhood")).toBe(true);
  });
});
