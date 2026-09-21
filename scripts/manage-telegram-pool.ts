#!/usr/bin/env bun
/**
 * scripts/manage-telegram-pool.ts
 *
 * Pre-Provisioned Telegram Bot Pool Manager & Preflight Verifier.
 *
 * Enables 100% Zero-Prompt autonomous deployment by managing a reserve pool
 * of pre-created Telegram Bot tokens.
 *
 * Commands:
 *  - status: View pool inventory (Available, Assigned, Total).
 *  - add <tokens...>: Add new bot token(s) with preflight getMe validation.
 *  - list: Detailed tabular list of all bots, assigned tokens, and status.
 *  - sync: Ingest tokens from TELEGRAM_BOT_POOL in .env.
 *  - release <contractAddress>: Release a previously assigned bot back to pool.
 */

import * as readline from "node:readline";
import { logger } from "../src/logger.ts";
import {
  addBotToPool,
  acquireBotFromPool,
  releaseBotToPool,
  syncBotPoolFromEnv,
  getBotPoolSummary,
  listBotPool,
} from "../src/db/vault.ts";

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Validates a bot token against official Telegram Bot API (getMe).
 */
export async function verifyTelegramToken(token: string): Promise<{
  valid: boolean;
  username?: string;
  firstName?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
    const data = (await res.json()) as any;
    if (data.ok && data.result) {
      return {
        valid: true,
        username: data.result.username,
        firstName: data.result.first_name,
      };
    }
    return {
      valid: false,
      error: data.description || "Token tidak valid",
    };
  } catch (err: any) {
    return {
      valid: false,
      error: err?.message || String(err),
    };
  }
}

function maskToken(token: string): string {
  if (token.length <= 12) return token;
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export async function showPoolStatus(): Promise<void> {
  const stats = getBotPoolSummary();
  console.log(`
=================================================================
  [+] INVENTARIS KOLAM BOT TELEGRAM (TELEGRAM BOT POOL) [+]
=================================================================
  Bot Tersedia (AVAILABLE) : ${stats.available} bot (Siap dialokasikan otomatis)
  Bot Terpakai (ASSIGNED)  : ${stats.assigned} bot (Terikat ke koin live)
  Total Terdaftar          : ${stats.total} bot
=================================================================
`);

  if (stats.available === 0) {
    console.log("⚠️  Peringatan: Tidak ada bot cadangan yang tersedia!");
    console.log("   Sistem unattended akan otomatis fallback ke Master Fleet Bot.");
    console.log("   Untuk mendaftarkan bot baru: bun run scripts/manage-telegram-pool.ts add <token>\\n");
  } else {
    console.log(`✅ ${stats.available} bot siap untuk deployment berikutnya tanpa prompt manual.\\n`);
  }
}

export async function addTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) {
    logger.warn("⚠️  Tidak ada token yang diberikan.");
    return;
  }

  console.log(`\\n🔍 Memverifikasi ${tokens.length} token ke Telegram Bot API...`);

  for (const rawToken of tokens) {
    const tok = rawToken.trim();
    if (!tok || tok.length < 10) {
      logger.warn(`⚠️  Token "${tok}" diabaikan (format terlalu pendek).`);
      continue;
    }

    const check = await verifyTelegramToken(tok);
    if (!check.valid) {
      logger.warn(`❌ Token ${maskToken(tok)} tidak valid: ${check.error}`);
      continue;
    }

    const res = addBotToPool(tok, check.username);
    if (res.success) {
      logger.success(`✅ Bot terdaftar: @${check.username} (${check.firstName}) [Token: ${maskToken(tok)}]`);
    } else {
      logger.info(`ℹ️  @${check.username}: ${res.reason}`);
    }
  }

  console.log("");
  await showPoolStatus();
}

