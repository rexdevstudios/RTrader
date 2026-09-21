#!/usr/bin/env bun
/**
 * scripts/manage-wallets.ts — CLI Operational Tool for Multi-Wallet & Proxy Administration.
 *
 * Commands:
 *   bun run scripts/manage-wallets.ts list
 *   bun run scripts/manage-wallets.ts add-wallet <id> <label> [evmAddress] [solanaAddress] [credentialRef]
 *   bun run scripts/manage-wallets.ts add-proxy <id> <protocol> <host> <port> [username] [password]
 *   bun run scripts/manage-wallets.ts set-route <walletId> <provider> <credentialRef> [proxyId]
 *   bun run scripts/manage-wallets.ts status <walletId> <ACTIVE|PAUSED|DISABLED>
 *
 * Principles:
 *   1. Zero Plaintext Secrets in Output: Passwords and sensitive pointers are masked/redacted.
 *   2. Reuses existing wallet-manager and vault APIs directly without duplicated SQL.
 *   3. Input validation prior to database mutations.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import axios from "axios";
import { logger } from "../src/logger.ts";
import { writeKeyToEnv, verifyBankrApiKey } from "./manage-bankr-key.ts";
import {
  listWalletAccounts,
  getWalletAccount,
  registerWalletAccount,
  updateWalletStatus,
  listProxyConfigs,
  getProxyConfig,
  registerProxyConfig,
  updateProxyStatus,
  updateProxyDetails,
  deleteProxyConfig,
  autoFailoverUnhealthyRoutes,
  getAllProviderRoutes,
  getWalletProviderRoute,
  setWalletProviderRoute,
  rotateWalletProxy,
  resolveOperationalContext,
  resolveCredential,
  buildProxyUrl,
  bootstrapDefaultWallet,
  pingProxyEndpoint,
  evaluateQuarantineCooldown,
  probeAndResupplyQuarantinedPool,
  recordProxyAuditLog,
  type WalletStatus,
  type ProxyProtocol,
  type ProxyHealthStatus,
  type SupportedProvider,
  type ProxyAuditLog,
  type AutoFailoverDetail,
  type AutoFailoverResult,
  type ProxyPingResult,
  type QuarantineCooldownReport,
  type PoolResupplyOptions,
  type PoolResupplyResult,
  rebalanceOperatorBalances,
  autoReplaceFlappingWebshareProxies,
} from "../src/modules/identity/wallet-manager.ts";
import { isValidDestinationAddress } from "../src/modules/treasury/treasury-sweeper.ts";
import {
  broadcastProxyAlert,
  broadcastLowBalanceAlert,
  broadcastRebalanceAlert,
  type ProxyAlertParams,
  type BalanceAlertParams,
} from "../src/modules/social/beacon-broadcaster.ts";
import {
  scanAllWalletBalances,
  type MultiWalletBalanceReport,
} from "../src/modules/identity/preflight-balance.ts";
import {
  syncWebshareProxiesToVault,
  fetchWebshareProxyList,
  replaceWebshareProxy,
  type WebshareSyncResult,
} from "../src/modules/identity/webshare-adapter.ts";

const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

function printHelp(): void {
  console.log(`
=================================================================
  [+] BOT MULTI-WALLET & PROXY CLI MANAGER [+]
=================================================================
Usage:
  bun run scripts/manage-wallets.ts <command> [arguments]

Commands:
  list
    List all registered wallet accounts, provider routes, and proxy configs.

  check-balance [--alert] [--min-eth <N>] [--min-sol <N>] [--all]
    Scan and display real-time on-chain native balances (Base ETH & Solana SOL).
    Optional --alert dispatches Telegram & Discord broadcast card if any wallet is below threshold.
    Example: bun run scripts/manage-wallets.ts check-balance --alert

  rebalance [--dry-run] [--chain <all|base|solana>] [--min-eth <N>] [--min-sol <N>] [--broadcast]
    Autonomous gas rebalancer: tops up starving sub-wallets from Master wallet with reserve buffer guard.
    Example: bun run scripts/manage-wallets.ts rebalance --dry-run

  sync-webshare [--api-key <KEY>] [--replace-dead] [--no-ping] [--auto-bind] [--broadcast] [--limit <N>]
    Dynamic proxy synchronization directly from Webshare API v2.
    Example: bun run scripts/manage-wallets.ts sync-webshare --auto-bind --broadcast

  replace-flapping [--api-key <KEY>] [--force] [--broadcast]
    Auto-replaces persistent flapping proxies (>= 3 failures in 24h) via Webshare IP Replacement API.
    Example: bun run scripts/manage-wallets.ts replace-flapping

  sync-env
    Bootstrap / register operator wallet directly from .env configuration.

  wizard-account <id> <label> <proxyUrl> [credentialRef] [evmAddress] [solanaAddress] [--force]
    1-Click complete setup: tests proxy ping, registers wallet + proxy, and binds Bankr route.
    Example: bun run scripts/manage-wallets.ts wizard-account op2 "Operator 2" http://user:pass@104.28.1.1:8080 env:BANKR_API_KEY_OP2

  import-proxies <filePath> [--prefix <prefix>] [--concurrency <N>] [--skip-ping]
    Bulk import proxies and provision multi-wallet accounts from .txt or .csv file.
    Example: bun run scripts/manage-wallets.ts import-proxies proxies.txt

  test-proxies
    Diagnostic health & latency scanner for all configured proxies against api.bankr.bot.

  recheck-proxies [--auto-failover] [--daemon] [--interval <minutes>] [--concurrency <N>] [--probe-quarantined] [--force]
    Periodic or on-demand health scanner with automatic failover, flapping cooldown guard, and unquarantine probe.
    Example: bun run scripts/manage-wallets.ts recheck-proxies --probe-quarantined --auto-failover

  prune-proxies [--dry-run] [--hard-delete] [--all-dead] [--hours <N>]
    Clean up or quarantine dead proxies failing persistently (> 24h default).
    Automatically fails over any active wallet routes to healthy backups before pruning.
    Example: bun run scripts/manage-wallets.ts prune-proxies --dry-run

  bind-route <walletId> <proxyId> [provider] [--force]
    Bind an existing wallet to an existing proxy configuration with pre-bind health check.
    Example: bun run scripts/manage-wallets.ts bind-route op2 proxy_op2 bankr

  set-treasury <evm|solana> <destinationAddress>
    Set the personal cold wallet address to receive creator fee payouts.
    Example: bun run scripts/manage-wallets.ts set-treasury evm 0x1234567890abcdef1234567890abcdef12345678

  set-webhook <telegram|discord> <webhookUrl>
    Set the community notification webhook URL for automated broadcast cards.
    Example: bun run scripts/manage-wallets.ts set-webhook discord https://discord.com/api/webhooks/...

  add-wallet <id> <label> [evmAddress] [solanaAddress] [credentialRef]
    Register a new wallet account.
    Example: bun run scripts/manage-wallets.ts add-wallet op2 "Backup Operator" 0x123... 5xyz... "env:BANKR_API_KEY_OP2"

  add-proxy <id> <protocol> <host> <port> [username] [password]
    Register a proxy configuration.
    Example: bun run scripts/manage-wallets.ts add-proxy proxy_us http 104.28.1.1 8080 myuser mypass

  set-route <walletId> <provider> <credentialRef> [proxyId]
    Configure a provider route (provider: 'bankr' | 'basedbot').
    Example: bun run scripts/manage-wallets.ts set-route op2 bankr "env:BANKR_API_KEY_OP2" proxy_us

  status <walletId> <ACTIVE|PAUSED|DISABLED>
    Update the operational status of a wallet.
    Example: bun run scripts/manage-wallets.ts status op2 PAUSED
=================================================================
`);
}

async function handleList(): Promise<void> {
  console.log("\n--- WALLET ACCOUNTS ---");
  let wallets = listWalletAccounts();
  if (wallets.length === 0) {
    // Attempt auto-bootstrap from .env
    try {
      bootstrapDefaultWallet();
      wallets = listWalletAccounts();
    } catch {
      // ignore
    }
  }

  if (wallets.length === 0) {
    console.log("No wallet accounts found in vault. Run 'sync-env' to register from .env.");
  } else {
    for (const w of wallets) {
      console.log(`\n[-] ID: ${w.id} [${w.status}] - "${w.label}"`);
      console.log(`  EVM Address    : ${w.evmAddress ?? "N/A"}`);
      console.log(`  Solana Address : ${w.solanaAddress ?? "N/A"}`);

      const resolved = w.credentialRef ? resolveCredential(w.credentialRef) : null;
      const credStatus = w.credentialRef
        ? resolved
          ? `[CONFIGURED: ${w.credentialRef} -> Valid (${resolved.slice(0, 10)}...)]`
          : `[WARNING: ${w.credentialRef} TIDAK DITEMUKAN DI .ENV!]`
        : "None (Menggunakan default .env BANKR_API_KEY)";
      console.log(`  Credential Ref : ${credStatus}`);

      const routes = getAllProviderRoutes(w.id);
      if (routes.length > 0) {
        console.log("  Provider Routes:");
        for (const r of routes) {
          const opCtx = resolveOperationalContext(w.id, r.provider);
          const proxyLabel = r.proxyId ? `via proxy '${r.proxyId}'` : "(Direct)";
          const statusIcon = opCtx.isUsable ? "[READY]" : `[UNUSABLE: ${opCtx.unusableReason ?? "unknown"}]`;
          console.log(`    - ${r.provider.padEnd(8)}: ${statusIcon} ${proxyLabel}`);
        }
      } else {
        console.log("  Provider Routes: None configured.");
      }
    }
  }

  console.log("\n--- PROXY CONFIGURATIONS ---");
  const proxies = listProxyConfigs();
  if (proxies.length === 0) {
    console.log("No proxy configurations found in vault.");
  } else {
    for (const p of proxies) {
      const maskedUrl = buildProxyUrl(p, true);
      const latStr = p.latencyMs != null ? `${p.latencyMs}ms` : "-";
      console.log(`[-] ID: ${p.id.padEnd(16)} [${p.status}/${p.healthStatus.toUpperCase()}] (${latStr}) -> ${maskedUrl}`);
      if (p.status === "DISABLED") {
        const cd = evaluateQuarantineCooldown(p.id);
        if (!cd.isEligible) {
          console.log(`    ⏳ Flapping Cooldown: ${cd.remainingMinutes}m tersisa (Penalti: ${cd.penaltyHours}j | ${cd.recentFailures}x gagal)`);
        } else {
          console.log(`    🩺 Karantina Selesai: Siap dipulihkan (Jalankan 'recheck-proxies --probe-quarantined')`);
        }
      }
    }
  }
  console.log("");
}

async function handleSyncEnv(): Promise<void> {
  try {
    const acc = bootstrapDefaultWallet();
    console.log(`[SUCCESS] Operator wallet synced from .env: '${acc.id}' (${acc.label})`);
    console.log(`  EVM Address    : ${acc.evmAddress ?? "N/A"}`);
    console.log(`  Solana Address : ${acc.solanaAddress ?? "N/A"}`);
    console.log(`  Status         : ${acc.status}`);
  } catch (err: any) {
    console.error(`[ERROR] Failed to sync wallet from .env: ${err?.message || err}`);
  }
}

async function handleAddWallet(): Promise<void> {
  const [, id, label, evmAddress, solanaAddress, credentialRef] = args;
  if (!id || !label) {
    console.error("[ERROR] <id> and <label> are required.");
    console.log("Usage: add-wallet <id> <label> [evmAddress] [solanaAddress] [credentialRef]");
    process.exit(1);
  }

  try {
    const account = registerWalletAccount({
      id: id.trim(),
      label: label.trim(),
      evmAddress: evmAddress?.trim() || undefined,
      solanaAddress: solanaAddress?.trim() || undefined,
      credentialRef: credentialRef?.trim() || undefined,
      status: "ACTIVE",
    });
    console.log(`[SUCCESS] Wallet account registered successfully: '${account.id}' (${account.label})`);
  } catch (err) {
    console.error(`[ERROR] Failed to register wallet account: ${String(err)}`);
    process.exit(1);
  }
}

async function handleAddProxy(): Promise<void> {
  const [, id, protocol, host, portStr, username, password] = args;
  if (!id || !protocol || !host || !portStr) {
    console.error("[ERROR] <id>, <protocol>, <host>, and <port> are required.");
    console.log("Usage: add-proxy <id> <protocol> <host> <port> [username] [password]");
    process.exit(1);
  }

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`[ERROR] Invalid port number: '${portStr}' (must be 1-65535).`);
    process.exit(1);
  }

  if (!["http", "https", "socks5"].includes(protocol.toLowerCase())) {
    console.error(`[ERROR] Invalid protocol: '${protocol}' (must be http, https, or socks5).`);
    process.exit(1);
  }

  try {
    const proxy = registerProxyConfig({
      id: id.trim(),
      protocol: protocol.toLowerCase() as ProxyProtocol,
      host: host.trim(),
      port,
      username: username?.trim() || undefined,
      password: password?.trim() || undefined,
      status: "ACTIVE",
    });
    console.log(`[SUCCESS] Proxy configuration registered successfully: '${proxy.id}' (${buildProxyUrl(proxy, true)})`);
  } catch (err) {
    console.error(`[ERROR] Failed to register proxy config: ${String(err)}`);
    process.exit(1);
  }
}

async function handleSetRoute(): Promise<void> {
  const [, walletId, provider, credentialRef, proxyId] = args;
  if (!walletId || !provider || !credentialRef) {
    console.error("[ERROR] <walletId>, <provider>, and <credentialRef> are required.");
    console.log("Usage: set-route <walletId> <provider> <credentialRef> [proxyId]");
    process.exit(1);
  }

  if (provider !== "bankr" && provider !== "basedbot") {
    console.error(`[ERROR] Invalid provider: '${provider}'. Must be 'bankr' or 'basedbot'.`);
    process.exit(1);
  }

  try {
    const success = setWalletProviderRoute(walletId.trim(), provider as SupportedProvider, {
      credentialRef: credentialRef.trim(),
      proxyId: proxyId?.trim() || null,
      status: "ACTIVE",
    });
    if (success) {
      console.log(`[SUCCESS] Route configured for wallet '${walletId}' on '${provider}'.`);
    } else {
      console.error(`[ERROR] Could not configure route for wallet '${walletId}'.`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`[ERROR] Failed to configure provider route: ${String(err)}`);
    process.exit(1);
  }
}

async function handleStatus(): Promise<void> {
  const [, walletId, status] = args;
  if (!walletId || !status) {
    console.error("[ERROR] <walletId> and <status> are required.");
    console.log("Usage: status <walletId> <ACTIVE|PAUSED|DISABLED>");
    process.exit(1);
  }

  const upper = status.toUpperCase();
  if (!["ACTIVE", "PAUSED", "DISABLED"].includes(upper)) {
    console.error(`[ERROR] Invalid status: '${status}'. Must be ACTIVE, PAUSED, or DISABLED.`);
    process.exit(1);
  }

  const wallet = getWalletAccount(walletId);
  if (!wallet) {
    console.error(`[ERROR] Wallet account '${walletId}' not found.`);
    process.exit(1);
  }

  const success = updateWalletStatus(walletId, upper as WalletStatus);
  if (success) {
    console.log(`[SUCCESS] Status for wallet '${walletId}' updated to: ${upper}`);
  } else {
    console.error(`[ERROR] Failed to update status for wallet '${walletId}'.`);
    process.exit(1);
  }
}

async function getEvmBalance(address: string): Promise<number | null> {
  try {
    const rpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBalance",
        params: [address, "latest"],
      }),
      signal: AbortSignal.timeout(6000),
    });
    const data = (await res.json()) as any;
    if (data?.result) {
      return Number(BigInt(data.result)) / 1e18;
    }
    return null;
  } catch {
    return null;
  }
}

async function getSolanaBalance(address: string): Promise<number | null> {
  try {
    const rpc = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
      signal: AbortSignal.timeout(6000),
    });
    const data = (await res.json()) as any;
    if (data?.result?.value !== undefined) {
      return Number(data.result.value) / 1e9;
    }
    return null;
  } catch {
    return null;
  }
}

function updateEnvVariable(key: string, value: string): void {
  const envPath = path.resolve(process.cwd(), ".env");
  let content = "";
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, "utf-8");
  }
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(envPath, content, "utf-8");
}

async function handleCheckBalance(): Promise<void> {
  console.log("\n=================================================================");
  console.log("  [+] REAL-TIME ON-CHAIN WALLET BALANCES (BASE & SOLANA) [+]");
  console.log("=================================================================");

  let wallets = listWalletAccounts();
  if (wallets.length === 0) {
    try {
      bootstrapDefaultWallet();
      wallets = listWalletAccounts();
    } catch {
      // ignore
    }
  }

  if (wallets.length === 0) {
    console.log("No wallet accounts found in vault.");
    return;
  }

  const alertFlag = args.includes("--alert") || args.includes("--broadcast");
  const allWalletsFlag = args.includes("--all");
  let minEth = 0.055;
  let minSol = 0.06;

  const minEthIdx = args.indexOf("--min-eth");
  if (minEthIdx !== -1 && args[minEthIdx + 1]) {
    const parsed = parseFloat(args[minEthIdx + 1]);
    if (!isNaN(parsed) && parsed >= 0) minEth = parsed;
  }

  const minSolIdx = args.indexOf("--min-sol");
  if (minSolIdx !== -1 && args[minSolIdx + 1]) {
    const parsed = parseFloat(args[minSolIdx + 1]);
    if (!isNaN(parsed) && parsed >= 0) minSol = parsed;
  }

  console.log(`\nMemindai saldo on-chain via preflight RPC engine (Ambang: ${minEth} ETH / ${minSol} SOL)...\n`);

  const report = await scanAllWalletBalances({
    minEth,
    minSol,
    wallets,
    onlyActive: !allWalletsFlag,
  });

  for (const ev of report.evaluations) {
    const statusBadge = ev.isStarving ? "[DEFISIT]" : "[CUKUP]";
    console.log(`[-] ID: ${ev.walletId.padEnd(16)} [${ev.status}] ${statusBadge} - "${ev.label}"`);

    if (ev.evmAddress) {
      const balStr = ev.evmBalance !== null ? `${ev.evmBalance.toFixed(6)} ETH` : "Gagal memindai (RPC Timeout / Error)";
      const suffBadge = ev.evmSufficient ? "OK" : `DEFISIT (-${ev.deficitEth.toFixed(6)} ETH)`;
      console.log(`    Base L2 (EVM)  : ${ev.evmAddress}`);
      console.log(`    Saldo Native   : ${balStr} [${suffBadge}]`);
    } else {
      console.log(`    Base L2 (EVM)  : Tidak dikonfigurasi`);
    }

    if (ev.solanaAddress) {
      const balSolStr = ev.solanaBalance !== null ? `${ev.solanaBalance.toFixed(6)} SOL` : "Gagal memindai (RPC Timeout / Error)";
      const suffSolBadge = ev.solanaSufficient ? "OK" : `DEFISIT (-${ev.deficitSol.toFixed(6)} SOL)`;
      console.log(`    Solana         : ${ev.solanaAddress}`);
      console.log(`    Saldo Native   : ${balSolStr} [${suffSolBadge}]`);
    } else {
      console.log(`    Solana         : Tidak dikonfigurasi`);
    }

    if (ev.isStarving) {
      for (const r of ev.starvingReasons) {
        console.log(`    ⚠️  Peringatan   : ${r}`);
      }
    }
    console.log("");
  }

  console.log(`Ringkasan: ${report.totalScanned} dompet dipindai | ${report.healthyCount} sehat | ${report.starvingCount} defisit saldo.`);

  if (alertFlag) {
    if (report.starvingCount > 0) {
      console.log("\n📡 Mengirimkan kartu notifikasi saldo kritis via Telegram & Discord...");
      const alertWallets = [];
      for (const sw of report.starvingWallets) {
        if (!sw.evmSufficient && sw.evmAddress) {
          alertWallets.push({
            id: sw.walletId,
            label: sw.label,
            chain: "base",
            address: sw.evmAddress,
            actualBalance: sw.evmBalance,
            requiredBalance: minEth,
            deficit: sw.deficitEth,
          });
        }
        if (!sw.solanaSufficient && sw.solanaAddress) {
          alertWallets.push({
            id: sw.walletId,
            label: sw.label,
            chain: "solana",
            address: sw.solanaAddress,
            actualBalance: sw.solanaBalance,
            requiredBalance: minSol,
            deficit: sw.deficitSol,
          });
        }
      }

      await broadcastLowBalanceAlert({
        title: `Peringatan: ${report.starvingCount} Dompet Operator Mengalami Defisit Saldo Gas!`,
        wallets: alertWallets,
        totalStarving: report.starvingCount,
      });
      console.log("✅ [BROADCASTER] Notifikasi siaran saldo rendah telah dikirimkan.");
    } else {
      console.log("ℹ️  Semua saldo dompet operator mencukupi ambang batas. Tidak ada alert yang perlu dikirim.");
    }
  }

  // Display treasury destination address status
  const evmTreasury = process.env.TREASURY_EVM_DESTINATION;
  const solTreasury = process.env.TREASURY_SOLANA_DESTINATION;

  console.log("-----------------------------------------------------------------");
  console.log("  [+] TUJUAN KAS / TREASURY (COLD STORAGE) [+]");
  console.log("-----------------------------------------------------------------");
  if (evmTreasury) {
    const bal = await getEvmBalance(evmTreasury);
    const balStr = bal !== null ? `${bal.toFixed(6)} ETH` : "Gagal memindai (RPC Timeout)";
    console.log(`  EVM Destination    : ${evmTreasury}`);
    console.log(`  Saldo Kas EVM      : ${balStr}`);
  } else {
    console.log(`  EVM Destination    : (Default Operator Wallet)`);
  }

  if (solTreasury) {
    const balSol = await getSolanaBalance(solTreasury);
    const balSolStr = balSol !== null ? `${balSol.toFixed(6)} SOL` : "Gagal memindai (RPC Timeout)";
    console.log(`  Solana Destination : ${solTreasury}`);
    console.log(`  Saldo Kas Solana   : ${balSolStr}`);
  } else {
    console.log(`  Solana Destination : (Default Operator Wallet)`);
  }
  console.log("=================================================================\n");
}

async function handleSyncWebshare(): Promise<void> {
  console.log("\n=================================================================");
  console.log("  [+] WEBSHARE PROXY API DYNAMIC SYNCHRONIZATION [+]");
  console.log("=================================================================");

  let apiKey: string | undefined = undefined;
  const keyIdx = args.indexOf("--api-key");
  if (keyIdx !== -1 && args[keyIdx + 1]) {
    apiKey = args[keyIdx + 1].trim();
  }

  const replaceDead = args.includes("--replace-dead");
  const noPing = args.includes("--no-ping");
  const autoBind = args.includes("--auto-bind");
  const broadcast = args.includes("--broadcast");

  let pageSize = 25;
  const limitIdx = args.indexOf("--limit");
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    const parsed = parseInt(args[limitIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) pageSize = parsed;
  }

  console.log("Menghubungi Webshare API v2 untuk sinkronisasi proxy...");
  const result = await syncWebshareProxiesToVault({
    apiKey,
    replaceDead,
    testPings: !noPing,
    autoBind,
    broadcast,
    pageSize,
  });

  if (!result.success) {
    console.error(`\n[ERROR] Sinkronisasi Webshare gagal:`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    console.log("\nPetunjuk: Pastikan WEBSHARE_API_KEY disetel di .env atau sertakan flag --api-key <TOKEN>.");
    return;
  }

  console.log(`\n[SUCCESS] Sinkronisasi Webshare Berhasil Selesai!`);
  console.log(`  Total dari API       : ${result.totalFetched}`);
  console.log(`  Berhasil diimpor/sync: ${result.importedCount}`);
  console.log(`  Proxy Sehat & Aktif  : ${result.healthyCount}`);
  console.log(`  Proxy Bermasalah     : ${result.unhealthyCount}`);
  console.log(`  Rute Terikat Otomatis: ${result.boundCount}`);

  if (result.errors.length > 0) {
    console.log(`\n  Catatan Kesalahan:`);
    for (const err of result.errors) {
      console.log(`  - ${err}`);
    }
  }
}

async function handleRebalance(): Promise<void> {
  console.log("\n=================================================================");
  console.log("  [+] AUTONOMOUS MULTI-ACCOUNT BALANCE REBALANCER [+]");
  console.log("=================================================================");

  const dryRun = args.includes("--dry-run");
  const broadcast = args.includes("--broadcast");

  let chain: "all" | "base" | "solana" = "all";
  const chainIdx = args.indexOf("--chain");
  if (chainIdx !== -1 && args[chainIdx + 1]) {
    const c = args[chainIdx + 1].toLowerCase();
    if (c === "base" || c === "solana" || c === "all") {
      chain = c;
    }
  }

  let minEth: number | undefined;
  const ethIdx = args.indexOf("--min-eth");
  if (ethIdx !== -1 && args[ethIdx + 1]) {
    const val = parseFloat(args[ethIdx + 1]);
    if (!isNaN(val) && val >= 0) minEth = val;
  }

  let minSol: number | undefined;
  const solIdx = args.indexOf("--min-sol");
  if (solIdx !== -1 && args[solIdx + 1]) {
    const val = parseFloat(args[solIdx + 1]);
    if (!isNaN(val) && val >= 0) minSol = val;
  }

  let maxEth: number | undefined;
  const maxEthIdx = args.indexOf("--max-eth");
  if (maxEthIdx !== -1 && args[maxEthIdx + 1]) {
    const val = parseFloat(args[maxEthIdx + 1]);
    if (!isNaN(val) && val > 0) maxEth = val;
  }

  let maxSol: number | undefined;
  const maxSolIdx = args.indexOf("--max-sol");
  if (maxSolIdx !== -1 && args[maxSolIdx + 1]) {
    const val = parseFloat(args[maxSolIdx + 1]);
    if (!isNaN(val) && val > 0) maxSol = val;
  }

  console.log(`Target Rantai      : ${chain.toUpperCase()}`);
  console.log(`Mode Operasi       : ${dryRun ? "🧪 SIMULASI (DRY-RUN)" : "⚡ EKSEKUSI ON-CHAIN"}`);
  console.log(`Min Ambang ETH     : ${minEth ?? 0.055} ETH`);
  console.log(`Min Ambang SOL     : ${minSol ?? 0.06} SOL`);
  console.log("Memindai saldo seluruh akun dan mengevaluasi defisit...");

  const report = await rebalanceOperatorBalances({
    chain,
    dryRun,
    targetMinEth: minEth,
    targetMinSol: minSol,
    maxTopUpEthPerWallet: maxEth,
    maxTopUpSolPerWallet: maxSol,
    broadcast,
  });

  console.log(`\n=================================================================`);
  console.log(`  HASIL REBALANCE SALDO OPERATOR`);
  console.log(`=================================================================`);
  console.log(`  Total Akun Defisit   : ${report.totalStarvingWallets}`);
  console.log(`  Total Top-Up Berhasil: ${report.totalRebalanced}`);
  console.log(`  Total Dilewati       : ${report.totalSkipped}`);
  console.log(`  Total Gagal          : ${report.totalFailed}`);
  console.log(`  Total ETH Disalurkan : ${report.totalEthTransferred.toFixed(6)} ETH`);
  console.log(`  Total SOL Disalurkan : ${report.totalSolTransferred.toFixed(6)} SOL`);
  if (report.masterRemainingEth !== undefined) {
    console.log(`  Sisa Saldo Master ETH: ${report.masterRemainingEth.toFixed(6)} ETH`);
  }
  if (report.masterRemainingSol !== undefined) {
    console.log(`  Sisa Saldo Master SOL: ${report.masterRemainingSol.toFixed(6)} SOL`);
  }

  if (report.transfers.length > 0) {
    console.log(`\n  Rincian Transfer:`);
    for (const t of report.transfers) {
      const statusIcon =
        t.status === "success" || t.status === "simulated"
          ? "✅"
          : t.status === "skipped"
          ? "⏸️"
          : "❌";
      const txInfo = t.txHash ? ` [tx: ${t.txHash}]` : "";
      const errInfo = t.errorReason ? ` (Alasan: ${t.errorReason})` : "";
      console.log(
        `   ${statusIcon} [${t.chain.toUpperCase()}] ${t.walletId} (${t.label}) -> ${t.amount.toFixed(6)} ${t.currency}${txInfo}${errInfo}`
      );
    }
  }

  if (report.warnings.length > 0) {
    console.log(`\n  Peringatan Sistem:`);
    for (const w of report.warnings) {
      console.log(`   ⚠️  ${w}`);
    }
  }
  console.log(`=================================================================\n`);
}

async function handleReplaceFlapping(): Promise<void> {
  console.log("\n=================================================================");
  console.log("  [+] WEBSHARE FLAPPING PROXY AUTO-REPLACEMENT [+]");
  console.log("=================================================================");

  let apiKey: string | undefined = undefined;
  const keyIdx = args.indexOf("--api-key");
  if (keyIdx !== -1 && args[keyIdx + 1]) {
    apiKey = args[keyIdx + 1].trim();
  }

  const forceAllDisabled = args.includes("--force");
  const broadcast = args.includes("--broadcast");

  console.log("Memindai proxy yang mengalami flapping (>= 3 kegagalan dalam 24 jam)...");
  const result = await autoReplaceFlappingWebshareProxies({
    apiKey,
    forceAllDisabled,
    broadcast,
  });

  console.log(`\n=================================================================`);
  console.log(`  HASIL REPLACEMENT PROXY FLAPPING`);
  console.log(`=================================================================`);
  console.log(`  Total Dipindai      : ${result.totalScanned}`);
  console.log(`  Proxy Flapping      : ${result.flappingCount}`);
  console.log(`  Berhasil Diganti    : ${result.replacedCount}`);
  console.log(`  Gagal Diganti       : ${result.failedCount}`);

  if (result.results.length > 0) {
    console.log(`\n  Rincian Rotasi IP:`);
    for (const r of result.results) {
      if (r.success) {
        console.log(`   ✅ ${r.proxyId}: ${r.oldHost} -> ${r.newHost}:${r.newPort} [${r.healthStatus}]`);
      } else {
        console.log(`   ❌ ${r.proxyId}: ${r.oldHost} (Error: ${r.error})`);
      }
    }
  } else {
    console.log(`\n  ✅ Tidak ada proxy Webshare yang mengalami flapping.`);
  }

  if (result.errors.length > 0) {
    console.log(`\n  Catatan Kesalahan:`);
    for (const err of result.errors) {
      console.log(`   ⚠️  ${err}`);
    }
  }
  console.log(`=================================================================\n`);
}

async function handleSetTreasury(): Promise<void> {
  const [, chainArg, destinationAddress] = args;
  if (!chainArg || !destinationAddress) {
    console.error("[ERROR] <chain> and <destinationAddress> are required.");
    console.log("Usage: set-treasury <evm|solana> <destinationAddress>");
    console.log("Example: set-treasury evm 0x946657d17c7e83052d50634d9da6ff3fc46b418a");
    process.exit(1);
  }

  const chain = chainArg.toLowerCase().trim();
  if (chain !== "evm" && chain !== "base" && chain !== "ethereum" && chain !== "solana") {
    console.error(`[ERROR] Invalid chain: '${chainArg}'. Supported: 'evm' or 'solana'.`);
    process.exit(1);
  }

  const targetChain = chain === "solana" ? "solana" : "evm";
  const isValid = isValidDestinationAddress(destinationAddress, targetChain);
  if (!isValid) {
    console.error(`[ERROR] Invalid ${targetChain.toUpperCase()} address format: '${destinationAddress}'`);
    process.exit(1);
  }

  const envKey = targetChain === "solana" ? "TREASURY_SOLANA_DESTINATION" : "TREASURY_EVM_DESTINATION";
  updateEnvVariable(envKey, destinationAddress.trim());

  console.log(`\n=================================================================`);
  console.log(`[SUCCESS] Alamat Treasury ${targetChain.toUpperCase()} berhasil diperbarui!`);
  console.log(`  Target Key : ${envKey}`);
  console.log(`  Alamat Baru: ${destinationAddress.trim()}`);
  console.log(`  Semua hasil klaim fee creator 95% akan diarahkan ke alamat ini.`);
  console.log(`=================================================================\n`);
}

async function handleSetWebhook(): Promise<void> {
  const [, platformArg, webhookUrl] = args;
  if (!platformArg || !webhookUrl) {
    console.error("[ERROR] <platform> and <webhookUrl> are required.");
    console.log("Usage: set-webhook <telegram|discord> <webhookUrl>");
    console.log("Example: set-webhook discord https://discord.com/api/webhooks/123/xyz");
    console.log("Example: set-webhook telegram https://api.telegram.org/bot123:ABC/sendMessage?chat_id=-100xyz");
    process.exit(1);
  }

  const platform = platformArg.toLowerCase().trim();
  if (platform !== "telegram" && platform !== "discord") {
    console.error(`[ERROR] Invalid platform: '${platformArg}'. Supported: 'telegram' or 'discord'.`);
    process.exit(1);
  }

  const url = webhookUrl.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    console.error(`[ERROR] Invalid URL format: '${webhookUrl}'. Must begin with http:// or https://.`);
    process.exit(1);
  }

  const envKey = platform === "telegram" ? "COMMUNITY_TELEGRAM_WEBHOOK" : "COMMUNITY_DISCORD_WEBHOOK";
  updateEnvVariable(envKey, url);

  console.log(`\n=================================================================`);
  console.log(`[SUCCESS] Webhook Komunitas (${platform.toUpperCase()}) berhasil disetel!`);
  console.log(`  Target Key : ${envKey}`);
  console.log(`  Webhook URL: ${url.slice(0, 35)}... (tersimpan aman di .env)`);
  console.log(`  Kartu bukti Buyback/Burn Beacon akan otomatis disiarkan ke sini.`);
  console.log(`=================================================================\n`);
}

export {
  getEvmBalance,
  getSolanaBalance,
  updateEnvVariable,
  pingProxyEndpoint,
  executeBindRouteWithHealthCheck,
  parseUniversalProxy,
  handleInteractiveWizard,
  parseBulkProxyContent,
  executeBulkProxyImport,
  autoFailoverUnhealthyRoutes,
  recheckProxyHealth,
  parseRecheckArgs,
  pruneDeadProxies,
  deleteProxyConfig,
  broadcastProxyAlert,
  evaluateQuarantineCooldown,
  probeAndResupplyQuarantinedPool,
  type BulkProxyItem,
  type BulkImportOptions,
  type BulkImportSummary,
  type BulkImportResultEntry,
  type AutoFailoverDetail,
  type AutoFailoverResult,
  type RecheckSummary,
  type RecheckCliOptions,
  type RecheckOptions,
  type PruneOptions,
  type PruneDetail,
  type PruneResult,
  type ProxyAlertParams,
  type ProxyPingResult,
  type QuarantineCooldownReport,
  type PoolResupplyOptions,
  type PoolResupplyResult,
};

export interface BulkProxyItem {
  rawProxy: string;
  id?: string;
  label?: string;
  credentialRef?: string;
  evmAddress?: string;
  solanaAddress?: string;
  lineNumber?: number;
}

export interface BulkImportOptions {
  prefix?: string;
  concurrency?: number;
  skipPing?: boolean;
  defaultKey?: string;
  timeoutMs?: number;
}

export interface BulkImportResultEntry {
  lineNumber?: number;
  id: string;
  label: string;
  host: string;
  port: number;
  protocol: string;
  healthStatus: ProxyHealthStatus;
  latencyMs: number;
  status: "REGISTERED" | "FAILED" | "SKIPPED";
  message: string;
}

export interface BulkImportSummary {
  totalParsed: number;
  totalRegistered: number;
  totalFailed: number;
  totalSkipped: number;
  durationMs: number;
  entries: BulkImportResultEntry[];
}

export interface PruneOptions {
  quarantineHours?: number;
  hardDelete?: boolean;
  dryRun?: boolean;
  allDead?: boolean;
}

export interface PruneDetail {
  proxyId: string;
  host: string;
  port: number;
  healthStatus: string;
  hoursSinceCheck: number | null;
  action: "QUARANTINED" | "DELETED" | "DRY_RUN_QUARANTINE" | "DRY_RUN_DELETE" | "SKIPPED";
  routeFailoverExecuted?: boolean;
  reason: string;
}

export interface PruneResult {
  totalScanned: number;
  deadDetected: number;
  quarantinedCount: number;
  deletedCount: number;
  dryRunCount: number;
  routesProtected: number;
  details: PruneDetail[];
}

export interface RecheckSummary {
  totalProxies: number;
  availableCount: number;
  unavailableCount: number;
  timeoutCount: number;
  authErrorCount: number;
  unquarantinedCount?: number;
  unquarantinedDetails?: string[];
  durationMs: number;
}

export interface RecheckCliOptions {
  autoFailover: boolean;
  isDaemon: boolean;
  intervalMinutes: number;
  concurrency: number;
  probeQuarantined: boolean;
  forceUnquarantine: boolean;
}

export interface RecheckOptions {
  concurrency?: number;
  timeoutMs?: number;
  probeQuarantined?: boolean;
  forceUnquarantine?: boolean;
  onProgress?: (index: number, total: number, proxyId: string, result: ProxyPingResult) => void;
}


/**
 * Prompts user for interactive terminal input.
 */
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

