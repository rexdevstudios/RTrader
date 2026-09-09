// ============================================================================
// SERVERLESS-SAFE POSTGRESQL POOL & SSOT ADAPTERS (RTRADER PLATFORM)
// ============================================================================

import { Pool, QueryResult, QueryResultRow } from 'pg';
import crypto from 'crypto';
import { LaunchDraftDbAdapter } from '../launchpad/launch-draft-service';
import { KolDbAdapter } from '../social/kol-service';
import { BountyDbAdapter } from '../launchpad/bounty-escrow';
import { KolProfile, BountyCampaign, BountyClaim } from './types/domain';

declare global {
  // eslint-disable-next-line no-var
  var _rtraderPgPool: Pool | undefined;
}

/**
 * Returns true if a valid UUID v4 format.
 */
export function isUuid(str?: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Returns true if a valid DATABASE_URL environment variable is provided.
 */
export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return typeof url === 'string' && url.trim().length > 0 && !url.includes('placeholder');
}

/**
 * Returns singleton Pool instance for serverless environments.
 * - Enforces max: 5 connections to prevent exhausting Postgres serverless connection limits.
 * - Throws in production if DATABASE_URL is missing.
 * - Returns null in dev/test when DATABASE_URL is omitted to allow graceful local mock fallback.
 */
export function getDbPool(): Pool | null {
  if (isDatabaseConfigured()) {
    if (!global._rtraderPgPool) {
      global._rtraderPgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 5000,
        ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      });

      global._rtraderPgPool.on('error', (err) => {
        console.error('[Postgres SSOT Pool Error]:', err.message);
      });
    }
    return global._rtraderPgPool;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'CRITICAL_CONFIG_ERROR: DATABASE_URL is not configured in production environment. Refusing to operate unbacked state.'
    );
  }

  return null;
}

/**
 * Generic query helper executing safely against PostgreSQL connection pool.
 */
export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R> | null> {
  const pool = getDbPool();
  if (!pool) return null;
  return pool.query<R>(text, params);
}

/**
 * Ensures an actor or wallet address has an associated user and entity record.
 * Returns the valid UUID user_id.
 */
export async function ensureUserEntity(pool: Pool, actorOrWallet: string): Promise<string> {
  if (isUuid(actorOrWallet)) {
    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [actorOrWallet]);
    if (existing.rows.length > 0) return actorOrWallet;
  }

  const cleanAddress = actorOrWallet.startsWith('usr-')
    ? actorOrWallet.slice(4).toLowerCase()
    : actorOrWallet.toLowerCase();

  const existingWallet = await pool.query(
    'SELECT user_id FROM wallets WHERE LOWER(address) = LOWER($1) LIMIT 1',
    [cleanAddress]
  );
  if (existingWallet.rows.length > 0) {
    return existingWallet.rows[0].user_id;
  }

  const newUserId = crypto.randomUUID();
  await pool.query("INSERT INTO entities (id, type) VALUES ($1, 'USER')", [newUserId]);
  await pool.query("INSERT INTO users (id, status) VALUES ($1, 'ACTIVE')", [newUserId]);
  await pool.query(
    "INSERT INTO wallets (user_id, address, chain_type, is_primary) VALUES ($1, $2, 'EVM', true) ON CONFLICT (address, chain_type) DO NOTHING",
    [newUserId, cleanAddress]
  );

  return newUserId;
}

// ----------------------------------------------------------------------------
// IN-MEMORY FALLBACK STORES (DEV / TEST / SIMULATION)
// ----------------------------------------------------------------------------
const inMemoryDrafts: any[] = [];
const inMemoryKolProfiles: Map<string, KolProfile> = new Map();
const inMemoryClaims: Map<string, BountyClaim> = new Map();

