/**
 * src/db/neon-vault.ts
 *
 * Neon Serverless PostgreSQL Multi-Tenant Cloud Database Module.
 *
 * Arsitektur Multi-Database:
 *   1. Database Master (neondb): Tempat koordinasi global dan provisioning database baru.
 *   2. Database Terisolasi per Token (token_<ticker>): Setiap token memiliki database PostgreSQL
 *      sendiri yang terisolasi di cloud Neon (contoh: token_pumprun, token_neuralai).
 *   3. Zero External npm Dependencies: Menggunakan driver native Bun (import { SQL } from "bun").
 *   4. Fail-Safe Dual-Write: SQLite vault.db lokal tetap menjadi Single Source of Truth (SSOT).
 *      Jika koneksi internet/Neon offline, proses bot lokal tetap berjalan normal tanpa gangguan.
 */

import { SQL } from "bun";
import { getConfig } from "../config.ts";
import { logger } from "../logger.ts";
import { normalizeTokenIdentifier, normalizeChainName } from "../../packages/shared/token-identifier.ts";

export interface TokenIdentityRecord {
  contractAddr: string;
  ticker: string;
  tokenName: string;
  chain: string;
  poolId?: string | null;
  txHash?: string | null;
  websiteUrl?: string | null;
  telegramBotUsername?: string | null;
  clankerUrl?: string | null;
  dexUrl?: string | null;
  creatorWallet?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  totalSupply?: string | number | null;
  launchMode?: string | null;
}

export interface NeonSyncResult {
  success: boolean;
  dbName: string;
  connectionUrl: string;
  isNewDatabase?: boolean;
  tokenLaunchId?: string;
  draftId?: string;
  error?: string;
}

/**
 * Normalisasi nama ticker menjadi identifier database PostgreSQL yang valid.
 * Karakter yang diperbolehkan: [a-z0-9_], panjang maksimal 63 karakter.
 */
export function normalizeTokenDatabaseName(ticker: string): string {
  const clean = ticker
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  return `token_${clean}`.slice(0, 63);
}

/**
 * Memeriksa apakah konfigurasi Neon PostgreSQL tersedia di environment.
 */
export function isNeonConfigured(): boolean {
  const envUrl = process.env.NEON_DATABASE_URL;
  if (envUrl && envUrl.startsWith("postgres")) return true;
  try {
    const cfg = getConfig();
    return Boolean(cfg.NEON_DATABASE_URL && cfg.NEON_DATABASE_URL.startsWith("postgres"));
  } catch {
    return false;
  }
}

/**
 * Mendapatkan master URL Neon PostgreSQL (mengarah ke 'neondb').
 */
export function getNeonMasterDatabaseUrl(): string {
  const url =
    process.env.NEON_DATABASE_URL ||
    "postgresql://neondb_owner:npg_RDN4IvzsGJ9k@ep-mute-shape-ay3alze1-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require";
  return url;
}

/**
 * Menghasilkan URL koneksi Neon PostgreSQL untuk database token tertentu.
 */
