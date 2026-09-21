#!/usr/bin/env bun
/**
 * scripts/sync-r2-assets.ts
 *
 * Dedicated CLI Runner to Synchronize Web3 Site Media, OpenGraph Cards,
 * and Deployment Metadata to Cloudflare R2 Object Storage.
 *
 * Usage:
 *   bun run scripts/sync-r2-assets.ts [ticker]
 *   bun run scripts/sync-r2-assets.ts --all
 *   bun run storage:sync
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { logger } from "../src/logger.ts";
import { syncSiteAssetsToR2 } from "../src/modules/storage/r2-storage-client.ts";
import { getAllDeployLogs } from "../src/db/vault.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

function askQuestion(promptText: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes("--all") || args.includes("--fleet");
  const tokenArg = args.find((a) => !a.startsWith("--"));

  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   [+] CLOUDFLARE R2 OBJECT STORAGE MEDIA & ASSET SYNCHRONIZER [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  const sitesBaseDir = path.resolve(process.cwd(), "sites");

  if (!fs.existsSync(sitesBaseDir)) {
    logger.warn(`Direktori sites belum ada di: ${sitesBaseDir}`);
    process.exit(0);
  }

  if (isAll) {
    const siteFolders = fs.readdirSync(sitesBaseDir).filter((f) => {
      return fs.statSync(path.join(sitesBaseDir, f)).isDirectory();
    });

    console.log(`Menemukan ${siteFolders.length} folder situs untuk disinkronkan ke Cloudflare R2...`);

    for (const folder of siteFolders) {
      const siteDir = path.join(sitesBaseDir, folder);
      console.log(`\n${CYAN}📦 Mengunggah aset untuk $${folder.toUpperCase()}...${RESET}`);
      const res = await syncSiteAssetsToR2(siteDir, folder);
      if (res.success) {
        console.log(`${GREEN}✅ Berhasil: ${res.uploadedCount} file tersinkronkan ke R2 bucket '${res.bucketName}'${RESET}`);
      } else {
        console.log(`${YELLOW}⚠️  Gagal: ${res.message}${RESET}`);
      }
    }

    console.log(`\n${BOLD}${GREEN}🎉 Sinkronisasi seluruh armada situs ke Cloudflare R2 selesai!${RESET}\n`);
    return;
  }

  let selectedTicker = tokenArg;

  if (!selectedTicker) {
    const siteFolders = fs.readdirSync(sitesBaseDir).filter((f) => {
      return fs.statSync(path.join(sitesBaseDir, f)).isDirectory();
    });

    if (siteFolders.length === 0) {
      console.log(`${YELLOW}⚠️  Belum ada website token yang dibangun di folder sites/.${RESET}`);
      return;
    }

    console.log("Daftar website yang siap disinkronkan ke R2:");
    siteFolders.forEach((f, idx) => {
      console.log(`  [${idx + 1}] $${f.toUpperCase()} (${path.join("sites", f)})`);
    });
    console.log(`  [A] Sinkronkan Semua Website`);
    console.log(`  [Q] Batal\n`);

    const ans = await askQuestion(`Pilih [1-${siteFolders.length} / A / Q, default=1]: `);
    if (ans.toLowerCase() === "q") return;
    if (ans.toLowerCase() === "a") {
      for (const folder of siteFolders) {
        await syncSiteAssetsToR2(path.join(sitesBaseDir, folder), folder);
      }
      console.log(`\n${GREEN}✅ Seluruh situs tersinkronkan ke Cloudflare R2.${RESET}\n`);
      return;
    }

    const selIdx = parseInt(ans, 10) - 1;
    selectedTicker = (!isNaN(selIdx) && siteFolders[selIdx]) ? siteFolders[selIdx] : siteFolders[0];
  }

  const cleanTicker = selectedTicker.replace(/^\$/, "").toLowerCase();
  const siteDir = path.join(sitesBaseDir, cleanTicker);

  if (!fs.existsSync(siteDir)) {
    logger.error(`Direktori situs untuk $${selectedTicker.toUpperCase()} tidak ditemukan di: ${siteDir}`);
    process.exit(1);
  }

  console.log(`\n${CYAN}🚀 Mengunggah aset $${selectedTicker.toUpperCase()} ke Cloudflare R2...${RESET}`);
  const result = await syncSiteAssetsToR2(siteDir, selectedTicker);

  console.log(`\n${BOLD}${GREEN}===============================================================================${RESET}`);
  console.log(`${BOLD}${GREEN}   🎉 SINKRONISASI ASSET KE CLOUDFLARE R2 SUKSES!${RESET}`);
  console.log(`${BOLD}${GREEN}===============================================================================${RESET}`);
  console.log(`Bucket Target     : ${BOLD}${result.bucketName}${RESET}`);
  console.log(`Total Aset        : ${BOLD}${result.uploadedCount} file${RESET}`);
  console.log(`Daftar Berkas     :`);
  result.files.forEach((f) => console.log(`  - ${f}`));
  console.log(`\nStatus            : ${result.message}\n`);
}

main().catch((err) => {
  logger.error(`Fatal R2 sync error: ${err?.message || err}`);
  process.exit(1);
});
