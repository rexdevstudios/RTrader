/**
 * balance-rebalancer.ts — Autonomous Multi-Account Native Balance Rebalancer (Internal Gas Top-Up).
 *
 * Responsibilities:
 *   1. Evaluates all operator wallets against required minimum thresholds using scanAllWalletBalances.
 *   2. Identifies deficit accounts (isStarving === true) across Base L2 (ETH) and Solana (SOL).
 *   3. Verifies master wallet balances on both chains, ensuring master reserve buffers are strictly maintained.
 *   4. Calculates safe transfer allocations per wallet, enforcing individual per-wallet maximum caps.
 *   5. Dispatches on-chain transfers with receipt/signature confirmations:
 *      - Base (EVM): viem createWalletClient with base chain definition and sendTransaction.
 *      - Solana: @solana/web3.js SystemProgram.transfer signed by master Keypair.
 *   6. Supports full dry-run simulation mode without signing or broadcasting transactions.
 *   7. Automatically dispatches multi-channel alert summaries via broadcastRebalanceAlert.
 *
 * Invariants:
 *   - Master Protection: Transfers are strictly prohibited if master balance <= masterReserveBuffer.
 *   - Anti Self-Loop: Master wallet is never transferred to even if present in wallet_accounts.
 *   - Fail-Closed: Network or on-chain transfer failures on one account never crash or block subsequent accounts.
 *   - Zero Plaintext Secret Leakage: Private keys are handled strictly within memory and never logged.
 */