// ----------------------------------------------------------------------------
// POSTGRES DRAFT DB ADAPTER
// ----------------------------------------------------------------------------
export class PostgresDraftDbAdapter implements LaunchDraftDbAdapter {
  async saveDraft(draft: any): Promise<string> {
    const pool = getDbPool();
    if (pool) {
      try {
        const draftUuid = isUuid(draft.id) ? draft.id : crypto.randomUUID();
        const creatorUserId = await ensureUserEntity(pool, draft.creatorWallet || draft.creatorId);

        await pool.query("INSERT INTO entities (id, type) VALUES ($1, 'LAUNCH_DRAFT') ON CONFLICT (id) DO NOTHING", [draftUuid]);

        await pool.query(
          `INSERT INTO launch_drafts (
            id, creator_id, name, ticker, description, image_url,
            launch_mode, target_chain, total_supply, creator_allocation_pct,
            bonding_curve_config, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            updated_at = NOW()`,
          [
            draftUuid,
            creatorUserId,
            draft.name,
            draft.ticker,
            draft.description || '',
            draft.imageUrl || '',
            draft.launchMode || 'BONDING_CURVE',
            draft.targetChain || 'base-mainnet',
            draft.totalSupply?.toString() || '1000000000',
            draft.creatorAllocationPct || 0.0,
            JSON.stringify(draft.bondingCurveConfig || {}),
            draft.status || 'DRAFT',
          ]
        );
        const stored = { ...draft, id: draftUuid };
        inMemoryDrafts.unshift(stored);
        return draftUuid;
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
        console.warn('[PostgresDraftDbAdapter] DB insert failed, falling back to memory:', err.message);
      }
    }
    inMemoryDrafts.unshift(draft);
    return draft.id;
  }

  async saveWhitelist(launchDraftId: string, merkleRoot: string, maxAllocation: bigint): Promise<void> {
    const pool = getDbPool();
    if (pool) {
      try {
        const targetDraftId = isUuid(launchDraftId) ? launchDraftId : undefined;
        if (targetDraftId) {
          await pool.query(
            `INSERT INTO launch_whitelists (launch_draft_id, merkle_root, max_allocation_per_wallet)
             VALUES ($1, $2, $3)`,
            [targetDraftId, merkleRoot, maxAllocation.toString()]
          );
        }
        return;
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
        console.warn('[PostgresDraftDbAdapter] DB whitelist insert failed, fallback:', err.message);
      }
    }
  }

  async createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void> {
    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO audit_logs (actor_id, action, entity_id, reason, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [actorId, action, entityId || null, reason || null]
        );
      } catch {
        // Non-blocking for audit log fallback
      }
    }
  }

  async getDrafts(): Promise<any[]> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(`SELECT * FROM launch_drafts ORDER BY created_at DESC LIMIT 50`);
        if (res.rows.length > 0) {
          return res.rows.map((r) => ({
            id: r.id,
            draftId: r.id,
            creatorId: r.creator_id,
            name: r.name,
            symbol: r.ticker,
            ticker: r.ticker,
            description: r.description,
            imageUrl: r.image_url,
            mode: r.launch_mode,
            launchMode: r.launch_mode,
            targetChain: r.target_chain,
            totalSupply: r.total_supply,
            status: r.status,
            createdAt: r.created_at,
          }));
        }
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
      }
    }
    return inMemoryDrafts;
  }
}

