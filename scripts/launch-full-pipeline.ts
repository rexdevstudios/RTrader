#!/usr/bin/env bun
/**
 * scripts/launch-full-pipeline.ts
 *
 * PIPELINE OTOMATIS TERPADU — Single Entry Point (Hulu ke Hilir)
 *
 * Mode yang tersedia:
 *   full     → Deploy baru → Tunggu konfirmasi → Beli Katalyst ~$1 → Monitor + Auto-TP
 *   catalyst → Langsung beli token live yang sudah ada + Monitor + Auto-TP
 *   monitor  → Hanya pantau token live yang sudah dibeli (Auto Take-Profit)
 *
 * Prinsip Arsitektur:
 *  1. Min-diff: tidak mengubah skrip deploy / catalyst yang sudah ada.
 *  2. 100% Reuse: spawn subprocess untuk deploy (menjaga semua safety gates),
 *     import langsung dari catalyst untuk buy + monitor.
 *  3. Queue/worker style: setiap langkah menunggu langkah sebelumnya selesai.
 *  4. Multi-wallet aware: mewarisi selectExecutionWallet dari wallet-manager.
 *  5. Zero duplication: DB queries langsung ke vault via DB_PATH.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import { logger } from "../src/logger.ts";
import {
  selectExecutionWallet,
  listWalletAccounts,
  resolveOperationalContext,
  resolveCredential,
  autoFailoverUnhealthyRoutes,
  probeAndResupplyQuarantinedPool,
  listProxyConfigs,
  setProviderRoute,
} from "../src/modules/identity/wallet-manager.ts";
import { isLiveDeployment } from "../src/modules/fleet/fleet-registry.ts";
import {
  resolveTargetToken,
  listLiveTokens,
  executeAutoBuy,
  runLiveMonitor,
} from "./execute-catalyst-trading.ts";

const BANNER = `
===============================================================================
  [+] PIPELINE OTOMATIS TERPADU — HULU KE HILIR [+]
  Pre-Check → Deploy → Tim & Produk → Deck & Referral → Buy $1 → Monitor → Revenue
===============================================================================
`;

// ─────────────────────────────────────────────────────────────────────────────
// DB Helpers — baca dari vault tanpa mengimpor ulang db instance dari vault.ts
// ─────────────────────────────────────────────────────────────────────────────

/** Ambil nilai MAX(id) saat ini dari deploy_logs sebelum deployment dimulai. */
function getCurrentMaxDeployId(): number {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const row = db
      .query<{ max_id: number | null }, []>(`SELECT MAX(id) AS max_id FROM deploy_logs`)
      .get();
    return row?.max_id ?? 0;
  } finally {
    db.close();
  }
}

