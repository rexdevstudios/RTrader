import { describe, it, expect, beforeEach } from "bun:test";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { deployViaPumpFun, sweepLeftoverSol } from "../src/modules/solana/pumpfun-deployer.ts";
import { resetConfig } from "../src/config.ts";
import { confirmDeployment } from "../src/modules/deploy-guard.ts";
import type { TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import type { UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";

const mockIdentity: TokenIdentity = {
  name: "Solana Test Token",
  ticker: "SOLTEST",
  description: "Unit test token for pumpfun deployer",
  viralScore: 92,
  imagePrompt: "test logo prompt",
  website: "https://test.solana.com",
  twitter: "https://x.com/soltest",
  telegram: "https://t.me/soltest",
};

const mockAssets: UploadResult = {
  imageUrl: "https://ipfs.test/sol.png",
  metadataUrl: "https://ipfs.test/sol.json",
  ipfsImageUri: "ipfs://sol_hash",
};

describe("Solana Pump.fun Deployer & Sweeper Engine", () => {
  beforeEach(() => {
    const kp = Keypair.generate();
    process.env.DEPLOY_MODE = "testnet";
    process.env.SOLANA_PRIVATE_KEY = bs58.encode(kp.secretKey);
    process.env.SOLANA_RPC_URL = "https://api.devnet.solana.com";
    resetConfig();
  });

  describe("1. Simulation & Testnet Mode", () => {
    it("1.1 should execute simulated deployment when DEPLOY_MODE=testnet", async () => {
      process.env.DEPLOY_MODE = "testnet";
      resetConfig();

      const result = await deployViaPumpFun(mockIdentity, mockAssets);
      expect(result.success).toBe(true);
      expect(result.status).toBe("success");
      expect(result.simulated).toBe(true);
      expect(result.contractAddress).toBeDefined();
      expect(result.contractAddress?.startsWith("pump")).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(result.explorerUrl).toBe("https://solscan.io/tx/simulated");
    });

    it("1.2 deploy guard should identify simulated Pump.fun deployment as isSimulation", async () => {
      process.env.DEPLOY_MODE = "testnet";
      resetConfig();

      const result = await deployViaPumpFun(mockIdentity, mockAssets);
      const confirmation = confirmDeployment(result, "solana");
      expect(confirmation.isSimulation).toBe(true);
      expect(confirmation.confirmed).toBe(false);
    });
  });

  describe("2. Error Handling & Fail-Closed Behavior", () => {
    it("2.1 should fail cleanly and return status=failed on invalid private key in mainnet mode", async () => {
      process.env.DEPLOY_MODE = "mainnet";
      process.env.SOLANA_PRIVATE_KEY = "invalid_private_key_abc";
      resetConfig();

      const result = await deployViaPumpFun(mockIdentity, mockAssets);
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
    });
  });

  describe("3. Auto-Sweeper Safety", () => {
    it("3.1 sweepLeftoverSol should execute without throwing when vault has no unswept wallets", async () => {
      await expect(sweepLeftoverSol()).resolves.toBeUndefined();
    });
  });

  describe("4. VersionedTransaction Engine & Payload Integrity", () => {
    it("4.1 should include publicKey fee-payer and mint in PumpPortal payload", async () => {
      const axios = (await import("axios")).default;
      const { spyOn } = await import("bun:test");
      const { TransactionMessage, VersionedTransaction, SystemProgram } = await import("@solana/web3.js");

      process.env.DEPLOY_MODE = "mainnet";
      const masterKp = Keypair.generate();
      process.env.SOLANA_PRIVATE_KEY = bs58.encode(masterKp.secretKey);
      resetConfig();

      // Build valid mock v0 transaction
      const message = new TransactionMessage({
        payerKey: masterKp.publicKey,
        recentBlockhash: "11111111111111111111111111111111",
        instructions: [
          SystemProgram.transfer({
            fromPubkey: masterKp.publicKey,
            toPubkey: masterKp.publicKey,
            lamports: 0,
          }),
        ],
      }).compileToV0Message();
      const mockVtx = new VersionedTransaction(message);
      const mockBytes = mockVtx.serialize();

      let capturedPayload: any;
      const axiosSpy = spyOn(axios, "post").mockImplementation(async (url: string, data: any) => {
        capturedPayload = data;
        return { status: 200, data: Buffer.from(mockBytes) } as any;
      });

      const { Connection } = await import("@solana/web3.js");
      const origSendRaw = Connection.prototype.sendRawTransaction;
      const origConfirm = Connection.prototype.confirmTransaction;
      Connection.prototype.sendRawTransaction = async () => "mock_tx_sig_12345";
      Connection.prototype.confirmTransaction = async () => ({ value: { err: null } } as any);

      try {
        const res = await deployViaPumpFun(mockIdentity, mockAssets, { devBuyAmountSol: 0.001 });

        expect(axiosSpy).toHaveBeenCalled();
        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.publicKey).toBe(masterKp.publicKey.toBase58());
        expect(capturedPayload.action).toBe("create");
        expect(capturedPayload.mint).toBeDefined();
        expect(capturedPayload.amount).toBe(0.001);
        expect(capturedPayload.pool).toBe("pump");

        expect(res.success).toBe(true);
        expect(res.status).toBe("success");
        expect(res.simulated).toBe(false);
        expect(res.txHash).toBe("mock_tx_sig_12345");
        expect(res.contractAddress).toBeDefined();
        expect(res.explorerUrl).toBe("https://solscan.io/tx/mock_tx_sig_12345");
      } finally {
        axiosSpy.mockRestore();
        Connection.prototype.sendRawTransaction = origSendRaw;
        Connection.prototype.confirmTransaction = origConfirm;
      }
    });

    it("4.2 should return status=unknown and forbid auto-retry on timeout", async () => {
      const axios = (await import("axios")).default;
      const { spyOn } = await import("bun:test");

      process.env.DEPLOY_MODE = "mainnet";
      const masterKp = Keypair.generate();
      process.env.SOLANA_PRIVATE_KEY = bs58.encode(masterKp.secretKey);
      resetConfig();

      const timeoutErr: any = new Error("timeout of 30000ms exceeded");
      timeoutErr.isAxiosError = true;
      timeoutErr.code = "ECONNABORTED";

      const axiosSpy = spyOn(axios, "post").mockRejectedValueOnce(timeoutErr);

      try {
        const res = await deployViaPumpFun(mockIdentity, mockAssets);
        expect(res.success).toBe(false);
        expect(res.status).toBe("unknown");
        expect(res.error).toContain("DEPLOYMENT_OUTCOME_UNKNOWN");
        expect(res.error).toContain("AUTOMATIC RETRY FORBIDDEN");
      } finally {
        axiosSpy.mockRestore();
      }
    });

    it("4.3 should respect simulateOnly override even when DEPLOY_MODE=mainnet", async () => {
      process.env.DEPLOY_MODE = "mainnet";
      const masterKp = Keypair.generate();
      process.env.SOLANA_PRIVATE_KEY = bs58.encode(masterKp.secretKey);
      resetConfig();

      const res = await deployViaPumpFun(mockIdentity, mockAssets, { simulateOnly: true });
      expect(res.success).toBe(true);
      expect(res.simulated).toBe(true);
      expect(res.status).toBe("success");
    });
  });
});
