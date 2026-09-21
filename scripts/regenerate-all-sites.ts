/**
 * scripts/regenerate-all-sites.ts
 *
 * Batch Website Regeneration Engine with UI/UX Pro Max Archetypes.
 *
 * Scans all existing websites in `sites/`, resolves their metadata (via token.config.json
 * or SQLite vault.db), determines their sector archetype (Bento DApp, Cyber Terminal,
 * Neo-Brutalist Meme, or Swiss Clean), and regenerates each bundle with full on-chain
 * Doppler Settler swap capabilities.
 */

import * as fs from "fs";
import * as path from "path";
import { Database } from "bun:sqlite";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import { detectSector, ThemeStylePreset, Web3Sector } from "../src/modules/growth/template-registry.ts";
import { DB_PATH } from "../src/db/vault.ts";

interface SiteMetadata {
  subfolder: string;
  name: string;
  ticker: string;
  ca: string;
  chain: string;
  sector: Web3Sector;
  themeStyle: ThemeStylePreset;
}

async function main() {
  console.log("================================================================================");
  console.log("   BATCH REGENERATION ENGINE: UI/UX PRO MAX & DOPPLER SETTLER ARCHETYPES");
  console.log("================================================================================");

  const sitesDir = path.resolve(process.cwd(), "sites");
  if (!fs.existsSync(sitesDir)) {
    console.error(`Direktori sites tidak ditemukan di: ${sitesDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(sitesDir, { withFileTypes: true });
  const siteFolders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("test_") && e.name !== "unknown")
    .map((e) => e.name);

  console.log(`Menemukan ${siteFolders.length} subdirektori website untuk diregenerasi:`);
  console.log(siteFolders.join(", "));
  console.log("--------------------------------------------------------------------------------\n");

  const db = new Database(DB_PATH);

  const stats = {
    total: siteFolders.length,
    success: 0,
    failed: 0,
    results: [] as Array<{ subfolder: string; ticker: string; sector: string; style: string; status: string }>,
  };

  for (const folder of siteFolders) {
    const folderPath = path.join(sitesDir, folder);
    const configPath = path.join(folderPath, "token.config.json");

    let meta: SiteMetadata | null = null;

    // 1. Try reading token.config.json
    if (fs.existsSync(configPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (raw.contractAddress && raw.ticker) {
          const chain = (raw.chain || "base").toLowerCase();
          const sector: Web3Sector = raw.sector || detectSector(raw.name || folder, raw.ticker, "");
          
          let themeStyle: ThemeStylePreset = "NEO_BRUTALISM";
          if (folder === "pumprun" || sector === "DEFI_TREASURY") {
            themeStyle = "BENTO_GRID_DAPP";
          } else if (sector === "AI_AGENT" || sector === "GAMING_UTILITY") {
            themeStyle = "CYBER_TERMINAL_HUD";
          } else if (sector === "VIRAL_MEME") {
            themeStyle = "NEO_BRUTALISM";
          }

          meta = {
            subfolder: folder,
            name: raw.name || folder.toUpperCase(),
            ticker: raw.ticker,
            ca: raw.contractAddress,
            chain,
            sector,
            themeStyle,
          };
        }
      } catch (err: any) {
        console.warn(`[Skip] Gagal membaca config ${configPath}: ${err.message}`);
      }
    }

    // 2. Fallback: Query SQLite database
    if (!meta) {
      try {
        const row = db.query(
          "SELECT token_name, ticker, contract_addr, chain FROM deploy_logs WHERE LOWER(ticker) = ? OR contract_addr IS NOT NULL LIMIT 1"
        ).get(folder) as any;

        if (row && row.contract_addr) {
          const chain = (row.chain || "base").toLowerCase();
          const sector = detectSector(row.token_name || folder, row.ticker, "");
          const themeStyle: ThemeStylePreset =
            folder === "pumprun" || sector === "DEFI_TREASURY"
              ? "BENTO_GRID_DAPP"
              : sector === "AI_AGENT" || sector === "GAMING_UTILITY"
              ? "CYBER_TERMINAL_HUD"
              : "NEO_BRUTALISM";

          meta = {
            subfolder: folder,
            name: row.token_name || folder.toUpperCase(),
            ticker: row.ticker,
            ca: row.contract_addr,
            chain,
            sector,
            themeStyle,
          };
        }
      } catch (dbErr: any) {
        // ignore
      }
    }

    // 3. Fallback dummy if no CA found (fallback valid EVM dummy address)
    if (!meta) {
      const dummyCa = "0x" + "11".repeat(20);
      const ticker = folder.toUpperCase().slice(0, 8);
      const sector = detectSector(folder, ticker, "");
      const themeStyle: ThemeStylePreset =
        folder === "pumprun" || sector === "DEFI_TREASURY"
          ? "BENTO_GRID_DAPP"
          : sector === "AI_AGENT" || sector === "GAMING_UTILITY"
          ? "CYBER_TERMINAL_HUD"
          : "NEO_BRUTALISM";

      meta = {
        subfolder: folder,
        name: `${folder.charAt(0).toUpperCase() + folder.slice(1)} Protocol`,
        ticker,
        ca: dummyCa,
        chain: "base",
        sector,
        themeStyle,
      };
    }

    // Strict EVM / Solana CA validity check
    if (meta.chain === "base" || meta.chain === "robinhood" || meta.chain === "clanker") {
      if (!meta.ca.startsWith("0x") || meta.ca.length !== 42) {
        meta.ca = "0x" + "22".repeat(20);
      }
    }

    try {
      console.log(`[Regenerating] ${meta.ticker} (${meta.subfolder}) -> Style: ${meta.themeStyle} | Sector: ${meta.sector}`);
      await generateTokenWebsite({
        name: meta.name,
        ticker: meta.ticker,
        contractAddress: meta.ca,
        chainName: meta.chain,
        customSector: meta.sector,
        themeStyle: meta.themeStyle,
        outputDir: folderPath,
      });

      stats.success++;
      stats.results.push({
        subfolder: meta.subfolder,
        ticker: meta.ticker,
        sector: meta.sector,
        style: meta.themeStyle,
        status: "SUCCESS",
      });
    } catch (genErr: any) {
      console.error(`[Error] Gagal meregenerasi ${meta.subfolder}: ${genErr.message}`);
      stats.failed++;
      stats.results.push({
        subfolder: meta.subfolder,
        ticker: meta.ticker,
        sector: meta.sector,
        style: meta.themeStyle,
        status: `FAILED: ${genErr.message}`,
      });
    }
  }

  console.log("\n================================================================================");
  console.log("   BATCH REGENERATION SUMMARY");
  console.log("================================================================================");
  console.table(stats.results);
  console.log(`\nTotal: ${stats.total} | Berhasil: ${stats.success} | Gagal: ${stats.failed}`);
}

main().catch(console.error);
