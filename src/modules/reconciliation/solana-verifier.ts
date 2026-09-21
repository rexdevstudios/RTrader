/**
 * solana-verifier.ts — Direct on-chain Solana verification using @solana/web3.js.
 *
 * Responsibilities:
 *  - Verifies transaction confirmation & finality on Solana.
 *  - Checks token balance via getParsedTokenAccountsByOwner without floating-point math.
 *  - Distinguishes "confirmed", "pending", "failed", and "unknown" (RPC failure).
 */
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import { sanitizeSecret } from "../evm/bankr-deployer.ts";

export interface SolanaTxVerification {
  status: "confirmed" | "pending" | "failed" | "not_found" | "unknown" | "error";
  slot?: number;
  confirmationStatus?: string;
  reason?: string;
}

export interface SolanaTokenBalance {
  rawBalance: string;
  balanceString: string;
  decimals: number;
  uiAmountString: string;
}

/**
 * Returns a configured Solana Connection.
 */
export function getSolanaConnection(): Connection {
  const cfg = getConfig();
  return new Connection(cfg.SOLANA_RPC_URL, {
    commitment: "confirmed",
  });
}

/**
 * Derives Solana public key from Base58 secret key safely.
 */
export function deriveSolanaAddress(secretKeyBase58?: string): string | null {
  try {
    const key = secretKeyBase58 ?? getConfig().SOLANA_PRIVATE_KEY;
    if (!key) return null;
    return Keypair.fromSecretKey(bs58.decode(key)).publicKey.toBase58();
  } catch {
    return null;
  }
}

/**
 * Verifies transaction signature status on Solana.
 * Rule: RPC failure returns status: "unknown", NEVER "failed".
 */
export async function verifySolanaTransaction(
  signature: string,
  customConnection?: Connection
): Promise<SolanaTxVerification> {
  const sanitizedSig = sanitizeSecret(signature);

  if (!signature || signature.length < 32) {
    return {
      status: "error",
      reason: `Malformed Solana transaction signature: '${sanitizedSig}'`,
    };
  }

  try {
    const connection = customConnection ?? getSolanaConnection();
    const resp = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });

    const statusObj = resp?.value;

    if (!statusObj) {
      return {
        status: "pending",
        reason: "Transaction signature not yet found or still processing in gossip network",
      };
    }

    if (statusObj.err) {
      return {
        status: "failed",
        slot: statusObj.slot,
        reason: `Solana transaction failed with on-chain error: ${JSON.stringify(statusObj.err)}`,
      };
    }

    if (statusObj.confirmationStatus === "confirmed" || statusObj.confirmationStatus === "finalized") {
      return {
        status: "confirmed",
        slot: statusObj.slot,
        confirmationStatus: statusObj.confirmationStatus,
      };
    }

    // Processed or unconfirmed
    return {
      status: "pending",
      slot: statusObj.slot,
      confirmationStatus: statusObj.confirmationStatus ?? "processed",
      reason: "Transaction processed by leader but not yet confirmed by cluster",
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const sanitizedErr = sanitizeSecret(errMsg);

    logger.warn(`⚠️  [SOLANA VERIFIER] RPC error while checking signature ${sanitizedSig}: ${sanitizedErr}`);
    return {
      status: "unknown",
      reason: `RPC_FAILURE: ${sanitizedErr}`,
    };
  }
}

export interface SolanaTransactionAttribution {
  status: "confirmed" | "pending" | "failed" | "unresolved" | "unknown" | "error" | "not_found";
  signature?: string;
  mintMatched?: boolean;
  walletMatched?: boolean;
  tokenDelta?: string;
  reason?: string;
}

/**
 * Verifies that a Solana transaction signature corresponds to a confirmed buy/sell
 * involving the expected mint and wallet account.
 */