export function listAllBots(): void {
  const list = listBotPool();

  console.log(`
========================================================================================================================
  [+] DAFTAR LENGKAP BOT TELEGRAM DI VAULT DATABASE [+]
========================================================================================================================
  ID   | Status     | @Username                | Token                | Kontrak Terikat (CA)                       | Ditugaskan
  -----+------------+--------------------------+----------------------+--------------------------------------------+---------------------`);

  if (list.length === 0) {
    console.log("  (Belum ada bot yang terdaftar di pool)");
  } else {
    for (const b of list) {
      const idStr = String(b.id).padEnd(4);
      const statusStr = b.status.padEnd(10);
      const userStr = (b.botUsername ? `@${b.botUsername}` : "(unknown)").padEnd(24);
      const tokenStr = maskToken(b.botToken).padEnd(20);
      const caStr = (b.assignedContractAddr || "—").padEnd(42);
      const dateStr = b.assignedAt ? b.assignedAt.slice(0, 19).replace("T", " ") : "—";
      console.log(`  ${idStr} | ${statusStr} | ${userStr} | ${tokenStr} | ${caStr} | ${dateStr}`);
    }
  }

  console.log("========================================================================================================================\\n");
}

export function syncFromEnv(): void {
  logger.info("🔄 Menyinkronkan bot pool dari environment variable TELEGRAM_BOT_POOL...");
  const res = syncBotPoolFromEnv();
  logger.success(`✅ Selesai: ${res.added} ditambahkan baru, ${res.existing} sudah ada sebelumnya (Total: ${res.total}).\\n`);
  showPoolStatus();
}

export function releaseBot(contractAddr: string): void {
  if (!contractAddr) {
    logger.error("❌ Masukkan alamat kontrak (CA) yang ingin dilepas bot-nya.");
    return;
  }
  const ok = releaseBotToPool(contractAddr);
  if (ok) {
    logger.success(`✅ Bot yang terikat pada CA ${contractAddr} berhasil dilepas kembali menjadi AVAILABLE.`);
  } else {
    logger.warn(`⚠️  Tidak ditemukan bot yang terikat pada CA ${contractAddr}.`);
  }
}

async function interactiveMenu(): Promise<void> {
  while (true) {
    console.log(`
=================================================================
  [+] PENGELOLA CADANGAN BOT TELEGRAM (BOT POOL) [+]
=================================================================
  [1] Cek Status Inventaris Bot
  [2] Tambah Token Bot Baru (dari @BotFather)
  [3] Sinkronkan Token dari .env (TELEGRAM_BOT_POOL)
  [4] Lihat Seluruh Bot di Pool
  [5] Lepas / Reset Alokasi Bot (Release CA)
  [6] Kembali ke Menu Utama / Keluar
=================================================================
`);

    const choice = await prompt("Pilih menu [1-6]: ");

    switch (choice) {
      case "1":
        await showPoolStatus();
        break;

      case "2": {
        console.log("\\n💡 Dapatkan token dari @BotFather di Telegram.");
        console.log("   Anda dapat memasukkan beberapa token dipisahkan koma atau spasi.");
        const input = await prompt("Masukkan Bot Token: ");
        if (input) {
          const tokens = input.split(/[,\s]+/).map((t) => t.trim()).filter((t) => t.length > 10);
          await addTokens(tokens);
        }
        break;
      }

      case "3":
        syncFromEnv();
        break;

      case "4":
        listAllBots();
        break;

      case "5": {
        const ca = await prompt("Masukkan alamat kontrak (CA) yang ingin dilepas: ");
        if (ca) releaseBot(ca);
        break;
      }

      case "6":
        console.log("Keluar dari pengelola bot pool.");
        return;

      default:
        console.log("Pilihan tidak valid.");
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
    case "status":
      await showPoolStatus();
      break;

    case "add": {
      const tokens = args.slice(1);
      await addTokens(tokens);
      break;
    }

    case "list":
      listAllBots();
      break;

    case "sync":
      syncFromEnv();
      break;

    case "release": {
      const ca = args[1];
      releaseBot(ca);
      break;
    }

    default:
      await interactiveMenu();
      break;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal error: ${err?.message || err}`);
    process.exit(1);
  });
}
