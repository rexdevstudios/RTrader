#!/usr/bin/env bun
/**
 * scripts/sync-robinhood-to-neon.ts
 *
 * Idempotent synchronizer for Robinhood Chain L2 Deployments to Neon PostgreSQL SSOT.
 *
 * Principles:
 *  1. Non-Custodial: Zero private keys exposed.
 *  2. Postgres SSOT: Inserts launch_drafts, token_launches, and bounty_campaigns.
 *  3. On-chain Verified: Reads token symbol & name dynamically from Robinhood RPC.
 *  4. Idempotent: Uses ON CONFLICT (contract_address) DO NOTHING.
 */

import { Pool } from "pg";
import * as dotenv from "dotenv";
dotenv.config();

import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import { logger } from "../src/logger.ts";
import { getEvmPublicClient } from "../src/modules/reconciliation/evm-verifier.ts";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export async function syncRobinhoodTokenToNeon(tokenCa: string, poolId?: string): Promise<boolean> {
  const cleanCa = tokenCa.trim();
  if (!cleanCa.startsWith("0x") || cleanCa.length !== 42) {
    logger.error(`❌ Alamat kontrak tidak valid: ${cleanCa}`);
    return false;
  }

  logger.info(`🔍 [NEON SYNC] Memverifikasi token on-chain di Robinhood Chain L2: ${cleanCa}...`);
  const client = getEvmPublicClient("robinhood");
  if (!client) {
    logger.error("❌ RPC Robinhood tidak dapat dihubungi.");
    return false;
  }

  let symbol = "NOIR";
  let name = "NoirPay";
  try {
    const onChainSymbol = (await client.readContract({
      address: cleanCa as `0x${string}`,
      abi: [{ name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
      functionName: "symbol",
    })) as string;
    const onChainName = (await client.readContract({
      address: cleanCa as `0x${string}`,
      abi: [{ name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }],
      functionName: "name",
    })) as string;
    if (onChainSymbol) symbol = onChainSymbol;
    if (onChainName) name = onChainName;
    logger.success(`   Token terverifikasi on-chain: ${name} ($${symbol})`);
  } catch (err: any) {
    logger.warn(`   Gagal membaca ERC20 metadata on-chain (${err.message}). Menggunakan fallback: ${name} ($${symbol})`);
  }

  try {
    // 1. Check if token already exists in token_launches
    const existing = await pool.query(
      `SELECT id, draft_id, contract_address, chain FROM token_launches WHERE LOWER(contract_address) = LOWER($1);`,
      [cleanCa]
    );

    let launchId: string;
    let draftId: string;

    if (existing.rows.length > 0) {
      launchId = existing.rows[0].id;
      draftId = existing.rows[0].draft_id;
      logger.info(`ℹ️  [NEON SYNC] Token ${cleanCa} sudah terdaftar di token_launches (Launch ID: ${launchId}). Memastikan kampanye aktif...`);
    } else {
      draftId = crypto.randomUUID();
      launchId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Find valid creator user
      let creatorId = "00000000-0000-0000-0000-000000000001";
      try {
        const userRes = await pool.query(`SELECT id FROM users LIMIT 1;`);
        if (userRes.rows.length > 0) creatorId = userRes.rows[0].id;
      } catch {}

      // 0. Register entities for foreign key integrity
      await pool.query(`INSERT INTO entities (id, type) VALUES ($1, 'LAUNCH_DRAFT') ON CONFLICT DO NOTHING;`, [draftId]);
      await pool.query(`INSERT INTO entities (id, type) VALUES ($1, 'TOKEN') ON CONFLICT DO NOTHING;`, [launchId]);

      // 1. Insert into launch_drafts
      await pool.query(
        `INSERT INTO launch_drafts (
          id, creator_id, name, ticker, description, image_url,
          target_chain, launch_mode, status, total_supply, creator_allocation_pct,
          social_links, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'BONDING_CURVE', 'CONFIRMED', 1000000000, 0.00, $8, $9, $10)
        ON CONFLICT (id) DO NOTHING;`,
        [
          draftId,
          creatorId,
          name,
          symbol,
          `${name} ($${symbol}) is an autonomous Web3 SocialFi protocol on Robinhood Chain L2 via Doppler AMM. Features 0% tax, continuous bonding curve, and community-driven rewards.`,
          "https://raw.githubusercontent.com/rexdevstudios/RTrader/main/sites/rhfly/og-image.svg",
          "robinhood-mainnet",
          JSON.stringify({
            website: `https://app.doppler.lol/tokens/robinhood/${cleanCa}`,
            twitter: "https://x.com",
            gmgn: `https://gmgn.ai/robinhood/token/${cleanCa}`,
            doppler: `https://app.doppler.lol/tokens/robinhood/${cleanCa}`,
            explorer: `https://robinhoodchain.blockscout.com/address/${cleanCa}`,
          }),
          now,
          now,
        ]
      );

      // 2. Insert into token_launches
      await pool.query(
        `INSERT INTO token_launches (
          id, draft_id, chain, contract_address, dex_pair_address,
          current_supply, graduation_threshold, is_graduated, risk_score, published_at
        ) VALUES ($1, $2, $3, $4, $5, 1000000000, 69000, false, 96, $6)
        ON CONFLICT (contract_address) DO UPDATE SET
          chain = EXCLUDED.chain,
          dex_pair_address = EXCLUDED.dex_pair_address,
          published_at = EXCLUDED.published_at;`,
        [
          launchId,
          draftId,
          "robinhood-mainnet",
          cleanCa,
          poolId || "0x6ad81aa97f7ea92310225fe11a6af51339180460",
          now,
        ]
      );

      logger.success(`✅ [NEON SYNC] Token $${symbol} berhasil didaftarkan ke token_launches (ID: ${launchId})!`);
    }

    // 2. Ensure 3 SocialFi Campaigns exist for this token
    let creatorId = "00000000-0000-0000-0000-000000000001";
    try {
      const userRes = await pool.query(`SELECT id FROM users LIMIT 1;`);
      if (userRes.rows.length > 0) creatorId = userRes.rows[0].id;
    } catch {}

    const campaignsToEnsure = [
      {
        title: `$${symbol} Viral Community & X Raid Bounty`,
        description: `Promosikan $${symbol} di platform X (Twitter), TikTok, dan Warpcast. Sertakan hashtag #${symbol} untuk mendapatkan alokasi token reward secara instan!`,
        hashtag: `#${symbol}`,
        minFollowers: 500,
        rewardPerKol: "1000000000000000000000", // 1000 tokens
        maxParticipants: 50,
      },
      {
        title: `💎 $${symbol} Diamond Hands HODL Loyalty Program`,
        description: `Pegang minimal 10,000 $${symbol} di dompet pribadi Anda tanpa menjual selama masa kampanye untuk mendapatkan bagi hasil fee treasury loyalitas.`,
        hashtag: `#${symbol}HODL`,
        minFollowers: 100,
        rewardPerKol: "2500000000000000000000", // 2500 tokens
        maxParticipants: 100,
      },
      {
        title: `🥩 $${symbol} Yield Vault Liquid Staking (4.2% APY + Bonus)`,
        description: `Kunci $${symbol} Anda di pool staking likuid untuk menikmati dividen pasif auto-compounding dan hak voting komunitas tata kelola.`,
        hashtag: `#${symbol}STAKE`,
        minFollowers: 0,
        rewardPerKol: "5000000000000000000000", // 5000 tokens
        maxParticipants: 200,
      },
    ];

    for (const c of campaignsToEnsure) {
      const campCheck = await pool.query(
        `SELECT id FROM bounty_campaigns WHERE launch_id = $1 AND title = $2 LIMIT 1;`,
        [launchId, c.title]
      );
      if (campCheck.rows.length === 0) {
        await pool.query(
          `INSERT INTO bounty_campaigns (
            launch_id, creator_id, title, description,
            required_hashtag, min_followers, reward_per_kol,
            max_participants, current_participants, is_active, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, true, NOW());`,
          [
            launchId,
            creatorId,
            c.title,
            c.description,
            c.hashtag,
            c.minFollowers,
            c.rewardPerKol,
            c.maxParticipants,
          ]
        );
        logger.success(`   + Kampanye dibuat: "${c.title}"`);
      } else {
        logger.info(`   ✓ Kampanye sudah ada: "${c.title}"`);
      }
    }

    return true;
  } catch (err: any) {
    logger.error(`❌ [NEON SYNC] Gagal sinkronisasi ke PostgreSQL: ${err.message}`);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const targetCa = args[0] || "0xa5f832390447b050955d7b734a9a2fa861b4d3ab"; // Default NoirPay CA
  const poolId = args[1] || "0x6ad81aa97f7ea92310225fe11a6af51339180460";

  console.log(`
=================================================================
  [+] SINKRONISASI TOKEN ROBINHOOD KE NEON POSTGRESQL SSOT [+]
=================================================================
  Target CA: ${targetCa}
  Pool ID:   ${poolId}
=================================================================
`);

  const ok = await syncRobinhoodTokenToNeon(targetCa, poolId);

  // Also check local sqlite deploy_logs for other robinhood tokens
  try {
    const db = new Database(DB_PATH);
    const rows = db.query(`SELECT contract_addr, pool_id FROM deploy_logs WHERE chain = 'robinhood' AND contract_addr IS NOT NULL`).all() as { contract_addr: string; pool_id?: string }[];
    for (const r of rows) {
      if (r.contract_addr.toLowerCase() !== targetCa.toLowerCase()) {
        logger.info(`Sinkronisasi token dari deploy_logs: ${r.contract_addr}...`);
        await syncRobinhoodTokenToNeon(r.contract_addr, r.pool_id);
      }
    }
  } catch (sqliteErr: any) {
    logger.warn(`Notice SQLite: ${sqliteErr.message}`);
  }

  await pool.end();
  if (ok) {
    console.log(`\n✅ [SELESAI] Token Robinhood berhasil disinkronkan ke Neon PostgreSQL SSOT!`);
    console.log(`   Kunjungi http://localhost:3000/launchpad atau http://localhost:3000/token/robinhood/${targetCa}\n`);
  } else {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    logger.error(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
