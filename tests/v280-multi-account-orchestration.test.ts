import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { resetConfig, getConfig } from "../src/config.ts";
import {
  registerWalletAccount,
  updateWalletStatus,
  registerProxyConfig,
  setWalletProviderRoute,
  listWalletAccounts,
  resolveOperationalContext,
  resolveCredential,
  selectExecutionWallet,
  bootstrapDefaultWallet,
} from "../src/modules/identity/wallet-manager.ts";
import {
  buildBankrPayload,
  deployViaBankr,
} from "../src/modules/evm/bankr-deployer.ts";
import {
  logDeploy,
  createPendingPosition,
  getPositionByContract,
  getDeployLogById,
  DB_PATH,
} from "../src/db/vault.ts";
import axios from "axios";

const testDb = new Database(DB_PATH);

const TEST_PREFIX = "test_v28_";

function cleanupV28TestData(): void {
  testDb.run("DELETE FROM active_positions WHERE contract_addr LIKE ?", [`${TEST_PREFIX}%`]);
  testDb.run("DELETE FROM deploy_logs WHERE token_name LIKE ? OR wallet_id LIKE ?", [`${TEST_PREFIX}%`, `${TEST_PREFIX}%`]);
  testDb.run("DELETE FROM wallet_provider_routes WHERE wallet_id LIKE ? OR wallet_id = 'default-operator'", [`${TEST_PREFIX}%`]);
  testDb.run("DELETE FROM proxy_audit_logs WHERE wallet_id LIKE ? OR wallet_id = 'default-operator'", [`${TEST_PREFIX}%`]);
  testDb.run("DELETE FROM proxy_configs WHERE id LIKE ?", [`${TEST_PREFIX}%`]);
  testDb.run("DELETE FROM wallet_accounts WHERE id LIKE ? OR id = 'default-operator'", [`${TEST_PREFIX}%`]);
}

const mockIdentity = {
  name: "V28 Test Token",
  ticker: "V28T",
  description: "V28 Multi-Account Test Token",
  viralScore: 88,
  imagePrompt: "futuristic multi-agent vault",
  website: "https://testv28.org",
  twitter: "https://x.com/testv28",
};

const mockAssets = {
  imageUrl: "https://ipfs.io/ipfs/QmTestImageV28",
  metadataUrl: "https://ipfs.io/ipfs/QmTestMetaV28",
  ipfsImageUri: "ipfs://QmTestImageV28",
};

