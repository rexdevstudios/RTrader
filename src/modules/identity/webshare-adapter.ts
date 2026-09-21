/**
 * webshare-adapter.ts — Webshare Proxy API v2 Integration Adapter.
 *
 * Responsibilities:
 *   1. Authenticated retrieval of fresh proxy lists via Webshare REST API v2.
 *   2. Registration & synchronization of fetched proxies into vault.db (SQLite).
 *   3. Optional live latency & Cloudflare/WAF preflight pinging.
 *   4. Safe failover auto-binding to operator wallets when active proxy reserves are exhausted.
 *   5. Non-blocking alert broadcasting upon successful synchronization.
 *
 * Invariants:
 *   - Zero Secret Leakage: API keys and proxy passwords are never output in plain logs.
 *   - Idempotent: Existing identical proxies in vault are safely updated without duplication.
 *   - Fail-Safe: API errors, timeouts, or network disconnects return structured results without crashing.
 */

import axios from "axios";
import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import {
  registerProxyConfig,
  updateProxyStatus,
  updateProxyDetails,
  getProxyConfig,
  listProxyConfigs,
  listWalletAccounts,
  getAllProviderRoutes,
  rotateWalletProxy,
  pingProxyEndpoint,
  recordProxyAuditLog,
  evaluateQuarantineCooldown,
} from "./wallet-manager.ts";
import { broadcastProxyAlert } from "../social/beacon-broadcaster.ts";

export interface WebshareProxyItem {
  id: string;
  ip: string;
  port: number;
  username: string;
  password?: string;
  protocol: "http" | "socks5";
  countryCode?: string;
  city?: string;
  valid: boolean;
  lastVerification?: string;
}

export interface WebshareApiResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Array<{
    id?: string;
    username?: string;
    password?: string;
    proxy_address?: string;
    port?: number;
    valid?: boolean;
    last_verification?: string;
    country_code?: string;
    city_name?: string;
    asn_name?: string;
  }>;
}

export interface WebshareFetchOptions {
  apiKey?: string;
  page?: number;
  pageSize?: number;
  mode?: "direct" | "backbone";
  timeoutMs?: number;
  /** Injected HTTP client for unit tests */
  _injectedClient?: {
    get: (url: string, config: any) => Promise<{ status: number; data: any }>;
  };
}

export interface WebshareSyncOptions extends WebshareFetchOptions {
  prefix?: string;
  replaceDead?: boolean;
  testPings?: boolean;
  autoBind?: boolean;
  broadcast?: boolean;
}

export interface WebshareSyncResult {
  success: boolean;
  totalFetched: number;
  importedCount: number;
  healthyCount: number;
  unhealthyCount: number;
  boundCount: number;
  importedProxyIds: string[];
  errors: string[];
}

/**
 * Fetches the list of active proxies from the Webshare API v2.
 */
export async function fetchWebshareProxyList(
  options?: WebshareFetchOptions
): Promise<{ proxies: WebshareProxyItem[]; totalCount: number; error?: string }> {
  let apiKey = options?.apiKey;
  if (!apiKey) {
    try {
      apiKey = getConfig().WEBSHARE_API_KEY || process.env.WEBSHARE_API_KEY;
    } catch {
      apiKey = process.env.WEBSHARE_API_KEY;
    }
  }

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      proxies: [],
      totalCount: 0,
      error: "WEBSHARE_API_KEY tidak ditemukan di .env maupun argumen pemanggilan.",
    };
  }

  const page = options?.page ?? 1;
  const pageSize = options?.pageSize ?? 25;
  const mode = options?.mode ?? "direct";
  const timeoutMs = options?.timeoutMs ?? 10000;
  const endpoint = `https://proxy.webshare.io/api/v2/proxy/list/?mode=${mode}&page=${page}&page_size=${pageSize}`;

  try {
    const client = options?._injectedClient ?? axios;
    const response = await client.get(endpoint, {
      headers: {
        Authorization: `Token ${apiKey.trim()}`,
        "User-Agent": "omnichain-deployer/1.0",
        Accept: "application/json",
      },
      timeout: timeoutMs,
    });

    if (response.status !== 200 || !response.data?.results) {
      return {
        proxies: [],
        totalCount: 0,
        error: `Webshare API merespons status HTTP ${response.status}`,
      };
    }

    const data = response.data as WebshareApiResponse;
    const proxies: WebshareProxyItem[] = [];

    for (const r of data.results) {
      if (!r.proxy_address || !r.port || !r.username) {
        continue;
      }
      proxies.push({
        id: `ws_${r.proxy_address.replace(/[^a-zA-Z0-9]/g, "_")}_${r.port}`,
        ip: r.proxy_address,
        port: r.port,
        username: r.username,
        password: r.password,
        protocol: "http",
        countryCode: r.country_code,
        city: r.city_name,
        valid: r.valid !== false,
        lastVerification: r.last_verification,
      });
    }

    return {
      proxies,
      totalCount: data.count ?? proxies.length,
    };
  } catch (err: any) {
    let errMsg = err?.message || String(err);
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      errMsg = "Kunci otentikasi WEBSHARE_API_KEY tidak valid / ditolak (HTTP 401).";
    } else if (axios.isAxiosError(err) && err.response?.status === 429) {
      errMsg = "Webshare API rate limit terlampaui (HTTP 429).";
    }
    logger.warn(`⚠️  [WEBSHARE] Gagal mengambil daftar proxy: ${errMsg}`);
    return {
      proxies: [],
      totalCount: 0,
      error: errMsg,
    };
  }
}

