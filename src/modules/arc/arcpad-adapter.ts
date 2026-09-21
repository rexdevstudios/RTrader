/**
 * src/modules/arc/arcpad-adapter.ts
 *
 * Implementation of the ArcPad Launchpad Adapter on Arc Mainnet (Chain ID 5042).
 * Handles token deployment to ArcCurvePad, Uniswap V3 liquidity pool tracking,
 * and querying ArcPad's live REST indexer.
 */

import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  toHex,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  ARC_CURVE_PAD_ADDRESS,
  ARC_CURVE_PAD_ABI,
  ARC_EXPLORER_DEFAULT,
  ARCPAD_API_BASE,
  ARCPAD_DEPLOY_GAS_LIMIT,
  ARCPAD_POOL_FEE_TIER,
  UNISWAP_V3_QUOTER_ADDRESS,
  UNISWAP_V3_QUOTER_V2_ABI,
  type ArcPadLaunchParams,
  type ArcPadDeployResult,
  type ArcPadTokensApiResponse,
  type ArcPadTokenRecord,
} from "./types.ts";
import { nativeUsdcToWei } from "./arc-client.ts";
import { logger } from "../../logger.ts";

export class ArcPadAdapter {
  /**
   * Generates a cryptographically secure random 32-byte salt for createToken.
   */
  public static generateSalt(): Hex {
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    return toHex(randomBytes);
  }

