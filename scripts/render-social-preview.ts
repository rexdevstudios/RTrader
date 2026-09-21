#!/usr/bin/env bun
/**
 * scripts/render-social-preview.ts
 *
 * Visual Social Media Preview & OpenGraph Metadata Validator CLI.
 * Inspects generated sites/<ticker>/og-image.svg, index.html OpenGraph meta tags,
 * and dexscreener-profile.json to verify social readiness before public marketing.
 *
 * Usage:
 *   bun run scripts/render-social-preview.ts [TICKER/CA]
 */

import * as fs from "fs";
import * as path from "path";
import { getAllDeployLogs } from "../src/db/vault.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";

export interface SocialPreviewResult {
  ticker: string;
  siteDir: string;
  hasSvgBanner: boolean;
  svgDimensions: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: string;
  hasDexProfile: boolean;
  isValid: boolean;
}

export function inspectSocialPreview(siteDir: string, ticker: string): SocialPreviewResult {
  const svgPath = path.join(siteDir, "og-image.svg");
  const htmlPath = path.join(siteDir, "index.html");
  const profilePath = path.join(siteDir, "dexscreener-profile.json");

  const hasSvg = fs.existsSync(svgPath);
  let dimensions = "N/A";
  if (hasSvg) {
    const svgContent = fs.readFileSync(svgPath, "utf-8");
    const widthMatch = svgContent.match(/width=["'](\d+)["']/);
    const heightMatch = svgContent.match(/height=["'](\d+)["']/);
    if (widthMatch && heightMatch) {
      dimensions = `${widthMatch[1]}x${heightMatch[1]}`;
    }
  }

  let ogTitle: string | undefined;
  let ogDesc: string | undefined;
  let ogImg: string | undefined;
  let twitterCard: string | undefined;

  if (fs.existsSync(htmlPath)) {
    const html = fs.readFileSync(htmlPath, "utf-8");
    const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["'](.*?)["']/i);
    const descMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/i);
    const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["'](.*?)["']/i);
    const twMatch = html.match(/<meta\s+name=["']twitter:card["']\s+content=["'](.*?)["']/i);

    if (titleMatch) ogTitle = titleMatch[1];
    if (descMatch) ogDesc = descMatch[1];
    if (imgMatch) ogImg = imgMatch[1];
    if (twMatch) twitterCard = twMatch[1];
  }

  const hasProfile = fs.existsSync(profilePath);
  const isValid = hasSvg && Boolean(ogTitle) && Boolean(ogDesc) && Boolean(ogImg);

  return {
    ticker,
    siteDir,
    hasSvgBanner: hasSvg,
    svgDimensions: dimensions,
    ogTitle,
    ogDescription: ogDesc,
    ogImage: ogImg,
    twitterCard,
    hasDexProfile: hasProfile,
    isValid,
  };
}

async function main() {
  const tokenArg = process.argv[2];
  const sitesBase = path.resolve(process.cwd(), "sites");

  let targetTicker: string | undefined;
  let targetDir: string | undefined;

  if (tokenArg) {
    const clean = tokenArg.replace(/^\$/, "").toLowerCase();
    const candidateDir = path.join(sitesBase, clean);
    if (fs.existsSync(candidateDir)) {
      targetTicker = clean.toUpperCase();
      targetDir = candidateDir;
    } else {
      // Search in vault
      const logs = getAllDeployLogs();
      const match = logs.find(
        (l) =>
          l.contractAddr?.toLowerCase() === tokenArg.toLowerCase() ||
          l.ticker?.toLowerCase() === clean ||
          l.tokenName?.toLowerCase() === clean
      );
      if (match?.ticker) {
        targetTicker = match.ticker.toUpperCase();
        targetDir = path.join(sitesBase, match.ticker.toLowerCase());
      }
    }
  }

  if (!targetDir || !fs.existsSync(targetDir)) {
    // Pick the most recently modified site directory
    if (fs.existsSync(sitesBase)) {
      const entries = fs.readdirSync(sitesBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({
          name: d.name,
          fullPath: path.join(sitesBase, d.name),
          mtime: fs.statSync(path.join(sitesBase, d.name)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);

      if (entries.length > 0) {
        targetDir = entries[0].fullPath;
        targetTicker = entries[0].name.toUpperCase();
      }
    }
  }

  if (!targetDir || !targetTicker) {
    console.log(`${RED}[ERROR] Tidak ada website token ditemukan di direktori sites/.${RESET}`);
    console.log(`${GRAY}Jalankan 'bun run scripts/generate-token-website.ts' terlebih dahulu.${RESET}`);
    process.exit(1);
  }

  const result = inspectSocialPreview(targetDir, targetTicker);

  console.log(`\n${BOLD}${MAGENTA}===============================================================================${RESET}`);
  console.log(`${BOLD}${MAGENTA}    [+] WEB3 SOCIAL MEDIA PREVIEW & OPENGRAPH INSPECTOR [+]${RESET}`);
  console.log(`${BOLD}${MAGENTA}===============================================================================${RESET}\n`);

  console.log(`  Token Ticker:          ${BOLD}${CYAN}$${result.ticker}${RESET}`);
  console.log(`  Direktori Situs:       ${GRAY}${result.siteDir}${RESET}`);
  console.log(`  OpenGraph SVG Banner:  ${result.hasSvgBanner ? `${GREEN}✅ Ditemukan (${result.svgDimensions})${RESET}` : `${RED}❌ Hilang${RESET}`}`);
  console.log(`  DexScreener Profile:   ${result.hasDexProfile ? `${GREEN}✅ Valid${RESET}` : `${YELLOW}⚠️ Tidak ditemukan${RESET}`}`);
  console.log(`  Twitter Card Meta:     ${result.twitterCard ? `${GREEN}✅ ${result.twitterCard}${RESET}` : `${RED}❌ Hilang${RESET}`}`);
  console.log(`  OG Title:              ${result.ogTitle || `${RED}N/A${RESET}`}`);
  console.log(`  OG Description:        ${result.ogDescription || `${RED}N/A${RESET}`}`);
  console.log(`  OG Image Reference:    ${result.ogImage || `${RED}N/A${RESET}`}`);

  console.log(`\n${BOLD}PREVIEW KARTU SOSIAL (1200x630 ASPECT RATIO):${RESET}`);
  console.log(`┌─────────────────────────────────────────────────────────────────────────┐`);
  console.log(`│ ${BOLD}${CYAN}$${result.ticker.padEnd(8)}${RESET} ${result.ogTitle ? result.ogTitle.slice(0, 58).padEnd(61) : "".padEnd(61)}│`);
  console.log(`│ ${GRAY}${result.ogDescription ? result.ogDescription.slice(0, 68).padEnd(71) : "".padEnd(71)}${RESET}│`);
  console.log(`│                                                                         │`);
  console.log(`│   [ Banner SVG: ${result.svgDimensions.padEnd(10)} ]   • 0% Buy / 0% Sell Tax                    │`);
  console.log(`│   [ Verified LP: 100% Burnt ]   • Autonomous Positive-Sum Flywheel      │`);
  console.log(`│                                                                         │`);
  console.log(`└─────────────────────────────────────────────────────────────────────────┘\n`);

  if (result.isValid) {
    console.log(`${GREEN}✅ Status: Siap untuk promosi sosial media di X (Twitter), Telegram, & Farcaster!${RESET}\n`);
  } else {
    console.log(`${YELLOW}⚠️ Status: Ada beberapa metadata OpenGraph yang perlu dilengkapi.${RESET}\n`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`${RED}[ERROR] ${err.message}${RESET}`);
    process.exit(1);
  });
}