/**
 * Synchronizes proxies from Webshare API into vault.db and optionally tests & auto-binds them.
 */
export async function syncWebshareProxiesToVault(
  options?: WebshareSyncOptions
): Promise<WebshareSyncResult> {
  const prefix = options?.prefix ?? "ws";
  const testPings = options?.testPings ?? true;
  const autoBind = options?.autoBind ?? false;
  const replaceDead = options?.replaceDead ?? false;
  const shouldBroadcast = options?.broadcast ?? false;

  const fetchRes = await fetchWebshareProxyList(options);

  if (fetchRes.error || fetchRes.proxies.length === 0) {
    return {
      success: false,
      totalFetched: 0,
      importedCount: 0,
      healthyCount: 0,
      unhealthyCount: 0,
      boundCount: 0,
      importedProxyIds: [],
      errors: fetchRes.error ? [fetchRes.error] : ["Tidak ada proxy yang ditemukan di Webshare."],
    };
  }

  const importedProxyIds: string[] = [];
  const errors: string[] = [];
  let healthyCount = 0;
  let unhealthyCount = 0;
  let boundCount = 0;

  for (const item of fetchRes.proxies) {
    const proxyId = `${prefix}_${item.ip.replace(/[^a-zA-Z0-9]/g, "_")}_${item.port}`;
    const existing = getProxyConfig(proxyId);

    if (existing && !replaceDead) {
      // Proxy already exists, keep it
      importedProxyIds.push(proxyId);
      if (existing.status === "ACTIVE" && existing.healthStatus === "available") {
        healthyCount++;
      } else {
        unhealthyCount++;
      }
      continue;
    }

    try {
      registerProxyConfig({
        id: proxyId,
        protocol: item.protocol,
        host: item.ip,
        port: item.port,
        username: item.username,
        password: item.password ?? undefined,
        status: "ACTIVE",
      });

      let healthStatus: "available" | "unavailable" | "timeout" | "authentication_error" = "available";
      let latencyMs: number | undefined = undefined;

      if (testPings) {
        const pingRes = await pingProxyEndpoint(
          {
            protocol: item.protocol,
            host: item.ip,
            port: item.port,
            username: item.username,
            password: item.password ?? undefined,
          },
          process.env.BANKR_API_KEY,
          options?.timeoutMs ?? 8000
        );
        healthStatus = pingRes.healthStatus;
        latencyMs = pingRes.latencyMs;
        updateProxyStatus(proxyId, "ACTIVE", healthStatus, latencyMs);
      }

      if (healthStatus === "available") {
        healthyCount++;
      } else {
        unhealthyCount++;
      }

      importedProxyIds.push(proxyId);
    } catch (err: any) {
      const msg = `Gagal menyimpan proxy '${proxyId}': ${err?.message || err}`;
      errors.push(msg);
      logger.warn(`⚠️  [WEBSHARE] ${msg}`);
    }
  }

  // Auto-bind healthy proxies to wallets with missing or dead proxies if requested
  if (autoBind && healthyCount > 0) {
    const activeWallets = listWalletAccounts().filter((w) => w.status === "ACTIVE");
    const allProxies = listProxyConfigs();
    const availableHealthy = allProxies.filter(
      (p) => p.status === "ACTIVE" && p.healthStatus === "available" && importedProxyIds.includes(p.id)
    );

    let proxyIdx = 0;
    for (const w of activeWallets) {
      const routes = getAllProviderRoutes(w.id);
      for (const r of routes) {
        const currentProxy = r.proxyId ? getProxyConfig(r.proxyId) : null;
        const needsProxy = !r.proxyId || !currentProxy || currentProxy.status === "DISABLED" || currentProxy.healthStatus !== "available";

        if (needsProxy && proxyIdx < availableHealthy.length) {
          const targetProxy = availableHealthy[proxyIdx];
          try {
            rotateWalletProxy(
              w.id,
              r.provider,
              targetProxy.id,
              `Webshare Dynamic Sync auto-bind: replaced ${r.proxyId || "direct"}`
            );
            recordProxyAuditLog({
              walletId: w.id,
              provider: r.provider,
              previousProxyId: r.proxyId,
              newProxyId: targetProxy.id,
              reason: "Webshare API Dynamic Sync Auto-Bind",
            });
            boundCount++;
            proxyIdx = (proxyIdx + 1) % availableHealthy.length;
          } catch (err: any) {
            errors.push(`Auto-bind gagal untuk dompet '${w.id}': ${err?.message || err}`);
          }
        }
      }
    }
  }

  // Non-blocking broadcast if requested
  if (shouldBroadcast) {
    broadcastProxyAlert({
      type: "UNQUARANTINE",
      title: "Webshare Proxy API Dynamic Synchronization",
      details: [
        `Total diimpor: ${importedProxyIds.length} proxy`,
        `Sehat & Aktif: ${healthyCount} proxy`,
        `Bermasalah: ${unhealthyCount} proxy`,
        `Rute terikat otomatis: ${boundCount} rute`,
      ],
      totalAffected: importedProxyIds.length,
    }).catch(() => {});
  }

  return {
    success: importedProxyIds.length > 0,
    totalFetched: fetchRes.proxies.length,
    importedCount: importedProxyIds.length,
    healthyCount,
    unhealthyCount,
    boundCount,
    importedProxyIds,
    errors,
  };
}

