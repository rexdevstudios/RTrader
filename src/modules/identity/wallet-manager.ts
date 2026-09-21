/**
 * wallet-manager.ts — Unified Wallet & Proxy Operational Identity Management.
 *
 * Architecture Principles:
 *   1. Single Unified Entity: WalletAccount represents a wallet identity across EVM & Solana.
 *   2. Provider-Aware Routing: Bankr and BasedBot can use distinct credentials and proxies for the same wallet.
 *   3. Independent Lifecycles:
 *      - Wallet: ACTIVE | PAUSED | DISABLED
 *      - Proxy: ACTIVE | PAUSED | DISABLED | ERROR
 *      - A proxy error marks the operational route as unusable WITHOUT forcing the wallet to DISABLED.
 *   4. Historical Auditing: Changing a proxy records an immutable audit trail in proxy_audit_logs.
 *   5. Strict Financial Lineage: Proxy is operational connectivity metadata and does NOT pollute
 *      financial accounting or Realized PnL formulas.
 *   6. Zero Secret Storage in Plaintext: credentialRef is an opaque reference/pointer to vault/env keys.
 */
import { Database } from "bun:sqlite";
import { logger } from "../../logger.ts";
import { sanitizeSecret } from "../evm/bankr-deployer.ts";
import { deriveEvmAddress } from "../reconciliation/evm-verifier.ts";
import { deriveSolanaAddress } from "../reconciliation/solana-verifier.ts";
import { DB_PATH } from "../../db/vault.ts";

const db = new Database(DB_PATH);

// ─── Interfaces ──────────────────────────────────────────────

export type WalletStatus = "ACTIVE" | "PAUSED" | "DISABLED";
export type ProxyStatus = "ACTIVE" | "PAUSED" | "DISABLED" | "ERROR";
export type ProxyHealthStatus = "available" | "unavailable" | "timeout" | "authentication_error";
export type SupportedProvider = "bankr" | "basedbot";
export type ProxyProtocol = "http" | "https" | "socks5";

