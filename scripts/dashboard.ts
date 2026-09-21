#!/usr/bin/env bun
/**
 * scripts/dashboard.ts — Live CLI Terminal Dashboard & Monitoring Console
 *
 * Displays a real-time status report of:
 *  1. Bot operational configuration & active mode (Zero-Capital vs Micro-Snipe)
 *  2. Deployed token fleet & on-chain Contract Addresses (CAs)
 *  3. Treasury & 95% Creator Fee monetization metrics (accrued, claimable, claimed)
 *  4. Open sniper positions & PnL tracking status
 *  5. Operator wallet accounts, proxy routes & health
 *  6. Recent pipeline telemetry cycles & daily safety caps
 *
 * STRICT INVARIANTS:
 *  - Read-only: Makes zero database mutations or blockchain transactions.
 *  - Zero Secrets: All private keys and auth tokens are masked or hidden.
 *  - Clean formatting: Uses ANSI colors and clear structured tables.
 */

import { getConfig, getActiveChains } from "../src/config.ts";
import {
  getAllDeployLogs,
  getOpenPositions,
  getFeeEvents,
  getTreasuryLedgerEntries,
  getRecentCycles,
  getTodayDeployCount,
  getFlywheelSummary,
  getTopAffiliates,
  getTotalGasSponsorshipSavings,
  getAllPromotionDecisions,
} from "../src/db/vault.ts";
import {
  listWalletAccounts,
  getAllProviderRoutes,
  listProxyConfigs,
  buildProxyUrl,
  evaluateQuarantineCooldown,
  resolveCredential,
} from "../src/modules/identity/wallet-manager.ts";
import {
  isLiveDeployment,
  isSimulatedDeployment,
  isTestFixture,
  classifyDeployment,
  getProductionFleet,
} from "../src/modules/fleet/fleet-registry.ts";
import {
  fetchDexScreenerMetrics,
  type DexMetrics,
} from "../src/modules/fleet/dex-cache.ts";
import { evaluatePromotionEligibility } from "../src/modules/growth/token-offer-generator.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

