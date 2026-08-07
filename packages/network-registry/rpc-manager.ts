import { EventEmitter } from 'events';

export type RpcProviderType = 'DRPC' | 'ALCHEMY' | 'ANKR' | 'QUIKNODE' | 'CUSTOM';
export type RpcPurpose = 'PRIMARY' | 'FALLBACK' | 'ARCHIVE' | 'INDEXER' | 'TRANSACT';
export type RpcHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface RpcEndpointConfig {
  id: string;
  networkId: string;
  provider: RpcProviderType;
  purpose: RpcPurpose;
  httpUrl: string;
  wsUrl?: string;
  priority: number;
  weight: number;
  rateLimitRps: number;
  isActive: boolean;
  healthStatus: RpcHealthStatus;
  latencyMs: number;
}

export interface RpcDomainConfig {
  domain: 'LAUNCHPAD' | 'INTELLIGENCE' | 'TRADING' | 'AGENT' | 'BILLING';
  networkId: string;
  primaryRpcId: string;
  fallbackRpcId?: string;
  archiveRpcId?: string;
}

export interface AuditLogEntry {
  actorId: string;
  action: string;
  entityId?: string;
  payloadBefore?: unknown;
  payloadAfter?: unknown;
  reason?: string;
}

export interface DatabaseAdapter {
  getEndpointsForNetwork(networkId: string): Promise<RpcEndpointConfig[]>;
  getDomainConfig(domain: string, networkId: string): Promise<RpcDomainConfig | null>;
  updateEndpointHealth(endpointId: string, health: RpcHealthStatus, latencyMs: number): Promise<void>;
  createAuditLog(entry: AuditLogEntry): Promise<void>;
}

export interface PubSubAdapter {
  subscribe(channel: string, callback: (message: string) => void): Promise<void>;
  publish(channel: string, message: string): Promise<void>;
}

export class ModularRpcManager extends EventEmitter {
  private cache: Map<string, RpcEndpointConfig[]> = new Map();
  private domainConfigs: Map<string, RpcDomainConfig> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  private readonly RPC_PUBSUB_CHANNEL = 'rpc_config_updated_pubsub';

  constructor(
    private db: DatabaseAdapter,
    private pubsub?: PubSubAdapter
  ) {
    super();
  }

  /**
   * Inisialisasi RPC Manager: Connect ke PubSub untuk hot-reload tanpa redeploy.
   */
  async initialize(): Promise<void> {
    if (this.pubsub) {
      await this.pubsub.subscribe(this.RPC_PUBSUB_CHANNEL, async (message: string) => {
        console.log(`[RPC Manager] Received hot-reload pubsub event: ${message}`);
        await this.reloadConfig();
        this.emit('hot_reloaded', message);
      });
    }
  }

  /**
   * Mengambil URL RPC aktif berdasarkan network dan domain (misal: LAUNCHPAD, TRADING).
   * Mendukung otomatisasi fallback dari Primary (dRPC) ke Fallback (Ankr/Alchemy).
   */
  async getActiveHttpRpc(networkId: string, domain: 'LAUNCHPAD' | 'INTELLIGENCE' | 'TRADING' | 'AGENT' | 'BILLING'): Promise<string> {
    const domainKey = `${domain}:${networkId}`;
    let domainCfg = this.domainConfigs.get(domainKey);

    if (!domainCfg) {
      const fetched = await this.db.getDomainConfig(domain, networkId);
      if (fetched) {
        domainCfg = fetched;
        this.domainConfigs.set(domainKey, fetched);
      }
    }

    let endpoints = this.cache.get(networkId);
    if (!endpoints) {
      endpoints = await this.db.getEndpointsForNetwork(networkId);
      this.cache.set(networkId, endpoints);
    }

    // Filter endpoints aktif & healthy
    const healthyEndpoints = endpoints.filter(e => e.isActive && e.healthStatus !== 'UNHEALTHY');

    if (healthyEndpoints.length === 0) {
      throw new Error(`[RPC Error] No healthy RPC endpoints available for network: ${networkId}`);
    }

    // Cek apakah ada primary RPC khusus domain
    if (domainCfg?.primaryRpcId) {
      const primary = healthyEndpoints.find(e => e.id === domainCfg!.primaryRpcId);
      if (primary && (this.consecutiveFailures.get(primary.id) || 0) < 3) {
        return primary.httpUrl;
      }
    }

    // Fallback ke Secondary RPC jika Primary gagal
    if (domainCfg?.fallbackRpcId) {
      const fallback = healthyEndpoints.find(e => e.id === domainCfg!.fallbackRpcId);
      if (fallback) {
        console.warn(`[RPC Fallback] Routing traffic for domain ${domain} to fallback provider: ${fallback.provider}`);
        return fallback.httpUrl;
      }
    }

    // Fallback default: ambil endpoint priority terkecil
    const sorted = [...healthyEndpoints].sort((a, b) => a.priority - b.priority);
    return sorted[0].httpUrl;
  }

  /**
   * Menandai kegagalan request pada RPC tertentu untuk memicu Circuit Breaker.
   */
  async reportRpcFailure(endpointId: string, errorMsg: string): Promise<void> {
    const current = (this.consecutiveFailures.get(endpointId) || 0) + 1;
    this.consecutiveFailures.set(endpointId, current);

    console.warn(`[RPC Circuit Breaker] Endpoint ${endpointId} failed (${current}/3): ${errorMsg}`);

    if (current >= 3) {
      console.error(`[RPC Circuit Breaker] Marking endpoint ${endpointId} as UNHEALTHY`);
      await this.db.updateEndpointHealth(endpointId, 'UNHEALTHY', 9999);
      await this.reloadConfig();
    }
  }

  /**
   * Menandai sukses request pada RPC untuk mereset counter failure.
   */
  async reportRpcSuccess(endpointId: string, latencyMs: number): Promise<void> {
    this.consecutiveFailures.set(endpointId, 0);
    const healthStatus: RpcHealthStatus = latencyMs > 1500 ? 'DEGRADED' : 'HEALTHY';
    await this.db.updateEndpointHealth(endpointId, healthStatus, latencyMs);
  }

  /**
   * Update konfigurasi RPC dari Admin Console + broadcast via PubSub + Audit Log.
   */
  async updateRpcEndpoint(
    actorId: string,
    endpoint: RpcEndpointConfig,
    reason: string
  ): Promise<void> {
    // 1. Audit Log Mandatori
    await this.db.createAuditLog({
      actorId,
      action: 'UPDATE_RPC_ENDPOINT',
      entityId: endpoint.id,
      payloadAfter: endpoint,
      reason,
    });

    // 2. Clear local cache
    this.cache.delete(endpoint.networkId);

    // 3. Publish PubSub Event untuk Hot-Reload
    if (this.pubsub) {
      await this.pubsub.publish(this.RPC_PUBSUB_CHANNEL, JSON.stringify({
        action: 'UPDATE_RPC_ENDPOINT',
        networkId: endpoint.networkId,
        updatedBy: actorId,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  /**
   * Reload seluruh cache RPC dari DB SSOT.
   */
  async reloadConfig(): Promise<void> {
    this.cache.clear();
    this.domainConfigs.clear();
  }
}
