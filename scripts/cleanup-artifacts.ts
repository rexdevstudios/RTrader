#!/usr/bin/env bun
/**
 * scripts/cleanup-artifacts.ts
 *
 * Safe Workspace Housekeeping Utility.
 * Removes temporary test artifacts and unit test fixtures while strictly preserving
 * all live production fleet tokens, SQLite database vault (.eliza/vault.db), and .env.
 *
 * Usage:
 *   bun run scripts/cleanup-artifacts.ts
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../src/logger.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";

// Pattern of test-generated dummy tickers to purge
const TEST_TICKER_PATTERNS = [
  /TELEGRAM_ANNOUNCEMENT_(DPUMP|NODE|PYIELD|READINESS|TCLANK|TEST|TESTPACK|TGSAVE)\.txt$/i,
  /LAUNCH_ANNOUNCEMENT_(DPUMP|NODE|PYIELD|READINESS|TCLANK|TEST|TESTPACK|TGSAVE)\.txt$/i,
];

export function cleanupTemporaryArtifacts(options?: { dryRun?: boolean }): {
  removedFiles: string[];
  removedDirs: string[];
  preservedFiles: string[];
} {
  const isDryRun = options?.dryRun ?? false;
  const result = {
    removedFiles: [] as string[],
    removedDirs: [] as string[],
    preservedFiles: [] as string[],
  };

  // 1. Scan and clean promotions/ directory
  const promoDir = path.resolve(process.cwd(), "promotions");
  if (fs.existsSync(promoDir)) {
    const files = fs.readdirSync(promoDir);
    for (const file of files) {
      const isTestFile = TEST_TICKER_PATTERNS.some((pattern) => pattern.test(file));
      const fullPath = path.join(promoDir, file);
      if (isTestFile) {
        if (!isDryRun) {
          try {
            fs.unlinkSync(fullPath);
          } catch {}
        }
        result.removedFiles.push(file);
      } else {
        result.preservedFiles.push(file);
      }
    }
  }

  // 2. Scan and clean any leftover sites/test_* directories
  const sitesDir = path.resolve(process.cwd(), "sites");
  if (fs.existsSync(sitesDir)) {
    const dirs = fs.readdirSync(sitesDir);
    for (const dir of dirs) {
      if (dir.startsWith("test_")) {
        const fullDirPath = path.join(sitesDir, dir);
        if (!isDryRun) {
          try {
            fs.rmSync(fullDirPath, { recursive: true, force: true });
          } catch {}
        }
        result.removedDirs.push(dir);
      }
    }
  }

  return result;
}

async function main() {
  console.log(`
=================================================================
  [+] SAFE WORKSPACE HOUSEKEEPING & ARTIFACT CLEANUP [+]
=================================================================
`);

  console.log(`${CYAN}🧹 Memindai berkas temporer pengujian di folder promotions/ dan sites/...${RESET}\n`);
  const { removedFiles, removedDirs, preservedFiles } = cleanupTemporaryArtifacts();

  if (removedFiles.length > 0 || removedDirs.length > 0) {
    console.log(`${BOLD}${YELLOW}🗑️  BERKAS UJI TEMPORER YANG DIBERSIHKAN:${RESET}`);
    removedFiles.forEach((f) => console.log(`   - promotions/${f}`));
    removedDirs.forEach((d) => console.log(`   - sites/${d}`));
    console.log("");
  } else {
    console.log(`${GREEN}✨ Tidak ada berkas sampah pengujian yang perlu dibersihkan. Workspace sudah bersih!${RESET}\n`);
  }

  console.log(`${BOLD}${GREEN}🛡️  BERKAS PRODUKSI & ARMADA UTAMA YANG AMAN TERJAGA:${RESET}`);
  preservedFiles.forEach((f) => console.log(`   ${GRAY}✓ promotions/${f}${RESET}`));

  console.log(`\n${GREEN}=================================================================${RESET}`);
  console.log(`${BOLD}${GREEN}✅ Housekeeping selesai! Direktori kerja bersih dan siap pakai.${RESET}`);
  console.log(`${GREEN}=================================================================${RESET}\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Cleanup error: ${err?.message || err}`);
    process.exit(1);
  });
}
