/**
 * evm-verifier.ts — Direct on-chain EVM / Base verification using viem.
 *
 * Responsibilities:
 *  - Verifies mined transaction receipts on Base / Robinhood.
 *  - Distinguishes "confirmed" (mined success), "failed" (reverted), "pending" (not mined yet),
 *    and "unknown" (RPC timeout/failure — NEVER assume failed on RPC error!).
 *  - Reads ERC-20 raw token balances via balanceOf(address) and decimals().
 *  - Uses integer/bigint math for token amounts, preventing floating-point drift.
 */
import {
  createPublicClient,
  http,
  formatUnits,
  formatEther,
  type PublicClient,
  type TransactionReceipt,
  type Address,
  defineChain,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import { sanitizeSecret } from "../evm/bankr-deployer.ts";
import { getArcPublicClient } from "../arc/index.ts";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.robinhoodchain.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const arbitrumChain = defineChain({
  id: 42161,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://arb1.arbitrum.io/rpc"] },
  },
  blockExplorers: {
    default: { name: "Arbiscan", url: "https://arbiscan.io" },
  },
});

const ERC20_MINIMAL_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
] as const;

export interface EvmReceiptVerification {
  status: "confirmed" | "pending" | "failed" | "not_found" | "unknown" | "error";
  receipt?: TransactionReceipt;
  blockNumber?: bigint;
  contractAddress?: string;
  reason?: string;
}

export interface EvmTokenBalance {
  rawBalance: bigint;
  balanceString: string;
  decimals: number;
  formattedBalance: string;
}

/**
 * Returns a configured viem public client for the specified EVM chain.
 */
export function getEvmPublicClient(chain = "base"): PublicClient<any, any> | null {
  const cfg = getConfig();
  const normalized = chain.trim().toLowerCase();

  if (normalized === "base" || normalized === "clanker") {
    return createPublicClient({
      chain: base,
      transport: http(cfg.BASE_RPC_URL, { timeout: cfg.API_TIMEOUT_MS ?? 15000 }),
    });
  }

  if (normalized === "robinhood") {
    return createPublicClient({
      chain: robinhoodChain,
      transport: http(cfg.ROBINHOOD_RPC_URL, { timeout: cfg.API_TIMEOUT_MS ?? 15000 }),
    });
  }

  if (normalized === "arbitrum") {
    return createPublicClient({
      chain: arbitrumChain,
      transport: http(cfg.ARBITRUM_RPC_URL, { timeout: cfg.API_TIMEOUT_MS ?? 15000 }),
    });
  }

  if (normalized === "arc") {
    return getArcPublicClient() as any;
  }

  logger.warn(`⚠️  [EVM VERIFIER] Chain '${chain}' is not supported. Supported: 'base', 'robinhood', 'arbitrum', 'arc'.`);
  return null;
}

/**
 * Derives EVM address from private key safely.
 */
export function deriveEvmAddress(privateKeyHex?: string): string | null {
  try {
    const key = privateKeyHex ?? getConfig().EVM_PRIVATE_KEY;
    if (!key) return null;
    const formatted = key.startsWith("0x") ? key : `0x${key}`;
    return privateKeyToAccount(formatted as `0x${string}`).address;
  } catch {
    return null;
  }
}

/**
 * Verifies transaction status on-chain.
 * Rule: RPC failure returns status: "unknown", NEVER "failed".
 */
export async function verifyEvmTransactionReceipt(
  txHash: string,
  chain = "base",
  customClient?: PublicClient<any, any>
): Promise<EvmReceiptVerification> {
  const sanitizedHash = sanitizeSecret(txHash);

  if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return {
      status: "error",
      reason: `Malformed EVM transaction hash: '${sanitizedHash}'`,
    };
  }

  try {
    const client = customClient ?? getEvmPublicClient(chain);
    if (!client) {
      return {
        status: "error",
        reason: `UNSUPPORTED_EVM_CHAIN: Chain '${chain}' is not supported by EVM verifier`,
      };
    }
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (!receipt) {
      return {
        status: "pending",
        reason: "Transaction receipt not yet found on-chain",
      };
    }

    if (receipt.status === "success") {
      return {
        status: "confirmed",
        receipt,
        blockNumber: receipt.blockNumber,
        contractAddress: receipt.contractAddress ?? undefined,
      };
    }

    if (receipt.status === "reverted") {
      return {
        status: "failed",
        receipt,
        blockNumber: receipt.blockNumber,
        reason: "Transaction reverted on-chain (execution failure)",
      };
    }

    return {
      status: "unknown",
      reason: `Unrecognized receipt status: ${receipt.status}`,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const sanitizedErr = sanitizeSecret(errMsg);

    // If transaction is not mined yet (TransactionNotFoundError), it's pending
    if (sanitizedErr.includes("TransactionNotFoundError") || sanitizedErr.includes("could not be found")) {
      return {
        status: "pending",
        reason: "Transaction is not yet mined or propagated to this RPC node",
      };
    }

    // Network, RPC timeout, or node connectivity issues MUST be classified as "unknown"
    logger.warn(`⚠️  [EVM VERIFIER] RPC error while checking receipt for ${sanitizedHash}: ${sanitizedErr}`);
    return {
      status: "unknown",
      reason: `RPC_FAILURE: ${sanitizedErr}`,
    };
  }
}

