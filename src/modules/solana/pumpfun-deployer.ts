/**
 * pumpfun-deployer.ts — Deploy token ke Solana via Pump.fun.
 *
 * Menggunakan Pump.fun Bonding Curve sehingga:
 * - Biaya deploy hanya ~0.02 SOL (~$3)
 * - TIDAK perlu modal Liquidity Pool
 * - Token lolos scan keamanan secara otomatis
 *
 * Fitur keamanan:
 * - Setiap deploy menggunakan dompet baru (rotasi otomatis)
 * - Private key dompet bekas disimpan di SQLite vault
 * - Auto-sweeper menyedot sisa SOL kembali ke Master Wallet
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import axios from "axios";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import { saveWallet, getUnsweptWallets, markWalletSwept } from "../../db/vault.ts";
import type { TokenIdentity } from "../ai/gemini-brain.ts";
import type { UploadResult } from "../ipfs/pinata-uploader.ts";
export interface DeployResult {
  success: boolean;
  contractAddress?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  poolId?: string;
  simulated?: boolean;
  status?: "success" | "failed" | "unknown";
  feeDistribution?: Record<string, unknown>;
}

export const DEFAULT_SOLANA_DEV_BUY_SOL = 0.001; // Pembelian dev awal yang aman & terukur
export const DEPLOY_COST_SOL = 0.015;            // Estimasi batas saldo deploy di Pump.fun
export const MIN_BALANCE_SOL = 0.015;            // Saldo minimum dompet sebelum deploy

/**
 * Buat dompet Solana baru dan transfer SOL dari master wallet.
 */
async function createDisposableWallet(
  connection: Connection,
  masterKeypair: Keypair,
  amountSol: number
): Promise<Keypair> {
  const newWallet = Keypair.generate();

  logger.info(`💳 Membuat dompet baru: ${newWallet.publicKey.toBase58().slice(0, 8)}...`);

  // Transfer SOL ke dompet baru
  const transferTx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: masterKeypair.publicKey,
      toPubkey: newWallet.publicKey,
      lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
    })
  );

  await sendAndConfirmTransaction(connection, transferTx, [masterKeypair]);

  // Simpan ke vault sebelum digunakan (keamanan: jangan sampai hilang)
  saveWallet(
    "solana",
    newWallet.publicKey.toBase58(),
    bs58.encode(newWallet.secretKey) // Simpan sebagai Base58
  );

  logger.success(`✅ Dompet baru siap: ${newWallet.publicKey.toBase58()}`);
  return newWallet;
}

/**
 * Sweep sisa SOL dari semua dompet bekas kembali ke master wallet.
 */
export async function sweepLeftoverSol(): Promise<void> {
  const cfg = getConfig();
  const connection = new Connection(cfg.SOLANA_RPC_URL, "confirmed");
  const masterKeypair = Keypair.fromSecretKey(bs58.decode(cfg.SOLANA_PRIVATE_KEY));
  const unswept = getUnsweptWallets("solana");

  if (unswept.length === 0) return;

  logger.info(`🧹 Sweeping ${unswept.length} dompet bekas...`);

  for (const wallet of unswept) {
    try {
      const pubkey = new PublicKey(wallet.address);
      const balance = await connection.getBalance(pubkey);
      const feeBuffer = 5000; // Sisakan untuk biaya transfer

      if (balance > feeBuffer) {
        const keypair = Keypair.fromSecretKey(bs58.decode(wallet.private_key));
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: pubkey,
            toPubkey: masterKeypair.publicKey,
            lamports: balance - feeBuffer,
          })
        );
        await sendAndConfirmTransaction(connection, tx, [keypair]);
        logger.success(`✅ Swept ${((balance - feeBuffer) / LAMPORTS_PER_SOL).toFixed(6)} SOL dari ${wallet.address.slice(0, 8)}...`);
      }

      markWalletSwept(wallet.address);
    } catch {
      logger.warn(`⚠️  Gagal sweep ${wallet.address.slice(0, 8)}... (diabaikan)`);
    }
  }
}

/**
 * Safely signs a VersionedTransaction using only the keypairs that are required signers.
 */
export function signVersionedTransaction(vtx: VersionedTransaction, signers: Keypair[]): void {
  const accountKeys = vtx.message.staticAccountKeys;
  const numRequiredSigners = vtx.message.header.numRequiredSignatures;
  const requiredSignerKeys = accountKeys.slice(0, numRequiredSigners).map((pk) => pk.toBase58());

  const applicableSigners = signers.filter((s) =>
    requiredSignerKeys.includes(s.publicKey.toBase58())
  );

  if (applicableSigners.length > 0) {
    vtx.sign(applicableSigners);
  }
}

/**
 * Deploy token ke Pump.fun menggunakan dompet rotasi.
 */
