#!/usr/bin/env bun
/**
 * scripts/deploy-cloudflare-pages.ts
 *
 * Dedicated CLI 1-Command Git-less Deployer for Cloudflare Pages.
 *
 * Usage:
 *   bun run scripts/deploy-cloudflare-pages.ts [ticker/CA] [--project=<name>] [--dry-run]
 *   bun run deploy:pages [ticker]
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { logger } from "../src/logger.ts";
import { getLiveDeployments, resolveTargetToken } from "../src/modules/fleet/fleet-registry.ts";
import { getAllDeployLogs, updateDeployLogWebsite, type DeployLog } from "../src/db/vault.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import { deployWebsiteToCloudflarePages } from "../src/modules/growth/website-deployer.ts";
import { broadcastAndPinTokenWebsite } from "../src/modules/telegram/token-agent-bot.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const GRAY = "\x1b[90m";

function askQuestion(promptText: string, defaultValue: string = "", timeoutMs: number = 5000): Promise<string> {
  const isNonInteractive = !process.stdin.isTTY ||
    process.env.CI === "true" ||
    process.env.NON_INTERACTIVE === "true" ||
    process.argv.includes("--yes") ||
    process.argv.includes("-y");

  if (isNonInteractive) {
    console.log(`${promptText}${defaultValue || "(auto)"} [Auto: non-interactive]`);
    return Promise.resolve(defaultValue);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        rl.close();
        console.log(`\n⏰ [TIMEOUT] Tidak ada konfirmasi dalam ${timeoutMs / 1000}s. Menggunakan nilai default: "${defaultValue}"`);
        resolve(defaultValue);
      }
    }, timeoutMs);

    rl.question(promptText, (answer) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rl.close();
        const trimmed = answer.trim();
        resolve(trimmed || defaultValue);
      }
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const projectArg = args.find((a) => a.startsWith("--project="));
  const customProjectName = projectArg ? projectArg.split("=")[1]?.trim() : undefined;
  const explicitTemplate = (args.find((a) => a.startsWith("--template="))?.split("=")[1] ||
                            args.find((a) => a.startsWith("--sector="))?.split("=")[1])?.trim().toUpperCase();
  const tokenArg = args.find((a) => !a.startsWith("--"));

  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}   [+] CLOUDFLARE PAGES DIRECT GIT-LESS WEB3 DEPLOYER [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  let targetCA: string | undefined;
  let targetTicker: string | undefined;
  let targetName: string | undefined;
  let targetChain: string = "base";

  if (tokenArg) {
    const resolved = resolveTargetToken(tokenArg);
    targetCA = resolved.address;
    targetTicker = resolved.ticker;
    targetName = resolved.name;
    targetChain = resolved.chain || "base";
  } else {
    // Interactive selector from Vault
    const allLogs = getAllDeployLogs();
    const live = allLogs.filter((l) => l.contractAddress && l.status === "confirmed");

    if (live.length === 0) {
      console.log(`${YELLOW}⚠️  Tidak ditemukan token yang berstatus confirmed di database vault.${RESET}`);
      targetTicker = await askQuestion("Masukkan Ticker Token (contoh: PUMPRUN): ", "PUMPRUN", 5000);
      targetCA = await askQuestion("Masukkan Contract Address (CA): ", "0x0a99f4251A461e8abC693a56BB837fD815D51BA3", 5000);
      targetName = targetTicker;
    } else {
      console.log(`Daftar token aktif di armada (${live.length} ditemukan):`);
      live.slice(0, 8).forEach((l, idx) => {
        console.log(`  [${idx + 1}] $${l.tokenSymbol || l.tokenName} (${l.contractAddress.slice(0, 10)}...) - ${l.chain || "base"}`);
      });
      const choice = await askQuestion(`\nPilih token [1-${Math.min(8, live.length)}, default=1]: `, "1", 5000);
      const selIdx = parseInt(choice, 10) - 1;
      const selected = !isNaN(selIdx) && live[selIdx] ? live[selIdx] : live[0];
      targetCA = selected.contractAddress;
      targetTicker = selected.tokenSymbol || selected.tokenName;
      targetName = selected.tokenName || targetTicker;
      targetChain = selected.chain || "base";
    }
  }

  const cleanTicker = (targetTicker || "TOKEN").replace(/^\$/, "").toUpperCase();
  const siteDir = path.resolve(process.cwd(), "sites", cleanTicker.toLowerCase());

  console.log(`Target Token      : ${BOLD}$${cleanTicker}${RESET} (${targetName || cleanTicker})`);
  console.log(`Contract Address  : ${BOLD}${targetCA || "0x..."}${RESET}`);
  console.log(`Direktori Situs   : ${siteDir}`);

  // Check if site bundle exists
  if (!fs.existsSync(siteDir) || !fs.existsSync(path.join(siteDir, "index.html"))) {
    console.log(`\n${YELLOW}ℹ️  Bundle situs belum di-generate. Membangun situs 3D Parallax sekarang...${RESET}`);
    await generateTokenWebsite({
      name: targetName || cleanTicker,
      ticker: cleanTicker,
      contractAddress: targetCA || "0x000000000000000000000000000000000000dead",
      chainId: targetChain.toLowerCase() === "solana" ? 101 : 8453,
      chainName: targetChain,
      customSector: (explicitTemplate as any) || undefined,
      outputDir: siteDir,
    });
    console.log(`${GREEN}✅ Situs berhasil dibangun di: ${siteDir}${RESET}`);
  }

  console.log(`\n${CYAN}🚀 Mengirimkan bundle situs ke Cloudflare Pages Edge Network...${RESET}`);
  const result = await deployWebsiteToCloudflarePages({
    siteDir,
    ticker: cleanTicker,
    contractAddress: targetCA,
    projectName: customProjectName,
    chain: targetChain,
  });

  console.log(`\n${BOLD}${GREEN}===============================================================================${RESET}`);
  console.log(`${BOLD}${GREEN}   🎉 CLOUDFLARE PAGES DEPLOYMENT BERHASIL!${RESET}`);
  console.log(`${BOLD}${GREEN}===============================================================================${RESET}`);
  console.log(`Provider          : ${result.provider}`);
  console.log(`Production URL    : ${BOLD}${CYAN}${result.deploymentUrl}${RESET}`);
  if (result.cliInstruction) {
    console.log(`Wrangler CLI      : ${GRAY}${result.cliInstruction}${RESET}`);
  }
  console.log(`Pesan             : ${result.message}\n`);

  // Offer Telegram community broadcast
  const targetTokenObj = {
    address: targetCA || "0x000000000000000000000000000000000000dead",
    ticker: cleanTicker,
    name: targetName || cleanTicker,
    chain: targetChain,
  };

  const autoBroadcast = process.env.AUTO_TELEGRAM_BROADCAST === "true";
  let shouldBroadcast = autoBroadcast;
  if (!autoBroadcast && !args.includes("--no-broadcast") && !isDryRun) {
    const promptAns = await askQuestion("Siarkan pengumuman resmi & sematkan (pin) WebApp di grup Telegram? [Y/N, default=Y]: ", "Y", 5000);
    shouldBroadcast = promptAns.toLowerCase() !== "n";
  }

  if (shouldBroadcast) {
    console.log(`\n${CYAN}📢 Menyiarkan pengumuman Web3 DApp ke komunitas Telegram...${RESET}`);
    const bcast = await broadcastAndPinTokenWebsite(targetTokenObj, {
      websiteUrl: result.deploymentUrl,
    });
    if (bcast.success) {
      console.log(`${GREEN}✅ Berhasil disiarkan ke Telegram! (Message ID: ${bcast.messageId}${bcast.pinned ? ", Pinned 📌" : ""})${RESET}\n`);
    } else {
      console.log(`${YELLOW}ℹ️  Catatan siaran Telegram: ${bcast.error || "Grup/Token belum disetel"}${RESET}`);
      console.log(`${GRAY}   (Setel TELEGRAM_BOT_TOKEN dan COMMUNITY_TELEGRAM_CHANNEL di .env untuk siaran otomatis)${RESET}\n`);
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal error in Cloudflare Pages deployer: ${err?.message || err}`);
    process.exit(1);
  });
}
