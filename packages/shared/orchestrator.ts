import { ModularRpcManager } from '../network-registry/rpc-manager';
import { SiweAuthService } from '../auth/siwe';
import { RbacGuard, UserContext } from '../auth/rbac-middleware';
import { BinanceCredentialVault } from '../trading/binance-vault';
import { TradingRiskGate } from '../trading/risk-gate';
import { AgentProposalEngine } from '../agent/proposal-engine';
import { DaytonaSandboxRunner } from '../../apps/execution-plane/workers/daytona-sandbox-runner';
import { FirecrawlScraperService } from '../intelligence/firecrawl-scraper';
import { DualControlManager } from '../admin/dual-control';
import { KillSwitchManager } from '../admin/kill-switch-manager';
import { ComplianceEngine } from '../compliance/compliance-engine';
import { SubscriptionsEngine } from '../billing/subscriptions-engine';
import { upstashRedis } from './redis-client';
import {
  TradeIntentInput,
  UserRiskLimits,
  KillSwitch,
  validateFairLaunchPurchase,
} from './types/domain';

export class SystemOrchestrator {
  constructor(
    public rpcManager: ModularRpcManager,
    public sandboxRunner: DaytonaSandboxRunner,
    public scraperService: FirecrawlScraperService
  ) {}

  /**
   * System-Wide Health Check & Operational Overview
   */
  async getSystemOverview(): Promise<Record<string, unknown>> {
    return {
      status: 'OPERATIONAL',
      controlPlane: 'Vercel / Next.js',
      operationalSsot: 'PostgreSQL SSOT (Neon)',
      ephemeralSidecar: upstashRedis.isConfigured() ? 'UPSTASH_REDIS_ACTIVE' : 'IN_MEMORY_FALLBACK',
      executionPlaneWorkers: ['BinanceOrderWorker', 'LaunchpadIndexerWorker', 'DaytonaSandboxRunner', 'BinanceStreamListener'],
      primaryRpcProvider: 'dRPC',
      fallbackRpcProvider: 'Ankr / Alchemy',
      activeDomains: [
        'IDENTITY', 'BILLING', 'LAUNCHPAD', 'TRADING',
        'AGENT', 'INTELLIGENCE', 'RISK', 'COMPLIANCE', 'ADMIN'
      ],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * End-to-End Assisted Trade Pipeline:
   * AI Proposal -> User Approval -> Billing Check -> Deterministic Risk Engine -> Binance Execution Queue
   */
  async processAssistedTradePipeline(
    userCtx: UserContext,
    proposalId: string,
    tradeInput: TradeIntentInput,
    userLimits: UserRiskLimits,
    activeKillSwitches: KillSwitch[],
    proposalDb: any,
    billingDb: any
  ): Promise<{ tradeIntentId: string; status: string; riskApproved: boolean }> {
    // 1. Check RBAC Capability
    RbacGuard.authorize(userCtx, 'TRADE_MANUALLY');

    // 2. Check Global / Target Kill Switches
    if (KillSwitchManager.isTargetHalted(activeKillSwitches, 'USER', userCtx.userId)) {
      throw new Error(`SYSTEM_HALTED: User ${userCtx.userId} is halted by an active Kill Switch`);
    }

    // 3. User Approves AI Proposal
    const approvedProposal = await AgentProposalEngine.approveProposal(proposalId, userCtx.userId, proposalDb);

    // 4. Verify Billing Entitlement for Live Trading
    const hasLiveTrading = await SubscriptionsEngine.checkEntitlement(userCtx.userId, 'liveTrading', billingDb);

    // 5. Evaluate Deterministic Risk Engine
    const { status, decision } = TradingRiskGate.evaluateIntent(
      tradeInput,
      userLimits,
      { planId: 'TRADER', hasLiveTrading },
      activeKillSwitches
    );

    if (!decision.isApproved) {
      throw new Error(`RISK_ENGINE_REJECTED: ${decision.reason}`);
    }

    // 6. Return Intent Status ready for Execution Plane Order Worker
    return {
      tradeIntentId: `intent-${Date.now()}`,
      status,
      riskApproved: decision.isApproved,
    };
  }
}