export interface EvmDeploymentAttribution {
  status: "confirmed" | "pending" | "failed" | "unresolved" | "mismatch" | "unknown" | "error" | "not_found";
  attributedAddress?: string;
  attributionType?: "direct_contract_creation" | "factory_log_emitter" | "factory_topic_reference" | "none";
  reason?: string;
  receipt?: TransactionReceipt;
}

/**
 * Verifies deployment attribution: ensures transaction receipt and emitted logs
 * genuinely match the expected token contract address (direct or factory launch).
 */
export async function verifyEvmDeploymentAttribution(
  txHash: string,
  expectedTokenAddress?: string,
  chain = "base",
  customClient?: PublicClient<any, any>
): Promise<EvmDeploymentAttribution> {
  const receiptResult = await verifyEvmTransactionReceipt(txHash, chain, customClient);

  if (receiptResult.status !== "confirmed" || !receiptResult.receipt) {
    return {
      status: receiptResult.status,
      reason: receiptResult.reason,
    };
  }

  const receipt = receiptResult.receipt;

  // 1. Direct contract creation
  if (receipt.contractAddress) {
    const directAddr = receipt.contractAddress;
    if (expectedTokenAddress) {
      if (directAddr.toLowerCase() === expectedTokenAddress.toLowerCase()) {
        return {
          status: "confirmed",
          attributedAddress: directAddr,
          attributionType: "direct_contract_creation",
          receipt,
        };
      }
      return {
        status: "mismatch",
        reason: `Contract address in receipt '${directAddr}' does not match expected token address '${expectedTokenAddress}'`,
        receipt,
      };
    }
    return {
      status: "confirmed",
      attributedAddress: directAddr,
      attributionType: "direct_contract_creation",
      receipt,
    };
  }

  // 2. Factory deployment inspection (receipt.contractAddress is null/undefined)
  if (!expectedTokenAddress) {
    return {
      status: "unresolved",
      reason: "Transaction was successful but was executed via factory and no expectedTokenAddress was provided to attribute",
      receipt,
    };
  }

  const target = expectedTokenAddress.toLowerCase();
  const targetClean = target.replace(/^0x/, "");
  const logs = receipt.logs || [];

  if (logs.length === 0) {
    return {
      status: "unresolved",
      reason: "No event logs emitted in transaction to attribute factory token deployment",
      receipt,
    };
  }

  // Check A: Is target address the emitter of any event?
  const emitterMatch = logs.some((log) => log.address?.toLowerCase() === target);
  if (emitterMatch) {
    return {
      status: "confirmed",
      attributedAddress: expectedTokenAddress,
      attributionType: "factory_log_emitter",
      receipt,
    };
  }

  // Check B: Is target address present in topics or data of any event?
  const topicOrDataMatch = logs.some((log) => {
    const inTopics = log.topics?.some((t) => t?.toLowerCase().includes(targetClean));
    const inData = log.data?.toLowerCase().includes(targetClean);
    return Boolean(inTopics || inData);
  });

  if (topicOrDataMatch) {
    return {
      status: "confirmed",
      attributedAddress: expectedTokenAddress,
      attributionType: "factory_topic_reference",
      receipt,
    };
  }

  return {
    status: "unresolved",
    reason: `Transaction succeeded on-chain, but no logs or event references match expected token address '${expectedTokenAddress}'`,
    receipt,
  };
}

export interface EvmTransactionAttribution {
  status: "confirmed" | "pending" | "failed" | "unresolved" | "unknown" | "error" | "not_found";
  receipt?: TransactionReceipt;
  tokenTransferred?: boolean;
  walletInvolved?: boolean;
  reason?: string;
}

