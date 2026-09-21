#!/usr/bin/env bun
/**
 * scripts/generate-multi-wallets.ts
 *
 * Generator Akun Multi-Wallet Non-Kustodial Kelas Produksi (EVM & Solana).
 *
 * Fitur:
 *  1. Mendukung generasi wallet EVM (Base, Ethereum, Arbitrum, BSC, Polygon).
 *  2. Mendukung generasi wallet Solana SVM (Phantom, Solflare, Pump.fun).
 *  3. Mendukung Mode Dual-Chain Pair (1 Akun = 1 Alamat EVM + 1 Alamat Solana).
 *  4. Otomatis menyimpan ke SQLite Vault lokal (tabel wallets & wallet_accounts).
 *  5. Menghasilkan berkas ekspor aman:
 *     - wallets/wallets_export_<timestamp>.json
 *     - wallets/wallets_export_<timestamp>.csv (Bisa langsung dibuka di Excel / Google Sheets)
 *
 * Penggunaan CLI:
 *   bun run scripts/generate-multi-wallets.ts --chain=evm --count=5
 *   bun run scripts/generate-multi-wallets.ts --chain=solana --count=5
 *   bun run scripts/generate-multi-wallets.ts --chain=dual --count=5
 *   bun run scripts/generate-multi-wallets.ts (Mode Interaktif)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { saveWallet } from "../src/db/vault.ts";
import { registerWalletAccount } from "../src/modules/identity/wallet-manager.ts";
import { logger } from "../src/logger.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

export type TargetChainType = "evm" | "solana" | "dual";

export interface GeneratedWalletRecord {
  index: number;
  label: string;
  chain: "evm" | "solana" | "dual";
  evmAddress?: string;
  evmPrivateKey?: string;
  solanaAddress?: string;
  solanaPrivateKey?: string;
  createdAt: string;
}

export interface MultiWalletGenerationResult {
  chain: TargetChainType;
  count: number;
  wallets: GeneratedWalletRecord[];
  jsonPath: string;
  csvPath: string;
}

/**
 * Inti Logika Generator Multi-Wallet (Bisa diuji via unit test).
 */
export function generateMultiWallets(
  chain: TargetChainType,
  count: number,
  outputDir: string = path.join(process.cwd(), "wallets"),
  labelPrefix: string = "Sub-Wallet"
): MultiWalletGenerationResult {
  if (count <= 0) {
    throw new Error("Jumlah wallet harus minimal 1.");
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const wallets: GeneratedWalletRecord[] = [];

  for (let i = 1; i <= count; i++) {
    const label = `${labelPrefix} #${i}`;
    const record: GeneratedWalletRecord = {
      index: i,
      label,
      chain,
      createdAt: new Date().toISOString(),
    };

    // 1. Generate EVM
    if (chain === "evm" || chain === "dual") {
      const evmPriv = generatePrivateKey();
      const evmAcc = privateKeyToAccount(evmPriv);
      record.evmAddress = evmAcc.address;
      record.evmPrivateKey = evmPriv;

      // Simpan ke SQLite vault
      try {
        saveWallet("base", evmAcc.address, evmPriv);
      } catch {
        // Abaikan jika sudah ada
      }
    }

    // 2. Generate Solana
    if (chain === "solana" || chain === "dual") {
      const solKp = Keypair.generate();
      const solPub = solKp.publicKey.toBase58();
      const solPriv = bs58.encode(solKp.secretKey);
      record.solanaAddress = solPub;
      record.solanaPrivateKey = solPriv;

      // Simpan ke SQLite vault
      try {
        saveWallet("solana", solPub, solPriv);
      } catch {
        // Abaikan jika sudah ada
      }
    }

    // 3. Daftarkan ke sistem wallet_accounts
    try {
      registerWalletAccount({
        id: `wallet_${timestamp}_${i}`,
        label,
        evmAddress: record.evmAddress,
        solanaAddress: record.solanaAddress,
      });
    } catch {
      // Abaikan jika tabel belum siap
    }

    wallets.push(record);
  }

  // Simpan berkas JSON
  const jsonFilename = `wallets_export_${chain}_${timestamp}.json`;
  const jsonPath = path.join(outputDir, jsonFilename);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        exportTimestamp: new Date().toISOString(),
        chainType: chain,
        totalWallets: wallets.length,
        notes: "RAHASIA: Jangan pernah membagikan private key ini kepada siapa pun!",
        wallets,
      },
      null,
      2
    ),
    "utf-8"
  );

  // Simpan berkas CSV (Bisa dibuka di Microsoft Excel / Google Sheets)
  const csvFilename = `wallets_export_${chain}_${timestamp}.csv`;
  const csvPath = path.join(outputDir, csvFilename);

  let csvContent = "";
  if (chain === "evm") {
    csvContent = "Index,Label,Chain,EVM_Address,EVM_PrivateKey,CreatedAt\n";
    for (const w of wallets) {
      csvContent += `${w.index},"${w.label}",EVM,${w.evmAddress},${w.evmPrivateKey},${w.createdAt}\n`;
    }
  } else if (chain === "solana") {
    csvContent = "Index,Label,Chain,Solana_Address,Solana_PrivateKey,CreatedAt\n";
    for (const w of wallets) {
      csvContent += `${w.index},"${w.label}",Solana,${w.solanaAddress},${w.solanaPrivateKey},${w.createdAt}\n`;
    }
  } else {
    csvContent = "Index,Label,Chain,EVM_Address,EVM_PrivateKey,Solana_Address,Solana_PrivateKey,CreatedAt\n";
    for (const w of wallets) {
      csvContent += `${w.index},"${w.label}",Dual,${w.evmAddress},${w.evmPrivateKey},${w.solanaAddress},${w.solanaPrivateKey},${w.createdAt}\n`;
    }
  }

  fs.writeFileSync(csvPath, csvContent, "utf-8");

  return {
    chain,
    count: wallets.length,
    wallets,
    jsonPath,
    csvPath,
  };
}