export function getNeonTokenDatabaseUrl(tickerOrDbName: string): string {
  const masterUrl = getNeonMasterDatabaseUrl();
  const dbName = tickerOrDbName.startsWith("token_")
    ? tickerOrDbName
    : normalizeTokenDatabaseName(tickerOrDbName);

  const parsed = new URL(masterUrl);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

/**
 * Mendapatkan koneksi SQL ke database master Neon (neondb).
 */
export function getNeonMasterSql(): SQL {
  return new SQL(getNeonMasterDatabaseUrl());
}

/**
 * Mendapatkan koneksi SQL ke database khusus token di Neon.
 */
export function getNeonTokenSql(tickerOrDbName: string): SQL {
  const tokenDbUrl = getNeonTokenDatabaseUrl(tickerOrDbName);
  return new SQL(tokenDbUrl);
}

/**
 * Memastikan database khusus token telah dibuat di Neon PostgreSQL.
 * Jika belum ada, otomatis dieksekusi CREATE DATABASE di cloud.
 */
export async function ensureNeonTokenDatabase(
  ticker: string
): Promise<{ success: boolean; dbName: string; created: boolean; connectionUrl: string; error?: string }> {
  const dbName = normalizeTokenDatabaseName(ticker);
  const connectionUrl = getNeonTokenDatabaseUrl(dbName);

  if (!isNeonConfigured()) {
    return {
      success: false,
      dbName,
      created: false,
      connectionUrl,
      error: "NEON_DATABASE_URL belum dikonfigurasi.",
    };
  }

  // Validasi ketat nama database untuk mencegah SQL injection
  if (!/^[a-z0-9_]{3,63}$/.test(dbName)) {
    return {
      success: false,
      dbName,
      created: false,
      connectionUrl,
      error: `Nama database tidak valid: ${dbName}`,
    };
  }

  const masterSql = getNeonMasterSql();
  try {
    // 1. Cek apakah database sudah ada di pg_database
    const existing = await masterSql`
      SELECT datname FROM pg_database WHERE datname = ${dbName} LIMIT 1;
    `;

    if (existing.length > 0) {
      return {
        success: true,
        dbName,
        created: false,
        connectionUrl,
      };
    }

    // 2. Buat database baru di cloud Neon
    logger.info(`🐘 [NEON CLOUD] Mengalokasikan database terisolasi baru: '${dbName}'...`);
    await masterSql.unsafe(`CREATE DATABASE "${dbName}";`);

    return {
      success: true,
      dbName,
      created: true,
      connectionUrl,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    // Abaikan jika ternyata sudah dibuat oleh transaksi paralel
    if (msg.includes("already exists")) {
      return { success: true, dbName, created: false, connectionUrl };
    }
    logger.warn(`🐘 [NEON CLOUD] Notice alokasi database '${dbName}': ${msg}`);
    return { success: false, dbName, created: false, connectionUrl, error: msg };
  } finally {
    try {
      await masterSql.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Menginisialisasi schema tabel relasional di dalam database khusus token.
 */
export async function initTokenDatabaseSchema(ticker: string): Promise<boolean> {
  const dbName = normalizeTokenDatabaseName(ticker);
  const tokenSql = getNeonTokenSql(dbName);

  try {
    // 1. Tabel Identitas Token
    await tokenSql`
      CREATE TABLE IF NOT EXISTS token_identity (
        contract_address VARCHAR(66) PRIMARY KEY,
        ticker VARCHAR(32) NOT NULL,
        name VARCHAR(128) NOT NULL,
        chain VARCHAR(32) NOT NULL DEFAULT 'base',
        pool_id VARCHAR(66),
        tx_hash VARCHAR(100),
        website_url TEXT,
        telegram_bot VARCHAR(64),
        dex_url TEXT,
        clanker_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 2. Tabel Telemetri Pasar (Harga, MC, Likuiditas, Volume)
    await tokenSql`
      CREATE TABLE IF NOT EXISTS token_telemetry (
        id BIGSERIAL PRIMARY KEY,
        contract_address VARCHAR(66) NOT NULL,
        price_usd NUMERIC(24, 10),
        market_cap_usd NUMERIC(24, 2),
        liquidity_usd NUMERIC(24, 2),
        volume_24h_usd NUMERIC(24, 2),
        holder_count INTEGER DEFAULT 0,
        unique_makers INTEGER DEFAULT 0,
        recorded_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 3. Tabel Riwayat Transaksi On-Chain (Buy/Sell/Catalyst)
    await tokenSql`
      CREATE TABLE IF NOT EXISTS token_trades (
        id BIGSERIAL PRIMARY KEY,
        contract_address VARCHAR(66) NOT NULL,
        tx_hash VARCHAR(100) UNIQUE NOT NULL,
        trade_type VARCHAR(16) NOT NULL,
        trader_address VARCHAR(66),
        amount_tokens NUMERIC(36, 18),
        amount_eth NUMERIC(36, 18),
        price_usd NUMERIC(24, 10),
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 4. Tabel Fee Dividen & Flywheel Revenue
    await tokenSql`
      CREATE TABLE IF NOT EXISTS token_fees (
        id BIGSERIAL PRIMARY KEY,
        contract_address VARCHAR(66) NOT NULL,
        claim_tx_hash VARCHAR(100),
        weth_claimed NUMERIC(36, 18) NOT NULL,
        buyback_weth NUMERIC(36, 18) DEFAULT 0,
        dividend_weth NUMERIC(36, 18) DEFAULT 0,
        burned_tokens NUMERIC(36, 18) DEFAULT 0,
        claimed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // 5. Tabel Interaksi Web3 Pengunjung (Connect Wallet, Copy CA, Add to Wallet)
    await tokenSql`
      CREATE TABLE IF NOT EXISTS web3_events (
        id BIGSERIAL PRIMARY KEY,
        contract_address VARCHAR(66) NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        user_address VARCHAR(66),
        wallet_provider VARCHAR(32),
        client_timestamp TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    // Indeks untuk performa query cepat
    await tokenSql`CREATE INDEX IF NOT EXISTS idx_telemetry_time ON token_telemetry(recorded_at DESC);`;
    await tokenSql`CREATE INDEX IF NOT EXISTS idx_trades_time ON token_trades(executed_at DESC);`;

    return true;
  } catch (err: any) {
    logger.warn(`🐘 [NEON CLOUD] Inisialisasi schema '${dbName}' notice: ${err?.message || err}`);
    return false;
  } finally {
    try {
      await tokenSql.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Memastikan network terdaftar di tabel networks Neon PostgreSQL untuk memenuhi foreign key.
 */
export async function ensureNetworkRow(masterSql: SQL, chainInput: string): Promise<string> {
  const norm = normalizeChainName(chainInput);
  const networkId = `${norm}-mainnet`;
  let chainId: number | null = null;
  let networkFamily = "EVM";
  let nativeCurrency = "ETH";
  let decimals = 18;
  let explorer = "https://basescan.org";

  if (norm === "solana") {
    chainId = null;
    networkFamily = "SOLANA";
    nativeCurrency = "SOL";
    decimals = 9;
    explorer = "https://solscan.io";
  } else if (norm === "ethereum") {
    chainId = 1;
    nativeCurrency = "ETH";
    explorer = "https://etherscan.io";
  } else if (norm === "robinhood") {
    chainId = 46688;
    explorer = "https://explorer.robinhood.com";
  } else if (norm === "arc") {
    chainId = 5042;
    explorer = "https://arcscan.io";
  } else if (norm === "arbitrum") {
    chainId = 42161;
    explorer = "https://arbiscan.io";
  } else if (norm === "bsc") {
    chainId = 56;
    nativeCurrency = "BNB";
    explorer = "https://bscscan.com";
  } else {
    // base
    chainId = 8453;
  }

  try {
    await masterSql`
      INSERT INTO networks (id, chain_id, name, network_family, native_currency_symbol, native_currency_decimals, explorer_url)
      VALUES (${networkId}, ${chainId}, ${norm.toUpperCase() + " Mainnet"}, ${networkFamily}, ${nativeCurrency}, ${decimals}, ${explorer})
      ON CONFLICT (id) DO NOTHING;
    `;
  } catch (err: any) {
    logger.warn(`🐘 [NEON CLOUD] ensureNetworkRow notice: ${err?.message || err}`);
  }

  return networkId;
}

/**
 * Menyinkronkan deployment token baru ke database Neon PostgreSQL khusus miliknya.
 */
export async function syncTokenDeploymentToNeon(token: TokenIdentityRecord): Promise<NeonSyncResult> {
  const dbName = normalizeTokenDatabaseName(token.ticker);
  const connectionUrl = getNeonTokenDatabaseUrl(dbName);

  if (!isNeonConfigured()) {
    return {
      success: false,
      dbName,
      connectionUrl,
      error: "Neon database belum dikonfigurasi.",
    };
  }

  // 1. Pastikan database cloud sudah dialokasikan
  const provision = await ensureNeonTokenDatabase(token.ticker);
  if (!provision.success) {
    return {
      success: false,
      dbName,
      connectionUrl,
      error: provision.error,
    };
  }

  // 2. Inisialisasi schema tabel
  const schemaOk = await initTokenDatabaseSchema(token.ticker);
  if (!schemaOk) {
    return {
      success: false,
      dbName,
      connectionUrl,
      error: "Gagal menyiapkan schema tabel.",
    };
  }

  // 3. Simpan atau perbarui data identitas token
  const tokenSql = getNeonTokenSql(dbName);
  try {
    const dexUrl = token.dexUrl || (token.contractAddr ? `https://dexscreener.com/${token.chain}/${token.contractAddr}` : null);
    const clankerUrl = token.clankerUrl || (token.contractAddr ? `https://clanker.world/clanker/${token.contractAddr}` : null);

    await tokenSql`
      INSERT INTO token_identity (
        contract_address, ticker, name, chain, pool_id, tx_hash,
        website_url, telegram_bot, dex_url, clanker_url, updated_at
      ) VALUES (
        ${token.contractAddr},
        ${token.ticker.toUpperCase()},
        ${token.tokenName},
        ${token.chain},
        ${token.poolId ?? null},
        ${token.txHash ?? null},
        ${token.websiteUrl ?? null},
        ${token.telegramBotUsername ?? null},
        ${dexUrl},
        ${clankerUrl},
        NOW()
      )
      ON CONFLICT (contract_address) DO UPDATE SET
        ticker = EXCLUDED.ticker,
        name = EXCLUDED.name,
        pool_id = COALESCE(EXCLUDED.pool_id, token_identity.pool_id),
        tx_hash = COALESCE(EXCLUDED.tx_hash, token_identity.tx_hash),
        website_url = COALESCE(EXCLUDED.website_url, token_identity.website_url),
        telegram_bot = COALESCE(EXCLUDED.telegram_bot, token_identity.telegram_bot),
        dex_url = COALESCE(EXCLUDED.dex_url, token_identity.dex_url),
        clanker_url = COALESCE(EXCLUDED.clanker_url, token_identity.clanker_url),
        updated_at = NOW();
    `;

    // 4. Mirror confirmed deployment into master SSOT database (neondb)
    let tokenLaunchId: string | undefined;
    let draftId: string | undefined;

    try {
      const masterSql = getNeonMasterSql();
      try {
        const normChain = normalizeChainName(token.chain);
        const isSolana = normChain === "solana";
        const targetChainId = await ensureNetworkRow(masterSql, token.chain);
        const walletChainType = isSolana ? "SOLANA" : "EVM";
        const creatorAddr = isSolana
          ? (token.creatorWallet || "11111111111111111111111111111111")
          : (token.creatorWallet || "0x000000000000000000000000000000000000dEaD").toLowerCase();

        // A. Ensure creator user entity exists
        let userId: string;
        const existingWallet = await masterSql`
          SELECT user_id FROM wallets WHERE LOWER(address) = LOWER(${creatorAddr}) AND chain_type = ${walletChainType} LIMIT 1;
        `;
        if (existingWallet.length > 0) {
          userId = String(existingWallet[0].user_id);
        } else {
          const userEnt = await masterSql`
            INSERT INTO entities (type) VALUES ('USER') RETURNING id;
          `;
          userId = String(userEnt[0].id);
          await masterSql`
            INSERT INTO users (id, status) VALUES (${userId}, 'ACTIVE');
          `;
          await masterSql`
            INSERT INTO wallets (user_id, address, chain_type, is_primary)
            VALUES (${userId}, ${creatorAddr}, ${walletChainType}, true)
            ON CONFLICT (address, chain_type) DO NOTHING;
          `;
        }

        // B. Check if launch_draft already exists for this ticker or create one
        const existingDraft = await masterSql`
          SELECT id FROM launch_drafts WHERE UPPER(ticker) = UPPER(${token.ticker}) LIMIT 1;
        `;
        if (existingDraft.length > 0) {
          draftId = String(existingDraft[0].id);
          await masterSql`
            UPDATE launch_drafts SET
              status = 'PUBLISHED',
              target_chain = ${targetChainId},
              updated_at = NOW()
            WHERE id = ${draftId};
          `;
        } else {
          const draftEnt = await masterSql`
            INSERT INTO entities (type) VALUES ('LAUNCH_DRAFT') RETURNING id;
          `;
          draftId = String(draftEnt[0].id);
          await masterSql`
            INSERT INTO launch_drafts (
              id, creator_id, name, ticker, description, image_url,
              launch_mode, target_chain, total_supply, creator_allocation_pct,
              bonding_curve_config, status, created_at, updated_at
            ) VALUES (
              ${draftId},
              ${userId},
              ${token.tokenName},
              ${token.ticker.toUpperCase()},
              ${token.description || `Autonomous Launchpad Token: ${token.tokenName}`},
              ${token.websiteUrl || "https://rtrader.io/token-default.png"},
              ${token.launchMode || (isSolana ? "PUMP_FUN" : "BONDING_CURVE")},
              ${targetChainId},
              ${token.totalSupply?.toString() || "1000000000"},
              0.0,
              '{}'::jsonb,
              'PUBLISHED',
              NOW(),
              NOW()
            );
          `;
        }

        // C. Check or insert into token_launches
        const existingLaunch = await masterSql`
          SELECT id FROM token_launches WHERE LOWER(contract_address) = LOWER(${token.contractAddr}) LIMIT 1;
        `;
        if (existingLaunch.length > 0) {
          tokenLaunchId = String(existingLaunch[0].id);
          await masterSql`
            UPDATE token_launches SET
              dex_pair_address = COALESCE(${token.poolId ?? null}, dex_pair_address),
              chain = ${targetChainId}
            WHERE id = ${tokenLaunchId};
          `;
        } else {
          const launchEnt = await masterSql`
            INSERT INTO entities (type) VALUES ('TOKEN') RETURNING id;
          `;
          tokenLaunchId = String(launchEnt[0].id);
          await masterSql`
            INSERT INTO token_launches (
              id, draft_id, contract_address, chain, current_supply,
              raised_amount, graduation_threshold, is_graduated,
              dex_pair_address, risk_score, published_at
            ) VALUES (
              ${tokenLaunchId},
              ${draftId},
              ${token.contractAddr},
              ${targetChainId},
              ${token.totalSupply?.toString() || "1000000000"},
              0,
              69000,
              false,
              ${token.poolId ?? null},
              90,
              NOW()
            );
          `;
        }

        // D. Ensure a SocialFi KOL bounty campaign exists for this token launch
        if (tokenLaunchId) {
          const existingCamp = await masterSql`
            SELECT id FROM bounty_campaigns WHERE launch_id = ${tokenLaunchId} LIMIT 1;
          `;
          if (existingCamp.length === 0) {
            const cleanTick = token.ticker.toUpperCase().replace(/^\$/, "");
            await masterSql`
              INSERT INTO bounty_campaigns (
                launch_id, creator_id, title, description,
                required_hashtag, min_followers, reward_per_kol,
                max_participants, current_participants, is_active, created_at
              ) VALUES (
                ${tokenLaunchId},
                ${userId},
                ${'$' + cleanTick + ' Viral Community & X Raid Bounty'},
                ${'Promote $' + cleanTick + ' on X (Twitter), TikTok & Warpcast. Tag #' + cleanTick + ' to earn bounty reward tokens!'},
                ${'#' + cleanTick},
                500,
                1000000000000000000000,
                50,
                0,
                true,
                NOW()
              );
            `;
            logger.info(`🐘 [NEON CLOUD] SocialFi KOL Bounty Campaign otomatis dibuat untuk $${cleanTick}`);
          }
        }
      } finally {
        await masterSql.close().catch(() => {});
      }
    } catch (masterErr: any) {
      logger.warn(`🐘 [NEON CLOUD] Master SSOT mirror notice: ${masterErr?.message || masterErr}`);
    }

    return {
      success: true,
      dbName,
      connectionUrl,
      isNewDatabase: provision.created,
      tokenLaunchId,
      draftId,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    logger.warn(`🐘 [NEON CLOUD] Gagal sinkronisasi identitas token '${token.ticker}': ${msg}`);
    return {
      success: false,
      dbName,
      connectionUrl,
      error: msg,
    };
  } finally {
    try {
      await tokenSql.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Mengambil daftar seluruh database token yang ada di Neon PostgreSQL.
 */
export async function listNeonTokenDatabases(): Promise<string[]> {
  if (!isNeonConfigured()) return [];
  const masterSql = getNeonMasterSql();
  try {
    const pattern = "token_%";
    const rows = await masterSql`
      SELECT datname FROM pg_database WHERE datname LIKE ${pattern} ORDER BY datname ASC;
    `;
    return rows.map((r: any) => String(r.datname));
  } catch (err: any) {
    logger.warn(`🐘 [NEON CLOUD] Gagal membaca daftar database: ${err?.message || err}`);
    return [];
  } finally {
    try {
      await masterSql.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Mengambil statistik ringkas dari database token tertentu di Neon.
 */
export async function getTokenDatabaseStats(ticker: string): Promise<{
  dbName: string;
  exists: boolean;
  identityCount: number;
  telemetryCount: number;
  tradeCount: number;
  feeCount: number;
  web3EventCount: number;
  tokenDetails?: any;
} | null> {
  const dbName = normalizeTokenDatabaseName(ticker);
  if (!isNeonConfigured()) return null;

  const tokenSql = getNeonTokenSql(dbName);
  try {
    const identRows = await tokenSql`SELECT * FROM token_identity LIMIT 1;`;
    const telRows = await tokenSql`SELECT COUNT(*) as count FROM token_telemetry;`;
    const trdRows = await tokenSql`SELECT COUNT(*) as count FROM token_trades;`;
    const feeRows = await tokenSql`SELECT COUNT(*) as count FROM token_fees;`;
    const webRows = await tokenSql`SELECT COUNT(*) as count FROM web3_events;`;

    return {
      dbName,
      exists: true,
      identityCount: identRows.length,
      telemetryCount: Number(telRows[0]?.count ?? 0),
      tradeCount: Number(trdRows[0]?.count ?? 0),
      feeCount: Number(feeRows[0]?.count ?? 0),
      web3EventCount: Number(webRows[0]?.count ?? 0),
      tokenDetails: identRows[0] ?? undefined,
    };
  } catch {
    return {
      dbName,
      exists: false,
      identityCount: 0,
      telemetryCount: 0,
      tradeCount: 0,
      feeCount: 0,
      web3EventCount: 0,
    };
  } finally {
    try {
      await tokenSql.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Menyinkronkan seluruh armada token dari SQLite lokal (vault.db) ke Neon PostgreSQL cloud.
 */
export async function syncAllFleetToNeon(): Promise<{
  totalFleet: number;
  syncedCount: number;
  failedCount: number;
  details: Array<{ ticker: string; dbName: string; success: boolean; error?: string }>;
}> {
  // Import dari vault lokal
  const { Database } = await import("bun:sqlite");
  const { resolveDbPath } = await import("./vault.ts");

  const dbPath = resolveDbPath();
  const sqlite = new Database(dbPath, { readonly: true });

  const rows = sqlite
    .query(
      `SELECT contract_addr, ticker, token_name, chain, pool_id, tx_hash, website_url, telegram_bot_username
       FROM deploy_logs
       WHERE status = 'confirmed' AND contract_addr IS NOT NULL
       ORDER BY id ASC`
    )
    .all() as any[];

  sqlite.close();

  const details: Array<{ ticker: string; dbName: string; success: boolean; error?: string }> = [];
  let synced = 0;
  let failed = 0;

  for (const r of rows) {
    const res = await syncTokenDeploymentToNeon({
      contractAddr: r.contract_addr,
      ticker: r.ticker,
      tokenName: r.token_name,
      chain: r.chain || "base",
      poolId: r.pool_id,
      txHash: r.tx_hash,
      websiteUrl: r.website_url,
      telegramBotUsername: r.telegram_bot_username,
    });

    if (res.success) {
      synced++;
      details.push({ ticker: r.ticker, dbName: res.dbName, success: true });
    } else {
      failed++;
      details.push({ ticker: r.ticker, dbName: res.dbName, success: false, error: res.error });
    }
  }

  return {
    totalFleet: rows.length,
    syncedCount: synced,
    failedCount: failed,
    details,
  };
}

/**
 * Mencatat snapshot telemetri harga dan likuiditas ke database Neon token secara non-blocking.
 */
export async function recordTokenTelemetry(
  ticker: string,
  data: {
    contractAddr?: string;
    priceUsd?: number | null;
    marketCapUsd?: number | null;
    liquidityUsd?: number | null;
    volume24hUsd?: number | null;
    holderCount?: number;
    uniqueMakers?: number;
  }
): Promise<boolean> {
  if (!isNeonConfigured()) return false;
  const dbName = normalizeTokenDatabaseName(ticker);
  const tokenSql = getNeonTokenSql(dbName);

  try {
    const ca = data.contractAddr || ticker;
    await tokenSql`
      INSERT INTO token_telemetry (
        contract_address, price_usd, market_cap_usd, liquidity_usd,
        volume_24h_usd, holder_count, unique_makers, recorded_at
      ) VALUES (
        ${ca},
        ${data.priceUsd ?? null},
        ${data.marketCapUsd ?? null},
        ${data.liquidityUsd ?? null},
        ${data.volume24hUsd ?? null},
        ${data.holderCount ?? 0},
        ${data.uniqueMakers ?? 0},
        NOW()
      );
    `;
    return true;
  } catch (err: any) {
    logger.warn(`🐘 [NEON CLOUD] Notice telemetri '${dbName}': ${err?.message || err}`);
    return false;
  } finally {
    try {
      await tokenSql.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Mencatat event klaim creator fee / dividen WETH ke database Neon token secara non-blocking.
 */
export async function recordTokenFeeEvent(
  ticker: string,
  data: {
    contractAddr?: string;
    claimTxHash?: string | null;
    wethClaimed: number;
    buybackWeth?: number;
    dividendWeth?: number;
    burnedTokens?: number;
  }
): Promise<boolean> {
  if (!isNeonConfigured()) return false;
  const dbName = normalizeTokenDatabaseName(ticker);
  const tokenSql = getNeonTokenSql(dbName);

  try {
    const ca = data.contractAddr || ticker;
    await tokenSql`
      INSERT INTO token_fees (
        contract_address, claim_tx_hash, weth_claimed, buyback_weth,
        dividend_weth, burned_tokens, claimed_at
      ) VALUES (
        ${ca},
        ${data.claimTxHash ?? null},
        ${data.wethClaimed},
        ${data.buybackWeth ?? 0},
        ${data.dividendWeth ?? 0},
        ${data.burnedTokens ?? 0},
        NOW()
      );
    `;
    return true;
  } catch (err: any) {
    logger.warn(`🐘 [NEON CLOUD] Notice fee event '${dbName}': ${err?.message || err}`);
    return false;
  } finally {
    try {
      await tokenSql.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Mencatat interaksi pengunjung Web3 DApp (connect wallet, copy CA, add to wallet) ke database Neon.
 */
export async function recordTokenWeb3Event(
  ticker: string,
  data: {
    contractAddr?: string;
    eventType: string;
    userAddress?: string | null;
    walletProvider?: string | null;
  }
): Promise<boolean> {
  if (!isNeonConfigured()) return false;
  const dbName = normalizeTokenDatabaseName(ticker);
  const tokenSql = getNeonTokenSql(dbName);

  try {
    const ca = data.contractAddr || ticker;
    await tokenSql`
      INSERT INTO web3_events (
        contract_address, event_type, user_address, wallet_provider, client_timestamp
      ) VALUES (
        ${ca},
        ${data.eventType},
        ${data.userAddress ?? null},
        ${data.walletProvider ?? null},
        NOW()
      );
    `;
    return true;
  } catch (err: any) {
    logger.warn(`🐘 [NEON CLOUD] Notice web3 event '${dbName}': ${err?.message || err}`);
    return false;
  } finally {
    try {
      await tokenSql.close();
    } catch {
      /* ignore */
    }
  }
}

