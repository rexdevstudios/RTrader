#!/usr/bin/env bun
/**
 * scripts/sync-bounties-neon.ts
 *
 * Idempotent synchronizer for SocialFi KOL Bounty Campaigns in Neon PostgreSQL SSOT (neondb).
 * Inspects all confirmed token launches in `token_launches` and ensures each has an active
 * bounty campaign in `bounty_campaigns`.
 *
 * Usage:
 *   bun run scripts/sync-bounties-neon.ts
 */

import { getNeonMasterSql, isNeonConfigured } from "../src/db/neon-vault.ts";
import { logger } from "../src/logger.ts";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

async function main() {
  console.log(`\n${BOLD}${CYAN}===============================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}    [+] NEON POSTGRESQL SSOT - SOCIALFI BOUNTY CAMPAIGN SYNCHRONIZER [+]${RESET}`);
  console.log(`${BOLD}${CYAN}===============================================================================${RESET}\n`);

  if (!isNeonConfigured()) {
    logger.error("NEON_DATABASE_URL tidak dikonfigurasi di environment atau config.");
    process.exit(1);
  }

  const masterSql = getNeonMasterSql();

  try {
    logger.info("Memeriksa data token_launches dan launch_drafts di neondb...");
    const launches = await masterSql`
      SELECT 
        tl.id as launch_id,
        tl.contract_address,
        tl.chain,
        ld.ticker,
        ld.name,
        ld.creator_id
      FROM token_launches tl
      JOIN launch_drafts ld ON tl.draft_id = ld.id
      ORDER BY tl.published_at DESC;
    `;

    logger.info(`Ditemukan ${launches.length} token launch terdaftar di neondb.`);

    let createdCount = 0;
    let existingCount = 0;

    for (const launch of launches) {
      const cleanTick = String(launch.ticker).toUpperCase().replace(/^\$/, "");
      const existing = await masterSql`
        SELECT id, title FROM bounty_campaigns WHERE launch_id = ${launch.launch_id} LIMIT 1;
      `;

      if (existing.length > 0) {
        existingCount++;
        console.log(`  ${GREEN}✓${RESET} $${cleanTick.padEnd(8)} (CA: ${launch.contract_address.slice(0, 10)}...) -> Kampanye sudah aktif: "${existing[0].title}"`);
      } else {
        await masterSql`
          INSERT INTO bounty_campaigns (
            launch_id, creator_id, title, description,
            required_hashtag, min_followers, reward_per_kol,
            max_participants, current_participants, is_active, created_at
          ) VALUES (
            ${launch.launch_id},
            ${launch.creator_id},
            ${`$${cleanTick} Viral Community & X Raid Bounty`},
            ${`Promote $${cleanTick} on X (Twitter), TikTok & Warpcast. Tag #${cleanTick} to earn bounty reward tokens!`},
            ${`#${cleanTick}`},
            500,
            1000000000000000000000,
            50,
            0,
            true,
            NOW()
          );
        `;
        createdCount++;
        console.log(`  ${YELLOW}+${RESET} $${cleanTick.padEnd(8)} (CA: ${launch.contract_address.slice(0, 10)}...) -> ${GREEN}Kampanye baru berhasil dibuat!${RESET}`);
      }
    }

    console.log(`\n${BOLD}${GREEN}===============================================================================${RESET}`);
    console.log(`${BOLD}${GREEN}   [+] SINKRONISASI SELESAI: ${createdCount} dibuat, ${existingCount} sudah ada [+]${RESET}`);
    console.log(`${BOLD}${GREEN}===============================================================================${RESET}\n`);

    // Verify current campaigns in neondb
    const allCampaigns = await masterSql`
      SELECT id, title, required_hashtag, reward_per_kol, is_active FROM bounty_campaigns ORDER BY created_at DESC;
    `;
    console.log(`Daftar ${allCampaigns.length} Kampanye Aktif di Neon PostgreSQL SSOT:`);
    allCampaigns.forEach((c: any, i: number) => {
      console.log(`  [${i + 1}] "${c.title}" | Tag: ${c.required_hashtag} | Reward: ${Number(BigInt(c.reward_per_kol) / 10n**18n).toLocaleString()} tokens`);
    });

  } catch (err: any) {
    logger.error(`Error sinkronisasi bounty ke Neon: ${err?.message || err}`);
    process.exit(1);
  } finally {
    await masterSql.close().catch(() => {});
  }
}

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