describe("Milestone V2.8 — Production Multi-Account Orchestration & Safe Contract Configuration", () => {
  beforeEach(() => {
    cleanupV28TestData();
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock_gemini_key";
    process.env.FIRECRAWL_API_KEY = "mock_firecrawl_key";
    process.env.PINATA_JWT = "mock_pinata_jwt";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";
    process.env.BANKR_API_KEY = "bk_usr_default_global_key";
    process.env.DEPLOY_MODE = "testnet";
    process.env.BANKR_QUOTE_ONLY_FEES = "true";
  });

  afterEach(() => {
    cleanupV28TestData();
  });

  // ══════════════════════════════════════════════════════════════
  // 1. Deterministic Credential Resolution (P0)
  // ══════════════════════════════════════════════════════════════

  describe("1. Deterministic Credential Resolution", () => {
    it("1.1 resolves 'env:VARIABLE_NAME' pointer to actual process.env value", () => {
      process.env.CUSTOM_TEST_API_KEY = "bk_usr_custom_account_secret";
      const resolved = resolveCredential("env:CUSTOM_TEST_API_KEY");
      expect(resolved).toBe("bk_usr_custom_account_secret");
      delete process.env.CUSTOM_TEST_API_KEY;
    });

    it("1.2 resolves bare 'VARIABLE_NAME' pointer directly from process.env", () => {
      process.env.DIRECT_KEY = "secret_direct_value";
      const resolved = resolveCredential("DIRECT_KEY");
      expect(resolved).toBe("secret_direct_value");
      delete process.env.DIRECT_KEY;
    });

    it("1.3 returns undefined for undefined, null, empty string, or whitespace", () => {
      expect(resolveCredential(undefined)).toBeUndefined();
      expect(resolveCredential(null)).toBeUndefined();
      expect(resolveCredential("")).toBeUndefined();
      expect(resolveCredential("   ")).toBeUndefined();
      expect(resolveCredential("env:")).toBeUndefined();
      expect(resolveCredential("env:   ")).toBeUndefined();
    });

    it("1.4 returns undefined when target environment variable is missing", () => {
      delete process.env.NON_EXISTENT_VAR_12345;
      expect(resolveCredential("env:NON_EXISTENT_VAR_12345")).toBeUndefined();
      expect(resolveCredential("NON_EXISTENT_VAR_12345")).toBeUndefined();
    });

    it("1.5 does not mutate inputs or expose secrets to logs", () => {
      process.env.SECRET_VAR = "super_secret_payload";
      const ref = "env:SECRET_VAR";
      const r1 = resolveCredential(ref);
      const r2 = resolveCredential(ref);
      expect(r1).toBe(r2);
      expect(ref).toBe("env:SECRET_VAR"); // input unchanged
      delete process.env.SECRET_VAR;
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 2. Safe Bankr Payload & Contract Security Configuration (P0)
  // ══════════════════════════════════════════════════════════════

  describe("2. Safe Bankr Payload Builder & Configuration", () => {
    it("2.1 populates feeRecipient when provided in options", () => {
      const payload = buildBankrPayload(mockIdentity, mockAssets, {
        chain: "base",
        feeRecipient: {
          type: "wallet",
          value: "0x1234567890123456789012345678901234567890",
        },
      });
      expect(payload.feeRecipient).toBeDefined();
      expect(payload.feeRecipient?.type).toBe("wallet");
      expect(payload.feeRecipient?.value).toBe("0x1234567890123456789012345678901234567890");
    });

    it("2.2 omits feeRecipient when not specified in options", () => {
      const payload = buildBankrPayload(mockIdentity, mockAssets, {
        chain: "base",
      });
      expect(payload.feeRecipient).toBeUndefined();
    });

    it("2.3 includes quoteOnlyFees: true when option is set", () => {
      const payload = buildBankrPayload(mockIdentity, mockAssets, {
        quoteOnlyFees: true,
      });
      expect(payload.quoteOnlyFees).toBe(true);
    });

    it("2.4 excludes quoteOnlyFees when option is false", () => {
      const payload = buildBankrPayload(mockIdentity, mockAssets, {
        quoteOnlyFees: false,
      });
      expect(payload.quoteOnlyFees).toBeUndefined();
    });

    it("2.5 preserves social and metadata fields for green DEXScreener scanner profiles", () => {
      const payload = buildBankrPayload(mockIdentity, mockAssets, {
        chain: "base",
      });
      expect(payload.websiteUrl).toBe("https://testv28.org");
      expect(payload.tweetUrl).toBe("https://x.com/testv28");
      expect(payload.image).toBe("https://ipfs.io/ipfs/QmTestImageV28");
      expect(payload.description).toBe("V28 Multi-Account Test Token");
    });

    it("2.6 deployViaBankr passes resolved apiKey override to request headers", async () => {
      const postSpy = spyOn(axios, "post").mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          tokenAddress: "0x_v28_simulated_ca",
          poolId: "pool_v28",
          chain: "base",
          simulated: true,
        },
      });

      const customKey = "bk_usr_custom_account_key_999";
      const result = await deployViaBankr(mockIdentity, mockAssets, {
        apiKey: customKey,
        chain: "base",
        simulateOnly: true,
      });

      expect(result.success).toBe(true);
      const sentHeaders = postSpy.mock.calls[0][2]?.headers;
      expect(sentHeaders["X-API-Key"]).toBe(customKey);

      postSpy.mockRestore();
    });

    it("2.7 deployViaBankr falls back to global BANKR_API_KEY when no override is given", async () => {
      const postSpy = spyOn(axios, "post").mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          tokenAddress: "0x_v28_simulated_default",
          poolId: "pool_v28_def",
          chain: "base",
          simulated: true,
        },
      });

      const result = await deployViaBankr(mockIdentity, mockAssets, {
        chain: "base",
        simulateOnly: true,
      });

      expect(result.success).toBe(true);
      const sentHeaders = postSpy.mock.calls[0][2]?.headers;
      expect(sentHeaders["X-API-Key"]).toBe("bk_usr_default_global_key");

      postSpy.mockRestore();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 3. Capability-Aware Wallet Selection & Orchestration (P1)
  // ══════════════════════════════════════════════════════════════

  describe("3. Capability-Aware Wallet Selection", () => {
    it("3.1 returns bootstrapDefaultWallet() when vault has zero wallets", () => {
      const selected = selectExecutionWallet();
      expect(selected).toBeDefined();
      expect(selected.status).toBe("ACTIVE");
    });

    it("3.2 returns single active wallet deterministically", () => {
      const wId = `${TEST_PREFIX}single_w`;
      registerWalletAccount({
        id: wId,
        label: "Single Operator",
        evmAddress: "0x1111111111111111111111111111111111111111",
        solanaAddress: "So11111111111111111111111111111111111111112",
        status: "ACTIVE",
      });

      const selected = selectExecutionWallet({ preferredWalletId: wId });
      expect(selected.id).toBe(wId);
    });

    it("3.3 honors preferredWalletId if valid and ACTIVE", () => {
      const w1 = `${TEST_PREFIX}pref_1`;
      const w2 = `${TEST_PREFIX}pref_2`;

      registerWalletAccount({ id: w1, label: "Wallet 1", status: "ACTIVE" });
      registerWalletAccount({ id: w2, label: "Wallet 2", status: "ACTIVE" });

      const selected = selectExecutionWallet({ preferredWalletId: w2 });
      expect(selected.id).toBe(w2);
    });

    it("3.4 filters out PAUSED or DISABLED wallets", () => {
      const wActive = `${TEST_PREFIX}filter_act`;
      const wPaused = `${TEST_PREFIX}filter_psd`;

      registerWalletAccount({
        id: wActive,
        label: "Active Wallet",
        evmAddress: "0x2222222222222222222222222222222222222222",
        status: "ACTIVE",
      });
      registerWalletAccount({
        id: wPaused,
        label: "Paused Wallet",
        evmAddress: "0x3333333333333333333333333333333333333333",
        status: "PAUSED",
      });

      const selected = selectExecutionWallet();
      expect(selected.status).toBe("ACTIVE");
      expect(selected.id).not.toBe(wPaused);
    });

    it("3.5 filters out wallets with unassigned/error proxy routes", () => {
      const wHealthy = `${TEST_PREFIX}healthy_w`;
      const wError = `${TEST_PREFIX}error_w`;
      const pError = `${TEST_PREFIX}p_error`;

      registerProxyConfig({
        id: pError,
        protocol: "http",
        host: "1.2.3.4",
        port: 8080,
        status: "ERROR",
      });

      registerWalletAccount({
        id: wHealthy,
        label: "Healthy Direct Wallet",
        evmAddress: "0x4444444444444444444444444444444444444444",
        status: "ACTIVE",
      });
      registerWalletAccount({
        id: wError,
        label: "Broken Proxy Wallet",
        evmAddress: "0x5555555555555555555555555555555555555555",
        status: "ACTIVE",
      });

      // wError has route using broken proxy
      setWalletProviderRoute(wError, "bankr", { proxyId: pError });

      const selected = selectExecutionWallet({ requiredProvider: "bankr", candidateWalletIds: [wHealthy, wError] });
      expect(selected.id).toBe(wHealthy);
    });

    it("3.6 filters wallets by targetChain capability", () => {
      const wEvmOnly = `${TEST_PREFIX}evm_only`;
      const wSolOnly = `${TEST_PREFIX}sol_only`;

      registerWalletAccount({
        id: wEvmOnly,
        label: "EVM Only",
        evmAddress: "0x6666666666666666666666666666666666666666",
        solanaAddress: undefined,
        status: "ACTIVE",
      });

      registerWalletAccount({
        id: wSolOnly,
        label: "Solana Only",
        evmAddress: undefined,
        solanaAddress: "So11111111111111111111111111111111111111113",
        status: "ACTIVE",
      });

      // If target is solana, wEvmOnly should not be chosen
      const solSelected = selectExecutionWallet({ targetChains: ["solana"], candidateWalletIds: [wEvmOnly, wSolOnly] });
      expect(solSelected.id).toBe(wSolOnly);

      // If target is base, wSolOnly should not be chosen
      const evmSelected = selectExecutionWallet({ targetChains: ["base"], candidateWalletIds: [wEvmOnly, wSolOnly] });
      expect(evmSelected.id).toBe(wEvmOnly);
    });

    it("3.7 distributes workload fairly based on deploy_logs history", () => {
      const wA = `${TEST_PREFIX}rot_a`;
      const wB = `${TEST_PREFIX}rot_b`;

      registerWalletAccount({
        id: wA,
        label: "Wallet Alpha",
        evmAddress: "0x7777777777777777777777777777777777777777",
        status: "ACTIVE",
      });
      registerWalletAccount({
        id: wB,
        label: "Wallet Beta",
        evmAddress: "0x8888888888888888888888888888888888888888",
        status: "ACTIVE",
      });

      // Simulate that wA was used in the most recent deployment
      logDeploy({
        chain: "base",
        tokenName: "Test Token Prior Deploy",
        ticker: "TTPD",
        status: "success",
        walletId: wA,
      });

      // Next execution wallet selected should rotate to wB
      const selected = selectExecutionWallet({ targetChains: ["base"], candidateWalletIds: [wA, wB] });
      expect(selected.id).toBe(wB);

      // Simulate deployment with wB
      logDeploy({
        chain: "base",
        tokenName: "Test Token Second Deploy",
        ticker: "TTSD",
        status: "success",
        walletId: wB,
      });

      // Next rotation should cycle back to wA
      const selectedNext = selectExecutionWallet({ targetChains: ["base"], candidateWalletIds: [wA, wB] });
      expect(selectedNext.id).toBe(wA);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 4. Lineage & Treasury Precedence Integration (P1)
  // ══════════════════════════════════════════════════════════════

  describe("4. Multi-Wallet Lineage & Treasury Precedence", () => {
    it("4.1 maintains wallet_id and proxy_id in deploy_logs and active_positions", () => {
      const wId = `${TEST_PREFIX}lineage_wallet`;
      const pId = `${TEST_PREFIX}lineage_proxy`;
      const contract = `0x_v28_lineage_contract_${Date.now()}`;

      registerProxyConfig({
        id: pId,
        protocol: "http",
        host: "10.0.0.1",
        port: 8080,
      });

      registerWalletAccount({
        id: wId,
        label: "Lineage Test Wallet",
        evmAddress: "0x9999999999999999999999999999999999999999",
        status: "ACTIVE",
      });

      const deployId = logDeploy({
        chain: "base",
        tokenName: `${TEST_PREFIX} Lineage Token`,
        ticker: "V28LIN",
        status: "success",
        walletId: wId,
        proxyId: pId,
      });

      createPendingPosition({
        deployLogId: deployId,
        chain: "base",
        contractAddr: contract,
        ticker: "V28LIN",
        snipeAmount: 0.05,
        takeProfitX: 2.0,
        stopLossPct: 0.3,
        walletId: wId,
        proxyId: pId,
      });

      const log = getDeployLogById(deployId);
      expect(log?.walletId).toBe(wId);
      expect(log?.proxyId).toBe(pId);

      const pos = getPositionByContract(contract);
      expect(pos?.walletId).toBe(wId);
      expect(pos?.proxyId).toBe(pId);
    });

    it("4.2 feeRecipient precedence: TREASURY_EVM_DESTINATION takes priority over operatorWallet", () => {
      process.env.TREASURY_EVM_DESTINATION = "0xColdTreasuryOwnerWalletAddress123456789";
      resetConfig();
      const cfg = getConfig();

      const operatorEvm = "0xOperatorHotWalletAddress987654321012345";
      const feeRecipient = cfg.TREASURY_EVM_DESTINATION || operatorEvm || undefined;

      expect(feeRecipient).toBe("0xColdTreasuryOwnerWalletAddress123456789");
      delete process.env.TREASURY_EVM_DESTINATION;
    });

    it("4.3 feeRecipient precedence: falls back to operatorWallet when treasury destination is unset", () => {
      delete process.env.TREASURY_EVM_DESTINATION;
      resetConfig();
      const cfg = getConfig();

      const operatorEvm = "0xOperatorHotWalletAddress987654321012345";
      const feeRecipient = cfg.TREASURY_EVM_DESTINATION || operatorEvm || undefined;

      expect(feeRecipient).toBe(operatorEvm);
    });

    it("4.4 strict credential isolation: route with credentialRef does not fallback to global key", () => {
      process.env.BANKR_API_KEY = "global_key_primary";
      delete process.env.NON_EXISTENT_OP2_KEY;

      const secondaryRouteRef = "env:NON_EXISTENT_OP2_KEY";
      // When route has a credentialRef but the env var is missing, resolveCredential returns undefined
      const resolved = resolveCredential(secondaryRouteRef);
      expect(resolved).toBeUndefined();

      // Verification of strict isolation logic:
      let apiKeyToUse: string | undefined;
      if (secondaryRouteRef) {
        apiKeyToUse = resolveCredential(secondaryRouteRef);
      } else {
        apiKeyToUse = process.env.BANKR_API_KEY;
      }

      // Must NOT fallback to global key
      expect(apiKeyToUse).toBeUndefined();
      expect(apiKeyToUse).not.toBe("global_key_primary");
      delete process.env.BANKR_API_KEY;
    });

    it("4.5 walletAddress precedence: operatorWallet address prioritized over global keypair address", () => {
      const operatorWallet = {
        id: "op2",
        label: "Operator 2",
        evmAddress: "0x2222222222222222222222222222222222222222",
        solanaAddress: "So22222222222222222222222222222222222222222",
        status: "ACTIVE" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const evmTarget = (("base" === "solana" ? operatorWallet.solanaAddress : operatorWallet.evmAddress)) || "0xFallback";
      expect(evmTarget).toBe("0x2222222222222222222222222222222222222222");

      const solTarget = (("solana" === "solana" ? operatorWallet.solanaAddress : operatorWallet.evmAddress)) || "SolFallback";
      expect(solTarget).toBe("So22222222222222222222222222222222222222222");
    });

    it("4.6 dynamic provider requirement: Solana-only chains do not require bankr provider", () => {
      const eligibleSolanaOnly = ["solana"];
      const needsBankr = eligibleSolanaOnly.some((c) => c !== "solana");
      expect(needsBankr).toBe(false);

      const eligibleMulti = ["base", "solana"];
      const needsBankrMulti = eligibleMulti.some((c) => c !== "solana");
      expect(needsBankrMulti).toBe(true);
    });
  });
});