// ----------------------------------------------------------------------------
// POSTGRES KOL DB ADAPTER
// ----------------------------------------------------------------------------
export class PostgresKolDbAdapter implements KolDbAdapter {
  async upsertKolProfile(p: Partial<KolProfile> & { userId: string }): Promise<KolProfile> {
    const pool = getDbPool();
    const existing = inMemoryKolProfiles.get(p.userId) || {
      id: `kol-${Date.now()}`,
      userId: p.userId,
      twitterHandle: p.twitterHandle,
      followersCount: p.followersCount || 0,
      trustScore: p.trustScore || 50,
      completedBounties: 0,
      totalEarnedUsd: 0,
      isVerified: p.isVerified || false,
    };

    const updated: KolProfile = {
      ...existing,
      ...p,
      id: existing.id,
      userId: p.userId,
      followersCount: p.followersCount ?? existing.followersCount,
      trustScore: p.trustScore ?? existing.trustScore,
      isVerified: p.isVerified ?? existing.isVerified,
    };

    if (pool) {
      try {
        const userId = await ensureUserEntity(pool, p.userId);
        const res = await pool.query(
          `INSERT INTO kol_profiles (
            user_id, twitter_handle, followers_count, trust_score, is_verified, updated_at
          ) VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (user_id) DO UPDATE SET
            twitter_handle = COALESCE(EXCLUDED.twitter_handle, kol_profiles.twitter_handle),
            followers_count = COALESCE(EXCLUDED.followers_count, kol_profiles.followers_count),
            trust_score = COALESCE(EXCLUDED.trust_score, kol_profiles.trust_score),
            is_verified = COALESCE(EXCLUDED.is_verified, kol_profiles.is_verified),
            updated_at = NOW()
          RETURNING id, user_id, twitter_handle, followers_count, trust_score, is_verified, completed_bounties, total_earned_usd`,
          [
            userId,
            updated.twitterHandle || null,
            updated.followersCount,
            updated.trustScore,
            updated.isVerified,
          ]
        );

        if (res.rows.length > 0) {
          const row = res.rows[0];
          const dbProfile: KolProfile = {
            id: row.id,
            userId: row.user_id,
            twitterHandle: row.twitter_handle,
            followersCount: row.followers_count,
            trustScore: row.trust_score,
            completedBounties: row.completed_bounties || 0,
            totalEarnedUsd: Number(row.total_earned_usd || 0),
            isVerified: row.is_verified,
          };
          inMemoryKolProfiles.set(p.userId, dbProfile);
          return dbProfile;
        }
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
        console.warn('[PostgresKolDbAdapter] DB upsert failed, fallback to memory:', err.message);
      }
    }

    inMemoryKolProfiles.set(p.userId, updated);
    return updated;
  }

  async getKolProfile(userIdOrAddress: string): Promise<KolProfile | null> {
    const pool = getDbPool();
    if (pool) {
      try {
        const cleanAddress = userIdOrAddress.startsWith('usr-')
          ? userIdOrAddress.slice(4).toLowerCase()
          : userIdOrAddress.toLowerCase();

        const res = await pool.query(
          `SELECT kp.* FROM kol_profiles kp
           LEFT JOIN wallets w ON w.user_id = kp.user_id
           WHERE kp.user_id::text = $1 
              OR LOWER(kp.twitter_handle) = LOWER($1)
              OR LOWER(w.address) = LOWER($2)
           LIMIT 1`,
          [userIdOrAddress, cleanAddress]
        );

        if (res.rows.length > 0) {
          const row = res.rows[0];
          return {
            id: row.id,
            userId: row.user_id,
            twitterHandle: row.twitter_handle,
            followersCount: row.followers_count,
            trustScore: row.trust_score,
            completedBounties: row.completed_bounties || 0,
            totalEarnedUsd: Number(row.total_earned_usd || 0),
            isVerified: row.is_verified,
          };
        }
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
      }
    }
    return inMemoryKolProfiles.get(userIdOrAddress) || null;
  }

  async createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void> {
    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO audit_logs (actor_id, action, entity_id, reason, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [actorId, action, entityId || null, reason || null]
        );
      } catch {
        // Non-blocking
      }
    }
  }
}

