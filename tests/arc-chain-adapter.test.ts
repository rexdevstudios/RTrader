/**
 * tests/arc-chain-adapter.test.ts
 *
 * Comprehensive unit and integration test suite for the Arc Chain module:
 * Arc Mainnet (5042), ArcPad launchpad adapter, Tolly DEX adapter, and conversion utilities.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  ARC_CHAIN_ID,
  ARC_CHAIN_NAME,
  ARC_CURVE_PAD_ADDRESS,
  ARC_FEE_LOCKER_ADDRESS,
  ARC_USDC_FACADE_ADDRESS,
  TOLLY_PAD_ADDRESS,
  TOLLY_TOKEN_ADDRESS,
  UNISWAP_V3_ROUTER_ADDRESS,
  UNISWAP_V3_QUOTER_ADDRESS,
  arcMainnet,
  getArcPublicClient,
  getArcWalletClient,
  nativeUsdcToWei,
  weiToNativeUsdc,
  facadeUsdcToRaw,
  rawToFacadeUsdc,
  ArcPadAdapter,
  TollyAdapter,
  type ArcPadLaunchParams,
} from "../src/modules/arc/index.ts";
import type { Hash, Address } from "viem";

const MOCK_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("Arc Chain Isolated Adapter Test Suite", () => {
  describe("1. Network Specifications & Constants", () => {
    it("should match official Arc Mainnet Chain ID (5042)", () => {
      expect(ARC_CHAIN_ID).toBe(5042);
      expect(arcMainnet.id).toBe(5042);
      expect(arcMainnet.name).toBe("Arc Mainnet");
    });

    it("should define native currency as 18-decimal USDC for gas", () => {
      expect(arcMainnet.nativeCurrency.symbol).toBe("USDC");
      expect(arcMainnet.nativeCurrency.decimals).toBe(18);
    });

    it("should contain valid contract addresses for ArcPad and Canonical Uniswap V3", () => {
      expect(ARC_CURVE_PAD_ADDRESS).toBe(
        "0x24196CD6e534cfCE8F480B53E70809b68Ea86F29"
      );
      expect(ARC_FEE_LOCKER_ADDRESS).toBe(
        "0x69A615DD32B89fE40D87b2e3123baE4162f2d450"
      );
      expect(ARC_USDC_FACADE_ADDRESS).toBe(
        "0x3600000000000000000000000000000000000000"
      );
      expect(UNISWAP_V3_ROUTER_ADDRESS).toBe(
        "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77"
      );
      expect(UNISWAP_V3_QUOTER_ADDRESS).toBe(
        "0x7dfd4f31be6814d2906bde155c3e1b146eac1468"
      );
      expect(TOLLY_PAD_ADDRESS).toBe(
        "0xcad7ee36ac193bf2eddb7b3e2736c5bdb8269c8b"
      );
      expect(TOLLY_TOKEN_ADDRESS).toBe(
        "0xbc43ce8dec648ea298c4275559b81d6261c90b67"
      );
    });
  });

  describe("2. Unit Conversion Mechanics (Native 18-dec vs Facade 6-dec)", () => {
    it("should correctly convert native USDC to 18-decimal wei and back", () => {
      const oneUsdcWei = nativeUsdcToWei(1);
      expect(oneUsdcWei).toBe(1_000_000_000_000_000_000n);
      expect(weiToNativeUsdc(oneUsdcWei)).toBe("1");

      const fractionalUsdcWei = nativeUsdcToWei("0.25");
      expect(fractionalUsdcWei).toBe(250_000_000_000_000_000n);
      expect(weiToNativeUsdc(fractionalUsdcWei)).toBe("0.25");
    });

    it("should correctly convert ERC-20 facade USDC to 6-decimal raw and back", () => {
      const oneUsdcRaw = facadeUsdcToRaw(1);
      expect(oneUsdcRaw).toBe(1_000_000n);
      expect(rawToFacadeUsdc(oneUsdcRaw)).toBe("1");

      const fractionalUsdcRaw = facadeUsdcToRaw("0.5");
      expect(fractionalUsdcRaw).toBe(500_000n);
      expect(rawToFacadeUsdc(fractionalUsdcRaw)).toBe("0.5");
    });
  });

  describe("3. Client Factories & Account Derivation", () => {
    it("should create PublicClient configured for Arc Mainnet", () => {
      const client = getArcPublicClient();
      expect(client.chain?.id).toBe(5042);
    });

    it("should create WalletClient with matching public address", () => {
      const wallet = getArcWalletClient(MOCK_PRIVATE_KEY);
      expect(wallet.chain?.id).toBe(5042);
      expect(wallet.account?.address.toLowerCase()).toBe(
        "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266".toLowerCase()
      );
    });
  });

  describe("4. ArcPad Adapter Core Functionality", () => {
    it("should generate cryptographically random 32-byte salts", () => {
      const salt1 = ArcPadAdapter.generateSalt();
      const salt2 = ArcPadAdapter.generateSalt();
      expect(salt1.startsWith("0x")).toBe(true);
      expect(salt1.length).toBe(66);
      expect(salt2.length).toBe(66);
      expect(salt1).not.toBe(salt2);
    });

    it("should execute dry-run launch without sending live transactions", async () => {
      const publicClient = {
        simulateContract: async () => ({
          request: { gas: 3_200_000n },
        }),
      } as any;

      const walletClient = {
        account: { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
        writeContract: async () => {
          throw new Error("writeContract must not be called during dry-run");
        },
      } as any;

      const params: ArcPadLaunchParams = {
        name: "Test Token",
        symbol: "TEST",
        meta: {
          imageURI: "https://example.com/logo.png",
          website: "",
          twitter: "",
          telegram: "",
        },
        devBuyUsdc: 0.1,
        dryRun: true,
      };

      const result = await ArcPadAdapter.launchToken(
        publicClient,
        walletClient,
        params
      );

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.name).toBe("Test Token");
      expect(result.symbol).toBe("TEST");
      expect(result.devBuyAmountUsdc).toBe(0.1);
    });

    it("should handle simulation failure gracefully", async () => {
      const publicClient = {
        simulateContract: async () => {
          throw new Error("execution reverted: out of gas or anti-snipe limit");
        },
      } as any;

      const walletClient = {
        account: { address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
      } as any;

      const params: ArcPadLaunchParams = {
        name: "Revert Token",
        symbol: "REV",
        meta: { imageURI: "", website: "", twitter: "", telegram: "" },
        dryRun: false,
      };

      const result = await ArcPadAdapter.launchToken(
        publicClient,
        walletClient,
        params
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Simulation failed");
    });
  });

  describe("5. Live Network & External API Integration", () => {
    it("should verify Arc Mainnet RPC connectivity and Chain ID live", async () => {
      const publicClient = getArcPublicClient();
      const chainId = await publicClient.getChainId();
      const headBlock = await publicClient.getBlockNumber();

      expect(chainId).toBe(5042);
      expect(headBlock).toBeGreaterThan(21_000_000n);
    });

    it("should query live ArcPad REST API and receive structured token catalog", async () => {
      const res = await ArcPadAdapter.fetchLaunchedTokens(3);

      expect(res.chainId).toBe(5042);
      expect(Array.isArray(res.creations)).toBe(true);
      expect(res.creations.length).toBeGreaterThan(0);

      const first = res.creations[0];
      expect(first.token.startsWith("0x")).toBe(true);
      expect(first.pool.startsWith("0x")).toBe(true);
      expect(first.name).toBeDefined();
      expect(first.symbol).toBeDefined();
    });

    it("should query live Tolly DEX health API and verify Chain ID 5042", async () => {
      const health = await TollyAdapter.getHealth();

      expect(health.chainId).toBe(5042);
      expect(health.pad.toLowerCase()).toBe(TOLLY_PAD_ADDRESS.toLowerCase());
    });
  });
});
