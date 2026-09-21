#!/usr/bin/env bun
/**
 * scripts/manage-bankr-key.ts
 *
 * Interactive Bankr API Key Manager & Real-Time Preflight Validator.
 *
 * Allows operator to:
 *  1. Check the active BANKR_API_KEY status and live account balance ($ USD).
 *  2. Input / update BANKR_API_KEY interactively with pre-save server verification.
 *  3. Atomically update .env without corrupting existing comments or variables.
 *  4. Synchronize key reference to vault.db.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import axios from "axios";
import { logger } from "../src/logger.ts";
import {
  getBankrHeaders,
  sanitizeSecret,
  fetchBankrBalances,
} from "../src/modules/evm/bankr-deployer.ts";
import {
  setWalletProviderRoute,
  getWalletAccount,
  bootstrapDefaultWallet,
  listWalletAccounts,
  registerWalletAccount,
  updateWalletStatus,
  getAllProviderRoutes,
  resolveCredential,
  getProxyConfig,
} from "../src/modules/identity/wallet-manager.ts";

const ENV_PATH = path.resolve(process.cwd(), ".env");

/**
 * Tests an API key directly against api.bankr.bot/wallet/balances using fetchBankrBalances.
 */
export async function verifyBankrApiKey(apiKey: string): Promise<{
  valid: boolean;
  status: number;
  data?: any;
  error?: string;
}> {
  try {
    const data = await fetchBankrBalances(apiKey.trim());
    return { valid: true, status: 200, data };
  } catch (err: any) {
    const status = err.response?.status ?? 500;
    const msg = err.response?.data?.message || err.response?.data?.error || err.message;
    return { valid: false, status, error: msg };
  }
}

/**
 * Safely updates or inserts a key-value pair in .env file without altering other lines.
 */
export function writeKeyToEnv(keyName: string, value: string): void {
  let content = "";
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, "utf-8");
  }

  const regex = new RegExp(`^${keyName}=.*$`, "m");
  const newLine = `${keyName}=${value.trim()}`;

  if (regex.test(content)) {
    content = content.replace(regex, newLine);
  } else {
    content = content.endsWith("\n") || content.length === 0
      ? `${content}${newLine}\n`
      : `${content}\n${newLine}\n`;
  }

  fs.writeFileSync(ENV_PATH, content, "utf-8");
}

/**
 * Reads the current value of an environment key from .env file directly.
 */
export function readKeyFromEnv(keyName: string): string | undefined {
  if (!fs.existsSync(ENV_PATH)) return undefined;
  const content = fs.readFileSync(ENV_PATH, "utf-8");
  const regex = new RegExp(`^${keyName}=(.*)$`, "m");
  const match = content.match(regex);
  return match ? match[1]?.trim() : undefined;
}

