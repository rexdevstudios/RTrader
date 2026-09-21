#!/usr/bin/env bun
/**
 * scripts/run-webhook-daemon.ts
 *
 * Standalone Windows / VPS Background Service Daemon for DexScreener Fast-Track
 * Payment Webhook & Order Verifier.
 *
 * Listens on port 3001 (or process.env.PORT) for incoming DexScreener payment confirmations,
 * broadcasts real-time proof cards to Telegram/Discord, updates vault.db, and ignites the
 * multi-wallet Volume Spark.
 *
 * Usage:
 *   bun run scripts/run-webhook-daemon.ts [port] [--secret=<secret>]
 */

import * as dotenv from "dotenv";
dotenv.config();

import { startFastTrackWebhookServer } from "../src/modules/growth/fast-track-webhook.ts";
import { logger } from "../src/logger.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

async function main() {
  const args = process.argv.slice(2);
  const secretArg = args.find((a) => a.startsWith("--secret="));
  const secret = secretArg
    ? secretArg.split("=")[1]?.trim()
    : process.env.FAST_TRACK_WEBHOOK_SECRET;

  const portArg = args.find((a) => !a.startsWith("--") && /^\d+$/.test(a));
  const port = portArg
    ? parseInt(portArg, 10)
    : parseInt(process.env.WEBHOOK_PORT || process.env.PORT || "3001", 10);

  console.log(`\n${BOLD}${MAGENTA}===============================================================================${RESET}`);
  console.log(`${BOLD}${MAGENTA}   [+] DEXSCREENER FAST-TRACK PAYMENT WEBHOOK DAEMON SERVICE [+]${RESET}`);
  console.log(`${BOLD}${MAGENTA}===============================================================================${RESET}\n`);

  console.log(`  Port Aktif    : ${BOLD}${CYAN}${port}${RESET}`);
  console.log(`  Secret Auth   : ${secret ? `${GREEN}AKTIF (Protected)${RESET}` : `${YELLOW}TIDAK ADA (Bebas / Terbuka)${RESET}`}`);
  console.log(`  Health Check  : ${GRAY}GET  http://localhost:${port}/health${RESET}`);
  console.log(`  Webhook Route : ${BOLD}${GREEN}POST http://localhost:${port}/webhook/dexscreener/fast-track${RESET}\n`);
  console.log(`${GRAY}Menunggu webhook masuk dari gateway pembayaran / automasi DexScreener...${RESET}`);
  console.log(`${GRAY}Tekan Ctrl+C kapan saja untuk menghentikan daemon.${RESET}\n`);

  const serverInstance = startFastTrackWebhookServer(port, secret);

  const shutdown = () => {
    console.log(`\n${YELLOW}🛑 Menghentikan webhook daemon...${RESET}`);
    serverInstance.stop();
    console.log(`${GREEN}✅ Daemon berhasil dihentikan secara aman.${RESET}`);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error(`Fatal error in webhook daemon: ${err?.message || err}`);
  process.exit(1);
});