/** Setelah deployment, cari deploy_log baru yang confirmed (id > beforeId). */
function findNewConfirmedDeployment(beforeId: number): {
  contractAddr: string;
  ticker: string;
  tokenName: string;
  chain: string;
  poolId?: string | null;
} | null {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const rows = db
      .query<
        {
          id: number;
          chain: string;
          contract_addr: string;
          ticker: string;
          token_name: string;
          tx_hash: string | null;
          status: string;
          lifecycle_state: string | null;
          simulated: number | boolean | null;
          pool_id: string | null;
        },
        [number]
      >(
        `SELECT id, chain, contract_addr, ticker, token_name, tx_hash, status, lifecycle_state, simulated, pool_id
         FROM deploy_logs
         WHERE id > ?
           AND (status IN ('confirmed', 'success') OR lifecycle_state = 'DEPLOY_CONFIRMED')
           AND (simulated IS NULL OR simulated = 0)
           AND contract_addr IS NOT NULL
           AND (
             (chain IN ('base', 'robinhood', 'clanker', 'ethereum') AND LENGTH(contract_addr) = 42 AND contract_addr LIKE '0x%')
             OR
             (chain = 'solana' AND LENGTH(contract_addr) >= 32 AND LENGTH(contract_addr) <= 44 AND contract_addr NOT LIKE '0x%')
           )
         ORDER BY id DESC`
      )
      .all(beforeId);

    for (const row of rows) {
      if (
        isLiveDeployment({
          id: row.id,
          chain: row.chain,
          contractAddr: row.contract_addr,
          ticker: row.ticker,
          tokenName: row.token_name,
          txHash: row.tx_hash,
          status: row.status,
          lifecycleState: row.lifecycle_state,
          simulated: Boolean(row.simulated),
        })
      ) {
        return {
          contractAddr: row.contract_addr,
          ticker: row.ticker || "TOKEN",
          tokenName: row.token_name || "Token",
          chain: row.chain || "base",
          poolId: row.pool_id,
        };
      }
    }

    return null;
  } finally {
    db.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt helper
// ─────────────────────────────────────────────────────────────────────────────
async function prompt(question: string): Promise<string> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step runner — spawn sub-proses dan tunggu exit code
// ─────────────────────────────────────────────────────────────────────────────
async function runSubprocess(label: string, args: string[]): Promise<boolean> {
  logger.info(`\n⚙️  [PIPELINE] Menjalankan: ${label}...`);
  const proc = Bun.spawn(["bun", "run", ...args], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    cwd: import.meta.dir + "/..",
  });
  const code = await proc.exited;
  if (code !== 0) {
    logger.error(`❌ [PIPELINE] "${label}" selesai dengan kode error: ${code}`);
    return false;
  }
  logger.success(`✅ [PIPELINE] "${label}" selesai.`);
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 1: PIPELINE PENUH — Deploy → Beli → Monitor
// ─────────────────────────────────────────────────────────────────────────────
async function runFullPipeline(
  preferredWalletId?: string,
  unattended = false,
  skipSimulationProbe = false
): Promise<void> {
  console.log(BANNER);

  // ── FASE 1/5: Audit Kesiapan, Multi-Wallet & Anti-Vamp Radar ───────────────
  logger.info("📋 [FASE 1/5] Memeriksa kesehatan proxy, multi-wallet & radar kesiapan...");

  try {
    const resupply = await probeAndResupplyQuarantinedPool({ minActiveThreshold: 2, timeoutMs: 5000 });
    if (resupply.resuppliedCount > 0) {
      logger.info(`   🔄 [RESUPPLY] Memulihkan ${resupply.resuppliedCount} proxy sehat dari karantina: [${resupply.resuppliedIds.join(", ")}]`);
    }

    const failoverCheck = await autoFailoverUnhealthyRoutes();
    if (failoverCheck.failoversExecuted > 0) {
      logger.warn(`   ⚠️ [FAILOVER] Dialihkan ${failoverCheck.failoversExecuted} rute dompet yang proxy-nya bermasalah ke proxy sehat.`);
    }
  } catch (err: any) {
    logger.warn(`   [PRE-FLIGHT-PROXY-CHECK] Notice: ${err?.message || err}`);
  }

  let targetWalletId = preferredWalletId;
  if (!targetWalletId) {
    const activeWallets = listWalletAccounts("ACTIVE");
    if (activeWallets.length > 1) {
      if (unattended) {
        logger.info(
          `   [UNATTENDED] Menjalankan rotasi round-robin multi-akun otomatis across ${activeWallets.length} dompet aktif.`
        );
      } else {
        console.log("\n💳 Terdeteksi beberapa akun wallet aktif di database vault:");
        activeWallets.forEach((w, idx) => {
          console.log(`   [${idx + 1}] ID: ${w.id.padEnd(16)} | Label: ${w.label.padEnd(25)} | EVM: ${w.evmAddress ?? "N/A"}`);
        });
        const ans = await prompt(`\nPilih nomor akun untuk deploy [1-${activeWallets.length}] (Enter = rotasi/default): `);
        const chosenIdx = parseInt(ans, 10) - 1;
        if (!isNaN(chosenIdx) && activeWallets[chosenIdx]) {
          targetWalletId = activeWallets[chosenIdx].id;
        }
      }
    }
  }

  const wallet = selectExecutionWallet({
    preferredWalletId: targetWalletId,
    requiredProvider: "bankr",
    targetChains: ["base"],
  });
  logger.info(`   Wallet aktif : '${wallet.id}' (${wallet.label})`);
  logger.info(`   EVM Address  : ${wallet.evmAddress ?? "N/A"}\n`);

  // Pastikan wallet memiliki proxy route aktif jika tersedia
  const opCtx = resolveOperationalContext(wallet.id, "bankr");
  if (!opCtx.proxyUrl) {
    const proxies = listProxyConfigs("ACTIVE");
    // Prioritaskan proxy berlokasi US yang berstatus 'available' untuk mematuhi perimeter AWS WAF Bankr API
    const healthyProxy =
      proxies.find(
        (p) =>
          p.id.toLowerCase().includes("us") &&
          p.status === "ACTIVE" &&
          (p.healthStatus === "available" || p.healthStatus === null || p.healthStatus === undefined)
      ) ||
      proxies.find(
        (p) =>
          p.status === "ACTIVE" &&
          (p.healthStatus === "available" || p.healthStatus === null || p.healthStatus === undefined)
      ) ||
      proxies.find((p) => p.id.toLowerCase().includes("us") && p.status === "ACTIVE") ||
      proxies[0];
    if (healthyProxy) {
      setProviderRoute({
        walletId: wallet.id,
        provider: "bankr",
        proxyId: healthyProxy.id,
      });
      logger.info(
        `   🛡️ [AUTO-ROUTE] Dompet '${wallet.id}' belum memiliki proxy, di-route otomatis ke '${healthyProxy.id}' (${healthyProxy.host}:${healthyProxy.port}).`
      );
    }
  }

  // Preflight balance evaluation for Base
  try {
    const { evaluatePreflightBalance } = await import("../src/modules/identity/preflight-balance.ts");
    const preflight = await evaluatePreflightBalance({
      eligibleChains: ["base"],
      evmAddress: wallet.evmAddress,
      minEth: 0,
      minSol: 0,
    });
    if (preflight.summary.allPassed) {
      logger.success(`   ✅ [PREFLIGHT-BALANCE] Saldo on-chain Base siap untuk dompet '${wallet.id}'.`);
    } else {
      logger.warn(`   ⚠️  [PREFLIGHT-BALANCE] Notice saldo: ${preflight.results[0]?.reason || "N/A"}`);
    }
  } catch (balErr: any) {
    logger.warn(`   [PREFLIGHT-BALANCE] Notice: ${balErr?.message || balErr}`);
  }

  // Pre-deploy Anti-Vamp & Clone Radar Check
  logger.info("🛡️  [LANGKAH 0B/5] [ANTI-VAMP-CHECK] Memeriksa status Anti-Vamp & Clone Cluster Radar...");
  try {
    const { normalizeTokenKey } = await import("../src/modules/market/clone-resolver.ts");
    logger.info("   Anti-Vamp Homoglyph & Leetspeak Folding Engine: AKTIF.");
  } catch (err: any) {
    logger.warn(`   [ANTI-VAMP-CHECK] Notice: ${err?.message || err}`);
  }

  // ── FASE 2/5: Peluncuran Token On-Chain (Base Mainnet) ─────────────────────
  const beforeDeployId = getCurrentMaxDeployId();
  logger.info(`\n🚀 [FASE 2/5] Memulai deployment token ke Base Mainnet...`);
  logger.info(`   Snapshot deploy_log MAX(id) sebelum deploy: #${beforeDeployId}`);
  logger.info("   Gas disponsori 100% oleh Bankr relayer. Biaya operator: 0 ETH.\n");

  const deployArgs = [
    "scripts/execute-single-base-deployment.ts",
    `--wallet=${wallet.id}`,
  ];
  if (skipSimulationProbe) {
    deployArgs.push("--skip-simulation-probe");
    logger.info("   ⚡ [PROBE] Bypass dry simulation probe aktif (--skip-simulation-probe).");
  }

  const deployOk = await runSubprocess("Deploy Token Base Mainnet", deployArgs);

  if (!deployOk) {
    logger.error("❌ [PIPELINE] Pipeline dihentikan: Deployment gagal atau exit non-zero.");
    logger.info("   Periksa log di atas untuk detail. Cek vault dengan: bun run status");
    return;
  }

  // ── Langkah 3: Verifikasi deployment di DB (tunggu DB commit) ─────────────
  logger.info("\n🔍 [LANGKAH 2/5] Memverifikasi deployment confirmed di database vault...");
  await new Promise((r) => setTimeout(r, 3000)); // tunggu 3 detik commit

  const newDeploy = findNewConfirmedDeployment(beforeDeployId);
  if (!newDeploy) {
    logger.warn(
      "⚠️  [PIPELINE] Tidak ditemukan deployment confirmed baru di vault.\n" +
      "   Kemungkinan: deployment masih 'unknown', pending reconciliation, atau simulasi.\n" +
      "   Cek: bun run scripts/execute-catalyst-trading.ts list"
    );
    return;
  }

  logger.success(
    `✅ [PIPELINE] Deployment confirmed di vault!\n` +
    `   Ticker  : $${newDeploy.ticker}\n` +
    `   Nama    : ${newDeploy.tokenName}\n` +
    `   CA      : ${newDeploy.contractAddr}`
  );

  // ── Langkah 2B: Konfigurasi Bot Telegram Khusus (Dedicated Bot per CA / Bot Pool) ─────
  logger.info(`\n📱 [LANGKAH 2B/5] Konfigurasi Bot Telegram Dedicated untuk $${newDeploy.ticker}...`);
  let botUsername: string | undefined;
  let customBotToken: string | undefined;

  try {
    const { generateTokenCharacterConfig } = await import("../src/modules/telegram/token-agent-bot.ts");
    const {
      updateDeploymentTelegramBot,
      syncBotPoolFromEnv,
      acquireBotFromPool,
      getBotPoolSummary,
    } = await import("../src/db/vault.ts");

    // 1. Sinkronkan token bot dari .env jika ada
    syncBotPoolFromEnv();

    // 2. Coba ambil 1 bot dari pre-provisioned pool secara atomik
    const poolBot = acquireBotFromPool(newDeploy.contractAddr);

    if (poolBot) {
      customBotToken = poolBot.botToken;
      botUsername = poolBot.botUsername || undefined;
      logger.success(`   ✨ [BOT-POOL] Bot token berhasil dialokasikan otomatis dari pool!`);

      // Verifikasi & update username via Telegram API getMe jika belum ada
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${customBotToken}/getMe`);
        const tgData = (await tgRes.json()) as any;
        if (tgData.ok && tgData.result?.username) {
          botUsername = tgData.result.username;
          logger.success(`   ✅ Terhubung ke Telegram: @${botUsername}`);
        }
      } catch (tgErr: any) {
        logger.warn(`   ⚠️  Koneksi verifikasi Telegram API: ${tgErr?.message || tgErr}`);
      }

      // Simpan bot token & username ke deploy_logs
      updateDeploymentTelegramBot(newDeploy.contractAddr, customBotToken, botUsername);
    } else if (unattended) {
      // 3A. Mode Unattended dan Pool Kosong: Zero-Prompt Fallback ke Master Fleet Bot
      const poolStats = getBotPoolSummary();
      logger.info(
        `   ℹ️  [BOT-POOL] Cadangan bot pool kosong (${poolStats.available} tersedia). ` +
        `Melewati prompt manual dan menggunakan fallback Master Fleet Bot.`
      );
      const cfg = (await import("../src/config.ts")).getConfig();
      if (cfg.TELEGRAM_BOT_USERNAME) {
        botUsername = cfg.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
        logger.info(`   🤖 Menggunakan Master Fleet Bot: @${botUsername}`);
      }
    } else {
      // 3B. Mode Interaktif (Manual): Tampilkan prompt dengan opsi lewati
      console.log(`   💡 Apakah Anda ingin memasang Bot Telegram khusus untuk $${newDeploy.ticker} sekarang?`);
      console.log(`      (Dapat dibuat di @BotFather, contoh: @${newDeploy.ticker.toLowerCase()}_agent_bot)`);
      const inputToken = await prompt("   Masukkan BOT TOKEN dari @BotFather (Enter untuk lewati & gunakan nanti): ");

      if (inputToken && inputToken.trim().length > 10) {
        customBotToken = inputToken.trim();
        try {
          const tgRes = await fetch(`https://api.telegram.org/bot${customBotToken}/getMe`);
          const tgData = (await tgRes.json()) as any;
          if (tgData.ok && tgData.result?.username) {
            botUsername = tgData.result.username;
            logger.success(`   ✅ Token Bot Valid! Terhubung ke Telegram: @${botUsername}`);
          } else {
            logger.warn(`   ⚠️  Telegram API merespons tapi token belum valid: ${tgData.description || "Unknown"}`);
          }
        } catch (tgErr: any) {
          logger.warn(`   ⚠️  Koneksi preflight ke Telegram API: ${tgErr?.message || tgErr}`);
        }

        updateDeploymentTelegramBot(newDeploy.contractAddr, customBotToken, botUsername);
      }
    }

    const char = generateTokenCharacterConfig(
      {
        address: newDeploy.contractAddr,
        ticker: newDeploy.ticker,
        name: newDeploy.tokenName,
      },
      { botToken: customBotToken, botUsername }
    );
    logger.success(`✅ [PIPELINE] Character profile dibuat di: ${char.characterPath}`);
    logger.info(`   Jalankan bot live kapan saja dengan: START_TELEGRAM_BOT.bat`);
  } catch (err: any) {
    logger.warn(`⚠️  [PIPELINE] Warning pembuatan karakter Telegram: ${err?.message || err}`);
  }

  // ── Langkah 2C: Auto-Enrich & Sync Proyek Bankr (Tim & Produk) ────────────
  logger.info(`\n🤖 [LANGKAH 2C/5] Menyinkronkan profil proyek Bankr lengkap (Tim & Produk)...`);
  try {
    const { enrichAndSyncBankrProject } = await import("../src/modules/growth/project-enricher.ts");
    const opCtx = resolveOperationalContext(wallet.id, "bankr");
    const walletApiKey = opCtx.credentialRef ? resolveCredential(opCtx.credentialRef) : undefined;

    const proj = await enrichAndSyncBankrProject(
      {
        name: newDeploy.tokenName,
        ticker: newDeploy.ticker,
        contractAddress: newDeploy.contractAddr,
        telegramUrl: botUsername ? `https://t.me/${botUsername}` : undefined,
      },
      {
        apiKey: walletApiKey,
        proxyUrl: opCtx.proxyUrl ?? undefined,
      }
    );
    logger.success(
      `✅ [PIPELINE] Proyek Bankr terverifikasi (${proj.profile.products?.length ?? 0} produk, ${proj.profile.teamMembers?.length ?? 0} tim): https://bankr.bot/agents/${proj.profile.slug}`
    );
  } catch (err: any) {
    logger.warn(`⚠️  [PIPELINE] Warning sinkronisasi proyek Bankr: ${err?.message || err}`);
  }

  // ── Langkah 2D: Broadcast Launch Announcement ke Komunitas ───────────────
  try {
    const { broadcastTokenLaunchAnnouncement } = await import("../src/modules/social/beacon-broadcaster.ts");
    await broadcastTokenLaunchAnnouncement({
      ticker: newDeploy.ticker,
      name: newDeploy.tokenName,
      contractAddress: newDeploy.contractAddr,
      chain: newDeploy.chain || "base",
      poolId: newDeploy.poolId || undefined,
      botUsername,
      botToken: customBotToken,
    });
  } catch (bcErr: any) {
    logger.warn(`⚠️  [PIPELINE] Launch broadcast notice: ${bcErr?.message || bcErr}`);
  }

  // ── Langkah 2E: Auto-Generate Materi Investor Offer Deck & Link Referral ─
  logger.info(`\n📄 [LANGKAH 2E/5] Membuat materi Investor Offer Deck & Link Referral untuk $${newDeploy.ticker}...`);
  try {
    const {
      generateDiscoveryPackage,
      saveDiscoveryPackageJson,
      generateIrresistibleOffer,
      saveOfferDeckMarkdown,
    } = await import("../src/modules/growth/token-offer-generator.ts");
    const { recordPromotionDecision } = await import("../src/db/vault.ts");

    const pkg = generateDiscoveryPackage({
      ticker: newDeploy.ticker,
      name: newDeploy.tokenName,
      contractAddress: newDeploy.contractAddr,
      chain: "base",
      telegram: botUsername ? `https://t.me/${botUsername}` : undefined,
    });
    saveDiscoveryPackageJson(pkg);

    const offer = generateIrresistibleOffer({
      ticker: newDeploy.ticker,
      name: newDeploy.tokenName,
      contractAddress: newDeploy.contractAddr,
      chain: "base",
      telegram: botUsername ? `https://t.me/${botUsername}` : undefined,
    });
    const saveMdRes = saveOfferDeckMarkdown(offer);
    const deckPath = saveMdRes.primaryPath;

    recordPromotionDecision({
      contractAddress: newDeploy.contractAddr,
      ticker: newDeploy.ticker,
      decision: "APPROVED",
      reason: "Automated full pipeline discovery deck generation",
      evaluatedMetricsJson: JSON.stringify({ autoGenerated: true }),
      offerMarkdownPath: deckPath,
    });
    logger.success(`   ✅ Investor Offer Deck dibuat: ${deckPath ?? "promotions/"}`);
  } catch (err: any) {
    logger.warn(`⚠️  [PIPELINE] Warning pembuatan Investor Offer Deck: ${err?.message || err}`);
  }

  try {
    const { generateReferralLink } = await import("../src/modules/growth/flywheel-engine.ts");
    const affiliateAddr = wallet.evmAddress || "0x0000000000000000000000000000000000000000";
    const refUrl = generateReferralLink(newDeploy.contractAddr, affiliateAddr);
    logger.success(`   ✅ Referral Link (5% WETH Bagi Hasil): ${refUrl}`);
  } catch (err: any) {
    logger.warn(`⚠️  [PIPELINE] Warning pembuatan Referral Link: ${err?.message || err}`);
  }

  // ── Langkah 2F: Auto-Generate Web3 Website & Deploy to Cloudflare Pages ─
  let liveWeb3Url: string | undefined;
  try {
    logger.info(`\n🌐 [LANGKAH 2F/5] Membangun Website 3D Parallax & Deploy Cloudflare Pages untuk $${newDeploy.ticker}...`);
    const { generateTokenWebsite } = await import("../src/modules/growth/website-generator.ts");
    const { deployWebsiteToCloudflarePages } = await import("../src/modules/growth/website-deployer.ts");
    const { updateDeployLogWebsite } = await import("../src/db/vault.ts");

    const siteRes = await generateTokenWebsite({
      name: newDeploy.tokenName,
      ticker: newDeploy.ticker,
      contractAddress: newDeploy.contractAddr,
      chainId: newDeploy.chain === "robinhood" ? 4663 : newDeploy.chain === "solana" ? 101 : 8453,
      chainName: newDeploy.chain,
      description: `${newDeploy.tokenName} ($${newDeploy.ticker}) on ${newDeploy.chain === "robinhood" ? "Robinhood Chain L2" : newDeploy.chain === "solana" ? "Solana" : "Base Mainnet"} with 0% Tax and Autonomous Buybacks.`,
      poolId: newDeploy.poolId || undefined,
    });
    logger.success(`   ✅ [WEB3 ENGINE] Website dibuat di: ${siteRes.siteDirectory}`);

    const cfRes = await deployWebsiteToCloudflarePages({
      siteDir: siteRes.siteDirectory,
      ticker: newDeploy.ticker,
      contractAddress: newDeploy.contractAddr,
    });
    liveWeb3Url = cfRes.deploymentUrl;
    updateDeployLogWebsite(newDeploy.contractAddr, liveWeb3Url);
    logger.success(`   🚀 [CLOUDFLARE PAGES] Live Web3 DApp: ${liveWeb3Url}`);

    // Broadcast Web3 DApp release announcement to Telegram community with WebApp button
    try {
      const { broadcastTokenLaunchAnnouncement } = await import("../src/modules/social/beacon-broadcaster.ts");
      await broadcastTokenLaunchAnnouncement({
        ticker: newDeploy.ticker,
        name: newDeploy.tokenName,
        contractAddress: newDeploy.contractAddr,
        chain: newDeploy.chain || "base",
        poolId: newDeploy.poolId || undefined,
        websiteUrl: liveWeb3Url,
        botUsername,
        botToken: customBotToken,
      });
      logger.success(`   📡 [BROADCASTER] Pengumuman resmi Web3 DApp disiarkan ke komunitas dengan WebApp button!`);
    } catch (bcastErr: any) {
      logger.warn(`   ⚠️  [BROADCASTER] Notice siaran Web3 DApp: ${bcastErr?.message || bcastErr}`);
    }

    // Sinkronisasi aset media ke Cloudflare R2
    try {
      const { syncSiteAssetsToR2 } = await import("../src/modules/storage/r2-storage-client.ts");
      const r2Res = await syncSiteAssetsToR2(siteRes.siteDirectory, newDeploy.ticker);
      if (r2Res.success) {
        logger.success(`   📦 [CLOUDFLARE R2] ${r2Res.uploadedCount} aset tersinkronkan ke bucket '${r2Res.bucketName}'`);
      }
    } catch (r2Err: any) {
      logger.warn(`   ⚠️  [CLOUDFLARE R2] Catatan R2 sync: ${r2Err?.message || r2Err}`);
    }
  } catch (siteErr: any) {
    logger.warn(`⚠️  [PIPELINE] Warning Web3 Website / Cloudflare Pages: ${siteErr?.message || siteErr}`);
  }

  // ── Langkah 2G: Sinkronisasi Cloud Neon PostgreSQL (Multi-Database Per-Token) ──
  try {
    logger.info(`\n🐘 [LANGKAH 2G/5] Mengalokasikan Database Cloud Terisolasi di Neon PostgreSQL...`);
    const { syncTokenDeploymentToNeon, isNeonConfigured } = await import("../src/db/neon-vault.ts");
    if (isNeonConfigured()) {
      const neonRes = await syncTokenDeploymentToNeon({
        contractAddr: newDeploy.contractAddr,
        ticker: newDeploy.ticker,
        tokenName: newDeploy.tokenName,
        chain: "base",
        poolId: newDeploy.poolId,
        txHash: newDeploy.txHash,
        websiteUrl: liveWeb3Url,
        telegramBotUsername: botUsername,
      });
      if (neonRes.success) {
        logger.success(`   ✅ [NEON CLOUD] Database '${neonRes.dbName}' siap & tersinkronisasi (${neonRes.isNewDatabase ? "Baru dibuat" : "Telah diperbarui"})!`);
      } else {
        logger.warn(`   ⚠️  [NEON CLOUD] Notice sinkronisasi: ${neonRes.error}`);
      }
    } else {
      logger.info(`   ℹ️  [NEON CLOUD] NEON_DATABASE_URL belum disetel (lewati sinkronisasi cloud).`);
    }
  } catch (neonErr: any) {
    logger.warn(`⚠️  [PIPELINE] Warning Neon Cloud Database: ${neonErr?.message || neonErr}`);
  }

  // ── Langkah 2H: Preflight Audit DexScreener & Fast-Track Poller ──────
  try {
    logger.info(`\n🔍 [LANGKAH 2H/5] Memeriksa status DexScreener Fast-Track & Kesiapan Sniper Bot...`);
    const { pollTokenFastTrackStatus } = await import("../src/modules/intelligence/dexscreener-fasttrack-poller.ts");
    const ftRes = await pollTokenFastTrackStatus(newDeploy.contractAddr, "base");
    logger.info(`   📊 Safety Score: ${ftRes.safetyScore}/100 (${ftRes.safetyVerdict}) | Sniper Bot Ready: ${ftRes.sniperBotReady ? "YES" : "NO"}`);
  } catch (ftErr: any) {
    logger.warn(`   ⚠️  [FAST-TRACK] Notice fast-track poller: ${ftErr?.message || ftErr}`);
  }

  // ── FASE 4/5: Aktivasi Pasar DexScreener, Unique Makers & Volume Spark ────
  logger.info(`\n💰 [FASE 4/5] Mengaktifkan pasar DexScreener & memicu Volume Spark untuk $${newDeploy.ticker}...`);
  logger.info("   Fungsi: aktifkan grafik DexScreener, cetak lilin hijau berturut-turut, dan daftarkan 3+ Unique Makers untuk memancing bot sniper eksternal.");

  let sparkCompleted = false;
  try {
    const { runTrendingBoostCycle } = await import("../src/modules/growth/trending-booster.ts");
    const { getEvmPublicClient, deriveEvmAddress } = await import("../src/modules/reconciliation/evm-verifier.ts");
    const { getConfig } = await import("../src/config.ts");
    const { formatEther } = await import("viem");
    const cfg = getConfig();
    const opAddr = deriveEvmAddress(cfg.EVM_PRIVATE_KEY);
    const client = getEvmPublicClient("base");

    if (opAddr && client) {
      const balRaw = await client.getBalance({ address: opAddr as `0x${string}` });
      const opEth = parseFloat(formatEther(balRaw));
      const OPERATOR_GAS_FLOOR_ETH = 0.0003;
      const sparkRounds = 3;
      const sparkAmountEth = 0.00005; // ~$0.12 USD
      const costEstimate = sparkRounds * (sparkAmountEth + 0.00002);

      if (opEth >= OPERATOR_GAS_FLOOR_ETH + costEstimate) {
        logger.info(`   🔥 [VOLUME SPARK] Menjalankan ${sparkRounds} transaksi micro-maker (${sparkAmountEth} ETH) across unique makers...`);
        const sparkRes = await runTrendingBoostCycle({
          tokenAddress: newDeploy.contractAddr,
          tokenSymbol: newDeploy.ticker,
          rounds: sparkRounds,
          microAmountEth: sparkAmountEth,
          isSimulated: false,
        });
        sparkCompleted = sparkRes.totalRoundsExecuted > 0;
        logger.success(`   ✅ [VOLUME SPARK] Berhasil mencetak ${sparkRes.totalRoundsExecuted} transaksi lilin hijau di DexScreener!`);
      } else {
        logger.warn(`   ⚠️  [VOLUME SPARK] Saldo operator (${opEth.toFixed(6)} ETH) mendekati floor aman (${OPERATOR_GAS_FLOOR_ETH} ETH). Menggunakan single buy fallback.`);
      }
    }
  } catch (sparkErr: any) {
    logger.warn(`   ⚠️  [VOLUME SPARK] Notice volume spark: ${sparkErr?.message || sparkErr}`);
  }

  if (!sparkCompleted) {
    await executeAutoBuy(newDeploy.contractAddr);
  }

  logger.info(`\n👁️  [MONITOR] Memulai monitor live harga $${newDeploy.ticker}...`);
  logger.info("   Bot akan otomatis take-profit saat harga mencapai 1.5x (+50%).");
  if (!unattended) {
    logger.info("   Tekan Ctrl+C kapan saja untuk keluar dari monitor.\n");
  }
  await runLiveMonitor(newDeploy.contractAddr, unattended ? 3 : undefined);

  // ── FASE 5/5: Mesin Revenue Flywheel 24/7 & Monitoring ────────────────────
  logger.info(`\n🌾 [LANGKAH 5/5] [FASE 5/5] Peluncuran & aktivasi awal $${newDeploy.ticker} selesai sukses!`);
  if (unattended) {
    logger.info("   🔄 [AUTO-PILOT] Menjalankan audit awal creator fee WETH di Flywheel Engine...");
    await runSubprocess("Flywheel Harvester Audit", ["scripts/run-flywheel-worker.ts"]);
    logger.info("\n📊 [AUTO-PILOT] Menampilkan ringkasan status armada token...");
    await runSubprocess("Matriks Armada Token", ["scripts/view-fleet-matrix.ts"]);
    logger.success(`\n🎉 [AUTO-PILOT] Seluruh 5 Fase Siklus Hidup Token $${newDeploy.ticker} selesai dijalankan dengan sukses!`);
  } else {
    console.log(`\n===============================================================================`);
    console.log(`  [+] ESTAFET MESIN REVENUE PASIF FLYWHEEL 24/7 [+]`);
    console.log(`===============================================================================`);
    console.log(`Token $${newDeploy.ticker} kini aktif di pasar.`);
    console.log(`Pilih aksi lanjutan untuk mengelola fee dan armada:`);
    console.log(`  [1] Nyalakan Flywheel Harvester Daemon 24/7 (Interval 5 menit)`);
    console.log(`  [2] Jalankan pemeriksaan fee sekali saja (Single-Pass Audit)`);
    console.log(`  [3] Tampilkan Matriks Armada & Rekonsiliasi On-Chain`);
    console.log(`  [4] Selesai & Keluar`);
    const flyChoice = await prompt("Pilihan [1-4, default=4]: ");
    if (flyChoice === "1") {
      logger.info("🚀 Menjalankan Flywheel Harvester Daemon 24/7...");
      await runSubprocess("Flywheel Harvester Daemon", ["scripts/run-flywheel-worker.ts", "--daemon", "5"]);
    } else if (flyChoice === "2") {
      logger.info("🔍 Menjalankan pemeriksaan audit fee...");
      await runSubprocess("Flywheel Harvester Audit", ["scripts/run-flywheel-worker.ts"]);
    } else if (flyChoice === "3") {
      await runSubprocess("Matriks Armada Token", ["scripts/view-fleet-matrix.ts"]);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 2: BELI + MONITOR — Langsung untuk token yang sudah deploy
// ─────────────────────────────────────────────────────────────────────────────
async function runCatalystOnly(): Promise<void> {
  console.log(BANNER);
  logger.info(
    "💰 [MODE BELI + MONITOR] Deployment sudah ada — langsung beli & monitor token live.\n"
  );

  listLiveTokens();

  const input = await prompt(
    "\n  Masukkan nomor token atau alamat CA (Enter = token terbaru): "
  );
  const tokenInfo = resolveTargetToken(input || undefined);

  logger.info(`\n   Target   : $${tokenInfo.ticker} (${tokenInfo.name})`);
  logger.info(`   CA       : ${tokenInfo.address}\n`);

  console.log("  Pilih strategi pemicu pasar:");
  console.log("    [1] Volume Spark 3x Micro-Buys (Rekomendasi: Cetak 3 Candle Hijau & 3 Unique Makers untuk pancing Bot Luar)");
  console.log("    [2] Single Katalyst Buy ~$1.00 (Pembelian tunggal dari dompet operator)");
  console.log("    [3] Langsung ke Monitor Saja (Tanpa order beli baru, langsung pantau + auto take-profit)");
  const strategyChoice = await prompt("  Pilihan [1-3, default=1]: ");

  if (strategyChoice === "2") {
    logger.info("💰 Menjalankan auto-buy katalyst ~$1.00...");
    await executeAutoBuy(tokenInfo.address);
  } else if (strategyChoice === "3") {
    logger.info("👁️  Melewati order beli baru, langsung menuju monitor...");
  } else {
    // Default: Volume Spark 3x
    logger.info("🔥 [VOLUME SPARK] Menjalankan 3 transaksi micro-maker unik di DexScreener...");
    let sparkCompleted = false;
    try {
      const { runTrendingBoostCycle } = await import("../src/modules/growth/trending-booster.ts");
      const sparkRes = await runTrendingBoostCycle({
        tokenAddress: tokenInfo.address,
        tokenSymbol: tokenInfo.ticker,
        rounds: 3,
        microAmountEth: 0.00005,
        isSimulated: false,
      });
      sparkCompleted = sparkRes.totalRoundsExecuted > 0;
      if (sparkCompleted) {
        logger.success(`   ✅ [VOLUME SPARK] Berhasil mencetak ${sparkRes.totalRoundsExecuted} transaksi lilin hijau!`);
      }
    } catch (sErr: any) {
      logger.warn(`   ⚠️  [VOLUME SPARK] Notice: ${sErr?.message || sErr}`);
    }

    if (!sparkCompleted) {
      logger.info("💰 Menjalankan auto-buy katalyst fallback ~$1.00...");
      await executeAutoBuy(tokenInfo.address);
    }
  }

  logger.info("\n👁️  Memulai monitor live + auto take-profit...");
  await runLiveMonitor(tokenInfo.address);
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE 3: MONITOR SAJA — untuk token yang sudah dibeli
// ─────────────────────────────────────────────────────────────────────────────
async function runMonitorOnly(): Promise<void> {
  console.log(BANNER);
  logger.info("👁️  [MODE MONITOR] Langsung memantau posisi yang sudah terbuka.\n");

  listLiveTokens();

  const input = await prompt(
    "\n  Masukkan nomor token atau alamat CA (Enter = token terbaru): "
  );
  const tokenInfo = resolveTargetToken(input || undefined);

  logger.info(`\n   Target   : $${tokenInfo.ticker} (${tokenInfo.name})`);
  logger.info(`   CA       : ${tokenInfo.address}\n`);
  logger.info("   Bot akan otomatis take-profit saat harga mencapai target.\n");

  await runLiveMonitor(tokenInfo.address);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Dispatcher
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isHelp = args.includes("--help") || args.includes("-h") || args.includes("help");
const isUnattended =
  args.includes("--unattended") ||
  args.includes("--yes") ||
  args.includes("-y") ||
  args.includes("--auto");
const mode = isHelp
  ? "help"
  : (args.find((a) => !a.startsWith("-")) ?? "full").toLowerCase();
const walletArg =
  args.find((a) => a.startsWith("--wallet="))?.split("=")[1] ||
  (args.includes("-w") ? args[args.indexOf("-w") + 1] : undefined);
const skipSimulationProbe =
  args.includes("--skip-simulation-probe") ||
  args.includes("--skip-probe") ||
  args.includes("--force") ||
  args.includes("-f");

switch (mode) {
  case "full":
    runFullPipeline(walletArg, isUnattended, skipSimulationProbe).catch((err) => {
      logger.error(`[PIPELINE-FULL] Fatal: ${err?.message ?? err}`);
      process.exit(1);
    });
    break;

  case "catalyst":
    runCatalystOnly().catch((err) => {
      logger.error(`[PIPELINE-CATALYST] Fatal: ${err?.message ?? err}`);
      process.exit(1);
    });
    break;

  case "monitor":
    runMonitorOnly().catch((err) => {
      logger.error(`[PIPELINE-MONITOR] Fatal: ${err?.message ?? err}`);
      process.exit(1);
    });
    break;

  default:
    console.log(`
===============================================================================
  PIPELINE OTOMATIS TERPADU — Penggunaan
===============================================================================

  bun run scripts/launch-full-pipeline.ts [mode] [--wallet=<walletId>] [--unattended] [--skip-simulation-probe]

  Mode:
    full     [default] : Deploy Token → Auto-Sync Bankr → Karakter Bot → Beli ~$1 → Monitor
    catalyst           : Langsung Beli + Monitor (skip deploy)
    monitor            : Monitor posisi saja (skip deploy + beli)

  Opsi Otonom & Multi-Akun:
    --unattended, -y        : Mode 100% Otonom tanpa prompt manual (auto bot pool & auto-select wallet)
    --wallet=<id>           : Tentukan wallet/akun Bankr tertentu (contoh: --wallet=bankr-acc-2)
    --skip-simulation-probe : Bypass dry simulation probe saat WAF/kuota simulasi 403/429

===============================================================================
`);
}
