/**
 * src/modules/evm/weth-wrapper.ts — V1.0.0 Auto ETH→WETH Wrapper for Base Mainnet.
 *
 * Wraps native ETH into WETH9 via the WETH9.deposit() payable function.
 * WETH is required to participate in WETH-paired Uniswap V4 pools (e.g. Clanker tokens).
 *
 * INVARIANTS:
 *  1. Read-only before commit: simulateContract MUST pass before writeContract.
 *  2. dryRun=true → simulate only, zero ETH moved.
 *  3. No approval needed: WETH9.deposit() takes ETH as msg.value directly.
 *  4. Gas: ~29-32k units. EIP-1559. Ceiling 1 gwei maxFeePerGas on Base.
 *  5. Fail-safe: never silently swallows errors. Always returns WrapEthResult.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  parseGwei,
  formatEther,
  type Hash,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import { sanitizeSecret } from "./bankr-deployer.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * WETH9 on Base mainnet.
 * OP Stack predeploy at slot 0x06 — identical across all OP Stack L2s.
 * Verified: github.com/clanker-devco/clanker-sdk/constants.ts, basescan.org, docs.base.org
 */
export const WETH9_BASE_ADDRESS =
  "0x4200000000000000000000000000000000000006" as const satisfies Address;

/** Gas limit for WETH9.deposit() (actual ~29k, +20% buffer = 35k). */
export const WETH_DEPOSIT_GAS_LIMIT = 35_000n;

/** Safe EIP-1559 maxFeePerGas for Base L2 (1 gwei ceiling). */
export const WETH_MAX_FEE_PER_GAS = parseGwei("1");

/** Safe EIP-1559 priority fee for Base L2. */
export const WETH_PRIORITY_FEE_PER_GAS = parseGwei("0.001");

// ─── Minimal ABI ─────────────────────────────────────────────────────────────

export const WETH9_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "wad", type: "uint256" }],
    outputs: [],
  },
  {
    name: "Deposit",
    type: "event",
    anonymous: false,
    inputs: [
      { indexed: true,  name: "dst", type: "address" },
      { indexed: false, name: "wad", type: "uint256" },
    ],
  },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WrapEthOptions {
  /** Override Base RPC URL. Defaults to BASE_RPC_URL from config. */
  rpcUrl?: string;
  /** If true, simulate only — no ETH moved. */
  dryRun?: boolean;
  /**
   * Number of confirmations to wait for. Default: 1.
   * Set to 0 for fire-and-forget (returns txHash without waiting).
   */
  confirmations?: number;
  /**
   * Optional viem publicClient override for testing.
   * Production code leaves this undefined.
   */
  publicClientOverride?: any;
  /**
   * Optional viem walletClient override for testing.
   * Production code leaves this undefined.
   */
  walletClientOverride?: any;
}

export interface WrapEthResult {
  success: boolean;
  /** Amount of ETH sent to WETH9.deposit() */
  amountEth: number;
  /** WETH received (= amountEth, 1:1 peg) */
  wethReceived?: number;
  /** ETH gas cost of the deposit tx */
  gasCostEth?: number;
  txHash?: string;
  explorerUrl?: string;
  /** WETH balance after wrap */
  wethBalanceAfter?: number;
  /** Indicates this was a simulation-only run */
  simulated: boolean;
  error?: string;
}

// ─── Core Function ────────────────────────────────────────────────────────────

/**
 * Wraps `amountEth` of native ETH into WETH9 on Base mainnet.
 *
 * @param amountEth — Amount of ETH to wrap (e.g. 0.01)
 * @param options   — dryRun, rpcUrl override, confirmations
 * @returns WrapEthResult
 *
 * @example
 *   const result = await wrapEth(0.01);
 *   console.log(result.txHash); // 0x...
 */