/**
 * Universal Proxy Parser & Normalizer.
 * Supports:
 *   1. host:port:user:pass (Webshare / vendor export standard)
 *   2. host:port (unauthenticated open proxy)
 *   3. user:pass@host:port (unprefixed URL)
 *   4. http://user:pass@host:port, https://..., socks5://...
 */
function parseUniversalProxy(
  input: string,
  defaultProtocol: "http" | "socks5" = "http"
): {
  protocol: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
  proxyUrl: string;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Proxy input tidak boleh kosong.");
  }

  // Format 1: host:port:user:pass
  const colonParts = trimmed.split(":");
  if (colonParts.length === 4 && !trimmed.includes("://") && !trimmed.includes("@")) {
    const [host, portStr, user, pass] = colonParts;
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return {
        protocol: defaultProtocol,
        host,
        port,
        username: user,
        password: pass,
        proxyUrl: `${defaultProtocol}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`,
      };
    }
  }

  // Format 2: host:port
  if (colonParts.length === 2 && !trimmed.includes("://") && !trimmed.includes("@")) {
    const [host, portStr] = colonParts;
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) {
      return {
        protocol: defaultProtocol,
        host,
        port,
        proxyUrl: `${defaultProtocol}://${host}:${port}`,
      };
    }
  }

  // Format 3: user:pass@host:port
  if (!trimmed.includes("://") && trimmed.includes("@")) {
    return parseUniversalProxy(`${defaultProtocol}://${trimmed}`, defaultProtocol);
  }

  // Format 4: URL with protocol
  let normalized = trimmed;
  if (!normalized.includes("://")) {
    normalized = `${defaultProtocol}://${normalized}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch (err: any) {
    throw new Error(`Format proxy tidak valid: '${trimmed}' (${err?.message || err})`);
  }

  const protocol = parsed.protocol.replace(":", "").toLowerCase() as "http" | "https" | "socks5";
  if (!["http", "https", "socks5"].includes(protocol)) {
    throw new Error(`Protokol proxy '${protocol}' tidak didukung. Gunakan http, https, atau socks5.`);
  }

  const host = parsed.hostname;
  const port = parsed.port ? parseInt(parsed.port, 10) : protocol === "https" ? 443 : 80;
  const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

  let proxyUrl = `${protocol}://`;
  if (username && password) {
    proxyUrl += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
  } else if (username) {
    proxyUrl += `${encodeURIComponent(username)}@`;
  }
  proxyUrl += `${host}:${port}`;

  return { protocol, host, port, username, password, proxyUrl };
}

