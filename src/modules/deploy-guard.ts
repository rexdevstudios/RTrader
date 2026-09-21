/**
 * deploy-guard.ts — Strict deployment verification and safety guards.
 *
 * Rules:
 *  - simulation  -> NO BUY (returns confirmed: false, isSimulation: true)
 *  - unknown     -> NO BUY (returns confirmed: false, isUnknown: true)
 *  - failed      -> NO BUY (returns confirmed: false)
 *  - missing addr-> NO BUY (returns confirmed: false)
 *  - unconfirmed -> NO BUY (returns confirmed: false)
 *  - confirmed   -> MAY BUY (returns confirmed: true)
 */
import type { DeployResult } from "./solana/pumpfun-deployer.ts";
import type { TokenIdentity } from "./ai/gemini-brain.ts";
import type { UploadResult } from "./ipfs/pinata-uploader.ts";
import { acquireLock, releaseLock, getTodayDeployCount } from "../db/vault.ts";
import { getConfig } from "../config.ts";
import { logger } from "../logger.ts";
import {
  checkEvmNativeBalance,
  checkSolanaNativeBalance,
} from "./identity/preflight-balance.ts";

export interface DeploymentConfirmation {
  confirmed: boolean;
  reason?: string;
  isSimulation: boolean;
  isUnknown: boolean;
}

/**
 * Validates EVM address format: 0x followed by 40 hex characters.
 */
