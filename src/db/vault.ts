/**
 * vault.ts — SQLite database lokal menggunakan bun:sqlite (native Bun).
 * Menyimpan:
 *   1. Dompet bekas (address + private key + status sweep)
 *   2. Log setiap token yang berhasil/gagal di-deploy dengan explicit lifecycle state
 *   3. Counter deploy harian untuk safety cap
 *   4. Posisi aktif dengan atomic state transitions (Exit Strategy / TP-SL)
 *   5. System locks untuk mencegah concurrency & cron overlap
 *
 * MIGRASI SCHEMA: Menggunakan ALTER TABLE ADD COLUMN aman
 * agar data lama tidak hilang saat upgrade versi bot.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { join, dirname } from "path";

const DB_DIR = join(process.cwd(), ".eliza");

export function resolveDbPath(): string {
  if (process.env.VAULT_DB_PATH) {
    const custom = process.env.VAULT_DB_PATH;
    return custom.startsWith("/") || custom.includes(":") ? custom : join(process.cwd(), custom);
  }
  if (process.env.NODE_ENV === "test") {
    return join(DB_DIR, "test_vault.db");
  }
  return join(DB_DIR, "vault.db");
}

export const DB_PATH = resolveDbPath();

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA synchronous = NORMAL");

// --- Schema Setup: Tabel Dasar ---
db.run(`
  CREATE TABLE IF NOT EXISTS wallets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chain       TEXT NOT NULL,
    address     TEXT NOT NULL UNIQUE,
    private_key TEXT NOT NULL,
    used        INTEGER DEFAULT 0,
    swept       INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS deploy_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    chain         TEXT NOT NULL,
    token_name    TEXT NOT NULL,
    ticker        TEXT NOT NULL,
    contract_addr TEXT,
    tx_hash       TEXT,
    ipfs_url      TEXT,
    status        TEXT DEFAULT 'pending',
    error_msg     TEXT,
    deploy_cost   REAL,
    created_at    TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS daily_counter (
    date         TEXT PRIMARY KEY,
    deploy_count INTEGER DEFAULT 0
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS active_positions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    deploy_log_id  INTEGER NOT NULL,
    chain          TEXT NOT NULL,
    contract_addr  TEXT NOT NULL UNIQUE,
    ticker         TEXT NOT NULL,
    snipe_amount   REAL NOT NULL,
    entry_price    REAL,
    take_profit_x  REAL NOT NULL DEFAULT 2.0,
    stop_loss_pct  REAL NOT NULL DEFAULT 0.30,
    status         TEXT DEFAULT 'open',
    created_at     TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS system_locks (
    lock_name   TEXT PRIMARY KEY,
    acquired_at INTEGER NOT NULL,
    holder      TEXT
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS wallet_accounts (
    id             TEXT PRIMARY KEY,
    label          TEXT NOT NULL,
    evm_address    TEXT,
    solana_address TEXT,
    credential_ref TEXT,
    status         TEXT DEFAULT 'ACTIVE',
    metadata       TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS proxy_configs (
    id             TEXT PRIMARY KEY,
    protocol       TEXT NOT NULL,
    host           TEXT NOT NULL,
    port           INTEGER NOT NULL,
    username       TEXT,
    password       TEXT,
    status         TEXT DEFAULT 'ACTIVE',
    health_status  TEXT DEFAULT 'available',
    latency_ms     INTEGER,
    last_checked_at TEXT,
    metadata       TEXT,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS wallet_provider_routes (
    wallet_id      TEXT NOT NULL,
    provider       TEXT NOT NULL,
    credential_ref TEXT,
    proxy_id       TEXT,
    status         TEXT DEFAULT 'ACTIVE',
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (wallet_id, provider)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS proxy_audit_logs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id         TEXT NOT NULL,
    provider          TEXT NOT NULL,
    previous_proxy_id TEXT,
    new_proxy_id      TEXT,
    reason            TEXT NOT NULL,
    rotated_at        TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS fee_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    event_key           TEXT UNIQUE NOT NULL,
    wallet_id           TEXT NOT NULL,
    deploy_log_id       INTEGER,
    chain               TEXT NOT NULL,
    token_address       TEXT,
    pool_id             TEXT,
    source              TEXT NOT NULL,
    beneficiary_address TEXT NOT NULL,
    token_symbol        TEXT NOT NULL,
    amount_raw          TEXT NOT NULL,
    amount_formatted    REAL NOT NULL,
    status              TEXT NOT NULL DEFAULT 'detected',
    claim_tx_hash       TEXT,
    claimed_at          TEXT,
    metadata            TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS treasury_ledger (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id             TEXT UNIQUE NOT NULL,
    wallet_id            TEXT NOT NULL,
    chain                TEXT NOT NULL,
    event_type           TEXT NOT NULL,
    token_symbol         TEXT NOT NULL,
    amount_raw           TEXT NOT NULL,
    amount_formatted     REAL NOT NULL,
    direction            TEXT NOT NULL,
    source_ref_type      TEXT NOT NULL,
    source_ref_id        TEXT NOT NULL,
    tx_hash              TEXT,
    beneficiary_address  TEXT,
    destination_address  TEXT,
    status               TEXT NOT NULL DEFAULT 'confirmed',
    reconciliation_notes TEXT,
    created_at           TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS treasury_sweeps (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    sweep_id            TEXT UNIQUE NOT NULL,
    wallet_id           TEXT NOT NULL,
    chain               TEXT NOT NULL,
    token_symbol        TEXT NOT NULL,
    amount_raw          TEXT NOT NULL,
    amount_formatted    REAL NOT NULL,
    source_address      TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    tx_hash             TEXT,
    status              TEXT NOT NULL DEFAULT 'pending',
    error_reason        TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS flywheel_events (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id            TEXT UNIQUE NOT NULL,
    token_address       TEXT NOT NULL,
    token_symbol        TEXT NOT NULL,
    total_claimed_weth  REAL NOT NULL,
    creator_weth        REAL NOT NULL,
    buyback_weth        REAL NOT NULL,
    dividend_weth       REAL NOT NULL,
    jackpot_weth        REAL NOT NULL,
    burned_tokens       REAL DEFAULT 0,
    burn_tx_hash        TEXT,
    status              TEXT NOT NULL DEFAULT 'completed',
    metadata            TEXT,
    created_at          TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS affiliate_stats (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    affiliate_address  TEXT NOT NULL,
    token_address      TEXT NOT NULL,
    bounty_earned_weth REAL DEFAULT 0,
    volume_routed_weth REAL DEFAULT 0,
    claim_count        INTEGER DEFAULT 0,
    last_claimed_at    TEXT DEFAULT (datetime('now')),
    created_at         TEXT DEFAULT (datetime('now')),
    UNIQUE(affiliate_address, token_address)
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS promotion_decisions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token_address   TEXT NOT NULL UNIQUE,
    chain           TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    decision        TEXT NOT NULL,
    operator        TEXT NOT NULL DEFAULT 'local_operator',
    reason          TEXT,
    decided_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_promo_dec_addr ON promotion_decisions(token_address)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_promo_dec_ticker ON promotion_decisions(ticker)`);

// --- Migrasi Aman: Tambah kolom baru tanpa menyentuh data lama ---
const migrations = [
  "ALTER TABLE deploy_logs ADD COLUMN snipe_tx_hash TEXT",
  "ALTER TABLE deploy_logs ADD COLUMN price_entry_usd REAL",
  "ALTER TABLE deploy_logs ADD COLUMN price_peak_usd REAL",
  "ALTER TABLE deploy_logs ADD COLUMN exit_status TEXT DEFAULT 'holding'",
  "ALTER TABLE deploy_logs ADD COLUMN lifecycle_state TEXT DEFAULT 'DISCOVERED'",
  "ALTER TABLE deploy_logs ADD COLUMN simulated INTEGER DEFAULT 0",
  "ALTER TABLE deploy_logs ADD COLUMN pool_id TEXT",
  "ALTER TABLE deploy_logs ADD COLUMN wallet_id TEXT",
  "ALTER TABLE deploy_logs ADD COLUMN proxy_id TEXT",
  "ALTER TABLE active_positions ADD COLUMN exit_reason TEXT",
  "ALTER TABLE active_positions ADD COLUMN closed_at TEXT",
  "ALTER TABLE active_positions ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))",
  "ALTER TABLE active_positions ADD COLUMN wallet_address TEXT",
  "ALTER TABLE active_positions ADD COLUMN deployment_tx_hash TEXT",
  "ALTER TABLE active_positions ADD COLUMN buy_tx_hash TEXT",
  "ALTER TABLE active_positions ADD COLUMN sell_tx_hash TEXT",
  "ALTER TABLE active_positions ADD COLUMN last_reconciled_at TEXT",
  "ALTER TABLE active_positions ADD COLUMN reconciliation_status TEXT DEFAULT 'pending'",
  "ALTER TABLE active_positions ADD COLUMN balance_before TEXT",
  "ALTER TABLE active_positions ADD COLUMN balance_after TEXT",
  "ALTER TABLE active_positions ADD COLUMN current_balance TEXT",
  "ALTER TABLE active_positions ADD COLUMN token_decimals INTEGER DEFAULT 18",
  "ALTER TABLE active_positions ADD COLUMN exit_price REAL",
  "ALTER TABLE active_positions ADD COLUMN entry_amount REAL",
  "ALTER TABLE active_positions ADD COLUMN exit_amount REAL",
  "ALTER TABLE active_positions ADD COLUMN fees REAL",
  "ALTER TABLE active_positions ADD COLUMN realized_pnl REAL",
  "ALTER TABLE active_positions ADD COLUMN realized_pnl_percent REAL",
  "ALTER TABLE active_positions ADD COLUMN entry_cost_raw TEXT",
  "ALTER TABLE active_positions ADD COLUMN exit_proceeds_raw TEXT",
  "ALTER TABLE active_positions ADD COLUMN entry_fee_raw TEXT",
  "ALTER TABLE active_positions ADD COLUMN exit_fee_raw TEXT",
  "ALTER TABLE active_positions ADD COLUMN attribution_status TEXT DEFAULT 'unresolved'",
  "ALTER TABLE active_positions ADD COLUMN attribution_reason TEXT",
  "ALTER TABLE active_positions ADD COLUMN pnl_status TEXT DEFAULT 'pnl_pending'",
  "ALTER TABLE active_positions ADD COLUMN price_return_percent REAL",
  "ALTER TABLE active_positions ADD COLUMN wallet_id TEXT",
  "ALTER TABLE active_positions ADD COLUMN proxy_id TEXT",
  "ALTER TABLE deploy_logs ADD COLUMN attribution_status TEXT DEFAULT 'unresolved'",
  "ALTER TABLE deploy_logs ADD COLUMN attribution_reason TEXT",
  "ALTER TABLE deploy_logs ADD COLUMN exit_status TEXT DEFAULT 'holding'",
  // V2.4.0: Intelligence signal persistence — ephemeral AI/market signals become part of deploy lineage
  "ALTER TABLE deploy_logs ADD COLUMN viral_score INTEGER DEFAULT NULL",
  "ALTER TABLE deploy_logs ADD COLUMN saturation_count INTEGER DEFAULT NULL",
  "ALTER TABLE deploy_logs ADD COLUMN signal_sources TEXT DEFAULT NULL",
  "ALTER TABLE deploy_logs ADD COLUMN signal_scraped_at TEXT DEFAULT NULL",
  // V2.4.1: Candidate identity — correlates cross-chain deployments from the same evaluation cycle
  "ALTER TABLE deploy_logs ADD COLUMN candidate_id TEXT DEFAULT NULL",
  // Dedicated Telegram bot integration per token deployment
  "ALTER TABLE deploy_logs ADD COLUMN telegram_bot_token TEXT",
  "ALTER TABLE deploy_logs ADD COLUMN telegram_bot_username TEXT",
  // V3.3: Production Web3 website URL persistence for fleet & DexScreener
  "ALTER TABLE deploy_logs ADD COLUMN website_url TEXT",
];

// V2.3: intervention_logs table for manual operation audit trail
db.run(`
  CREATE TABLE IF NOT EXISTS intervention_logs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    action        TEXT NOT NULL,
    initiated_by  TEXT NOT NULL DEFAULT 'owner',
    wallet_id     TEXT,
    contract_addr TEXT,
    deploy_log_id INTEGER,
    requested_at  TEXT NOT NULL,
    result        TEXT NOT NULL,
    result_detail TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  )
`);

// V2.4.3: saturation_observations table for cross-chain saturation intelligence
db.run(`
  CREATE TABLE IF NOT EXISTS saturation_observations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id    TEXT NOT NULL,
    ticker          TEXT NOT NULL,
    chain           TEXT NOT NULL,
    observed_count  INTEGER NOT NULL,
    is_saturated    INTEGER NOT NULL DEFAULT 0,
    threshold       INTEGER NOT NULL DEFAULT 3,
    source          TEXT NOT NULL DEFAULT 'dexscreener',
    provider_status TEXT NOT NULL DEFAULT 'available',
    observed_at     TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_sat_obs_candidate ON saturation_observations(candidate_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sat_obs_ticker ON saturation_observations(ticker)`);

// V2.5.0: pipeline_cycles table for cycle telemetry & scheduling observability
db.run(`
  CREATE TABLE IF NOT EXISTS pipeline_cycles (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at            TEXT NOT NULL,
    completed_at          TEXT,
    duration_ms           INTEGER,
    lock_acquired         INTEGER NOT NULL DEFAULT 0,
    daily_limit_hit       INTEGER NOT NULL DEFAULT 0,
    trend_data_found      INTEGER NOT NULL DEFAULT 0,
    identity_found        INTEGER NOT NULL DEFAULT 0,
    candidate_id          TEXT,
    decision_approved     INTEGER,
    rejection_reason      TEXT,
    assets_uploaded       INTEGER,
    deployments_attempted INTEGER DEFAULT 0,
    deployments_confirmed INTEGER DEFAULT 0,
    created_at            TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_pipeline_cycles_started ON pipeline_cycles(started_at)`);

// V2.9.2: telegram_bot_pool table for pre-provisioned dedicated Telegram bots
db.run(`
  CREATE TABLE IF NOT EXISTS telegram_bot_pool (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_token               TEXT NOT NULL UNIQUE,
    bot_username            TEXT,
    assigned_contract_addr  TEXT,
    assigned_at             TEXT,
    status                  TEXT DEFAULT 'AVAILABLE',
    created_at              TEXT DEFAULT (datetime('now'))
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_bot_pool_status ON telegram_bot_pool(status)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_bot_pool_ca ON telegram_bot_pool(assigned_contract_addr)`);

for (const sql of migrations) {
  try {
    db.run(sql);
  } catch {
    /* Kolom sudah ada — diabaikan */
  }
}

