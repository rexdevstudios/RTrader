import { describe, it, expect, beforeEach } from "bun:test";
import { parseEther, type Hash, type Address } from "viem";
import { wrapEth, getWethBalance, WETH9_BASE_ADDRESS } from "../src/modules/evm/weth-wrapper.ts";
import { resetConfig } from "../src/config.ts";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("WETH9 Wrapper Engine on Base", () => {
  beforeEach(() => {
    process.env.EVM_PRIVATE_KEY = TEST_PRIVATE_KEY;
    process.env.BASE_RPC_URL = "https://mainnet.base.org";
    process.env.DRY_RUN = "false";
    resetConfig();
  });

  it("1. should reject invalid amounts (amountEth <= 0)", async () => {
    const res = await wrapEth(0);
    expect(res.success).toBe(false);
    expect(res.error).toContain("INVALID_AMOUNT");

    const resNeg = await wrapEth(-0.5);
    expect(resNeg.success).toBe(false);
    expect(resNeg.error).toContain("INVALID_AMOUNT");
  });

  it("2. should reject when native ETH balance is insufficient", async () => {
    const mockPublicClient = {
      getBalance: async () => parseEther("0.001"), // only 0.001 ETH
    };

    const res = await wrapEth(0.05, {
      publicClientOverride: mockPublicClient,
      walletClientOverride: {},
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("INSUFFICIENT_ETH");
  });

  it("3. should execute dry-run simulation without sending live transaction", async () => {
    let simulateCalled = false;
    let writeCalled = false;

    const mockPublicClient = {
      getBalance: async () => parseEther("1.0"),
      readContract: async () => parseEther("0.1"),
      simulateContract: async (args: any) => {
        simulateCalled = true;
        expect(args.address).toBe(WETH9_BASE_ADDRESS);
        expect(args.functionName).toBe("deposit");
        return { result: undefined };
      },
    };

    const mockWalletClient = {
      writeContract: async () => {
        writeCalled = true;
        return "0xmock" as Hash;
      },
    };

    const res = await wrapEth(0.02, {
      dryRun: true,
      publicClientOverride: mockPublicClient,
      walletClientOverride: mockWalletClient,
    });

    expect(res.success).toBe(true);
    expect(res.simulated).toBe(true);
    expect(res.amountEth).toBe(0.02);
    expect(res.wethReceived).toBe(0.02);
    expect(simulateCalled).toBe(true);
    expect(writeCalled).toBe(false);
  });

  it("4. should execute live wrap successfully and parse receipt", async () => {
    const txHash = "0x9999999999999999999999999999999999999999999999999999999999999999" as Hash;

    const mockPublicClient = {
      getBalance: async () => parseEther("1.0"),
      readContract: async () => parseEther("0.5"),
      simulateContract: async () => ({ result: undefined }),
      waitForTransactionReceipt: async (opts: any) => {
        expect(opts.hash).toBe(txHash);
        return {
          status: "success",
          gasUsed: 45_000n,
          effectiveGasPrice: 1_000_000_000n, // 1 gwei
        };
      },
    };

    const mockWalletClient = {
      writeContract: async (args: any) => {
        expect(args.address).toBe(WETH9_BASE_ADDRESS);
        expect(args.functionName).toBe("deposit");
        return txHash;
      },
    };

    const res = await wrapEth(0.05, {
      dryRun: false,
      publicClientOverride: mockPublicClient,
      walletClientOverride: mockWalletClient,
    });

    expect(res.success).toBe(true);
    expect(res.simulated).toBe(false);
    expect(res.txHash).toBe(txHash);
    expect(res.wethReceived).toBe(0.05);
    expect(res.gasCostEth).toBeGreaterThan(0);
    expect(res.explorerUrl).toContain("basescan.org/tx/");
  });

  it("5. should handle simulation failure gracefully and return SIMULATION_FAILED", async () => {
    const mockPublicClient = {
      getBalance: async () => parseEther("1.0"),
      readContract: async () => 0n,
      simulateContract: async () => {
        throw new Error("deposit() failed in contract execution");
      },
    };

    const res = await wrapEth(0.01, {
      dryRun: false,
      publicClientOverride: mockPublicClient,
      walletClientOverride: {},
    });

    expect(res.success).toBe(false);
    expect(res.simulated).toBe(true);
    expect(res.error).toContain("SIMULATION_FAILED");
  });

  it("6. should read WETH balance accurately via getWethBalance", async () => {
    const mockPublicClient = {
      readContract: async (args: any) => {
        expect(args.address).toBe(WETH9_BASE_ADDRESS);
        expect(args.functionName).toBe("balanceOf");
        return parseEther("1.2345");
      },
    };

    const bal = await getWethBalance(
      "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      undefined,
      mockPublicClient
    );

    expect(bal).toBe(1.2345);
  });
});
