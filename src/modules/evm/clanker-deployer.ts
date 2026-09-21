/**
 * src/modules/evm/clanker-deployer.ts — Clanker v4 Token Deployer Adapter.
 *
 * Deploys tokens via the Clanker v4 factory contract on Base mainnet (Uniswap v4)
 * using viem walletClient / Clanker SDK. NO external API key required.
 *
 * INVARIANTS:
 *  1. Operator pays gas directly (~0.00003–0.0002 ETH per deploy on Base).
 *  2. Uses official clanker-sdk/v4 & ClankerDeployments for Base mainnet.
 *  3. Simulation (simulateContract) MUST succeed before live writeContract.
 *  4. Returns ClankerDeployResult compatible with existing deployer interfaces.
 *  5. Dry-run: simulate only, no TX sent.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  formatEther,
  decodeEventLog,
  type Hash,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { Clanker as ClankerV4 } from "clanker-sdk/v4";
import { ClankerDeployments } from "clanker-sdk";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import { sanitizeSecret } from "./bankr-deployer.ts";
import type { TokenIdentity } from "../ai/gemini-brain.ts";
import type { UploadResult } from "../ipfs/pinata-uploader.ts";

// ─── Chain Constants ──────────────────────────────────────────────────────────

/** Clanker v4 Factory contract on Base mainnet. */
export const CLANKER_V4_FACTORY_ADDRESS =
  (ClankerDeployments["8453"]?.clanker_v4?.address ??
    "0xE85A59c628F7d27878ACeB4bf3b35733630083a9") as Address;

/** Backward-compatible alias for previous constant name. */
export const CLANKER_V3_1_FACTORY_ADDRESS = CLANKER_V4_FACTORY_ADDRESS;

/** WETH9 on Base mainnet (OP Stack predeploy). */
export const WETH9_BASE_ADDRESS =
  "0x4200000000000000000000000000000000000006" as Address;

/** Clanker SDK interface label — identifies this operator in on-chain provenance. */
export const CLANKER_INTERFACE_LABEL = "SDK";

/** Default initial market cap for new Clanker pools (wei). */
export const CLANKER_DEFAULT_INITIAL_MARKETCAP_WEI = parseEther("10");

/** Gas limit for Clanker deployToken call (Uniswap v4 pool + locker + MEV module init takes ~4.1M). */
export const CLANKER_DEPLOY_GAS_LIMIT = 5_000_000n;

/** Base Clanker launchpad token viewer URL. */
export const CLANKER_LAUNCHPAD_URL = "https://www.clanker.world/clanker/";

/** ABI for Clanker v4 factory contract. */
export const CLANKER_V4_ABI = (ClankerDeployments as any)["8453"].clanker_v4.abi;

/** Backward-compatible alias for previous ABI name. */
export const CLANKER_V3_1_ABI = CLANKER_V4_ABI;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClankerDeployOptions {
  /** Optional dev buy in ETH (bought in same tx as deploy). Default: 0 */
  devBuyEth?: number;
  /** Creator reward % for liquidity fees. Default: 40 */
  creatorRewardPct?: number;
  /** If true, only simulate — never send live TX. */
  dryRun?: boolean;
  /** Override RPC URL (defaults to BASE_RPC_URL from config). */
  rpcUrl?: string;
  /** Initial pool market cap in ETH. Default: 10 */
  initialMarketCapEth?: number;
  /**
   * Optional viem publicClient override.
   * When provided (e.g. in tests), the real RPC client is NOT created.
   */
  publicClientOverride?: any;
  /**
   * Optional viem walletClient override.
   * When provided (e.g. in tests), the real wallet client is NOT created.
   */
  walletClientOverride?: any;
  /** Optional explicit deployer private key (0x...). If omitted, falls back to EVM_PRIVATE_KEY from config. */
  deployerPrivateKey?: string;
  /** Optional custom fee recipient address. If omitted, defaults to deployer account address. */
  feeRecipientAddress?: Address;
}

/** Minimal asset info needed by deployer (subset of UploadResult). */
export interface ClankerAssetInput {
  /** IPFS URI or HTTP URL for the token logo image. */
  imageUrl?: string;
  /** Alternative: IPFS URI form (ipfs://...). */
  ipfsImageUri?: string;
}

export interface ClankerDeployResult {
  success: boolean;
  tokenAddress?: string;
  poolAddress?: string;
  txHash?: string;
  chain: "clanker";
  name?: string;
  ticker?: string;
  explorerUrl?: string;
  deployCostEth?: number;
  gasUsed?: bigint;
  error?: string;
  simulated: boolean;
}

// ─── Core Deployer ────────────────────────────────────────────────────────────

/**
 * Deploys a token via Clanker v4 factory on Base mainnet (Uniswap v4).
 */