// ─── Webshare Proxy Replacement (Auto-Replace Flapping IPs) ──────────────────

export interface WebshareReplaceOptions {
  apiKey?: string;
  timeoutMs?: number;
  testPing?: boolean;
  /** Injected HTTP client for deterministic unit testing */
  _injectedClient?: {
    post: (url: string, data: any, config: any) => Promise<{ status: number; data: any }>;
  };
}

export interface WebshareReplaceResult {
  success: boolean;
  proxyId: string;
  oldHost: string;
  newHost?: string;
  newPort?: number;
  healthStatus?: string;
  latencyMs?: number | null;
  error?: string;
}

export interface WebshareAutoReplaceOptions extends WebshareReplaceOptions {
  forceAllDisabled?: boolean;
  broadcast?: boolean;
}

export interface WebshareAutoReplaceResult {
  totalScanned: number;
  flappingCount: number;
  replacedCount: number;
  failedCount: number;
  results: WebshareReplaceResult[];
  errors: string[];
}

/**
 * Replaces a single degraded/flapping proxy IP with a fresh IP using the Webshare Replacement API.
 */
export async function replaceWebshareProxy(
  proxyId: string,
  options?: WebshareReplaceOptions
): Promise<WebshareReplaceResult> {
  const proxy = getProxyConfig(proxyId);
  if (!proxy) {
    return {
      success: false,
      proxyId,
      oldHost: "unknown",
      error: `Proxy '${proxyId}' tidak ditemukan di vault database.`,
    };
  }

  let apiKey = options?.apiKey;
  if (!apiKey) {
    try {
      apiKey = getConfig().WEBSHARE_API_KEY || process.env.WEBSHARE_API_KEY;
    } catch {
      apiKey = process.env.WEBSHARE_API_KEY;
    }
  }

  if (!apiKey || apiKey.trim().length === 0) {
    return {
      success: false,
      proxyId,
      oldHost: proxy.host,
      error: "WEBSHARE_API_KEY tidak ditemukan di .env maupun parameter pemanggilan.",
    };
  }

  const endpoint = "https://proxy.webshare.io/api/v2/proxy/replacement/";
  const timeoutMs = options?.timeoutMs ?? 15000;
  const client = options?._injectedClient ?? axios;

  try {
    const response = await client.post(
      endpoint,
      {
        ip_address: proxy.host,
      },
      {
        headers: {
          Authorization: `Token ${apiKey.trim()}`,
          "Content-Type": "application/json",
          "User-Agent": "omnichain-deployer/1.0",
          Accept: "application/json",
        },
        timeout: timeoutMs,
      }
    );

    if (response.status !== 200 && response.status !== 201) {
      return {
        success: false,
        proxyId,
        oldHost: proxy.host,
        error: `Webshare Replacement API merespons status HTTP ${response.status}`,
      };
    }

    const data = response.data || {};
    const newHost =
      data.proxy_address ||
      data.ip_address ||
      data.new_proxy?.proxy_address ||
      data.ip ||
      (Array.isArray(data.results) &&
        (data.results[0]?.proxy_address || data.results[0]?.ip_address));

    const newPort =
      data.port ||
      data.new_proxy?.port ||
      (Array.isArray(data.results) && data.results[0]?.port) ||
      proxy.port;

    if (!newHost) {
      return {
        success: false,
        proxyId,
        oldHost: proxy.host,
        error: "Webshare API tidak mengembalikan alamat IP proxy pengganti yang valid.",
      };
    }

    // Ping the new endpoint if requested
    let healthStatus = "available";
    let latencyMs: number | null = null;
    const shouldTestPing = options?.testPing ?? true;

    if (shouldTestPing) {
      const pingRes = await pingProxyEndpoint(
        {
          ...proxy,
          host: newHost,
          port: newPort,
        },
        process.env.BANKR_API_KEY,
        5000
      );
      healthStatus = pingRes.healthStatus;
      latencyMs = pingRes.latencyMs;
    }

    // Atomic update in SQLite
    updateProxyDetails(proxyId, {
      protocol: proxy.protocol,
      host: newHost,
      port: newPort,
      username: proxy.username,
      password: proxy.password,
      status: healthStatus === "available" ? "ACTIVE" : "DISABLED",
      healthStatus: healthStatus as any,
      latencyMs,
    });

    recordProxyAuditLog({
      walletId: "system",
      provider: "bankr",
      previousProxyId: proxyId,
      newProxyId: proxyId,
      reason: `Webshare Auto-Replace: IP rotated from ${proxy.host} to ${newHost}:${newPort} (health: ${healthStatus})`,
    });

    logger.success(
      `🔄 [WEBSHARE REPLACEMENT] Proxy '${proxyId}' IP diganti: ${proxy.host} -> ${newHost}:${newPort} [${healthStatus}]`
    );

    return {
      success: true,
      proxyId,
      oldHost: proxy.host,
      newHost,
      newPort,
      healthStatus,
      latencyMs,
    };
  } catch (err: any) {
    const errorMsg =
      err?.response?.data?.detail ||
      err?.response?.data?.message ||
      err?.message ||
      String(err);
    logger.warn(`⚠️  [WEBSHARE REPLACEMENT] Gagal mengganti proxy '${proxyId}': ${errorMsg}`);
    return {
      success: false,
      proxyId,
      oldHost: proxy.host,
      error: `Webshare Replacement Error: ${errorMsg}`,
    };
  }
}

