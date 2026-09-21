/**
 * fee-scanner.ts — Read-only scanner for creator & protocol fees on multi-chain deployments.
 *
 * Architecture Principles:
 *   1. Read-Only Scanner: Queries fee state on-chain or via verified provider adapters without state mutation.
 *   2. Strict Idempotency: Generates deterministic event_key to eliminate double-counting on repeat scans.
 *   3. Multi-Wallet Aware: Associates every detected fee with the corresponding wallet_id and beneficiary.
 *   4. Provider Isolation: Uses pluggable FeeSourceAdapter interface with clear boundaries.
 *   5. Lifecycle Distinction: Classifies fees into 'detected', 'claimable', or 'claimed' (if auto-credited).
 */
import { Database } from "bun:sqlite";
import axios from "axios";
import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import { getBankrHeaders, sanitizeSecret, buildAxiosProxyConfig } from "../evm/bankr-deployer.ts";
import { floatToRawBigIntString } from "./treasury-ledger.ts";
import {
  recordFeeEvent,
  getFeeEvents,
  type FeeEvent,
  type FeeEventInput,
  type FeeStatus,
  type DeployLog,
  DB_PATH,
} from "../../db/vault.ts";
import {
  getWalletAccount,
  listWalletAccounts,
  bootstrapDefaultWallet,
  resolveOperationalContext,
  type WalletAccount,
} from "../identity/wallet-manager.ts";

const db = new Database(DB_PATH);

// ─── Interfaces & Adapters ────────────────────────────────────

export interface DetectedFee {
  source: string; // e.g. "bankr_creator_fee", "pumpfun_creator_reward", "lp_fee"
  chain: string;
  tokenAddress?: string;
  poolId?: string;
  beneficiaryAddress: string;
  tokenSymbol: string;
  amountRaw: string;
  amountFormatted: number;
  status: FeeStatus; // "detected" | "claimable" | "claimed"
  epochOrIdentifier: string; // Used for deterministic event_key
  claimTxHash?: string;
  metadata?: Record<string, unknown>;
}

export interface FeeSourceAdapter {
  name: string;
  supportsChain(chain: string): boolean;
  scanFees(deployment: DeployLog, wallet: WalletAccount): Promise<DetectedFee[]>;
}

// ─── Standard Adapters ───────────────────────────────────────

/**
 * EVM / Bankr fee adapter.
 * Inspects Doppler/Uniswap liquidity pools deployed through Bankr.
 */
export class BankrFeeAdapter implements FeeSourceAdapter {
  name = "bankr_creator_fee";

  supportsChain(chain: string): boolean {
    const norm = chain.trim().toLowerCase();
    return norm === "base" || norm === "robinhood" || norm === "arbitrum" || norm === "ethereum" || norm === "bsc";
  }