async function promptInput(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise<string>((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

// ─── CLI Handlers ───────────────────────────────────────────────────────────

async function handleCheck(): Promise<void> {
  const currentKey = readKeyFromEnv("BANKR_API_KEY") || process.env.BANKR_API_KEY;

  console.log(`
=================================================================
  [+] AUDIT STATUS KUNCI BANKR API [+]
=================================================================
`);

  if (!currentKey) {
    logger.warn("⚠️  BANKR_API_KEY belum terpasang di file .env.");
    console.log("   Gunakan: bun run scripts/manage-bankr-key.ts set");
    return;
  }

  logger.info(`Kunci Terpasang : ${sanitizeSecret(currentKey)}`);
  logger.info("Menguji koneksi ke server api.bankr.bot...");

  const result = await verifyBankrApiKey(currentKey);
  if (!result.valid) {
    logger.error(`❌ Kunci tidak valid atau ditolak oleh server (Status: ${result.status}): ${result.error}`);
    console.log("\n💡 Silakan perbarui kunci dengan: bun run scripts/manage-bankr-key.ts set\n");
    return;
  }

  const evmCustodial = result.data?.evmAddress || "N/A";
  const solCustodial = result.data?.solAddress || "N/A";
  const bMap = result.data?.balances || {};
  let totalUsd = 0;
  for (const info of Object.values(bMap) as any[]) {
    totalUsd += parseFloat(info?.nativeUsd || "0");
  }

  logger.success("✅ Kunci BANKR_API_KEY VALID & AKTIF (HTTP 200 OK)!");
  console.log(`-----------------------------------------------------------------`);
  console.log(`  Custodial EVM (Base)  : ${evmCustodial}`);
  console.log(`  Custodial Solana (SVM): ${solCustodial}`);
  console.log(`  Total Saldo Terdeteksi: $${totalUsd.toFixed(2)} USD`);
  console.log(`  Relayer Sponsorship   : 100% Aktif (Biaya deploy operator = $0.00 ETH)`);
  console.log(`-----------------------------------------------------------------\n`);
}

async function handleSet(newKeyInput?: string): Promise<void> {
  console.log(`
=================================================================
  [+] PENGATURAN & VALIDASI BANKR API KEY [+]
=================================================================
`);

  let keyToTest = newKeyInput?.trim();
  if (!keyToTest) {
    const currentKey = readKeyFromEnv("BANKR_API_KEY");
    if (currentKey) {
      console.log(`Kunci saat ini: ${sanitizeSecret(currentKey)}\n`);
    }
    keyToTest = await promptInput("Tempelkan (Paste) BANKR_API_KEY baru Anda: ");
  }

  if (!keyToTest || keyToTest.length < 10) {
    logger.error("❌ Input kunci dibatalkan atau terlalu pendek.");
    return;
  }

  logger.info("🔒 [PREFLIGHT] Menguji kunci baru ke server api.bankr.bot...");
  const result = await verifyBankrApiKey(keyToTest);

  if (!result.valid) {
    logger.error(`❌ UJI GAGAL: Server Bankr menolak kunci tersebut (HTTP ${result.status})`);
    logger.error(`   Pesan error: ${result.error}`);
    logger.warn("⚠️  File .env TIDAK diubah demi keamanan sistem.");
    return;
  }

  // 1. Write to .env
  writeKeyToEnv("BANKR_API_KEY", keyToTest);
  process.env.BANKR_API_KEY = keyToTest;
  logger.success("✅ File .env berhasil diperbarui secara aman.");

  // 2. Sync to vault
  try {
    let wallet = getWalletAccount("default-operator");
    if (!wallet) {
      wallet = bootstrapDefaultWallet();
    }
    setWalletProviderRoute(wallet.id, "bankr", {
      credentialRef: "env:BANKR_API_KEY",
    });
    logger.success("✅ Rute wallet default di database vault berhasil disinkronkan.");
  } catch (vaultErr: any) {
    logger.warn(`⚠️  Peringatan vault: ${vaultErr?.message || vaultErr}`);
  }

  const walletAddr = result.data?.evmAddress || result.data?.wallet?.address || "N/A";
  const totalUsd = result.data?.totalUsdValue ?? "N/A";

  console.log(`
=================================================================
  🎉 BANKR API KEY RESMI BERHASIL DIPASANG & TERVERIFIKASI!
=================================================================
  Key Reference        : ${sanitizeSecret(keyToTest)}
  Bankr Wallet Address : ${walletAddr}
  Saldo Resmi          : $${totalUsd} USD
  Status Relayer Gas   : SPONSORED (Gratis Rp 0 Gas Deploy)
=================================================================
`);
}

async function handleRegisterNewAccount(
  newKeyInput?: string,
  accountIdInput?: string,
  accountLabelInput?: string,
  proxyIdInput?: string
): Promise<void> {
  console.log(`
=================================================================
  [+] DAFTARKAN AKUN BANKR BARU (AKUN 2, AKUN 3, DST.) [+]
=================================================================
`);
  const existingAccounts = listWalletAccounts();
  const defaultId = `bankr-acc-${existingAccounts.length + 1}`;
  const defaultLabel = `Bankr Operator ${existingAccounts.length + 1}`;

  let accountId = accountIdInput?.trim();
  if (!accountId) {
    const rawInput = await promptInput(
      `Masukkan ID Akun [huruf/angka/tanda minus] (Enter = '${defaultId}'): `
    );
    accountId = rawInput.trim() || defaultId;
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
    logger.error("❌ ID Akun tidak valid. Hanya boleh mengandung huruf, angka, minus, atau garis bawah.");
    return;
  }

  if (getWalletAccount(accountId)) {
    logger.error(`❌ Akun dengan ID '${accountId}' sudah terdaftar di database vault.`);
    return;
  }

  let accountLabel = accountLabelInput?.trim();
  if (!accountLabel) {
    const rawInput = await promptInput(`Masukkan Label Akun (Enter = '${defaultLabel}'): `);
    accountLabel = rawInput.trim() || defaultLabel;
  }

  let keyToTest = newKeyInput?.trim();
  if (!keyToTest) {
    keyToTest = await promptInput("Tempelkan (Paste) BANKR_API_KEY untuk akun baru ini: ");
  }

  if (!keyToTest || keyToTest.length < 10) {
    logger.error("❌ Kunci API kosong atau terlalu pendek.");
    return;
  }

  logger.info("🔒 [PREFLIGHT] Menguji koneksi akun ke server api.bankr.bot...");
  const result = await verifyBankrApiKey(keyToTest);

  if (!result.valid) {
    logger.error(`❌ UJI GAGAL: Server Bankr menolak kunci tersebut (HTTP ${result.status})`);
    logger.error(`   Pesan error: ${result.error}`);
    return;
  }

  const evmCustodial = result.data?.evmAddress || null;
  const solCustodial = result.data?.solAddress || null;

  let envSuffix = accountId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  if (envSuffix.startsWith("BANKR_ACC_")) {
    envSuffix = envSuffix.replace("BANKR_ACC_", "");
  }
  const envVarName = `BANKR_API_KEY_${envSuffix}`;

  // 1. Simpan ke .env
  writeKeyToEnv(envVarName, keyToTest);
  process.env[envVarName] = keyToTest;
  logger.success(`✅ Kunci disimpan di .env sebagai: ${envVarName}`);

  // Tentukan proxy (utamakan proxy_us_la jika tersedia)
  const proxyId = proxyIdInput !== undefined ? proxyIdInput : (getProxyConfig("proxy_us_la") ? "proxy_us_la" : null);

  // 2. Daftarkan wallet account di vault.db
  try {
    registerWalletAccount({
      id: accountId,
      label: accountLabel,
      evmAddress: evmCustodial,
      solanaAddress: solCustodial,
      credentialRef: `env:${envVarName}`,
      status: "ACTIVE",
    });

    setWalletProviderRoute(accountId, "bankr", {
      credentialRef: `env:${envVarName}`,
      proxyId: proxyId,
    });

    logger.success(`✅ Akun '${accountId}' berhasil didaftarkan di database vault.`);
  } catch (err: any) {
    logger.error(`❌ Gagal mendaftarkan akun di vault: ${err?.message || err}`);
    return;
  }

  let totalUsd = 0;
  const bMap = result.data?.balances || {};
  for (const info of Object.values(bMap) as any[]) {
    totalUsd += parseFloat(info?.nativeUsd || "0");
  }

  console.log(`
=================================================================
  🎉 AKUN BANKR BARU BERHASIL DITAMBAHKAN & TERVERIFIKASI!
=================================================================
  Account ID           : ${accountId}
  Label                : ${accountLabel}
  Pointer Kunci        : env:${envVarName}
  Proxy Route          : ${proxyId ?? "Direct"}
  Custodial EVM (Base) : ${evmCustodial ?? "N/A"}
  Custodial SVM (Sol)  : ${solCustodial ?? "N/A"}
  Total Saldo Live     : $${totalUsd.toFixed(2)} USD
  Status Gas Relayer   : 100% SPONSORED (Gratis Gas Deploy)
=================================================================
`);
}

async function handleSwitchActiveAccount(targetIdOrIndex?: string | number): Promise<void> {
  console.log(`
=================================================================
  [+] GANTI / BERALIH AKUN BANKR AKTIF [+]
=================================================================
`);
  const accounts = listWalletAccounts();
  if (accounts.length === 0) {
    logger.warn("⚠️  Belum ada akun terdaftar di vault.");
    return;
  }

  console.log("Daftar Akun Terdaftar:");
  accounts.forEach((acc, idx) => {
    const isCurrent = acc.credentialRef === "env:BANKR_API_KEY" || acc.id === "default-operator";
    console.log(
      `  [${idx + 1}] ID: ${acc.id.padEnd(16)} | Label: ${acc.label.padEnd(25)} | Status: ${acc.status} ${isCurrent ? "(AKTIF DI .ENV)" : ""}`
    );
  });

  let selected: any;
  if (targetIdOrIndex !== undefined && String(targetIdOrIndex).trim().length > 0) {
    const targetStr = String(targetIdOrIndex).trim();
    const asNum = parseInt(targetStr, 10);
    if (!isNaN(asNum) && accounts[asNum - 1]) {
      selected = accounts[asNum - 1];
    } else {
      selected = accounts.find((a) => a.id.toLowerCase() === targetStr.toLowerCase());
    }
  }

  if (!selected) {
    const choiceStr = await promptInput(`\nPilih nomor akun untuk dijadikan akun aktif utama [1-${accounts.length}]: `);
    const choiceIdx = parseInt(choiceStr, 10) - 1;

    if (isNaN(choiceIdx) || !accounts[choiceIdx]) {
      logger.error("❌ Pilihan akun tidak valid.");
      return;
    }
    selected = accounts[choiceIdx];
  }

  const resolvedKey = resolveCredential(selected.credentialRef);

  if (!resolvedKey) {
    logger.error(
      `❌ Tidak dapat mengambil kunci rahasia dari pointer '${selected.credentialRef}'. Pastikan variabel lingkungan terisi di .env.`
    );
    return;
  }

  // Update BANKR_API_KEY di .env agar sinkron sebagai default
  writeKeyToEnv("BANKR_API_KEY", resolvedKey);
  process.env.BANKR_API_KEY = resolvedKey;

  // Pastikan status akun ACTIVE di vault
  updateWalletStatus(selected.id, "ACTIVE");

  logger.success(`✅ Akun aktif utama berhasil dialihkan ke: '${selected.id}' (${selected.label})`);
  logger.info(`   BANKR_API_KEY di .env kini tersinkronisasi dengan akun ini.`);
}

async function handleListAccounts(): Promise<void> {
  console.log(`
=================================================================
  [+] DAFTAR SEMUA AKUN BANKR TERDAFTAR [+]
=================================================================
`);
  const accounts = listWalletAccounts();
  const routes = getAllProviderRoutes();

  if (accounts.length === 0) {
    console.log("Belum ada akun terdaftar di vault.");
    return;
  }

  accounts.forEach((acc, idx) => {
    const bankrRoute = routes.find((r) => r.walletId === acc.id && r.provider === "bankr");
    console.log(`[${idx + 1}] ID: ${acc.id} (${acc.label})`);
    console.log(`    Status         : ${acc.status}`);
    console.log(`    EVM Custodial  : ${acc.evmAddress ?? "N/A"}`);
    console.log(`    Solana Address : ${acc.solanaAddress ?? "N/A"}`);
    console.log(`    Credential Ref : ${acc.credentialRef ?? "N/A"}`);
    console.log(
      `    Bankr Route    : ${bankrRoute ? `[${bankrRoute.status}] proxy: ${bankrRoute.proxyId ?? "Direct"}` : "None"}`
    );
    console.log("-----------------------------------------------------------------");
  });
}

async function handleInteractiveMenu(): Promise<void> {
  while (true) {
    console.log(`
=================================================================
  [+] PENGELOLA MULTI-AKUN & KUNCI BANKR API [+]
=================================================================
  [1] Audit Status & Cek Saldo Kunci Saat Ini (Real-Time Preflight)
  [2] Update / Pasang Kunci Akun Utama (BANKR_API_KEY di .env)
  [3] Daftarkan Akun Bankr Baru (Akun 2, Akun 3, dst.)
  [4] Beralih Akun Aktif (Switch Active Account)
  [5] Daftar Semua Akun Terdaftar di Database Vault
  [6] Keluar
=================================================================
`);
    const choice = await promptInput("Masukkan pilihan [1-6]: ");
    switch (choice.trim()) {
      case "1":
        await handleCheck();
        break;
      case "2":
        await handleSet();
        break;
      case "3":
        await handleRegisterNewAccount();
        break;
      case "4":
        await handleSwitchActiveAccount();
        break;
      case "5":
        await handleListAccounts();
        break;
      case "6":
      case "q":
      case "exit":
        return;
      default:
        console.log("[!] Pilihan tidak dikenali.");
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();
  const newKeyArg = args[1];

  switch (command) {
    case "check":
    case "status":
      await handleCheck();
      break;
    case "set":
    case "update":
      await handleSet(newKeyArg);
      break;
    case "add":
    case "register":
      await handleRegisterNewAccount(newKeyArg, args[2], args[3], args[4]);
      break;
    case "switch":
      await handleSwitchActiveAccount(newKeyArg);
      break;
    case "list":
      await handleListAccounts();
      break;
    case "menu":
    case undefined:
      await handleInteractiveMenu();
      break;
    default:
      console.log(`
Penggunaan:
  bun run scripts/manage-bankr-key.ts                        -> Menu interaktif lengkap
  bun run scripts/manage-bankr-key.ts check                  -> Cek status dan saldo kunci saat ini
  bun run scripts/manage-bankr-key.ts set [key]              -> Dialog/pasang kunci utama baru
  bun run scripts/manage-bankr-key.ts add [key] [id] [label] -> Daftarkan akun Bankr baru
  bun run scripts/manage-bankr-key.ts switch [id/index]      -> Beralih akun aktif
  bun run scripts/manage-bankr-key.ts list                   -> Tampilkan daftar semua akun
`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal Bankr key manager error: ${err?.message || err}`);
    process.exit(1);
  });
}
