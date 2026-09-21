#!/usr/bin/env bun
/**
 * scripts/clean-cloudflare-pages.ts
 *
 * CLI Runner for auditing and cleaning Cloudflare Pages projects.
 * Prevents account from exceeding the 100-project limit.
 *
 * Usage:
 *   bun run scripts/clean-cloudflare-pages.ts           # Interactive audit & clean
 *   bun run scripts/clean-cloudflare-pages.ts --dry-run # Audit only (no deletions)
 *   bun run scripts/clean-cloudflare-pages.ts --force   # Prune without prompt if >= threshold
 */

import * as dotenv from "dotenv";
dotenv.config();

import {
  auditAndCleanCloudflareProjects,
  listCloudflarePagesProjects,
  getProtectedProjectNames,
} from "../src/modules/growth/cloudflare-cleaner.ts";
import { logger } from "../src/logger.ts";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isForce = args.includes("--force");

async function main() {
  console.log(`
===============================================================================
  CLOUDFLARE PAGES PROJECT LIFECYCLE & LRU GARBAGE COLLECTOR
===============================================================================
  Tujuan: Menjaga jumlah project di akun Cloudflare selalu aman di bawah batas 100.
  Proteksi: Token live di blockchain diproteksi secara permanen (DILARANG DIHAPUS).
===============================================================================
`);

  const protectedSet = getProtectedProjectNames();
  logger.info(`🔒 [PROTECTION] ${protectedSet.size} project token live diproteksi secara permanen.`);

  const result = await auditAndCleanCloudflareProjects({
    threshold: 85,
    targetSafeCount: 75,
    dryRun: isDryRun,
  });

  console.log(`
-------------------------------------------------------------------------------
  RINGKASAN AUDIT CLOUDFLARE PAGES:
-------------------------------------------------------------------------------
  Total Project Aktif : ${result.totalProjects} / 100
  Ambang Batas Bahaya : ${result.threshold} / 100
  Project Terproteksi : ${result.protectedCount} (Token Live On-Chain)
  Project Evictable   : ${result.prunableCount} (Simulasi / Uji Coba Lama)
  Project Di-Prune    : ${result.prunedProjects.length}
  Status Akun         : ${result.isOverThreshold ? "⚠️ BUTUH PEMBERSIHAN" : "✅ AMAN & NORMAL"}
  Mode Operasi        : ${result.mode.toUpperCase()} ${isDryRun ? "(DRY-RUN)" : ""}
-------------------------------------------------------------------------------
`);

  if (result.prunedProjects.length > 0) {
    console.log("  Daftar project yang dibersihkan:");
    result.prunedProjects.forEach((p, idx) => console.log(`   [${idx + 1}] ${p}`));
    console.log();
  }
}

main().catch((err) => {
  logger.error(`❌ [ERROR] ${err.message}`);
  process.exit(1);
});