// ─── Concurrency & Cron Locks ────────────────────────────────
export function acquireLock(lockName: string, ttlSeconds = 1800, holder = "orchestrator"): boolean {
  const now = Date.now();
  const cutoff = now - ttlSeconds * 1000;

  // Bersihkan lock kadaluarsa jika ada
  db.run("DELETE FROM system_locks WHERE lock_name = ? AND acquired_at < ?", [lockName, cutoff]);

  try {
    const res = db.run(
      "INSERT INTO system_locks (lock_name, acquired_at, holder) VALUES (?, ?, ?)",
      [lockName, now, holder]
    );
    return res.changes > 0;
  } catch {
    // Primary key conflict -> lock sedang dipegang proses lain
    return false;
  }
}

export function releaseLock(lockName: string): void {
  db.run("DELETE FROM system_locks WHERE lock_name = ?", [lockName]);
}

export function isLockHeld(lockName: string, ttlSeconds = 1800): boolean {
  const cutoff = Date.now() - ttlSeconds * 1000;
  const row = db
    .query("SELECT lock_name FROM system_locks WHERE lock_name = ? AND acquired_at >= ?")
    .get(lockName, cutoff);
  return Boolean(row);
}

// ─── Wallet Vault ────────────────────────────────────────────
export function saveWallet(chain: string, address: string, encryptedKey: string): void {
  db.run(
    "INSERT OR IGNORE INTO wallets (chain, address, private_key) VALUES (?, ?, ?)",
    [chain, address, encryptedKey]
  );
}

export function markWalletUsed(address: string): void {
  db.run("UPDATE wallets SET used = 1 WHERE address = ?", [address]);
}

export function markWalletSwept(address: string): void {
  db.run("UPDATE wallets SET swept = 1 WHERE address = ?", [address]);
}

export function getUnsweptWallets(chain: string): Array<{ address: string; private_key: string }> {
  return db
    .query("SELECT address, private_key FROM wallets WHERE chain = ? AND swept = 0")
    .all(chain) as Array<{ address: string; private_key: string }>;
}

export function getWalletKeyByAddress(address: string): string | null {
  const row = db
    .query("SELECT private_key FROM wallets WHERE LOWER(address) = LOWER(?)")
    .get(address) as { private_key: string } | null;
  return row ? row.private_key : null;
}

// ─── Deploy Log & Lifecycle Management ───────────────────────
export type DeployStatus = "confirmed" | "failed" | "pending" | "unknown" | "success";
export type DeployLifecycleState =
  | "DISCOVERED"
  | "EVALUATED"
  | "ASSETS_UPLOADED"
  | "DEPLOY_SUBMITTED"
  | "DEPLOY_CONFIRMED"
  | "RECONCILED"
  | "FAILED"
  | "UNRESOLVED_UNKNOWN";

export interface DeployLog {
  id?: number;
  chain: string;
  tokenName: string;
  ticker: string;
  contractAddr?: string;
  txHash?: string;
  ipfsUrl?: string;
  status: DeployStatus;
  errorMsg?: string;
  deployCost?: number;
  lifecycleState?: DeployLifecycleState | string;
  simulated?: boolean;
  poolId?: string;
  attributionStatus?: "transaction_verified" | "balance_delta_only" | "unresolved";
  attributionReason?: string;
  walletId?: string;
  proxyId?: string;
  // V2.4.0: Intelligence signal metadata — persisted from the evaluation cycle that produced this deployment.
  // These are observational signals only. They are NOT financial metrics.
  // viralScore is an AI-assessed quality signal, not a monetary value.
  viralScore?: number;          // Gemini viralScore (1-100) for the candidate that triggered this deploy
  saturationCount?: number;     // DexScreener ticker count at time of evaluation (0 if check skipped)
  signalSources?: string[];     // URLs scraped by Firecrawl (stored as JSON string in DB)
  signalScrapedAt?: string;     // ISO timestamp when Firecrawl data was collected
  // V2.4.1: Candidate identity — correlates cross-chain deployments from the same evaluation cycle.
  candidateId?: string;         // Unique ID identifying the candidate evaluation cycle
  createdAt?: string;           // Optional explicit creation timestamp (defaults to datetime('now'))
  telegramBotToken?: string;    // Dedicated Telegram Bot Token from @BotFather for this CA
  telegramBotUsername?: string; // Dedicated Telegram Bot Username (e.g. @PumpRunOfficial_bot)
  websiteUrl?: string;          // Production Web3 website URL (e.g. https://ticker-official.vercel.app)
}

/**
 * Generates a unique, chronological candidate identifier for an evaluation cycle.
 * Format: cand_<timestamp>_<hex12>
 */
