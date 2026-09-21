import { describe, it, expect, beforeAll } from "bun:test";
import { deployClanker } from "../src/modules/evm/clanker-deployer.ts";
import { deployViaPumpFun } from "../src/modules/solana/pumpfun-deployer.ts";
import { validateFundingCluster } from "../src/modules/growth/trending-booster.ts";
import {
  bootstrapDefaultWallet,
  registerWalletAccount,
  getWalletAccount,
  getWalletByAddress,
} from "../src/modules/identity/wallet-manager.ts";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { saveWallet, getWalletKeyByAddress } from "../src/db/vault.ts";

describe("Deployer Multi-Wallet & Anti-Cluster Integration Suite", () => {
  let subWalletEvmKey: string;
  let subWalletEvmAddress: string;
  let subWalletSolKey: string;
  let subWalletSolPubkey: string;
  let testWalletId: string;

  beforeAll(() => {
    bootstrapDefaultWallet();

    // Generate isolated sub-wallet for testing
    subWalletEvmKey = generatePrivateKey();
    subWalletEvmAddress = privateKeyToAccount(subWalletEvmKey).address;

    const solKp = Keypair.generate();
    subWalletSolPubkey = solKp.publicKey.toBase58();
    subWalletSolKey = bs58.encode(solKp.secretKey);

    saveWallet("base", subWalletEvmAddress, subWalletEvmKey);
    saveWallet("solana", subWalletSolPubkey, subWalletSolKey);

    testWalletId = `test-deployer-${Date.now()}`;
    registerWalletAccount({
      id: testWalletId,
      label: "Test Deployer Sub-Wallet #1",
      evmAddress: subWalletEvmAddress,
      solanaAddress: subWalletSolPubkey,
      status: "ACTIVE",
    });
  });

  describe("1. Clanker v4 Multi-Wallet Deployer", () => {
    it("should accept custom deployerPrivateKey and feeRecipientAddress in simulation mode", async () => {
      const mockPublicClient = {
        simulateContract: async () => ({ result: "0x1234" }),
        readContract: async () => 10n,
      };

      const result = await deployClanker(
        {
          name: "Multi-Wallet Test Token",
          ticker: "MWTEST",
          lore: "Autonomous multi-wallet deployer test",
          targetAudience: "degen",
          viralScore: 90,
          telegram: "https://t.me/test",
          twitter: "https://x.com/test",
          website: "https://test.pages.dev",
        },
        { imageUrl: "https://ipfs.io/ipfs/test" },
        {
          dryRun: true,
          deployerPrivateKey: subWalletEvmKey,
          feeRecipientAddress: subWalletEvmAddress as `0x${string}`,
          publicClientOverride: mockPublicClient,
        }
      );

      expect(result).toBeDefined();
      expect(result.chain).toBe("clanker");
      expect(result.simulated).toBe(true);
      expect(result.success).toBe(true);
      expect(result.tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("should retrieve saved private key from vault for registered EVM sub-wallet", () => {
      const retrieved = getWalletKeyByAddress(subWalletEvmAddress);
      expect(retrieved).toBe(subWalletEvmKey);
    });
  });

  describe("2. Solana Pump.fun Multi-Wallet Fee Payer", () => {
    it("should accept custom feePayerPrivateKey in simulated testnet mode", async () => {
      const result = await deployViaPumpFun(
        {
          name: "Solana Multi-Wallet Test",
          ticker: "SOLMW",
          description: "Testing custom fee payer rotation",
          viralScore: 85,
        },
        {
          imageUrl: "https://ipfs.io/ipfs/test",
          metadataUrl: "https://ipfs.io/ipfs/testmeta",
        },
        {
          simulateOnly: true,
          feePayerPrivateKey: subWalletSolKey,
        }
      );

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.contractAddress).toBeDefined();
      expect(result.contractAddress!.startsWith("pump")).toBe(true);
    });

    it("should retrieve saved private key from vault for registered Solana sub-wallet", () => {
      const retrieved = getWalletKeyByAddress(subWalletSolPubkey);
      expect(retrieved).toBe(subWalletSolKey);
    });
  });

  describe("3. Anti-Cluster Separation of Duties", () => {
    it("should flag deployer sub-wallet if used as maker in its own token pool", () => {
      const clusterCheck = validateFundingCluster(subWalletEvmAddress, [subWalletEvmAddress]);
      expect(clusterCheck.isClustered).toBe(true);
      expect(clusterCheck.warning).toContain("CLUSTER WARNING");
    });

    it("should pass other independent sub-wallets with 0% cluster correlation", () => {
      const otherEvm = generatePrivateKey();
      const otherAddress = privateKeyToAccount(otherEvm).address;

      const clusterCheck = validateFundingCluster(otherAddress, [subWalletEvmAddress]);
      expect(clusterCheck.isClustered).toBe(false);
      expect(clusterCheck.warning).toBeUndefined();
    });
  });

  describe("4. Flexible Wallet Query Resolution", () => {
    it("should resolve wallet by exact ID", () => {
      const resolved = getWalletAccount(testWalletId);
      expect(resolved).toBeDefined();
      expect(resolved!.evmAddress?.toLowerCase()).toBe(subWalletEvmAddress.toLowerCase());
    });

    it("should resolve wallet by EVM address", () => {
      const resolved = getWalletByAddress(subWalletEvmAddress);
      expect(resolved).toBeDefined();
      expect(resolved!.id).toBe(testWalletId);
    });

    it("should resolve wallet by Solana address", () => {
      const resolved = getWalletByAddress(subWalletSolPubkey);
      expect(resolved).toBeDefined();
      expect(resolved!.id).toBe(testWalletId);
    });
  });
});