/**
 * Verifies that a transaction hash corresponds to a confirmed buy/sell transaction
 * involving the expected token and wallet address.
 */
export async function verifyEvmTransactionAttribution(
  txHash: string,
  expectedTokenAddress?: string,
  expectedWallet?: string,
  chain = "base",
  customClient?: PublicClient<any, any>
): Promise<EvmTransactionAttribution> {
  const receiptResult = await verifyEvmTransactionReceipt(txHash, chain, customClient);
  if (receiptResult.status !== "confirmed" || !receiptResult.receipt) {
    return {
      status: receiptResult.status,
      reason: receiptResult.reason,
    };
  }

  const receipt = receiptResult.receipt;
  let tokenTransferred = false;
  let walletInvolved = false;

  const logs = receipt.logs || [];
  if (expectedTokenAddress) {
    const targetToken = expectedTokenAddress.toLowerCase().replace(/^0x/, "");
    tokenTransferred = logs.some(
      (log) =>
        log.address?.toLowerCase() === expectedTokenAddress.toLowerCase() ||
        log.topics?.some((t) => t?.toLowerCase().includes(targetToken)) ||
        log.data?.toLowerCase().includes(targetToken)
    );
  }

  if (expectedWallet) {
    const targetWallet = expectedWallet.toLowerCase().replace(/^0x/, "");
    walletInvolved =
      receipt.from?.toLowerCase() === expectedWallet.toLowerCase() ||
      receipt.to?.toLowerCase() === expectedWallet.toLowerCase() ||
      logs.some(
        (log) =>
          log.topics?.some((t) => t?.toLowerCase().includes(targetWallet)) ||
          log.data?.toLowerCase().includes(targetWallet)
      );
  }

  return {
    status: "confirmed",
    receipt,
    tokenTransferred,
    walletInvolved,
  };
}

/**
 * Reads token balance directly from ERC-20 contract using standard balanceOf.
 */
export async function verifyEvmTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  chain = "base",
  customClient?: PublicClient<any, any>
): Promise<EvmTokenBalance | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress) || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return null;
  }

  try {
    const client = customClient ?? getEvmPublicClient(chain);
    if (!client) return null;

    // 1. Fetch decimals (default to 18 if call fails)
    let decimals = 18;
    try {
      decimals = await client.readContract({
        address: tokenAddress as Address,
        abi: ERC20_MINIMAL_ABI,
        functionName: "decimals",
      });
    } catch {
      decimals = 18;
    }

    // 2. Fetch raw balance
    const rawBalance = await client.readContract({
      address: tokenAddress as Address,
      abi: ERC20_MINIMAL_ABI,
      functionName: "balanceOf",
      args: [walletAddress as Address],
    });

    const balanceString = rawBalance.toString();
    const formattedBalance = formatUnits(rawBalance, decimals);

    return {
      rawBalance,
      balanceString,
      decimals,
      formattedBalance,
    };
  } catch (err) {
    logger.warn(`⚠️  [EVM VERIFIER] Failed to read token balance: ${sanitizeSecret(String(err))}`);
    return null;
  }
}

export const BANKR_BASE_RELAYER_ADDRESS = "0x2915637a5f4b83b4097fc0b2eae2fe3c1c761465";
export const BANKR_BASE_RELAYER_ADDRESSES: string[] = [
  "0x2915637a5f4b83b4097fc0b2eae2fe3c1c761465".toLowerCase(),
  "0xf7932df89827d9cbd13a12571bb4db9da67aaf75".toLowerCase(),
];

export function isBankrRelayer(address?: string | null): boolean {
  if (!address) return false;
  return BANKR_BASE_RELAYER_ADDRESSES.includes(address.toLowerCase());
}

export interface EvmGasSponsorshipVerification {
  isSponsored: boolean;
  gasPayer: string;
  networkGasCostEth: number;
  deployerGasCostEth: number;
  gasUsed: string;
  effectiveGasPriceGwei: number;
  status: "SPONSORED" | "PAID" | "UNKNOWN";
  summary: string;
}

/**
 * Accurately analyzes gas payer, sponsorship status, and deployment cost from an EVM TransactionReceipt.
 * Rules:
 *  - On Base: If receipt.from matches expected Bankr relayer:
 *    sponsorship = SPONSORED, deployerGasCostEth = 0.0.
 *  - If receipt.from matches operator address:
 *    sponsorship = PAID, deployerGasCostEth = networkGasCostEth.
 *  - All other senders or unverified relayers:
 *    sponsorship = UNKNOWN (never false positive SPONSORED).
 */
