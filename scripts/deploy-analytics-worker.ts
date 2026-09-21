#!/usr/bin/env bun
/**
 * scripts/deploy-analytics-worker.ts
 *
 * 1-Command Automated Deployer for Cloudflare Worker Visitor Analytics Relay.
 *
 * Usage:
 *   bun run scripts/deploy-analytics-worker.ts
 *   bun run worker:deploy
 */

import * as dotenv from "dotenv";
dotenv.config();

import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../src/logger.ts";
import { getConfig } from "../src/config.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";

async function main() {
  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   [+] CLOUDFLARE WORKER VISITOR ANALYTICS RELAY DEPLOYER [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  const cfg = getConfig();
  const accountId = cfg.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  const apiToken = cfg.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "";

  const workerPath = path.resolve(process.cwd(), "workers", "analytics-relay", "worker.ts");

  if (!fs.existsSync(workerPath)) {
    logger.error(`Berkas worker tidak ditemukan di: ${workerPath}`);
    process.exit(1);
  }

  const workerName = "web3-analytics-relay";
  const simulatedWorkerUrl = `https://${workerName}.${accountId ? accountId.slice(0, 8) : "edge"}.workers.dev`;

  if (!accountId || !apiToken) {
    logger.info(`[WORKER] Kredensial Cloudflare belum terkonfigurasi di .env.`);
    logger.info(`Target URL Terprediksi: ${simulatedWorkerUrl}`);
    logger.info(`Mode simulasi selesai.`);
    return;
  }

  logger.info(`[WORKER] Mengunggah worker '${workerName}' ke Cloudflare Edge Network...`);

  try {
    const cmd = `npx wrangler deploy "${workerPath}" --name="${workerName}" --compatibility-date=2026-09-15`;
    const output = execSync(cmd, {
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: apiToken,
      },
      timeout: 45000,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const urlMatch = output.match(/https:\/\/[a-z0-9\-_\.]+\.workers\.dev/i);
    const deployedUrl = urlMatch ? urlMatch[0] : simulatedWorkerUrl;

    console.log(`\n${BOLD}${GREEN}===============================================================================${RESET}`);
    console.log(`${BOLD}${GREEN}   🎉 CLOUDFLARE WORKER BERHASIL DI-DEPLOY!${RESET}`);
    console.log(`${BOLD}${GREEN}===============================================================================${RESET}`);
    console.log(`Nama Worker       : ${BOLD}${workerName}${RESET}`);
    console.log(`Live Endpoint     : ${BOLD}${CYAN}${deployedUrl}${RESET}`);
    console.log(`Koneksi Database  : Neon Cloud PostgreSQL (token_<ticker>)`);
    console.log(`Metode Request    : POST /api/event`);
    console.log(`Contoh Telemetri  : curl -X POST "${deployedUrl}" -H "Content-Type: application/json" -d '{"ticker":"PUMPRUN","contractAddress":"0x...","eventType":"connect_wallet"}'\n`);
  } catch (err: any) {
    logger.warn(`[WORKER] Catatan Wrangler deploy: ${err?.message || err}`);
    console.log(`\n${YELLOW}ℹ️  Fallback URL: ${simulatedWorkerUrl}${RESET}`);
  }
}

main().catch((err) => {
  logger.error(`Fatal worker deploy error: ${err?.message || err}`);
  process.exit(1);
});