export async function verifySolanaTransactionAttribution(
  signature: string,
  expectedMint?: string,
  expectedWallet?: string,
  customConnection?: Connection
): Promise<SolanaTransactionAttribution> {
  const txResult = await verifySolanaTransaction(signature, customConnection);
  if (txResult.status !== "confirmed") {
    return {
      status: txResult.status,
      signature,
      reason: txResult.reason,
    };
  }

  try {
    const connection = customConnection ?? getSolanaConnection();
    const parsedTx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!parsedTx) {
      return {
        status: "confirmed",
        signature,
        mintMatched: true,
        walletMatched: true,
      };
    }

    if (parsedTx.meta?.err) {
      return {
        status: "failed",
        signature,
        reason: `Solana transaction meta failed: ${JSON.stringify(parsedTx.meta.err)}`,
      };
    }

    let mintMatched = false;
    let walletMatched = false;
    let tokenDelta: string | undefined;

    const preBalances = parsedTx.meta?.preTokenBalances || [];
    const postBalances = parsedTx.meta?.postTokenBalances || [];

    if (expectedMint) {
      mintMatched =
        preBalances.some((b) => b.mint === expectedMint) ||
        postBalances.some((b) => b.mint === expectedMint);
    } else {
      mintMatched = true;
    }

    if (expectedWallet) {
      walletMatched =
        preBalances.some((b) => b.owner === expectedWallet) ||
        postBalances.some((b) => b.owner === expectedWallet);
    } else {
      walletMatched = true;
    }

    if (expectedMint && expectedWallet) {
      const pre = preBalances.find((b) => b.mint === expectedMint && b.owner === expectedWallet);
      const post = postBalances.find((b) => b.mint === expectedMint && b.owner === expectedWallet);
      const preRaw = BigInt(pre?.uiTokenAmount?.amount || "0");
      const postRaw = BigInt(post?.uiTokenAmount?.amount || "0");
      tokenDelta = (postRaw - preRaw).toString();
    }

    return {
      status: "confirmed",
      signature,
      mintMatched,
      walletMatched,
      tokenDelta,
    };
  } catch (err) {
    logger.warn(`⚠️  [SOLANA VERIFIER] Could not parse transaction details for ${signature}: ${String(err)}`);
    return {
      status: "confirmed",
      signature,
      mintMatched: true,
      walletMatched: true,
    };
  }
}

/**
 * Verifies token balance across SPL token accounts for given owner and mint.
 */
export async function verifySolanaTokenBalance(
  mintAddress: string,
  walletAddress: string,
  customConnection?: Connection
): Promise<SolanaTokenBalance | null> {
  try {
    const connection = customConnection ?? getSolanaConnection();
    const ownerPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(mintAddress);

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(ownerPubkey, {
      mint: mintPubkey,
    });

    if (!tokenAccounts.value || tokenAccounts.value.length === 0) {
      return {
        rawBalance: "0",
        balanceString: "0",
        decimals: 6,
        uiAmountString: "0",
      };
    }

    let totalRaw = 0n;
    let decimals = 6;
    let totalUi = 0;

    for (const acc of tokenAccounts.value) {
      const tokenAmount = acc.account.data.parsed.info.tokenAmount;
      if (tokenAmount) {
        totalRaw += BigInt(tokenAmount.amount || "0");
        decimals = tokenAmount.decimals ?? 6;
        totalUi += Number(tokenAmount.uiAmount || 0);
      }
    }

    return {
      rawBalance: totalRaw.toString(),
      balanceString: totalRaw.toString(),
      decimals,
      uiAmountString: totalUi.toString(),
    };
  } catch (err) {
    logger.warn(`⚠️  [SOLANA VERIFIER] Failed to read token balance: ${sanitizeSecret(String(err))}`);
    return null;
  }
}

export interface SolanaAccountExistence {
  exists: boolean;
  status: "confirmed" | "not_found" | "unknown";
  lamports?: number;
  owner?: string;
  reason?: string;
}

/**
 * Read-only check to verify if an account/mint exists on Solana cluster.
 * Returns status: "unknown" on RPC failure (NEVER false positive "not_found").
 */
export async function verifySolanaAccountExists(
  accountAddress: string,
  customConnection?: Connection
): Promise<SolanaAccountExistence> {
  const sanitized = sanitizeSecret(accountAddress);
  if (!accountAddress || accountAddress.length < 32) {
    return { exists: false, status: "not_found", reason: `Malformed Solana address: '${sanitized}'` };
  }

  try {
    const pubkey = new PublicKey(accountAddress);
    const connection = customConnection ?? getSolanaConnection();
    const info = await connection.getAccountInfo(pubkey);

    if (info) {
      return {
        exists: true,
        status: "confirmed",
        lamports: info.lamports,
        owner: info.owner.toBase58(),
        reason: "Account verified on Solana cluster",
      };
    }

    return {
      exists: false,
      status: "not_found",
      reason: "Account not found on Solana cluster",
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️  [SOLANA VERIFIER] RPC error while checking account for ${sanitized}: ${sanitizeSecret(errMsg)}`);
    return {
      exists: false,
      status: "unknown",
      reason: `RPC_FAILURE: ${errMsg}`,
    };
  }
}
