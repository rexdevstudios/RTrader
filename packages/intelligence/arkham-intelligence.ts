// ============================================================================
// ARKHAM INTELLIGENCE ADAPTERS & LAUNCHPAD RISK PASSPORTING
// ============================================================================

import { FirecrawlScraperService, ScrapeJobResult } from './firecrawl-scraper';
import { ModularRpcManager } from '../network-registry/rpc-manager';

export type ArkhamEntityType = 'WALLET' | 'TOKEN' | 'ENTITY' | 'EXCHANGE' | 'PROJECT';

export interface ArkhamLabel {
  label: string;
  category: string;
  confidence: number;
}

export interface ArkhamCounterparty {
  address: string;
  entityName?: string;
  entityType?: ArkhamEntityType;
  transferCount: number;
  totalValueUsd: number;
}

export interface ArkhamFlowSummary {
  inflowUsd: number;
  outflowUsd: number;
  netFlowUsd: number;
  exchangeExposureUsd: number;
  suspiciousClusterScore: number;
}

export interface ArkhamWalletProfile {
  address: string;
  entityName?: string;
  entityType?: ArkhamEntityType;
  labels: ArkhamLabel[];
  counterparties: ArkhamCounterparty[];
  flowSummary: ArkhamFlowSummary;
  riskSignals: string[];
  lastUpdatedAt: string;
}

export interface ArkhamLaunchRiskPassport {
  creatorWallet: ArkhamWalletProfile;
  treasuryWallet?: ArkhamWalletProfile;
  docsSummary?: Pick<ScrapeJobResult, 'targetUrl' | 'domain' | 'markdownContent' | 'extractedMetadata'>;
  chainSignals: {
    chainId: string;
    liquidityLockObserved: boolean;
    exchangeExposureUsd: number;
    whaleClusterRiskScore: number;
  };
  overallRiskScore: number;
  riskNotes: string[];
}

export interface ArkhamDbAdapter {
  upsertWalletProfile(profile: ArkhamWalletProfile): Promise<void>;
  upsertLaunchRiskPassport(passport: ArkhamLaunchRiskPassport): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export interface ArkhamClient {
  fetchWalletProfile(address: string): Promise<ArkhamWalletProfile>;
  fetchEntityProfile(address: string): Promise<ArkhamWalletProfile>;
}

export interface LaunchPassportDependencies {
  rpcManager: ModularRpcManager;
  firecrawl: FirecrawlScraperService;
  arkham: ArkhamClient;
  db: ArkhamDbAdapter;
}

export class ArkhamIntelligenceService {
  constructor(private deps: LaunchPassportDependencies) {}

  /**
   * Pulls a wallet/entity profile from Arkham and persists the enrichment to SSOT.
   * This is intentionally event-driven and cache-friendly: only use it when a signal is important.
   */
  async enrichWallet(address: string, actorId: string, reason: string): Promise<ArkhamWalletProfile> {
    const profile = await this.deps.arkham.fetchWalletProfile(address);
    await this.deps.db.upsertWalletProfile(profile);
    await this.deps.db.createAuditLog(actorId, 'ARKHAM_WALLET_ENRICHMENT', address, reason);
    return profile;
  }

  /**
   * Build a launchpad risk passport by combining Arkham entity intelligence,
   * Firecrawl web intelligence, and onchain/rpc signals.
   */
  async buildLaunchRiskPassport(
    actorId: string,
    params: {
      creatorWallet: string;
      treasuryWallet?: string;
      websiteUrl?: string;
      chainId: string;
      reason: string;
    }
  ): Promise<ArkhamLaunchRiskPassport> {
    const creatorWallet = await this.deps.arkham.fetchWalletProfile(params.creatorWallet);
    const treasuryWallet = params.treasuryWallet
      ? await this.deps.arkham.fetchWalletProfile(params.treasuryWallet)
      : undefined;

    const docsSummary = params.websiteUrl
      ? await this.deps.firecrawl.scrapeTargetUrl(actorId, params.websiteUrl)
      : undefined;

    // Minimal chain signal placeholder that can be replaced by live reads from the RPC manager.
    const chainSignals = {
      chainId: params.chainId,
      liquidityLockObserved: false,
      exchangeExposureUsd: Math.max(
        creatorWallet.flowSummary.exchangeExposureUsd,
        treasuryWallet?.flowSummary.exchangeExposureUsd || 0
      ),
      whaleClusterRiskScore: Math.max(
        creatorWallet.flowSummary.suspiciousClusterScore,
        treasuryWallet?.flowSummary.suspiciousClusterScore || 0
      ),
    };

    const riskNotes = [
      ...creatorWallet.riskSignals,
      ...(treasuryWallet?.riskSignals || []),
      chainSignals.exchangeExposureUsd > 0 ? 'EXCHANGE_EXPOSURE_OBSERVED' : 'NO_EXCHANGE_EXPOSURE_FOUND',
      chainSignals.whaleClusterRiskScore > 50 ? 'HIGH_WHALE_CLUSTER_RISK' : 'WHALE_CLUSTER_RISK_ACCEPTABLE',
    ];

    const overallRiskScore = Math.min(
      100,
      Math.round(
        (creatorWallet.flowSummary.suspiciousClusterScore +
          (treasuryWallet?.flowSummary.suspiciousClusterScore || 0) +
          chainSignals.whaleClusterRiskScore) / 3
      )
    );

    const passport: ArkhamLaunchRiskPassport = {
      creatorWallet,
      treasuryWallet,
      docsSummary: docsSummary
        ? {
            targetUrl: docsSummary.targetUrl,
            domain: docsSummary.domain,
            markdownContent: docsSummary.markdownContent,
            extractedMetadata: docsSummary.extractedMetadata,
          }
        : undefined,
      chainSignals,
      overallRiskScore,
      riskNotes,
    };

    await this.deps.db.upsertLaunchRiskPassport(passport);
    await this.deps.db.createAuditLog(
      actorId,
      'LAUNCH_RISK_PASSPORT_BUILT',
      params.creatorWallet,
      params.reason
    );

    return passport;
  }

  /**
   * Resolve a high-signal watchlist profile for a wallet or entity.
   */
  async refreshWatchlistEntity(address: string, actorId: string, reason: string): Promise<ArkhamWalletProfile> {
    const profile = await this.deps.arkham.fetchEntityProfile(address);
    await this.deps.db.upsertWalletProfile(profile);
    await this.deps.db.createAuditLog(actorId, 'ARKHAM_WATCHLIST_REFRESH', address, reason);
    return profile;
  }
}