  /**
   * Fetches latest launched tokens from ArcPad's REST API.
   */
  public static async fetchLaunchedTokens(
    limit: number = 20,
    after?: string
  ): Promise<ArcPadTokensApiResponse> {
    const url = new URL(`${ARCPAD_API_BASE}/tokens`);
    url.searchParams.set("limit", Math.min(limit, 100).toString());
    if (after) {
      url.searchParams.set("after", after);
    }

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `ArcPad API error: HTTP ${response.status} - ${await response.text()}`
      );
    }

    return (await response.json()) as ArcPadTokensApiResponse;
  }

  /**
   * Fetches metadata and pool details for a specific token address from ArcPad API.
   */
  public static async getTokenMetadata(
    tokenAddress: Address
  ): Promise<ArcPadTokenRecord | null> {
    const url = `${ARCPAD_API_BASE}/token/${tokenAddress}/meta`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        `ArcPad API error: HTTP ${response.status} - ${await response.text()}`
      );
    }

    return (await response.json()) as ArcPadTokenRecord;
  }

  /**
   * Simulates token launch on-chain against ArcCurvePad before broadcasting.
   */
  public static async simulateLaunch(
    publicClient: PublicClient,
    senderAddress: Address,
    params: ArcPadLaunchParams
  ): Promise<{
    canLaunch: boolean;
    salt: Hex;
    devBuyWei: bigint;
    predictedGas: bigint;
    error?: string;
  }> {
    const salt = params.salt || this.generateSalt();
    const devBuyWei = params.devBuyUsdc
      ? nativeUsdcToWei(params.devBuyUsdc)
      : 0n;

    try {
      const { request } = await publicClient.simulateContract({
        account: senderAddress,
        address: ARC_CURVE_PAD_ADDRESS,
        abi: ARC_CURVE_PAD_ABI,
        functionName: "createToken",
        args: [
          params.name,
          params.symbol,
          {
            imageURI: params.meta.imageURI || "",
            website: params.meta.website || "",
            twitter: params.meta.twitter || "",
            telegram: params.meta.telegram || "",
          },
          salt,
        ],
        value: devBuyWei,
      });

      return {
        canLaunch: true,
        salt,
        devBuyWei,
        predictedGas: request.gas || ARCPAD_DEPLOY_GAS_LIMIT,
      };
    } catch (err: any) {
      const errorMsg = err?.shortMessage || err?.message || String(err);
      return {
        canLaunch: false,
        salt,
        devBuyWei,
        predictedGas: ARCPAD_DEPLOY_GAS_LIMIT,
        error: errorMsg,
      };
    }
  }

  /**
   * Executes token launch on ArcPad.
   * Atomic operation: Deploys ERC-20, initializes Uniswap V3 pool, locks LP in ArcFeeLocker.
   */
  public static async launchToken(
    publicClient: PublicClient,
    walletClient: WalletClient,
    params: ArcPadLaunchParams
  ): Promise<ArcPadDeployResult> {
    const sender = walletClient.account?.address;
    if (!sender) {
      throw new Error("WalletClient must have an active account address to launch");
    }

    const devBuyNumeric =
      typeof params.devBuyUsdc === "number"
        ? params.devBuyUsdc
        : parseFloat(params.devBuyUsdc || "0") || 0;

    logger.info(
      `[ArcPadAdapter] Initiating token launch: ${params.name} ($${params.symbol}) on Arc Mainnet`
    );

    // 1. Preflight Simulation
    const simulation = await this.simulateLaunch(publicClient, sender, params);
    if (!simulation.canLaunch && !params.dryRun) {
      logger.error(`[ArcPadAdapter] Preflight simulation failed: ${simulation.error}`);
      return {
        success: false,
        name: params.name,
        symbol: params.symbol,
        devBuyAmountUsdc: devBuyNumeric,
        error: `Simulation failed: ${simulation.error}`,
      };
    }

    // 2. Handle Dry-Run
    if (params.dryRun) {
      logger.info("[ArcPadAdapter] Dry-run mode enabled. Skipping on-chain write.");
      return {
        success: true,
        name: params.name,
        symbol: params.symbol,
        devBuyAmountUsdc: devBuyNumeric,
        simulated: true,
      };
    }

    // 3. Execute writeContract
    try {
      logger.info(
        `[ArcPadAdapter] Broadcasting createToken TX to ArcCurvePad (${ARC_CURVE_PAD_ADDRESS})...`
      );

      const txHash = await walletClient.writeContract({
        address: ARC_CURVE_PAD_ADDRESS,
        abi: ARC_CURVE_PAD_ABI,
        functionName: "createToken",
        args: [
          params.name,
          params.symbol,
          {
            imageURI: params.meta.imageURI || "",
            website: params.meta.website || "",
            twitter: params.meta.twitter || "",
            telegram: params.meta.telegram || "",
          },
          simulation.salt,
        ],
        value: simulation.devBuyWei,
        gas: ARCPAD_DEPLOY_GAS_LIMIT,
      });

      logger.info(`[ArcPadAdapter] TX sent: ${txHash}. Awaiting receipt...`);

      // 4. Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 60_000,
      });

      if (receipt.status !== "success") {
        throw new Error(`Transaction reverted on-chain with status ${receipt.status}`);
      }

      // 5. Parse TokenCreated event
      let tokenAddress: Address | undefined;
      let poolAddress: Address | undefined;

      for (const log of receipt.logs) {
        try {
          if (log.address.toLowerCase() === ARC_CURVE_PAD_ADDRESS.toLowerCase()) {
            const decoded = decodeEventLog({
              abi: ARC_CURVE_PAD_ABI,
              data: log.data,
              topics: log.topics,
            });

            if (decoded.eventName === "TokenCreated") {
              const args = decoded.args as any;
              tokenAddress = args.token;
              poolAddress = args.pool;
              break;
            }
          }
        } catch {
          // Continue scanning logs
        }
      }

      const explorerUrl = `${ARC_EXPLORER_DEFAULT}/tx/${txHash}`;
      const arcpadUrl = tokenAddress
        ? `https://arcpad.meme/token/${tokenAddress}`
        : undefined;

      logger.info(
        `[ArcPadAdapter] Token deployed successfully! Address: ${tokenAddress || "N/A"}, Pool: ${poolAddress || "N/A"}`
      );

      return {
        success: true,
        tokenAddress,
        poolAddress,
        transactionHash: txHash,
        blockNumber: receipt.blockNumber,
        name: params.name,
        symbol: params.symbol,
        devBuyAmountUsdc: devBuyNumeric,
        explorerUrl,
        arcpadUrl,
      };
    } catch (err: any) {
      const errorMsg = err?.shortMessage || err?.message || String(err);
      logger.error(`[ArcPadAdapter] Deployment failed: ${errorMsg}`);
      return {
        success: false,
        name: params.name,
        symbol: params.symbol,
        devBuyAmountUsdc: devBuyNumeric,
        error: errorMsg,
      };
    }
  }

  /**
   * Quotes expected swap output on Arc's Uniswap V3 QuoterV2.
   */
  public static async getQuoteExactInput(
    publicClient: PublicClient,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    feeTier: number = ARCPAD_POOL_FEE_TIER
  ): Promise<{ amountOut: bigint; gasEstimate: bigint }> {
    const { result } = await publicClient.simulateContract({
      address: UNISWAP_V3_QUOTER_ADDRESS,
      abi: UNISWAP_V3_QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn,
          tokenOut,
          amountIn,
          fee: feeTier,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    return {
      amountOut: result[0],
      gasEstimate: result[3],
    };
  }
}