export function generateCandidateId(): string {
  return `cand_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function logDeploy(log: DeployLog): number {
  const result = db.run(
    `INSERT INTO deploy_logs
      (chain, token_name, ticker, contract_addr, tx_hash, ipfs_url, status, error_msg, deploy_cost, lifecycle_state, simulated, pool_id, attribution_status, attribution_reason, wallet_id, proxy_id, viral_score, saturation_count, signal_sources, signal_scraped_at, candidate_id, created_at, telegram_bot_token, telegram_bot_username, website_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?)`,
    [
      log.chain,
      log.tokenName,
      log.ticker,
      log.contractAddr ?? null,
      log.txHash ?? null,
      log.ipfsUrl ?? null,
      log.status,
      log.errorMsg ?? null,
      log.deployCost ?? null,
      log.lifecycleState ?? "DEPLOY_SUBMITTED",
      log.simulated ? 1 : 0,
      log.poolId ?? null,
      log.attributionStatus ?? "unresolved",
      log.attributionReason ?? null,
      log.walletId ?? null,
      log.proxyId ?? null,
      log.viralScore ?? null,
      log.saturationCount ?? null,
      log.signalSources != null ? JSON.stringify(log.signalSources) : null,
      log.signalScrapedAt ?? null,
      log.candidateId ?? null,
      log.createdAt ?? null,
      log.telegramBotToken ?? null,
      log.telegramBotUsername ?? null,
      log.websiteUrl ?? null,
    ]
  );
  return result.lastInsertRowid as number;
}

export function updateDeploymentTelegramBot(
  contractAddr: string,
  botToken: string,
  botUsername?: string
): boolean {
  const result = db.run(
    `UPDATE deploy_logs 
     SET telegram_bot_token = ?, telegram_bot_username = ?
     WHERE LOWER(contract_addr) = LOWER(?)`,
    [botToken.trim(), botUsername?.trim() ?? null, contractAddr.trim()]
  );
  return result.changes > 0;
}

export function getDeploymentTelegramBot(contractAddr: string): {
  botToken: string | null;
  botUsername: string | null;
} | null {
  const row = db
    .query<{ telegram_bot_token: string | null; telegram_bot_username: string | null }, [string]>(
      `SELECT telegram_bot_token, telegram_bot_username 
       FROM deploy_logs 
       WHERE LOWER(contract_addr) = LOWER(?) 
       ORDER BY id DESC LIMIT 1`
    )
    .get(contractAddr.trim());
  if (!row) return null;
  return {
    botToken: row.telegram_bot_token,
    botUsername: row.telegram_bot_username,
  };
}

export function updateDeployLogWebsite(
  contractAddrOrId: string | number,
  websiteUrl: string
): boolean {
  if (!contractAddrOrId || !websiteUrl) return false;
  const isId = typeof contractAddrOrId === "number";
  const result = isId
    ? db.run(`UPDATE deploy_logs SET website_url = ? WHERE id = ?`, [websiteUrl.trim(), contractAddrOrId])
    : db.run(`UPDATE deploy_logs SET website_url = ? WHERE LOWER(contract_addr) = LOWER(?)`, [websiteUrl.trim(), contractAddrOrId.trim()]);
  return result.changes > 0;
}

export function getDeployLogWebsite(contractAddrOrId: string | number): string | null {
  if (!contractAddrOrId) return null;
  const isId = typeof contractAddrOrId === "number";
  const row = isId
    ? db.query<{ website_url: string | null }, [number]>(`SELECT website_url FROM deploy_logs WHERE id = ?`).get(contractAddrOrId)
    : db.query<{ website_url: string | null }, [string]>(`SELECT website_url FROM deploy_logs WHERE LOWER(contract_addr) = LOWER(?) ORDER BY id DESC LIMIT 1`).get(contractAddrOrId.trim());
  return row?.website_url ?? null;
}

// ─── TELEGRAM BOT POOL DAO HELPERS ───────────────────────────

export interface TelegramBotPoolRow {
  id: number;
  botToken: string;
  botUsername: string | null;
  assignedContractAddr: string | null;
  assignedAt: string | null;
  status: "AVAILABLE" | "ASSIGNED" | "REVOKED";
  createdAt: string;
}

export function addBotToPool(
  botToken: string,
  botUsername?: string
): { success: boolean; reason?: string } {
  if (!botToken || botToken.trim().length < 10) {
    return { success: false, reason: "Bot token tidak valid atau terlalu pendek" };
  }
  const cleanToken = botToken.trim();
  const cleanUsername = botUsername ? botUsername.trim().replace(/^@/, "") : null;
  try {
    db.run(
      `INSERT INTO telegram_bot_pool (bot_token, bot_username, status)
       VALUES (?, ?, 'AVAILABLE')`,
      [cleanToken, cleanUsername]
    );
    return { success: true };
  } catch (err: any) {
    if (String(err?.message || err).includes("UNIQUE constraint failed")) {
      if (cleanUsername) {
        db.run(
          `UPDATE telegram_bot_pool SET bot_username = ? WHERE bot_token = ?`,
          [cleanUsername, cleanToken]
        );
      }
      return { success: false, reason: "Token bot sudah ada di pool" };
    }
    return { success: false, reason: String(err?.message || err) };
  }
}

export function peekNextAvailableBot(): {
  id: number;
  botToken: string;
  botUsername: string | null;
} | null {
  const row = db
    .query<{ id: number; bot_token: string; bot_username: string | null }, []>(
      `SELECT id, bot_token, bot_username FROM telegram_bot_pool
       WHERE status = 'AVAILABLE' ORDER BY id ASC LIMIT 1`
    )
    .get();

  if (!row) return null;
  return {
    id: row.id,
    botToken: row.bot_token,
    botUsername: row.bot_username,
  };
}

export function updateBotPoolUsername(botId: number, botUsername?: string | null): boolean {
  if (!botId || !botUsername) return false;
  const clean = botUsername.trim().replace(/^@/, "");
  const res = db.run(`UPDATE telegram_bot_pool SET bot_username = ? WHERE id = ?`, [clean, botId]);
  return res.changes > 0;
}

export function acquireBotFromPool(
  contractAddr: string,
  preferredBotId?: number
): {
  id: number;
  botToken: string;
  botUsername: string | null;
} | null {
  if (!contractAddr) return null;
  const normAddr = contractAddr.trim();

  // 1. Cek apakah koin ini sudah memiliki bot yang di-assign sebelumnya (idempotency)
  const existing = db
    .query<{ id: number; bot_token: string; bot_username: string | null }, [string]>(
      `SELECT id, bot_token, bot_username FROM telegram_bot_pool
       WHERE LOWER(assigned_contract_addr) = LOWER(?) LIMIT 1`
    )
    .get(normAddr);

  if (existing) {
    return {
      id: existing.id,
      botToken: existing.bot_token,
      botUsername: existing.bot_username,
    };
  }

  // 2. Ambil bot target: gunakan preferredBotId jika ada dan masih AVAILABLE, atau ambil pertama yang AVAILABLE
  let target: { id: number; bot_token: string; bot_username: string | null } | null = null;
  if (preferredBotId) {
    target = db
      .query<{ id: number; bot_token: string; bot_username: string | null }, [number]>(
        `SELECT id, bot_token, bot_username FROM telegram_bot_pool
         WHERE id = ? AND status = 'AVAILABLE' LIMIT 1`
      )
      .get(preferredBotId);
  }

  if (!target) {
    target = db
      .query<{ id: number; bot_token: string; bot_username: string | null }, []>(
        `SELECT id, bot_token, bot_username FROM telegram_bot_pool
         WHERE status = 'AVAILABLE' ORDER BY id ASC LIMIT 1`
      )
      .get();
  }

  if (!target) {
    return null;
  }

  // 3. Update status bot menjadi ASSIGNED ke koin ini secara atomik
  const now = new Date().toISOString();
  db.run(
    `UPDATE telegram_bot_pool
     SET status = 'ASSIGNED', assigned_contract_addr = ?, assigned_at = ?
     WHERE id = ?`,
    [normAddr, now, target.id]
  );

  return {
    id: target.id,
    botToken: target.bot_token,
    botUsername: target.bot_username,
  };
}

export function releaseBotToPool(contractAddr: string): boolean {
  if (!contractAddr) return false;
  const res = db.run(
    `UPDATE telegram_bot_pool
     SET status = 'AVAILABLE', assigned_contract_addr = NULL, assigned_at = NULL
     WHERE LOWER(assigned_contract_addr) = LOWER(?)`,
    [contractAddr.trim()]
  );
  return res.changes > 0;
}

export function syncBotPoolFromEnv(): { added: number; existing: number; total: number } {
  const envPool = process.env.TELEGRAM_BOT_POOL;
  if (!envPool || envPool.trim().length === 0) {
    const summary = getBotPoolSummary();
    return { added: 0, existing: summary.total, total: summary.total };
  }

  const tokens = envPool
    .split(/[,\n;]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 10);

  let added = 0;
  let existing = 0;

  for (const tok of tokens) {
    const res = addBotToPool(tok);
    if (res.success) {
      added++;
    } else {
      existing++;
    }
  }

  const summary = getBotPoolSummary();
  return { added, existing, total: summary.total };
}

export function getBotPoolSummary(): {
  available: number;
  assigned: number;
  total: number;
  lowPoolAlert: boolean;
} {
  const rows = db
    .query<{ status: string; count: number }, []>(
      `SELECT status, COUNT(*) as count FROM telegram_bot_pool GROUP BY status`
    )
    .all();

  let available = 0;
  let assigned = 0;
  let total = 0;

  for (const r of rows) {
    const cnt = Number(r.count);
    total += cnt;
    if (r.status === "AVAILABLE") available = cnt;
    if (r.status === "ASSIGNED") assigned = cnt;
  }

  const lowPoolAlert = total > 0 && available <= 2;
  if (lowPoolAlert && process.env.NODE_ENV !== "test") {
    console.warn(
      `\x1b[33m[${new Date().toISOString()}] [WARN   ] ⚠️  [LOW BOT POOL ALERT] Cadangan bot Telegram tersisa ${available} bot (Total: ${total}, Terpakai: ${assigned}). Segera tambahkan bot via manage-telegram-pool.ts!\x1b[0m`
    );
  }

  return { available, assigned, total, lowPoolAlert };
}

export function listBotPool(): TelegramBotPoolRow[] {
  const rows = db
    .query<
      {
        id: number;
        bot_token: string;
        bot_username: string | null;
        assigned_contract_addr: string | null;
        assigned_at: string | null;
        status: string;
        created_at: string;
      },
      []
    >(`SELECT * FROM telegram_bot_pool ORDER BY id ASC`)
    .all();

  return rows.map((r) => ({
    id: r.id,
    botToken: r.bot_token,
    botUsername: r.bot_username,
    assignedContractAddr: r.assigned_contract_addr,
    assignedAt: r.assigned_at,
    status: r.status as "AVAILABLE" | "ASSIGNED" | "REVOKED",
    createdAt: r.created_at,
  }));
}

export function updateDeployLifecycle(
  id: number,
  state: string,
  extra?: {
    contractAddr?: string;
    txHash?: string;
    status?: string;
    errorMsg?: string;
    deployCost?: number;
    poolId?: string;
    simulated?: boolean;
    attributionStatus?: string;
    attributionReason?: string;
    walletId?: string;
    proxyId?: string;
    exitStatus?: string;
    candidateId?: string;
  }
): void {
  const sets: string[] = ["lifecycle_state = ?"];
  const params: unknown[] = [state];

  if (extra?.contractAddr !== undefined) {
    sets.push("contract_addr = ?");
    params.push(extra.contractAddr);
  }
  if (extra?.txHash !== undefined) {
    sets.push("tx_hash = ?");
    params.push(extra.txHash);
  }
  if (extra?.status !== undefined) {
    sets.push("status = ?");
    params.push(extra.status);
  }
  if (extra?.errorMsg !== undefined) {
    sets.push("error_msg = ?");
    params.push(extra.errorMsg);
  }
  if (extra?.deployCost !== undefined) {
    sets.push("deploy_cost = ?");
    params.push(extra.deployCost);
  }
  if (extra?.poolId !== undefined) {
    sets.push("pool_id = ?");
    params.push(extra.poolId);
  }
  if (extra?.simulated !== undefined) {
    sets.push("simulated = ?");
    params.push(extra.simulated ? 1 : 0);
  }
  if (extra?.attributionStatus !== undefined) {
    sets.push("attribution_status = ?");
    params.push(extra.attributionStatus);
  }
  if (extra?.attributionReason !== undefined) {
    sets.push("attribution_reason = ?");
    params.push(extra.attributionReason);
  }
  if (extra?.walletId !== undefined) {
    sets.push("wallet_id = ?");
    params.push(extra.walletId);
  }
  if (extra?.proxyId !== undefined) {
    sets.push("proxy_id = ?");
    params.push(extra.proxyId);
  }
  if (extra?.exitStatus !== undefined) {
    sets.push("exit_status = ?");
    params.push(extra.exitStatus);
  }
  if (extra?.candidateId !== undefined) {
    sets.push("candidate_id = ?");
    params.push(extra.candidateId);
  }

  params.push(id);
  db.run(`UPDATE deploy_logs SET ${sets.join(", ")} WHERE id = ?`, params as any);
}

export function isEvidenceRankHigher(newStatus: string, currentStatus?: string | null): boolean {
  const ranks: Record<string, number> = {
    unresolved: 1,
    unknown: 1,
    balance_delta_only: 2,
    transaction_verified: 3,
  };
  const currentRank = ranks[currentStatus ?? "unresolved"] ?? 1;
  const newRank = ranks[newStatus] ?? 1;
  return newRank >= currentRank;
}

// ─── Active Positions (Lifecycle & Atomic Transitions) ───────
export type PositionStatus = "buy_submitted" | "open" | "closing" | "closed";

export interface ActivePosition {
  id: number;
  deployLogId: number;
  chain: string;
  contractAddr: string;
  ticker: string;
  snipeAmount: number;
  entryPrice: number | null;
  takeProfitX: number;
  stopLossPct: number;
  status: PositionStatus | string;
  exitReason?: string | null;
  closedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  walletAddress?: string | null;
  deploymentTxHash?: string | null;
  buyTxHash?: string | null;
  sellTxHash?: string | null;
  lastReconciledAt?: string | null;
  reconciliationStatus?: string | null;
  balanceBefore?: string | null;
  balanceAfter?: string | null;
  currentBalance?: string | null;
  tokenDecimals?: number | null;
  exitPrice?: number | null;
  entryAmount?: number | null;
  exitAmount?: number | null;
  fees?: number | null;
  realizedPnl?: number | null;
  realizedPnlPercent?: number | null;
  entryCostRaw?: string | null;
  exitProceedsRaw?: string | null;
  entryFeeRaw?: string | null;
  exitFeeRaw?: string | null;
  attributionStatus?: string | null;
  attributionReason?: string | null;
  pnlStatus?: string | null;
  priceReturnPercent?: number | null;
  walletId?: string | null;
  proxyId?: string | null;
}

export function hasActiveOrPendingPosition(contractAddr: string): boolean {
  const row = db
    .query(
      `SELECT id FROM active_positions 
       WHERE contract_addr = ? AND status IN ('buy_submitted', 'open', 'closing')`
    )
    .get(contractAddr);
  return Boolean(row);
}

export function createPendingPosition(params: {
  deployLogId: number;
  chain: string;
  contractAddr: string;
  ticker: string;
  snipeAmount: number;
  takeProfitX: number;
  stopLossPct: number;
  walletAddress?: string;
  balanceBefore?: string;
  deploymentTxHash?: string;
  tokenDecimals?: number;
  entryCostRaw?: string;
  entryFeeRaw?: string;
  attributionStatus?: string;
  attributionReason?: string;
  walletId?: string;
  proxyId?: string;
}): boolean {
  try {
    const res = db.run(
      `INSERT INTO active_positions
        (deploy_log_id, chain, contract_addr, ticker, snipe_amount, take_profit_x, stop_loss_pct, status, wallet_address, balance_before, deployment_tx_hash, token_decimals, current_balance, entry_cost_raw, entry_fee_raw, attribution_status, attribution_reason, pnl_status, wallet_id, proxy_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'buy_submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        params.deployLogId,
        params.chain,
        params.contractAddr,
        params.ticker,
        params.snipeAmount,
        params.takeProfitX,
        params.stopLossPct,
        params.walletAddress ?? null,
        params.balanceBefore ?? "0",
        params.deploymentTxHash ?? null,
        params.tokenDecimals ?? 18,
        params.balanceBefore ?? "0",
        params.entryCostRaw ?? null,
        params.entryFeeRaw ?? null,
        params.attributionStatus ?? "unresolved",
        params.attributionReason ?? null,
        params.walletId ?? null,
        params.proxyId ?? null,
      ]
    );
    return res.changes > 0;
  } catch {
    return false;
  }
}

/**
 * Atomic state transition: returns true only if previous state matched expectedState.
 */
