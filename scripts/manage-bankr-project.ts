/**
 * scripts/manage-bankr-project.ts
 *
 * Bankr Agent Profile & Project Integration Manager (CLI).
 *
 * Re-exports core project management functions from src/modules/evm/bankr-project.ts
 * and provides interactive operator CLI commands:
 *  - list     : Menampilkan daftar proyek terdaftar & detail tim/produk
 *  - sync-all : Sinkronkan seluruh armada token Base ke Proyek Bankr lengkap
 */

import { logger } from "../src/logger.ts";
import { getProductionFleet } from "../src/modules/fleet/fleet-registry.ts";
import {
  getBankrProfiles,
  createBankrProfile,
  updateBankrProfile,
  linkTokenToBankrProject,
  resolveContext,
  type BankrProfile,
  type CreateProfilePayload,
  type RequestOptions,
  type LinkProjectOptions,
} from "../src/modules/evm/bankr-project.ts";

export {
  getBankrProfiles,
  createBankrProfile,
  updateBankrProfile,
  linkTokenToBankrProject,
  resolveContext,
  type BankrProfile,
  type CreateProfilePayload,
  type RequestOptions,
  type LinkProjectOptions,
};

// ─── CLI Entrypoint ──────────────────────────────────────────────────────────

async function runCli() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase() || "list";

  console.log(`
=================================================================
  [+] BANKR AGENT PROFILE & PROJECT INTEGRATION MANAGER [+]
=================================================================
`);

  if (command === "list" || command === "status") {
    logger.info("Memeriksa profil proyek terdaftar di Bankr API...");
    try {
      const profiles = await getBankrProfiles();
      if (profiles.length === 0) {
        console.log("\n⚠️  Belum ada proyek/profil yang terdaftar pada akun Bankr Anda.");
        console.log("   Gunakan: bun run scripts/manage-bankr-project.ts sync-all");
        console.log("   Atau kunjungi antarmuka web: https://bankr.bot/terminal/projects\n");
        return;
      }

      console.log(`\nDitemukan ${profiles.length} proyek terdaftar:\n`);
      for (const p of profiles) {
        const approvalText = p.approved
          ? "✅ APPROVED (Public Listing)"
          : p.isPublished
          ? "🚀 PUBLISHED / IN REVIEW (Siap tampil di Bankr Directory)"
          : "⏳ DRAFT / UNPUBLISHED";

        console.log(`-----------------------------------------------------------------`);
        console.log(`  Project Name    : ${p.projectName}`);
        console.log(`  Slug            : ${p.slug}`);
        console.log(`  Status          : ${approvalText}`);
        console.log(`  Token Linked    : ${p.tokenSymbol ? `$${p.tokenSymbol} (${p.tokenAddress})` : p.tokenAddress || "None"}`);
        console.log(`  Chain           : ${p.tokenChainId || "base"}`);
        console.log(`  Products Count  : ${p.products?.length ?? p.productsCount ?? 0} produk`);
        console.log(`  Team Members    : ${p.teamMembers?.length ?? 0} anggota tim`);
        const cleanTicker = (p.tokenSymbol || "TOKEN").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
        const publicTokenX = `@${cleanTicker}_coin`;
        console.log(`  Token X (Public): ${publicTokenX}`);
        console.log(`  Website         : ${p.website || "Not set"}`);
        console.log(`  Public URL      : https://bankr.bot/agents/${p.slug}`);
        if (p.teamMembers && p.teamMembers.length > 0) {
          console.log(`  Tim Inti:`);
          p.teamMembers.forEach((m, idx) => console.log(`     ${idx + 1}. ${m.name} — ${m.role}`));
        }
        if (p.products && p.products.length > 0) {
          console.log(`  Produk:`);
          p.products.forEach((pr, idx) => console.log(`     ${idx + 1}. ${pr.name}`));
        }
      }
      console.log(`-----------------------------------------------------------------\n`);
    } catch (err: any) {
      logger.error(`Gagal memuat profil Bankr: ${err.message || err}`);
    }
  } else if (command === "sync-all" || command === "link-pumprun" || command === "enrich") {
    logger.info("Menyiapkan sinkronisasi seluruh armada token Base ke Proyek Bankr...");

    const { enrichAndSyncBankrProject } = await import("../src/modules/growth/project-enricher.ts");
    const { getLiveDeployments } = await import("../src/modules/fleet/fleet-registry.ts");
    const liveTokens = getLiveDeployments("base");
    const targets: Array<{ tokenName: string; ticker: string; contractAddr: string; poolId?: string }> = liveTokens
      .filter((d) => d.contractAddr && d.contractAddr.startsWith("0x"))
      .map((d) => ({
        tokenName: d.tokenName,
        ticker: d.ticker,
        contractAddr: d.contractAddr!,
        poolId: d.poolId || undefined,
      }));

    if (targets.length === 0) {
      logger.warn("Belum ada token live di fleet. Menggunakan default $PUMPRUN...");
      targets.push({
        tokenName: "Pump Hill Runner",
        ticker: "PUMPRUN",
        contractAddr: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        poolId: "0x12c514c5ccdcc8ab74f8756bf3c104f716ec87bed0c7325b181d991774a9d0a9",
      });
    }

    for (const token of targets) {
      logger.info(`\n🚀 Memproses sinkronisasi $${token.ticker} (${token.tokenName})...`);
      try {
        const { getDeployLogWebsite } = await import("../src/db/vault.ts");
        const resolvedWebsite = getDeployLogWebsite(token.contractAddr) || `https://${token.ticker.toLowerCase()}-web3.pages.dev`;
        const res = await enrichAndSyncBankrProject({
          name: token.tokenName,
          ticker: token.ticker,
          contractAddress: token.contractAddr,
          poolId: token.poolId,
          website: resolvedWebsite,
          description: `Autonomous Liquidity & AI Flywheel Agent on Base L2. Features self-sustaining 95% WETH fee buyback-and-burn mechanics, unruggable Uniswap V4 pool, and 3D Parallax DApp.`,
        });

        logger.success(`✅ Sukses ${res.action} proyek untuk $${token.ticker}!`);
        console.log(`   Project Name : ${res.profile.projectName}`);
        console.log(`   Slug         : ${res.profile.slug}`);
        console.log(`   Token Linked : ${res.profile.tokenAddress}`);
        console.log(`   Public URL   : https://bankr.bot/agents/${res.profile.slug}`);
        console.log(`   Products     : ${res.profile.products?.length ?? 0}`);
        console.log(`   Team Members : ${res.profile.teamMembers?.length ?? 0}`);
      } catch (err: any) {
        logger.error(`❌ Gagal sinkronisasi $${token.ticker}: ${err.response?.data?.message || err.message || err}`);
      }
    }
    console.log(`\n=================================================================\n`);
  } else {
    console.log(`
Perintah yang tersedia:
  bun run scripts/manage-bankr-project.ts list       -> Menampilkan daftar proyek terdaftar & detail tim/produk
  bun run scripts/manage-bankr-project.ts sync-all   -> Sinkronkan armada token Base ke Proyek Bankr lengkap
`);
  }
}

if (import.meta.main) {
  runCli();
}