/**
 * Scans all proxies in vault and automatically triggers Webshare Replacement API
 * for proxies that are in a persistent flapping state (recentFailures >= 3 in 24h).
 */
export async function autoReplaceFlappingWebshareProxies(
  options?: WebshareAutoReplaceOptions
): Promise<WebshareAutoReplaceResult> {
  const allProxies = listProxyConfigs();
  const results: WebshareReplaceResult[] = [];
  const errors: string[] = [];

  let flappingCount = 0;
  let replacedCount = 0;
  let failedCount = 0;

  for (const proxy of allProxies) {
    // Only target proxies that are from Webshare
    const isWebshare =
      proxy.id.startsWith("ws_") ||
      (proxy.metadata && (proxy.metadata as any).source === "webshare") ||
      proxy.username?.includes("webshare");

    if (!isWebshare && !options?.forceAllDisabled) {
      continue;
    }

    const cooldown = evaluateQuarantineCooldown(proxy.id);
    const isFlapping = cooldown.recentFailures >= 3;

    if (!isFlapping && !options?.forceAllDisabled) {
      continue;
    }

    flappingCount++;
    const res = await replaceWebshareProxy(proxy.id, options);
    results.push(res);

    if (res.success) {
      replacedCount++;
    } else {
      failedCount++;
      if (res.error) errors.push(res.error);
    }
  }

  if (options?.broadcast && results.length > 0) {
    broadcastProxyAlert({
      type: "ROTATION",
      title: "Webshare Flapping Proxy Auto-Replacement",
      details: [
        `Total proxy flapping terdeteksi: ${flappingCount}`,
        `Berhasil diganti IP baru        : ${replacedCount}`,
        `Gagal diganti                   : ${failedCount}`,
        ...results.map((r) =>
          r.success
            ? `• [SUKSES] ${r.proxyId}: ${r.oldHost} -> ${r.newHost}:${r.newPort} (${r.healthStatus})`
            : `• [GAGAL] ${r.proxyId}: ${r.oldHost} (${r.error})`
        ),
      ],
      totalAffected: results.length,
    }).catch(() => {});
  }

  return {
    totalScanned: allProxies.length,
    flappingCount,
    replacedCount,
    failedCount,
    results,
    errors,
  };
}