export function transitionPositionState(
  contractAddr: string,
  fromState: string | string[],
  toState: string,
  extra?: {
    exitReason?: string;
    entryPrice?: number;
    closedAt?: string;
    reconciliationStatus?: string;
    realizedPnl?: number;
    realizedPnlPercent?: number;
    exitPrice?: number;
    exitAmount?: number;
    currentBalance?: string;
    balanceAfter?: string;
    entryCostRaw?: string;
    exitProceedsRaw?: string;
    entryFeeRaw?: string;
    exitFeeRaw?: string;
    attributionStatus?: string;
    attributionReason?: string;
    pnlStatus?: string;
    priceReturnPercent?: number;
    walletId?: string;
    proxyId?: string;
  }
): boolean {
  const fromStates = Array.isArray(fromState) ? fromState : [fromState];
  const placeholders = fromStates.map(() => "?").join(", ");

  const sets: string[] = ["status = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [toState];

  if (extra?.exitReason !== undefined) {
    sets.push("exit_reason = ?");
    params.push(extra.exitReason);
  }
  if (extra?.entryPrice !== undefined) {
    sets.push("entry_price = ?");
    params.push(extra.entryPrice);
  }
  if (extra?.closedAt !== undefined) {
    sets.push("closed_at = ?");
    params.push(extra.closedAt);
  }
  if (extra?.reconciliationStatus !== undefined) {
    sets.push("reconciliation_status = ?");
    params.push(extra.reconciliationStatus);
  }
  if (extra?.realizedPnl !== undefined) {
    sets.push("realized_pnl = ?");
    params.push(extra.realizedPnl);
  }
  if (extra?.realizedPnlPercent !== undefined) {
    sets.push("realized_pnl_percent = ?");
    params.push(extra.realizedPnlPercent);
  }
  if (extra?.exitPrice !== undefined) {
    sets.push("exit_price = ?");
    params.push(extra.exitPrice);
  }
  if (extra?.exitAmount !== undefined) {
    sets.push("exit_amount = ?");
    params.push(extra.exitAmount);
  }
  if (extra?.currentBalance !== undefined) {
    sets.push("current_balance = ?");
    params.push(extra.currentBalance);
  }
  if (extra?.balanceAfter !== undefined) {
    sets.push("balance_after = ?");
    params.push(extra.balanceAfter);
  }
  if (extra?.entryCostRaw !== undefined) {
    sets.push("entry_cost_raw = ?");
    params.push(extra.entryCostRaw);
  }
  if (extra?.exitProceedsRaw !== undefined) {
    sets.push("exit_proceeds_raw = ?");
    params.push(extra.exitProceedsRaw);
  }
  if (extra?.entryFeeRaw !== undefined) {
    sets.push("entry_fee_raw = ?");
    params.push(extra.entryFeeRaw);
  }
  if (extra?.exitFeeRaw !== undefined) {
    sets.push("exit_fee_raw = ?");
    params.push(extra.exitFeeRaw);
  }
  if (extra?.attributionStatus !== undefined) {
    const current = db.query("SELECT attribution_status FROM active_positions WHERE contract_addr = ?").get(contractAddr) as { attribution_status?: string } | null;
    if (isEvidenceRankHigher(extra.attributionStatus, current?.attribution_status)) {
      sets.push("attribution_status = ?");
      params.push(extra.attributionStatus);
      if (extra?.attributionReason !== undefined) {
        sets.push("attribution_reason = ?");
        params.push(extra.attributionReason);
      }
    }
  }
  if (extra?.pnlStatus !== undefined) {
    sets.push("pnl_status = ?");
    params.push(extra.pnlStatus);
  }
  if (extra?.priceReturnPercent !== undefined) {
    sets.push("price_return_percent = ?");
    params.push(extra.priceReturnPercent);
  }
  if (extra?.walletId !== undefined) {
    sets.push("wallet_id = ?");
    params.push(extra.walletId);
  }
  if (extra?.proxyId !== undefined) {
    sets.push("proxy_id = ?");
    params.push(extra.proxyId);
  }

  const sql = `UPDATE active_positions SET ${sets.join(", ")} WHERE contract_addr = ? AND status IN (${placeholders})`;
  params.push(contractAddr, ...fromStates);

  const res = db.run(sql, params as any);
  return res.changes > 0;
}

export function openPosition(
  deployLogId: number,
  chain: string,
  contractAddr: string,
  ticker: string,
  snipeAmount: number,
  takeProfitX: number,
  stopLossPct: number
): void {
  db.run(
    `INSERT OR IGNORE INTO active_positions
      (deploy_log_id, chain, contract_addr, ticker, snipe_amount, take_profit_x, stop_loss_pct, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
    [deployLogId, chain, contractAddr, ticker, snipeAmount, takeProfitX, stopLossPct]
  );
}

export function getPositionByContract(contractAddr: string): ActivePosition | null {
  const r = db
    .query(
      `SELECT id, deploy_log_id, chain, contract_addr, ticker,
              snipe_amount, entry_price, take_profit_x, stop_loss_pct, status,
              exit_reason, closed_at, created_at, updated_at, wallet_address, deployment_tx_hash,
              buy_tx_hash, sell_tx_hash, last_reconciled_at, reconciliation_status,
              balance_before, balance_after, current_balance, token_decimals,
              exit_price, entry_amount, exit_amount, fees, realized_pnl, realized_pnl_percent,
              entry_cost_raw, exit_proceeds_raw, entry_fee_raw, exit_fee_raw,
              attribution_status, attribution_reason, pnl_status, price_return_percent,
              wallet_id, proxy_id
       FROM active_positions WHERE contract_addr = ?`
    )
    .get(contractAddr) as Record<string, unknown> | null;

  if (!r) return null;

  return {
    id: r.id as number,
    deployLogId: r.deploy_log_id as number,
    chain: r.chain as string,
    contractAddr: r.contract_addr as string,
    ticker: r.ticker as string,
    snipeAmount: r.snipe_amount as number,
    entryPrice: r.entry_price as number | null,
    takeProfitX: r.take_profit_x as number,
    stopLossPct: r.stop_loss_pct as number,
    status: r.status as string,
    exitReason: r.exit_reason as string | null,
    closedAt: r.closed_at as string | null,
    createdAt: (r.created_at as string) ?? null,
    updatedAt: r.updated_at as string | null,
    walletAddress: r.wallet_address as string | null,
    deploymentTxHash: r.deployment_tx_hash as string | null,
    buyTxHash: r.buy_tx_hash as string | null,
    sellTxHash: r.sell_tx_hash as string | null,
    lastReconciledAt: r.last_reconciled_at as string | null,
    reconciliationStatus: r.reconciliation_status as string | null,
    balanceBefore: r.balance_before as string | null,
    balanceAfter: r.balance_after as string | null,
    currentBalance: r.current_balance as string | null,
    tokenDecimals: r.token_decimals as number | null,
    exitPrice: r.exit_price as number | null,
    entryAmount: r.entry_amount as number | null,
    exitAmount: r.exit_amount as number | null,
    fees: r.fees as number | null,
    realizedPnl: r.realized_pnl as number | null,
    realizedPnlPercent: r.realized_pnl_percent as number | null,
    entryCostRaw: r.entry_cost_raw as string | null,
    exitProceedsRaw: r.exit_proceeds_raw as string | null,
    entryFeeRaw: r.entry_fee_raw as string | null,
    exitFeeRaw: r.exit_fee_raw as string | null,
    attributionStatus: r.attribution_status as string | null,
    attributionReason: r.attribution_reason as string | null,
    pnlStatus: r.pnl_status as string | null,
    priceReturnPercent: r.price_return_percent as number | null,
    walletId: (r.wallet_id as string) ?? null,
    proxyId: (r.proxy_id as string) ?? null,
  };
}

export function updatePositionReconciliation(
  contractAddr: string,
  update: {
    status?: string;
    reconciliationStatus?: string;
    lastReconciledAt?: string;
    balanceBefore?: string;
    balanceAfter?: string;
    currentBalance?: string;
    tokenDecimals?: number;
    exitPrice?: number;
    entryAmount?: number;
    exitAmount?: number;
    fees?: number;
    realizedPnl?: number;
    realizedPnlPercent?: number;
    buyTxHash?: string;
    sellTxHash?: string;
    closedAt?: string;
    exitReason?: string;
    walletAddress?: string;
    entryCostRaw?: string;
    exitProceedsRaw?: string;
    entryFeeRaw?: string;
    exitFeeRaw?: string;
    attributionStatus?: string;
    attributionReason?: string;
    pnlStatus?: string;
    priceReturnPercent?: number;
    walletId?: string;
    proxyId?: string;
  }
): boolean {
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (update.walletAddress !== undefined) {
    sets.push("wallet_address = ?");
    params.push(update.walletAddress);
  }

  if (update.status !== undefined) {
    sets.push("status = ?");
    params.push(update.status);
  }
  if (update.reconciliationStatus !== undefined) {
    sets.push("reconciliation_status = ?");
    params.push(update.reconciliationStatus);
  }
  if (update.lastReconciledAt !== undefined) {
    sets.push("last_reconciled_at = ?");
    params.push(update.lastReconciledAt);
  }
  if (update.balanceBefore !== undefined) {
    sets.push("balance_before = ?");
    params.push(update.balanceBefore);
  }
  if (update.balanceAfter !== undefined) {
    sets.push("balance_after = ?");
    params.push(update.balanceAfter);
  }
  if (update.currentBalance !== undefined) {
    sets.push("current_balance = ?");
    params.push(update.currentBalance);
  }
  if (update.tokenDecimals !== undefined) {
    sets.push("token_decimals = ?");
    params.push(update.tokenDecimals);
  }
  if (update.exitPrice !== undefined) {
    sets.push("exit_price = ?");
    params.push(update.exitPrice);
  }
  if (update.entryAmount !== undefined) {
    sets.push("entry_amount = ?");
    params.push(update.entryAmount);
  }
  if (update.exitAmount !== undefined) {
    sets.push("exit_amount = ?");
    params.push(update.exitAmount);
  }
  if (update.fees !== undefined) {
    sets.push("fees = ?");
    params.push(update.fees);
  }
  if (update.realizedPnl !== undefined) {
    sets.push("realized_pnl = ?");
    params.push(update.realizedPnl);
  }
  if (update.realizedPnlPercent !== undefined) {
    sets.push("realized_pnl_percent = ?");
    params.push(update.realizedPnlPercent);
  }
  if (update.buyTxHash !== undefined) {
    sets.push("buy_tx_hash = ?");
    params.push(update.buyTxHash);
  }
  if (update.sellTxHash !== undefined) {
    sets.push("sell_tx_hash = ?");
    params.push(update.sellTxHash);
  }
  if (update.closedAt !== undefined) {
    sets.push("closed_at = ?");
    params.push(update.closedAt);
  }
  if (update.exitReason !== undefined) {
    sets.push("exit_reason = ?");
    params.push(update.exitReason);
  }
  if (update.entryCostRaw !== undefined) {
    sets.push("entry_cost_raw = ?");
    params.push(update.entryCostRaw);
  }
  if (update.exitProceedsRaw !== undefined) {
    sets.push("exit_proceeds_raw = ?");
    params.push(update.exitProceedsRaw);
  }
  if (update.entryFeeRaw !== undefined) {
    sets.push("entry_fee_raw = ?");
    params.push(update.entryFeeRaw);
  }
  if (update.exitFeeRaw !== undefined) {
    sets.push("exit_fee_raw = ?");
    params.push(update.exitFeeRaw);
  }
  if (update.attributionStatus !== undefined) {
    const current = db.query("SELECT attribution_status FROM active_positions WHERE contract_addr = ?").get(contractAddr) as { attribution_status?: string } | null;
    if (isEvidenceRankHigher(update.attributionStatus, current?.attribution_status)) {
      sets.push("attribution_status = ?");
      params.push(update.attributionStatus);
      if (update.attributionReason !== undefined) {
        sets.push("attribution_reason = ?");
        params.push(update.attributionReason);
      }
    }
  }
  if (update.pnlStatus !== undefined) {
    sets.push("pnl_status = ?");
    params.push(update.pnlStatus);
  }
  if (update.priceReturnPercent !== undefined) {
    sets.push("price_return_percent = ?");
    params.push(update.priceReturnPercent);
  }
  if (update.walletId !== undefined) {
    sets.push("wallet_id = ?");
    params.push(update.walletId);
  }
  if (update.proxyId !== undefined) {
    sets.push("proxy_id = ?");
    params.push(update.proxyId);
  }

  const sql = `UPDATE active_positions SET ${sets.join(", ")} WHERE contract_addr = ?`;
  params.push(contractAddr);

  const res = db.run(sql, params as any);
  return res.changes > 0;
}

export function getUnreconciledDeployments(): DeployLog[] {
  return (
    db
      .query(
        `SELECT id, chain, token_name, ticker, contract_addr, tx_hash, ipfs_url,
                status, error_msg, deploy_cost, lifecycle_state, simulated, pool_id,
                attribution_status, attribution_reason, wallet_id, proxy_id
         FROM deploy_logs
         WHERE lifecycle_state IN ('DEPLOY_SUBMITTED', 'UNRESOLVED_UNKNOWN')
           AND tx_hash IS NOT NULL`
      )
      .all() as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id as number,
    chain: r.chain as string,
    tokenName: r.token_name as string,
    ticker: r.ticker as string,
    contractAddr: (r.contract_addr as string) ?? undefined,
    txHash: (r.tx_hash as string) ?? undefined,
    ipfsUrl: (r.ipfs_url as string) ?? undefined,
    status: r.status as "success" | "failed" | "pending" | "unknown",
    errorMsg: (r.error_msg as string) ?? undefined,
    deployCost: (r.deploy_cost as number) ?? undefined,
    lifecycleState: (r.lifecycle_state as string) ?? undefined,
    simulated: Boolean(r.simulated),
    poolId: (r.pool_id as string) ?? undefined,
    attributionStatus: (r.attribution_status as any) ?? "unresolved",
    attributionReason: (r.attribution_reason as string) ?? undefined,
    walletId: (r.wallet_id as string) ?? undefined,
    proxyId: (r.proxy_id as string) ?? undefined,
  }));
}

export function getPositionsByStatus(statuses: string | string[]): ActivePosition[] {
  const statusList = Array.isArray(statuses) ? statuses : [statuses];
  const placeholders = statusList.map(() => "?").join(", ");

  return (
    db
      .query(
        `SELECT id, deploy_log_id, chain, contract_addr, ticker,
               snipe_amount, entry_price, take_profit_x, stop_loss_pct, status,
               exit_reason, closed_at, created_at, updated_at, wallet_address, deployment_tx_hash,
               buy_tx_hash, sell_tx_hash, last_reconciled_at, reconciliation_status,
               balance_before, balance_after, current_balance, token_decimals,
               exit_price, entry_amount, exit_amount, fees, realized_pnl, realized_pnl_percent,
               entry_cost_raw, exit_proceeds_raw, entry_fee_raw, exit_fee_raw,
               attribution_status, attribution_reason, pnl_status, price_return_percent,
               wallet_id, proxy_id
        FROM active_positions WHERE status IN (${placeholders})`
      )
      .all(...statusList) as Array<Record<string, unknown>>
  ).map((r) => ({
    id: r.id as number,
    deployLogId: r.deploy_log_id as number,
    chain: r.chain as string,
    contractAddr: r.contract_addr as string,
    ticker: r.ticker as string,
    snipeAmount: r.snipe_amount as number,
    entryPrice: r.entry_price as number | null,
    takeProfitX: r.take_profit_x as number,
    stopLossPct: r.stop_loss_pct as number,
    status: r.status as string,
    exitReason: r.exit_reason as string | null,
    closedAt: r.closed_at as string | null,
    createdAt: (r.created_at as string) ?? null,
    updatedAt: r.updated_at as string | null,
    walletAddress: r.wallet_address as string | null,
    deploymentTxHash: r.deployment_tx_hash as string | null,
    buyTxHash: r.buy_tx_hash as string | null,
    sellTxHash: r.sell_tx_hash as string | null,
    lastReconciledAt: r.last_reconciled_at as string | null,
    reconciliationStatus: r.reconciliation_status as string | null,
    balanceBefore: r.balance_before as string | null,
    balanceAfter: r.balance_after as string | null,
    currentBalance: r.current_balance as string | null,
    tokenDecimals: r.token_decimals as number | null,
    exitPrice: r.exit_price as number | null,
    entryAmount: r.entry_amount as number | null,
    exitAmount: r.exit_amount as number | null,
    fees: r.fees as number | null,
    realizedPnl: r.realized_pnl as number | null,
    realizedPnlPercent: r.realized_pnl_percent as number | null,
    entryCostRaw: r.entry_cost_raw as string | null,
    exitProceedsRaw: r.exit_proceeds_raw as string | null,
    entryFeeRaw: r.entry_fee_raw as string | null,
    exitFeeRaw: r.exit_fee_raw as string | null,
    attributionStatus: r.attribution_status as string | null,
    attributionReason: r.attribution_reason as string | null,
    pnlStatus: r.pnl_status as string | null,
    priceReturnPercent: r.price_return_percent as number | null,
    walletId: (r.wallet_id as string) ?? null,
    proxyId: (r.proxy_id as string) ?? null,
  }));
}

export function getOpenPositions(): ActivePosition[] {
  return getPositionsByStatus(["open", "buy_submitted", "closing"]);
}

export function updatePositionEntryPrice(contractAddr: string, price: number): void {
  db.run(
    "UPDATE active_positions SET entry_price = ?, updated_at = datetime('now') WHERE contract_addr = ?",
    [price, contractAddr]
  );
}

export function closePosition(
  contractAddr: string,
  exitStatus: "sold_tp" | "sold_sl" | "manual"
): void {
  transitionPositionState(contractAddr, ["open", "closing"], exitStatus, {
    exitReason: exitStatus,
    closedAt: new Date().toISOString(),
  });
  db.run(
    "UPDATE deploy_logs SET exit_status = ? WHERE contract_addr = ?",
    [exitStatus, contractAddr]
  );
}

// ─── Daily Counter (safety cap) ─────────────────────────────
export function getTodayDeployCount(): number {
  const today = new Date().toISOString().slice(0, 10);
  const row = db
    .query("SELECT deploy_count FROM daily_counter WHERE date = ?")
    .get(today) as { deploy_count: number } | null;
  return row?.deploy_count ?? 0;
}

export function incrementTodayDeployCount(): void {
  const today = new Date().toISOString().slice(0, 10);
  db.run(
    `INSERT INTO daily_counter (date, deploy_count) VALUES (?, 1)
     ON CONFLICT(date) DO UPDATE SET deploy_count = deploy_count + 1`,
    [today]
  );
}

export function closeDb(): void {
  db.close();
}

// ─── Fee Events & Treasury Ledger ─────────────────────────────

export type FeeStatus =
  | "detected"
  | "claimable"
  | "claim_submitted"
  | "claim_pending"
  | "claimed"
  | "swept"
  | "failed"
  | "unknown";
export type TreasuryEventType = "fee_detected" | "fee_claimed" | "realized_pnl_credited" | "treasury_sweep" | "gas_sponsorship";
export type TreasuryDirection = "credit" | "debit";
export type SweepStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface FeeEvent {
  id: number;
  eventKey: string;
  walletId: string;
  deployLogId?: number | null;
  chain: string;
  tokenAddress?: string | null;
  poolId?: string | null;
  source: string;
  beneficiaryAddress: string;
  tokenSymbol: string;
  amountRaw: string;
  amountFormatted: number;
  status: FeeStatus;
  claimTxHash?: string | null;
  claimedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface FeeEventInput {
  eventKey: string;
  walletId: string;
  deployLogId?: number;
  chain: string;
  tokenAddress?: string;
  poolId?: string;
  source: string;
  beneficiaryAddress: string;
  tokenSymbol: string;
  amountRaw: string;
  amountFormatted: number;
  status?: FeeStatus;
  metadata?: Record<string, unknown>;
}

export interface TreasuryLedgerEntry {
  id: number;
  entryId: string;
  walletId: string;
  chain: string;
  eventType: TreasuryEventType;
  tokenSymbol: string;
  amountRaw: string;
  amountFormatted: number;
  direction: TreasuryDirection;
  sourceRefType: string;
  sourceRefId: string;
  txHash?: string | null;
  beneficiaryAddress?: string | null;
  destinationAddress?: string | null;
  status: string;
  reconciliationNotes?: string | null;
  createdAt: string;
}

export interface TreasuryLedgerInput {
  entryId: string;
  walletId: string;
  chain: string;
  eventType: TreasuryEventType;
  tokenSymbol: string;
  amountRaw: string;
  amountFormatted: number;
  direction: TreasuryDirection;
  sourceRefType: string;
  sourceRefId: string;
  txHash?: string;
  beneficiaryAddress?: string;
  destinationAddress?: string;
  status?: string;
  reconciliationNotes?: string;
}

export interface TreasurySweep {
  id: number;
  sweepId: string;
  walletId: string;
  chain: string;
  tokenSymbol: string;
  amountRaw: string;
  amountFormatted: number;
  sourceAddress: string;
  destinationAddress: string;
  txHash?: string | null;
  status: SweepStatus;
  errorReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreasurySweepInput {
  sweepId: string;
  walletId: string;
  chain: string;
  tokenSymbol: string;
  amountRaw: string;
  amountFormatted: number;
  sourceAddress: string;
  destinationAddress: string;
  txHash?: string;
  status?: SweepStatus;
}

export interface TreasuryBalanceSummary {
  walletId?: string;
  totalFeesClaimedFormatted: number;
  totalPnlCreditedFormatted: number;
  totalSweptFormatted: number;
  totalGasSponsorshipSavingsFormatted: number;
  netTreasuryBalanceFormatted: number;
  byAsset: Record<string, { credit: number; debit: number; net: number }>;
}

export function recordFeeEvent(input: FeeEventInput): FeeEvent {
  const metaJson = input.metadata ? JSON.stringify(input.metadata) : null;
  const status = input.status ?? "detected";

  db.run(
    `INSERT INTO fee_events
      (event_key, wallet_id, deploy_log_id, chain, token_address, pool_id, source, beneficiary_address, token_symbol, amount_raw, amount_formatted, status, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_key) DO NOTHING`,
    [
      input.eventKey,
      input.walletId,
      input.deployLogId ?? null,
      input.chain,
      input.tokenAddress ?? null,
      input.poolId ?? null,
      input.source,
      input.beneficiaryAddress,
      input.tokenSymbol,
      input.amountRaw,
      input.amountFormatted,
      status,
      metaJson,
    ]
  );

  return getFeeEventByKey(input.eventKey)!;
}

export function getFeeEventByKey(eventKey: string): FeeEvent | null {
  const r = db
    .query(
      `SELECT id, event_key, wallet_id, deploy_log_id, chain, token_address, pool_id, source,
              beneficiary_address, token_symbol, amount_raw, amount_formatted, status,
              claim_tx_hash, claimed_at, metadata, created_at, updated_at
       FROM fee_events WHERE event_key = ?`
    )
    .get(eventKey) as Record<string, unknown> | null;

  if (!r) return null;

  let metadata: Record<string, unknown> | null = null;
  if (typeof r.metadata === "string") {
    try {
      metadata = JSON.parse(r.metadata);
    } catch {
      metadata = null;
    }
  }

  return {
    id: r.id as number,
    eventKey: r.event_key as string,
    walletId: r.wallet_id as string,
    deployLogId: (r.deploy_log_id as number) ?? null,
    chain: r.chain as string,
    tokenAddress: (r.token_address as string) ?? null,
    poolId: (r.pool_id as string) ?? null,
    source: r.source as string,
    beneficiaryAddress: r.beneficiary_address as string,
    tokenSymbol: r.token_symbol as string,
    amountRaw: r.amount_raw as string,
    amountFormatted: r.amount_formatted as number,
    status: r.status as FeeStatus,
    claimTxHash: (r.claim_tx_hash as string) ?? null,
    claimedAt: (r.claimed_at as string) ?? null,
    metadata,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function getFeeEventById(id: number): FeeEvent | null {
  const r = db
    .query(
      `SELECT id, event_key, wallet_id, deploy_log_id, chain, token_address, pool_id, source,
              beneficiary_address, token_symbol, amount_raw, amount_formatted, status,
              claim_tx_hash, claimed_at, metadata, created_at, updated_at
       FROM fee_events WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | null;

  if (!r) return null;
  return getFeeEventByKey(r.event_key as string);
}

export function getFeeEvents(filter?: {
  walletId?: string;
  status?: string;
  chain?: string;
  source?: string;
}): FeeEvent[] {
  let query = `SELECT event_key FROM fee_events`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.walletId) {
    conditions.push("wallet_id = ?");
    params.push(filter.walletId);
  }
  if (filter?.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter?.chain) {
    conditions.push("chain = ?");
    params.push(filter.chain);
  }
  if (filter?.source) {
    conditions.push("source = ?");
    params.push(filter.source);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY id DESC`;

  const rows = db.query(query).all(...(params as any)) as Array<{ event_key: string }>;
  return rows.map((r) => getFeeEventByKey(r.event_key)!).filter(Boolean);
}

export function updateFeeEventStatus(
  id: number,
  status: FeeStatus,
  extra?: {
    claimTxHash?: string;
    claimedAt?: string;
    metadata?: Record<string, unknown>;
  }
): boolean {
  const sets = ["status = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [status];

  if (extra?.claimTxHash !== undefined) {
    sets.push("claim_tx_hash = ?");
    params.push(extra.claimTxHash);
  }
  if (extra?.claimedAt !== undefined) {
    sets.push("claimed_at = ?");
    params.push(extra.claimedAt);
  }
  if (extra?.metadata !== undefined) {
    sets.push("metadata = ?");
    params.push(JSON.stringify(extra.metadata));
  }

  params.push(id);
  const sql = `UPDATE fee_events SET ${sets.join(", ")} WHERE id = ?`;
  const res = db.run(sql, params as any);
  return res.changes > 0;
}

export function getInFlightFeeEvents(): FeeEvent[] {
  const rows = db
    .query(
      `SELECT event_key FROM fee_events 
       WHERE status IN ('claim_submitted', 'claim_pending', 'unknown') 
       ORDER BY id ASC`
    )
    .all() as Array<{ event_key: string }>;
  return rows.map((r) => getFeeEventByKey(r.event_key)!).filter(Boolean);
}

export function getClaimedFeesMissingLedger(): FeeEvent[] {
  const rows = db
    .query(
      `SELECT f.event_key
       FROM fee_events f
       LEFT JOIN treasury_ledger l ON l.entry_id = ('tr_fee_' || f.id || '_claim')
       WHERE f.status = 'claimed' AND l.id IS NULL
       ORDER BY f.id ASC`
    )
    .all() as Array<{ event_key: string }>;
  return rows.map((r) => getFeeEventByKey(r.event_key)!).filter(Boolean);
}

export function insertTreasuryLedgerEntry(entry: TreasuryLedgerInput): TreasuryLedgerEntry {
  db.run(
    `INSERT INTO treasury_ledger
      (entry_id, wallet_id, chain, event_type, token_symbol, amount_raw, amount_formatted, direction, source_ref_type, source_ref_id, tx_hash, beneficiary_address, destination_address, status, reconciliation_notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entry_id) DO NOTHING`,
    [
      entry.entryId,
      entry.walletId,
      entry.chain,
      entry.eventType,
      entry.tokenSymbol,
      entry.amountRaw,
      entry.amountFormatted,
      entry.direction,
      entry.sourceRefType,
      entry.sourceRefId,
      entry.txHash ?? null,
      entry.beneficiaryAddress ?? null,
      entry.destinationAddress ?? null,
      entry.status ?? "confirmed",
      entry.reconciliationNotes ?? null,
    ]
  );

  const r = db
    .query(
      `SELECT id, entry_id, wallet_id, chain, event_type, token_symbol, amount_raw, amount_formatted,
              direction, source_ref_type, source_ref_id, tx_hash, beneficiary_address,
              destination_address, status, reconciliation_notes, created_at
       FROM treasury_ledger WHERE entry_id = ?`
    )
    .get(entry.entryId) as Record<string, unknown>;

  return {
    id: r.id as number,
    entryId: r.entry_id as string,
    walletId: r.wallet_id as string,
    chain: r.chain as string,
    eventType: r.event_type as TreasuryEventType,
    tokenSymbol: r.token_symbol as string,
    amountRaw: r.amount_raw as string,
    amountFormatted: r.amount_formatted as number,
    direction: r.direction as TreasuryDirection,
    sourceRefType: r.source_ref_type as string,
    sourceRefId: r.source_ref_id as string,
    txHash: (r.tx_hash as string) ?? null,
    beneficiaryAddress: (r.beneficiary_address as string) ?? null,
    destinationAddress: (r.destination_address as string) ?? null,
    status: r.status as string,
    reconciliationNotes: (r.reconciliation_notes as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export function getTreasuryLedgerEntries(filter?: {
  walletId?: string;
  chain?: string;
  eventType?: string;
  direction?: string;
}): TreasuryLedgerEntry[] {
  let query = `SELECT id, entry_id, wallet_id, chain, event_type, token_symbol, amount_raw, amount_formatted,
                      direction, source_ref_type, source_ref_id, tx_hash, beneficiary_address,
                      destination_address, status, reconciliation_notes, created_at
               FROM treasury_ledger`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.walletId) {
    conditions.push("wallet_id = ?");
    params.push(filter.walletId);
  }
  if (filter?.chain) {
    conditions.push("chain = ?");
    params.push(filter.chain);
  }
  if (filter?.eventType) {
    conditions.push("event_type = ?");
    params.push(filter.eventType);
  }
  if (filter?.direction) {
    conditions.push("direction = ?");
    params.push(filter.direction);
  }

  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(" AND ")}`;
  }
  query += ` ORDER BY id ASC`;

  const rows = db.query(query).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    entryId: r.entry_id as string,
    walletId: r.wallet_id as string,
    chain: r.chain as string,
    eventType: r.event_type as TreasuryEventType,
    tokenSymbol: r.token_symbol as string,
    amountRaw: r.amount_raw as string,
    amountFormatted: r.amount_formatted as number,
    direction: r.direction as TreasuryDirection,
    sourceRefType: r.source_ref_type as string,
    sourceRefId: r.source_ref_id as string,
    txHash: (r.tx_hash as string) ?? null,
    beneficiaryAddress: (r.beneficiary_address as string) ?? null,
    destinationAddress: (r.destination_address as string) ?? null,
    status: r.status as string,
    reconciliationNotes: (r.reconciliation_notes as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

export function getTreasurySummaryByWallet(walletId?: string): TreasuryBalanceSummary {
  const entries = getTreasuryLedgerEntries(walletId ? { walletId } : undefined);

  let totalFeesClaimedFormatted = 0;
  let totalPnlCreditedFormatted = 0;
  let totalSweptFormatted = 0;
  let totalGasSponsorshipSavingsFormatted = 0;

  const byAsset: Record<string, { credit: number; debit: number; net: number }> = {};

  for (const entry of entries) {
    if (!byAsset[entry.tokenSymbol]) {
      byAsset[entry.tokenSymbol] = { credit: 0, debit: 0, net: 0 };
    }

    if (entry.direction === "credit") {
      if (entry.eventType === "gas_sponsorship") {
        totalGasSponsorshipSavingsFormatted += entry.amountFormatted;
      } else {
        byAsset[entry.tokenSymbol].credit += entry.amountFormatted;
        byAsset[entry.tokenSymbol].net += entry.amountFormatted;

        if (entry.eventType === "fee_claimed") {
          totalFeesClaimedFormatted += entry.amountFormatted;
        } else if (entry.eventType === "realized_pnl_credited") {
          totalPnlCreditedFormatted += entry.amountFormatted;
        }
      }
    } else if (entry.direction === "debit") {
      byAsset[entry.tokenSymbol].debit += entry.amountFormatted;
      byAsset[entry.tokenSymbol].net -= entry.amountFormatted;

      if (entry.eventType === "treasury_sweep") {
        totalSweptFormatted += entry.amountFormatted;
      }
    }
  }

  // ARCHITECTURAL NOTE:
  // Scalar balance totals (totalFeesClaimedFormatted, totalPnlCreditedFormatted, totalSweptFormatted, netTreasuryBalanceFormatted)
  // reflect primary ETH/EVM operations. Multi-currency breakdown (SOL vs ETH) is segregated strictly without
  // dimensional mixing within the `byAsset` dictionary.
  const netTreasuryBalanceFormatted =
    totalFeesClaimedFormatted + totalPnlCreditedFormatted - totalSweptFormatted;

  return {
    walletId,
    totalFeesClaimedFormatted,
    totalPnlCreditedFormatted,
    totalSweptFormatted,
    totalGasSponsorshipSavingsFormatted,
    netTreasuryBalanceFormatted,
    byAsset,
  };
}

/**
 * Calculates total ETH saved through Bankr relayer gas sponsorship across all deployments.
 */
export function getTotalGasSponsorshipSavings(walletId?: string): number {
  let query = "SELECT COALESCE(SUM(amount_formatted), 0) as total FROM treasury_ledger WHERE event_type = 'gas_sponsorship'";
  const params: any[] = [];
  if (walletId) {
    query += " AND wallet_id = ?";
    params.push(walletId);
  }
  const res = db.query(query).get(...params) as { total: number };
  return res ? res.total : 0;
}

export function insertTreasurySweep(sweep: TreasurySweepInput): TreasurySweep {
  db.run(
    `INSERT INTO treasury_sweeps
      (sweep_id, wallet_id, chain, token_symbol, amount_raw, amount_formatted, source_address, destination_address, tx_hash, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sweep_id) DO NOTHING`,
    [
      sweep.sweepId,
      sweep.walletId,
      sweep.chain,
      sweep.tokenSymbol,
      sweep.amountRaw,
      sweep.amountFormatted,
      sweep.sourceAddress,
      sweep.destinationAddress,
      sweep.txHash ?? null,
      sweep.status ?? "pending",
    ]
  );

  const r = db
    .query(
      `SELECT id, sweep_id, wallet_id, chain, token_symbol, amount_raw, amount_formatted,
              source_address, destination_address, tx_hash, status, error_reason, created_at, updated_at
       FROM treasury_sweeps WHERE sweep_id = ?`
    )
    .get(sweep.sweepId) as Record<string, unknown>;

  return {
    id: r.id as number,
    sweepId: r.sweep_id as string,
    walletId: r.wallet_id as string,
    chain: r.chain as string,
    tokenSymbol: r.token_symbol as string,
    amountRaw: r.amount_raw as string,
    amountFormatted: r.amount_formatted as number,
    sourceAddress: r.source_address as string,
    destinationAddress: r.destination_address as string,
    txHash: (r.tx_hash as string) ?? null,
    status: r.status as SweepStatus,
    errorReason: (r.error_reason as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function updateTreasurySweepStatus(
  sweepId: string,
  status: SweepStatus,
  extra?: { txHash?: string; errorReason?: string }
): boolean {
  const sets = ["status = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [status];

  if (extra?.txHash !== undefined) {
    sets.push("tx_hash = ?");
    params.push(extra.txHash);
  }
  if (extra?.errorReason !== undefined) {
    sets.push("error_reason = ?");
    params.push(extra.errorReason);
  }

  params.push(sweepId);
  const sql = `UPDATE treasury_sweeps SET ${sets.join(", ")} WHERE sweep_id = ?`;
  const res = db.run(sql, params as any);
  return res.changes > 0;
}

export function getTreasurySweeps(walletId?: string): TreasurySweep[] {
  let sql = `SELECT id, sweep_id, wallet_id, chain, token_symbol, amount_raw, amount_formatted,
                    source_address, destination_address, tx_hash, status, error_reason, created_at, updated_at
             FROM treasury_sweeps`;
  const params: unknown[] = [];

  if (walletId) {
    sql += ` WHERE wallet_id = ?`;
    params.push(walletId);
  }
  sql += ` ORDER BY id DESC`;

  const rows = db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    sweepId: r.sweep_id as string,
    walletId: r.wallet_id as string,
    chain: r.chain as string,
    tokenSymbol: r.token_symbol as string,
    amountRaw: r.amount_raw as string,
    amountFormatted: r.amount_formatted as number,
    sourceAddress: r.source_address as string,
    destinationAddress: r.destination_address as string,
    txHash: (r.tx_hash as string) ?? null,
    status: r.status as SweepStatus,
    errorReason: (r.error_reason as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));
}

// ─── V2.3 Owner Reporting Queries ────────────────────────────

export interface DeployLogRow {
  id: number;
  chain: string;
  tokenName: string;
  ticker: string;
  contractAddr: string | null;
  txHash: string | null;
  ipfsUrl: string | null;
  status: string;
  errorMsg: string | null;
  deployCost: number | null;
  lifecycleState: string | null;
  simulated: boolean;
  poolId: string | null;
  exitStatus: string | null;
  walletId: string | null;
  proxyId: string | null;
  attributionStatus: string | null;
  attributionReason: string | null;
  createdAt: string;
  // V2.4.0: Intelligence signal metadata — observational only, NOT financial metrics
  viralScore: number | null;       // AI-assessed quality signal (1-100); null if not evaluated this cycle
  saturationCount: number | null;  // DexScreener ticker match count; null if check was skipped
  signalSources: string[] | null;  // Scraped URLs (deserialized from JSON); null if not available
  signalScrapedAt: string | null;  // ISO timestamp of Firecrawl scrape; null if not available
  // V2.4.1: Candidate identity — correlates cross-chain deployments from the same evaluation cycle
  candidateId: string | null;      // Unique ID identifying the candidate evaluation cycle
  websiteUrl: string | null;       // Production Web3 website URL
}

function mapDeployLogRow(r: Record<string, unknown>): DeployLogRow {
  // Parse signalSources JSON string back to array, gracefully handle malformed data
  let signalSources: string[] | null = null;
  if (r.signal_sources && typeof r.signal_sources === "string") {
    try {
      const parsed = JSON.parse(r.signal_sources);
      signalSources = Array.isArray(parsed) ? parsed : null;
    } catch {
      signalSources = null;
    }
  }

  return {
    id: r.id as number,
    chain: r.chain as string,
    tokenName: r.token_name as string,
    ticker: r.ticker as string,
    contractAddr: (r.contract_addr as string) ?? null,
    txHash: (r.tx_hash as string) ?? null,
    ipfsUrl: (r.ipfs_url as string) ?? null,
    status: r.status as string,
    errorMsg: (r.error_msg as string) ?? null,
    deployCost: (r.deploy_cost as number) ?? null,
    lifecycleState: (r.lifecycle_state as string) ?? null,
    simulated: Boolean(r.simulated),
    poolId: (r.pool_id as string) ?? null,
    exitStatus: (r.exit_status as string) ?? null,
    walletId: (r.wallet_id as string) ?? null,
    proxyId: (r.proxy_id as string) ?? null,
    attributionStatus: (r.attribution_status as string) ?? null,
    attributionReason: (r.attribution_reason as string) ?? null,
    createdAt: r.created_at as string,
    viralScore: (r.viral_score as number) ?? null,
    saturationCount: (r.saturation_count as number) ?? null,
    signalSources,
    signalScrapedAt: (r.signal_scraped_at as string) ?? null,
    candidateId: (r.candidate_id as string) ?? null,
    websiteUrl: (r.website_url as string) ?? null,
  };
}

export function getDeployLogsByWallet(walletId: string): DeployLogRow[] {
  const rows = db.query(
    `SELECT id, chain, token_name, ticker, contract_addr, tx_hash, ipfs_url, status,
            error_msg, deploy_cost, lifecycle_state, simulated, pool_id, exit_status,
            wallet_id, proxy_id, attribution_status, attribution_reason, created_at,
            viral_score, saturation_count, signal_sources, signal_scraped_at, candidate_id, website_url
     FROM deploy_logs WHERE wallet_id = ? ORDER BY id DESC`
  ).all(walletId) as Array<Record<string, unknown>>;
  return rows.map(mapDeployLogRow);
}

export function getDeployLogById(id: number): DeployLogRow | null {
  const row = db
    .query(
      `SELECT id, chain, token_name, ticker, contract_addr, tx_hash, ipfs_url, status,
              error_msg, deploy_cost, lifecycle_state, simulated, pool_id, exit_status,
              wallet_id, proxy_id, attribution_status, attribution_reason, created_at,
              viral_score, saturation_count, signal_sources, signal_scraped_at, candidate_id, website_url
       FROM deploy_logs WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | null;
  if (!row) return null;
  return mapDeployLogRow(row);
}

export function getDeployLogByContract(contractAddr: string): DeployLogRow | null {
  const row = db
    .query(
      `SELECT id, chain, token_name, ticker, contract_addr, tx_hash, ipfs_url, status,
              error_msg, deploy_cost, lifecycle_state, simulated, pool_id, exit_status,
              wallet_id, proxy_id, attribution_status, attribution_reason, created_at,
              viral_score, saturation_count, signal_sources, signal_scraped_at, candidate_id, website_url
       FROM deploy_logs WHERE lower(contract_addr) = lower(?) ORDER BY id DESC LIMIT 1`
    )
    .get(contractAddr) as Record<string, unknown> | null;
  if (!row) return null;
  return mapDeployLogRow(row);
}

export function getAllDeployLogs(filter?: { chain?: string; status?: string; candidateId?: string; limit?: number }): DeployLogRow[] {
  let sql = `SELECT id, chain, token_name, ticker, contract_addr, tx_hash, ipfs_url, status,
                    error_msg, deploy_cost, lifecycle_state, simulated, pool_id, exit_status,
                    wallet_id, proxy_id, attribution_status, attribution_reason, created_at,
                    viral_score, saturation_count, signal_sources, signal_scraped_at, candidate_id, website_url
             FROM deploy_logs`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.chain) { conditions.push("chain = ?"); params.push(filter.chain); }
  if (filter?.status) { conditions.push("status = ?"); params.push(filter.status); }
  if (filter?.candidateId) { conditions.push("candidate_id = ?"); params.push(filter.candidateId); }
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += ` ORDER BY id DESC`;
  if (filter?.limit) { sql += ` LIMIT ?`; params.push(filter.limit); }

  return (db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>).map(mapDeployLogRow);
}

export function getDeployLogsByCandidate(candidateId: string): DeployLogRow[] {
  return getAllDeployLogs({ candidateId });
}

export function mapActivePositionRow(r: Record<string, unknown>): ActivePosition {
  return {
    id: r.id as number,
    deployLogId: r.deploy_log_id as number,
    chain: r.chain as string,
    contractAddr: r.contract_addr as string,
    ticker: r.ticker as string,
    snipeAmount: r.snipe_amount as number,
    entryPrice: (r.entry_price as number) ?? null,
    takeProfitX: r.take_profit_x as number,
    stopLossPct: r.stop_loss_pct as number,
    status: r.status as string,
    exitReason: (r.exit_reason as string) ?? null,
    closedAt: (r.closed_at as string) ?? null,
    createdAt: (r.created_at as string) ?? null,
    updatedAt: (r.updated_at as string) ?? null,
    walletAddress: (r.wallet_address as string) ?? null,
    deploymentTxHash: (r.deployment_tx_hash as string) ?? null,
    buyTxHash: (r.buy_tx_hash as string) ?? null,
    sellTxHash: (r.sell_tx_hash as string) ?? null,
    lastReconciledAt: (r.last_reconciled_at as string) ?? null,
    reconciliationStatus: (r.reconciliation_status as string) ?? null,
    balanceBefore: (r.balance_before as string) ?? null,
    balanceAfter: (r.balance_after as string) ?? null,
    currentBalance: (r.current_balance as string) ?? null,
    tokenDecimals: (r.token_decimals as number) ?? null,
    exitPrice: (r.exit_price as number) ?? null,
    entryAmount: (r.entry_amount as number) ?? null,
    exitAmount: (r.exit_amount as number) ?? null,
    fees: (r.fees as number) ?? null,
    realizedPnl: (r.realized_pnl as number) ?? null,
    realizedPnlPercent: (r.realized_pnl_percent as number) ?? null,
    entryCostRaw: (r.entry_cost_raw as string) ?? null,
    exitProceedsRaw: (r.exit_proceeds_raw as string) ?? null,
    entryFeeRaw: (r.entry_fee_raw as string) ?? null,
    exitFeeRaw: (r.exit_fee_raw as string) ?? null,
    attributionStatus: (r.attribution_status as string) ?? null,
    attributionReason: (r.attribution_reason as string) ?? null,
    pnlStatus: (r.pnl_status as string) ?? null,
    priceReturnPercent: (r.price_return_percent as number) ?? null,
    walletId: (r.wallet_id as string) ?? null,
    proxyId: (r.proxy_id as string) ?? null,
  };
}

export function getPositionsByWallet(walletId: string): ActivePosition[] {
  const rows = db.query(
    `SELECT id, deploy_log_id, chain, contract_addr, ticker,
            snipe_amount, entry_price, take_profit_x, stop_loss_pct, status,
            exit_reason, closed_at, created_at, updated_at, wallet_address, deployment_tx_hash,
            buy_tx_hash, sell_tx_hash, last_reconciled_at, reconciliation_status,
            balance_before, balance_after, current_balance, token_decimals,
            exit_price, entry_amount, exit_amount, fees, realized_pnl, realized_pnl_percent,
            entry_cost_raw, exit_proceeds_raw, entry_fee_raw, exit_fee_raw,
            attribution_status, attribution_reason, pnl_status, price_return_percent,
            wallet_id, proxy_id
     FROM active_positions WHERE wallet_id = ? ORDER BY id DESC`
  ).all(walletId) as Array<Record<string, unknown>>;
  return rows.map(mapActivePositionRow);
}

export function getClosedPositions(filter?: { walletId?: string; chain?: string; exitReason?: string }): ActivePosition[] {
  const closedStatuses = ["sold_tp", "sold_sl", "manual_closed"];
  let sql = `SELECT id, deploy_log_id, chain, contract_addr, ticker,
                    snipe_amount, entry_price, take_profit_x, stop_loss_pct, status,
                    exit_reason, closed_at, created_at, updated_at, wallet_address, deployment_tx_hash,
                    buy_tx_hash, sell_tx_hash, last_reconciled_at, reconciliation_status,
                    balance_before, balance_after, current_balance, token_decimals,
                    exit_price, entry_amount, exit_amount, fees, realized_pnl, realized_pnl_percent,
                    entry_cost_raw, exit_proceeds_raw, entry_fee_raw, exit_fee_raw,
                    attribution_status, attribution_reason, pnl_status, price_return_percent,
                    wallet_id, proxy_id
             FROM active_positions WHERE status IN (${closedStatuses.map(() => "?").join(",")})`;
  const params: unknown[] = [...closedStatuses];

  if (filter?.walletId) { sql += ` AND wallet_id = ?`; params.push(filter.walletId); }
  if (filter?.chain) { sql += ` AND chain = ?`; params.push(filter.chain); }
  if (filter?.exitReason) { sql += ` AND exit_reason = ?`; params.push(filter.exitReason); }
  sql += ` ORDER BY closed_at DESC`;

  return (db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>).map(mapActivePositionRow);
}

export function getAllCandidateIds(filter?: { createdAfter?: string; createdBefore?: string }): string[] {
  let sql = `SELECT DISTINCT candidate_id FROM deploy_logs WHERE candidate_id IS NOT NULL`;
  const params: unknown[] = [];
  if (filter?.createdAfter) {
    sql += ` AND datetime(created_at) >= datetime(?)`;
    params.push(filter.createdAfter);
  }
  if (filter?.createdBefore) {
    sql += ` AND datetime(created_at) <= datetime(?)`;
    params.push(filter.createdBefore);
  }
  sql += ` ORDER BY id DESC`;
  const rows = db.query(sql).all(...(params as any)) as Array<{ candidate_id: string }>;
  return rows.map((r) => r.candidate_id);
}

export function getPositionsByCandidate(candidateId: string): ActivePosition[] {
  const rows = db.query(
    `SELECT p.id, p.deploy_log_id, p.chain, p.contract_addr, p.ticker,
            p.snipe_amount, p.entry_price, p.take_profit_x, p.stop_loss_pct, p.status,
            p.exit_reason, p.closed_at, p.updated_at, p.wallet_address, p.deployment_tx_hash,
            p.buy_tx_hash, p.sell_tx_hash, p.last_reconciled_at, p.reconciliation_status,
            p.balance_before, p.balance_after, p.current_balance, p.token_decimals,
            p.exit_price, p.entry_amount, p.exit_amount, p.fees, p.realized_pnl, p.realized_pnl_percent,
            p.entry_cost_raw, p.exit_proceeds_raw, p.entry_fee_raw, p.exit_fee_raw,
            p.attribution_status, p.attribution_reason, p.pnl_status, p.price_return_percent,
            p.wallet_id, p.proxy_id
     FROM active_positions p
     JOIN deploy_logs d ON p.deploy_log_id = d.id
     WHERE d.candidate_id = ?
     ORDER BY p.id DESC`
  ).all(candidateId) as Array<Record<string, unknown>>;
  return rows.map(mapActivePositionRow);
}

export function getPositionsForLegacyDeployments(): ActivePosition[] {
  const rows = db.query(
    `SELECT p.id, p.deploy_log_id, p.chain, p.contract_addr, p.ticker,
            p.snipe_amount, p.entry_price, p.take_profit_x, p.stop_loss_pct, p.status,
            p.exit_reason, p.closed_at, p.updated_at, p.wallet_address, p.deployment_tx_hash,
            p.buy_tx_hash, p.sell_tx_hash, p.last_reconciled_at, p.reconciliation_status,
            p.balance_before, p.balance_after, p.current_balance, p.token_decimals,
            p.exit_price, p.entry_amount, p.exit_amount, p.fees, p.realized_pnl, p.realized_pnl_percent,
            p.entry_cost_raw, p.exit_proceeds_raw, p.entry_fee_raw, p.exit_fee_raw,
            p.attribution_status, p.attribution_reason, p.pnl_status, p.price_return_percent,
            p.wallet_id, p.proxy_id
     FROM active_positions p
     JOIN deploy_logs d ON p.deploy_log_id = d.id
     WHERE d.candidate_id IS NULL
     ORDER BY p.id DESC`
  ).all() as Array<Record<string, unknown>>;
  return rows.map(mapActivePositionRow);
}

export function getDeployLogsWithoutCandidate(): DeployLogRow[] {
  const rows = db.query(
    `SELECT id, chain, token_name, ticker, contract_addr, tx_hash, ipfs_url, status,
            error_msg, deploy_cost, lifecycle_state, simulated, pool_id, exit_status,
            wallet_id, proxy_id, attribution_status, attribution_reason, created_at,
            viral_score, saturation_count, signal_sources, signal_scraped_at, candidate_id
     FROM deploy_logs WHERE candidate_id IS NULL ORDER BY id DESC`
  ).all() as Array<Record<string, unknown>>;
  return rows.map(mapDeployLogRow);
}

// ─── V2.3 Intervention Log CRUD ──────────────────────────────

export type InterventionAction =
  | "force_close"
  | "pause_wallet"
  | "resume_wallet"
  | "disable_route"
  | "retry_unresolved"
  | "phase_transition";

export type InterventionResult = "success" | "rejected" | "error";

export interface InterventionLog {
  id: number;
  action: InterventionAction;
  initiatedBy: string;
  walletId: string | null;
  contractAddr: string | null;
  deployLogId: number | null;
  requestedAt: string;
  result: InterventionResult;
  resultDetail: string | null;
  createdAt: string;
}

export interface InterventionLogInput {
  action: InterventionAction;
  initiatedBy?: string;
  walletId?: string;
  contractAddr?: string;
  deployLogId?: number;
  requestedAt: string;
  result: InterventionResult;
  resultDetail?: string;
}

export function logIntervention(input: InterventionLogInput): InterventionLog {
  const res = db.run(
    `INSERT INTO intervention_logs
      (action, initiated_by, wallet_id, contract_addr, deploy_log_id, requested_at, result, result_detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.action,
      input.initiatedBy ?? "owner",
      input.walletId ?? null,
      input.contractAddr ?? null,
      input.deployLogId ?? null,
      input.requestedAt,
      input.result,
      input.resultDetail ?? null,
    ]
  );
  const id = res.lastInsertRowid as number;
  const r = db.query(
    `SELECT id, action, initiated_by, wallet_id, contract_addr, deploy_log_id,
            requested_at, result, result_detail, created_at
     FROM intervention_logs WHERE id = ?`
  ).get(id) as Record<string, unknown>;
  return {
    id: r.id as number,
    action: r.action as InterventionAction,
    initiatedBy: r.initiated_by as string,
    walletId: (r.wallet_id as string) ?? null,
    contractAddr: (r.contract_addr as string) ?? null,
    deployLogId: (r.deploy_log_id as number) ?? null,
    requestedAt: r.requested_at as string,
    result: r.result as InterventionResult,
    resultDetail: (r.result_detail as string) ?? null,
    createdAt: r.created_at as string,
  };
}

export function getInterventionLogs(filter?: { walletId?: string; action?: string; contractAddr?: string }): InterventionLog[] {
  let sql = `SELECT id, action, initiated_by, wallet_id, contract_addr, deploy_log_id,
                    requested_at, result, result_detail, created_at
             FROM intervention_logs`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.walletId) { conditions.push("wallet_id = ?"); params.push(filter.walletId); }
  if (filter?.action) { conditions.push("action = ?"); params.push(filter.action); }
  if (filter?.contractAddr) { conditions.push("contract_addr = ?"); params.push(filter.contractAddr); }
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(" AND ")}`;
  sql += ` ORDER BY id DESC`;

  return (db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as number,
    action: r.action as InterventionAction,
    initiatedBy: r.initiated_by as string,
    walletId: (r.wallet_id as string) ?? null,
    contractAddr: (r.contract_addr as string) ?? null,
    deployLogId: (r.deploy_log_id as number) ?? null,
    requestedAt: r.requested_at as string,
    result: r.result as InterventionResult,
    resultDetail: (r.result_detail as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

// ─── V2.4.3 Saturation Observations CRUD ─────────────────────

export interface SaturationObservation {
  id: number;
  candidateId: string;
  ticker: string;
  chain: string;
  observedCount: number;
  isSaturated: boolean;
  threshold: number;
  source: string;
  providerStatus: "available" | "unavailable";
  observedAt: string;
  createdAt: string;
}

export interface SaturationObservationInput {
  candidateId: string;
  ticker: string;
  chain: string;
  observedCount: number;
  isSaturated: boolean;
  threshold?: number;
  source?: string;
  providerStatus?: "available" | "unavailable";
  observedAt?: string;
}

function mapSaturationObservationRow(r: Record<string, unknown>): SaturationObservation {
  return {
    id: r.id as number,
    candidateId: r.candidate_id as string,
    ticker: r.ticker as string,
    chain: r.chain as string,
    observedCount: r.observed_count as number,
    isSaturated: Boolean(r.is_saturated),
    threshold: r.threshold as number,
    source: r.source as string,
    providerStatus: (r.provider_status as "available" | "unavailable") ?? "available",
    observedAt: r.observed_at as string,
    createdAt: r.created_at as string,
  };
}

export function recordSaturationObservation(input: SaturationObservationInput): SaturationObservation {
  const result = db.run(
    `INSERT INTO saturation_observations
      (candidate_id, ticker, chain, observed_count, is_saturated, threshold, source, provider_status, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.candidateId,
      input.ticker,
      input.chain.toLowerCase(),
      input.observedCount,
      input.isSaturated ? 1 : 0,
      input.threshold ?? 3,
      input.source ?? "dexscreener",
      input.providerStatus ?? "available",
      input.observedAt ?? new Date().toISOString(),
    ]
  );

  const row = db
    .query("SELECT * FROM saturation_observations WHERE id = ?")
    .get(result.lastInsertRowid) as Record<string, unknown>;
  return mapSaturationObservationRow(row);
}

export function recordSaturationObservations(inputs: SaturationObservationInput[]): SaturationObservation[] {
  return inputs.map(recordSaturationObservation);
}

export function getSaturationObservationsByCandidate(candidateId: string): SaturationObservation[] {
  const rows = db.query(
    `SELECT * FROM saturation_observations WHERE candidate_id = ? ORDER BY id ASC`
  ).all(candidateId) as Array<Record<string, unknown>>;
  return rows.map(mapSaturationObservationRow);
}

export function getSaturationObservationsByTicker(ticker: string): SaturationObservation[] {
  const rows = db.query(
    `SELECT * FROM saturation_observations WHERE ticker = ? ORDER BY id DESC`
  ).all(ticker) as Array<Record<string, unknown>>;
  return rows.map(mapSaturationObservationRow);
}

export function getAllSaturationObservations(limit?: number): SaturationObservation[] {
  let sql = `SELECT * FROM saturation_observations ORDER BY id DESC`;
  const params: unknown[] = [];
  if (limit) {
    sql += ` LIMIT ?`;
    params.push(limit);
  }
  const rows = db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map(mapSaturationObservationRow);
}

// ─── V2.5.0 Pipeline Cycles & Scheduling Telemetry ────────────

export interface PipelineCycleRow {
  id: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  lockAcquired: boolean;
  dailyLimitHit: boolean;
  trendDataFound: boolean;
  identityFound: boolean;
  candidateId: string | null;
  decisionApproved: boolean | null;
  rejectionReason: string | null;
  assetsUploaded: boolean | null;
  deploymentsAttempted: number;
  deploymentsConfirmed: number;
  createdAt: string;
}

export interface CycleOutcomeUpdate {
  completedAt?: string;
  durationMs?: number;
  lockAcquired?: boolean;
  dailyLimitHit?: boolean;
  trendDataFound?: boolean;
  identityFound?: boolean;
  candidateId?: string | null;
  decisionApproved?: boolean | null;
  rejectionReason?: string | null;
  assetsUploaded?: boolean | null;
  deploymentsAttempted?: number;
  deploymentsConfirmed?: number;
}

function mapPipelineCycleRow(r: Record<string, unknown>): PipelineCycleRow {
  return {
    id: r.id as number,
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string) ?? null,
    durationMs: (r.duration_ms as number) ?? null,
    lockAcquired: Boolean(r.lock_acquired),
    dailyLimitHit: Boolean(r.daily_limit_hit),
    trendDataFound: Boolean(r.trend_data_found),
    identityFound: Boolean(r.identity_found),
    candidateId: (r.candidate_id as string) ?? null,
    decisionApproved: r.decision_approved === null ? null : Boolean(r.decision_approved),
    rejectionReason: (r.rejection_reason as string) ?? null,
    assetsUploaded: r.assets_uploaded === null ? null : Boolean(r.assets_uploaded),
    deploymentsAttempted: (r.deployments_attempted as number) ?? 0,
    deploymentsConfirmed: (r.deployments_confirmed as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

export function recordCycleStart(startedAt?: string): number {
  const timestamp = startedAt ?? new Date().toISOString();
  const res = db.run(
    `INSERT INTO pipeline_cycles (started_at) VALUES (?)`,
    [timestamp]
  );
  return res.lastInsertRowid as number;
}

export function updateCycleOutcome(cycleId: number, update: CycleOutcomeUpdate): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (update.completedAt !== undefined) {
    sets.push("completed_at = ?");
    params.push(update.completedAt);
  }
  if (update.durationMs !== undefined) {
    sets.push("duration_ms = ?");
    params.push(update.durationMs);
  }
  if (update.lockAcquired !== undefined) {
    sets.push("lock_acquired = ?");
    params.push(update.lockAcquired ? 1 : 0);
  }
  if (update.dailyLimitHit !== undefined) {
    sets.push("daily_limit_hit = ?");
    params.push(update.dailyLimitHit ? 1 : 0);
  }
  if (update.trendDataFound !== undefined) {
    sets.push("trend_data_found = ?");
    params.push(update.trendDataFound ? 1 : 0);
  }
  if (update.identityFound !== undefined) {
    sets.push("identity_found = ?");
    params.push(update.identityFound ? 1 : 0);
  }
  if (update.candidateId !== undefined) {
    sets.push("candidate_id = ?");
    params.push(update.candidateId);
  }
  if (update.decisionApproved !== undefined) {
    sets.push("decision_approved = ?");
    params.push(update.decisionApproved === null ? null : (update.decisionApproved ? 1 : 0));
  }
  if (update.rejectionReason !== undefined) {
    sets.push("rejection_reason = ?");
    params.push(update.rejectionReason);
  }
  if (update.assetsUploaded !== undefined) {
    sets.push("assets_uploaded = ?");
    params.push(update.assetsUploaded === null ? null : (update.assetsUploaded ? 1 : 0));
  }
  if (update.deploymentsAttempted !== undefined) {
    sets.push("deployments_attempted = ?");
    params.push(update.deploymentsAttempted);
  }
  if (update.deploymentsConfirmed !== undefined) {
    sets.push("deployments_confirmed = ?");
    params.push(update.deploymentsConfirmed);
  }

  if (sets.length === 0) return;

  params.push(cycleId);
  db.run(`UPDATE pipeline_cycles SET ${sets.join(", ")} WHERE id = ?`, params as any);
}

export function getRecentCycles(limitDays?: number): PipelineCycleRow[] {
  let sql = `SELECT * FROM pipeline_cycles`;
  const params: unknown[] = [];
  if (limitDays !== undefined && limitDays > 0) {
    sql += ` WHERE datetime(started_at) >= datetime('now', ?)`;
    params.push(`-${limitDays} days`);
  } else if (limitDays !== undefined && limitDays <= 0) {
    sql += ` WHERE datetime(started_at) > datetime('now')`;
  }
  sql += ` ORDER BY id DESC`;
  const rows = db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map(mapPipelineCycleRow);
}

// ─── V3.0: FLYWHEEL GROWTH ENGINE PERSISTENCE ─────────────────────────

export interface FlywheelEvent {
  id: number;
  eventId: string;
  tokenAddress: string;
  tokenSymbol: string;
  totalClaimedWeth: number;
  creatorWeth: number;
  buybackWeth: number;
  dividendWeth: number;
  jackpotWeth: number;
  burnedTokens: number;
  burnTxHash?: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface FlywheelEventInput {
  eventId: string;
  tokenAddress: string;
  tokenSymbol: string;
  totalClaimedWeth: number;
  creatorWeth: number;
  buybackWeth: number;
  dividendWeth: number;
  jackpotWeth: number;
  burnedTokens?: number;
  burnTxHash?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

function mapFlywheelEventRow(row: Record<string, unknown>): FlywheelEvent {
  let parsedMetadata: Record<string, unknown> | null = null;
  if (typeof row.metadata === "string" && row.metadata.trim()) {
    try {
      parsedMetadata = JSON.parse(row.metadata);
    } catch {
      parsedMetadata = null;
    }
  }

  return {
    id: Number(row.id),
    eventId: String(row.event_id),
    tokenAddress: String(row.token_address),
    tokenSymbol: String(row.token_symbol),
    totalClaimedWeth: Number(row.total_claimed_weth ?? 0),
    creatorWeth: Number(row.creator_weth ?? 0),
    buybackWeth: Number(row.buyback_weth ?? 0),
    dividendWeth: Number(row.dividend_weth ?? 0),
    jackpotWeth: Number(row.jackpot_weth ?? 0),
    burnedTokens: Number(row.burned_tokens ?? 0),
    burnTxHash: row.burn_tx_hash ? String(row.burn_tx_hash) : null,
    status: String(row.status ?? "completed"),
    metadata: parsedMetadata,
    createdAt: String(row.created_at),
  };
}

export function recordFlywheelEvent(input: FlywheelEventInput): FlywheelEvent {
  const metadataStr = input.metadata ? JSON.stringify(input.metadata) : null;
  const status = input.status ?? "completed";
  const burnedTokens = input.burnedTokens ?? 0;
  const burnTxHash = input.burnTxHash ?? null;

  db.run(
    `INSERT INTO flywheel_events (
      event_id, token_address, token_symbol, total_claimed_weth,
      creator_weth, buyback_weth, dividend_weth, jackpot_weth,
      burned_tokens, burn_tx_hash, status, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.eventId,
      input.tokenAddress,
      input.tokenSymbol,
      input.totalClaimedWeth,
      input.creatorWeth,
      input.buybackWeth,
      input.dividendWeth,
      input.jackpotWeth,
      burnedTokens,
      burnTxHash,
      status,
      metadataStr,
    ]
  );

  const row = db.query(`SELECT * FROM flywheel_events WHERE event_id = ?`).get(input.eventId) as Record<string, unknown>;
  return mapFlywheelEventRow(row);
}

export function getFlywheelEvents(tokenAddress?: string): FlywheelEvent[] {
  let sql = `SELECT * FROM flywheel_events`;
  const params: unknown[] = [];

  if (tokenAddress) {
    sql += ` WHERE lower(token_address) = lower(?)`;
    params.push(tokenAddress);
  }

  sql += ` ORDER BY id DESC`;
  const rows = db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map(mapFlywheelEventRow);
}

export function getFlywheelSummary(tokenAddress?: string): {
  totalClaimedWeth: number;
  totalCreatorWeth: number;
  totalBuybackWeth: number;
  totalBurnedTokens: number;
  totalDividendWeth: number;
  totalJackpotWeth: number;
  eventCount: number;
} {
  let sql = `
    SELECT
      COALESCE(SUM(total_claimed_weth), 0) as total_claimed,
      COALESCE(SUM(creator_weth), 0) as total_creator,
      COALESCE(SUM(buyback_weth), 0) as total_buyback,
      COALESCE(SUM(burned_tokens), 0) as total_burned,
      COALESCE(SUM(dividend_weth), 0) as total_dividend,
      COALESCE(SUM(jackpot_weth), 0) as total_jackpot,
      COUNT(id) as cnt
    FROM flywheel_events
  `;
  const params: unknown[] = [];

  if (tokenAddress) {
    sql += ` WHERE lower(token_address) = lower(?)`;
    params.push(tokenAddress);
  }

  const row = db.query(sql).get(...(params as any)) as Record<string, unknown>;
  return {
    totalClaimedWeth: Number(row.total_claimed ?? 0),
    totalCreatorWeth: Number(row.total_creator ?? 0),
    totalBuybackWeth: Number(row.total_buyback ?? 0),
    totalBurnedTokens: Number(row.total_burned ?? 0),
    totalDividendWeth: Number(row.total_dividend ?? 0),
    totalJackpotWeth: Number(row.total_jackpot ?? 0),
    eventCount: Number(row.cnt ?? 0),
  };
}

// ─── V3.2: AFFILIATE & REFERRAL LEDGER PERSISTENCE ───────────────────

export interface AffiliateStat {
  id: number;
  affiliateAddress: string;
  tokenAddress: string;
  bountyEarnedWeth: number;
  volumeRoutedWeth: number;
  claimCount: number;
  lastClaimedAt: string;
  createdAt: string;
}

function mapAffiliateStatRow(row: Record<string, unknown>): AffiliateStat {
  return {
    id: Number(row.id),
    affiliateAddress: String(row.affiliate_address),
    tokenAddress: String(row.token_address),
    bountyEarnedWeth: Number(row.bounty_earned_weth ?? 0),
    volumeRoutedWeth: Number(row.volume_routed_weth ?? 0),
    claimCount: Number(row.claim_count ?? 0),
    lastClaimedAt: String(row.last_claimed_at),
    createdAt: String(row.created_at),
  };
}

export function recordAffiliateBounty(
  affiliateAddress: string,
  tokenAddress: string,
  bountyWeth: number,
  volumeWeth?: number
): AffiliateStat {
  const normAffiliate = affiliateAddress.trim().toLowerCase();
  const normToken = tokenAddress.trim().toLowerCase();
  const volume = volumeWeth ?? (bountyWeth > 0 ? bountyWeth * 20 : 0); // 5% bounty = 20x volume

  db.run(
    `INSERT INTO affiliate_stats (
      affiliate_address, token_address, bounty_earned_weth, volume_routed_weth, claim_count, last_claimed_at
    ) VALUES (?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(affiliate_address, token_address) DO UPDATE SET
      bounty_earned_weth = bounty_earned_weth + excluded.bounty_earned_weth,
      volume_routed_weth = volume_routed_weth + excluded.volume_routed_weth,
      claim_count = claim_count + 1,
      last_claimed_at = datetime('now')`,
    [normAffiliate, normToken, bountyWeth, volume]
  );

  const row = db
    .query(
      `SELECT * FROM affiliate_stats WHERE lower(affiliate_address) = lower(?) AND lower(token_address) = lower(?)`
    )
    .get(normAffiliate, normToken) as Record<string, unknown>;

  return mapAffiliateStatRow(row);
}

export function getTopAffiliates(tokenAddress?: string, limit: number = 10): AffiliateStat[] {
  let sql = `SELECT * FROM affiliate_stats`;
  const params: unknown[] = [];

  if (tokenAddress) {
    sql += ` WHERE lower(token_address) = lower(?)`;
    params.push(tokenAddress);
  }

  sql += ` ORDER BY bounty_earned_weth DESC, claim_count DESC LIMIT ?`;
  params.push(limit);

  const rows = db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map(mapAffiliateStatRow);
}

export function getAffiliateStats(affiliateAddress: string, tokenAddress?: string): AffiliateStat | null {
  const normAffiliate = affiliateAddress.trim().toLowerCase();
  let sql = `SELECT * FROM affiliate_stats WHERE lower(affiliate_address) = lower(?)`;
  const params: unknown[] = [normAffiliate];

  if (tokenAddress) {
    sql += ` AND lower(token_address) = lower(?)`;
    params.push(tokenAddress);
  }

  sql += ` ORDER BY id DESC LIMIT 1`;
  const row = db.query(sql).get(...(params as any)) as Record<string, unknown> | null;
  return row ? mapAffiliateStatRow(row) : null;
}

// ─── Promotion Decisions (Phase 6B.1 Operator Approval) ─────────────────

export interface PromotionDecisionRecord {
  id: number;
  tokenAddress: string;
  chain: string;
  ticker: string;
  decision: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  operator: string;
  reason?: string;
  decidedAt: string;
  updatedAt: string;
}

function mapPromotionDecisionRow(row: Record<string, unknown> | null | undefined): PromotionDecisionRecord | null {
  if (!row) return null;
  return {
    id: Number(row.id),
    tokenAddress: String(row.token_address),
    chain: String(row.chain),
    ticker: String(row.ticker),
    decision: (row.decision as "PENDING_REVIEW" | "APPROVED" | "REJECTED") || "PENDING_REVIEW",
    operator: String(row.operator || "local_operator"),
    reason: row.reason ? String(row.reason) : undefined,
    decidedAt: String(row.decided_at || row.created_at || ""),
    updatedAt: String(row.updated_at || row.created_at || ""),
  };
}

export function getPromotionDecision(tokenAddress: string): PromotionDecisionRecord | null {
  if (!tokenAddress) return null;
  const normAddr = tokenAddress.trim().toLowerCase();
  const row = db
    .query(`SELECT * FROM promotion_decisions WHERE lower(token_address) = lower(?) LIMIT 1`)
    .get(normAddr) as Record<string, unknown> | null;
  return mapPromotionDecisionRow(row);
}

export function getAllPromotionDecisions(): Record<string, PromotionDecisionRecord> {
  const rows = db.query(`SELECT * FROM promotion_decisions`).all() as Array<Record<string, unknown>>;
  const map: Record<string, PromotionDecisionRecord> = {};
  for (const r of rows) {
    const rec = mapPromotionDecisionRow(r);
    if (rec && rec.tokenAddress) {
      map[rec.tokenAddress.toLowerCase()] = rec;
      if (rec.ticker) {
        map[rec.ticker.toLowerCase()] = rec;
      }
    }
  }
  return map;
}

export function recordPromotionDecision(input: {
  tokenAddress: string;
  chain: string;
  ticker: string;
  decision: "PENDING_REVIEW" | "APPROVED" | "REJECTED";
  operator?: string;
  reason?: string;
}): PromotionDecisionRecord {
  const normAddr = input.tokenAddress.trim();
  const chain = input.chain.toLowerCase();
  const ticker = input.ticker.replace(/^\$/, "").toUpperCase();
  const operator = input.operator || "local_operator";
  const reason = input.reason || null;
  const nowIso = new Date().toISOString();

  db.run(
    `INSERT INTO promotion_decisions (token_address, chain, ticker, decision, operator, reason, decided_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(token_address) DO UPDATE SET
       decision = excluded.decision,
       operator = excluded.operator,
       reason = excluded.reason,
       updated_at = excluded.updated_at`,
    [normAddr, chain, ticker, input.decision, operator, reason, nowIso, nowIso]
  );

  const saved = getPromotionDecision(normAddr);
  if (!saved) {
    throw new Error(`Failed to retrieve recorded promotion decision for ${normAddr}`);
  }
  return saved;
}