// ----------------------------------------------------------------------------
// POSTGRES BOUNTY DB ADAPTER
// ----------------------------------------------------------------------------
export class PostgresBountyDbAdapter implements BountyDbAdapter {
  async getCampaign(id: string): Promise<BountyCampaign | null> {
    const pool = getDbPool();
    if (pool && isUuid(id)) {
      try {
        const res = await pool.query(`SELECT * FROM bounty_campaigns WHERE id = $1 LIMIT 1`, [id]);
        if (res.rows.length > 0) {
          const r = res.rows[0];
          return {
            id: r.id,
            launchId: r.launch_id,
            creatorId: r.creator_id,
            title: r.title,
            requiredHashtag: r.required_hashtag,
            minFollowers: r.min_followers,
            rewardPerKol: BigInt(r.reward_per_kol || '0'),
            maxParticipants: r.max_participants,
            currentParticipants: r.current_participants,
            isActive: r.is_active,
          };
        }
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
      }
    }

    return {
      id,
      launchId: 'launch-demo',
      creatorId: 'usr-creator',
      title: 'Demo Marketing Campaign',
      requiredHashtag: '#DegenMoon',
      minFollowers: 500,
      rewardPerKol: 1000000000000000000000n,
      maxParticipants: 50,
      currentParticipants: 2,
      isActive: true,
    };
  }

  async getClaim(campaignId: string, kolId: string): Promise<BountyClaim | null> {
    const pool = getDbPool();
    if (pool && isUuid(campaignId) && isUuid(kolId)) {
      try {
        const res = await pool.query(
          `SELECT * FROM bounty_claims WHERE campaign_id = $1 AND kol_id = $2 LIMIT 1`,
          [campaignId, kolId]
        );
        if (res.rows.length > 0) {
          const r = res.rows[0];
          return {
            id: r.id,
            campaignId: r.campaign_id,
            kolId: r.kol_id,
            proofUrl: r.proof_url,
            verificationStatus: r.verification_status,
            claimedAt: r.claimed_at,
            createdAt: r.created_at,
          };
        }
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
      }
    }
    return inMemoryClaims.get(`${campaignId}:${kolId}`) || null;
  }

  async createClaim(campaignId: string, kolId: string, proofUrl: string): Promise<BountyClaim> {
    const claim: BountyClaim = {
      id: `claim-${Date.now()}`,
      campaignId,
      kolId,
      proofUrl,
      verificationStatus: 'PENDING',
      createdAt: new Date(),
    };

    const pool = getDbPool();
    if (pool && isUuid(campaignId) && isUuid(kolId)) {
      try {
        await pool.query(
          `INSERT INTO bounty_claims (id, campaign_id, kol_id, proof_url, verification_status, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [crypto.randomUUID(), campaignId, kolId, proofUrl, 'PENDING']
        );
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
      }
    }

    inMemoryClaims.set(`${campaignId}:${kolId}`, claim);
    return claim;
  }

  async updateClaimStatus(claimId: string, status: 'VERIFIED' | 'REJECTED' | 'CLAIMED'): Promise<void> {
    const pool = getDbPool();
    if (pool && isUuid(claimId)) {
      try {
        await pool.query(
          `UPDATE bounty_claims SET verification_status = $1, claimed_at = CASE WHEN $1 = 'CLAIMED' THEN NOW() ELSE claimed_at END
           WHERE id = $2`,
          [status, claimId]
        );
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
      }
    }

    for (const val of inMemoryClaims.values()) {
      if (val.id === claimId) {
        val.verificationStatus = status;
        if (status === 'CLAIMED') val.claimedAt = new Date();
        break;
      }
    }
  }

  async incrementCampaignParticipant(campaignId: string): Promise<void> {
    const pool = getDbPool();
    if (pool && isUuid(campaignId)) {
      try {
        await pool.query(
          `UPDATE bounty_campaigns SET current_participants = current_participants + 1 WHERE id = $1`,
          [campaignId]
        );
      } catch (err: any) {
        if (process.env.NODE_ENV === 'production') throw err;
      }
    }
  }

  async createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void> {
    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO audit_logs (actor_id, action, entity_id, reason, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [actorId, action, entityId || null, reason || null]
        );
      } catch {
        // Non-blocking
      }
    }
  }
}

// Single instances for API routes
export const defaultDraftDbAdapter = new PostgresDraftDbAdapter();
export const defaultKolDbAdapter = new PostgresKolDbAdapter();
export const defaultBountyDbAdapter = new PostgresBountyDbAdapter();