async function handleWizardAccount(): Promise<void> {
  const force = args.includes("--force") || args.includes("--skip-ping");
  const positional = args.filter((a) => !a.startsWith("--"));
  const [, id, label, proxyUrl, credentialRef, evmAddress, solanaAddress] = positional;
  if (!id || !label || !proxyUrl) {
    console.error("[ERROR] <id>, <label>, dan <proxyUrl> wajib diisi.");
    console.log(
      "Usage: wizard-account <id> <label> <proxyUrl> [credentialRef] [evmAddress] [solanaAddress] [--force]"
    );
    console.log("Contoh:");
    console.log(
      '  bun run scripts/manage-wallets.ts wizard-account op2 "Operator 2" http://user:pass@104.28.1.1:8080 env:BANKR_API_KEY_OP2'
    );
    process.exit(1);
  }

  // Handle raw API key if passed directly
  let effectiveCredentialRef = credentialRef ? credentialRef.trim() : undefined;
  if (
    effectiveCredentialRef &&
    (effectiveCredentialRef.startsWith("bk_") ||
      (effectiveCredentialRef.length > 20 && !effectiveCredentialRef.startsWith("env:")))
  ) {
    const cleanKeyName = `BANKR_API_KEY_${id.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
    writeKeyToEnv(cleanKeyName, effectiveCredentialRef);
    effectiveCredentialRef = `env:${cleanKeyName}`;
    console.log(`[*] API key mentah otomatis disimpan ke .env sebagai '${cleanKeyName}'`);
  }

  console.log(`\n=================================================================`);
  console.log(`  [+] WIZARD MULTI-ACCOUNT & PROXY ORCHESTRATION [+]`);
  console.log(`=================================================================`);
  console.log(`  Target ID      : ${id.trim()}`);
  console.log(`  Label          : ${label.trim()}`);
  console.log(`  Proxy URL      : ${proxyUrl.trim().replace(/:([^:@]+)@/, ":****@")}`);
  console.log(
    `  Credential Ref : ${effectiveCredentialRef ? effectiveCredentialRef : "None (Fallback Global)"}`
  );
  console.log(`  EVM Address    : ${evmAddress ? evmAddress.trim() : "N/A"}`);
  console.log(`  Solana Address : ${solanaAddress ? solanaAddress.trim() : "N/A"}`);

  // 1. Parse Proxy URL via Universal Parser
  let parsed: ReturnType<typeof parseUniversalProxy>;
  try {
    parsed = parseUniversalProxy(proxyUrl.trim());
  } catch (err: any) {
    console.error(`\n[ERROR] Format proxy URL tidak valid: '${proxyUrl}'. ${err?.message || err}`);
    process.exit(1);
  }

  const { protocol, host, port, username, password } = parsed;
  const proxyId = `proxy_${id.trim().replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  // 2. Preflight Ping Test
  let pingRes: ProxyPingResult = {
    reachable: true,
    latencyMs: 0,
    healthStatus: "available",
    message: "Preflight dilewati (--force)",
  };

  if (!force) {
    console.log(`\n[*] Menjalankan uji preflight ping ke server api.bankr.bot via proxy...`);
    const resolvedApiKey = effectiveCredentialRef
      ? resolveCredential(effectiveCredentialRef)
      : process.env.BANKR_API_KEY;
    pingRes = await pingProxyEndpoint(
      { protocol, host, port, username, password },
      resolvedApiKey,
      15000
    );

    if (!pingRes.reachable) {
      console.error(`\n[GAGAL] Uji preflight proxy tidak berhasil!`);
      console.error(`  Penyebab : ${pingRes.message}`);
      console.error(`  Health   : ${pingRes.healthStatus.toUpperCase()}`);
      console.error(`\nPendaftaran dibatalkan untuk mencegah route macet saat live deploy.`);
      console.error(`Gunakan flag '--force' jika Anda yakin proxy ini valid dan tetap ingin mendaftarkannya.`);
      process.exit(1);
    }

    console.log(`[OK] Preflight berhasil! Latensi: ${pingRes.latencyMs} ms | Status: ${pingRes.message}`);
  }

  // 3. Simpan Proxy ke Vault
  try {
    const existingProxy = getProxyConfig(proxyId);
    if (!existingProxy) {
      registerProxyConfig({
        id: proxyId,
        protocol: protocol as ProxyProtocol,
        host,
        port,
        username,
        password,
        status: "ACTIVE",
        healthStatus: pingRes.healthStatus,
      });
      if (pingRes.latencyMs > 0) {
        updateProxyStatus(proxyId, "ACTIVE", pingRes.healthStatus, pingRes.latencyMs);
      }
      console.log(`\n[1/3] Proxy Config tersimpan: '${proxyId}' [${pingRes.healthStatus}]`);
    } else {
      updateProxyDetails(proxyId, {
        protocol: protocol as ProxyProtocol,
        host,
        port,
        username,
        password,
        status: "ACTIVE",
        healthStatus: pingRes.healthStatus,
        latencyMs: pingRes.latencyMs > 0 ? pingRes.latencyMs : null,
      });
      console.log(
        `\n[1/3] Proxy Config '${proxyId}' sudah ada, rincian koneksi & status diperbarui [${pingRes.healthStatus}]`
      );
    }
  } catch (err: any) {
    console.error(`[ERROR] Gagal mendaftarkan proxy: ${err?.message || err}`);
    process.exit(1);
  }

  // 4. Simpan Wallet Account ke Vault
  try {
    const existingWallet = getWalletAccount(id.trim());
    if (!existingWallet) {
      registerWalletAccount({
        id: id.trim(),
        label: label.trim(),
        evmAddress: evmAddress?.trim() || undefined,
        solanaAddress: solanaAddress?.trim() || undefined,
        credentialRef: effectiveCredentialRef?.trim() || undefined,
        status: "ACTIVE",
      });
      console.log(`[2/3] Wallet Account tersimpan: '${id.trim()}' [ACTIVE]`);
    } else {
      console.log(`[2/3] Wallet Account '${id.trim()}' sudah terdaftar [ACTIVE], memperbarui route...`);
    }
  } catch (err: any) {
    console.error(`[ERROR] Gagal mendaftarkan wallet: ${err?.message || err}`);
    process.exit(1);
  }

  // 5. Konfigurasi Provider Route (1 Akun = 1 Dedicated Proxy)
  try {
    setWalletProviderRoute(id.trim(), "bankr", {
      credentialRef: effectiveCredentialRef?.trim() || undefined,
      proxyId,
      status: "ACTIVE",
    });
    setWalletProviderRoute(id.trim(), "basedbot", {
      credentialRef: "env:TELEGRAM_BOT_TOKEN",
      proxyId: null,
      status: "ACTIVE",
    });
    console.log(`[3/3] Provider Route terhubung: '${id.trim()}' -> Bankr via '${proxyId}'`);
  } catch (err: any) {
    console.error(`[ERROR] Gagal menyetel route: ${err?.message || err}`);
    process.exit(1);
  }

  console.log(`\n=================================================================`);
  console.log(`[BERHASIL] Setup 1 Akun Bankr + 1 Dedicated Proxy Selesai!`);
  console.log(`  Akun       : ${id.trim()} ("${label.trim()}")`);
  console.log(
    `  Proxy Rute : ${protocol}://${host}:${port} (${pingRes.latencyMs > 0 ? pingRes.latencyMs + " ms" : "OK"})`
  );
  console.log(
    `  Bankr Key  : ${effectiveCredentialRef ? effectiveCredentialRef.trim() : "Default .env"}`
  );
  console.log(`  Status     : 100% SIAP DIGUNAKAN UNTUK DEPLOY ON-CHAIN (Round-Robin Ready)`);
  console.log(`=================================================================\n`);
}

async function handleInteractiveWizard(): Promise<void> {
  console.log(`\n=================================================================`);
  console.log(`  [+] WIZARD SETUP: 1 AKUN BANKR + 1 DEDICATED PROXY [+]`);
  console.log(`=================================================================`);
  console.log(`  Panduan interaktif pendaftaran akun Bankr baru, validasi proxy,`);
  console.log(`  auto-simpan API key ke .env, dan integrasi ke rotasi otomatis.\n`);

  const existingWallets = listWalletAccounts();
  const nextNum = existingWallets.length + 1;
  const defaultId = `bankr-acc-${nextNum}`;
  const defaultLabel = `Bankr Operator #${nextNum}`;

  // 1. Identitas Akun
  const inputId = await promptInput(`[1/4] ID Akun [Default: ${defaultId}]: `);
  const id = (inputId || defaultId).trim();

  const inputLabel = await promptInput(`     Label Akun [Default: ${defaultLabel}]: `);
  const label = (inputLabel || defaultLabel).trim();

  // 2. Proxy Input (Universal Format)
  let parsedProxy: ReturnType<typeof parseUniversalProxy> | null = null;
  while (!parsedProxy) {
    console.log(`\n[2/4] Konfigurasi Proxy Dedicated:`);
    console.log(`     (Dukung format: host:port:user:pass ATAU http://user:pass@host:port)`);
    const rawProxy = await promptInput(`     Proxy: `);
    if (!rawProxy) {
      console.log(`     [!] Proxy wajib diisi untuk multi-akun agar IP operator terisolasi.`);
      continue;
    }
    try {
      parsedProxy = parseUniversalProxy(rawProxy);
      console.log(
        `     [OK] Proxy terdeteksi: ${parsedProxy.protocol}://${parsedProxy.host}:${parsedProxy.port} (User: ${parsedProxy.username || "none"})`
      );
    } catch (err: any) {
      console.log(`     [GAGAL] ${err?.message || err}. Silakan ulangi.`);
    }
  }

  // 3. Preflight Ping Test
  console.log(`\n[*] Menjalankan uji preflight ping ke server api.bankr.bot via proxy...`);
  const pingRes = await pingProxyEndpoint(
    {
      protocol: parsedProxy.protocol,
      host: parsedProxy.host,
      port: parsedProxy.port,
      username: parsedProxy.username,
      password: parsedProxy.password,
    },
    undefined,
    15000
  );

  if (!pingRes.reachable) {
    console.log(`\n⚠️  [PERINGATAN] Proxy tidak merespons atau terblokir Cloudflare WAF: ${pingRes.message}`);
    const proceedAnyway = await promptInput(`   Tetap lanjutkan pendaftaran? (y/N): `);
    if (proceedAnyway.toLowerCase() !== "y") {
      console.log(`   Pendaftaran dibatalkan.`);
      return;
    }
  } else {
    console.log(`   [OK] Proxy Sehat! Latensi: ${pingRes.latencyMs} ms | Bebas Cloudflare WAF.`);
  }

  // 4. API Key Handling
  console.log(`\n[3/4] BANKR_API_KEY untuk akun '${id}':`);
  console.log(
    `     (Paste langsung bk_usr_... untuk auto-save ke .env, atau Enter untuk gunakan key default .env)`
  );
  const rawKey = await promptInput(`     API Key: `);

  let credentialRef: string | undefined;
  if (rawKey && (rawKey.startsWith("bk_") || (rawKey.length > 20 && !rawKey.startsWith("env:")))) {
    const cleanKeyName = `BANKR_API_KEY_${id.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
    console.log(`     [*] Menguji validitas API key ke server Bankr via proxy...`);
    try {
      const keyVerif = await verifyBankrApiKey(rawKey);
      if (keyVerif.valid) {
        console.log(`     [OK] API Key Valid & Terverifikasi!`);
      } else {
        console.log(`     [!] Catatan verifikasi API key: ${keyVerif.error || "Status " + keyVerif.status}`);
      }
    } catch {
      // non-blocking
    }
    console.log(`     [*] Menyimpan ${cleanKeyName} secara otomatis ke file .env...`);
    writeKeyToEnv(cleanKeyName, rawKey);
    credentialRef = `env:${cleanKeyName}`;
    console.log(`     [OK] Tersimpan di .env & terikat sebagai '${credentialRef}'.`);
  } else if (rawKey && rawKey.startsWith("env:")) {
    credentialRef = rawKey.trim();
  } else {
    credentialRef = "env:BANKR_API_KEY";
    console.log(`     [INFO] Menggunakan fallback key default: env:BANKR_API_KEY.`);
  }

  // 5. Alamat EVM & Solana (Opsional)
  console.log(`\n[4/4] Alamat Wallet On-Chain (Opsional):`);
  const inputEvm = await promptInput(`     Alamat EVM (0x..., tekan Enter jika belum ada): `);
  const evmAddress = inputEvm || undefined;

  const inputSol = await promptInput(`     Alamat Solana (tekan Enter jika kosong): `);
  const solanaAddress = inputSol || undefined;

  // 6. Simpan ke Database Vault
  const proxyId = `proxy_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  try {
    const existingProxy = getProxyConfig(proxyId);
    if (!existingProxy) {
      registerProxyConfig({
        id: proxyId,
        protocol: parsedProxy.protocol,
        host: parsedProxy.host,
        port: parsedProxy.port,
        username: parsedProxy.username,
        password: parsedProxy.password,
        status: "ACTIVE",
        healthStatus: pingRes.healthStatus,
      });
      if (pingRes.latencyMs > 0) {
        updateProxyStatus(proxyId, "ACTIVE", pingRes.healthStatus, pingRes.latencyMs);
      }
    } else {
      updateProxyDetails(proxyId, {
        protocol: parsedProxy.protocol,
        host: parsedProxy.host,
        port: parsedProxy.port,
        username: parsedProxy.username,
        password: parsedProxy.password,
        status: "ACTIVE",
        healthStatus: pingRes.healthStatus,
        latencyMs: pingRes.latencyMs > 0 ? pingRes.latencyMs : null,
      });
    }

    const existingWallet = getWalletAccount(id);
    if (!existingWallet) {
      registerWalletAccount({
        id,
        label,
        evmAddress,
        solanaAddress,
        credentialRef,
        status: "ACTIVE",
      });
    }

    setWalletProviderRoute(id, "bankr", {
      credentialRef,
      proxyId,
      status: "ACTIVE",
    });
    setWalletProviderRoute(id, "basedbot", {
      credentialRef: "env:TELEGRAM_BOT_TOKEN",
      proxyId: null,
      status: "ACTIVE",
    });

    console.log(`\n=================================================================`);
    console.log(`[BERHASIL] Setup Akun '${id}' Selesai!`);
    console.log(`  • ID Akun     : ${id} ("${label}")`);
    console.log(
      `  • Proxy Rute  : ${parsedProxy.protocol}://${parsedProxy.host}:${parsedProxy.port} (${pingRes.latencyMs > 0 ? pingRes.latencyMs + " ms" : "OK"})`
    );
    console.log(`  • Credential  : ${credentialRef}`);
    console.log(`  • Status      : AKTIF & Siap Bergilir di PIPELINE_OTOMATIS (Round-Robin)`);
    console.log(`=================================================================\n`);
  } catch (err: any) {
    console.error(`\n[ERROR] Gagal menyelesaikan setup: ${err?.message || err}`);
  }
}

async function handleTestProxies(): Promise<void> {
  console.log(`\n=================================================================`);
  console.log(`  [+] DIAGNOSTIK KESEHATAN & LATENSI PROXY [+]`);
  console.log(`=================================================================`);
  console.log(`Memindai konektivitas langsung ke server api.bankr.bot...\n`);

  const proxies = listProxyConfigs();
  if (proxies.length === 0) {
    console.log("Tidak ada konfigurasi proxy yang terdaftar di vault SQLite.");
    console.log("Gunakan perintah 'wizard-account' atau 'add-proxy' untuk mendaftarkan proxy.");
    console.log("=================================================================\n");
    return;
  }

  const wallets = listWalletAccounts();
  const proxyToWalletMap = new Map<string, { walletId: string; credentialRef?: string | null }>();
  for (const w of wallets) {
    const routes = getAllProviderRoutes(w.id);
    for (const r of routes) {
      if (r.proxyId) {
        proxyToWalletMap.set(r.proxyId, { walletId: w.id, credentialRef: r.credentialRef });
      }
    }
  }

  console.log(
    "ID PROXY".padEnd(20) +
    "PROTOKOL & HOST".padEnd(30) +
    "STATUS".padEnd(16) +
    "LATENSI".padEnd(12) +
    "KETERANGAN"
  );
  console.log("-".repeat(95));

  for (const p of proxies) {
    const assigned = proxyToWalletMap.get(p.id);
    const resolvedKey = assigned?.credentialRef ? resolveCredential(assigned.credentialRef) : process.env.BANKR_API_KEY;

    const pingRes = await pingProxyEndpoint(p, resolvedKey, 15000);

    // Update status di SQLite
    updateProxyStatus(p.id, p.status, pingRes.healthStatus, pingRes.latencyMs);

    const maskedHost = `${p.protocol}://${p.host}:${p.port}`;
    const statusLabel = `[${pingRes.healthStatus.toUpperCase()}]`;
    const latencyStr = pingRes.latencyMs > 0 ? `${pingRes.latencyMs} ms` : "-";

    console.log(
      p.id.padEnd(20) +
      maskedHost.padEnd(30) +
      statusLabel.padEnd(16) +
      latencyStr.padEnd(12) +
      pingRes.message
    );
  }

  console.log("-----------------------------------------------------------------");
  console.log("Catatan: Status telah diperbarui otomatis ke tabel proxy_configs.");
  console.log("=================================================================\n");
}

async function executeBindRouteWithHealthCheck(
  walletId: string,
  proxyId: string,
  providerArg?: string,
  options?: {
    timeoutMs?: number;
    skipPing?: boolean;
    pingFn?: typeof pingProxyEndpoint;
  }
): Promise<{
  success: boolean;
  error?: string;
  pingResult?: ProxyPingResult;
}> {
  if (!walletId || !walletId.trim()) {
    return { success: false, error: "walletId wajib diisi." };
  }
  if (!proxyId || !proxyId.trim()) {
    return { success: false, error: "proxyId wajib diisi." };
  }

  const provider = (providerArg?.toLowerCase() || "bankr") as SupportedProvider;
  if (provider !== "bankr" && provider !== "basedbot") {
    return {
      success: false,
      error: `Provider '${providerArg}' tidak valid. Gunakan 'bankr' atau 'basedbot'.`,
    };
  }

  // 1. Resolve wallet
  const wallet = getWalletAccount(walletId.trim());
  if (!wallet) {
    return {
      success: false,
      error: `Wallet '${walletId.trim()}' tidak ditemukan di vault.`,
    };
  }

  // 2. Resolve proxy & validate existence
  const proxy = getProxyConfig(proxyId.trim());
  if (!proxy) {
    return {
      success: false,
      error: `Proxy '${proxyId.trim()}' tidak ditemukan di vault.`,
    };
  }

  // 3. Pre-bind health check
  let pingRes: ProxyPingResult = {
    reachable: true,
    latencyMs: 0,
    healthStatus: "available",
    message: "Pre-bind ping dilewati (--force / skipPing)",
  };

  if (!options?.skipPing) {
    const resolvedApiKey = wallet.credentialRef
      ? resolveCredential(wallet.credentialRef)
      : process.env.BANKR_API_KEY;

    const ping = options?.pingFn ?? pingProxyEndpoint;
    pingRes = await ping(
      {
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      },
      resolvedApiKey,
      options?.timeoutMs ?? 15000
    );

    // Update proxy health status and latency in vault
    try {
      updateProxyStatus(
        proxy.id,
        proxy.status,
        pingRes.healthStatus,
        pingRes.latencyMs > 0 ? pingRes.latencyMs : undefined
      );
    } catch {
      // ignore status update error
    }

    // FAIL CLOSED: if not reachable or healthStatus !== "available"
    if (!pingRes.reachable || pingRes.healthStatus !== "available") {
      return {
        success: false,
        error: `Pre-bind health check gagal: Proxy '${proxy.id}' tidak sehat (${pingRes.message} [${pingRes.healthStatus}])`,
        pingResult: pingRes,
      };
    }
  }

  // 4. Safe route mutation (only executed if healthy or skipped)
  try {
    setWalletProviderRoute(wallet.id, provider, {
      credentialRef: wallet.credentialRef ?? undefined,
      proxyId: proxy.id,
      status: "ACTIVE",
    });

    return {
      success: true,
      pingResult: pingRes,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Gagal menghubungkan rute: ${err?.message || err}`,
      pingResult: pingRes,
    };
  }
}

async function handleBindRoute(): Promise<void> {
  const force = args.includes("--force") || args.includes("--skip-ping");
  const positional = args.filter((a) => !a.startsWith("--"));
  const [, walletId, proxyId, providerArg] = positional;

  if (!walletId || !proxyId) {
    console.error("[ERROR] <walletId> dan <proxyId> wajib diisi.");
    console.log("Usage: bind-route <walletId> <proxyId> [provider] [--force]");
    console.log("Contoh: bind-route default-operator proxy_us bankr");
    process.exit(1);
  }

  console.log(`\n=================================================================`);
  console.log(`  [+] BIND ROUTE DENGAN PRE-BIND PROXY HEALTH CHECK [+]`);
  console.log(`=================================================================`);
  console.log(`  Target Wallet : ${walletId.trim()}`);
  console.log(`  Target Proxy  : ${proxyId.trim()}`);
  console.log(`  Provider      : ${providerArg?.trim() || "bankr"}`);
  console.log(`  Pre-bind ping : ${force ? "DILEWATI (--force)" : "AKTIF (Fail-Closed)"}`);

  const result = await executeBindRouteWithHealthCheck(walletId, proxyId, providerArg, {
    skipPing: force,
  });

  if (!result.success) {
    console.error(`\n[GAGAL] ${result.error}`);
    if (result.pingResult) {
      console.error(`  Health Status: ${result.pingResult.healthStatus.toUpperCase()}`);
      console.error(`  Pesan        : ${result.pingResult.message}`);
    }
    console.error(`\nRute TIDAK diubah untuk melindungi integritas koneksi (Fail-Closed safe).`);
    console.error(`Gunakan flag '--force' jika Anda yakin proxy ini valid dan tetap ingin mengikatnya.`);
    console.log(`=================================================================\n`);
    process.exit(1);
  }

  console.log(`\n[SUCCESS] Wallet '${walletId.trim()}' berhasil dihubungkan ke Proxy '${proxyId.trim()}' untuk provider '${providerArg?.trim() || "bankr"}'.`);
  if (result.pingResult?.latencyMs) {
    console.log(`  Latensi Proxy : ${result.pingResult.latencyMs} ms`);
  }
  console.log(`Audit log rotasi proxy otomatis dicatat di tabel proxy_audit_logs.`);
  console.log(`=================================================================\n`);
}

function parseBulkProxyContent(content: string, filename?: string): BulkProxyItem[] {
  const lines = content.split(/\r?\n/);
  const items: BulkProxyItem[] = [];

  let headerIndex = -1;
  let headers: string[] = [];
  let isCsv = false;
  let delimiter = ",";

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    if (filename?.endsWith(".csv") || trimmed.toLowerCase().includes("proxy")) {
      if (trimmed.includes(",")) delimiter = ",";
      else if (trimmed.includes(";")) delimiter = ";";
      else if (trimmed.includes("\t")) delimiter = "\t";

      const cols = trimmed.split(delimiter).map((c) => c.trim().toLowerCase());
      if (cols.includes("proxy") || cols.includes("rawproxy") || cols.includes("proxyurl")) {
        headerIndex = i;
        headers = cols;
        isCsv = true;
        break;
      }
    }
    break;
  }

  if (isCsv && headerIndex >= 0) {
    const proxyCol = headers.findIndex((c) => c === "proxy" || c === "rawproxy" || c === "proxyurl");
    const idCol = headers.findIndex((c) => c === "id" || c === "walletid");
    const labelCol = headers.findIndex((c) => c === "label" || c === "name");
    const keyCol = headers.findIndex(
      (c) => c === "key" || c === "apikey" || c === "credential" || c === "credentialref"
    );
    const evmCol = headers.findIndex((c) => c === "evm" || c === "evmaddress" || c === "address");
    const solCol = headers.findIndex((c) => c === "solana" || c === "solanaaddress" || c === "sol");

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) continue;

      const cols = line.split(delimiter).map((c) => c.trim());
      const rawProxy = cols[proxyCol];
      if (!rawProxy) continue;

      items.push({
        rawProxy,
        id: idCol >= 0 && cols[idCol] ? cols[idCol] : undefined,
        label: labelCol >= 0 && cols[labelCol] ? cols[labelCol] : undefined,
        credentialRef: keyCol >= 0 && cols[keyCol] ? cols[keyCol] : undefined,
        evmAddress: evmCol >= 0 && cols[evmCol] ? cols[evmCol] : undefined,
        solanaAddress: solCol >= 0 && cols[solCol] ? cols[solCol] : undefined,
        lineNumber: i + 1,
      });
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) continue;

      items.push({
        rawProxy: line,
        lineNumber: i + 1,
      });
    }
  }

  return items;
}

async function executeBulkProxyImport(
  items: BulkProxyItem[],
  options?: BulkImportOptions
): Promise<BulkImportSummary> {
  const start = Date.now();
  const concurrency = Math.max(1, options?.concurrency ?? 5);
  const skipPing = options?.skipPing ?? false;
  const prefix = (options?.prefix || "bankr-acc").trim();
  const defaultKey = options?.defaultKey || "env:BANKR_API_KEY";
  const timeoutMs = options?.timeoutMs ?? 15000;

  const existingWallets = listWalletAccounts();
  let nextCounter = existingWallets.length + 1;

  const entries: BulkImportResultEntry[] = [];
  let totalRegistered = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  interface TaskItem {
    item: BulkProxyItem;
    assignedId: string;
    assignedLabel: string;
    parsedProxy: ReturnType<typeof parseUniversalProxy> | null;
    parseError?: string;
  }

  const tasks: TaskItem[] = [];
  for (const it of items) {
    const assignedId = (it.id || `${prefix}-${nextCounter}`).trim();
    const assignedLabel = (it.label || `Bankr Operator #${nextCounter}`).trim();
    if (!it.id) nextCounter++;

    try {
      const parsed = parseUniversalProxy(it.rawProxy);
      tasks.push({
        item: it,
        assignedId,
        assignedLabel,
        parsedProxy: parsed,
      });
    } catch (err: any) {
      tasks.push({
        item: it,
        assignedId,
        assignedLabel,
        parsedProxy: null,
        parseError: err?.message || String(err),
      });
    }
  }

  let currentIndex = 0;
  async function worker(): Promise<void> {
    while (currentIndex < tasks.length) {
      const taskIndex = currentIndex++;
      const task = tasks[taskIndex];
      const { item, assignedId, assignedLabel, parsedProxy, parseError } = task;

      if (!parsedProxy || parseError) {
        totalFailed++;
        entries[taskIndex] = {
          lineNumber: item.lineNumber,
          id: assignedId,
          label: assignedLabel,
          host: item.rawProxy.slice(0, 25),
          port: 0,
          protocol: "unknown",
          healthStatus: "unavailable",
          latencyMs: 0,
          status: "FAILED",
          message: `Parse error: ${parseError}`,
        };
        continue;
      }

      let effectiveCredentialRef = item.credentialRef?.trim() || defaultKey;
      if (
        effectiveCredentialRef.startsWith("bk_") ||
        (effectiveCredentialRef.length > 20 && !effectiveCredentialRef.startsWith("env:"))
      ) {
        const cleanKeyName = `BANKR_API_KEY_${assignedId.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
        try {
          writeKeyToEnv(cleanKeyName, effectiveCredentialRef);
          effectiveCredentialRef = `env:${cleanKeyName}`;
        } catch {
          // ignore
        }
      }

      let pingRes: ProxyPingResult = {
        reachable: true,
        latencyMs: 0,
        healthStatus: "available",
        message: "Preflight dilewati",
      };

      if (!skipPing) {
        const resolvedApiKey = resolveCredential(effectiveCredentialRef) || process.env.BANKR_API_KEY;
        pingRes = await pingProxyEndpoint(
          {
            protocol: parsedProxy.protocol,
            host: parsedProxy.host,
            port: parsedProxy.port,
            username: parsedProxy.username,
            password: parsedProxy.password,
          },
          resolvedApiKey,
          timeoutMs
        );
      }

      const proxyId = `proxy_${assignedId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

      if (pingRes.reachable) {
        try {
          const existingProxy = getProxyConfig(proxyId);
          if (!existingProxy) {
            registerProxyConfig({
              id: proxyId,
              protocol: parsedProxy.protocol,
              host: parsedProxy.host,
              port: parsedProxy.port,
              username: parsedProxy.username,
              password: parsedProxy.password,
              status: "ACTIVE",
              healthStatus: pingRes.healthStatus,
            });
            if (pingRes.latencyMs > 0) {
              updateProxyStatus(proxyId, "ACTIVE", pingRes.healthStatus, pingRes.latencyMs);
            }
          } else {
            updateProxyDetails(proxyId, {
              protocol: parsedProxy.protocol,
              host: parsedProxy.host,
              port: parsedProxy.port,
              username: parsedProxy.username,
              password: parsedProxy.password,
              status: "ACTIVE",
              healthStatus: pingRes.healthStatus,
              latencyMs: pingRes.latencyMs > 0 ? pingRes.latencyMs : null,
            });
          }

          const existingWallet = getWalletAccount(assignedId);
          if (!existingWallet) {
            registerWalletAccount({
              id: assignedId,
              label: assignedLabel,
              evmAddress: item.evmAddress,
              solanaAddress: item.solanaAddress,
              credentialRef: effectiveCredentialRef,
              status: "ACTIVE",
            });
          }

          setWalletProviderRoute(assignedId, "bankr", {
            credentialRef: effectiveCredentialRef,
            proxyId,
            status: "ACTIVE",
          });
          setWalletProviderRoute(assignedId, "basedbot", {
            credentialRef: "env:TELEGRAM_BOT_TOKEN",
            proxyId: null,
            status: "ACTIVE",
          });

          totalRegistered++;
          entries[taskIndex] = {
            lineNumber: item.lineNumber,
            id: assignedId,
            label: assignedLabel,
            host: parsedProxy.host,
            port: parsedProxy.port,
            protocol: parsedProxy.protocol,
            healthStatus: pingRes.healthStatus,
            latencyMs: pingRes.latencyMs,
            status: "REGISTERED",
            message: pingRes.message,
          };
        } catch (err: any) {
          totalFailed++;
          entries[taskIndex] = {
            lineNumber: item.lineNumber,
            id: assignedId,
            label: assignedLabel,
            host: parsedProxy.host,
            port: parsedProxy.port,
            protocol: parsedProxy.protocol,
            healthStatus: "unavailable",
            latencyMs: 0,
            status: "FAILED",
            message: `DB Error: ${err?.message || err}`,
          };
        }
      } else {
        totalFailed++;
        entries[taskIndex] = {
          lineNumber: item.lineNumber,
          id: assignedId,
          label: assignedLabel,
          host: parsedProxy.host,
          port: parsedProxy.port,
          protocol: parsedProxy.protocol,
          healthStatus: pingRes.healthStatus,
          latencyMs: pingRes.latencyMs,
          status: "FAILED",
          message: `Preflight failed: ${pingRes.message}`,
        };
      }
    }
  }

  const workerPromises = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workerPromises);

  return {
    totalParsed: items.length,
    totalRegistered,
    totalFailed,
    totalSkipped,
    durationMs: Date.now() - start,
    entries,
  };
}

async function pruneDeadProxies(options?: PruneOptions): Promise<PruneResult> {
  const quarantineHours = options?.quarantineHours ?? 24;
  const hardDelete = options?.hardDelete ?? false;
  const dryRun = options?.dryRun ?? false;
  const allDead = options?.allDead ?? false;

  const allProxies = listProxyConfigs();
  const details: PruneDetail[] = [];
  let deadDetected = 0;
  let quarantinedCount = 0;
  let deletedCount = 0;
  let dryRunCount = 0;
  let routesProtected = 0;

  for (const proxy of allProxies) {
    const isDead = proxy.healthStatus !== "available";

    if (!isDead) {
      continue;
    }

    deadDetected++;

    const checkTime = proxy.lastCheckedAt || proxy.updatedAt || proxy.createdAt;
    const checkDate = new Date(checkTime);
    const diffMs = Date.now() - checkDate.getTime();
    const hoursSinceCheck = isNaN(diffMs) ? null : Math.max(0, diffMs / (1000 * 60 * 60));

    // If soft-quarantining and proxy is ALREADY DISABLED, skip unless hardDelete
    if (!hardDelete && proxy.status === "DISABLED") {
      details.push({
        proxyId: proxy.id,
        host: proxy.host,
        port: proxy.port,
        healthStatus: proxy.healthStatus,
        hoursSinceCheck,
        action: "SKIPPED",
        reason: "Sudah dalam status DISABLED (sudah dikarantina)",
      });
      continue;
    }

    // Check age threshold if not allDead
    if (!allDead && hoursSinceCheck !== null && hoursSinceCheck < quarantineHours) {
      details.push({
        proxyId: proxy.id,
        host: proxy.host,
        port: proxy.port,
        healthStatus: proxy.healthStatus,
        hoursSinceCheck,
        action: "SKIPPED",
        reason: `Belum melampaui ambang ${quarantineHours} jam (${hoursSinceCheck.toFixed(1)} jam lalu)`,
      });
      continue;
    }

    // Check if proxy is bound to any ACTIVE wallet provider route
    const boundRoutes = getAllProviderRoutes().filter(
      (r) => r.proxyId === proxy.id && r.status === "ACTIVE"
    );
    let routeFailoverExecuted = false;

    if (boundRoutes.length > 0) {
      const failoverRes = await autoFailoverUnhealthyRoutes();
      if (failoverRes.failoversExecuted > 0) {
        routeFailoverExecuted = true;
        routesProtected += failoverRes.failoversExecuted;
      }
    }

    if (dryRun) {
      dryRunCount++;
      const action = hardDelete ? "DRY_RUN_DELETE" : "DRY_RUN_QUARANTINE";
      details.push({
        proxyId: proxy.id,
        host: proxy.host,
        port: proxy.port,
        healthStatus: proxy.healthStatus,
        hoursSinceCheck,
        action,
        routeFailoverExecuted,
        reason: hardDelete
          ? "[SIMULASI] Proxy akan dihapus permanen dari vault"
          : "[SIMULASI] Proxy akan diubah statusnya menjadi DISABLED",
      });
    } else if (hardDelete) {
      deleteProxyConfig(proxy.id);
      deletedCount++;
      details.push({
        proxyId: proxy.id,
        host: proxy.host,
        port: proxy.port,
        healthStatus: proxy.healthStatus,
        hoursSinceCheck,
        action: "DELETED",
        routeFailoverExecuted,
        reason: "Berhasil dihapus permanen dari vault",
      });
    } else {
      updateProxyStatus(proxy.id, "DISABLED");
      recordProxyAuditLog({
        walletId: "system",
        provider: "bankr",
        previousProxyId: proxy.id,
        newProxyId: null,
        reason: `Quarantine: ${proxy.healthStatus} (${hoursSinceCheck !== null ? hoursSinceCheck + 'h dead' : 'all-dead'})`,
      });
      quarantinedCount++;
      details.push({
        proxyId: proxy.id,
        host: proxy.host,
        port: proxy.port,
        healthStatus: proxy.healthStatus,
        hoursSinceCheck,
        action: "QUARANTINED",
        routeFailoverExecuted,
        reason: "Status diubah menjadi DISABLED (dikarantina aman)",
      });
    }
  }

  return {
    totalScanned: allProxies.length,
    deadDetected,
    quarantinedCount,
    deletedCount,
    dryRunCount,
    routesProtected,
    details,
  };
}


async function recheckProxyHealth(options?: RecheckOptions): Promise<RecheckSummary> {
  const start = Date.now();
  const concurrency = Math.max(1, options?.concurrency ?? 5);
  const timeoutMs = options?.timeoutMs ?? 15000;
  const probeQuarantined = options?.probeQuarantined ?? false;

  const allProxies = listProxyConfigs();
  const proxies = probeQuarantined
    ? allProxies
    : allProxies.filter((p) => p.status !== "DISABLED");

  const wallets = listWalletAccounts();
  const proxyToWalletMap = new Map<string, { walletId: string; credentialRef?: string | null }>();

  for (const w of wallets) {
    const routes = getAllProviderRoutes(w.id);
    for (const r of routes) {
      if (r.proxyId) {
        proxyToWalletMap.set(r.proxyId, { walletId: w.id, credentialRef: r.credentialRef });
      }
    }
  }

  let availableCount = 0;
  let unavailableCount = 0;
  let timeoutCount = 0;
  let authErrorCount = 0;
  let unquarantinedCount = 0;
  const unquarantinedDetails: string[] = [];

  let currentIndex = 0;
  async function worker(): Promise<void> {
    while (currentIndex < proxies.length) {
      const idx = currentIndex++;
      const p = proxies[idx];

      const assigned = proxyToWalletMap.get(p.id);
      const resolvedKey = assigned?.credentialRef
        ? resolveCredential(assigned.credentialRef)
        : process.env.BANKR_API_KEY;

      const pingRes = await pingProxyEndpoint(p, resolvedKey, timeoutMs);

      let finalStatus = p.status;
      if (p.status === "DISABLED" && probeQuarantined && pingRes.healthStatus === "available") {
        const cooldown = evaluateQuarantineCooldown(p.id);
        if (!cooldown.isEligible && !options?.forceUnquarantine) {
          finalStatus = "DISABLED";
          logger.warn(
            `⏳ [QUARANTINE COOLDOWN] Proxy '${p.id}' sehat [${pingRes.latencyMs}ms] tapi ditahan karantina (${cooldown.remainingMinutes}m tersisa, penalti ${cooldown.penaltyHours}j karena ${cooldown.recentFailures}x kegagalan).`
          );
        } else {
          finalStatus = "ACTIVE";
          unquarantinedCount++;
          unquarantinedDetails.push(
            `Proxy '${p.id}' (${p.host}:${p.port}) kembali responsif [${pingRes.latencyMs}ms] -> Dipulihkan ke ACTIVE`
          );
          recordProxyAuditLog({
            walletId: "system",
            provider: "bankr",
            previousProxyId: null,
            newProxyId: p.id,
            reason: `Unquarantine: Healed (${pingRes.latencyMs}ms) and passed flapping cooldown`,
          });
        }
      }

      updateProxyStatus(p.id, finalStatus, pingRes.healthStatus, pingRes.latencyMs);

      if (pingRes.healthStatus === "available") availableCount++;
      else if (pingRes.healthStatus === "timeout") timeoutCount++;
      else if (pingRes.healthStatus === "authentication_error") authErrorCount++;
      else unavailableCount++;

      if (options?.onProgress) {
        options.onProgress(idx + 1, proxies.length, p.id, pingRes);
      }
    }
  }

  const workerPromises = Array.from({ length: Math.min(concurrency, proxies.length) }, () => worker());
  await Promise.all(workerPromises);

  return {
    totalProxies: proxies.length,
    availableCount,
    unavailableCount,
    timeoutCount,
    authErrorCount,
    unquarantinedCount,
    unquarantinedDetails,
    durationMs: Date.now() - start,
  };
}

function parseRecheckArgs(argv: string[]): RecheckCliOptions {
  let autoFailover = false;
  let isDaemon = false;
  let intervalMinutes = 15;
  let concurrency = 5;
  let probeQuarantined = false;
  let forceUnquarantine = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i].toLowerCase();
    if (a === "--auto-failover" || a === "--failover") {
      autoFailover = true;
    } else if (a === "--daemon" || a === "-d") {
      isDaemon = true;
    } else if (a === "--probe-quarantined" || a === "--probe-disabled" || a === "--unquarantine") {
      probeQuarantined = true;
    } else if (a === "--force" || a === "-f") {
      forceUnquarantine = true;
    } else if (a.startsWith("--interval=")) {
      const val = parseInt(a.split("=")[1], 10);
      if (!isNaN(val) && val > 0) intervalMinutes = val;
    } else if (a === "--interval" || a === "-i") {
      const next = argv[i + 1];
      if (next && !isNaN(Number(next))) {
        intervalMinutes = Math.max(1, parseInt(next, 10));
        i++;
      }
    } else if (a.startsWith("--concurrency=")) {
      const val = parseInt(a.split("=")[1], 10);
      if (!isNaN(val) && val > 0) concurrency = val;
    } else if (a === "--concurrency" || a === "-c") {
      const next = argv[i + 1];
      if (next && !isNaN(Number(next))) {
        concurrency = Math.max(1, parseInt(next, 10));
        i++;
      }
    }
  }

  return { autoFailover, isDaemon, intervalMinutes, concurrency, probeQuarantined, forceUnquarantine };
}

async function handleImportProxies(): Promise<void> {
  const nonFlagArgs = args.filter((a) => !a.startsWith("--"));
  const filePath = nonFlagArgs[1];

  if (!filePath) {
    console.error("[ERROR] Path file wajib diisi.");
    console.log("Usage: import-proxies <filePath> [--prefix <prefix>] [--concurrency <N>] [--skip-ping]");
    console.log("Contoh: bun run scripts/manage-wallets.ts import-proxies proxies.txt");
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`[ERROR] File '${resolvedPath}' tidak ditemukan.`);
    process.exit(1);
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");
  const items = parseBulkProxyContent(content, resolvedPath);

  if (items.length === 0) {
    console.log(`[INFO] Tidak ada entri proxy yang valid ditemukan di '${filePath}'.`);
    return;
  }

  let prefix = "bankr-acc";
  let concurrency = 5;
  let skipPing = args.includes("--skip-ping") || args.includes("--force");

  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    if (a.startsWith("--prefix=")) {
      prefix = a.split("=")[1].trim();
    } else if (a === "--prefix") {
      if (args[i + 1] && !args[i + 1].startsWith("--")) {
        prefix = args[i + 1].trim();
        i++;
      }
    } else if (a.startsWith("--concurrency=")) {
      const val = parseInt(a.split("=")[1], 10);
      if (!isNaN(val) && val > 0) concurrency = val;
    } else if (a === "--concurrency" || a === "-c") {
      const next = args[i + 1];
      if (next && !isNaN(Number(next))) {
        concurrency = Math.max(1, parseInt(next, 10));
        i++;
      }
    }
  }

  console.log(`\n=================================================================`);
  console.log(`  [+] PROSES BULK IMPORT PROXY & MULTI-ACCOUNT [+]`);
  console.log(`=================================================================`);
  console.log(`  File Sumber   : ${filePath}`);
  console.log(`  Total Entri   : ${items.length} item`);
  console.log(`  Prefix Akun   : ${prefix}`);
  console.log(`  Konkurensi    : ${concurrency} worker paralel`);
  console.log(`  Preflight Ping: ${skipPing ? "DILEWATI (--skip-ping)" : "AKTIF (api.bankr.bot)"}`);
  console.log(`Memulai proses impor...\n`);

  const summary = await executeBulkProxyImport(items, {
    prefix,
    concurrency,
    skipPing,
  });

  console.log(
    "NO".padEnd(4) +
    "ID AKUN".padEnd(18) +
    "HOST:PORT".padEnd(26) +
    "STATUS".padEnd(16) +
    "LATENSI".padEnd(12) +
    "KETERANGAN"
  );
  console.log("-".repeat(95));

  for (let i = 0; i < summary.entries.length; i++) {
    const e = summary.entries[i];
    const noStr = `${i + 1}.`.padEnd(4);
    const idStr = e.id.padEnd(18);
    const hostPort = `${e.host}:${e.port}`.padEnd(26);
    const statusStr = `[${e.status}]`.padEnd(16);
    const latencyStr = e.latencyMs > 0 ? `${e.latencyMs} ms`.padEnd(12) : "-".padEnd(12);

    console.log(noStr + idStr + hostPort + statusStr + latencyStr + e.message);
  }

  console.log("-----------------------------------------------------------------");
  console.log(
    `Total: ${summary.totalParsed} | Berhasil: ${summary.totalRegistered} | Gagal: ${summary.totalFailed} | Durasi: ${(summary.durationMs / 1000).toFixed(1)}s`
  );
  console.log(`Akun terdaftar siap berotasi round-robin di PIPELINE_OTOMATIS.`);
  console.log(`=================================================================\n`);
}

async function handleRecheckProxies(): Promise<void> {
  const cliOpts = parseRecheckArgs(args);

  console.log(`\n=================================================================`);
  console.log(`  [+] PEMANTAUAN KESEHATAN PROXY & AUTO-FAILOVER [+]`);
  console.log(`=================================================================`);
  console.log(
    `  Auto-Failover : ${cliOpts.autoFailover ? "AKTIF (Otomatis alihkan jika unhealthy)" : "NONAKTIF (Diagnostik saja)"}`
  );
  console.log(
    `  Mode Eksekusi : ${cliOpts.isDaemon ? `DAEMON (Interval: ${cliOpts.intervalMinutes} menit)` : "SINGLE-PASS"}`
  );
  console.log(`  Konkurensi    : ${cliOpts.concurrency} worker paralel\n`);

  async function runSingleCycle(): Promise<void> {
    console.log(`[*] [${new Date().toLocaleTimeString()}] Memindai kesehatan proxy...`);
    const summary = await recheckProxyHealth({
      concurrency: cliOpts.concurrency,
      probeQuarantined: cliOpts.probeQuarantined,
      forceUnquarantine: cliOpts.forceUnquarantine,
      onProgress: (idx, total, proxyId, res) => {
        const icon = res.reachable ? "[OK]" : "[FAIL]";
        const lat = res.latencyMs > 0 ? `${res.latencyMs}ms` : "-";
        console.log(`    (${idx}/${total}) ${icon} ${proxyId.padEnd(20)} [${res.healthStatus.toUpperCase()}] ${lat}`);
      },
    });

    console.log(
      `\n    Hasil Pindai: Total: ${summary.totalProxies} | Sehat: ${summary.availableCount} | Timeout: ${summary.timeoutCount} | Gagal/WAF: ${summary.unavailableCount + summary.authErrorCount}` +
        (summary.unquarantinedCount ? ` | Dipulihkan: ${summary.unquarantinedCount}` : "")
    );

    if (summary.unquarantinedCount && summary.unquarantinedCount > 0) {
      console.log(`\n    🎉 [UNQUARANTINE] Sebanyak ${summary.unquarantinedCount} proxy pulih dan statusnya dikembalikan ke ACTIVE!`);
      for (const msg of summary.unquarantinedDetails ?? []) {
        console.log(`      • ${msg}`);
      }
      await broadcastProxyAlert({
        type: "UNQUARANTINE",
        title: `${summary.unquarantinedCount} Proxy Pulih dan Dikembalikan ke ACTIVE`,
        details: summary.unquarantinedDetails ?? [],
        totalAffected: summary.unquarantinedCount,
      }).catch(() => {});
    }

    if (cliOpts.autoFailover) {
      console.log(`\n[*] Memeriksa rute wallet untuk auto-failover...`);
      const failoverRes = await autoFailoverUnhealthyRoutes();
      if (failoverRes.unhealthyRoutesCount === 0) {
        console.log(`    Semua rute aktif terhubung ke proxy yang sehat. Tidak ada failover yang diperlukan.`);
      } else {
        console.log(
          `    Ditemukan ${failoverRes.unhealthyRoutesCount} rute tidak sehat. Dialihkan: ${failoverRes.failoversExecuted}, Gagal: ${failoverRes.failoversFailed}`
        );
        for (const d of failoverRes.details) {
          console.log(`      • Wallet '${d.walletId}': ${d.action} -> ${d.reason}`);
        }

        if (failoverRes.failoversExecuted > 0) {
          await broadcastProxyAlert({
            type: "FAILOVER",
            title: `${failoverRes.failoversExecuted} Rute Dompet Dialihkan ke Proxy Cadangan`,
            details: failoverRes.details
              .filter((d) => d.action === "ROTATED")
              .map((d) => `Wallet '${d.walletId}': dialihkan ke '${d.newProxyId}' (${d.reason})`),
            totalAffected: failoverRes.failoversExecuted,
          }).catch(() => {});
        }
      }
    }
  }

  await runSingleCycle();

  if (cliOpts.isDaemon) {
    console.log(
      `\n[*] Daemon monitor aktif. Pengecekan berikutnya dalam ${cliOpts.intervalMinutes} menit. Tekan Ctrl+C untuk berhenti.`
    );
    const intervalMs = cliOpts.intervalMinutes * 60 * 1000;
    setInterval(async () => {
      try {
        await runSingleCycle();
      } catch (err: any) {
        console.error(`[ERROR] Siklus monitor gagal: ${err?.message || err}`);
      }
    }, intervalMs);

    await new Promise(() => {});
  } else {
    console.log(`=================================================================\n`);
  }
}

async function handlePruneProxies(): Promise<void> {
  const isDryRun = args.includes("--dry-run") || args.includes("-n");
  const isHardDelete = args.includes("--hard-delete") || args.includes("--hard");
  const isAllDead = args.includes("--all") || args.includes("--all-dead");

  let quarantineHours = 24;
  for (let i = 0; i < args.length; i++) {
    const a = args[i].toLowerCase();
    if (a.startsWith("--hours=")) {
      const val = parseFloat(a.split("=")[1]);
      if (!isNaN(val) && val >= 0) quarantineHours = val;
    } else if (a === "--hours" || a === "-h") {
      const next = args[i + 1];
      if (next && !isNaN(Number(next))) {
        quarantineHours = Math.max(0, parseFloat(next));
        i++;
      }
    }
  }

  console.log(`\n=================================================================`);
  console.log(`  [+] KARANTINA & PEMBERSIHAN PROXY MATI (AUTO-PRUNE) [+]`);
  console.log(`=================================================================`);
  console.log(
    `  Mode Eksekusi : ${isDryRun ? "SIMULASI / DRY-RUN (Database tidak diubah)" : isHardDelete ? "HARD-DELETE (Hapus Permanen)" : "SOFT-QUARANTINE (Status -> DISABLED)"}`
  );
  console.log(`  Ambang Batas  : ${isAllDead ? "SEMUA PROXY MATI (Semua durasi)" : `> ${quarantineHours} jam tidak sehat`}`);
  console.log(`  Proteksi Rute : AKTIF (Auto-failover rute aktif sebelum prune)\n`);

  const result = await pruneDeadProxies({
    quarantineHours,
    hardDelete: isHardDelete,
    dryRun: isDryRun,
    allDead: isAllDead,
  });

  if (result.details.length === 0) {
    console.log(`[OK] Semua proxy di database dalam kondisi SEHAT atau tidak ada proxy mati.`);
    console.log(`=================================================================\n`);
    return;
  }

  console.log(
    "NO".padEnd(4) +
    "ID PROXY".padEnd(20) +
    "HOST:PORT".padEnd(24) +
    "KESEHATAN".padEnd(16) +
    "AKSI".padEnd(22) +
    "KETERANGAN"
  );
  console.log("-".repeat(95));

  for (let i = 0; i < result.details.length; i++) {
    const d = result.details[i];
    const noStr = `${i + 1}.`.padEnd(4);
    const idStr = d.proxyId.padEnd(20);
    const hostPort = `${d.host}:${d.port}`.padEnd(24);
    const healthStr = `[${d.healthStatus.toUpperCase()}]`.padEnd(16);
    const actionStr = `[${d.action}]`.padEnd(22);
    const failoverTag = d.routeFailoverExecuted ? " (Rute Dialihkan)" : "";

    console.log(noStr + idStr + hostPort + healthStr + actionStr + d.reason + failoverTag);
  }

  console.log("-----------------------------------------------------------------");
  console.log(
    `Total Dipindai: ${result.totalScanned} | Terdeteksi Mati: ${result.deadDetected} | ` +
    (isDryRun
      ? `Simulasi: ${result.dryRunCount}`
      : isHardDelete
      ? `Dihapus: ${result.deletedCount}`
      : `Dikarantina: ${result.quarantinedCount}`) +
    ` | Rute Dilindungi: ${result.routesProtected}`
  );
  console.log(`=================================================================\n`);

  if (!isDryRun && (result.quarantinedCount > 0 || result.deletedCount > 0)) {
    const affected = result.details.filter((d) => d.action === "QUARANTINED" || d.action === "DELETED");
    await broadcastProxyAlert({
      type: "PRUNE",
      title: `Pembersihan Proxy: ${result.quarantinedCount} Dikarantina, ${result.deletedCount} Dihapus`,
      details: affected.map(
        (d) => `Proxy '${d.proxyId}' (${d.host}:${d.port}) [${d.healthStatus.toUpperCase()}] -> ${d.action}: ${d.reason}`
      ),
      totalAffected: result.quarantinedCount + result.deletedCount,
    }).catch(() => {});
  }
}

async function main(): Promise<void> {
  switch (command) {
    case "list":
      await handleList();
      break;
    case "check-balance":
    case "balance":
    case "balances":
      await handleCheckBalance();
      break;
    case "set-treasury":
    case "treasury":
      await handleSetTreasury();
      break;
    case "set-webhook":
    case "webhook":
      await handleSetWebhook();
      break;
    case "sync-env":
    case "bootstrap":
      await handleSyncEnv();
      break;
    case "sync-webshare":
    case "webshare-sync":
    case "webshare":
      await handleSyncWebshare();
      break;
    case "rebalance":
    case "rebalance-wallets":
    case "topup":
      await handleRebalance();
      break;
    case "replace-flapping":
    case "replace-proxies":
    case "rotate-flapping":
      await handleReplaceFlapping();
      break;
    case "wizard-account":
    case "wizard":
    case "wizard-interactive": {
      const nonFlagArgs = args.filter((a) => !a.startsWith("--"));
      if (nonFlagArgs.length >= 4) {
        await handleWizardAccount();
      } else {
        await handleInteractiveWizard();
      }
      break;
    }
    case "import-proxies":
    case "import-bulk":
    case "bulk-import":
      await handleImportProxies();
      break;
    case "test-proxies":
    case "test-proxy":
    case "ping-proxies":
      await handleTestProxies();
      break;
    case "recheck-proxies":
    case "monitor-proxies":
    case "health-check":
      await handleRecheckProxies();
      break;
    case "prune-proxies":
    case "quarantine-proxies":
    case "prune":
      await handlePruneProxies();
      break;
    case "bind-route":
      await handleBindRoute();
      break;
    case "add-wallet":
      await handleAddWallet();
      break;
    case "add-proxy":
      await handleAddProxy();
      break;
    case "set-route":
      await handleSetRoute();
      break;
    case "status":
      await handleStatus();
      break;
    default:
      printHelp();
      break;
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  });
}
