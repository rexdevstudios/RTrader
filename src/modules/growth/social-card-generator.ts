/**
 * src/modules/growth/social-card-generator.ts
 *
 * Automated 1200x630 OpenGraph & Twitter Card Vector Banner Generator.
 *
 * Generates crisp, retina-ready, lightweight SVG banner cards featuring:
 *  - Token Identity & Logo
 *  - Network Badge (Base / Solana / Robinhood)
 *  - GoPlus Security Audit Badge (100/100 Safe, 0% Tax)
 *  - 4 Tokenomics Flywheel Pillars (Buyback, Dividends, Jackpot, LP Lock)
 *  - Contract Address (CA) with explorer indicator
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../../logger.ts";

export interface SocialCardInput {
  name: string;
  ticker: string;
  contractAddress: string;
  chainDisplayName: string;
  primaryColor?: string;
  secondaryColor?: string;
  buyTax?: string;
  sellTax?: string;
  safetyScore?: number;
  buybackPct?: number;
  dividendPct?: number;
  jackpotPct?: number;
}

/**
 * Generates a clean, modern 1200x630 SVG OpenGraph / Twitter preview card.
 */
export function generateSocialCardSvg(input: SocialCardInput): string {
  const ticker = input.ticker.replace(/^\$/, "").toUpperCase();
  const name = input.name;
  const ca = input.contractAddress;
  const primaryColor = input.primaryColor || "#00ff66";
  const secondaryColor = input.secondaryColor || "#00ccff";
  const chainName = input.chainDisplayName || "Base Mainnet L2";
  const buyTax = input.buyTax || "0%";
  const sellTax = input.sellTax || "0%";
  const score = input.safetyScore !== undefined ? input.safetyScore : 100;
  const buyback = input.buybackPct !== undefined ? input.buybackPct : 30;
  const dividend = input.dividendPct !== undefined ? input.dividendPct : 20;
  const jackpot = input.jackpotPct !== undefined ? input.jackpotPct : 15;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" style="background:#030712; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <defs>
    <!-- Background Gradients -->
    <radialGradient id="bgGlow" cx="20%" cy="20%" r="80%">
      <stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.18" />
      <stop offset="50%" stop-color="${secondaryColor}" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#030712" stop-opacity="1" />
    </radialGradient>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${primaryColor}" />
      <stop offset="100%" stop-color="${secondaryColor}" />
    </linearGradient>
    <!-- Subtle Grid Pattern -->
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1f2937" stroke-width="0.75" stroke-opacity="0.4" />
    </pattern>
  </defs>

  <!-- Base Background & Grid -->
  <rect width="1200" height="630" fill="#030712" />
  <rect width="1200" height="630" fill="url(#bgGlow)" />
  <rect width="1200" height="630" fill="url(#grid)" />

  <!-- Outer Border -->
  <rect x="20" y="20" width="1160" height="590" rx="24" fill="none" stroke="#1f2937" stroke-width="2" stroke-opacity="0.8" />

  <!-- Network Badge (Top Left) -->
  <g transform="translate(60, 60)">
    <rect width="210" height="38" rx="19" fill="#111827" stroke="#374151" stroke-width="1.5" />
    <circle cx="20" cy="19" r="6" fill="#10b981" />
    <text x="36" y="24" fill="#9ca3af" font-size="14" font-weight="600" letter-spacing="0.5">${chainName.toUpperCase()}</text>
  </g>

  <!-- Audit Badge (Top Right) -->
  <g transform="translate(930, 60)">
    <rect width="210" height="38" rx="19" fill="rgba(16, 185, 129, 0.15)" stroke="#10b981" stroke-width="1.5" />
    <text x="105" y="24" text-anchor="middle" fill="#10b981" font-size="14" font-weight="800">AUDIT ${score}/100 SAFE</text>
  </g>

  <!-- Left Column: Token Identity -->
  <g transform="translate(60, 150)">
    <text x="0" y="70" fill="url(#brandGrad)" font-size="78" font-weight="900" letter-spacing="-1.5">$${ticker}</text>
    <text x="0" y="125" fill="#f3f4f6" font-size="34" font-weight="800">${name}</text>
    <text x="0" y="165" fill="#9ca3af" font-size="18" font-weight="400">Autonomous Web3 Protocol with Negative Net Emission &amp; Passive Dividends</text>

    <!-- Contract Address Pill Box -->
    <g transform="translate(0, 205)">
      <rect width="520" height="52" rx="14" fill="#090d16" stroke="#1f2937" stroke-width="1.5" />
      <text x="16" y="32" fill="#6b7280" font-size="13" font-family="monospace">CA:</text>
      <text x="45" y="32" fill="#e5e7eb" font-size="13" font-family="monospace" font-weight="600">${ca}</text>
    </g>
  </g>

  <!-- Right Column: 4 Tokenomics Matrix Cards -->
  <g transform="translate(640, 150)">
    <!-- Card 1: 0% Tax -->
    <g transform="translate(0, 0)">
      <rect width="235" height="120" rx="16" fill="#090d16" stroke="#1f2937" stroke-width="1.5" />
      <text x="24" y="52" fill="#10b981" font-size="36" font-weight="900">${buyTax} / ${sellTax}</text>
      <text x="24" y="82" fill="#ffffff" font-size="15" font-weight="700">Zero Trading Tax</text>
      <text x="24" y="102" fill="#6b7280" font-size="12">100% Fair Launch</text>
    </g>

    <!-- Card 2: Buyback & Burn -->
    <g transform="translate(265, 0)">
      <rect width="235" height="120" rx="16" fill="#090d16" stroke="#1f2937" stroke-width="1.5" />
      <text x="24" y="52" fill="${primaryColor}" font-size="36" font-weight="900">${buyback}%</text>
      <text x="24" y="82" fill="#ffffff" font-size="15" font-weight="700">Auto Buyback &amp; Burn</text>
      <text x="24" y="102" fill="#6b7280" font-size="12">Perpetual Deflation</text>
    </g>

    <!-- Card 3: Passive Dividends -->
    <g transform="translate(0, 145)">
      <rect width="235" height="120" rx="16" fill="#090d16" stroke="#1f2937" stroke-width="1.5" />
      <text x="24" y="52" fill="${secondaryColor}" font-size="36" font-weight="900">${dividend}%</text>
      <text x="24" y="82" fill="#ffffff" font-size="15" font-weight="700">Passive Dividends</text>
      <text x="24" y="102" fill="#6b7280" font-size="12">Direct Holder Airdrops</text>
    </g>

    <!-- Card 4: FOMO Jackpot -->
    <g transform="translate(265, 145)">
      <rect width="235" height="120" rx="16" fill="#090d16" stroke="#1f2937" stroke-width="1.5" />
      <text x="24" y="52" fill="#f59e0b" font-size="36" font-weight="900">${jackpot}%</text>
      <text x="24" y="82" fill="#ffffff" font-size="15" font-weight="700">10-Min FOMO Pool</text>
      <text x="24" y="102" fill="#6b7280" font-size="12">Game-Theoretic Buy Pressure</text>
    </g>
  </g>

  <!-- Bottom Brand Footer -->
  <g transform="translate(60, 560)">
    <circle cx="6" cy="-4" r="5" fill="${primaryColor}" />
    <text x="24" y="0" fill="#6b7280" font-size="14" font-weight="500">Autonomous Web3 Token Engine • DexScreener Verified • LP Locked &amp; Renounced</text>
  </g>
</svg>`;
}

/**
 * Saves the generated 1200x630 social card SVG file to the target website folder.
 */
export function saveSocialCardSvg(outputDir: string, input: SocialCardInput): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const filePath = path.join(outputDir, "og-image.svg");
  const svg = generateSocialCardSvg(input);
  fs.writeFileSync(filePath, svg, "utf-8");
  logger.success(`[SocialCard] OpenGraph SVG 1200x630 tersimpan di: ${filePath}`);
  return filePath;
}