export async function wrapEth(
  amountEth: number,
  options: WrapEthOptions = {}
): Promise<WrapEthResult> {
  if (amountEth <= 0) {
    return {
      success: false,
      amountEth,
      simulated: false,
      error: "INVALID_AMOUNT: amountEth must be > 0",
    };
  }

  const cfg = getConfig();
  const rpcUrl = options.rpcUrl ?? cfg.BASE_RPC_URL;
  const isDryRun = options.dryRun ?? cfg.DRY_RUN ?? false;
  const confirmations = options.confirmations ?? 1;
  const amountWei = parseEther(String(amountEth));

  // ── Setup clients ──
  let rawKey = cfg.EVM_PRIVATE_KEY.trim();
  if (!rawKey.startsWith("0x")) rawKey = "0x" + rawKey;
  const account = privateKeyToAccount(rawKey as `0x${string}`);

  const publicClient = options.publicClientOverride ?? createPublicClient({ chain: base, transport: http(rpcUrl) });
  const walletClient = options.walletClientOverride ?? createWalletClient({ account, chain: base, transport: http(rpcUrl) });

  logger.info(
    `💱 [WETH-WRAP] Wrapping ${amountEth} ETH → WETH on Base. ` +
    `Wallet: ${account.address}. Dry-run: ${isDryRun}`
  );

  // ── Check ETH balance first ──
  const ethBalance = await publicClient.getBalance({ address: account.address });
  if (ethBalance < amountWei) {
    const have = formatEther(ethBalance);
    logger.error(`❌ [WETH-WRAP] Insufficient ETH: have ${have} ETH, need ${amountEth} ETH`);
    return {
      success: false,
      amountEth,
      simulated: false,
      error: `INSUFFICIENT_ETH: have ${have} ETH, need ${amountEth} ETH`,
    };
  }

  // ── Get WETH balance before ──
  let wethBefore = 0n;
  try {
    wethBefore = await publicClient.readContract({
      address:      WETH9_BASE_ADDRESS,
      abi:          WETH9_ABI,
      functionName: "balanceOf",
      args:         [account.address],
    }) as bigint;
    logger.info(`💰 [WETH-WRAP] WETH before: ${formatEther(wethBefore)} WETH`);
  } catch {
    logger.warn(`⚠️  [WETH-WRAP] Could not read WETH balance before.`);
  }

  // ── Simulate first (always) ──
  try {
    await publicClient.simulateContract({
      address:      WETH9_BASE_ADDRESS,
      abi:          WETH9_ABI,
      functionName: "deposit",
      value:        amountWei,
      account:      account.address,
    });
    logger.success(`✅ [WETH-WRAP] Simulation passed.`);
  } catch (simErr: any) {
    const errMsg = simErr?.shortMessage ?? simErr?.message ?? String(simErr);
    logger.error(`❌ [WETH-WRAP] Simulation failed: ${sanitizeSecret(errMsg)}`);
    return {
      success: false,
      amountEth,
      simulated: true,
      error: `SIMULATION_FAILED: ${errMsg}`,
    };
  }

  // ── Dry-run gate ──
  if (isDryRun) {
    logger.warn(`⚠️  [WETH-WRAP] DRY-RUN: simulation passed, no ETH moved.`);
    return {
      success:       true,
      amountEth,
      wethReceived:  amountEth,
      simulated:     true,
    };
  }

  // ── Send live deposit() tx ──
  let txHash: Hash;
  try {
    txHash = await walletClient.writeContract({
      address:              WETH9_BASE_ADDRESS,
      abi:                  WETH9_ABI,
      functionName:         "deposit",
      value:                amountWei,
      gas:                  WETH_DEPOSIT_GAS_LIMIT,
      maxFeePerGas:         WETH_MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: WETH_PRIORITY_FEE_PER_GAS,
    });
    logger.success(`✅ [WETH-WRAP] TX submitted: ${txHash}`);
  } catch (txErr: any) {
    const errMsg = txErr?.shortMessage ?? txErr?.message ?? String(txErr);
    logger.error(`❌ [WETH-WRAP] TX failed: ${sanitizeSecret(errMsg)}`);
    return { success: false, amountEth, simulated: false, error: `TX_FAILED: ${errMsg}` };
  }

  // ── Fire-and-forget path ──
  if (confirmations === 0) {
    return {
      success:      true,
      amountEth,
      wethReceived: amountEth,
      txHash,
      explorerUrl:  `https://basescan.org/tx/${txHash}`,
      simulated:    false,
    };
  }

  // ── Wait for receipt ──
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash:          txHash,
      confirmations,
      timeout:       60_000,
    });

    if (receipt.status !== "success") {
      return {
        success: false, amountEth, txHash, simulated: false,
        error: "TX_REVERTED: WETH deposit reverted on-chain.",
      };
    }

    const gasUsed = BigInt(receipt.gasUsed ?? 0);
    const effectiveGasPrice = BigInt(receipt.effectiveGasPrice ?? 0);
    const gasCostWei = gasUsed * effectiveGasPrice;
    const gasCostEth = parseFloat(formatEther(gasCostWei));

    // ── Get WETH balance after ──
    let wethBalanceAfter: number | undefined;
    try {
      const wethAfter = await publicClient.readContract({
        address:      WETH9_BASE_ADDRESS,
        abi:          WETH9_ABI,
        functionName: "balanceOf",
        args:         [account.address],
      }) as bigint;
      wethBalanceAfter = parseFloat(formatEther(wethAfter));
      logger.success(
        `💰 [WETH-WRAP] WETH after: ${wethBalanceAfter} WETH | Gas: ${gasCostEth.toFixed(8)} ETH`
      );
    } catch {
      logger.warn(`⚠️  [WETH-WRAP] Could not read WETH balance after.`);
    }

    const explorerUrl = `https://basescan.org/tx/${txHash}`;
    logger.success(
      `🎉 [WETH-WRAP] Wrapped ${amountEth} ETH → WETH! Block: ${receipt.blockNumber}. ` +
      `Explorer: ${explorerUrl}`
    );

    return {
      success:         true,
      amountEth,
      wethReceived:    amountEth,
      gasCostEth,
      txHash,
      explorerUrl,
      wethBalanceAfter,
      simulated:       false,
    };
  } catch (waitErr: any) {
    const errMsg = waitErr?.message ?? String(waitErr);
    return {
      success: false, amountEth, txHash, simulated: false,
      error: `RECEIPT_TIMEOUT: ${errMsg}`,
    };
  }
}

/**
 * Returns the current WETH balance of the operator wallet on Base.
 * Read-only — no gas cost.
 */
export async function getWethBalance(
  address?: string,
  rpcUrl?: string,
  publicClientOverride?: any
): Promise<number> {
  const cfg = getConfig();
  const rpc = rpcUrl ?? cfg.BASE_RPC_URL;

  let walletAddr: Address;
  if (address) {
    walletAddr = address as Address;
  } else {
    let rawKey = cfg.EVM_PRIVATE_KEY.trim();
    if (!rawKey.startsWith("0x")) rawKey = "0x" + rawKey;
    walletAddr = privateKeyToAccount(rawKey as `0x${string}`).address;
  }

  const publicClient = publicClientOverride ?? createPublicClient({ chain: base, transport: http(rpc) });
  try {
    const raw = await publicClient.readContract({
      address:      WETH9_BASE_ADDRESS,
      abi:          WETH9_ABI,
      functionName: "balanceOf",
      args:         [walletAddr],
    }) as bigint;
    return parseFloat(formatEther(raw));
  } catch {
    return 0;
  }
}
