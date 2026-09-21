#!/usr/bin/env bun
/**
 * scripts/execute-single-solana-deployment.ts
 *
 * Executes exactly ONE single controlled token deployment to Solana (Pump.fun)
 * with AI identity generation, Pinata IPFS asset uploading, dual keypair signing,
 * post-deployment lamports sweep, and Vault SQLite lifecycle tracking.
 *
 * STRICT INVARIANTS:
 *  - Exactly 1 deployment attempt (NO auto-retry loop).
 *  - Simulates safely if --simulate is passed or if DEPLOY_MODE=testnet.
 *  - Post-deploy sweep: sweeps leftover SOL back to master wallet.
 *  - Zero secret exposure.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { getConfig, resetConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { deployViaPumpFun, sweepLeftoverSol } from "../src/modules/solana/pumpfun-deployer.ts";
import { generateTokenIdentity, type TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { checkCrossChainSaturation } from "../src/modules/market/saturation-checker.ts";
import { checkSolanaNativeBalance } from "../src/modules/identity/preflight-balance.ts";
import { generateIrresistibleOffer, saveOfferDeckMarkdown } from "../src/modules/growth/token-offer-generator.ts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";
import { generateTokenLogo } from "../src/modules/image/pollinations-gen.ts";
import { uploadTokenAssets, type UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";
import {
  logDeploy,
  updateDeployLifecycle,
  generateCandidateId,
  getWalletKeyByAddress,
} from "../src/db/vault.ts";
import { executeWithDeploymentSafetyGate } from "../src/modules/deploy-guard.ts";
import { getWalletAccount, getWalletByAddress, listWalletAccounts } from "../src/modules/identity/wallet-manager.ts";

const args = process.argv.slice(2);
const forceSimulate = args.includes("--simulate") || args.includes("-s");
const walletArg = args.find((a) => a.startsWith("--wallet="));
const requestedWalletId = walletArg ? walletArg.split("=")[1]?.trim() : undefined;

async function main(): Promise<void> {
  console.log(`
=================================================================
  [+] SOLANA PUMP.FUN TOKEN DEPLOYMENT RUNNER (CONTROLLED) [+]
=================================================================
  Target Network: Solana (Pump.fun Bonding Curve)
  Execution Mode: ${forceSimulate ? "SIMULATED (--simulate flag)" : "FOLLOWS .ENV"}
=================================================================
`);

  if (forceSimulate) {
    process.env.DEPLOY_MODE = "testnet";
    resetConfig();
  }

  const cfg = getConfig();
  const isSimulation = cfg.DEPLOY_MODE === "testnet";

  logger.info(`[1/5] Mode Operasional: ${isSimulation ? "SIMULASI / DEVNET (Rp 0, Tanpa Gas)" : "LIVE SOLANA MAINNET"}`);
  logger.info(`[2/5] Master Wallet: ${cfg.SOLANA_PRIVATE_KEY ? "[CONFIGURED]" : "[NOT SET]"}`);

  // Step 1: AI Token Identity Generation
  logger.info(`[3/5] Meracik identitas token meme via AI...`);
  let identity: TokenIdentity;
  try {
    identity = await generateTokenIdentity("Solana High Velocity Meme");
    logger.success(`      Token: $${identity.ticker} (${identity.name})`);
  } catch (err: any) {
    logger.warn(`      Fallback AI: Menggunakan identitas darurat karena: ${err?.message || err}`);
    identity = {
      name: "Solana Pump Runner",
      ticker: "SOLRUN",
      description: "Autonomous meme launched on Solana Pump.fun bonding curve.",
      viralScore: 88,
      imagePrompt: "Cute robotic runner on neon Solana highway, digital art 4k",
      website: "https://solana.com",
      twitter: "https://x.com",
      telegram: "https://t.me",
    };
  }

  // Step 1.5: Pre-Deploy Demand & Saturation Check
  logger.info(`🔍 [DEMAND GATE] Memeriksa saturasi pasar DexScreener untuk ${identity.ticker}...`);
  try {
    const sat = await checkCrossChainSaturation(identity.ticker, ["solana"]);
    if (sat.saturated || sat.count >= 3) {
      throw new Error(`ABORT: SATURATION FAILED — Ticker ${identity.ticker} terdeteksi jenuh (${sat.count} token serupa dalam 2 jam terakhir).`);
    }
    logger.success(`✅ [DEMAND GATE] Pasar aman! ${identity.ticker} belum jenuh (ditemukan: ${sat.count} token serupa).`);
  } catch (satErr: any) {
    if (satErr.message?.startsWith("ABORT:")) throw satErr;
    logger.warn(`   Notice demand gate: ${satErr.message}`);
  }

  if (!isSimulation && cfg.SOLANA_PRIVATE_KEY) {
    try {
      const masterKeypair = Keypair.fromSecretKey(bs58.decode(cfg.SOLANA_PRIVATE_KEY));
      const solBal = await checkSolanaNativeBalance(masterKeypair.publicKey.toBase58(), 0.009);
      if (solBal.outcome === "insufficient_balance") {
        throw new Error(`ABORT: Saldo SOL tidak mencukupi (${solBal.actualBalance?.toFixed(4)} SOL < 0.009 SOL). Peluncuran dibatalkan demi keamanan modal.`);
      }
      logger.info(`💰 [BALANCE] Saldo terverifikasi: ${solBal.actualBalance?.toFixed(6)} SOL (Cukup untuk peluncuran).`);
    } catch (balErr: any) {
      if (balErr.message?.startsWith("ABORT:")) throw balErr;
      logger.warn(`   Notice balance preflight: ${balErr.message}`);
    }
  }

  // Step 2: Generate Logo & Pin to IPFS
  logger.info(`[4/5] Menghasilkan logo & mengunggah metadata ke Pinata IPFS...`);
  let assets: UploadResult;
  try {
    const logoBuffer = await generateTokenLogo(identity.imagePrompt, identity.name);
    const uploadRes = await uploadTokenAssets(logoBuffer, identity);
    if (!uploadRes) throw new Error("Upload returned null");
    assets = uploadRes;
    logger.success(`      IPFS Metadata: ${assets.metadataUrl}`);
  } catch (err: any) {
    logger.warn(`      Fallback IPFS: Menggunakan metadata placeholder: ${err?.message || err}`);
    assets = {
      imageUrl: "https://ipfs.io/ipfs/bafkreic7xwdlyoasomc552h5l3omg2o6zly3evsxd7h2x46xoxe3f22l34",
      metadataUrl: "https://ipfs.io/ipfs/bafkreiaa36k7vj3g44zmsr4nly6jvxqeqx2uclb35q25p3evr2v4754pnm",
      ipfsImageUri: "ipfs://bafkreic7xwdlyoasomc552h5l3omg2o6zly3evsxd7h2x46xoxe3f22l34",
    };
  }

  // Step 3: Resolve Solana Multi-Wallet Deployer & Record Pre-Deployment in Vault
  let feePayerKey: string | undefined;
  let feePayerPubkey: string | undefined;
  let activeWalletId = "default-operator";

  if (requestedWalletId) {
    const q = requestedWalletId.trim().toLowerCase();
    let wAccount: ReturnType<typeof getWalletAccount> = null;
    if (q === "1" || q === "sub-1" || q === "sub-wallet-1") {
      wAccount = listWalletAccounts().find((w) => w.label.includes("#1")) || null;
    } else if (q === "2" || q === "sub-2" || q === "sub-wallet-2") {
      wAccount = listWalletAccounts().find((w) => w.label.includes("#2")) || null;
    } else if (q === "3" || q === "sub-3" || q === "sub-wallet-3") {
      wAccount = listWalletAccounts().find((w) => w.label.includes("#3")) || null;
    } else {
      wAccount = getWalletAccount(requestedWalletId) || getWalletByAddress(requestedWalletId);
    }

    if (wAccount && wAccount.solanaAddress) {
      const subKey = getWalletKeyByAddress(wAccount.solanaAddress);
      if (subKey) {
        feePayerKey = subKey;
        feePayerPubkey = wAccount.solanaAddress;
        activeWalletId = wAccount.id;
        logger.info(`🔑 [MULTI-WALLET SOLANA] Using Sub-Wallet: '${wAccount.id}' (${wAccount.label})`);
        logger.info(`   Fee Payer EOA: ${feePayerPubkey} [0% CLUSTER]`);
      } else {
        logger.warn(`⚠️  Private key for wallet '${requestedWalletId}' not found in vault. Using default master.`);
      }
    }
  }

  if (!feePayerPubkey && cfg.SOLANA_PRIVATE_KEY) {
    try {
      const kp = Keypair.fromSecretKey(bs58.decode(cfg.SOLANA_PRIVATE_KEY));
      feePayerPubkey = kp.publicKey.toBase58();
      feePayerKey = cfg.SOLANA_PRIVATE_KEY;
    } catch {}
  }

  const candidateId = generateCandidateId();
  const deployLogId = logDeploy({
    chain: "solana",
    tokenName: identity.name,
    ticker: identity.ticker,
    status: "submitted",
    candidateId,
    walletId: activeWalletId,
  });

  updateDeployLifecycle(deployLogId, "DEPLOY_SUBMITTED", { status: "pending" });

  // Step 4: Dispatch to Pump.fun protected by Production Deployment Safety Gate
  logger.info(`[5/5] Mengirim instruksi peluncuran ke Pump.fun via Safety Gate...`);

  let result;
  const gateExecution = await executeWithDeploymentSafetyGate(
    {
      chain: "solana",
      identity,
      assets,
      walletAddress: feePayerPubkey,
      isSimulation,
    },
    async () => {
      return await deployViaPumpFun(identity, assets, {
        simulateOnly: isSimulation,
        feePayerPrivateKey: feePayerKey,
      });
    }
  );

  if (!gateExecution.success || !gateExecution.result) {
    const gateErr = gateExecution.error || "SAFETY_GATE_REJECTED";
    logger.error(`❌ [SAFETY GATE] Deployment Solana diblokir oleh Safety Gate: ${gateErr}`);
    result = {
      success: false,
      status: "failed" as const,
      error: `Safety gate rejection: ${gateErr}`,
    };
  } else {
    result = gateExecution.result;
  }

  if (result.success) {
    const lifecycleState = isSimulation ? "SIMULATED" : "DEPLOY_CONFIRMED";
    updateDeployLifecycle(deployLogId, lifecycleState, {
      status: isSimulation ? "unknown" : "confirmed",
      contractAddr: result.contractAddress,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      simulated: isSimulation,
    });

    console.log(`
=================================================================
  [+] PELUNCURAN SOLANA PUMP.FUN BERHASIL [+]
=================================================================
  Status:           ${result.simulated ? "SIMULATED (TESTNET)" : "LIVE ON-CHAIN"}
  Token:            $${identity.ticker} (${identity.name})
  Mint Address:     ${result.contractAddress}
  Tx Signature:     ${result.txHash}
  Solscan Explorer: ${result.explorerUrl}
  Pump.fun Chart:   https://pump.fun/${result.contractAddress}
=================================================================
`);

    // Generate Irresistible Offer Deck for Investors & Community
    try {
      const offer = generateIrresistibleOffer({
        name: identity.name,
        ticker: identity.ticker,
        contractAddress: result.contractAddress,
        chain: "solana",
        viralScore: identity.viralScore,
      });

      console.log("\n" + offer.fullOfferCard);

      const saveRes = saveOfferDeckMarkdown(offer, { chainSuffix: true });
      if (saveRes.success) {
        logger.success(`   📄 Materi Promosi Tersimpan: ${saveRes.chainPath || saveRes.primaryPath}`);
      } else {
        logger.warn(`   Notice saving offer deck: ${saveRes.error}`);
      }
    } catch (oErr: any) {
      logger.warn(`Notice offer generator: ${oErr?.message || oErr}`);
    }

    // PHASE: AUTO-GENERATE WEB3 WEBSITE & CLOUDFLARE PAGES
    let solanaLiveWeb3Url: string | undefined;
    try {
      logger.info(`🌐 [WEB3 ENGINE] Membangun Website untuk Solana $${identity.ticker}...`);
      const { generateTokenWebsite } = await import("../src/modules/growth/website-generator.ts");
      const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
      const { updateDeployLogWebsite } = await import("../src/db/vault.ts");

      const siteRes = await generateTokenWebsite({
        name: identity.name,
        ticker: identity.ticker,
        contractAddress: result.contractAddress,
        chainId: 101,
        chainName: "solana",
        description: identity.description,
        logoUrl: assets.imageUrl,
        websiteUrl: identity.website,
        twitterUrl: identity.twitter,
        telegramUrl: identity.telegram,
      });

      const cfRes = await deployWebsiteToCloudflarePages({
        siteDir: siteRes.siteDirectory,
        ticker: identity.ticker,
        contractAddress: result.contractAddress,
        chain: "solana",
      });
      solanaLiveWeb3Url = cfRes.deploymentUrl;
      updateDeployLogWebsite(result.contractAddress, solanaLiveWeb3Url);
      logger.success(`   🚀 [CLOUDFLARE PAGES] Live DApp: ${solanaLiveWeb3Url}`);
    } catch (wErr: any) {
      logger.warn(`   Notice Web3 Website / Cloudflare Pages: ${wErr?.message || wErr}`);
    }

    // PHASE: NEON POSTGRESQL SSOT CLOUD SYNC
    try {
      const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("../src/db/neon-vault.ts");
      if (isNeonConfigured()) {
        const neonRes = await syncTokenDeploymentToNeon({
          contractAddr: result.contractAddress,
          ticker: identity.ticker,
          tokenName: identity.name,
          chain: "solana",
          txHash: result.txHash,
          websiteUrl: solanaLiveWeb3Url || `https://rtrader.pages.dev/token/solana/${result.contractAddress}`,
          creatorWallet: feePayerPubkey,
          description: identity.description,
          launchMode: "PUMP_FUN",
        });
        if (neonRes.success) {
          logger.success(`   🐘 [NEON CLOUD] Solana token '${neonRes.dbName}' tersinkronisasi di Neon PostgreSQL SSOT!`);
        }
      }
    } catch (neonErr: any) {
      logger.warn(`   🐘 [NEON CLOUD] Notice Neon cloud sync: ${neonErr?.message || neonErr}`);
    }
  } else {
    updateDeployLifecycle(deployLogId, "FAILED", {
      status: "failed",
      errorMsg: result.error,
    });

    console.error(`
=================================================================
  [!] PELUNCURAN SOLANA PUMP.FUN GAGAL [!]
=================================================================
  Error: ${result.error}
=================================================================
`);
  }

  // Step 5: Post-deployment auto-sweeper (return leftover lamports to master)
  try {
    logger.info("Memeriksa sisa saldo SOL pada dompet sekali pakai untuk di-sweep...");
    await sweepLeftoverSol();
  } catch (sweepErr: any) {
    logger.warn(`Sweep notice: ${sweepErr?.message || sweepErr}`);
  }
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal deployment runner error:", err);
      process.exit(1);
    });
}
