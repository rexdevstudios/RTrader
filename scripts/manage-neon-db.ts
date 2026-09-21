#!/usr/bin/env bun
/**
 * scripts/manage-neon-db.ts
 *
 * CLI Utility for Neon Serverless PostgreSQL Multi-Tenant Fleet Management.
 *
 * Penggunaan:
 *   bun run scripts/manage-neon-db.ts list          -> Daftar seluruh database token di Neon
 *   bun run scripts/manage-neon-db.ts sync          -> Sinkronkan seluruh armada token ke database masing-masing di Neon
 *   bun run scripts/manage-neon-db.ts init <ticker> -> Alokasikan DB & buat schema untuk token tertentu
 *   bun run scripts/manage-neon-db.ts query <ticker>-> Lihat status & rekonsiliasi DB token
 */

import {
  isNeonConfigured,
  listNeonTokenDatabases,
  syncAllFleetToNeon,
  syncTokenDeploymentToNeon,
  getTokenDatabaseStats,
  ensureNeonTokenDatabase,
  initTokenDatabaseSchema,
  normalizeTokenDatabaseName,
  getNeonTokenDatabaseUrl,
} from "../src/db/neon-vault.ts";
import { logger } from "../src/logger.ts";

const BANNER = `
===============================================================================
  [+] NEON SERVERLESS POSTGRESQL - MULTI-TENANT FLEET MANAGER [+]
===============================================================================
  Sistem Cloud Database Terisolasi per Token (AWS us-east-2 / Serverless)
  Zero-Dependency: Native Bun.sql Driver | Dual-Write Synchronized
===============================================================================
`;

async function main(): Promise<void> {
  console.log(BANNER);

  if (!isNeonConfigured()) {
    logger.error("❌ NEON_DATABASE_URL belum terkonfigurasi di file .env!");
    logger.info("   Tambahkan URL koneksi Neon Anda ke .env untuk mengaktifkan cloud database.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase() || "summary";

  if (command === "list") {
    logger.info("🐘 Membaca daftar database token di Neon Cloud...");
    const dbs = await listNeonTokenDatabases();
    console.log(`\nTerdeteksi ${dbs.length} database token terisolasi:`);
    if (dbs.length === 0) {
      console.log("   (Belum ada database token. Jalankan: bun run scripts/manage-neon-db.ts sync)");
    } else {
      dbs.forEach((db, idx) => {
        console.log(`   [${idx + 1}] ${db}`);
      });
    }
    console.log();
    return;
  }

  if (command === "sync") {
    logger.info("🔄 Menyinkronkan seluruh armada token dari SQLite (vault.db) ke Neon Cloud...");
    const res = await syncAllFleetToNeon();
    logger.success(`\n✅ Hasil Sinkronisasi Armada:`);
    logger.info(`   Total Armada Terdaftar: ${res.totalFleet}`);
    logger.info(`   Berhasil Disinkronkan : ${res.syncedCount}`);
    logger.info(`   Gagal / Dilewati      : ${res.failedCount}`);

    console.log("\nDetail Token:");
    res.details.forEach((d) => {
      const statusIcon = d.success ? "✅" : "❌";
      console.log(`   ${statusIcon} $${d.ticker.padEnd(10)} -> ${d.dbName.padEnd(20)} ${d.error ? `(${d.error})` : "[TERHUBUNG]"}`);
    });
    console.log();
    return;
  }

  if (command === "init") {
    const ticker = args[1];
    if (!ticker) {
      logger.error("❌ Masukkan ticker token! Contoh: bun run scripts/manage-neon-db.ts init PUMPRUN");
      process.exit(1);
    }
    logger.info(`🐘 Menginisialisasi database Neon untuk $${ticker.toUpperCase()}...`);
    const prov = await ensureNeonTokenDatabase(ticker);
    if (!prov.success) {
      logger.error(`❌ Gagal alokasi database: ${prov.error}`);
      process.exit(1);
    }
    logger.success(`✅ Database '${prov.dbName}' siap (${prov.created ? "Baru dibuat" : "Sudah ada"}).`);

    logger.info(`📋 Menginisialisasi schema tabel relasional...`);
    const schemaOk = await initTokenDatabaseSchema(ticker);
    if (schemaOk) {
      logger.success(`✅ Schema tabel (identity, telemetry, trades, fees, web3_events) berhasil disiapkan!`);
      logger.info(`   Connection URI: ${prov.connectionUrl}`);
    } else {
      logger.error(`❌ Gagal membuat schema tabel.`);
    }
    console.log();
    return;
  }

  if (command === "query") {
    const ticker = args[1];
    if (!ticker) {
      logger.error("❌ Masukkan ticker token! Contoh: bun run scripts/manage-neon-db.ts query PUMPRUN");
      process.exit(1);
    }
    logger.info(`🔍 Memeriksa status database Neon untuk $${ticker.toUpperCase()}...`);
    const stats = await getTokenDatabaseStats(ticker);
    if (!stats || !stats.exists) {
      logger.warn(`⚠️ Database untuk '$${ticker}' belum ada di Neon Cloud.`);
      return;
    }
    logger.success(`✅ Database '${stats.dbName}' DITEMUKAN:`);
    console.log(`   Identitas Token : ${stats.identityCount > 0 ? "✅ Tersinkronisasi" : "Belum ada data"}`);
    if (stats.tokenDetails) {
      console.log(`     - Nama  : ${stats.tokenDetails.name}`);
      console.log(`     - CA    : ${stats.tokenDetails.contract_address}`);
      console.log(`     - Chain : ${stats.tokenDetails.chain}`);
      console.log(`     - Web3  : ${stats.tokenDetails.website_url || "N/A"}`);
      console.log(`     - Pool  : ${stats.tokenDetails.pool_id || "N/A"}`);
    }
    console.log(`   Titik Telemetri : ${stats.telemetryCount} baris`);
    console.log(`   Riwayat Trades  : ${stats.tradeCount} transaksi`);
    console.log(`   Klaim Fee/WETH  : ${stats.feeCount} event`);
    console.log(`   Interaksi Web3  : ${stats.web3EventCount} event`);
    console.log();
    return;
  }

  // Ringkasan umum (default)
  logger.info("🐘 Memeriksa status koneksi Neon Cloud...");
  const dbs = await listNeonTokenDatabases();
  logger.success(`✅ Terhubung ke Neon Cloud Database (Master: neondb)!`);
  console.log(`   Total Database Token Terisolasi: ${dbs.length}`);
  if (dbs.length > 0) {
    console.log(`   Database Aktif: [${dbs.join(", ")}]`);
  }
  console.log("\nPerintah yang Tersedia:");
  console.log("   bun run scripts/manage-neon-db.ts list          -> Daftar database token");
  console.log("   bun run scripts/manage-neon-db.ts sync          -> Sinkronkan armada SQLite ke Neon");
  console.log("   bun run scripts/manage-neon-db.ts init <ticker> -> Buat database baru untuk token");
  console.log("   bun run scripts/manage-neon-db.ts query <ticker>-> Cek status database token");
  console.log();
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`FATAL: ${err?.message || err}`);
    process.exit(1);
  });
}
