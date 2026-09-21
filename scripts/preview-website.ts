#!/usr/bin/env bun
/**
 * scripts/preview-website.ts
 *
 * CLI Launcher for Local Web3 Website Live Previewer.
 *
 * Usage:
 *   bun run scripts/preview-website.ts [ticker] [--port=3000] [--no-open]
 */

import * as readline from "readline";
import { logger } from "../src/logger.ts";
import {
  listAvailableWebsites,
  resolveTargetWebsite,
  startWebsitePreviewServer,
} from "../src/modules/growth/website-previewer.ts";

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

export function parsePreviewArgs(argv: string[]): {
  target?: string;
  port: number;
  openBrowser: boolean;
} {
  let target: string | undefined;
  let port = 3000;
  let openBrowser = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--no-open" || arg === "--headless") {
      openBrowser = false;
    } else if (arg.startsWith("--port=")) {
      const p = parseInt(arg.split("=")[1], 10);
      if (!isNaN(p)) port = p;
    } else if (arg === "-p" || arg === "--port") {
      const next = argv[i + 1];
      if (next && !isNaN(Number(next))) {
        port = parseInt(next, 10);
        i++;
      }
    } else if (!arg.startsWith("-")) {
      target = arg;
    }
  }

  return { target, port, openBrowser };
}

async function main() {
  const args = process.argv.slice(2);
  const { target, port, openBrowser } = parsePreviewArgs(args);

  console.log(`
=================================================================
  [+] OMNICHAIN WEB3 DAPP LOCAL PREVIEWER (BUN ENGINE) [+]
=================================================================
`);

  let resolved = resolveTargetWebsite(target);

  if (!resolved) {
    const available = listAvailableWebsites();
    if (available.length === 0) {
      logger.warn("⚠️  Belum ada landing page yang di-generate di folder `sites/`.");
      console.log("\n💡 Untuk membuat landing page Web3:");
      console.log("   Gunakan: GENERATE_WEBSITE.bat atau MENU_UTAMA.bat -> Opsi [14W]\n");
      process.exit(0);
    }

    if (available.length === 1) {
      resolved = {
        siteDir: available[0].siteDir,
        ticker: available[0].ticker,
      };
      logger.info(`🔍 Otomatis memilih satu-satunya situs yang ada: $${resolved.ticker}`);
    } else {
      console.log("Pilih situs yang ingin Anda preview di peramban web:");
      available.slice(0, 9).forEach((site, index) => {
        const timeStr = site.modifiedAt.toLocaleString("id-ID");
        console.log(`  [${index + 1}] $${site.ticker.padEnd(10)} (folder: ${site.siteDir}) - ${timeStr}`);
      });
      console.log("  [Q] Keluar\n");

      const choice = await askQuestion(`Pilih opsi [1-${Math.min(available.length, 9)} / Q]: `);
      if (choice.toLowerCase() === "q") {
        console.log("Keluar.");
        process.exit(0);
      }

      const idx = parseInt(choice, 10) - 1;
      if (!isNaN(idx) && available[idx]) {
        resolved = {
          siteDir: available[idx].siteDir,
          ticker: available[idx].ticker,
        };
      } else {
        resolved = {
          siteDir: available[0].siteDir,
          ticker: available[0].ticker,
        };
      }
    }
  }

  try {
    const instance = await startWebsitePreviewServer({
      siteDir: resolved.siteDir,
      port,
      openBrowser,
    });

    console.log(`\n=================================================================`);
    console.log(`  🚀 Menampilkan Landing Page: $${resolved.ticker}`);
    console.log(`  🌐 Alamat Lokal:             ${instance.url}`);
    console.log(`  📁 Lokasi File:              ${instance.siteDir}`);
    console.log(`=================================================================`);
    console.log(`\n💡 Tekan Ctrl + C di terminal untuk menghentikan server preview.\n`);

    // Keep process alive until interrupted
    const handleShutdown = () => {
      console.log("\n[PREVIEW] Menghentikan server preview...");
      instance.stop();
      process.exit(0);
    };

    process.on("SIGINT", handleShutdown);
    process.on("SIGTERM", handleShutdown);
  } catch (err: any) {
    logger.error(`Fatal preview error: ${err?.message || err}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Preview runner error: ${err?.message || err}`);
    process.exit(1);
  });
}