export async function deployClanker(
  identity: TokenIdentity,
  assets: ClankerAssetInput,
  options: ClankerDeployOptions = {}
): Promise<ClankerDeployResult> {
  const cfg = getConfig();
  const rpcUrl = options.rpcUrl ?? cfg.BASE_RPC_URL;
  const isDryRun = options.dryRun ?? cfg.DRY_RUN ?? false;
  const devBuyEth = options.devBuyEth ?? cfg.CLANKER_DEV_BUY_ETH ?? 0;

  // ── Build account from deployerPrivateKey or EVM_PRIVATE_KEY ──
  let rawKey = (options.deployerPrivateKey || cfg.EVM_PRIVATE_KEY).trim();
  if (!rawKey.startsWith("0x")) rawKey = "0x" + rawKey;
  const account = privateKeyToAccount(rawKey as `0x${string}`);

  const publicClient =
    options.publicClientOverride ??
    createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient =
    options.walletClientOverride ??
    createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  logger.info(
    `🚀 [CLANKER] Deploying "${identity.name}" ($${identity.ticker}) via Clanker v4. ` +
    `Dev buy: ${devBuyEth} ETH. Dry-run: ${isDryRun}`
  );
  logger.info(`🔑 [CLANKER] Deployer EOA: ${account.address}`);
  logger.info(`🔗 [CLANKER] Factory: ${CLANKER_V4_FACTORY_ADDRESS}`);

  // ── Resolve image URL ──
  const imageUrl: string =
    assets.ipfsImageUri ||
    assets.imageUrl ||
    "";

  // ── Prepare social URLs (Array of Objects for Clanker v4) ──
  const socialMediaUrls: { platform: string; url: string }[] = [];
  if (identity.twitter && identity.twitter.startsWith("http")) {
    socialMediaUrls.push({ platform: "x", url: identity.twitter });
  }
  if (identity.telegram && identity.telegram.startsWith("http")) {
    socialMediaUrls.push({ platform: "telegram", url: identity.telegram });
  }
  if (identity.website && identity.website.startsWith("http")) {
    socialMediaUrls.push({ platform: "website", url: identity.website });
  }

  // ── Build Clanker v4 token config ──
  const feeRecipient = options.feeRecipientAddress ?? account.address;
  const tokenConfig = {
    name: identity.name,
    symbol: identity.ticker,
    image: imageUrl,
    tokenAdmin: account.address as Address,
    metadata: {
      description: identity.description ?? "",
      socialMediaUrls,
      auditUrls: [],
    },
    context: {
      interface: CLANKER_INTERFACE_LABEL,
    },
    rewards: {
      recipients: [
        {
          admin: account.address as Address,
          recipient: feeRecipient as Address,
          bps: 10000,
          token: "Both" as const,
        },
      ],
    },
    ...(devBuyEth > 0 ? { devBuy: { ethAmount: parseEther(String(devBuyEth)) } } : {}),
  };

  let deployTxData: {
    address: Address;
    abi: any;
    functionName: string;
    args: any[];
    value?: bigint;
    expectedAddress?: string;
  };

  try {
    const v4 = new ClankerV4({ publicClient: publicClient as any });
    deployTxData = (await (v4 as any).getDeployTransaction(tokenConfig as any, account.address)) as any;
  } catch (prepErr: any) {
    const errMsg = prepErr?.message ?? String(prepErr);
    logger.error(`❌ [CLANKER] Failed to prepare v4 deploy transaction: ${sanitizeSecret(errMsg)}`);
    return { success: false, chain: "clanker", error: `CONFIG_ERROR: ${errMsg}`, simulated: isDryRun };
  }

  const expectedAddress = deployTxData.expectedAddress;

  // ── Simulate first (always) ──
  logger.info(`🔍 [CLANKER] Simulating deployToken...`);
  try {
    await publicClient.simulateContract({
      address: deployTxData.address,
      abi: deployTxData.abi,
      functionName: deployTxData.functionName,
      args: deployTxData.args,
      account: account.address as Address,
      value: deployTxData.value ?? 0n,
    });
    logger.success(`✅ [CLANKER] Simulation passed.`);
  } catch (simErr: any) {
    const errMsg = simErr?.shortMessage ?? simErr?.message ?? String(simErr);
    logger.error(`❌ [CLANKER] Simulation failed: ${sanitizeSecret(errMsg)}`);
    return { success: false, chain: "clanker", error: `SIMULATION_FAILED: ${errMsg}`, simulated: true };
  }

  // ── Dry-run gate ──
  if (isDryRun) {
    logger.warn(`⚠️  [CLANKER] DRY-RUN: simulation passed, no TX sent.`);
    return {
      success: true,
      chain: "clanker",
      name: identity.name,
      ticker: identity.ticker,
      tokenAddress: expectedAddress,
      simulated: true,
    };
  }

  // ── Send live transaction ──
  logger.info(`📡 [CLANKER] Sending deployToken transaction...`);
  let txHash: Hash;
  try {
    txHash = await walletClient.writeContract({
      address: deployTxData.address,
      abi: deployTxData.abi,
      functionName: deployTxData.functionName,
      args: deployTxData.args,
      gas: CLANKER_DEPLOY_GAS_LIMIT,
      value: deployTxData.value ?? 0n,
    });
    logger.success(`✅ [CLANKER] TX submitted: ${txHash}`);
  } catch (txErr: any) {
    const errMsg = txErr?.shortMessage ?? txErr?.message ?? String(txErr);
    logger.error(`❌ [CLANKER] TX submission failed: ${sanitizeSecret(errMsg)}`);
    return { success: false, chain: "clanker", error: `TX_FAILED: ${errMsg}`, simulated: false };
  }

  // ── Wait for receipt ──
  logger.info(`⏳ [CLANKER] Waiting for confirmation...`);
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 2,
      timeout: 120_000,
    });

    if (receipt.status !== "success") {
      logger.error(`❌ [CLANKER] TX reverted. Hash: ${txHash}`);
      return { success: false, chain: "clanker", txHash, error: "TX_REVERTED", simulated: false };
    }

    // ── Parse TokenCreated event from logs ──
    let tokenAddress: string | undefined = expectedAddress;
    let poolAddress: string | undefined;
    for (const log of receipt.logs) {
      try {
        const decoded: any = decodeEventLog({
          abi: CLANKER_V4_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "TokenCreated") {
          tokenAddress = (decoded.args as any).tokenAddress as string;
          poolAddress = (decoded.args as any).poolId as string;
          break;
        }
      } catch { /* non-matching log */ }
    }

    const gasUsed = BigInt(receipt.gasUsed ?? 0);
    const effectiveGasPrice = BigInt(receipt.effectiveGasPrice ?? 0);
    const deployCostEth = parseFloat(formatEther(gasUsed * effectiveGasPrice));
    const explorerUrl = tokenAddress
      ? `https://basescan.org/token/${tokenAddress}`
      : `https://basescan.org/tx/${txHash}`;

    logger.success(
      `🎉 [CLANKER] Token deployed!\n` +
      `   Token: ${tokenAddress ?? "unknown"} | Pool: ${poolAddress ?? "unknown"}\n` +
      `   TX: ${txHash} | Gas: ${gasUsed} units | Cost: ${deployCostEth.toFixed(8)} ETH`
    );

    return {
      success: true,
      tokenAddress,
      poolAddress,
      txHash,
      chain: "clanker",
      name: identity.name,
      ticker: identity.ticker,
      explorerUrl,
      deployCostEth,
      gasUsed,
      simulated: false,
    };
  } catch (waitErr: any) {
    const errMsg = waitErr?.message ?? String(waitErr);
    logger.error(`❌ [CLANKER] Wait for receipt failed: ${sanitizeSecret(errMsg)}`);
    return { success: false, chain: "clanker", txHash, error: `RECEIPT_TIMEOUT: ${errMsg}`, simulated: false };
  }
}