  async scanFees(deployment: DeployLog, wallet: WalletAccount): Promise<DetectedFee[]> {
    if (!deployment.contractAddr && !deployment.poolId) {
      return [];
    }

    const beneficiary = wallet.evmAddress;
    if (!beneficiary) {
      return [];
    }

    // In simulation or testnet, return empty without making network calls unless token is real
    if (deployment.lifecycleState === "SIMULATED" || deployment.simulated) {
      return [];
    }

    const tokenAddress = deployment.contractAddr;
    if (!tokenAddress || !tokenAddress.startsWith("0x")) {
      return [];
    }

    const cfg = getConfig();
    const headers = cfg.BANKR_API_KEY ? getBankrHeaders(cfg.BANKR_API_KEY) : { "Content-Type": "application/json" };
    const timeoutMs = Math.min(cfg.API_TIMEOUT_MS ?? 15000, 5000);

    // Resolve operational proxy for bankr if configured
    let proxyConfig: any = undefined;
    try {
      const opCtx = resolveOperationalContext(wallet.id, "bankr");
      if (opCtx?.proxyUrl) {
        proxyConfig = buildAxiosProxyConfig(opCtx.proxyUrl);
      }
    } catch {
      // Fallback direct if resolution fails
    }

    try {
      const url = `https://api.bankr.bot/token-launches/${tokenAddress}/fees`;
      const response = await axios.get(url, {
        headers,
        timeout: timeoutMs,
        proxy: proxyConfig,
        validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
      });

      if (response.status === 404 || !response.data) {
        return [];
      }

      const data = response.data;
      let claimableEth = 0;

      // Defensively parse claimable quote currency (WETH / ETH) from various possible fields
      if (data.totals?.claimableWeth !== undefined) {
        claimableEth = Number(data.totals.claimableWeth);
      } else if (Array.isArray(data.tokens) && data.tokens.length > 0) {
        const tokenMatch =
          data.tokens.find((t: any) => t.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase()) ||
          data.tokens[0];
        if (tokenMatch?.claimable?.token0 !== undefined && (tokenMatch?.token0Label === "WETH" || !tokenMatch?.tokenIsToken0)) {
          claimableEth = Number(tokenMatch.claimable.token0);
        } else if (tokenMatch?.claimable?.weth !== undefined) {
          claimableEth = Number(tokenMatch.claimable.weth);
        }
      } else if (data.unclaimedFees) {
        claimableEth = Number(data.unclaimedFees.weth ?? data.unclaimedFees.eth ?? 0);
      } else if (data.fees) {
        claimableEth = Number(data.fees.claimableWeth ?? data.fees.claimableEth ?? 0);
      } else if (data.claimableWeth !== undefined) {
        claimableEth = Number(data.claimableWeth);
      } else if (data.claimableEth !== undefined) {
        claimableEth = Number(data.claimableEth);
      }

      // Secondary Doppler fallback check if primary endpoint returned 0
      if (!Number.isFinite(claimableEth) || claimableEth <= 0) {
        try {
          const dopplerUrl = `https://api.bankr.bot/public/doppler/claimable-fees/${tokenAddress}?beneficiary=${beneficiary}`;
          const dopplerRes = await axios.get(dopplerUrl, {
            timeout: timeoutMs,
            proxy: proxyConfig,
            validateStatus: (s) => s === 200,
          });
          if (dopplerRes.data?.eligible && dopplerRes.data?.claimableFees) {
            const fees = dopplerRes.data.claimableFees;
            const ethStr = fees.token0Label === "WETH" ? fees.token0 : (fees.weth ?? fees.token0 ?? "0");
            const parsed = Number(ethStr);
            if (Number.isFinite(parsed) && parsed > 0) {
              claimableEth = parsed;
            }
          }
        } catch {
          // Ignore fallback network issues
        }
      }

      if (!Number.isFinite(claimableEth) || claimableEth <= 0) {
        return [];
      }

      const amountRaw = floatToRawBigIntString(claimableEth, 18);
      const claimCount =
        data.totals?.claimCount ??
        (Array.isArray(data.tokens) ? data.tokens[0]?.claimed?.count : 0) ??
        0;
      const epochOrIdentifier = `claim_epoch_${claimCount}`;

      const detected: DetectedFee = {
        source: this.name,
        chain: deployment.chain,
        tokenAddress,
        poolId: deployment.poolId,
        beneficiaryAddress: (data.address && data.address.startsWith("0x")) ? data.address : beneficiary,
        tokenSymbol: "WETH",
        amountRaw,
        amountFormatted: claimableEth,
        status: "claimable",
        epochOrIdentifier,
        metadata: {
          bankrResponse: data,
          quoteOnly: true,
        },
      };

      return [detected];
    } catch (err) {
      logger.warn(
        `⚠️  [BANKR FEE ADAPTER] Failed to query fees for ${tokenAddress}: ${sanitizeSecret(String(err))}`
      );
      return [];
    }
  }
}

/**
 * Solana / PumpFun fee adapter.
 * Inspects creator reward balances or leftover reserves.
 */
export class PumpFunFeeAdapter implements FeeSourceAdapter {
  name = "pumpfun_creator_reward";

  supportsChain(chain: string): boolean {
    return chain.trim().toLowerCase() === "solana";
  }

  async scanFees(deployment: DeployLog, wallet: WalletAccount): Promise<DetectedFee[]> {
    if (!deployment.contractAddr && !deployment.poolId) {
      return [];
    }

    const beneficiary = wallet.solanaAddress;
    if (!beneficiary) {
      return [];
    }

    return [];
  }
}

// Default registry of adapters
const defaultAdapters: FeeSourceAdapter[] = [
  new BankrFeeAdapter(),
  new PumpFunFeeAdapter(),
];

// ─── Scanner Orchestration ───────────────────────────────────