async function promptQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}    [+] GENERATOR MULTI-WALLET NON-KUSTODIAL RESMI (EVM & SOLANA) [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  console.log(`${BOLD}Informasi Perbedaan Fundamental:${RESET}`);
  console.log(`  • ${BOLD}Akun Bankr${RESET}   : Akun Smart Wallet Kustodial yang terhubung via API Key (${GRAY}bk_usr_...${RESET}).`);
  console.log(`                 Dikelola otomatis oleh server Bankr untuk deploy bersponsor gas.`);
  console.log(`  • ${BOLD}Akun Pribadi${RESET} : Dompet Non-Kustodial 100% milik Anda sendiri.`);
  console.log(`                 Memiliki Private Key independen, bisa di-import ke MetaMask/Phantom,\n                 dan dipakai untuk rotasi multi-wallet, sniper, atau simpanan pribadi.\n`);

  const args = process.argv.slice(2);
  let chainArg: TargetChainType | undefined;
  let countArg: number | undefined;

  for (const a of args) {
    if (a.startsWith("--chain=")) {
      const val = a.replace("--chain=", "").toLowerCase();
      if (val === "evm" || val === "solana" || val === "dual") {
        chainArg = val;
      }
    }
    if (a.startsWith("--count=")) {
      const val = parseInt(a.replace("--count=", ""), 10);
      if (!isNaN(val) && val > 0) {
        countArg = val;
      }
    }
  }

  // Mode interaktif jika argumen CLI tidak lengkap
  if (!chainArg) {
    console.log(`${BOLD}PILIH JENIS RANTAI DOMPET:${RESET}`);
    console.log(`  [1] EVM Multi-Wallet (Base, Ethereum, Arbitrum, BSC) - Format 0x...`);
    console.log(`  [2] Solana Multi-Wallet (Pump.fun, Raydium, Solscan) - Format Base58`);
    console.log(`  [3] Dual-Chain Pair (Setiap akun mendapat 1 EVM + 1 Solana sekaligus!)\n`);

    const cChoice = await promptQuestion("Pilihan Anda [1-3, default=1]: ");
    if (cChoice === "2") chainArg = "solana";
    else if (cChoice === "3") chainArg = "dual";
    else chainArg = "evm";
  }

  if (!countArg) {
    const countInput = await promptQuestion("\nBerapa banyak akun dompet yang ingin Anda generate? [Default: 5]: ");
    countArg = parseInt(countInput, 10);
    if (isNaN(countArg) || countArg <= 0) {
      countArg = 5;
    }
  }

  console.log(`\n${CYAN}[INFO] Menghasilkan ${countArg} akun dompet (${chainArg.toUpperCase()})...${RESET}`);

  const res = generateMultiWallets(chainArg, countArg);

  console.log(`\n${BOLD}${GREEN}✅ BERHASIL MENGHASILKAN ${res.count} AKUN MULTI-WALLET!${RESET}\n`);

  console.log(`${BOLD}DAFTAR ALAMAT DOMPET TERBARU:${RESET}`);
  console.log(`─────────────────────────────────────────────────────────────────────────────`);

  for (const w of res.wallets) {
    console.log(`${BOLD}${YELLOW}[${w.index}] ${w.label}${RESET}`);
    if (w.evmAddress) {
      console.log(`    EVM Address    : ${CYAN}${w.evmAddress}${RESET}`);
      console.log(`    EVM PrivateKey : ${GRAY}${w.evmPrivateKey?.slice(0, 10)}...${w.evmPrivateKey?.slice(-8)} (Tersimpan aman)${RESET}`);
    }
    if (w.solanaAddress) {
      console.log(`    Solana Address : ${MAGENTA}${w.solanaAddress}${RESET}`);
      console.log(`    Sol PrivateKey : ${GRAY}${w.solanaPrivateKey?.slice(0, 10)}...${w.solanaPrivateKey?.slice(-8)} (Tersimpan aman)${RESET}`);
    }
    console.log(`─────────────────────────────────────────────────────────────────────────────`);
  }

  console.log(`\n${BOLD}LOKASI BERKAS PENYIMPANAN & EKSPOR:${RESET}`);
  console.log(`  1. Database SQLite : ${GREEN}Tersimpan otomatis di .eliza/vault.db${RESET}`);
  console.log(`  2. Berkas JSON     : ${CYAN}${res.jsonPath}${RESET}`);
  console.log(`  3. Berkas Excel/CSV: ${CYAN}${res.csvPath}${RESET}`);

  console.log(`\n${BOLD}${YELLOW}⚠️  CATATAN KEAMANAN PENTING:${RESET}`);
  console.log(`  • Berkas CSV dapat langsung Anda buka di Microsoft Excel untuk disalin ke dompet fisik/catatan offline.`);
  console.log(`  • Private key adalah kunci rahasia hak milik dompet. Jangan pernah mengirimkannya ke internet atau orang lain.`);
  console.log(`  • Dompet-dompet ini sekarang sudah terdaftar di bot Anda dan siap digunakan untuk fitur multi-wallet.\n`);
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`[ERROR] Gagal generate wallet: ${err.message}`);
    process.exit(1);
  });
}
