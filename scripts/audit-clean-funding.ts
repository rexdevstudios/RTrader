#!/usr/bin/env bun
/**
 * scripts/audit-clean-funding.ts
 *
 * Engine Audit Pendanaan Bersih & Deteksi Anti-Cluster Sub-Wallet (Base L2).
 *
 * Fungsi:
 *  1. Memindai saldo on-chain real-time seluruh sub-wallet terdaftar di SQLite vault.
 *  2. Mengaudit status klaster pendanaan (memastikan sub-wallet bebas korelasi dari dompet Dev).
 *  3. Menyajikan panduan penarikan bursa CEX (Binance, OKX, Tokocrypto, Indodax)
 *     lengkap dengan daftar alamat siap salin (copy-paste ready).
 *
 * Penggunaan CLI:
 *   bun run scripts/audit-clean-funding.ts
 *   bun run scripts/audit-clean-funding.ts --min-eth=0.0002
 */

import * as dotenv from "dotenv";
dotenv.config();

import { formatEther } from "viem";
import { getConfig } from "../src/config.ts";
import { logger } from "../src/logger.ts";
import { listWalletAccounts, type WalletAccount } from "../src/modules/identity/wallet-manager.ts";
import { getEvmPublicClient, deriveEvmAddress } from "../src/modules/reconciliation/evm-verifier.ts";
import {
  validateFundingCluster,
  type ClusterValidationResult,
} from "../src/modules/growth/trending-booster.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

export interface WalletFundingAuditItem {
  id: string;
  label: string;
  address: string;
  balanceEth: number;
  isDev: boolean;
  cluster: ClusterValidationResult;
  isReadyForLive: boolean;
}

export interface CleanFundingAuditSummary {
  timestamp: string;
  totalWalletsScanned: number;
  devWalletsCount: number;
  subWalletsCount: number;
  readySubWalletsCount: number;
  unfundedSubWalletsCount: number;
  items: WalletFundingAuditItem[];
}