/**
 * Scans all confirmed deployments across wallets for available creator fees.
 * Returns all newly detected and existing fee events.
 */
export async function scanCreatorFees(options?: {
  walletId?: string;
  chain?: string;
  customAdapters?: FeeSourceAdapter[];
}): Promise<FeeEvent[]> {
  const adapters = options?.customAdapters ?? defaultAdapters;
  const recordedEvents: FeeEvent[] = [];

  // 1. Fetch relevant deployments (filtering out simulated/test fixture tokens)
  let deployQuery = `SELECT id, chain, token_name, ticker, contract_addr, tx_hash, status, lifecycle_state, pool_id, wallet_id
                     FROM deploy_logs
                     WHERE lifecycle_state IN ('DEPLOY_CONFIRMED', 'DEPLOY_SUBMITTED')
                       AND (simulated = 0 OR simulated IS NULL)`;
  const queryParams: unknown[] = [];

  if (options?.chain) {
    deployQuery += ` AND chain = ?`;
    queryParams.push(options.chain);
  }
  if (options?.walletId) {
    deployQuery += ` AND wallet_id = ?`;
    queryParams.push(options.walletId);
  }

  const deployments = db.query(deployQuery).all(...(queryParams as any)) as Array<Record<string, unknown>>;

  if (deployments.length === 0) {
    logger.info("🔍 [FEE SCANNER] No matching confirmed deployments found for fee scanning.");
    return [];
  }

  // 2. Iterate through deployments and match with appropriate wallet and adapter
  for (const depRow of deployments) {
    const dep: DeployLog = {
      id: depRow.id as number,
      chain: depRow.chain as string,
      tokenName: depRow.token_name as string,
      ticker: depRow.ticker as string,
      contractAddr: (depRow.contract_addr as string) ?? undefined,
      txHash: (depRow.tx_hash as string) ?? undefined,
      status: depRow.status as any,
      lifecycleState: depRow.lifecycle_state as string,
      poolId: (depRow.pool_id as string) ?? undefined,
      walletId: (depRow.wallet_id as string) ?? undefined,
    };

    const walletId = dep.walletId ?? "default-operator";
    let wallet = getWalletAccount(walletId);
    if (!wallet) {
      wallet = bootstrapDefaultWallet();
    }
    if (!wallet || wallet.status === "DISABLED") {
      continue;
    }

    for (const adapter of adapters) {
      if (!adapter.supportsChain(dep.chain)) {
        continue;
      }

      try {
        const detectedFees = await adapter.scanFees(dep, wallet);

        for (const fee of detectedFees) {
          // Construct deterministic idempotency key
          const tokenOrPool = fee.tokenAddress ?? fee.poolId ?? dep.contractAddr ?? "global";
          const eventKey = `${fee.source}:${fee.chain}:${tokenOrPool}:${fee.epochOrIdentifier}`;

          const feeInput: FeeEventInput = {
            eventKey,
            walletId: wallet.id,
            deployLogId: dep.id,
            chain: fee.chain,
            tokenAddress: fee.tokenAddress ?? dep.contractAddr,
            poolId: fee.poolId ?? dep.poolId,
            source: fee.source,
            beneficiaryAddress: fee.beneficiaryAddress,
            tokenSymbol: fee.tokenSymbol,
            amountRaw: fee.amountRaw,
            amountFormatted: fee.amountFormatted,
            status: fee.status,
            metadata: fee.metadata,
          };

          const recorded = recordFeeEvent(feeInput);
          recordedEvents.push(recorded);

          logger.info(
            `💰 [FEE SCANNER] Recorded fee event: [${fee.source}] ${fee.amountFormatted} ${fee.tokenSymbol} ` +
              `for wallet '${wallet.id}' (${fee.status}). Key: ${eventKey}`
          );
        }
      } catch (err) {
        logger.warn(
          `⚠️  [FEE SCANNER] Adapter '${adapter.name}' scan error for token $${dep.ticker}: ${String(err)}`
        );
      }
    }
  }

  return recordedEvents;
}

export const scanAllFees = scanCreatorFees;

/**
 * Returns all claimable fee events, optionally filtered by wallet.
 */
export function getClaimableFees(walletId?: string): FeeEvent[] {
  return getFeeEvents({
    walletId,
    status: "claimable",
  });
}
