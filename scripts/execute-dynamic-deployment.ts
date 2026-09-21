#!/usr/bin/env bun
/**
 * scripts/execute-dynamic-deployment.ts
 *
 * Unified Omnichain Dynamic Token Deployer.
 *
 * Supports:
 *  - Target Chains: Base L2 (Bankr API), Solana Mainnet (Pump.fun), or Dual-Chain (Both).
 *  - Identity Modes: AI Viral Generator (ModelArk / Gemini) OR Custom Manual Name/Ticker.
 *  - Execution Modes: Simulated (Testnet / Rp 0) OR Live On-Chain.
 *  - Full Vault Lineage Tracking & Post-Deploy Sol Sweeping.
 *
 * ZERO DUPLICATION: Reuses bankr-deployer, pumpfun-deployer, gemini-brain,
 * pollinations-gen, pinata-uploader, and vault directly.
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as readline from "readline";
import { getConfig, resetConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { deployViaBankr } from "../src/modules/evm/bankr-deployer.ts";
import { deployViaPumpFun, sweepLeftoverSol } from "../src/modules/solana/pumpfun-deployer.ts";
import { generateTokenIdentity, type TokenIdentity } from "../src/modules/ai/gemini-brain.ts";
import { generateTokenLogo } from "../src/modules/image/pollinations-gen.ts";
import { uploadTokenAssets, type UploadResult } from "../src/modules/ipfs/pinata-uploader.ts";
import * as fs from "fs";
import * as path from "path";
import {
  logDeploy,
  updateDeployLifecycle,
  generateCandidateId,
} from "../src/db/vault.ts";
import {
  bootstrapDefaultWallet,
  selectExecutionWallet,
  getWalletAccount,
  resolveOperationalContext,
  resolveCredential,
} from "../src/modules/identity/wallet-manager.ts";
import { executeWithDeploymentSafetyGate } from "../src/modules/deploy-guard.ts";
import { generateIrresistibleOffer, saveOfferDeckMarkdown } from "../src/modules/growth/token-offer-generator.ts";
import { checkCrossChainSaturation } from "../src/modules/market/saturation-checker.ts";
import { checkSolanaNativeBalance, checkEvmNativeBalance } from "../src/modules/identity/preflight-balance.ts";
import { runTrendingBoostCycle } from "../src/modules/growth/trending-booster.ts";
import { dispatchBeaconCard } from "../src/modules/social/beacon-broadcaster.ts";
import { generateReferralLink } from "../src/modules/growth/flywheel-engine.ts";
import {
  verifyEvmTransactionReceipt,
  calculateEvmDeploymentCost,
  deriveEvmAddress,
  BANKR_BASE_RELAYER_ADDRESS,
  type EvmGasSponsorshipVerification,
} from "../src/modules/reconciliation/evm-verifier.ts";
import { recordGasSponsorshipToLedger } from "../src/modules/treasury/treasury-ledger.ts";
import { linkTokenToBankrProject } from "./manage-bankr-project.ts";
import {
  deployClanker,
  CLANKER_LAUNCHPAD_URL,
} from "../src/modules/evm/clanker-deployer.ts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

export interface DynamicDeployOptions {
  chain: "base" | "solana" | "dual" | "clanker" | "arc" | "robinhood" | "arbitrum";
  simulate: boolean;
  customName?: string;
  customTicker?: string;
  customDescription?: string;
  customPrompt?: string;
}

export function parseCliArgs(argv: string[]): DynamicDeployOptions {
  let chain: "base" | "solana" | "dual" | "clanker" | "arc" | "robinhood" | "arbitrum" = "base";
  let simulate = false;
  let customName: string | undefined;
  let customTicker: string | undefined;
  let customDescription: string | undefined;
  let customPrompt: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--chain" || arg === "-c") {
      const val = argv[i + 1]?.toLowerCase();
      if (val === "base" || val === "solana" || val === "dual" || val === "clanker" || val === "arc" || val === "robinhood" || val === "arbitrum") {
        chain = val as any;
        i++;
      }
    } else if (arg.startsWith("--chain=")) {
      const val = arg.split("=")[1]?.toLowerCase();
      if (val === "base" || val === "solana" || val === "dual" || val === "clanker" || val === "arc" || val === "robinhood" || val === "arbitrum") {
        chain = val as any;
      }
    } else if (arg === "--simulate" || arg === "-s") {
      simulate = true;
    } else if (arg === "--live" || arg === "-l") {
      simulate = false;
    } else if (arg === "--name" || arg === "-n") {
      customName = argv[i + 1];
      i++;
    } else if (arg === "--ticker" || arg === "-t") {
      customTicker = argv[i + 1];
      i++;
    } else if (arg === "--desc") {
      customDescription = argv[i + 1];
      i++;
    } else if (arg === "--prompt") {
      customPrompt = argv[i + 1];
      i++;
    }
  }

  return { chain, simulate, customName, customTicker, customDescription, customPrompt };
}

async function promptInteractiveOptions(cliOpts: DynamicDeployOptions): Promise<DynamicDeployOptions> {
  const isInteractive = process.stdin.isTTY && process.argv.length <= 2;
  if (!isInteractive) return cliOpts;

  console.log(`
=================================================================
  [+] OMNICHAIN LAUNCHPAD - DYNAMIC TOKEN DEPLOYER WIZARD [+]
=================================================================
Pilih Jaringan Target Deployment:
  [1] Base L2 (Bankr API - 100% Relayer Gas Sponsored / Rp 0)
  [2] Solana Mainnet (Pump.fun Bonding Curve - ~0.009 SOL)
  [3] Dual-Chain Simultan (Base L2 + Solana Mainnet)
  [4] Clanker Base (v3.1 Factory, On-Chain, Base Mainnet)
  [5] Batal / Keluar
`);

  const chainChoice = await askQuestion("Pilihan Anda [1-5] (default 1): ");
  if (chainChoice === "5") {
    console.log("Dibatalkan oleh pengguna.");
    process.exit(0);
  }

  let selectedChain: "base" | "solana" | "dual" | "clanker" = "base";
  if (chainChoice === "2") selectedChain = "solana";
  else if (chainChoice === "3") selectedChain = "dual";
  else if (chainChoice === "4") selectedChain = "clanker";

  console.log(`
Pilih Mode Identitas Token:
  [1] Otomatis AI (ModelArk / Gemini Radar Viral Signals)
  [2] Kustom Manual (Tentukan Nama, Ticker, dan Tema Sendiri)
`);
  const identityChoice = await askQuestion("Pilihan Anda [1-2] (default 1): ");

  let customName: string | undefined;
  let customTicker: string | undefined;
  let customDescription: string | undefined;
  let customPrompt: string | undefined;

  if (identityChoice === "2") {
    customName = await askQuestion("Nama Token (misal: Moon Cat): ");
    customTicker = await askQuestion("Ticker Token (misal: MCAT): ");
    customDescription = await askQuestion("Deskripsi Singkat Token: ");
    customPrompt = await askQuestion("Prompt Gambar Logo (opsional): ");
  }

  console.log(`
Pilih Mode Eksekusi:
  [1] Mode Simulasi / Testnet (Tanpa Gas / Rp 0 / Pembuktian Alur)
  [2] Mode Live On-Chain (Mainnet Resmi)
`);
  const modeChoice = await askQuestion("Pilihan Anda [1-2] (default 1): ");
  const simulate = modeChoice !== "2";

  return {
    chain: selectedChain,
    simulate,
    customName: customName || undefined,
    customTicker: customTicker?.toUpperCase() || undefined,
    customDescription: customDescription || undefined,
    customPrompt: customPrompt || undefined,
  };
}

export async function executeDynamicDeployment(opts: DynamicDeployOptions): Promise<{
  candidateId: string;
  identity: TokenIdentity;
  assets: UploadResult;
  results: Record<string, any>;
}> {
  if (opts.simulate) {
    process.env.DEPLOY_MODE = "testnet";
    resetConfig();
  }

  const cfg = getConfig();
  const isSimulation = opts.simulate || cfg.DEPLOY_MODE === "testnet";

  console.log(`
=================================================================
  [+] MEMULAI DEPLOYMENT DINAMIS MULTI-TOKEN [+]
=================================================================
  Target Rantai:    ${opts.chain.toUpperCase()}
  Mode Eksekusi:    ${isSimulation ? "SIMULASI (RP 0 / TESTNET)" : "LIVE ON-CHAIN (MAINNET)"}
  Identitas Token:  ${opts.customName ? "KUSTOM MANUAL" : "OTOMATIS AI MEME RADAR"}
=================================================================
`);

  // Step 1: Resolve Token Identity
  logger.info("[1/4] Menyiapkan identitas token...");
  let identity: TokenIdentity;
  if (opts.customName && opts.customTicker) {
    identity = {
      name: opts.customName,
      ticker: opts.customTicker,
      description: opts.customDescription || `Autonomous community meme token on ${opts.chain.toUpperCase()}.`,
      viralScore: 95,
      imagePrompt: opts.customPrompt || `Iconic high quality logo for ${opts.customName} crypto meme coin, 3d render digital art`,
      website: "https://base.org",
      twitter: "https://x.com",
      telegram: "https://t.me",
    };
    logger.success(`      Token Kustom: $${identity.ticker} ("${identity.name}")`);
  } else {
    try {
      identity = await generateTokenIdentity("High Velocity Omnichain Meme");
      logger.success(`      AI Generated: $${identity.ticker} ("${identity.name}") [Viral Score: ${identity.viralScore}/100]`);
    } catch (err: any) {
      logger.warn(`      Fallback AI Identitas: ${err?.message || err}`);
      identity = {
        name: "Omni Runner",
        ticker: "OMNIRUN",
        description: "Autonomous multi-chain meme launched across Base L2 and Solana.",
        viralScore: 88,
        imagePrompt: "Futuristic robotic runner leaping between neon blockchains, vibrant cyberpunk digital art",
        website: "https://base.org",
        twitter: "https://x.com",
        telegram: "https://t.me",
      };
    }
  }

  const targetChains = opts.chain === "dual" ? ["base", "solana"] : [opts.chain];

  // Step 1.5: Pre-Deploy Demand & Anti-Saturation Gate
  logger.info(`🔍 [DEMAND GATE] Memeriksa saturasi pasar DexScreener untuk ${identity.ticker}...`);
  try {
    const satResult = await checkCrossChainSaturation(identity.ticker, targetChains);
    if (satResult.saturated || satResult.count >= 3) {
      logger.warn(`⚠️  [DEMAND GATE] Ticker ${identity.ticker} terdeteksi jenuh (${satResult.count} token serupa dalam 2 jam terakhir)!`);
      if (process.stdin.isTTY && !isSimulation) {
        const satConfirm = await askQuestion(`Ticker ${identity.ticker} sudah ramai di pasar. Tetap lanjutkan? (y/N): `);
        if (satConfirm.toLowerCase() !== "y") {
          logger.info("Peluncuran dibatalkan oleh operator demi menghindari risiko pasar jenuh (Rp 0 keluar).");
          return { candidateId: "", identity, assets: {} as any, results: {} };
        }
      }
    } else {
      logger.success(`✅ [DEMAND GATE] Pasar aman! ${identity.ticker} belum jenuh (${satResult.count} token serupa).`);
    }
  } catch (satErr: any) {
    logger.warn(`   Notice demand gate: ${satErr?.message || satErr}`);
  }

  // Capital Safety & Explicit Confirmation Dialog (Khusus Mode Live On-Chain)
  if (!isSimulation) {
    console.log(`
=================================================================
  [!] AUDIT KESELAMATAN MODAL & BIAYA DEPLOYMENT LIVE [!]
=================================================================
  Token Kandidat    : ${identity.ticker} ("${identity.name}")
  Skor Viral AI     : ${identity.viralScore}/100
  Target Rantai     : ${targetChains.map((c) => c.toUpperCase()).join(" + ")}
`);

    if (targetChains.includes("solana")) {
      let solAddress: string | undefined;
      try {
        if (cfg.SOLANA_PRIVATE_KEY) {
          solAddress = Keypair.fromSecretKey(bs58.decode(cfg.SOLANA_PRIVATE_KEY)).publicKey.toBase58();
        }
      } catch {}
      const solBal = await checkSolanaNativeBalance(solAddress, 0.009);
      console.log(`  [SOLANA PUMP.FUN]`);
      console.log(`    - Dompet Operator: ${solAddress || "N/A"}`);
      console.log(`    - Saldo Saat Ini : ${solBal.actualBalance !== undefined ? `${solBal.actualBalance.toFixed(6)} SOL` : "Memeriksa..."}`);
      console.log(`    - Estimasi Biaya : ~0.009000 SOL (Rent Akun + Priority Fee + Dev Buy)`);
      if (solBal.outcome === "insufficient_balance") {
        logger.error(`❌ Saldo Solana tidak mencukupi (${solBal.actualBalance?.toFixed(4)} SOL < 0.009 SOL). Peluncuran dibatalkan demi keamanan modal.`);
        return { candidateId: "", identity, assets: {} as any, results: {} };
      }
    }

    if (targetChains.includes("base")) {
      console.log(`  [BASE L2 (BANKR)]`);
      console.log(`    - Gas Sponsorship: 100% DISPONSORI RELAYER (Biaya Anda: 0.0 ETH)`);
    }

    if (targetChains.includes("clanker")) {
      const opAddr = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);
      const devBuyEth = cfg.CLANKER_DEV_BUY_ETH ?? 0;
      const minNeeded = 0.006 + devBuyEth;
      const evmBal = await checkEvmNativeBalance("base", opAddr || "", minNeeded);
      console.log(`  [CLANKER BASE (v3.1 FACTORY)]`);
      console.log(`    - Dompet Operator: ${opAddr || "N/A"}`);
      console.log(`    - Saldo Saat Ini : ${evmBal.actualBalance !== undefined ? `${evmBal.actualBalance.toFixed(6)} ETH` : "Memeriksa..."}`);
      console.log(`    - Estimasi Gas   : ~0.001 - 0.005 ETH${devBuyEth > 0 ? ` + Dev Buy ${devBuyEth} ETH` : ""}`);
      if (evmBal.outcome === "insufficient_balance") {
        logger.error(`❌ Saldo ETH Base tidak mencukupi (${evmBal.actualBalance?.toFixed(6)} ETH < ${minNeeded.toFixed(4)} ETH). Peluncuran dibatalkan demi keamanan.`);
        return { candidateId: "", identity, assets: {} as any, results: {} };
      }
    }

    console.log(`=================================================================`);

    if (process.stdin.isTTY) {
      const confirmLive = await askQuestion(`Apakah Anda yakin ingin mengeksekusi peluncuran LIVE dengan biaya di atas? (Y/N): `);
      if (confirmLive.toUpperCase() !== "Y") {
        logger.info("Peluncuran LIVE dibatalkan oleh operator. Saldo Anda utuh 100% (Rp 0 keluar).");
        return { candidateId: "", identity, assets: {} as any, results: {} };
      }
    }
  }

  // Step 2: Generate Logo & Pin to IPFS
  logger.info("[2/4] Menghasilkan visual logo & metadata IPFS...");
  let assets: UploadResult;
  try {
    const logoBuffer = await generateTokenLogo(identity.imagePrompt, identity.name);
    const uploadRes = await uploadTokenAssets(logoBuffer, identity);
    if (!uploadRes) throw new Error("Upload metadata returned null");
    assets = uploadRes;
    logger.success(`      Logo IPFS:     ${assets.imageUrl}`);
    logger.success(`      Metadata IPFS: ${assets.metadataUrl}`);
  } catch (err: any) {
    logger.warn(`      Fallback IPFS: Menggunakan metadata placeholder karena: ${err?.message || err}`);
    assets = {
      imageUrl: "https://ipfs.io/ipfs/bafkreic7xwdlyoasomc552h5l3omg2o6zly3evsxd7h2x46xoxe3f22l34",
      metadataUrl: "https://ipfs.io/ipfs/bafkreiaa36k7vj3g44zmsr4nly6jvxqeqx2uclb35q25p3evr2v4754pnm",
      ipfsImageUri: "ipfs://bafkreic7xwdlyoasomc552h5l3omg2o6zly3evsxd7h2x46xoxe3f22l34",
    };
  }

  const candidateId = generateCandidateId();
  const results: Record<string, any> = {};

  // Step 3: Deploy to each target chain
  for (const chain of targetChains) {
    logger.info(`[3/4] Meluncurkan ke rantai: ${chain.toUpperCase()}...`);

    const deployLogId = logDeploy({
      chain,
      tokenName: identity.name,
      ticker: identity.ticker,
      ipfsUrl: assets.metadataUrl,
      status: "pending",
      lifecycleState: "DEPLOY_SUBMITTED",
      candidateId,
      viralScore: identity.viralScore,
    });

    let res: any;
    let operatorWalletAddress: string | undefined;
    if (chain === "base" || chain === "clanker") {
      operatorWalletAddress = cfg.EVM_OPERATOR_ADDRESS || deriveEvmAddress(cfg.EVM_PRIVATE_KEY) || undefined;
    } else if (chain === "solana" && cfg.SOLANA_PRIVATE_KEY) {
      try {
        operatorWalletAddress = Keypair.fromSecretKey(bs58.decode(cfg.SOLANA_PRIVATE_KEY)).publicKey.toBase58();
      } catch {}
    }

    const gateExecution = await executeWithDeploymentSafetyGate(
      {
        chain,
        identity,
        assets,
        walletAddress: operatorWalletAddress,
        isSimulation,
      },
      async () => {
        if (chain === "base" || chain === "arc" || chain === "robinhood" || chain === "arbitrum") {
          const walletArg = process.argv.find((a) => a.startsWith("--wallet="));
          const requestedWalletId = walletArg ? walletArg.split("=")[1]?.trim() : undefined;
          const targetWallet = requestedWalletId
            ? (getWalletAccount(requestedWalletId) ?? bootstrapDefaultWallet())
            : selectExecutionWallet({ requiredProvider: "bankr", targetChains: [chain] });
          const bankrContext = resolveOperationalContext(targetWallet.id, "bankr");
          const resolvedApiKey = (bankrContext.credentialRef ? resolveCredential(bankrContext.credentialRef) : null) || cfg.BANKR_API_KEY;
          return await deployViaBankr(identity, assets, {
            chain,
            apiKey: resolvedApiKey,
            proxyUrl: bankrContext.proxyUrl ?? undefined,
            simulateOnly: isSimulation,
            quoteOnlyFees: true,
          });
        } else if (chain === "solana") {
          return await deployViaPumpFun(identity, assets, {
            simulateOnly: isSimulation,
          });
        } else if (chain === "clanker") {
          const clankerRes = await deployClanker(identity, assets, {
            dryRun: isSimulation,
            devBuyEth: cfg.CLANKER_DEV_BUY_ETH,
          });
          return {
            success: clankerRes.success,
            status: clankerRes.success ? "success" : "failed",
            contractAddress: clankerRes.tokenAddress,
            txHash: clankerRes.txHash,
            poolId: clankerRes.poolAddress,
            explorerUrl: clankerRes.explorerUrl,
            simulated: clankerRes.simulated,
            error: clankerRes.error,
          };
        }
        throw new Error(`Unsupported chain: ${chain}`);
      }
    );

    if (!gateExecution.success || !gateExecution.result) {
      const gateErr = gateExecution.error || "SAFETY_GATE_REJECTED";
      logger.error(`❌ [SAFETY GATE] Deployment ke rantai ${chain.toUpperCase()} diblokir oleh Safety Gate: ${gateErr}`);
      res = {
        success: false,
        status: "failed",
        error: `Safety gate rejection: ${gateErr}`,
      };
    } else {
      res = gateExecution.result;
    }

    results[chain] = res;

    if (res && res.success) {
      let attributionReason: string | undefined;
      let costVerification: EvmGasSponsorshipVerification | undefined;

      if (chain === "base" && !isSimulation && res.txHash) {
        logger.info(`⏳ [RECEIPT] Memantau konfirmasi on-chain Base untuk ${res.txHash}...`);
        let receiptResult;
        for (let i = 0; i < 30; i++) {
          receiptResult = await verifyEvmTransactionReceipt(res.txHash, "base");
          if (receiptResult.status === "confirmed" || receiptResult.status === "failed") break;
          await new Promise((r) => setTimeout(r, 4000));
        }

        if (receiptResult?.status === "confirmed" && receiptResult.receipt) {
          const receipt = receiptResult.receipt;
          costVerification = calculateEvmDeploymentCost(
            receipt,
            operatorWalletAddress,
            "base",
            BANKR_BASE_RELAYER_ADDRESS
          );
          attributionReason = costVerification.summary;

          if (receipt.from?.toLowerCase() === BANKR_BASE_RELAYER_ADDRESS.toLowerCase()) {
            try {
              recordGasSponsorshipToLedger({
                deployLogId,
                chain: "base",
                tokenSymbol: "ETH",
                networkGasCostEth: costVerification.networkGasCostEth,
                relayerAddress: receipt.from,
                txHash: res.txHash,
              });
            } catch (sponsorErr) {
              logger.warn(
                `⚠️  [TREASURY] Gagal mencatat gas sponsorship ke ledger: ${sponsorErr instanceof Error ? sponsorErr.message : String(sponsorErr)}`
              );
            }
          } else {
            logger.warn(`⚠️  [SPONSORSHIP] Payer on-chain (${receipt.from}) tidak cocok dengan relayer resmi Bankr (${BANKR_BASE_RELAYER_ADDRESS}).`);
          }
        } else {
          logger.warn(`⚠️  [RECEIPT] Transaksi tidak terkonfirmasi dalam batas waktu (status: ${receiptResult?.status}).`);
        }
      }

      const lifecycleState = isSimulation ? "SIMULATED" : "DEPLOY_CONFIRMED";
      updateDeployLifecycle(deployLogId, lifecycleState, {
        status: isSimulation ? "unknown" : "confirmed",
        contractAddr: res.contractAddress,
        txHash: res.txHash,
        explorerUrl: res.explorerUrl,
        poolId: res.poolId,
        deployCost: 0.0,
        simulated: isSimulation,
        attributionStatus: "confirmed",
        attributionReason: attributionReason ?? (isSimulation ? "Simulation mode verified" : undefined),
      });
      logger.success(`✅ [${chain.toUpperCase()}] Deployment Sukses! Kontrak: ${res.contractAddress}`);

      // Auto-Link to Bankr Project for Base Mainnet
      if (chain === "base" && !isSimulation && res.contractAddress) {
        try {
          logger.info(`🤖 [BANKR PROJECT] Otomatis menautkan token ${identity.ticker} ke profil Bankr...`);
          const linkRes = await linkTokenToBankrProject(res.contractAddress, identity.name, {
            description: identity.description,
            website: identity.website,
            profileImageUrl: assets.imageUrl,
            isPublished: true,
          });
          logger.success(`   ✅ [BANKR PROJECT] Profil agen terhubung: https://bankr.bot/agents/${linkRes.profile.slug}`);
        } catch (pErr: any) {
          logger.warn(`   Notice linking Bankr profile: ${pErr?.message || pErr}`);
        }
      }

      // Auto-Sync to Neon PostgreSQL Master SSOT
      if (res.contractAddress) {
        try {
          const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("../src/db/neon-vault.ts");
          if (isNeonConfigured()) {
            const neonRes = await syncTokenDeploymentToNeon({
              contractAddr: res.contractAddress,
              ticker: identity.ticker,
              tokenName: identity.name,
              chain: chain === "base" ? "base" : chain,
              poolId: res.poolId,
              txHash: res.txHash,
              creatorWallet: cfg.EVM_OPERATOR_ADDRESS,
              description: identity.description,
            });
            if (neonRes.success) {
              logger.success(`   🐘 [NEON CLOUD] Database token '${neonRes.dbName}' siap & tersinkronisasi di Neon PostgreSQL!`);
            }
          }
        } catch (neonErr: any) {
          logger.warn(`   Notice Neon cloud sync: ${neonErr?.message || neonErr}`);
        }
      }

      // POST-DEPLOY IMMEDIATE MOMENTUM KICKSTART (Anti-Sepi Pembeli)
      logger.info(`🚀 [MOMENTUM ENGINE] Memulai DexScreener Unique Maker kickstart untuk ${identity.ticker}...`);
      try {
        const boostRes = await runTrendingBoostCycle({
          tokenAddress: res.contractAddress,
          tokenSymbol: identity.ticker,
          rounds: 5,
          microAmountEth: 0.0001,
          isSimulated: isSimulation,
        });
        logger.success(`   ✅ [MOMENTUM ENGINE] ${boostRes.totalRoundsExecuted} transaksi hijau tercatat (${boostRes.uniqueMakersCount} unique makers)!`);
      } catch (bErr: any) {
        logger.warn(`   Notice momentum engine: ${bErr?.message || bErr}`);
      }

      // Non-blocking Beacon Broadcast
      try {
        const isClanker = chain === "clanker";
        const chartUrl = (chain === "base" || isClanker)
          ? `https://dexscreener.com/base/${res.contractAddress}`
          : `https://pump.fun/${res.contractAddress}`;
        const clankerExtra = isClanker ? `\n🌐 Clanker: ${CLANKER_LAUNCHPAD_URL}${res.contractAddress}\n💎 40% LP Fee Retention` : "";
        const launchMsg = `🚀 **NEW TOKEN LAUNCH: ${identity.ticker} (${identity.name})**\n⛓️ Chain: ${chain.toUpperCase()}\n📋 CA: \`${res.contractAddress}\`\n🔥 0% Tax | 30% Auto-Burn | 20% WETH Dividend | 15% Jackpot${clankerExtra}\n📊 Chart: ${chartUrl}${chain === "base" && res.poolId ? `\n🦎 GeckoTerminal: https://www.geckoterminal.com/base/pools/${res.poolId}` : ""}${chain === "base" ? `\n⚡ 1-Click Swap ($1 Activation): https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${res.contractAddress}` : ""}`;
        await dispatchBeaconCard(launchMsg);
      } catch {}
    } else {
      updateDeployLifecycle(deployLogId, "FAILED", {
        status: "failed",
        errorMsg: res?.error || "Deployment failed",
      });
      logger.error(`❌ [${chain.toUpperCase()}] Deployment Gagal: ${res?.error}`);
    }
  }

  // Step 4: Cleanup & Display Summary
  logger.info("[4/4] Finalisasi & pembersihan dompet...");
  if (targetChains.includes("solana") && !isSimulation) {
    try {
      await sweepLeftoverSol();
    } catch (sErr: any) {
      logger.warn(`Notice sweep: ${sErr?.message || sErr}`);
    }
  }

  console.log(`
=================================================================
  [+] RINGKASAN HASIL PELUNCURAN DINAMIS [+]
=================================================================
  Token:      $${identity.ticker} ("${identity.name}")
  Candidate:  ${candidateId}
  Mode:       ${isSimulation ? "SIMULASI (TESTNET)" : "LIVE MAINNET"}
`);

  for (const chain of targetChains) {
    const r = results[chain];
    console.log(`--- [ ${chain.toUpperCase()} ] ---`);
    if (r && r.success) {
      console.log(`  Status:       BERHASIL (${r.simulated ? "Simulated" : "Live On-Chain"})`);
      console.log(`  Kontrak (CA): ${r.contractAddress}`);
      console.log(`  Tx Signature: ${r.txHash}`);
      console.log(`  Penjelajah:   ${r.explorerUrl}`);
      if (chain === "base") {
        console.log(`  DexScreener:  https://dexscreener.com/base/${r.contractAddress}`);
      } else if (chain === "clanker") {
        console.log(`  DexScreener:  https://dexscreener.com/base/${r.contractAddress}`);
        console.log(`  Clanker:      ${CLANKER_LAUNCHPAD_URL}${r.contractAddress}`);
      } else if (chain === "solana") {
        console.log(`  Pump.fun:     https://pump.fun/${r.contractAddress}`);
        console.log(`  DexScreener:  https://dexscreener.com/solana/${r.contractAddress}`);
      }

      // Link Afiliasi 5% WETH Bagi Hasil
      try {
        const opAddr = cfg.EVM_OPERATOR_ADDRESS || "0x946657D17C7e83052D50634D9dA6FF3Fc46b418a";
        const refUrl = generateReferralLink(r.contractAddress, opAddr);
        console.log(`  Link Afiliasi (5% WETH): ${refUrl}`);
      } catch {}

      // Generate Irresistible Offer Card & Tokenomics Integration
      try {
        const offer = generateIrresistibleOffer({
          name: identity.name,
          ticker: identity.ticker,
          contractAddress: r.contractAddress,
          chain,
          poolId: r.poolId,
          viralScore: identity.viralScore,
        });

        console.log("\n" + offer.fullOfferCard);

        const saveRes = saveOfferDeckMarkdown(offer, { chainSuffix: true });
        if (saveRes.success) {
          logger.success(`   📄 Materi Promosi Tersimpan: ${saveRes.chainPath || saveRes.primaryPath}`);
        } else {
          logger.warn(`   Notice saving offer deck: ${saveRes.error}`);
        }
        logger.info(`   🌪️  Tokenomics Otomatis Terhubung: 35% Kas / 30% Burn (0xdead) / 20% Dividen WETH / 15% Jackpot`);
      } catch (oErr: any) {
        logger.warn(`Notice offer generator: ${oErr?.message || oErr}`);
      }
    } else {
      console.log(`  Status: GAGAL`);
      console.log(`  Error:  ${r?.error || "Unknown error"}`);
    }
    console.log("");
  }

  console.log("=================================================================\n");
  console.log("💡 TOKENOMICS OTOMATIS BERJALAN 24/7:");
  console.log("   Jalankan 'START_FLYWHEEL_WORKER.bat' (atau opsi daemon) agar fee yang");
  console.log("   masuk dari seluruh armada token otomatis dibeli balik, dibakar ke 0xdead,");
  console.log("   dan dibagikan dividen ke holders secara autopilot tanpa manual.\n");

  return { candidateId, identity, assets, results };
}

async function main(): Promise<void> {
  const cliOpts = parseCliArgs(process.argv.slice(2));
  const finalOpts = await promptInteractiveOptions(cliOpts);
  await executeDynamicDeployment(finalOpts);
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal deployment error:", err);
      process.exit(1);
    });
}