export async function auditCleanFunding(
  minEthThreshold = 0.0002,
  injectedClient?: { getBalance: (args: { address: string }) => Promise<bigint> } | null
): Promise<CleanFundingAuditSummary> {
  const cfg = getConfig();
  const client = injectedClient !== undefined ? injectedClient : getEvmPublicClient("base");

  const devAddrs = [
    cfg.ADMIN_WALLET_PUBLIC_ADDRESS || "",
    cfg.EVM_PRIVATE_KEY ? deriveEvmAddress(cfg.EVM_PRIVATE_KEY) || "" : "",
  ]
    .filter(Boolean)
    .map((a) => a.toLowerCase());

  let allWallets = listWalletAccounts().filter((w) => w.status === "ACTIVE");
  if (!allWallets.some((w) => w.id === "default-operator")) {
    try {
      const { bootstrapDefaultWallet } = await import("../src/modules/identity/wallet-manager.ts");
      bootstrapDefaultWallet();
      allWallets = listWalletAccounts().filter((w) => w.status === "ACTIVE");
    } catch {
      // ignore
    }
  }
  const items: WalletFundingAuditItem[] = [];

  for (const w of allWallets) {
    if (!w.evmAddress) continue;

    const normalizedAddr = w.evmAddress.toLowerCase();
    const isDev = devAddrs.includes(normalizedAddr) || w.id === "default-operator";

    let balanceEth = 0;
    if (client) {
      try {
        const balBig = await client.getBalance({ address: w.evmAddress as `0x${string}` });
        balanceEth = parseFloat(formatEther(balBig));
      } catch {
        balanceEth = 0;
      }
    }

    const cluster = validateFundingCluster(w.evmAddress, isDev ? [w.evmAddress, ...devAddrs] : devAddrs);
    const isReadyForLive = !isDev && balanceEth >= minEthThreshold;

    items.push({
      id: w.id,
      label: w.label,
      address: w.evmAddress,
      balanceEth,
      isDev,
      cluster,
      isReadyForLive,
    });
  }

  const devItems = items.filter((i) => i.isDev);
  const subItems = items.filter((i) => !i.isDev);
  const readyItems = subItems.filter((i) => i.isReadyForLive);
  const unfundedItems = subItems.filter((i) => !i.isReadyForLive);

  return {
    timestamp: new Date().toISOString(),
    totalWalletsScanned: items.length,
    devWalletsCount: devItems.length,
    subWalletsCount: subItems.length,
    readySubWalletsCount: readyItems.length,
    unfundedSubWalletsCount: unfundedItems.length,
    items,
  };
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}    [+] ENGINE AUDIT PENDANAAN BERSIH & ANTI-CLUSTER SUB-WALLET [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  console.log(`${BOLD}Prinsip Arsitektur Anti-Cluster (Bubblemaps & Arkham):${RESET}`);
  console.log(`  • ${BOLD}0% Cluster Invariant${RESET} : Sub-wallet TIDAK BOLEH didanai langsung dari Dev EOA.`);
  console.log(`  • ${BOLD}Clean CEX Hop${RESET}       : Penarikan langsung dari bursa (Binance/OKX/Tokocrypto) memutus jejak.`);
  console.log(`  • ${BOLD}Threshold Live${RESET}      : Minimal 0.0002 ETH (~$0.50 USD) per sub-wallet untuk gas swap.\n`);

  const args = process.argv.slice(2);
  let minEth = 0.0002;
  for (const a of args) {
    if (a.startsWith("--min-eth=")) {
      const val = parseFloat(a.replace("--min-eth=", ""));
      if (!isNaN(val) && val > 0) minEth = val;
    }
  }

  console.log(`${CYAN}[INFO] Memindai saldo on-chain dan relasi cluster seluruh dompet...${RESET}\n`);

  const summary = await auditCleanFunding(minEth);

  console.log(`${BOLD}TABEL AUDIT STATUS DOMPET:${RESET}`);
  console.log(`─────────────────────────────────────────────────────────────────────────────`);

  for (const item of summary.items) {
    const roleBadge = item.isDev
      ? `${RED}[DEV/OPERATOR]${RESET}`
      : `${GREEN}[SUB-MAKER]${RESET}`;
    const statusBadge = item.isReadyForLive
      ? `${GREEN}SIAP LIVE (OK)${RESET}`
      : item.isDev
      ? `${YELLOW}ROLE: CREATOR (JANGAN WASH)${RESET}`
      : `${GRAY}BELUM DIDANAI (SIMULASI 0-GAS)${RESET}`;

    console.log(`${BOLD}${item.label}${RESET} (${item.id}) - ${roleBadge}`);
    console.log(`  Alamat EVM       : ${CYAN}${item.address}${RESET}`);
    console.log(`  Saldo On-Chain   : ${BOLD}${item.balanceEth.toFixed(6)} ETH${RESET}`);
    console.log(`  Status Cluster   : ${item.cluster.isClustered ? `${RED}⚠️  TERKONEKSI DEV${RESET}` : `${GREEN}✅ BEBAS CLUSTER (0% CORRELATION)${RESET}`}`);
    console.log(`  Kesiapan Live    : ${statusBadge}`);
    console.log(`─────────────────────────────────────────────────────────────────────────────`);
  }

  console.log(`\n${BOLD}RINGKASAN AUDIT KESIAPAN ARMADA:${RESET}`);
  console.log(`  • Total Dompet Dipindai  : ${summary.totalWalletsScanned}`);
  console.log(`  • Dompet Dev / Creator   : ${summary.devWalletsCount}`);
  console.log(`  • Sub-Wallet Terdaftar   : ${summary.subWalletsCount}`);
  console.log(`  • Sub-Wallet Siap Live   : ${GREEN}${summary.readySubWalletsCount}${RESET}`);
  console.log(`  • Sub-Wallet Belum Didanai: ${YELLOW}${summary.unfundedSubWalletsCount}${RESET} (Berjalan otomatis via simulasi 0-gas)`);

  const subWallets = summary.items.filter((i) => !i.isDev);
  if (subWallets.length > 0) {
    console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
    console.log(`${BOLD}${CYAN}  [+] PANDUAN PENARIKAN CEX UNTUK PENDANAAN BERSIH (100% BEBAS CLUSTER) [+]${RESET}`);
    console.log(`${BOLD}${CYAN}===============================================================================${RESET}`);
    console.log(`\n${BOLD}Cara Kerja di Penjelajah Blok (Basescan):${RESET}`);
    console.log(`  Saat Anda menarik ETH dari Binance/OKX/Tokocrypto ke alamat di bawah:`);
    console.log(`  - Pengirim terekam sebagai ${BOLD}"Binance Hot Wallet"${RESET} (Bukan dompet Anda!).`);
    console.log(`  - Hubungan antar sub-wallet putus total di ${BOLD}Bubblemaps${RESET} dan ${BOLD}Arkham${RESET}.\n`);

    console.log(`${BOLD}DAFTAR ALAMAT SUB-WALLET SIAP SALIN (PILIH 2 - 5 ALAMAT):${RESET}`);
    subWallets.forEach((w, idx) => {
      console.log(`  [${idx + 1}] ${CYAN}${w.address}${RESET} (${w.label})`);
    });

    console.log(`\n${BOLD}Instruksi Penarikan di Aplikasi Bursa Anda:${RESET}`);
    console.log(`  1. Buka menu ${BOLD}Withdraw / Penarikan ETH${RESET} di Binance / OKX / Tokocrypto / Indodax.`);
    console.log(`  2. Salin salah satu atau beberapa alamat di atas.`);
    console.log(`  3. ${BOLD}PENTING:${RESET} Pilih Jaringan (Network) -> ${BOLD}BASE${RESET} (Base Mainnet, biaya tarik biasanya hanya Rp 2.000 - Rp 5.000).`);
    console.log(`  4. Masukkan nominal mikro: misal ${BOLD}0.0005 - 0.001 ETH (~$1.20 - $2.40 USD)${RESET} per wallet.`);
    console.log(`  5. Begitu saldo masuk, jalankan kembali ${BOLD}scripts/run-trending-booster.ts --live${RESET} untuk transaksi live nyata!\n`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`[ERROR] Audit pendanaan bersih gagal: ${err?.message || err}`);
    process.exit(1);
  });
}
