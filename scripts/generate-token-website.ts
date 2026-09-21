#!/usr/bin/env bun
/**
 * scripts/generate-token-website.ts
 *
 * Full Windows CLI Interactive Generator for Web3 Token Websites with 3D Parallax,
 * Local Browser Preview Server, Vercel 1-Click Hosting, and DNS Configuration Assistant.
 *
 * Usage:
 *   bun run scripts/generate-token-website.ts                 # Interactive selector
 *   bun run scripts/generate-token-website.ts <TICKER/CA>    # Specific token
 *   bun run scripts/generate-token-website.ts --preview      # Generate + Preview on localhost:3000
 *   bun run scripts/generate-token-website.ts --deploy       # Generate + Deploy to Vercel
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { exec, spawn } from "child_process";
import { getAllDeployLogs, type DeployLog } from "../src/db/vault.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import {
  detectSector,
  getSectorTheme,
  CURATED_GITHUB_TEMPLATES,
  SECTOR_THEMES,
  type ThemeStylePreset,
} from "../src/modules/growth/template-registry.ts";
import { analyzeContractAddress } from "../src/modules/intelligence/ca-intelligence.ts";
import { isLiveDeployment } from "../src/modules/fleet/fleet-registry.ts";
import {
  submitDexScreenerProfile,
  getDexScreenerUpdatePortalUrl,
} from "../src/modules/growth/dexscreener-profiler.ts";
import {
  provisionSubdomainDns,
  getManualDnsInstructions,
} from "../src/modules/growth/cloudflare-dns.ts";
import {
  deployWebsite,
  type MultiTargetDeployResult,
} from "../src/modules/growth/website-deployer.ts";
import { broadcastAndPinTokenWebsite } from "../src/modules/telegram/token-agent-bot.ts";
import { startWebsitePreviewServer } from "../src/modules/growth/website-previewer.ts";
import { evaluateLaunchReadiness } from "../src/modules/intelligence/launch-readiness-checker.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

function askQuestion(promptText: string, defaultValue: string = "", timeoutMs: number = 8000): Promise<string> {
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

async function startPreviewServer(siteDir: string, port = 3000): Promise<void> {
  await startWebsitePreviewServer({
    siteDir,
    port,
    openBrowser: true,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const isPreviewFlag = args.includes("--preview");
  const isDeployFlag = args.includes("--deploy");
  const isHeadless = args.includes("--headless") || process.env.CI === "true";
  const deployTargetArg = (args.find((a) => a.startsWith("--deploy-target="))?.split("=")[1] || "cloudflare") as "vercel" | "cloudflare" | "ipfs" | "both" | "all";
  const explicitCa = args.find((a) => a.startsWith("--ca="))?.split("=")[1]?.trim();
  const explicitChain = args.find((a) => a.startsWith("--chain="))?.split("=")[1]?.trim()?.toLowerCase();
  const explicitTemplate = (args.find((a) => a.startsWith("--template="))?.split("=")[1] ||
                            args.find((a) => a.startsWith("--sector="))?.split("=")[1])?.trim().toUpperCase();
  const explicitStyle = (args.find((a) => a.startsWith("--style="))?.split("=")[1] ||
                         args.find((a) => a.startsWith("--theme-style="))?.split("=")[1])?.trim().toUpperCase() as ThemeStylePreset | undefined;
  const tokenArg = args.find((a) => !a.startsWith("--"));

  console.log(`\n${BOLD}${MAGENTA}===============================================================================${RESET}`);
  console.log(`${BOLD}${MAGENTA}    [+] OMNICHAIN DEPLOYER - AUTOMATED 3D WEB3 WEBSITE GENERATOR [+]${RESET}`);
  console.log(`${BOLD}${MAGENTA}===============================================================================${RESET}\n`);

  // 1. Resolve Target Token from Vault or CLI Arg
  const logs = getAllDeployLogs();
  const liveTokens = logs.filter(isLiveDeployment);

  let targetLog: DeployLog | undefined;
  let manualName: string | undefined;
  let manualTicker: string | undefined;
  let manualCA: string | undefined;
  let manualChain = explicitChain || "base";

  if (explicitCa) {
    // If explicit CA provided, find matching live deployment first
    targetLog = liveTokens.find((l) => l.contractAddr?.toLowerCase() === explicitCa.toLowerCase()) ||
                logs.find((l) => l.contractAddr?.toLowerCase() === explicitCa.toLowerCase());
    if (!targetLog) {
      manualCA = explicitCa;
      manualTicker = tokenArg && !tokenArg.startsWith("0x") ? tokenArg.toUpperCase() : "TOKEN";
      manualName = manualTicker;
      manualChain = explicitChain || (explicitCa.startsWith("0x") ? "base" : "solana");
    }
  } else if (tokenArg) {
    // Prioritize genuine on-chain live deployments first (anti-collision against test simulations)
    targetLog = liveTokens.find(
      (l) =>
        l.contractAddr?.toLowerCase() === tokenArg.toLowerCase() ||
        l.ticker?.toLowerCase() === tokenArg.toLowerCase() ||
        l.tokenName?.toLowerCase() === tokenArg.toLowerCase()
    );

    // Fallback to all logs only if not found in live tokens
    if (!targetLog) {
      targetLog = logs.find(
        (l) =>
          l.contractAddr?.toLowerCase() === tokenArg.toLowerCase() ||
          l.ticker?.toLowerCase() === tokenArg.toLowerCase() ||
          l.tokenName?.toLowerCase() === tokenArg.toLowerCase()
      );
    }

    if (!targetLog) {
      if (tokenArg.startsWith("0x") || tokenArg.length >= 32) {
        manualCA = tokenArg;
        manualTicker = "TOKEN";
        manualName = "Web3 Token";
        manualChain = explicitChain || (tokenArg.startsWith("0x") ? "base" : "solana");
        console.log(`${YELLOW}⚠️ CA terdeteksi di luar database vault: ${manualCA}${RESET}`);
      } else {
        manualTicker = tokenArg.toUpperCase();
        manualName = tokenArg;
        manualCA = "0x000000000000000000000000000000000000dead";
        manualChain = explicitChain || "base";
      }
    }
  } else if (isHeadless) {
    // Headless / CI Mode: pick first live token or fallback to demo
    if (liveTokens.length > 0) {
      targetLog = liveTokens[0];
      console.log(`${CYAN}[CI/Headless] Memilih token live pertama dari vault: $${targetLog.ticker} (${targetLog.contractAddr})${RESET}`);
    } else {
      manualTicker = "DEMO";
      manualName = "Demo Token";
      manualCA = "0x000000000000000000000000000000000000dead";
      console.log(`${CYAN}[CI/Headless] Menggunakan token demo default.${RESET}`);
    }
  } else {
    // Interactive Menu
    console.log(`${CYAN}Token Terdaftar di Vault yang Siap Dibuatkan Website:${RESET}`);
    if (liveTokens.length === 0) {
      console.log(`  ${GRAY}(Tidak ada token live di vault. Menggunakan token demo/manual)${RESET}`);
    } else {
      liveTokens.slice(0, 5).forEach((t, i) => {
        const chainTag = (t.chain || "BASE").toUpperCase();
        console.log(`  [${i + 1}] $${t.ticker?.padEnd(8)} - ${t.tokenName} (${chainTag}) | CA: ${t.contractAddr?.slice(0, 10)}...`);
      });
    }
    console.log(`  [M] Masukkan Contract Address (CA) manual`);
    console.log(`  [Q] Keluar\n`);

    const choice = await askQuestion(`${BOLD}Pilih opsi [1-${Math.min(liveTokens.length, 5)} / M / Q]: ${RESET}`);
    if (choice.toLowerCase() === "q") {
      console.log("Keluar.");
      process.exit(0);
    }

    if (choice.toLowerCase() === "m") {
      manualCA = await askQuestion("Masukkan Contract Address (CA): ");
      manualTicker = (await askQuestion("Masukkan Ticker Token (misal INTEL): ")).toUpperCase();
      manualName = await askQuestion("Masukkan Nama Lengkap Token: ");
      manualChain = (await askQuestion("Jaringan [base / robinhood / solana] (default: base): ")) || "base";
    } else {
      const idx = parseInt(choice, 10) - 1;
      if (!isNaN(idx) && liveTokens[idx]) {
        targetLog = liveTokens[idx];
      } else if (liveTokens.length > 0) {
        targetLog = liveTokens[0];
      }
    }
  }

  const rawCA = targetLog?.contractAddr || manualCA || "0x000000000000000000000000000000000000dead";
  const finalChainName = explicitChain || targetLog?.chain || manualChain || "base";
  const finalChainId = finalChainName === "solana" ? 101 : finalChainName === "robinhood" ? 46688 : 8453;

  // Fetch live CA Intelligence to enrich metadata and sector taxonomy
  console.log(`\n${CYAN}🔍 Mengambil data audit & metrik DexScreener untuk CA: ${rawCA}...${RESET}`);
  let intelReport: any = null;
  try {
    intelReport = await analyzeContractAddress(rawCA, finalChainName);
  } catch (err: any) {
    console.log(`${GRAY}Catatan intel: ${err?.message || err}${RESET}`);
  }

  const finalName =
    targetLog?.tokenName ||
    (intelReport?.market?.tokenName && !intelReport.market.tokenName.startsWith("Token 0x") ? intelReport.market.tokenName : undefined) ||
    manualName ||
    "Autonomous Token";
  const finalTicker = (
    targetLog?.ticker ||
    (intelReport?.market?.tokenSymbol && intelReport.market.tokenSymbol !== "UNKNOWN" ? intelReport.market.tokenSymbol : undefined) ||
    manualTicker ||
    "TOKEN"
  ).toUpperCase();
  const finalCA = rawCA;
  const description = intelReport?.market?.dexUrl ? `${finalName} ($${finalTicker}) verified on DexScreener.` : undefined;
  const trendNarrative = targetLog?.signalSources ? targetLog.signalSources.join(" ") : "";

  // 2. Classify Web3 Sector & Theme
  let sector: Web3Sector = detectSector(finalName, finalTicker, description, trendNarrative);
  if (explicitTemplate && ["AI_AGENT", "DEFI_TREASURY", "VIRAL_MEME", "GAMING_UTILITY"].includes(explicitTemplate)) {
    sector = explicitTemplate as Web3Sector;
  } else if (!isHeadless && !explicitTemplate) {
    console.log(`\n${BOLD}🎨 PILIH TEMPLATE & ARCHETYPE WEB3:${RESET}`);
    console.log(`  [1] VIRAL_MEME    - 3D Card + 10-Min FOMO Jackpot + Live Buy Toast ${sector === "VIRAL_MEME" ? `${GREEN}(Terdeteksi)${RESET}` : ""}`);
    console.log(`  [2] AI_AGENT      - Cyber AI Terminal Sandbox + Matrix Rain ${sector === "AI_AGENT" ? `${GREEN}(Terdeteksi)${RESET}` : ""}`);
    console.log(`  [3] DEFI_TREASURY - Treasury Flywheel HUD + Burn Meter + Dividend Slider ${sector === "DEFI_TREASURY" ? `${GREEN}(Terdeteksi)${RESET}` : ""}`);
    console.log(`  [4] GAMING_UTILITY- Cyber Node Power HUD + DePIN Compute Hashrate ${sector === "GAMING_UTILITY" ? `${GREEN}(Terdeteksi)${RESET}` : ""}`);
    console.log(`  [Enter] Gunakan Template Terdeteksi (${sector})\n`);

    const tplChoice = await askQuestion(`${BOLD}Pilih Template [1-4 / Enter]: ${RESET}`, "", 6000);
    if (tplChoice === "1") sector = "VIRAL_MEME";
    else if (tplChoice === "2") sector = "AI_AGENT";
    else if (tplChoice === "3") sector = "DEFI_TREASURY";
    else if (tplChoice === "4") sector = "GAMING_UTILITY";
  }

  const theme = getSectorTheme(sector);

  console.log(`\n${BOLD}📊 HASIL ANALISIS TAKSONOMI WEB3 & SEKTOR:${RESET}`);
  console.log(`  Token:                  ${BOLD}$${finalTicker} (${finalName})${RESET}`);
  console.log(`  CA:                     ${CYAN}${finalCA}${RESET}`);
  console.log(`  Jaringan:               ${finalChainName.toUpperCase()} (Chain ID: ${finalChainId})`);
  console.log(`  Sektor Terklasifikasi:  ${BOLD}${GREEN}${sector}${RESET} (${theme.displayName})`);
  console.log(`  Efek Visual 3D:         ${CYAN}${theme.visualEffect}${RESET}`);
  console.log(`  Curated Template:       ${YELLOW}${theme.curatedTemplate.name}${RESET} (${theme.curatedTemplate.repoUrl})`);
  if (intelReport?.market?.priceUsd) {
    console.log(`  Harga / Likuiditas:     ${intelReport.market.priceUsd} | $${Number(intelReport.market.liquidityUsd || 0).toLocaleString()} USD`);
  }

  // 3. Dual-Engine Option: Standalone Bundle vs Curated GitHub Template
  console.log(`\n${BOLD}PILIH ENGINE PEMBUATAN WEBSITE:${RESET}`);
  console.log(`  [1] Standalone 3D Parallax Zero-Dependency Bundle (Rekomendasi / Siap Vercel)`);
  console.log(`  [2] Clone Curated GitHub Template (${theme.curatedTemplate.name})`);
  const engineChoice = isHeadless ? "1" : await askQuestion(`\nPilihan Engine [1/2, default 1]: `, "1", 6000);

  if (engineChoice === "2") {
    console.log(`\n${CYAN}📦 Mengkloning Curated GitHub Template: ${theme.curatedTemplate.repoUrl}...${RESET}`);
    const curatedDir = path.join(process.cwd(), "sites", `${finalTicker.toLowerCase()}-curated`);
    if (!fs.existsSync(curatedDir)) {
      try {
        await new Promise<void>((resolve, reject) => {
          exec(`git clone --depth=1 ${theme.curatedTemplate.repoUrl} "${curatedDir}"`, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log(`${GREEN}✅ Repository berhasil dikloning ke: ${curatedDir}${RESET}`);
      } catch (cloneErr: any) {
        console.log(`${YELLOW}⚠️ Gagal git clone: ${cloneErr?.message || cloneErr}. Melanjutkan dengan Standalone Engine.${RESET}`);
      }
    } else {
      console.log(`${YELLOW}ℹ️ Direktori template sudah ada di: ${curatedDir}${RESET}`);
    }

    // Write token configuration to curated repo
    try {
      const configDir = path.join(curatedDir, "config");
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const tokenConfigContent = `export const TOKEN_CONFIG = {
  name: "${finalName}",
  symbol: "${finalTicker}",
  contractAddress: "${finalCA}",
  chain: "${finalChainName}",
  chainId: ${finalChainId},
  sector: "${sector}",
  primaryColor: "${theme.primaryColor}",
  dexUrl: "${intelReport?.market?.dexUrl || `https://dexscreener.com/${finalChainName}/${finalCA}`}",
  generatedAt: "${new Date().toISOString()}",
};
`;
      fs.writeFileSync(path.join(configDir, "token.ts"), tokenConfigContent, "utf-8");
      console.log(`${GREEN}✅ Konfigurasi ${path.join(configDir, "token.ts")} berhasil diinjeksikan!${RESET}`);
    } catch (confErr: any) {
      console.log(`${YELLOW}⚠️ Catatan injeksi config: ${confErr?.message || confErr}${RESET}`);
    }
  }

  // 3.5 Visual Theme Style Selection (Generative UI)
  let chosenStyle: ThemeStylePreset | undefined = undefined;
  if (explicitStyle && ["NEO_BRUTALISM", "GLASSMORPHISM", "MINIMALIST_CLEAN", "RETRO_ARCADE"].includes(explicitStyle)) {
    chosenStyle = explicitStyle;
  } else if (!isHeadless && !explicitStyle) {
    console.log(`\n${BOLD}✨ PILIH VISUAL THEME STYLE (GENERATIVE UI):${RESET}`);
    console.log(`  [1] GLASSMORPHISM    - Dark Mode, Blur Backdrop, Neon Glow (Modern DeFi Standard)`);
    console.log(`  [2] NEO_BRUTALISM    - High Contrast, Solid 3px Borders, Hard 6px Drop-Shadows`);
    console.log(`  [3] MINIMALIST_CLEAN - Swiss Typography, Monospaced Accents, Subdued Slate Luxury`);
    console.log(`  [4] RETRO_ARCADE     - Cyber Scanlines, Pixel Borders, CRT Flicker, 80s Cyberpunk`);
    console.log(`  [Enter] Gunakan Gaya Otomatis Berdasarkan Sektor (${sector})\n`);

    const styleChoice = await askQuestion(`${BOLD}Pilih Visual Style [1-4 / Enter]: ${RESET}`, "", 6000);
    if (styleChoice === "1") chosenStyle = "GLASSMORPHISM";
    else if (styleChoice === "2") chosenStyle = "NEO_BRUTALISM";
    else if (styleChoice === "3") chosenStyle = "MINIMALIST_CLEAN";
    else if (styleChoice === "4") chosenStyle = "RETRO_ARCADE";
  }

  // 4. Generate Website Bundle (Standalone Zero-Dependency Engine)
  console.log(`\n${CYAN}Membuat Standalone 3D Web3 Bundle di sites/${finalTicker.toLowerCase()}...${RESET}`);
  const result = await generateTokenWebsite({
    name: finalName,
    ticker: finalTicker,
    contractAddress: finalCA,
    chainId: finalChainId,
    chainName: finalChainName,
    description,
    trendNarrative,
    customSector: sector,
    preferredStyle: chosenStyle,
  });

  console.log(`\n${GREEN}===============================================================================${RESET}`);
  console.log(`${GREEN}   [+] WEBSITE 3D PARALLAX BERHASIL DIGENERATE SECARA LOKAL! [+]${RESET}`);
  console.log(`${GREEN}===============================================================================${RESET}`);
  console.log(`Direktori Situs: ${CYAN}${result.siteDirectory}${RESET}`);
  console.log(`Index HTML:      ${result.indexHtmlPath}`);
  console.log(`Visual Style:    ${CYAN}${chosenStyle || "AUTO (" + sector + ")"}${RESET}`);
  console.log(`Environment:     ${result.envProductionPath}`);
  console.log(`CI/CD Workflow:  ${result.ciCdWorkflowPath}`);

  // 3. Post-Generation Actions: Preview, Deploy to Vercel/IPFS, or DNS Guide
  if (isPreviewFlag) {
    await startPreviewServer(result.siteDirectory);
    return;
  }

  if (isDeployFlag || isHeadless) {
    console.log(`\n${CYAN}🚀 [DEPLOYER] Menjalankan Multi-Target Deployment (${deployTargetArg.toUpperCase()})...${RESET}`);
    const depRes = await deployWebsite({
      siteDir: result.siteDirectory,
      ticker: finalTicker,
      contractAddress: finalCA,
      target: deployTargetArg,
    });

    console.log(`${GREEN}✅ ${depRes.message}${RESET}`);
    console.log(`🌐 Live Production URL: ${BOLD}${CYAN}${depRes.primaryUrl}${RESET}`);
    if (depRes.vercelResult?.cliInstruction) {
      console.log(`${GRAY}CLI Fallback: ${depRes.vercelResult.cliInstruction}${RESET}`);
    }

    if (isHeadless) {
      console.log(`\n${GREEN}[CI/Headless] Website build & deployment selesai secara otomatis.${RESET}`);
      return;
    }
  }

  console.log(`\n${BOLD}PILIH TINDAKAN SELANJUTNYA:${RESET}`);
  console.log(`  [1] Buka Preview Lokal di Browser (http://localhost:3000)`);
  console.log(`  [2] Deploy Multi-Target Instan (Cloudflare Pages Edge + Pinata IPFS)`);
  console.log(`  [3] Tampilkan Panduan DNS Custom Domain (CNAME & A Record)`);
  console.log(`  [4] Submit / Buka Portal Update Profil Resmi DexScreener`);
  console.log(`  [5] Buka / Salin Paket Pengumuman Peluncuran (Twitter/X & Telegram Blitz)`);
  console.log(`  [6] Cek Skor Kesiapan Peluncuran (Launch Readiness Preflight Score)`);
  console.log(`  [7] Selesai & Kembali ke Menu`);

  const nextAction = await askQuestion(`\nPilihan [1-7, default=7]: `, "7", 6000);

  if (nextAction === "1") {
    await startPreviewServer(result.siteDirectory);
  } else if (nextAction === "2") {
    console.log(`\n${CYAN}🚀 Menjalankan Multi-Target Deployment...${RESET}`);
    const depRes = await deployWebsite({
      siteDir: result.siteDirectory,
      ticker: finalTicker,
      contractAddress: finalCA,
      target: "both",
    });

    console.log(`\n${GREEN}🎉 Deployment Selesai!${RESET}`);
    console.log(`URL Utama:   ${BOLD}${CYAN}${depRes.primaryUrl}${RESET}`);
    if (depRes.ipfsResult?.ipfsUrl) {
      console.log(`URL IPFS:    ${CYAN}${depRes.ipfsResult.ipfsUrl}${RESET}`);
    }
    if (depRes.vercelResult?.cliInstruction) {
      console.log(`Instruksi CLI: ${GRAY}${depRes.vercelResult.cliInstruction}${RESET}`);
    }

    const askBcast = await askQuestion("\nSiarkan pengumuman resmi & sematkan (pin) WebApp di grup Telegram? [Y/N, default=Y]: ", "Y", 6000);
    if (askBcast.toLowerCase() !== "n") {
      console.log(`\n${CYAN}📢 Menyiarkan pengumuman Web3 DApp ke komunitas Telegram...${RESET}`);
      const bcast = await broadcastAndPinTokenWebsite(
        {
          address: finalCA,
          ticker: finalTicker,
          name: finalName,
          chain: finalChain,
        },
        { websiteUrl: depRes.primaryUrl }
      );
      if (bcast.success) {
        console.log(`${GREEN}✅ Berhasil disiarkan ke Telegram! (Message ID: ${bcast.messageId}${bcast.pinned ? ", Pinned 📌" : ""})${RESET}\n`);
      } else {
        console.log(`${YELLOW}ℹ️  Catatan siaran Telegram: ${bcast.error || "Grup/Token belum disetel"}${RESET}\n`);
      }
    }
  } else if (nextAction === "3") {
    console.log(`\n${MAGENTA}===============================================================================${RESET}`);
    console.log(`${MAGENTA}    [+] PENGATURAN DNS CUSTOM DOMAIN (CLOUDFLARE API / MANUAL CNAME) [+]${RESET}`);
    console.log(`${MAGENTA}===============================================================================${RESET}`);

    const hasCfConfig = Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID);
    if (hasCfConfig) {
      const rootDomain = process.env.ROOT_DOMAIN || "mytoken.xyz";
      console.log(`\n${GREEN}✨ Terdeteksi Konfigurasi Cloudflare API untuk domain: ${BOLD}${rootDomain}${RESET}`);
      const autoCf = await askQuestion(`Buat subdomain CNAME ${finalTicker.toLowerCase()}.${rootDomain} secara otomatis via API? [Y/N, default=Y]: `, "Y", 6000);
      if (autoCf.toLowerCase() !== "n") {
        console.log(`\n${CYAN}🚀 Mengirim permintaan pembuatan CNAME ke Cloudflare API v4...${RESET}`);
        const cfRes = await provisionSubdomainDns({
          ticker: finalTicker,
          contractAddress: finalCA,
          rootDomain,
        });
        if (cfRes.success) {
          console.log(`${GREEN}✅ ${cfRes.message}${RESET}`);
          console.log(`Domain URL: ${CYAN}https://${cfRes.fullDomain}${RESET}`);
          console.log(`\nLangkah Terakhir di Vercel:`);
          console.log(`  ${GRAY}cd ${result.siteDirectory}${RESET}`);
          console.log(`  ${GRAY}npx vercel domains add ${cfRes.fullDomain}${RESET}\n`);
        } else {
          console.log(`${YELLOW}⚠️ ${cfRes.message}${RESET}`);
          if (cfRes.manualGuide) console.log(`\n${cfRes.manualGuide}\n`);
        }
      } else {
        console.log(`\n` + getManualDnsInstructions(finalTicker.toLowerCase(), rootDomain) + `\n`);
      }
    } else {
      console.log(`\n` + getManualDnsInstructions(finalTicker.toLowerCase(), process.env.ROOT_DOMAIN || "yourdomain.xyz") + `\n`);
    }
  } else if (nextAction === "4") {
    console.log(`\n${CYAN}📡 Menyiapkan Profil Resmi Token untuk DexScreener...${RESET}`);
    const submitRes = await submitDexScreenerProfile(
      {
        chainId: finalChainId,
        tokenAddress: finalCA,
        tokenName: finalName,
        tokenSymbol: finalTicker,
        description: targetLog?.metadata ? JSON.parse(targetLog.metadata)?.description : undefined,
      },
      result.siteDirectory
    );

    console.log(`${GREEN}✅ ${submitRes.message}${RESET}`);
    console.log(`File JSON Tersimpan: ${CYAN}${path.join(result.siteDirectory, "dexscreener-profile.json")}${RESET}`);
    const fastTrackTextPath = path.join(result.siteDirectory, "dexscreener-fast-track.txt");
    if (fs.existsSync(fastTrackTextPath)) {
      console.log(`File Teks Fast-Track: ${CYAN}${fastTrackTextPath}${RESET}`);
      console.log(`\n${BOLD}${MAGENTA}--- 1-CLICK CLIPBOARD DATA UNTUK FORM UPDATE DEXSCREENER ($300 TIER) ---${RESET}`);
      console.log(fs.readFileSync(fastTrackTextPath, "utf-8"));
      console.log(`${BOLD}${MAGENTA}-------------------------------------------------------------------------${RESET}`);
    }
    console.log(`1-Click Portal Link : ${BOLD}${CYAN}${submitRes.portalUrl}${RESET}\n`);

    const openPortal = await askQuestion("Buka Portal Update DexScreener di browser sekarang? [Y/N, default=Y]: ", "N", 6000);
    if (openPortal.toLowerCase() !== "n") {
      openBrowser(submitRes.portalUrl);
    }
  } else if (nextAction === "5") {
    const launchTxtPath = result.launchAnnouncementPath || path.join(result.siteDirectory, "launch-announcement.txt");
    const telegramTxtPath = path.join(result.siteDirectory, "telegram-announcement.txt");
    console.log(`\n${MAGENTA}===============================================================================${RESET}`);
    console.log(`${MAGENTA}  [+] PAKET PENGUMUMAN PELUNCURAN RESMI (TWITTER / X & TELEGRAM BLITZ) [+]${RESET}`);
    console.log(`${MAGENTA}===============================================================================${RESET}`);
    if (fs.existsSync(launchTxtPath)) {
      console.log(`\n${fs.readFileSync(launchTxtPath, "utf-8")}\n`);
      console.log(`${GREEN}✅ Berkas teks Omnichannel tersimpan di: ${CYAN}${launchTxtPath}${RESET}`);
      if (fs.existsSync(telegramTxtPath)) {
        console.log(`${GREEN}✅ Berkas teks Telegram tersimpan di:    ${CYAN}${telegramTxtPath}${RESET}\n`);
      }
    } else {
      console.log(`${YELLOW}⚠️ Berkas announcement belum ditemukan. Menjalankan generator langsung...${RESET}`);
      const pack = generateLaunchAnnouncementPack({
        ticker: finalTicker,
        name: finalName,
        contractAddress: finalCA,
        chain: finalChainName,
        websiteUrl: result.liveUrl,
      });
      const saved = saveLaunchAnnouncementPack(result.siteDirectory, pack);
      console.log(`\n${pack.fullText}\n`);
      console.log(`${GREEN}✅ Berkas tersimpan di: ${CYAN}${saved.txtPath}${RESET}\n`);
    }
  } else if (nextAction === "6") {
    console.log(`\n${CYAN}🔍 Mengevaluasi 10 checkpoint kesiapan peluncuran untuk $${finalTicker}...${RESET}`);
    const report = await evaluateLaunchReadiness({
      ticker: finalTicker,
      contractAddress: finalCA,
      name: finalName,
      chain: finalChainName,
      siteDir: result.siteDirectory,
    });

    console.log(`\n${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    console.log(`${BOLD}📋 TABEL HASIL EVALUASI 10 CHECKPOINT KESIAPAN:${RESET}`);
    console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);

    report.items.forEach((item, idx) => {
      const num = (idx + 1).toString().padStart(2, " ");
      let badge = `${GREEN}[LULUS]  ${RESET}`;
      let scoreColor = GREEN;
      if (item.status === "WARN") {
        badge = `${YELLOW}[PERINGATAN]${RESET}`;
        scoreColor = YELLOW;
      } else if (item.status === "FAIL") {
        badge = `${RED}[GAGAL]  ${RESET}`;
        scoreColor = RED;
      }

      console.log(
        `${num}. ${badge} ${BOLD}${item.name}${RESET}  ${scoreColor}(+${item.score}/${item.weight} pts)${RESET}`
      );
      console.log(`    ${GRAY}Kategori: ${item.category} | Detail: ${item.details}${RESET}`);
      if (item.remediation) {
        console.log(`    ${YELLOW}💡 Saran: ${item.remediation}${RESET}`);
      }
      console.log("");
    });

    console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
    let scoreBoxColor = GREEN;
    if (report.verdict === "ACCEPTABLE_WITH_WARNINGS") scoreBoxColor = YELLOW;
    if (report.verdict === "NOT_READY") scoreBoxColor = RED;

    console.log(`${BOLD}${scoreBoxColor}📊 SKOR KESIAPAN AKHIR: [ ${report.overallScore} / 100 ] ${report.verdictEmoji}${RESET}`);
    console.log(`${BOLD}${scoreBoxColor}VONIS: ${report.summary}${RESET}`);
    console.log(`${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);
  }
}

main().catch((err) => {
  console.error(`${RED}[ERROR] ${err.message}${RESET}`);
  process.exit(1);
});