import {
  createWalletClient,
  http,
  parseEther,
  formatEther,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import { sanitizeSecret } from "../evm/bankr-deployer.ts";
import {
  checkEvmNativeBalance,
  checkSolanaNativeBalance,
  scanAllWalletBalances,
  type WalletBalanceEvaluation,
} from "./preflight-balance.ts";
import { type WalletAccount } from "./wallet-manager.ts";
import { verifyEvmTransactionReceipt } from "../reconciliation/evm-verifier.ts";
import { verifySolanaTransaction } from "../reconciliation/solana-verifier.ts";
import {
  broadcastRebalanceAlert,
  type RebalanceTransferSummary,
  type RebalanceAlertReport,
} from "../social/beacon-broadcaster.ts";

export interface RebalanceTransferItem extends RebalanceTransferSummary {
  chain: "base" | "solana";
}

export interface RebalanceOptions {
  /** Desired minimum target balance on Base L2 (default: 0.055 ETH) */
  targetMinEth?: number;
  /** Desired minimum target balance on Solana (default: 0.06 SOL) */
  targetMinSol?: number;
  /** Reserve buffer to keep in Master EVM wallet to prevent starvation (default: 0.05 ETH) */
  masterMinEthReserve?: number;
  /** Reserve buffer to keep in Master Solana wallet to prevent starvation (default: 0.05 SOL) */
  masterMinSolReserve?: number;
  /** Maximum top-up allowed per operator wallet in a single shot (default: 0.05 ETH) */
  maxTopUpEthPerWallet?: number;
  /** Maximum top-up allowed per operator wallet in a single shot (default: 0.05 SOL) */
  maxTopUpSolPerWallet?: number;
  /** If true, calculates deficits and validates master pools without sending on-chain txs */
  dryRun?: boolean;
  /** Target chain to rebalance: 'all' | 'base' | 'solana' (default: 'all') */
  chain?: "all" | "base" | "solana";
  /** Optional specific wallets to rebalance */
  wallets?: WalletAccount[];
  /** If true, dispatches broadcast alert cards to Telegram & Discord */
  broadcast?: boolean;
  /** Optional explicit master EVM address override */
  masterEvmAddress?: string;
  /** Optional explicit master Solana address override */
  masterSolanaAddress?: string;
  /** Injected EVM sender for deterministic testing */
  _injectedEvmSender?: (
    to: string,
    amountEth: number
  ) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  /** Injected Solana sender for deterministic testing */
  _injectedSolanaSender?: (
    to: string,
    amountSol: number
  ) => Promise<{ success: boolean; txHash?: string; error?: string }>;
  /** Injected EVM client for deterministic balance checks */
  _injectedEvmClient?: { getBalance: (args: { address: string }) => Promise<bigint> } | null;
  /** Injected Solana connection for deterministic balance checks */
  _injectedSolanaConnection?: { getBalance: (pubkey: unknown) => Promise<number> } | null;
}

export interface RebalanceExecutionReport extends RebalanceAlertReport {
  masterEvmAddress?: string;
  masterSolanaAddress?: string;
  masterInitialEth?: number;
  masterInitialSol?: number;
  transfers: RebalanceTransferItem[];
}

/**
 * Executes or simulates an autonomous native balance rebalancing routine,
 * topping up starving sub-wallets from the master deployment wallet.
 */
export async function rebalanceOperatorBalances(
  options?: RebalanceOptions
): Promise<RebalanceExecutionReport> {
  const targetMinEth = options?.targetMinEth ?? 0.055;
  const targetMinSol = options?.targetMinSol ?? 0.06;
  const masterMinEthReserve = options?.masterMinEthReserve ?? 0.05;
  const masterMinSolReserve = options?.masterMinSolReserve ?? 0.05;
  const maxTopUpEthPerWallet = options?.maxTopUpEthPerWallet ?? 0.05;
  const maxTopUpSolPerWallet = options?.maxTopUpSolPerWallet ?? 0.05;
  const dryRun = options?.dryRun ?? false;
  const targetChain = options?.chain ?? "all";

  const cfg = getConfig();
  const masterEvmPrivKey = cfg.EVM_PRIVATE_KEY;
  const masterSolanaPrivKey = cfg.SOLANA_PRIVATE_KEY;

  let masterEvmAddress: string | undefined = options?.masterEvmAddress;
  if (!masterEvmAddress && masterEvmPrivKey && /^0x[a-fA-F0-9]{64}$/.test(masterEvmPrivKey)) {
    try {
      masterEvmAddress = privateKeyToAccount(masterEvmPrivKey as `0x${string}`).address;
    } catch {
      // Ignored
    }
  }

  let masterSolanaAddress: string | undefined = options?.masterSolanaAddress;
  if (!masterSolanaAddress && masterSolanaPrivKey) {
    try {
      masterSolanaAddress = Keypair.fromSecretKey(
        bs58.decode(masterSolanaPrivKey)
      ).publicKey.toBase58();
    } catch {
      // Ignored
    }
  }

  const warnings: string[] = [];

  // 1. Audit Master Balances
  let masterInitialEth = 0;
  let masterInitialSol = 0;
  let availableEthPool = 0;
  let availableSolPool = 0;

  if (targetChain === "all" || targetChain === "base") {
    if (masterEvmAddress) {
      const evmRes = await checkEvmNativeBalance(
        "base",
        masterEvmAddress,
        0.0001,
        options?._injectedEvmClient
      );
      masterInitialEth = evmRes.actualBalance ?? 0;
      availableEthPool = Math.max(0, masterInitialEth - masterMinEthReserve);
      if (availableEthPool <= 0) {
        warnings.push(
          `Master Base ETH balance (${masterInitialEth.toFixed(4)} ETH) <= buffer reserve (${masterMinEthReserve} ETH). Rebalance EVM ditunda.`
        );
      }
    } else {
      warnings.push("Master EVM address tidak dapat di-resolve dari EVM_PRIVATE_KEY.");
    }
  }

  if (targetChain === "all" || targetChain === "solana") {
    if (masterSolanaAddress) {
      const solRes = await checkSolanaNativeBalance(
        masterSolanaAddress,
        0.0001,
        options?._injectedSolanaConnection
      );
      masterInitialSol = solRes.actualBalance ?? 0;
      availableSolPool = Math.max(0, masterInitialSol - masterMinSolReserve);
      if (availableSolPool <= 0) {
        warnings.push(
          `Master Solana balance (${masterInitialSol.toFixed(4)} SOL) <= buffer reserve (${masterMinSolReserve} SOL). Rebalance Solana ditunda.`
        );
      }
    } else {
      warnings.push("Master Solana address tidak dapat di-resolve dari SOLANA_PRIVATE_KEY.");
    }
  }

  // 2. Scan All Target Wallets
  const scanReport = await scanAllWalletBalances({
    minEth: targetMinEth,
    minSol: targetMinSol,
    wallets: options?.wallets,
    onlyActive: true,
    injectedEvmClient: options?._injectedEvmClient,
    injectedSolanaConnection: options?._injectedSolanaConnection,
  });

  const transfers: RebalanceTransferItem[] = [];
  let totalEthTransferred = 0;
  let totalSolTransferred = 0;

  for (const wallet of scanReport.evaluations) {
    // Anti Self-Loop check
    const isMasterEvm =
      masterEvmAddress &&
      wallet.evmAddress &&
      wallet.evmAddress.toLowerCase() === masterEvmAddress.toLowerCase();
    const isMasterSolana =
      masterSolanaAddress &&
      wallet.solanaAddress &&
      wallet.solanaAddress === masterSolanaAddress;

    // A. Rebalance Base L2
    if (
      (targetChain === "all" || targetChain === "base") &&
      wallet.evmAddress &&
      !wallet.evmSufficient &&
      !isMasterEvm
    ) {
      const neededEth = wallet.deficitEth;
      const amountToTransfer = Math.min(neededEth, maxTopUpEthPerWallet);

      if (availableEthPool < amountToTransfer || availableEthPool <= 0) {
        transfers.push({
          walletId: wallet.walletId,
          label: wallet.label,
          chain: "base",
          recipientAddress: wallet.evmAddress,
          amount: amountToTransfer,
          currency: "ETH",
          status: "skipped",
          errorReason: `Cadangan pool Master ETH tidak mencukupi (Tersedia: ${availableEthPool.toFixed(4)} ETH)`,
        });
      } else {
        if (dryRun) {
          transfers.push({
            walletId: wallet.walletId,
            label: wallet.label,
            chain: "base",
            recipientAddress: wallet.evmAddress,
            amount: amountToTransfer,
            currency: "ETH",
            status: "simulated",
            txHash: `sim_rebal_eth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          });
          availableEthPool -= amountToTransfer;
          totalEthTransferred += amountToTransfer;
        } else {
          // Execute on-chain EVM Transfer
          try {
            let txHash: string | undefined;
            if (options?._injectedEvmSender) {
              const res = await options._injectedEvmSender(
                wallet.evmAddress,
                amountToTransfer
              );
              if (!res.success) {
                throw new Error(res.error || "Injected EVM sender failed");
              }
              txHash = res.txHash;
            } else {
              if (!masterEvmPrivKey) {
                throw new Error("EVM_PRIVATE_KEY tidak ditemukan untuk menandatangani transfer");
              }
              const account = privateKeyToAccount(masterEvmPrivKey as `0x${string}`);
              const walletClient = createWalletClient({
                account,
                chain: base,
                transport: http(cfg.BASE_RPC_URL),
              });
              txHash = await walletClient.sendTransaction({
                to: wallet.evmAddress as `0x${string}`,
                value: parseEther(amountToTransfer.toFixed(18)),
              });
              // Verify receipt
              await verifyEvmTransactionReceipt(txHash);
            }

            transfers.push({
              walletId: wallet.walletId,
              label: wallet.label,
              chain: "base",
              recipientAddress: wallet.evmAddress,
              amount: amountToTransfer,
              currency: "ETH",
              txHash,
              status: "success",
            });
            availableEthPool -= amountToTransfer;
            totalEthTransferred += amountToTransfer;
            logger.success(
              `⚡ [REBALANCE] Berhasil top-up ${amountToTransfer.toFixed(4)} ETH ke ${wallet.walletId} (${wallet.evmAddress})`
            );
          } catch (err: any) {
            const errMsg = err?.message || String(err);
            transfers.push({
              walletId: wallet.walletId,
              label: wallet.label,
              chain: "base",
              recipientAddress: wallet.evmAddress,
              amount: amountToTransfer,
              currency: "ETH",
              status: "failed",
              errorReason: sanitizeSecret(errMsg),
            });
            logger.error(`❌ [REBALANCE] Gagal transfer ETH ke ${wallet.walletId}: ${errMsg}`);
          }
        }
      }
    }

    // B. Rebalance Solana
    if (
      (targetChain === "all" || targetChain === "solana") &&
      wallet.solanaAddress &&
      !wallet.solanaSufficient &&
      !isMasterSolana
    ) {
      const neededSol = wallet.deficitSol;
      const amountToTransfer = Math.min(neededSol, maxTopUpSolPerWallet);

      if (availableSolPool < amountToTransfer || availableSolPool <= 0) {
        transfers.push({
          walletId: wallet.walletId,
          label: wallet.label,
          chain: "solana",
          recipientAddress: wallet.solanaAddress,
          amount: amountToTransfer,
          currency: "SOL",
          status: "skipped",
          errorReason: `Cadangan pool Master SOL tidak mencukupi (Tersedia: ${availableSolPool.toFixed(4)} SOL)`,
        });
      } else {
        if (dryRun) {
          transfers.push({
            walletId: wallet.walletId,
            label: wallet.label,
            chain: "solana",
            recipientAddress: wallet.solanaAddress,
            amount: amountToTransfer,
            currency: "SOL",
            status: "simulated",
            txHash: `sim_rebal_sol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          });
          availableSolPool -= amountToTransfer;
          totalSolTransferred += amountToTransfer;
        } else {
          // Execute on-chain Solana Transfer
          try {
            let signature: string | undefined;
            if (options?._injectedSolanaSender) {
              const res = await options._injectedSolanaSender(
                wallet.solanaAddress,
                amountToTransfer
              );
              if (!res.success) {
                throw new Error(res.error || "Injected Solana sender failed");
              }
              signature = res.txHash;
            } else {
              if (!masterSolanaPrivKey) {
                throw new Error(
                  "SOLANA_PRIVATE_KEY tidak ditemukan untuk menandatangani transfer"
                );
              }
              const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
              const masterKeypair = Keypair.fromSecretKey(
                bs58.decode(masterSolanaPrivKey)
              );
              const tx = new Transaction().add(
                SystemProgram.transfer({
                  fromPubkey: masterKeypair.publicKey,
                  toPubkey: new PublicKey(wallet.solanaAddress),
                  lamports: Math.floor(amountToTransfer * LAMPORTS_PER_SOL),
                })
              );
              signature = await sendAndConfirmTransaction(connection, tx, [masterKeypair]);
              // Verify on chain
              await verifySolanaTransaction(signature, connection);
            }

            transfers.push({
              walletId: wallet.walletId,
              label: wallet.label,
              chain: "solana",
              recipientAddress: wallet.solanaAddress,
              amount: amountToTransfer,
              currency: "SOL",
              txHash: signature,
              status: "success",
            });
            availableSolPool -= amountToTransfer;
            totalSolTransferred += amountToTransfer;
            logger.success(
              `⚡ [REBALANCE] Berhasil top-up ${amountToTransfer.toFixed(4)} SOL ke ${wallet.walletId} (${wallet.solanaAddress})`
            );
          } catch (err: any) {
            const errMsg = err?.message || String(err);
            transfers.push({
              walletId: wallet.walletId,
              label: wallet.label,
              chain: "solana",
              recipientAddress: wallet.solanaAddress,
              amount: amountToTransfer,
              currency: "SOL",
              status: "failed",
              errorReason: sanitizeSecret(errMsg),
            });
            logger.error(`❌ [REBALANCE] Gagal transfer SOL ke ${wallet.walletId}: ${errMsg}`);
          }
        }
      }
    }
  }

  const totalRebalanced = transfers.filter(
    (t) => t.status === "success" || t.status === "simulated"
  ).length;
  const totalSkipped = transfers.filter((t) => t.status === "skipped").length;
  const totalFailed = transfers.filter((t) => t.status === "failed").length;

  const report: RebalanceExecutionReport = {
    timestamp: new Date().toISOString(),
    dryRun,
    totalStarvingWallets: scanReport.starvingWallets.length,
    totalRebalanced,
    totalSkipped,
    totalFailed,
    totalEthTransferred,
    totalSolTransferred,
    masterEvmAddress,
    masterSolanaAddress,
    masterInitialEth,
    masterInitialSol,
    masterRemainingEth: Math.max(0, masterInitialEth - totalEthTransferred),
    masterRemainingSol: Math.max(0, masterInitialSol - totalSolTransferred),
    transfers,
    warnings,
  };

  if (options?.broadcast && transfers.length > 0) {
    try {
      await broadcastRebalanceAlert(report);
    } catch (bErr: any) {
      logger.warn(`⚠️  [REBALANCE] Alert broadcast notice: ${bErr?.message || bErr}`);
    }
  }

  return report;
}