export function calculateEvmDeploymentCost(
  receipt: TransactionReceipt,
  operatorAddress?: string | null,
  chain = "base",
  expectedRelayer = BANKR_BASE_RELAYER_ADDRESS
): EvmGasSponsorshipVerification {
  const normalizedChain = chain.trim().toLowerCase();
  const gasPayer = receipt.from?.toLowerCase() ?? "";
  const relayer = expectedRelayer.toLowerCase();
  const operator = operatorAddress?.toLowerCase() ?? "";

  const gasUsedBig = receipt.gasUsed ?? 0n;
  const gasPriceBig = receipt.effectiveGasPrice ?? 0n;
  const rawCostWei = gasUsedBig * gasPriceBig;
  const networkGasCostEth = parseFloat(formatEther(rawCostWei));
  const effectiveGasPriceGwei = Number(gasPriceBig) / 1e9;

  let status: "SPONSORED" | "PAID" | "UNKNOWN" = "UNKNOWN";
  let isSponsored = false;
  let deployerGasCostEth = networkGasCostEth;

  const isRelayer =
    relayer === gasPayer || isBankrRelayer(gasPayer);

  if (normalizedChain === "base" && isRelayer) {
    status = "SPONSORED";
    isSponsored = true;
    deployerGasCostEth = 0.0;
  } else if (operator && gasPayer === operator) {
    status = "PAID";
    isSponsored = false;
    deployerGasCostEth = networkGasCostEth;
  } else {
    // Unverified relayer or unknown sender -> FAIL-SAFE UNKNOWN
    status = "UNKNOWN";
    isSponsored = false;
    deployerGasCostEth = networkGasCostEth;
  }

  const summary =
    status === "SPONSORED"
      ? `Gas SPONSORED by Base relayer ${gasPayer.slice(0, 10)}... (Network: ${networkGasCostEth.toFixed(6)} ETH, Cost to Deployer: 0 ETH)`
      : status === "PAID"
      ? `Gas PAID by deployer ${gasPayer.slice(0, 10)}... (Cost: ${networkGasCostEth.toFixed(6)} ETH)`
      : `Gas payer ${gasPayer ? gasPayer.slice(0, 10) + "..." : "N/A"} UNKNOWN (Network: ${networkGasCostEth.toFixed(6)} ETH)`;

  return {
    isSponsored,
    gasPayer,
    networkGasCostEth,
    deployerGasCostEth,
    gasUsed: gasUsedBig.toString(),
    effectiveGasPriceGwei,
    status,
    summary,
  };
}

export interface EvmContractExistence {
  exists: boolean;
  status: "confirmed" | "not_found" | "unknown";
  bytecodeSize?: number;
  reason?: string;
}

/**
 * Read-only check to verify if a contract exists on an EVM chain (has non-empty bytecode).
 * Returns status: "unknown" on RPC failure (NEVER false positive "not_found").
 */
export async function verifyEvmContractExists(
  tokenAddress: string,
  chain = "base",
  customClient?: PublicClient<any, any>
): Promise<EvmContractExistence> {
  const sanitized = sanitizeSecret(tokenAddress);
  if (!tokenAddress || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    return { exists: false, status: "not_found", reason: `Malformed EVM address: '${sanitized}'` };
  }

  try {
    const client = customClient ?? getEvmPublicClient(chain);
    if (!client) {
      return { exists: false, status: "unknown", reason: `UNSUPPORTED_CHAIN: Chain '${chain}' not supported` };
    }

    const bytecode = await client.getBytecode({ address: tokenAddress as Address });
    const hasBytecode = Boolean(bytecode && bytecode !== "0x");
    const bytecodeSize = bytecode && bytecode !== "0x" ? (bytecode.length - 2) / 2 : 0;

    return {
      exists: hasBytecode,
      status: hasBytecode ? "confirmed" : "not_found",
      bytecodeSize,
      reason: hasBytecode ? "Contract bytecode verified on-chain" : "No contract bytecode deployed at address (EOA or non-existent)",
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️  [EVM VERIFIER] RPC error while checking bytecode for ${sanitized}: ${sanitizeSecret(errMsg)}`);
    return {
      exists: false,
      status: "unknown",
      reason: `RPC_FAILURE: ${errMsg}`,
    };
  }
}