/**
 * Estimates the deploy cost for a Clanker token (gas only, read-only).
 */
export async function estimateClankerDeployCost(
  identity: Pick<TokenIdentity, "name" | "ticker">,
  options: Pick<ClankerDeployOptions, "devBuyEth" | "rpcUrl"> = {}
): Promise<{ estimatedGasUnits: bigint; estimatedEth: number }> {
  const cfg = getConfig();
  const rpcUrl = options.rpcUrl ?? cfg.BASE_RPC_URL;
  const devBuyEth = options.devBuyEth ?? cfg.CLANKER_DEV_BUY_ETH ?? 0;

  let rawKey = cfg.EVM_PRIVATE_KEY.trim();
  if (!rawKey.startsWith("0x")) rawKey = "0x" + rawKey;
  const account = privateKeyToAccount(rawKey as `0x${string}`);

  const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });

  try {
    const v4 = new ClankerV4({ publicClient: publicClient as any });
    const deployTxData = (await (v4 as any).getDeployTransaction({
      name: identity.name,
      symbol: identity.ticker,
      image: "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
      tokenAdmin: account.address,
      ...(devBuyEth > 0 ? { devBuy: { ethAmount: parseEther(String(devBuyEth)) } } : {}),
    })) as any;

    const estimatedGasUnits: bigint = await publicClient.estimateContractGas({
      address: deployTxData.address,
      abi: deployTxData.abi,
      functionName: deployTxData.functionName,
      args: deployTxData.args,
      account: account.address as Address,
      value: deployTxData.value ?? 0n,
    });

    const block = await publicClient.getBlock({ blockTag: "latest" });
    const baseFee = block.baseFeePerGas ?? 10_000_000n;
    const estimatedEth = parseFloat(formatEther(estimatedGasUnits * (baseFee * 2n)));

    return { estimatedGasUnits, estimatedEth };
  } catch {
    return { estimatedGasUnits: CLANKER_DEPLOY_GAS_LIMIT, estimatedEth: 0.0003 };
  }
}
