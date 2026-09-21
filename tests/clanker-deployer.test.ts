import { describe, it, expect, beforeEach } from "bun:test";
import { encodeEventTopics, encodeAbiParameters, type Address, type Hash } from "viem";
import {
  deployClanker,
  estimateClankerDeployCost,
  CLANKER_V4_ABI,
  CLANKER_V4_FACTORY_ADDRESS,
  CLANKER_V3_1_ABI,
  CLANKER_V3_1_FACTORY_ADDRESS,
  WETH9_BASE_ADDRESS,
} from "../src/modules/evm/clanker-deployer.ts";
import { resetConfig } from "../src/config.ts";
import type { TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { normalizeTrendInput } from "../src/modules/ai/gemini-brain.ts";

const mockIdentity: TokenIdentity = {
  name: "Clanker Test Token",
  ticker: "CLANKTEST",
  description: "Unit test token for clanker deployer",
  viralScore: 88,
  imagePrompt: "test logo prompt",
  website: "https://test.clanker.world",
  twitter: "https://x.com/clanktest",
  telegram: "https://t.me/clanktest",
};

const mockAssets = {
  imageUrl: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
  metadataUrl: "https://ipfs.io/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/metadata.json",
  ipfsImageUri: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
};

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("Clanker v4 Token Deployer Engine", () => {
  beforeEach(() => {
    process.env.EVM_PRIVATE_KEY = TEST_PRIVATE_KEY;
    process.env.BASE_RPC_URL = "https://mainnet.base.org";
    process.env.DRY_RUN = "false";
    resetConfig();
  });

  it("1. should execute dry-run simulation without sending live transaction", async () => {
    let simulateCalled = false;
    let writeCalled = false;

    const mockPublicClient = {
      simulateContract: async (args: any) => {
        simulateCalled = true;
        expect(args.address.toLowerCase()).toBe(CLANKER_V4_FACTORY_ADDRESS.toLowerCase());
        expect(args.functionName).toBe("deployToken");
        return { result: undefined };
      },
    };

    const mockWalletClient = {
      writeContract: async () => {
        writeCalled = true;
        return "0xmocktxhash" as Hash;
      },
    };

    const result = await deployClanker(mockIdentity, mockAssets, {
      dryRun: true,
      publicClientOverride: mockPublicClient,
      walletClientOverride: mockWalletClient,
    });

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(true);
    expect(result.chain).toBe("clanker");
    expect(result.ticker).toBe("CLANKTEST");
    expect(simulateCalled).toBe(true);
    expect(writeCalled).toBe(false);
  });

  it("2. should deploy live token, confirm receipt, and parse TokenCreated event logs", async () => {
    const expectedTokenAddress = "0x1111111111111111111111111111111111111111" as Address;
    const expectedPoolAddress = "0x2222222222222222222222222222222222222222222222222222222222222222" as Hash;
    const expectedTxHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hash;

    const tokenCreatedEvent = (CLANKER_V4_ABI as any).find(
      (x: any) => x.type === "event" && x.name === "TokenCreated"
    );

    const topics = encodeEventTopics({
      abi: [tokenCreatedEvent],
      eventName: "TokenCreated",
      args: {
        tokenAddress: expectedTokenAddress,
        tokenAdmin: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
      },
    });

    const nonIndexed = tokenCreatedEvent.inputs.filter((x: any) => !x.indexed);
    const data = encodeAbiParameters(
      nonIndexed,
      [
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
        mockAssets.ipfsImageUri,
        "Clanker Test Token",
        "CLANKTEST",
        "",
        "",
        -230400,
        "0xb429d62f8f3bFFb98CdB9569533eA23bF0Ba28CC" as Address,
        expectedPoolAddress,
        WETH9_BASE_ADDRESS,
        "0xffA37784D619F228D8B379d287a4D7282e500762" as Address,
        "0xebB25BB797D82CB78E1bc70406b13233c0854413" as Address,
        0n,
        [],
      ]
    );

    const mockPublicClient = {
      simulateContract: async () => ({ result: undefined }),
      waitForTransactionReceipt: async (opts: any) => {
        expect(opts.hash).toBe(expectedTxHash);
        return {
          status: "success",
          blockNumber: 12345678n,
          gasUsed: 450_000n,
          effectiveGasPrice: 2_000_000_000n, // 2 gwei
          logs: [
            {
              data,
              topics,
            },
          ],
        };
      },
    };

    const mockWalletClient = {
      writeContract: async () => expectedTxHash,
    };

    const result = await deployClanker(mockIdentity, mockAssets, {
      dryRun: false,
      publicClientOverride: mockPublicClient,
      walletClientOverride: mockWalletClient,
    });

    expect(result.success).toBe(true);
    expect(result.simulated).toBe(false);
    expect(result.chain).toBe("clanker");
    expect(result.tokenAddress?.toLowerCase()).toBe(expectedTokenAddress.toLowerCase());
    expect(result.poolAddress?.toLowerCase()).toBe(expectedPoolAddress.toLowerCase());
    expect(result.txHash).toBe(expectedTxHash);
    expect(result.deployCostEth).toBeGreaterThan(0);
  });

  it("3. should handle simulation failure gracefully and return SIMULATION_FAILED", async () => {
    const mockPublicClient = {
      simulateContract: async () => {
        throw new Error("execution reverted: transfer amount exceeds balance");
      },
    };

    const result = await deployClanker(mockIdentity, mockAssets, {
      dryRun: false,
      publicClientOverride: mockPublicClient,
      walletClientOverride: {},
    });

    expect(result.success).toBe(false);
    expect(result.simulated).toBe(true);
    expect(result.error).toContain("SIMULATION_FAILED");
  });

  it("4. should handle transaction submission failure and return TX_FAILED", async () => {
    const mockPublicClient = {
      simulateContract: async () => ({ result: undefined }),
    };

    const mockWalletClient = {
      writeContract: async () => {
        throw new Error("replacement transaction underpriced");
      },
    };

    const result = await deployClanker(mockIdentity, mockAssets, {
      dryRun: false,
      publicClientOverride: mockPublicClient,
      walletClientOverride: mockWalletClient,
    });

    expect(result.success).toBe(false);
    expect(result.simulated).toBe(false);
    expect(result.error).toContain("TX_FAILED");
  });

  it("5. should handle transaction reverted on-chain and return TX_REVERTED", async () => {
    const mockPublicClient = {
      simulateContract: async () => ({ result: undefined }),
      waitForTransactionReceipt: async () => ({
        status: "reverted",
        gasUsed: 50_000n,
        effectiveGasPrice: 1_000_000n,
        logs: [],
      }),
    };

    const mockWalletClient = {
      writeContract: async () => "0xrevertedtx" as Hash,
    };

    const result = await deployClanker(mockIdentity, mockAssets, {
      dryRun: false,
      publicClientOverride: mockPublicClient,
      walletClientOverride: mockWalletClient,
    });

    expect(result.success).toBe(false);
    expect(result.simulated).toBe(false);
    expect(result.error).toBe("TX_REVERTED");
  });

  it("6. should handle receipt timeout gracefully and return RECEIPT_TIMEOUT", async () => {
    const mockPublicClient = {
      simulateContract: async () => ({ result: undefined }),
      waitForTransactionReceipt: async () => {
        throw new Error("Timed out waiting for transaction receipt");
      },
    };

    const mockWalletClient = {
      writeContract: async () => "0xtimeouttx" as Hash,
    };

    const result = await deployClanker(mockIdentity, mockAssets, {
      dryRun: false,
      publicClientOverride: mockPublicClient,
      walletClientOverride: mockWalletClient,
    });

    expect(result.success).toBe(false);
    expect(result.simulated).toBe(false);
    expect(result.error).toContain("RECEIPT_TIMEOUT");
  });

  it("7. should estimate deploy cost using fallback safe limits if RPC throws", async () => {
    const est = await estimateClankerDeployCost(
      { name: "Fallback Test", ticker: "FBK" },
      { rpcUrl: "http://127.0.0.1:9999/invalid" }
    );

    expect(est.estimatedGasUnits).toBe(5_000_000n);
    expect(est.estimatedEth).toBe(0.0003);
  });

  it("8. should handle normalizeTrendInput when called with object or undefined", () => {
    expect(normalizeTrendInput({ chain: "clanker" })).toContain("clanker");
    expect(normalizeTrendInput("custom trend")).toBe("custom trend");
    expect(normalizeTrendInput(undefined)).toContain("Trending");
  });
});