export interface WalletAccount {
  id: string;
  label: string;
  evmAddress?: string | null;
  solanaAddress?: string | null;
  credentialRef?: string | null;
  status: WalletStatus;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyConfig {
  id: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  status: ProxyStatus;
  healthStatus: ProxyHealthStatus;
  latencyMs?: number | null;
  lastCheckedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletProviderRoute {
  walletId: string;
  provider: SupportedProvider;
  credentialRef?: string | null;
  proxyId?: string | null;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProxyAuditLog {
  id: number;
  walletId: string;
  provider: string;
  previousProxyId?: string | null;
  newProxyId?: string | null;
  reason: string;
  rotatedAt: string;
}

export interface OperationalContext {
  wallet: WalletAccount;
  provider: SupportedProvider;
  credentialRef?: string | null;
  proxy: ProxyConfig | null;
  proxyUrl?: string | null;
  maskedProxyUrl?: string | null;
  isUsable: boolean;
  unusableReason?: string;
}

export interface AutoFailoverDetail {
  walletId: string;
  previousProxyId?: string | null;
  newProxyId?: string | null;
  previousHealth?: string;
  action: "ROTATED" | "NO_HEALTHY_BACKUP" | "ERROR";
  reason: string;
}

export interface AutoFailoverResult {
  totalRoutesChecked: number;
  unhealthyRoutesCount: number;
  failoversExecuted: number;
  failoversFailed: number;
  details: AutoFailoverDetail[];
}

export interface ProxyPingResult {
  reachable: boolean;
  status?: number;
  latencyMs: number;
  healthStatus: ProxyHealthStatus;
  message: string;
  apiKeyValid?: boolean;
}

export interface QuarantineCooldownReport {
  proxyId: string;
  isEligible: boolean;
  penaltyHours: number;
  remainingMinutes: number;
  recentFailures: number;
  lastFailureAt: string | null;
  cooldownUntil: string | null;
  reason?: string;
}

export interface PoolResupplyOptions {
  minActiveThreshold?: number;
  timeoutMs?: number;
  forceUnquarantine?: boolean;
  enableWebshareFallback?: boolean;
  testWebsharePings?: boolean;
}

export interface PoolResupplyResult {
  probedCount: number;
  resuppliedCount: number;
  resuppliedIds: string[];
  delayedByCooldownCount: number;
  details: string[];
}

// ─── Wallet Account Management ───────────────────────────────

export function registerWalletAccount(input: {
  id: string;
  label: string;
  evmAddress?: string;
  solanaAddress?: string;
  credentialRef?: string;
  status?: WalletStatus;
  metadata?: Record<string, unknown>;
}): WalletAccount {
  const trimmedId = input.id.trim();
  if (!trimmedId || !/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
    throw new Error(`Invalid wallet ID: '${input.id}'. Must contain alphanumeric, dash, or underscore.`);
  }

  // Validate address formats if provided
  if (input.evmAddress && !/^0x[a-fA-F0-9]{40}$/.test(input.evmAddress)) {
    throw new Error(`Invalid EVM address format: '${input.evmAddress}'`);
  }
  if (input.solanaAddress && (input.solanaAddress.length < 32 || input.solanaAddress.length > 44)) {
    throw new Error(`Invalid Solana address length: '${input.solanaAddress}'`);
  }

  const normalizedEvm = input.evmAddress ? input.evmAddress.toLowerCase() : null;
  const status: WalletStatus = input.status ?? "ACTIVE";
  const metaJson = input.metadata ? JSON.stringify(input.metadata) : null;

  try {
    db.run(
      `INSERT INTO wallet_accounts
        (id, label, evm_address, solana_address, credential_ref, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        trimmedId,
        input.label.trim(),
        normalizedEvm,
        input.solanaAddress ?? null,
        input.credentialRef ?? null,
        status,
        metaJson,
      ]
    );
  } catch (err: unknown) {
    const errMsg = String(err);
    if (errMsg.includes("UNIQUE constraint failed")) {
      throw new Error(`WalletAccount with ID '${trimmedId}' already exists.`);
    }
    throw err;
  }

  return getWalletAccount(trimmedId)!;
}

export function getWalletAccount(id: string): WalletAccount | null {
  const row = db
    .query(
      `SELECT id, label, evm_address, solana_address, credential_ref, status, metadata, created_at, updated_at
       FROM wallet_accounts WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | null;

  if (!row) return null;

  let metadata: Record<string, unknown> | null = null;
  if (typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }

  return {
    id: row.id as string,
    label: row.label as string,
    evmAddress: (row.evm_address as string) ?? null,
    solanaAddress: (row.solana_address as string) ?? null,
    credentialRef: (row.credential_ref as string) ?? null,
    status: (row.status as WalletStatus) ?? "ACTIVE",
    metadata,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getWalletByAddress(address: string): WalletAccount | null {
  const normalized = address.trim().toLowerCase();
  const row = db
    .query(
      `SELECT id, label, evm_address, solana_address, credential_ref, status, metadata, created_at, updated_at
       FROM wallet_accounts
       WHERE LOWER(evm_address) = ? OR solana_address = ?`
    )
    .get(normalized, address.trim()) as Record<string, unknown> | null;

  if (!row) return null;
  return getWalletAccount(row.id as string);
}

export function listWalletAccounts(statusFilter?: WalletStatus): WalletAccount[] {
  let query = `SELECT id FROM wallet_accounts`;
  const params: unknown[] = [];

  if (statusFilter) {
    query += ` WHERE status = ?`;
    params.push(statusFilter);
  }
  query += ` ORDER BY created_at ASC`;

  const rows = db.query(query).all(...(params as any)) as Array<{ id: string }>;
  return rows.map((r) => getWalletAccount(r.id)!).filter(Boolean);
}

export function updateWalletStatus(id: string, status: WalletStatus): boolean {
  const res = db.run(
    `UPDATE wallet_accounts SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, id]
  );
  return res.changes > 0;
}

// ─── Proxy Configuration Management ─────────────────────────

export function registerProxyConfig(input: {
  id: string;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username?: string;
  password?: string;
  status?: ProxyStatus;
  healthStatus?: ProxyHealthStatus;
  metadata?: Record<string, unknown>;
}): ProxyConfig {
  const trimmedId = input.id.trim();
  if (!trimmedId || !/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
    throw new Error(`Invalid proxy ID: '${input.id}'. Must contain alphanumeric, dash, or underscore.`);
  }

  if (!["http", "https", "socks5"].includes(input.protocol)) {
    throw new Error(`Invalid proxy protocol: '${input.protocol}'. Must be 'http', 'https', or 'socks5'.`);
  }

  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error(`Invalid proxy port: ${input.port}. Must be an integer between 1 and 65535.`);
  }

  if (!input.host || input.host.trim().length === 0) {
    throw new Error("Proxy host cannot be empty.");
  }

  const status: ProxyStatus = input.status ?? "ACTIVE";
  const healthStatus: ProxyHealthStatus = input.healthStatus ?? "available";
  const metaJson = input.metadata ? JSON.stringify(input.metadata) : null;

  try {
    db.run(
      `INSERT INTO proxy_configs
        (id, protocol, host, port, username, password, status, health_status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trimmedId,
        input.protocol,
        input.host.trim(),
        input.port,
        input.username ?? null,
        input.password ?? null,
        status,
        healthStatus,
        metaJson,
      ]
    );
  } catch (err: unknown) {
    const errMsg = String(err);
    if (errMsg.includes("UNIQUE constraint failed")) {
      throw new Error(`ProxyConfig with ID '${trimmedId}' already exists.`);
    }
    throw err;
  }

  return getProxyConfig(trimmedId)!;
}

export function getProxyConfig(id: string): ProxyConfig | null {
  const row = db
    .query(
      `SELECT id, protocol, host, port, username, password, status, health_status, latency_ms, last_checked_at, metadata, created_at, updated_at
       FROM proxy_configs WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | null;

  if (!row) return null;

  let metadata: Record<string, unknown> | null = null;
  if (typeof row.metadata === "string") {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }

  return {
    id: row.id as string,
    protocol: row.protocol as ProxyProtocol,
    host: row.host as string,
    port: row.port as number,
    username: (row.username as string) ?? null,
    password: (row.password as string) ?? null,
    status: (row.status as ProxyStatus) ?? "ACTIVE",
    healthStatus: (row.health_status as ProxyHealthStatus) ?? "available",
    latencyMs: (row.latency_ms as number) ?? null,
    lastCheckedAt: (row.last_checked_at as string) ?? null,
    metadata,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function listProxyConfigs(statusFilter?: ProxyStatus): ProxyConfig[] {
  let query = `SELECT id FROM proxy_configs`;
  const params: unknown[] = [];

  if (statusFilter) {
    query += ` WHERE status = ?`;
    params.push(statusFilter);
  }
  query += ` ORDER BY created_at ASC`;

  const rows = db.query(query).all(...(params as any)) as Array<{ id: string }>;
  return rows.map((r) => getProxyConfig(r.id)!).filter(Boolean);
}

export function updateProxyStatus(
  id: string,
  status: ProxyStatus,
  health?: ProxyHealthStatus,
  latencyMs?: number
): boolean {
  const sets = ["status = ?", "updated_at = datetime('now')"];
  const params: unknown[] = [status];

  if (health !== undefined) {
    sets.push("health_status = ?");
    params.push(health);
  }
  if (latencyMs !== undefined) {
    sets.push("latency_ms = ?");
    params.push(latencyMs);
  }
  sets.push("last_checked_at = datetime('now')");

  params.push(id);
  const sql = `UPDATE proxy_configs SET ${sets.join(", ")} WHERE id = ?`;
  const res = db.run(sql, params as any);
  return res.changes > 0;
}

export function updateProxyDetails(
  id: string,
  details: {
    protocol: ProxyProtocol;
    host: string;
    port: number;
    username?: string | null;
    password?: string | null;
    status?: ProxyStatus;
    healthStatus?: ProxyHealthStatus;
    latencyMs?: number | null;
  }
): boolean {
  const sql = `
    UPDATE proxy_configs
    SET protocol = ?, host = ?, port = ?, username = ?, password = ?,
        status = ?, health_status = ?, latency_ms = ?,
        last_checked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `;
  const res = db.run(sql, [
    details.protocol,
    details.host,
    details.port,
    details.username ?? null,
    details.password ?? null,
    details.status ?? "ACTIVE",
    details.healthStatus ?? "available",
    details.latencyMs ?? null,
    id,
  ]);
  return res.changes > 0;
}

export function deleteProxyConfig(id: string): boolean {
  const res = db.run(`DELETE FROM proxy_configs WHERE id = ?`, [id]);
  return res.changes > 0;
}

/**
 * Builds formatted URI string for proxy.
 * If maskPassword is true, passwords are masked (e.g., for logging).
 */
export function buildProxyUrl(proxy: ProxyConfig, maskPassword = false): string {
  let auth = "";
  if (proxy.username) {
    if (proxy.password) {
      auth = `${proxy.username}:${maskPassword ? "****" : proxy.password}@`;
    } else {
      auth = `${proxy.username}@`;
    }
  }
  return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
}

// ─── Provider Routing & Proxy Rotation Audit ─────────────────

export function setWalletProviderRoute(
  walletId: string,
  provider: SupportedProvider,
  config: {
    credentialRef?: string;
    proxyId?: string | null;
    status?: WalletStatus;
  }
): boolean {
  const wallet = getWalletAccount(walletId);
  if (!wallet) {
    throw new Error(`Cannot set route: WalletAccount '${walletId}' does not exist.`);
  }

  if (config.proxyId) {
    const proxy = getProxyConfig(config.proxyId);
    if (!proxy) {
      throw new Error(`Cannot set route: ProxyConfig '${config.proxyId}' does not exist.`);
    }
  }

  // Check if route already exists
  const existing = getWalletProviderRoute(walletId, provider);
  if (existing && existing.proxyId !== config.proxyId) {
    // Record rotation audit
    recordProxyAudit({
      walletId,
      provider,
      previousProxyId: existing.proxyId,
      newProxyId: config.proxyId ?? null,
      reason: "Route reconfigured via setWalletProviderRoute",
    });
  }

  const res = db.run(
    `INSERT INTO wallet_provider_routes
      (wallet_id, provider, credential_ref, proxy_id, status)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(wallet_id, provider) DO UPDATE SET
       credential_ref = COALESCE(excluded.credential_ref, wallet_provider_routes.credential_ref),
       proxy_id = excluded.proxy_id,
       status = COALESCE(excluded.status, wallet_provider_routes.status),
       updated_at = datetime('now')`,
    [
      walletId,
      provider,
      config.credentialRef ?? wallet.credentialRef ?? null,
      config.proxyId ?? null,
      config.status ?? "ACTIVE",
    ]
  );

  return res.changes > 0;
}

/**
 * Convenience helper to set provider route with single object parameters.
 */
export function setProviderRoute(params: {
  walletId: string;
  provider: SupportedProvider;
  proxyId?: string | null;
  credentialRef?: string;
  status?: WalletStatus;
}): boolean {
  return setWalletProviderRoute(params.walletId, params.provider, {
    proxyId: params.proxyId,
    credentialRef: params.credentialRef,
    status: params.status,
  });
}

export function getWalletProviderRoute(
  walletId: string,
  provider: SupportedProvider
): WalletProviderRoute | null {
  const row = db
    .query(
      `SELECT wallet_id, provider, credential_ref, proxy_id, status, created_at, updated_at
       FROM wallet_provider_routes WHERE wallet_id = ? AND provider = ?`
    )
    .get(walletId, provider) as Record<string, unknown> | null;

  if (!row) return null;

  return {
    walletId: row.wallet_id as string,
    provider: row.provider as SupportedProvider,
    credentialRef: (row.credential_ref as string) ?? null,
    proxyId: (row.proxy_id as string) ?? null,
    status: (row.status as WalletStatus) ?? "ACTIVE",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Rotates proxy on an existing wallet provider route and writes an audit log.
 * Changes do NOT mutate the wallet identity or financial lineage.
 */
export function rotateWalletProxy(
  walletId: string,
  provider: SupportedProvider,
  newProxyId: string | null,
  reason: string
): boolean {
  const wallet = getWalletAccount(walletId);
  if (!wallet) {
    throw new Error(`Cannot rotate proxy: WalletAccount '${walletId}' not found.`);
  }

  if (newProxyId) {
    const proxy = getProxyConfig(newProxyId);
    if (!proxy) {
      throw new Error(`Cannot rotate proxy: New ProxyConfig '${newProxyId}' not found.`);
    }
  }

  const currentRoute = getWalletProviderRoute(walletId, provider);
  const previousProxyId = currentRoute?.proxyId ?? null;

  if (previousProxyId === newProxyId) {
    logger.info(`ℹ️  [WALLET MGR] Proxy for ${walletId} (${provider}) is already '${newProxyId ?? "DIRECT"}'. No change.`);
    return true;
  }

  // 1. Record immutable audit entry
  recordProxyAudit({
    walletId,
    provider,
    previousProxyId,
    newProxyId,
    reason,
  });

  // 2. Update route
  const res = db.run(
    `INSERT INTO wallet_provider_routes
      (wallet_id, provider, proxy_id, status)
     VALUES (?, ?, ?, 'ACTIVE')
     ON CONFLICT(wallet_id, provider) DO UPDATE SET
       proxy_id = excluded.proxy_id,
       updated_at = datetime('now')`,
    [walletId, provider, newProxyId]
  );

  logger.info(
    `🔄 [WALLET MGR] Rotated proxy for ${walletId} on ${provider}: ` +
      `'${previousProxyId ?? "DIRECT"}' -> '${newProxyId ?? "DIRECT"}'. Reason: ${reason}`
  );

  return res.changes > 0;
}

export function recordProxyAudit(params: {
  walletId: string;
  provider: string;
  previousProxyId?: string | null;
  newProxyId?: string | null;
  reason: string;
}): void {
  db.run(
    `INSERT INTO proxy_audit_logs
      (wallet_id, provider, previous_proxy_id, new_proxy_id, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [
      params.walletId,
      params.provider,
      params.previousProxyId ?? null,
      params.newProxyId ?? null,
      params.reason,
    ]
  );
}

export const recordProxyAuditLog = recordProxyAudit;

export function getProxyAuditHistory(walletId?: string, provider?: string): ProxyAuditLog[] {
  let sql = `SELECT id, wallet_id, provider, previous_proxy_id, new_proxy_id, reason, rotated_at FROM proxy_audit_logs`;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (walletId) {
    conditions.push("wallet_id = ?");
    params.push(walletId);
  }
  if (provider) {
    conditions.push("provider = ?");
    params.push(provider);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  sql += ` ORDER BY id DESC`;

  const rows = db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: r.id as number,
    walletId: r.wallet_id as string,
    provider: r.provider as string,
    previousProxyId: (r.previous_proxy_id as string) ?? null,
    newProxyId: (r.new_proxy_id as string) ?? null,
    reason: r.reason as string,
    rotatedAt: r.rotated_at as string,
  }));
}

// ─── Operational Context Resolver ────────────────────────────

/**
 * Resolves operational identity context (wallet + provider + proxy) for execution.
 * Enforces independent lifecycles:
 *  - If wallet is PAUSED/DISABLED, route is unusable.
 *  - If proxy is in ERROR/DISABLED, route is unusable without changing wallet status.
 */
export function resolveOperationalContext(
  walletId: string,
  provider: SupportedProvider
): OperationalContext {
  const wallet = getWalletAccount(walletId);
  if (!wallet) {
    return {
      wallet: {
        id: walletId,
        label: "Unknown",
        status: "DISABLED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      provider,
      proxy: null,
      isUsable: false,
      unusableReason: `WalletAccount '${walletId}' not found.`,
    };
  }

  // Check 1: Wallet status
  if (wallet.status !== "ACTIVE") {
    return {
      wallet,
      provider,
      proxy: null,
      isUsable: false,
      unusableReason: `WalletAccount '${walletId}' is currently ${wallet.status}.`,
    };
  }

  const route = getWalletProviderRoute(walletId, provider);

  // If no explicit route exists, default to direct route with wallet's credentialRef
  if (!route) {
    return {
      wallet,
      provider,
      credentialRef: wallet.credentialRef,
      proxy: null,
      isUsable: true,
    };
  }

  // Check 2: Route status
  if (route.status !== "ACTIVE") {
    return {
      wallet,
      provider,
      credentialRef: route.credentialRef ?? wallet.credentialRef,
      proxy: null,
      isUsable: false,
      unusableReason: `Operational route for provider '${provider}' is ${route.status}.`,
    };
  }

  // Check 3: Direct route (no proxy assigned)
  if (!route.proxyId) {
    return {
      wallet,
      provider,
      credentialRef: route.credentialRef ?? wallet.credentialRef,
      proxy: null,
      isUsable: true,
    };
  }

  // Check 4: Proxy assigned -> check proxy status & health
  const proxy = getProxyConfig(route.proxyId);
  if (!proxy) {
    return {
      wallet,
      provider,
      credentialRef: route.credentialRef ?? wallet.credentialRef,
      proxy: null,
      isUsable: false,
      unusableReason: `Configured proxy '${route.proxyId}' does not exist in registry.`,
    };
  }

  if (proxy.status !== "ACTIVE") {
    return {
      wallet,
      provider,
      credentialRef: route.credentialRef ?? wallet.credentialRef,
      proxy,
      isUsable: false,
      unusableReason: `Proxy '${proxy.id}' is in ${proxy.status} state. (Wallet '${walletId}' remains ACTIVE).`,
    };
  }

  if (proxy.healthStatus === "unavailable" || proxy.healthStatus === "authentication_error" || proxy.healthStatus === "timeout") {
    return {
      wallet,
      provider,
      credentialRef: route.credentialRef ?? wallet.credentialRef,
      proxy,
      isUsable: false,
      unusableReason: `Proxy '${proxy.id}' health status is ${proxy.healthStatus}.`,
    };
  }

  // All checks pass -> route is fully usable
  return {
    wallet,
    provider,
    credentialRef: route.credentialRef ?? wallet.credentialRef,
    proxy,
    proxyUrl: buildProxyUrl(proxy),
    maskedProxyUrl: buildProxyUrl(proxy, true),
    isUsable: true,
  };
}

// ─── Backward-Compatible Bootstrap ───────────────────────────

/**
 * Ensures system has at least one active WalletAccount bootstrapped
 * from existing config environment variables (EVM & Solana keys).
 */
export function bootstrapDefaultWallet(): WalletAccount {
  const existingDefault = getWalletAccount("default-operator");
  if (existingDefault) {
    return existingDefault;
  }

  logger.info("🔧 [WALLET MGR] No wallet accounts found in vault. Bootstrapping default operator wallet from config...");

  let evmAddr: string | null = null;
  let solAddr: string | null = null;

  const rawEvm = process.env.EVM_PRIVATE_KEY?.trim();
  if (rawEvm && rawEvm.length >= 64) {
    try {
      evmAddr = deriveEvmAddress(rawEvm);
    } catch {
      evmAddr = null;
    }
  }

  const rawSol = process.env.SOLANA_PRIVATE_KEY?.trim();
  if (rawSol && rawSol.length >= 32) {
    try {
      solAddr = deriveSolanaAddress(rawSol);
    } catch {
      solAddr = null;
    }
  }

  const defaultAccount = registerWalletAccount({
    id: "default-operator",
    label: "Default Bot Operator Wallet",
    evmAddress: evmAddr ?? undefined,
    solanaAddress: solAddr ?? undefined,
    credentialRef: "env:OPERATOR_PRIVATE_KEYS",
    status: "ACTIVE",
    metadata: { bootstrapped: true, source: "env" },
  });

  // Set default provider routes (direct connection)
  setWalletProviderRoute(defaultAccount.id, "bankr", {
    credentialRef: "env:BANKR_API_KEY",
    proxyId: null,
  });

  setWalletProviderRoute(defaultAccount.id, "basedbot", {
    credentialRef: "env:TELEGRAM_BOT_TOKEN",
    proxyId: null,
  });

  logger.success(
    `✅ [WALLET MGR] Default wallet bootstrapped: '${defaultAccount.id}' ` +
      `(EVM: ${evmAddr ?? "N/A"}, SOL: ${solAddr ?? "N/A"}).`
  );

  return defaultAccount;
}

// ─── V2.3 Owner Reporting Helpers ─────────────────────────────

/** Returns all wallet accounts (alias for listWalletAccounts for owner reporting readability). */
export function getAllWalletAccounts(): WalletAccount[] {
  return listWalletAccounts();
}

/** Returns all provider routes configured for a given wallet, or across all wallets if walletId is omitted. */
export function getAllProviderRoutes(walletId?: string): WalletProviderRoute[] {
  let sql = `SELECT wallet_id, provider, credential_ref, proxy_id, status, created_at, updated_at FROM wallet_provider_routes`;
  const params: unknown[] = [];
  if (walletId) {
    sql += ` WHERE wallet_id = ?`;
    params.push(walletId);
  }
  sql += ` ORDER BY wallet_id ASC, provider ASC`;
  const rows = db.query(sql).all(...(params as any)) as Array<Record<string, unknown>>;
  return rows.map(row => ({
    walletId: row.wallet_id as string,
    provider: row.provider as SupportedProvider,
    credentialRef: (row.credential_ref as string) ?? null,
    proxyId: (row.proxy_id as string) ?? null,
    status: (row.status as WalletStatus) ?? "ACTIVE",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

/** Alias for getWalletProviderRoute for use in owner-operations.ts. */
export function getProviderRoute(walletId: string, provider: SupportedProvider): WalletProviderRoute | null {
  return getWalletProviderRoute(walletId, provider);
}

/** Updates the status of a specific provider route without rotating proxy. */
export function updateProviderRouteStatus(walletId: string, provider: SupportedProvider, status: WalletStatus): boolean {
  const res = db.run(
    `UPDATE wallet_provider_routes SET status = ?, updated_at = datetime('now')
     WHERE wallet_id = ? AND provider = ?`,
    [status, walletId, provider]
  );
  return res.changes > 0;
}

// ─── V2.8 Multi-Account Credential Resolution & Orchestration ──

/**
 * Deterministically resolves an opaque credential reference pointer to an actual runtime secret.
 *
 * Invariants:
 *   1. Zero Plaintext Secrets in Database: Only pointer strings (e.g. 'env:BANKR_API_KEY') are stored.
 *   2. Resolution formats supported:
 *      - 'env:VARIABLE_NAME' -> process.env['VARIABLE_NAME']
 *      - 'VARIABLE_NAME'     -> process.env['VARIABLE_NAME']
 *   3. Secret Redaction: Never logs, prints, or exposes the secret string.
 *   4. Fails Safe: Returns undefined if ref is null/empty or the environment variable is not set.
 */
export function resolveCredential(ref?: string | null): string | undefined {
  if (!ref || typeof ref !== "string") {
    return undefined;
  }
  const trimmed = ref.trim();
  if (!trimmed) {
    return undefined;
  }

  let envKey = trimmed;
  if (trimmed.startsWith("env:")) {
    envKey = trimmed.slice(4).trim();
  }

  if (!envKey) {
    return undefined;
  }

  const val = process.env[envKey]?.trim();
  return val && val.length > 0 ? val : undefined;
}

/**
 * Capability-aware wallet selection for execution pipeline.
 *
 * Selection rules:
 *  1. If preferredWalletId is specified and ACTIVE, returns it.
 *  2. Evaluates all ACTIVE wallets from vault.
 *  3. Filters for provider route usability (via resolveOperationalContext) and target chain compatibility.
 *  4. If multiple usable wallets exist, performs fair workload distribution based on deploy_logs history.
 *  5. Preserves 100% backward compatibility: falls back to bootstrapDefaultWallet() if vault is uninitialized.
 */
export function selectExecutionWallet(options?: {
  preferredWalletId?: string;
  requiredProvider?: SupportedProvider;
  targetChains?: string[];
  candidateWalletIds?: string[];
}): WalletAccount {
  if (options?.preferredWalletId) {
    const preferred = getWalletAccount(options.preferredWalletId);
    if (preferred && preferred.status === "ACTIVE") {
      return preferred;
    }
  }

  let activeWallets = listWalletAccounts("ACTIVE");
  if (options?.candidateWalletIds && options.candidateWalletIds.length > 0) {
    activeWallets = activeWallets.filter((w) => options.candidateWalletIds!.includes(w.id));
  }

  if (activeWallets.length === 0) {
    return bootstrapDefaultWallet();
  }

  if (activeWallets.length === 1) {
    return activeWallets[0];
  }

  const provider = options?.requiredProvider ?? "bankr";
  const targetChains = options?.targetChains ?? [];

  const usableWallets = activeWallets.filter((wallet) => {
    // 1. Check provider route operational readiness
    const opCtx = resolveOperationalContext(wallet.id, provider);
    if (!opCtx.isUsable) return false;

    // 2. Check chain capabilities
    if (targetChains.length > 0) {
      const needsSolana = targetChains.includes("solana");
      const needsEvm = targetChains.some((c) => c !== "solana");

      if (needsSolana && !wallet.solanaAddress) return false;
      if (needsEvm && !wallet.evmAddress) return false;
    }

    return true;
  });

  // If no wallets are fully usable, return the first active wallet so downstream
  // execution-readiness gate can log the explicit reasons
  if (usableWallets.length === 0) {
    return activeWallets[0];
  }

  if (usableWallets.length === 1) {
    return usableWallets[0];
  }

  // Workload distribution across multiple usable wallets using deploy_logs history
  try {
    const lastDeploy = db
      .query(`SELECT wallet_id FROM deploy_logs WHERE wallet_id IS NOT NULL ORDER BY id DESC LIMIT 1`)
      .get() as { wallet_id: string } | null;

    if (lastDeploy?.wallet_id) {
      const lastIdx = usableWallets.findIndex((w) => w.id === lastDeploy.wallet_id);
      if (lastIdx >= 0) {
        const nextIdx = (lastIdx + 1) % usableWallets.length;
        return usableWallets[nextIdx];
      }
    }
  } catch {
    // Fails safe to first usable wallet
  }

  return usableWallets[0];
}

/**
 * Automatically fails over any ACTIVE wallet provider route using an unhealthy proxy
 * to the best available healthy proxy (lowest latency) in the vault.
 */
export async function autoFailoverUnhealthyRoutes(): Promise<AutoFailoverResult> {
  const wallets = listWalletAccounts().filter((w) => w.status === "ACTIVE");
  const details: AutoFailoverDetail[] = [];
  let failoversExecuted = 0;
  let failoversFailed = 0;
  let unhealthyRoutesCount = 0;

  const allRoutes = wallets
    .map((w) => getWalletProviderRoute(w.id, "bankr"))
    .filter((r): r is NonNullable<typeof r> => r !== null && r.status === "ACTIVE");

  const assignedProxyIds = new Set(allRoutes.map((r) => r.proxyId).filter(Boolean) as string[]);

  for (const wallet of wallets) {
    const route = getWalletProviderRoute(wallet.id, "bankr");
    if (!route || !route.proxyId || route.status !== "ACTIVE") {
      continue;
    }

    const currentProxy = getProxyConfig(route.proxyId);
    const isUnhealthy =
      !currentProxy ||
      currentProxy.status !== "ACTIVE" ||
      currentProxy.healthStatus !== "available";

    if (!isUnhealthy) {
      continue;
    }

    unhealthyRoutesCount++;
    const prevHealth = currentProxy?.healthStatus || "unavailable";

    const allHealthyProxies = listProxyConfigs("ACTIVE").filter(
      (p) => p.healthStatus === "available" && p.id !== route.proxyId
    );

    if (allHealthyProxies.length === 0) {
      failoversFailed++;
      details.push({
        walletId: wallet.id,
        previousProxyId: route.proxyId,
        previousHealth: prevHealth,
        action: "NO_HEALTHY_BACKUP",
        reason: `Tidak ada proxy sehat cadangan berstatus [AVAILABLE] di vault.`,
      });
      continue;
    }

    const unassignedHealthy = allHealthyProxies.filter((p) => !assignedProxyIds.has(p.id));
    let candidate: typeof allHealthyProxies[0];

    if (unassignedHealthy.length > 0) {
      unassignedHealthy.sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999));
      candidate = unassignedHealthy[0];
    } else {
      allHealthyProxies.sort((a, b) => (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999));
      candidate = allHealthyProxies[0];
    }

    try {
      const reason = `Auto-failover: Previous proxy '${route.proxyId}' was ${prevHealth}`;
      rotateWalletProxy(wallet.id, "bankr", candidate.id, reason);

      assignedProxyIds.delete(route.proxyId);
      assignedProxyIds.add(candidate.id);

      failoversExecuted++;
      details.push({
        walletId: wallet.id,
        previousProxyId: route.proxyId,
        newProxyId: candidate.id,
        previousHealth: prevHealth,
        action: "ROTATED",
        reason: `Berhasil dialihkan ke '${candidate.id}' (${candidate.latencyMs ? candidate.latencyMs + " ms" : "OK"})`,
      });
    } catch (err: any) {
      failoversFailed++;
      details.push({
        walletId: wallet.id,
        previousProxyId: route.proxyId,
        previousHealth: prevHealth,
        action: "ERROR",
        reason: `Gagal memutar proxy: ${err?.message || err}`,
      });
    }
  }

  return {
    totalRoutesChecked: wallets.length,
    unhealthyRoutesCount,
    failoversExecuted,
    failoversFailed,
    details,
  };
}

/**
 * Pings a proxy endpoint to diagnose connectivity, WAF status, and latency.
 */
export async function pingProxyEndpoint(
  proxy: {
    protocol: string;
    host: string;
    port: number;
    username?: string | null;
    password?: string | null;
  },
  apiKey?: string,
  timeoutMs = 15000
): Promise<ProxyPingResult> {
  const start = Date.now();
  const protocol = proxy.protocol.toLowerCase().replace(":", "");
  let auth = "";
  if (proxy.username) {
    auth = proxy.password ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@` : `${encodeURIComponent(proxy.username)}@`;
  }
  const proxyUrl = `${protocol}://${auth}${proxy.host}:${proxy.port}`;

  const headers: Record<string, string> = {
    "User-Agent": "bankr-cli/0.1",
    "Accept": "application/json",
  };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  if (protocol !== "http" && protocol !== "https") {
    return {
      reachable: true,
      latencyMs: 0,
      healthStatus: "available",
      message: `Protokol '${protocol}' terdaftar (uji live native dikhususkan untuk HTTP/HTTPS)`,
    };
  }

  try {
    const res = await fetch("https://api.bankr.bot/wallet/balances", {
      headers,
      proxy: proxyUrl,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - start;

    if (res.status === 200) {
      return {
        reachable: true,
        status: 200,
        latencyMs,
        healthStatus: "available",
        message: `Koneksi Berhasil & API Key Valid (${latencyMs}ms)`,
        apiKeyValid: true,
      };
    } else if (res.status === 401) {
      return {
        reachable: true,
        status: 401,
        latencyMs,
        healthStatus: "available",
        message: `Proxy Terhubung ke Server Bankr (HTTP 401: ${latencyMs}ms, API Key Perlu Diisi/Diverifikasi)`,
        apiKeyValid: false,
      };
    } else if (res.status === 403) {
      return {
        reachable: false,
        status: 403,
        latencyMs,
        healthStatus: "unavailable",
        message: `Proxy Diblokir Cloudflare WAF (HTTP 403 - Disarankan ganti ke Private Residential Proxy)`,
      };
    } else if (res.status === 407) {
      return {
        reachable: false,
        status: 407,
        latencyMs,
        healthStatus: "authentication_error",
        message: `Autentikasi Proxy Gagal (HTTP 407 - Username/Password Proxy Salah)`,
      };
    } else {
      return {
        reachable: true,
        status: res.status,
        latencyMs,
        healthStatus: "available",
        message: `Server merespons status HTTP ${res.status} (${latencyMs}ms)`,
      };
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const msg = err?.message || String(err);
    if (err?.name === "TimeoutError" || msg.includes("timeout") || msg.includes("Timeout")) {
      return {
        reachable: false,
        latencyMs,
        healthStatus: "timeout",
        message: `Koneksi Proxy Timeout (> ${timeoutMs}ms)`,
      };
    }
    return {
      reachable: false,
      latencyMs,
      healthStatus: "unavailable",
      message: `Gagal Terhubung: ${msg}`,
    };
  }
}

/**
 * Evaluates whether a quarantined proxy has served its exponential backoff penalty
 * based on recent failures recorded in proxy_audit_logs.
 */
export function evaluateQuarantineCooldown(
  proxyId: string,
  customHoursWindow = 24
): QuarantineCooldownReport {
  const proxy = getProxyConfig(proxyId);
  if (!proxy) {
    return {
      proxyId,
      isEligible: false,
      penaltyHours: 0,
      remainingMinutes: 0,
      recentFailures: 0,
      lastFailureAt: null,
      cooldownUntil: null,
      reason: `Proxy '${proxyId}' tidak ditemukan di vault`,
    };
  }

  // Query failures in lookback window from proxy_audit_logs (previous_proxy_id = proxyId)
  const row = db
    .query(
      `SELECT COUNT(*) as failure_count, MAX(rotated_at) as last_failure_at
       FROM proxy_audit_logs
       WHERE previous_proxy_id = ?
         AND rotated_at >= datetime('now', '-' || ? || ' hours')`
    )
    .get(proxyId, customHoursWindow) as { failure_count: number; last_failure_at: string | null } | null;

  const recentFailures = Number(row?.failure_count || 0);
  let lastFailureAt = row?.last_failure_at || null;

  // Fallback to proxy.updatedAt or lastCheckedAt if no audit row exists but proxy is DISABLED
  if (!lastFailureAt && proxy.status === "DISABLED") {
    lastFailureAt = proxy.updatedAt || proxy.lastCheckedAt || proxy.createdAt || null;
  }

  // Exponential penalty: 0 failures -> 0h, 1 -> 1h, 2 -> 6h, >=3 -> 24h
  let penaltyHours = 0;
  if (recentFailures === 1) {
    penaltyHours = 1;
  } else if (recentFailures === 2) {
    penaltyHours = 6;
  } else if (recentFailures >= 3) {
    penaltyHours = 24;
  }

  if (penaltyHours === 0 || !lastFailureAt) {
    return {
      proxyId,
      isEligible: true,
      penaltyHours: 0,
      remainingMinutes: 0,
      recentFailures,
      lastFailureAt,
      cooldownUntil: null,
      reason: recentFailures === 0 ? "Tidak ada riwayat flapping baru" : "Cooldown tidak aktif",
    };
  }

  const normalized = lastFailureAt.endsWith("Z") ? lastFailureAt : lastFailureAt.replace(" ", "T") + "Z";
  const failureTimeMs = new Date(normalized).getTime();
  const cooldownDurationMs = penaltyHours * 60 * 60 * 1000;
  const cooldownUntilMs = failureTimeMs + cooldownDurationMs;
  const nowMs = Date.now();

  if (nowMs >= cooldownUntilMs) {
    return {
      proxyId,
      isEligible: true,
      penaltyHours,
      remainingMinutes: 0,
      recentFailures,
      lastFailureAt,
      cooldownUntil: new Date(cooldownUntilMs).toISOString(),
      reason: `Masa penalti flapping (${penaltyHours} jam) telah selesai`,
    };
  }

  const remainingMinutes = Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 60000));
  return {
    proxyId,
    isEligible: false,
    penaltyHours,
    remainingMinutes,
    recentFailures,
    lastFailureAt,
    cooldownUntil: new Date(cooldownUntilMs).toISOString(),
    reason: `Masih dalam masa penalti flapping (${remainingMinutes} menit tersisa dari total ${penaltyHours} jam)`,
  };
}

/**
 * Proactively checks quarantined proxies and restores eligible ones back to ACTIVE
 * if active healthy proxy reserves are below the desired threshold.
 */
export async function probeAndResupplyQuarantinedPool(
  options?: PoolResupplyOptions
): Promise<PoolResupplyResult> {
  const minActive = options?.minActiveThreshold ?? 2;
  const timeoutMs = options?.timeoutMs ?? 5000;
  const forceUnquarantine = options?.forceUnquarantine ?? false;

  const allProxies = listProxyConfigs();
  const healthyActiveCount = allProxies.filter(
    (p) => p.status === "ACTIVE" && p.healthStatus === "available"
  ).length;

  const quarantinedProxies = allProxies.filter((p) => p.status === "DISABLED");

  if (healthyActiveCount >= minActive) {
    return {
      probedCount: 0,
      resuppliedCount: 0,
      resuppliedIds: [],
      delayedByCooldownCount: 0,
      details: [`Pool memadai (${healthyActiveCount} aktif >= ambang ${minActive})`],
    };
  }

  let probedCount = 0;
  let resuppliedCount = 0;
  let delayedByCooldownCount = 0;
  const resuppliedIds: string[] = [];
  const details: string[] = [];

  for (const proxy of quarantinedProxies) {
    if (healthyActiveCount + resuppliedCount >= minActive) {
      break;
    }

    const cooldown = evaluateQuarantineCooldown(proxy.id);
    if (!cooldown.isEligible && !forceUnquarantine) {
      delayedByCooldownCount++;
      details.push(
        `Proxy '${proxy.id}' dilewati: masih dalam cooldown flapping (${cooldown.remainingMinutes}m tersisa)`
      );
      continue;
    }

    probedCount++;
    const pingRes = await pingProxyEndpoint(proxy, process.env.BANKR_API_KEY, timeoutMs);

    if (pingRes.healthStatus === "available") {
      updateProxyStatus(proxy.id, "ACTIVE", "available", pingRes.latencyMs);
      recordProxyAuditLog({
        walletId: "system",
        provider: "bankr",
        previousProxyId: null,
        newProxyId: proxy.id,
        reason: `Proactive Resupply: Healed (${pingRes.latencyMs}ms) & passed flapping cooldown`,
      });

      resuppliedCount++;
      resuppliedIds.push(proxy.id);
      details.push(
        `Proxy '${proxy.id}' pulih [${pingRes.latencyMs}ms] -> Dipulihkan ke ACTIVE`
      );
    } else {
      updateProxyStatus(proxy.id, "DISABLED", pingRes.healthStatus, pingRes.latencyMs);
      details.push(
        `Proxy '${proxy.id}' tetap mati (${pingRes.healthStatus})`
      );
    }
  }

  // Secondary fallback: If active healthy proxies < minActive, and Webshare API key is configured
  if (
    healthyActiveCount + resuppliedCount < minActive &&
    options?.enableWebshareFallback !== false
  ) {
    const webshareKey = process.env.WEBSHARE_API_KEY;
    if (webshareKey && webshareKey.trim().length > 0) {
      try {
        const { syncWebshareProxiesToVault } = await import("./webshare-adapter.ts");
        const wsResult = await syncWebshareProxiesToVault({
          apiKey: webshareKey,
          autoBind: true,
          testPings: options?.testWebsharePings ?? true,
          timeoutMs,
        });
        if (wsResult.healthyCount > 0) {
          resuppliedCount += wsResult.healthyCount;
          resuppliedIds.push(...wsResult.importedProxyIds);
          details.push(
            `Webshare Fallback Sync: Berhasil mengimpor ${wsResult.healthyCount} proxy sehat dari Webshare API.`
          );
        } else if (wsResult.importedCount > 0) {
          details.push(
            `Webshare Fallback Sync: Diimpor ${wsResult.importedCount} proxy dari Webshare API (${wsResult.unhealthyCount} bermasalah/gagal ping).`
          );
        }
      } catch (err: any) {
        details.push(`Webshare Fallback Sync notice: ${err?.message || err}`);
      }
    }
  }

  return {
    probedCount,
    resuppliedCount,
    resuppliedIds,
    delayedByCooldownCount,
    details,
  };
}

// ─── Webshare Proxy API Re-Exports ───────────────────────────

export {
  fetchWebshareProxyList,
  syncWebshareProxiesToVault,
  replaceWebshareProxy,
  autoReplaceFlappingWebshareProxies,
  type WebshareProxyItem,
  type WebshareApiResponse,
  type WebshareFetchOptions,
  type WebshareSyncOptions,
  type WebshareSyncResult,
  type WebshareReplaceOptions,
  type WebshareReplaceResult,
  type WebshareAutoReplaceOptions,
  type WebshareAutoReplaceResult,
} from "./webshare-adapter.ts";

// ─── Autonomous Balance Rebalancer Re-Exports ────────────────

export {
  rebalanceOperatorBalances,
  type RebalanceOptions,
  type RebalanceExecutionReport,
  type RebalanceTransferItem,
} from "./balance-rebalancer.ts";