export function isValidEvmAddress(address: string): boolean {
  return typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validates Solana public key format: Base58 string of length 32 to 44.
 */
export function isValidSolanaAddress(address: string): boolean {
  return typeof address === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

/**
 * Validates that contract address matches expected format for chain.
 */
export function isValidContractAddressForChain(address: string, chain: string): boolean {
  const normalized = chain.trim().toLowerCase();
  if (normalized === "solana") {
    return isValidSolanaAddress(address);
  }
  // EVM chains: base, robinhood, ethereum, bsc
  return isValidEvmAddress(address);
}

/**
 * Validates transaction hash format.
 */
export function isValidTxHash(txHash: string, chain: string): boolean {
  if (typeof txHash !== "string" || txHash.length === 0) return false;
  const normalized = chain.trim().toLowerCase();
  if (normalized === "solana") {
    return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(txHash);
  }
  return /^0x[a-fA-F0-9]{64}$/.test(txHash);
}

/**
 * Pure, strict verification of deployment outcome before downstream actions.
 */
export function confirmDeployment(
  result: DeployResult | null | undefined,
  requestedChain: string
): DeploymentConfirmation {
  if (!result || typeof result !== "object") {
    return {
      confirmed: false,
      isSimulation: false,
      isUnknown: false,
      reason: "Deployment result is null, undefined, or not an object",
    };
  }

  // 1. Simulation guard
  if (result.simulated === true) {
    return {
      confirmed: false,
      isSimulation: true,
      isUnknown: false,
      reason: "Deployment was a simulation (no on-chain contract created)",
    };
  }

  // 2. Unknown / ambiguous outcome guard
  if (result.status === "unknown") {
    return {
      confirmed: false,
      isSimulation: false,
      isUnknown: true,
      reason: result.error || "Deployment outcome is ambiguous/unknown (timeout or network partition)",
    };
  }

  // 3. Explicit success & status guard
  if (!result.success || result.status === "failed") {
    return {
      confirmed: false,
      isSimulation: false,
      isUnknown: false,
      reason: result.error || "Deployment failed",
    };
  }

  // 4. Contract address existence and format guard
  if (!result.contractAddress || typeof result.contractAddress !== "string") {
    return {
      confirmed: false,
      isSimulation: false,
      isUnknown: false,
      reason: "Missing contract address in successful deployment result",
    };
  }

  if (!isValidContractAddressForChain(result.contractAddress, requestedChain)) {
    return {
      confirmed: false,
      isSimulation: false,
      isUnknown: false,
      reason: `Invalid contract address format '${result.contractAddress}' for chain '${requestedChain}'`,
    };
  }

  // 5. Transaction hash existence
  if (!result.txHash || typeof result.txHash !== "string") {
    return {
      confirmed: false,
      isSimulation: false,
      isUnknown: false,
      reason: "Confirmed on-chain deployment requires a valid transaction hash",
    };
  }

  // 6. Transaction hash format validation for the requested chain
  if (!isValidTxHash(result.txHash, requestedChain)) {
    return {
      confirmed: false,
      isSimulation: false,
      isUnknown: false,
      reason: `Transaction hash '${result.txHash.slice(0, 16)}...' has invalid format for chain '${requestedChain}'`,
    };
  }

  return {
    confirmed: true,
    isSimulation: false,
    isUnknown: false,
  };
}

export interface DeploymentSafetyReport {
  safe: boolean;
  score: number; // 0 to 100
  issues: string[];
  warnings: string[];
  checks: {
    nameValid: boolean;
    tickerValid: boolean;
    descriptionValid: boolean;
    imagePinned: boolean;
    socialsComplete: boolean;
  };
}

/**
 * Validates pre-deployment safety parameters to ensure the token satisfies
 * public scanner safety criteria (Rick Bot / TTF Bot / DexScreener).
 */
export function verifyDeploymentSafetyParameters(
  identity: {
    name: string;
    ticker: string;
    description?: string;
    website?: string;
    twitter?: string;
  },
  assets: {
    imageUrl?: string;
    metadataUrl?: string;
  },
  options?: {
    strictSocials?: boolean;
  }
): DeploymentSafetyReport {
  const issues: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  const nameValid =
    typeof identity.name === "string" &&
    identity.name.trim().length >= 2 &&
    identity.name.trim().length <= 50;
  if (!nameValid) {
    issues.push(`Invalid token name: '${identity.name}'. Must be 2-50 characters.`);
    score -= 25;
  }

  const tickerValid =
    typeof identity.ticker === "string" && /^[A-Z0-9]{2,10}$/.test(identity.ticker.trim());
  if (!tickerValid) {
    issues.push(`Invalid ticker format: '${identity.ticker}'. Must be 2-10 uppercase alphanumeric.`);
    score -= 25;
  }

  const descriptionValid =
    typeof identity.description === "string" && identity.description.trim().length >= 10;
  if (!descriptionValid) {
    warnings.push("Token description is missing or too short (<10 chars).");
    score -= 10;
  }

  const imagePinned =
    typeof assets.imageUrl === "string" &&
    assets.imageUrl.length > 0 &&
    (assets.imageUrl.startsWith("http://") ||
      assets.imageUrl.startsWith("https://") ||
      assets.imageUrl.startsWith("ipfs://"));
  if (!imagePinned) {
    issues.push("Token image URL is missing or not a valid URL.");
    score -= 25;
  }

  const hasWebsite = Boolean(
    identity.website &&
      (identity.website.startsWith("http://") || identity.website.startsWith("https://"))
  );
  const hasTwitter = Boolean(
    identity.twitter &&
      (identity.twitter.startsWith("http://") || identity.twitter.startsWith("https://"))
  );
  const socialsComplete = hasWebsite && hasTwitter;

  if (!socialsComplete) {
    const msg = `Social presence incomplete (Website: ${hasWebsite ? "OK" : "MISSING"}, Twitter: ${hasTwitter ? "OK" : "MISSING"}). May appear as 'No Socials' on DexScreener/RickBot.`;
    if (options?.strictSocials) {
      issues.push(msg);
      score -= 20;
    } else {
      warnings.push(msg);
      score -= 15;
    }
  }

  return {
    safe: issues.length === 0,
    score: Math.max(0, score),
    issues,
    warnings,
    checks: {
      nameValid,
      tickerValid,
      descriptionValid,
      imagePinned,
      socialsComplete,
    },
  };
}

/**
 * Predicts the deterministic contract address and pool ID before live broadcast
 * by utilizing Bankr's official simulation endpoint (simulateOnly: true, 0 gas).
 */
export async function predictDeploymentAddress(
  identity: TokenIdentity,
  assets: UploadResult,
  options?: {
    chain?: "base" | "robinhood" | "arbitrum";
    apiKey?: string;
    proxyUrl?: string;
    quoteOnlyFees?: boolean;
  }
): Promise<{
  success: boolean;
  predictedContractAddress?: string;
  predictedPoolId?: string;
  chain: string;
  error?: string;
}> {
  const { deployViaBankr } = await import("./evm/bankr-deployer.ts");
  const chain = options?.chain ?? "base";

  try {
    const simResult = await deployViaBankr(identity, assets, {
      simulateOnly: true,
      chain,
      apiKey: options?.apiKey,
      proxyUrl: options?.proxyUrl,
      quoteOnlyFees: options?.quoteOnlyFees ?? true,
    });

    if (simResult.success && simResult.contractAddress) {
      return {
        success: true,
        predictedContractAddress: simResult.contractAddress,
        predictedPoolId: simResult.poolId,
        chain,
      };
    }

    return {
      success: false,
      chain,
      error: simResult.error || "Simulation did not return predicted contract address",
    };
  } catch (err: unknown) {
    return {
      success: false,
      chain,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Production Deployment Safety Gate (P0 Hardening) ────────

export interface ProductionSafetyGateInput {
  chain: string;
  identity: {
    name: string;
    ticker: string;
    description?: string;
    website?: string;
    twitter?: string;
  };
  assets: {
    imageUrl?: string;
    metadataUrl?: string;
  };
  isSimulation?: boolean;
  walletAddress?: string | null;
  requiredBalance?: number;
  lockTtlSeconds?: number;
  maxDailyDeploys?: number;
  rpcCheck?: () => Promise<boolean>;
  _injectedEvmClient?: any;
  _injectedSolanaConnection?: any;
}

export interface ProductionSafetyGateResult {
  passed: boolean;
  reason?: string;
  lockAcquired: boolean;
  lockName: string;
  checks: {
    chainValid: boolean;
    identityValid: boolean;
    dailyLimitOk: boolean;
    balanceOk: boolean;
    rpcOk: boolean;
    concurrencyOk: boolean;
  };
}

export const SUPPORTED_DEPLOYMENT_CHAINS: readonly string[] = ["base", "solana", "robinhood", "clanker"];

export function getDeploymentLockName(chain: string): string {
  return `deploy_lock_${chain.trim().toLowerCase()}`;
}

/**
 * Checks all pre-conditions for production deployment without acquiring locks or sending transactions.
 */
export async function evaluateDeploymentSafetyGate(
  input: ProductionSafetyGateInput
): Promise<ProductionSafetyGateResult> {
  const cfg = getConfig();
  const chain = input.chain.trim().toLowerCase();
  const lockName = getDeploymentLockName(chain);

  const checks = {
    chainValid: false,
    identityValid: false,
    dailyLimitOk: false,
    balanceOk: false,
    rpcOk: false,
    concurrencyOk: false,
  };

  // 1. Chain validation
  if (!SUPPORTED_DEPLOYMENT_CHAINS.includes(chain)) {
    return {
      passed: false,
      reason: `UNSUPPORTED_CHAIN: Chain '${input.chain}' is not supported for production deployment. Supported: ${SUPPORTED_DEPLOYMENT_CHAINS.join(", ")}`,
      lockAcquired: false,
      lockName,
      checks,
    };
  }
  checks.chainValid = true;

  // 2. Identity validation via verifyDeploymentSafetyParameters
  const idSafety = verifyDeploymentSafetyParameters(input.identity, input.assets);
  if (!idSafety.safe) {
    return {
      passed: false,
      reason: `IDENTITY_REJECTED: Token safety check failed: ${idSafety.issues.join("; ")}`,
      lockAcquired: false,
      lockName,
      checks,
    };
  }
  checks.identityValid = true;

  // 3. Daily deployment limit
  const maxDeploys = input.maxDailyDeploys ?? cfg.MAX_DEPLOYS_PER_DAY ?? 5;
  const todayCount = getTodayDeployCount();
  if (todayCount >= maxDeploys) {
    return {
      passed: false,
      reason: `DAILY_LIMIT_EXCEEDED: Today's deployment count (${todayCount}) reached or exceeded maximum safety limit (${maxDeploys}).`,
      lockAcquired: false,
      lockName,
      checks,
    };
  }
  checks.dailyLimitOk = true;

  // 4. RPC readiness check
  if (input.rpcCheck) {
    try {
      const rpcReady = await input.rpcCheck();
      if (!rpcReady) {
        return {
          passed: false,
          reason: `RPC_FAILURE: RPC endpoint health check returned false for chain '${chain}'.`,
          lockAcquired: false,
          lockName,
          checks,
        };
      }
    } catch (rpcErr: any) {
      return {
        passed: false,
        reason: `RPC_FAILURE: RPC readiness probe threw exception: ${rpcErr?.message || rpcErr}`,
        lockAcquired: false,
        lockName,
        checks,
      };
    }
  }
  checks.rpcOk = true;

  // 5. Balance verification (if not simulation)
  if (!input.isSimulation) {
    const required =
      input.requiredBalance ??
      (chain === "solana"
        ? (cfg.SNIPER_ENABLED ? cfg.PREFLIGHT_MIN_BALANCE_SOL : 0.009)
        : (cfg.SNIPER_ENABLED ? cfg.PREFLIGHT_MIN_BALANCE_ETH : 0.002));
    if (required > 0 && input.walletAddress) {
      if (chain === "solana") {
        const balRes = await checkSolanaNativeBalance(input.walletAddress, required, input._injectedSolanaConnection);
        if (balRes.outcome === "insufficient_balance") {
          return {
            passed: false,
            reason: `INSUFFICIENT_BALANCE: Solana balance ${balRes.actualBalance !== undefined ? balRes.actualBalance.toFixed(6) : "0"} SOL is below required threshold ${required} SOL.`,
            lockAcquired: false,
            lockName,
            checks,
          };
        }
        if (balRes.outcome === "rpc_failure") {
          checks.rpcOk = false;
          return {
            passed: false,
            reason: `RPC_FAILURE: Failed to query Solana balance: ${balRes.reason}`,
            lockAcquired: false,
            lockName,
            checks,
          };
        }
        if (balRes.outcome === "missing_address") {
          return {
            passed: false,
            reason: `MISSING_ADDRESS: Invalid or missing Solana wallet address.`,
            lockAcquired: false,
            lockName,
            checks,
          };
        }
      } else {
        // EVM (base / robinhood)
        const balRes = await checkEvmNativeBalance(chain, input.walletAddress, required, input._injectedEvmClient);
        if (balRes.outcome === "insufficient_balance") {
          return {
            passed: false,
            reason: `INSUFFICIENT_BALANCE: EVM balance ${balRes.actualBalance !== undefined ? balRes.actualBalance.toFixed(6) : "0"} ETH is below required threshold ${required} ETH.`,
            lockAcquired: false,
            lockName,
            checks,
          };
        }
        if (balRes.outcome === "rpc_failure") {
          // Policy C: EVM RPC balance failure is warning-only because Bankr relayer executes independently
          logger.warn(
            `⚠️  [DEPLOY GATE] EVM RPC unreachable for balance check on '${chain}': ${balRes.reason}. Continuing per Policy C (Bankr independent execution).`
          );
        }
      }
    }
  }
  checks.balanceOk = true;

  return {
    passed: true,
    lockAcquired: false,
    lockName,
    checks: {
      ...checks,
      concurrencyOk: true,
    },
  };
}

/**
 * Executes an atomic deployment action within the protection of the Production Deployment Safety Gate.
 * Enforces fail-closed semantics: if any gate fails, action is NEVER called, and 0 transactions are broadcast.
 * Lock acquisition uses SQLite's atomic system_locks table and guarantees lock release in finally block.
 */
export async function executeWithDeploymentSafetyGate<T>(
  input: ProductionSafetyGateInput,
  action: () => Promise<T>
): Promise<{
  success: boolean;
  result?: T;
  error?: string;
  gateResult: ProductionSafetyGateResult;
}> {
  const evalResult = await evaluateDeploymentSafetyGate(input);
  if (!evalResult.passed) {
    return {
      success: false,
      error: evalResult.reason,
      gateResult: evalResult,
    };
  }

  const lockTtl = input.lockTtlSeconds ?? 1800;
  const lockAcquired = acquireLock(evalResult.lockName, lockTtl, `deployer_${input.chain}`);
  if (!lockAcquired) {
    evalResult.checks.concurrencyOk = false;
    return {
      success: false,
      error: `CONCURRENT_DEPLOYMENT_BLOCKED: A deployment on chain '${input.chain}' is currently in progress (lock: ${evalResult.lockName}). Multiple concurrent deployments are forbidden.`,
      gateResult: {
        ...evalResult,
        passed: false,
        lockAcquired: false,
        reason: `Concurrent deployment lock held: ${evalResult.lockName}`,
        checks: {
          ...evalResult.checks,
          concurrencyOk: false,
        },
      },
    };
  }

  evalResult.lockAcquired = true;

  try {
    const result = await action();
    return {
      success: true,
      result,
      gateResult: evalResult,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      gateResult: evalResult,
    };
  } finally {
    releaseLock(evalResult.lockName);
  }
}

