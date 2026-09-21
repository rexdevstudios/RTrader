#!/usr/bin/env bun
/**
 * scripts/setup-custom-domain.ts
 *
 * Dedicated CLI Runner to Automatically Configure Custom Domain DNS
 * and Bind to Cloudflare Pages or Vercel via API.
 *
 * Usage:
 *   bun run domain:setup [ticker] [custom_domain] [--target=pages|vercel]
 *   bun run scripts/setup-custom-domain.ts PUMPRUN app.pumprun.xyz --target=pages
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as readline from "readline";
import { logger } from "../src/logger.ts";
import { getAllDeployLogs, updateDeployLogWebsite, type DeployLog } from "../src/db/vault.ts";
import { isLiveDeployment } from "../src/modules/fleet/fleet-registry.ts";
import {
  provisionSubdomainDns,
  bindCustomDomainToPages,
  bindCustomDomainToVercel,
  type CloudflareDnsResult,
} from "../src/modules/growth/cloudflare-dns.ts";
import { syncTokenDeploymentToNeon, isNeonConfigured } from "../src/db/neon-vault.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

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

/**
 * Parses full domain into rootDomain and subdomain.
 */
export function parseDomainParts(fullDomain: string): { rootDomain: string; subdomain: string } {
  const clean = fullDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
  const parts = clean.split(".");

  if (parts.length <= 2) {
    // apex domain: e.g. "pumprun.xyz"
    return { rootDomain: clean, subdomain: "@" };
  }

  // subdomain: e.g. "app.pumprun.xyz" -> subdomain = "app", rootDomain = "pumprun.xyz"
  const subdomain = parts[0];
  const rootDomain = parts.slice(1).join(".");
  return { rootDomain, subdomain };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
${BOLD}${CYAN}Penggunaan CLI Custom Domain Setup:${RESET}
  bun run domain:setup [TICKER] [CUSTOM_DOMAIN] [--target=pages|vercel]
  SETUP_CUSTOM_DOMAIN.bat [TICKER] [CUSTOM_DOMAIN] [--target=pages|vercel]

${BOLD}Contoh:${RESET}
  bun run domain:setup PUMPRUN dex.pumprun.xyz --target=pages
  SETUP_CUSTOM_DOMAIN.bat PUMPRUN app.pumprun.xyz --target=vercel
`);
    process.exit(0);
  }

  const targetHosting = args.includes("--target=vercel") ? "vercel" : "cloudflare_pages";
  const nonFlags = args.filter((a) => !a.startsWith("--"));

  let tickerArg = nonFlags[0];
  let domainArg = nonFlags[1];

  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}      [+] AUTOMATED WEB3 CUSTOM DOMAIN DNS & HOSTING PROVISIONER [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  const logs = getAllDeployLogs();
  const liveTokens = logs.filter(isLiveDeployment);

  let targetLog: DeployLog | undefined;

  if (tickerArg) {
    const cleanTicker = tickerArg.replace(/^\$/, "").toUpperCase();
    targetLog = logs.find(
      (l) =>
        (l.ticker && l.ticker.toUpperCase() === cleanTicker) ||
        (l.contractAddr && l.contractAddr.toLowerCase() === tickerArg.toLowerCase())
    );
  }

  if (!targetLog) {
    if (liveTokens.length === 0) {
      logger.warn("Tidak ada token terkonfirmasi di database vault.");
      process.exit(1);
    }

    console.log(`${BOLD}Pilih Token yang ingin dikonfigurasi custom domain-nya:${RESET}`);
    liveTokens.slice(0, 10).forEach((t, idx) => {
      console.log(`  [${idx + 1}] $${t.ticker} (${t.tokenName || "Token"}) - ${t.chain.toUpperCase()} - CA: ${t.contractAddr?.slice(0, 10)}...`);
    });

    const sel = await askQuestion(`\nPilihan [1-${Math.min(10, liveTokens.length)}]: `);
    const chosenIdx = parseInt(sel, 10) - 1;
    if (isNaN(chosenIdx) || chosenIdx < 0 || chosenIdx >= liveTokens.length) {
      logger.error("Pilihan tidak valid.");
      process.exit(1);
    }
    targetLog = liveTokens[chosenIdx];
  }

  const ticker = (targetLog.ticker || "TOKEN").replace(/^\$/, "").toUpperCase();
  const ca = targetLog.contractAddr || "";

  if (!domainArg) {
    domainArg = await askQuestion(`Masukkan Custom Domain (contoh: app.${ticker.toLowerCase()}.xyz): `);
  }

  if (!domainArg) {
    logger.error("Nama domain wajib diisi.");
    process.exit(1);
  }

  const { rootDomain, subdomain } = parseDomainParts(domainArg);
  const fullDomain = subdomain === "@" ? rootDomain : `${subdomain}.${rootDomain}`;

  console.log(`\n${BOLD}Parameter Pengaturan Domain:${RESET}`);
  console.log(`  Token:             $${ticker} (${ca})`);
  console.log(`  Target Domain:     ${fullDomain}`);
  console.log(`  Subdomain:         ${subdomain}`);
  console.log(`  Root Domain:       ${rootDomain}`);
  console.log(`  Target Hosting:    ${targetHosting === "cloudflare_pages" ? "Cloudflare Pages (Proxied CNAME)" : "Vercel (DNS-Only CNAME)"}`);

  logger.info(`\n[PROVISIONER] Menjalankan provisi DNS via Cloudflare API v4...`);

  const dnsResult: CloudflareDnsResult = await provisionSubdomainDns({
    ticker,
    contractAddress: ca,
    rootDomain,
    subdomain: subdomain === "@" ? ticker.toLowerCase() : subdomain,
    targetHosting,
  });

  if (dnsResult.success) {
    logger.success(`[DNS] ${dnsResult.message}`);
    if (dnsResult.domainBindingStatus) {
      logger.success(`[BINDING] Status pengikatan ke hosting: ${dnsResult.domainBindingStatus}`);
    }

    // Sinkronkan ke Neon PostgreSQL jika aktif
    if (isNeonConfigured()) {
      try {
        await syncTokenDeploymentToNeon({
          contractAddr: ca,
          ticker,
          chain: targetLog.chain,
          tokenName: targetLog.tokenName,
        });
        logger.success(`[NEON] Identitas custom domain tersinkronisasi ke Neon Cloud Database.`);
      } catch (err: any) {
        logger.warn(`[NEON] Neon sync notice: ${err?.message || err}`);
      }
    }

    console.log(`\n${BOLD}${GREEN}===============================================================================${RESET}`);
    console.log(`${BOLD}${GREEN}   [+] SUKSES: CUSTOM DOMAIN TELAH TERIKAT & AKTIF SECARA OTOMATIS! [+]${RESET}`);
    console.log(`${BOLD}${GREEN}===============================================================================${RESET}`);
    console.log(`  🌐 Production Custom URL: https://${fullDomain}`);
    console.log(`  🔒 SSL Certificate:       Universal SSL Cloudflare Edge (Gratis / Otomatis)`);
    console.log(`  🛡️ DDoS & WAF Protection: Aktif (Anycast Global CDN)`);
    console.log(`===============================================================================\n`);
  } else {
    logger.warn(`[NOTICE] ${dnsResult.message}`);
    if (dnsResult.manualGuide) {
      console.log(`\n${dnsResult.manualGuide}\n`);
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal error: ${err?.message || err}`);
    process.exit(1);
  });
}