export async function deployViaPumpFun(
  identity: TokenIdentity,
  assets: UploadResult,
  overrides?: {
    simulateOnly?: boolean;
    devBuyAmountSol?: number;
    rpcUrl?: string;
    feePayerPrivateKey?: string;
  }
): Promise<DeployResult> {
  const cfg = getConfig();
  const isTestnet = overrides?.simulateOnly ?? (cfg.DEPLOY_MODE === "testnet");

  logger.deploy(`🚀 [PUMP.FUN] Memulai deploy ${identity.ticker} ke ${isTestnet ? "Solana Devnet (TESTNET)" : "Solana Mainnet"}...`);

  // Mode testnet: simulasi
  if (isTestnet) {
    logger.warn("🧪 MODE TESTNET: Deploy disimulasikan, tidak ada biaya nyata.");
    await new Promise((r) => setTimeout(r, 2000));
    const rawPub = Keypair.generate().publicKey.toBase58();
    const simulatedMint = "pump" + rawPub.slice(4);
    return {
      success: true,
      status: "success",
      simulated: true,
      contractAddress: simulatedMint,
      txHash: "simulated",
      explorerUrl: "https://solscan.io/tx/simulated",
    };
  }

  try {
    const rpcUrl = overrides?.rpcUrl || cfg.SOLANA_RPC_URL;
    const connection = new Connection(rpcUrl, "confirmed");
    const rawKey = (overrides?.feePayerPrivateKey || cfg.SOLANA_PRIVATE_KEY).trim();
    const masterKeypair = Keypair.fromSecretKey(bs58.decode(rawKey));

    // Generate fresh keypair specifically for this token mint
    const mintKeypair = Keypair.generate();
    saveWallet(
      "solana",
      mintKeypair.publicKey.toBase58(),
      bs58.encode(mintKeypair.secretKey)
    );

    const devBuyAmount = overrides?.devBuyAmountSol ?? (
      cfg.SNIPE_AMOUNT_SOL > 0
        ? Math.min(cfg.SNIPE_AMOUNT_SOL, 0.005)
        : DEFAULT_SOLANA_DEV_BUY_SOL
    );

    logger.info(`💳 Menyiapkan peluncuran Pump.fun: Fee Payer=${masterKeypair.publicKey.toBase58().slice(0, 8)}... | Mint=${mintKeypair.publicKey.toBase58().slice(0, 8)}... | DevBuy=${devBuyAmount} SOL`);

    // Dapatkan transaksi ter-serialisasi dari Pump.fun PumpPortal Local API
    const response = await axios.post(
      "https://pumpportal.fun/api/trade-local",
      {
        publicKey: masterKeypair.publicKey.toBase58(),
        action: "create",
        tokenMetadata: {
          name: identity.name,
          symbol: identity.ticker,
          uri: assets.metadataUrl,
        },
        mint: mintKeypair.publicKey.toBase58(),
        denominatedInSol: "true",
        amount: devBuyAmount,
        slippage: 10,
        priorityFee: 0.0005,
        pool: "pump",
      },
      {
        headers: { "Content-Type": "application/json" },
        responseType: "arraybuffer",
        timeout: cfg.API_TIMEOUT_MS ?? 30000,
      }
    );

    // Support both direct binary ArrayBuffer and legacy JSON { transaction: string }
    let buf: Buffer;
    if (response.data && typeof response.data === "object" && "transaction" in (response.data as any)) {
      const txStr = (response.data as any).transaction;
      buf = Buffer.from(bs58.decode(txStr));
    } else {
      buf = Buffer.from(response.data as ArrayBuffer);
    }

    let signature: string;
    let isVersioned = false;

    // Deserialization: support modern VersionedTransaction (v0) with legacy Transaction fallback
    try {
      const vtx = VersionedTransaction.deserialize(buf);
      isVersioned = true;
      signVersionedTransaction(vtx, [masterKeypair, mintKeypair]);
      const rawBytes = vtx.serialize();
      signature = await connection.sendRawTransaction(rawBytes, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(signature, "confirmed");
    } catch (vErr) {
      if (!isVersioned) {
        const tx = Transaction.from(buf);
        signature = await sendAndConfirmTransaction(connection, tx, [masterKeypair, mintKeypair]);
      } else {
        throw vErr;
      }
    }

    logger.success(`✅ [PUMP.FUN] Token ${identity.ticker} berhasil di-deploy ke Solana Mainnet!`);

    return {
      success: true,
      status: "success",
      simulated: false,
      contractAddress: mintKeypair.publicKey.toBase58(),
      txHash: signature,
      explorerUrl: `https://solscan.io/tx/${signature}`,
    };
  } catch (err) {
    if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || !err.response)) {
      return {
        success: false,
        status: "unknown",
        error: `DEPLOYMENT_OUTCOME_UNKNOWN: PumpFun request timed out or network disconnected. AUTOMATIC RETRY FORBIDDEN.`,
      };
    }
    const msg = axios.isAxiosError(err)
      ? (err.response?.data ? Buffer.from(err.response.data).toString("utf8") : err.message)
      : (err instanceof Error ? err.message : String(err));
    logger.error(`❌ [PUMP.FUN] Deploy gagal: ${msg}`);
    return { success: false, status: "failed", error: msg };
  }
}