function maskAddress(addr?: string | null): string {
  if (!addr) return "N/A";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function generateDashboardData() {
  const cfg = getConfig();
  const activeChains = getActiveChains();
  const todayDeployCount = getTodayDeployCount();
  const deployLogs = getAllDeployLogs();
  const sortedDeployLogs = [...deployLogs].sort((a, b) => {
    const aIsLive = isLiveDeployment(a);
    const bIsLive = isLiveDeployment(b);
    if (aIsLive && !bIsLive) return -1;
    if (!aIsLive && bIsLive) return 1;
    return b.id - a.id;
  });
  const openPositions = getOpenPositions();
  const feeEvents = getFeeEvents();
  const treasuryLedger = getTreasuryLedgerEntries();
  const recentCycles = getRecentCycles(5);
  const wallets = listWalletAccounts();
  const routes = getAllProviderRoutes();
  const proxies = listProxyConfigs();

  // Aggregate Creator Fees
  let totalAccruedWeth = 0;
  let totalClaimedWeth = 0;
  for (const ev of feeEvents) {
    const amt = (ev as any).amount_native ?? ev.amountFormatted ?? 0;
    totalAccruedWeth += amt;
    if (ev.status === "claimed") {
      totalClaimedWeth += amt;
    }
  }

  const flywheelSummary = getFlywheelSummary();
  const topAffiliates = getTopAffiliates(undefined, 5);
  const totalGasSavingsEth = getTotalGasSponsorshipSavings();

  const fleet = getProductionFleet();
  const liveDeployments = fleet.live;
  const liveBaseDeployments = liveDeployments.filter((d) => d.chain === "base");
  const primaryLiveToken = liveBaseDeployments.length > 0
    ? liveBaseDeployments[0]
    : liveDeployments[0];

  const modeName = !cfg.SNIPER_ENABLED || cfg.SNIPE_AMOUNT_ETH <= 0
    ? "Zero-Capital (Rp 0 Modal / 100% Sponsor)"
    : `Micro-Snipe (${cfg.SNIPE_WALLET_COUNT} Sub-Wallets / Safe-Cap)`;

  return {
    cfg,
    activeChains,
    todayDeployCount,
    deployLogs: sortedDeployLogs,
    liveTokens: liveDeployments,
    primaryLiveToken,
    openPositions,
    feeEvents,
    treasuryLedger,
    recentCycles,
    wallets,
    routes,
    proxies,
    totalAccruedWeth,
    totalClaimedWeth,
    totalGasSavingsEth,
    flywheelSummary,
    topAffiliates,
    modeName,
    promoDecisions: getAllPromotionDecisions(),
  };
}

export async function renderDashboard(options?: {
  dexMetrics?: Record<string, DexMetrics>;
}): Promise<void> {
  const data = generateDashboardData();
  const { cfg } = data;

  // Extract top meaningful tokens and pre-fetch DEX metrics with fast timeout
  const meaningfulLogs = data.deployLogs.filter((d) => !isTestFixture(d));
  const topTokens = meaningfulLogs.slice(0, 10);
  const addressesToQuery = topTokens
    .map((d) => d.contractAddr?.trim())
    .filter((a): a is string => Boolean(a && a.length >= 20 && !a.startsWith("pump_sim_") && !a.startsWith("0xsim_")));

  let dexMetrics = options?.dexMetrics;
  if (!dexMetrics && addressesToQuery.length > 0) {
    try {
      dexMetrics = await fetchDexScreenerMetrics(addressesToQuery, { timeoutMs: 2500 });
    } catch {
      dexMetrics = {};
    }
  }

  console.log(`\n${CYAN}${BOLD}========================================================================================${RESET}`);
  console.log(`${CYAN}${BOLD}     [+] OMNICHAIN MEME DEPLOYER & SAFE LAUNCH ENGINE - DASHBOARD [+]                   ${RESET}`);
  console.log(`${CYAN}${BOLD}========================================================================================${RESET}\n`);

  // SECTION 1: SYSTEM & POLICY
  console.log(`${BOLD}[1] STATUS SISTEM & KEBIJAKAN OPERASIONAL${RESET}`);
  console.log(`  - ${BOLD}Mode Deploy${RESET}      : ${cfg.DEPLOY_MODE === "mainnet" ? GREEN : YELLOW}${cfg.DEPLOY_MODE.toUpperCase()}${RESET}`);
  console.log(`  - ${BOLD}Chain Aktif${RESET}      : ${CYAN}${data.activeChains.join(", ").toUpperCase()}${RESET}`);
  console.log(`  - ${BOLD}Strategi Beli${RESET}    : ${GREEN}${data.modeName}${RESET}`);
  console.log(`  - ${BOLD}Gas Relayer${RESET}      : ${GREEN}100% Gas Sponsored (0.0 ETH Operator Cost)${RESET}`);
  console.log(`  - ${BOLD}Deploy Hari Ini${RESET}  : ${data.todayDeployCount} / ${cfg.MAX_DEPLOYS_PER_DAY} max/hari`);
  console.log(`  - ${BOLD}Safety Filter${RESET}    : Skor Min ${cfg.MIN_VIRAL_SCORE}/100 | Doppler Anti-Whale Safe Cap: ${cfg.SNIPE_SAFE_CAP_ETH} ETH\n`);

  // SECTION 2: DEPLOYED TOKENS
  const liveCount = data.liveTokens.length;
  console.log(`${BOLD}[2] DAFTAR TOKEN TERDEPLOY (FLEET MONITOR - Total: ${data.deployLogs.length} | Live On-Chain: ${liveCount})${RESET}`);
  if (meaningfulLogs.length === 0) {
    console.log(`  ${GRAY}(Belum ada token dengan alamat kontrak terdaftar di database)${RESET}`);
  } else {
    for (const d of topTokens) {
      const isLive = isLiveDeployment(d);
      const category = classifyDeployment(d);
      const isConfirmed = d.lifecycleState === "DEPLOY_CONFIRMED" || d.status === "confirmed";
      const statusBadge = isLive 
        ? `${GREEN}[LIVE ON-CHAIN]${RESET}` 
        : (isConfirmed || category === "SIMULATED" || d.simulated)
          ? `${CYAN}[SIMULATED]${RESET}` 
          : category === "FAILED"
            ? `${RED}[FAILED]${RESET}`
            : `${YELLOW}[${(d.lifecycleState && d.lifecycleState !== "0") ? d.lifecycleState : (d.status && d.status !== "0" ? d.status : "SIMULATED")}]${RESET}`;
      const caDisplay = d.contractAddr ? `${CYAN}${d.contractAddr}${RESET}` : `${GRAY}n/a${RESET}`;
      console.log(`  ${statusBadge} ${BOLD}$${d.ticker}${RESET} (${d.tokenName}) on ${d.chain.toUpperCase()}`);
      console.log(`     |-- CA       : ${caDisplay}`);
      if (d.poolId) console.log(`     |-- Pool ID  : ${GRAY}${d.poolId}${RESET}`);
      if (d.contractAddr) {
        const metrics = dexMetrics?.[d.contractAddr.trim().toLowerCase()];
        if (metrics && metrics.priceUsd && metrics.priceUsd !== "N/A" && metrics.priceUsd !== "Offline") {
          const liqStr = metrics.liquidityUsd != null ? ` | Liq: $${metrics.liquidityUsd.toLocaleString()}` : " | Liq: UNKNOWN";
          const volStr = metrics.volume24h != null ? ` | Vol: $${metrics.volume24h.toLocaleString()}` : " | Vol: UNKNOWN";
          const chgStr = metrics.change24h != null ? ` | 24h: ${metrics.change24h >= 0 ? "+" : ""}${metrics.change24h.toFixed(1)}%` : "";
          console.log(`     |-- DEX Metrik: ${GREEN}${metrics.priceUsd}${liqStr}${volStr}${chgStr}${RESET} ${GREEN}[DEX: OBSERVED]${RESET}`);
        } else if (isLive) {
          console.log(`     |-- DEX Metrik: ${YELLOW}[DEX: PENDING INDEXING / UNKNOWN]${RESET}`);
        } else {
          console.log(`     |-- DEX Metrik: ${GRAY}[DEX: SIMULATED / NO POOL]${RESET}`);
        }

        const promoEval = evaluatePromotionEligibility({
          lifecycleState: d.lifecycleState,
          status: d.status,
          onChainVerified: isLive,
          contractAddress: d.contractAddr,
          chain: d.chain,
          poolId: d.poolId,
          pairAddress: metrics?.pairAddress,
          liquidityUsd: metrics?.liquidityUsd,
          volume24h: metrics?.volume24h,
          priceUsd: metrics?.priceUsd,
          hasLogoUrl: Boolean(d.ipfsUrl),
        });

        const promoBadge = promoEval.status === "ELIGIBLE"
          ? `${GREEN}[ELIGIBLE]${RESET}`
          : promoEval.status === "CONDITIONAL"
          ? `${YELLOW}[CONDITIONAL]${RESET}`
          : promoEval.status === "NOT_READY"
          ? `${RED}[NOT_READY]${RESET}`
          : `${GRAY}[UNKNOWN]${RESET}`;

        const decisionRec = d.contractAddr ? (data.promoDecisions[d.contractAddr.toLowerCase()] || (d.ticker ? data.promoDecisions[d.ticker.toLowerCase()] : null)) : (d.ticker ? data.promoDecisions[d.ticker.toLowerCase()] : null);
        const opDecision = decisionRec?.decision || "PENDING_REVIEW";
        const opBadge = opDecision === "APPROVED"
          ? `${GREEN}[APPROVED]${RESET}`
          : opDecision === "REJECTED"
          ? `${RED}[REJECTED]${RESET}`
          : `${YELLOW}[PENDING_REVIEW]${RESET}`;

        const reasonSnippet = promoEval.reasons[0] ? ` ${GRAY}(${promoEval.reasons[0]})${RESET}` : "";
        console.log(`     |-- Discovery : ${promoBadge}${reasonSnippet} | Operator: ${opBadge}`);
        console.log(`     |-- Paket Promo: ${CYAN}bun run scripts/generate-token-offer.ts ${d.ticker || d.contractAddr} --save${RESET}`);
      }
      if (d.txHash) {
        if (isConfirmed && d.chain === "base") {
          console.log(`     |-- TxHash   : ${GREEN}${d.txHash}${RESET}`);
          console.log(`     |-- BaseScan : https://basescan.org/tx/${d.txHash}`);
        } else if (isConfirmed && d.chain === "solana") {
          console.log(`     |-- TxHash   : ${GREEN}${d.txHash}${RESET}`);
          console.log(`     |-- Solscan  : https://solscan.io/tx/${d.txHash}`);
        } else {
          console.log(`     |-- TxHash   : ${GRAY}${maskAddress(d.txHash)}${RESET}`);
        }
      }
      if (d.contractAddr) {
        if (d.chain === "base") {
          if (isConfirmed) {
            console.log(`     |-- Token CA : https://basescan.org/address/${d.contractAddr}`);
          }
          if (isLive && d.poolId && d.poolId !== "N/A") {
            console.log(`     |-- GeckoTerm: https://www.geckoterminal.com/base/pools/${d.poolId}`);
            console.log(`     |-- 1-Click $1: https://app.uniswap.org/swap?chain=base&inputCurrency=ETH&outputCurrency=${d.contractAddr}`);
          }
          if (d.websiteUrl) {
            console.log(`     |-- Web3 DApp: ${GREEN}${d.websiteUrl}${RESET}`);
          }
          if (d.ticker) {
            const neonDb = `token_${d.ticker.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
            console.log(`     |-- Neon DB  : ${CYAN}[${neonDb}]${RESET} (Cloud PostgreSQL)`);
          }
          console.log(`     \\-- Chart    : https://dexscreener.com/base/${d.contractAddr}`);
        } else if (d.chain === "solana") {
          if (isConfirmed) {
            console.log(`     |-- Solscan  : https://solscan.io/token/${d.contractAddr}`);
            console.log(`     |-- Pump.fun : https://pump.fun/${d.contractAddr}`);
          }
          if (d.websiteUrl) {
            console.log(`     |-- Web3 DApp: ${GREEN}${d.websiteUrl}${RESET}`);
          }
          if (d.ticker) {
            const neonDb = `token_${d.ticker.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
            console.log(`     |-- Neon DB  : ${CYAN}[${neonDb}]${RESET} (Cloud PostgreSQL)`);
          }
          console.log(`     \\-- Chart    : https://dexscreener.com/solana/${d.contractAddr}`);
        }
      }
    }
  }
  console.log("");

  // SECTION 3: TREASURY & MONETIZATION
  console.log(`${BOLD}[3] TREASURY & 95% CREATOR FEE MONETIZATION${RESET}`);
  console.log(`  - ${BOLD}Total Accrued Fee${RESET}      : ${GREEN}${data.totalAccruedWeth.toFixed(6)} WETH${RESET}`);
  console.log(`  - ${BOLD}Total Claimed Fee${RESET}      : ${CYAN}${data.totalClaimedWeth.toFixed(6)} WETH${RESET}`);
  console.log(`  - ${BOLD}Gas Relayer Sponsor${RESET}    : ${GREEN}${data.totalGasSavingsEth.toFixed(6)} ETH dihemat (100% Gratis via Bankr)${RESET}`);
  console.log(`  - ${BOLD}Auto-Claim Gate${RESET}        : Min ${cfg.TREASURY_MIN_CLAIM_ETH} WETH (Status: ${cfg.TREASURY_AUTO_CLAIM_ENABLED ? GREEN + "ACTIVE" : YELLOW + "OFF"}${RESET})`);
  console.log(`  - ${BOLD}Tujuan Treasury${RESET}        : ${cfg.TREASURY_EVM_DESTINATION ? CYAN + maskAddress(cfg.TREASURY_EVM_DESTINATION) : YELLOW + "(Menggunakan dompet operator default)"}${RESET}\n`);

  // SECTION 3B: FLYWHEEL GROWTH RECYCLER
  console.log(`${BOLD}[4] FLYWHEEL POSITIVE-SUM ENGINE (35/30/20/15 SPLIT)${RESET}`);
  if (data.liveTokens && data.liveTokens.length > 0) {
    for (const [idx, t] of data.liveTokens.entries()) {
      const numBadge = data.liveTokens.length > 1 ? ` #${idx + 1}` : "";
      console.log(`  - ${BOLD}Target Aktif${numBadge}${RESET} : ${GREEN}$${t.ticker || "TOKEN"}${RESET} (${t.contractAddr}) [${t.chain.toUpperCase()}] | ${CYAN}Renounced by Design (0% Tax)${RESET}`);
    }
    console.log(`  - ${BOLD}Status Hak Fee${RESET}    : ${GREEN}95% WETH Creator Swap Revenue Aktif${RESET}`);
  } else if (data.primaryLiveToken) {
    console.log(`  - ${BOLD}Target Aktif${RESET}      : ${GREEN}$${data.primaryLiveToken.ticker || "TOKEN"}${RESET} (${data.primaryLiveToken.contractAddr}) [${data.primaryLiveToken.chain.toUpperCase()}] | ${CYAN}Renounced by Design (0% Tax)${RESET}`);
    console.log(`  - ${BOLD}Status Hak Fee${RESET}    : ${GREEN}95% WETH Creator Swap Revenue Aktif${RESET}`);
  } else {
    console.log(`  - ${BOLD}Target Aktif${RESET}      : ${GRAY}(Belum ada token live on-chain aktif di vault)${RESET}`);
  }
  console.log(`  - ${BOLD}Status Mesin${RESET}      : ${cfg.FLYWHEEL_ENABLED ? GREEN + "ACTIVE (Revenue Recycler)" : YELLOW + "OFF"}${RESET}`);
  console.log(`  - ${BOLD}Siklus Eksekusi${RESET}   : ${data.flywheelSummary.eventCount} kali distribusi`);
  console.log(`  - ${BOLD}Total WETH Diputar${RESET}: ${GREEN}${data.flywheelSummary.totalClaimedWeth.toFixed(6)} WETH${RESET}`);
  console.log(`  - ${BOLD}Kas Bersih Anda${RESET}   : ${CYAN}${data.flywheelSummary.totalCreatorWeth.toFixed(6)} WETH${RESET} (35% tanpa jual koin)`);
  console.log(`  - ${BOLD}Auto Buyback/Burn${RESET} : ${MAGENTA}${data.flywheelSummary.totalBuybackWeth.toFixed(6)} WETH${RESET} (~${data.flywheelSummary.totalBurnedTokens.toLocaleString()} koin hangus ke 0xdead)`);
  console.log(`  - ${BOLD}Dividen Holders${RESET}   : ${GREEN}${data.flywheelSummary.totalDividendWeth.toFixed(6)} WETH${RESET} (20% ke Top Holders)`);
  console.log(`  - ${BOLD}Pool FOMO Jackpot${RESET} : ${YELLOW}${data.flywheelSummary.totalJackpotWeth.toFixed(6)} WETH${RESET} (15% timer 10-menit)\n`);

  // SECTION 3C: TOP AFFILIATE PROMOTORS LEADERBOARD
  console.log(`${BOLD}[5] TOP PROMOTOR & AFFILIATE LEADERBOARD (5% WETH BOUNTY)${RESET}`);
  if (data.topAffiliates.length === 0) {
    console.log(`  ${GRAY}(Belum ada promotor yang tercatat / Gunakan menu [12] untuk membuat link referral)${RESET}\n`);
  } else {
    for (const [idx, aff] of data.topAffiliates.entries()) {
      const rankBadge = `[#${idx + 1}]`;
      console.log(
        `  ${rankBadge} ${BOLD}${maskAddress(aff.affiliateAddress)}${RESET} | Komisi: ${GREEN}${aff.bountyEarnedWeth.toFixed(6)} WETH${RESET} | Volume: ${CYAN}${aff.volumeRoutedWeth.toFixed(6)} WETH${RESET} | Klaim: ${aff.claimCount}x`
      );
    }
    console.log("");
  }

  // SECTION 4: ACTIVE POSITIONS
  console.log(`${BOLD}[6] POSISI BUY & TRACKING PNL (TOP 5)${RESET}`);
  const topPositions = data.openPositions.slice(0, 5);
  if (topPositions.length === 0) {
    console.log(`  ${GRAY}(Tidak ada posisi aktif yang sedang dimonitor / Mode Modal Rp 0)${RESET}`);
  } else {
    for (const pos of topPositions) {
      const entryDisplay = pos.entryPrice ? `$${pos.entryPrice.toFixed(6)}` : "Pending Fill";
      console.log(`  - ${BOLD}$${pos.ticker || "TOKEN"}${RESET} (${pos.chain.toUpperCase()}): Status=${pos.status} | Snipe=${pos.snipeAmount} | Entry=${entryDisplay} | TP=${pos.takeProfitX}x | SL=-${(pos.stopLossPct * 100).toFixed(0)}%`);
    }
  }
  console.log("");

  // SECTION 5: WALLET ACCOUNTS & ROUTES
  console.log(`${BOLD}[7] WALLET ACCOUNTS & PROVIDER ROUTES${RESET}`);
  if (data.wallets.length === 0) {
    console.log(`  ${GRAY}(Belum ada dompet terdaftar di vault, menggunakan default dari .env)${RESET}`);
  } else {
    for (const w of data.wallets) {
      console.log(`  - ${BOLD}${w.id}${RESET} [${w.status}] - "${w.label}" | EVM: ${maskAddress(w.evmAddress)} | SOL: ${maskAddress(w.solanaAddress)}`);
      
      const credStatus = w.credentialRef
        ? resolveCredential(w.credentialRef)
          ? `${GREEN}${w.credentialRef} (Valid)${RESET}`
          : `${RED}${w.credentialRef} (Tidak ditemukan di .env!)${RESET}`
        : `${GRAY}Default (.env BANKR_API_KEY)${RESET}`;
      console.log(`     |-- API Key Ref: ${credStatus}`);

      const wRoutes = data.routes.filter((r) => r.walletId === w.id);
      if (wRoutes.length === 0) {
        console.log(`     |-- Rute Provider: ${GRAY}Direct (Tanpa Proxy)${RESET}`);
      } else {
        for (const r of wRoutes) {
          const proxy = r.proxyId ? data.proxies.find((p) => p.id === r.proxyId) : null;
          if (proxy) {
            const maskedUrl = buildProxyUrl(proxy, true);
            const isHealthy = proxy.status === "ACTIVE" && proxy.healthStatus === "available";
            const badge = isHealthy ? `${GREEN}READY${RESET}` : `${YELLOW}UNUSABLE (${proxy.healthStatus})${RESET}`;
            const latStr = proxy.latencyMs != null ? `${proxy.latencyMs}ms` : "n/a";
            console.log(`     |-- [${r.provider.toUpperCase()}] Status: ${badge} | Proxy: ${CYAN}${proxy.id}${RESET} (${maskedUrl}) | Latensi: ${GREEN}${latStr}${RESET}`);
          } else {
            const badge = r.status === "ACTIVE" ? `${GREEN}READY (DIRECT)${RESET}` : `${YELLOW}${r.status}${RESET}`;
            console.log(`     |-- [${r.provider.toUpperCase()}] Status: ${badge} | Proxy: ${GRAY}Direct / Tanpa Proxy${RESET}`);
          }
        }
      }
    }
  }

  // SUBSECTION: PROXY INFRASTRUCTURE POOL & FLAPPING COOLDOWN
  if (data.proxies.length > 0) {
    console.log(`\n  ${BOLD}Daftar Pool Proxy (${data.proxies.length} total di vault):${RESET}`);
    for (const p of data.proxies) {
      const maskedUrl = buildProxyUrl(p, true);
      const isHealthy = p.status === "ACTIVE" && p.healthStatus === "available";
      const latStr = p.latencyMs != null ? `${p.latencyMs}ms` : "-";
      if (p.status === "DISABLED") {
        const cd = evaluateQuarantineCooldown(p.id);
        const cdBadge = !cd.isEligible
          ? `${YELLOW}[DISABLED / FLAPPING COOLDOWN] (${cd.remainingMinutes}m tersisa | Penalti ${cd.penaltyHours}j | ${cd.recentFailures}x fail)${RESET}`
          : `${CYAN}[DISABLED / SIAP DIPULIHKAN]${RESET}`;
        console.log(`     [-] ${CYAN}${p.id.padEnd(18)}${RESET} ${cdBadge} (${latStr}) -> ${maskedUrl}`);
      } else {
        const badge = isHealthy ? `${GREEN}[ACTIVE/AVAILABLE]${RESET}` : `${RED}[ACTIVE/${p.healthStatus.toUpperCase()}]${RESET}`;
        console.log(`     [-] ${CYAN}${p.id.padEnd(18)}${RESET} ${badge} (${latStr}) -> ${maskedUrl}`);
      }
    }
  }
  console.log("");

  // SECTION 6: RECENT CYCLES
  console.log(`${BOLD}[8] RIWAYAT SIKLUS PIPELINE TERAKHIR (TOP 5)${RESET}`);
  const topCycles = data.recentCycles.slice(0, 5);
  if (topCycles.length === 0) {
    console.log(`  ${GRAY}(Belum ada riwayat siklus yang terekam)${RESET}`);
  } else {
    for (const c of topCycles) {
      const dur = c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : "n/a";
      const ok = c.deploymentsConfirmed ? `${GREEN}${c.deploymentsConfirmed} deploy live${RESET}` : `${GRAY}0 deploy${RESET}`;
      console.log(`  - Cycle #${c.id} (${c.startedAt.slice(11, 19)} UTC) | Durasi: ${dur} | Hasil: ${ok}`);
    }
  }

  console.log(`\n${CYAN}----------------------------------------------------------------------------------------${RESET}`);
  console.log(`${BOLD}PANDUAN PERINTAH OPERASIONAL / QUICK COMMAND REFERENCE (Salin & Jalankan di Terminal):${RESET}`);
  console.log(`  - Matriks Armada Lengkap (CSV/JSON) : ${CYAN}bun run scripts/view-fleet-matrix.ts --export${RESET}`);
  console.log(`  - Buat Paket Discovery & Promosi    : ${CYAN}bun run scripts/generate-token-offer.ts [TICKER] --save${RESET}`);
  console.log(`  - Rehearse Launchpad (Zero-Gas)     : ${CYAN}bun run scripts/rehearse-deployment.ts --fast${RESET}`);
  console.log(`  - Eksekusi Deploy Dinamis           : ${GREEN}bun run scripts/execute-dynamic-deployment.ts${RESET}`);
  console.log(`${CYAN}========================================================================================${RESET}\n`);
}

if (import.meta.main) {
  renderDashboard().catch((err) => {
    console.error("Dashboard error:", err);
    process.exit(1);
  });
}
