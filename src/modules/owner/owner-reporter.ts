/**
 * owner-reporter.ts — V2.3 Owner Operations: Reporting & PnL Aggregation
 *
 * Reads directly from existing vault.ts structures. No duplication of financial state.
 * Source of truth for financial data: treasury_ledger, active_positions, fee_events.
 *
 * Key contract:
 *   - pnl_status === 'pnl_pending' → reported as PENDING, never fabricated
 *   - price_return_percent ≠ realized monetary PnL
 *   - Monetary aggregation only from pnl_status === 'calculated'
 *   - Credential values never appear in reports
 */
import { logger } from "../../logger.ts";
import {
  getPositionsByWallet,
  getClosedPositions,
  getDeployLogsByWallet,
  getAllDeployLogs,
  getTreasurySummaryByWallet,
  getTreasuryLedgerEntries,
  getFeeEvents,
  getTreasurySweeps,
  getPositionsByStatus,
  getPositionsByCandidate,
  getPositionsForLegacyDeployments,
  getDeployLogsWithoutCandidate,
  getAllCandidateIds,
  getDeployLogsByCandidate,
  getSaturationObservationsByCandidate,
  type ActivePosition,
  type DeployLogRow,
  type SaturationObservation,
} from "../../db/vault.ts";
import {
  getAllWalletAccounts,
  getWalletAccount,
  getAllProviderRoutes,
  getProxyConfig,
} from "../identity/wallet-manager.ts";

// ─── Report Types ─────────────────────────────────────────────

export interface WalletPnlSummary {
  walletId: string;
  walletLabel: string;
  totalRealizedPnl: number;       // Only from pnl_status === 'calculated'
  totalRealizedProfit: number;    // Sum of positive realized PnL
  totalRealizedLoss: number;      // Sum of negative realized PnL (absolute)
  pendingPnlCount: number;        // Positions with pnl_status === 'pnl_pending'
  openPositionCount: number;
  closedPositionCount: number;
  failedBuyCount?: number;        // V2.7: Positions with status === 'buy_failed'
  timedOutBuyCount?: number;      // V2.7: Positions with status === 'buy_timeout'
  unresolvedCount?: number;       // V2.7: Positions with status === 'unresolved'
  totalFees: number;
  treasuryNetBalance: number;
  byChain: Record<string, ChainPnlBreakdown>;
}

export interface ChainPnlBreakdown {
  chain: string;
  realizedPnl: number;
  pendingCount: number;
  positionCount: number;
}

export interface PlatformPnlSummary {
  totalRealizedPnl: number;
  totalRealizedProfit: number;
  totalRealizedLoss: number;
  pendingPnlCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  failedBuyCount?: number;        // V2.7: Platform-wide buy_failed
  timedOutBuyCount?: number;      // V2.7: Platform-wide buy_timeout
  unresolvedCount?: number;       // V2.7: Platform-wide unresolved
  totalFees: number;
  treasuryNetBalance: number;
  walletBreakdown: WalletPnlSummary[];
}

export interface ExecutionLifecycleSummary {
  walletId?: string;
  activePendingCount: number;      // buy_submitted, closing
  openCount: number;               // open
  closedCount: number;             // sold_tp, sold_sl, manual_closed
  failedBuyCount: number;          // buy_failed
  timedOutBuyCount: number;        // buy_timeout
  unresolvedCount: number;         // unresolved
}

export interface WalletReport {
  walletId: string;
  walletLabel: string;
  status: string;
  evmAddress: string | null;
  solanaAddress: string | null;
  credentialRefPresent: boolean;  // Only boolean — never expose credential value
  providerRoutes: Array<{
    provider: string;
    status: string;
    proxyId: string | null;
    proxyHealthStatus: string | null;
  }>;
  deployments: DeployLogRow[];
  positions: ActivePosition[];
  pnl: WalletPnlSummary;
  treasury: ReturnType<typeof getTreasurySummaryByWallet>;
  fees: ReturnType<typeof getFeeEvents>;
}

export interface PositionHistoryFilter {
  walletId?: string;
  chain?: string;
  status?: "open" | "closed" | "failed" | "timeout" | "unresolved" | "all";
  pnlStatus?: string;
  attributionStatus?: string;
  exitReason?: string;
  candidateId?: string;
}

export interface PositionHistoryEntry {
  position: ActivePosition;
  deployment: DeployLogRow | null;
  pnlStatusLabel: string;
  attributionLabel: string;
}

export interface UnresolvedTxEntry {
  contractAddr: string;
  ticker: string;
  chain: string;
  walletId: string | null;
  status: string;
  reconciliationStatus: string | null;
  buyTxHash: string | null;
  sellTxHash: string | null;
  lastReconciledAt: string | null;
}

// ─── PnL Label Helpers ────────────────────────────────────────

function getPnlStatusLabel(pos: ActivePosition): string {
  if (pos.pnlStatus === "calculated") return "realized";
  if (pos.pnlStatus === "pnl_pending") return "pending";
  return "unknown";
}

function getAttributionLabel(pos: ActivePosition): string {
  switch (pos.attributionStatus) {
    case "transaction_verified": return "tx_verified";
    case "balance_delta_only":   return "balance_delta";
    case "unresolved":           return "unresolved";
    default:                     return "unknown";
  }
}

// ─── Wallet PnL Aggregation ───────────────────────────────────

export function getWalletPnlSummary(walletId: string): WalletPnlSummary {
  const wallet = getWalletAccount(walletId);
  const allPositions = getPositionsByWallet(walletId);
  const openStatuses = new Set(["open", "buy_submitted", "closing"]);
  const closedStatuses = new Set(["sold_tp", "sold_sl", "manual_closed"]);

  let totalRealizedProfit = 0;
  let totalRealizedLoss = 0;
  let pendingPnlCount = 0;
  let openPositionCount = 0;
  let closedPositionCount = 0;
  let failedBuyCount = 0;
  let timedOutBuyCount = 0;
  let unresolvedCount = 0;
  const byChain: Record<string, ChainPnlBreakdown> = {};

  for (const pos of allPositions) {
    if (openStatuses.has(pos.status)) openPositionCount++;
    if (closedStatuses.has(pos.status)) closedPositionCount++;
    if (pos.status === "buy_failed") failedBuyCount++;
    else if (pos.status === "buy_timeout") timedOutBuyCount++;
    else if (pos.status === "unresolved") unresolvedCount++;

    if (!byChain[pos.chain]) {
      byChain[pos.chain] = { chain: pos.chain, realizedPnl: 0, pendingCount: 0, positionCount: 0 };
    }
    byChain[pos.chain].positionCount++;

    // Monetary PnL only from 'calculated' — never fabricate from price_return_percent
    if (pos.pnlStatus === "calculated" && pos.realizedPnl != null) {
      if (pos.realizedPnl > 0) {
        totalRealizedProfit += pos.realizedPnl;
        byChain[pos.chain].realizedPnl += pos.realizedPnl;
      } else if (pos.realizedPnl < 0) {
        totalRealizedLoss += Math.abs(pos.realizedPnl);
        byChain[pos.chain].realizedPnl += pos.realizedPnl;
      }
    } else if (pos.pnlStatus === "pnl_pending" || pos.pnlStatus == null) {
      pendingPnlCount++;
      byChain[pos.chain].pendingCount++;
    }
  }

  const feeEvents = getFeeEvents({ walletId });
  const totalFees = feeEvents
    .filter(f => f.status === "claimed" || f.status === "swept")
    .reduce((sum, f) => sum + f.amountFormatted, 0);

  const treasury = getTreasurySummaryByWallet(walletId);

  return {
    walletId,
    walletLabel: wallet?.label ?? walletId,
    totalRealizedPnl: totalRealizedProfit - totalRealizedLoss,
    totalRealizedProfit,
    totalRealizedLoss,
    pendingPnlCount,
    openPositionCount,
    closedPositionCount,
    failedBuyCount,
    timedOutBuyCount,
    unresolvedCount,
    totalFees,
    treasuryNetBalance: treasury.netTreasuryBalanceFormatted,
    byChain,
  };
}

// ─── Platform-Wide PnL ────────────────────────────────────────

export function getPlatformPnlSummary(): PlatformPnlSummary {
  const wallets = getAllWalletAccounts();
  const walletBreakdown = wallets.map(w => getWalletPnlSummary(w.id));

  let totalRealizedProfit = 0;
  let totalRealizedLoss = 0;
  let pendingPnlCount = 0;
  let openPositionCount = 0;
  let closedPositionCount = 0;
  let failedBuyCount = 0;
  let timedOutBuyCount = 0;
  let unresolvedCount = 0;
  let totalFees = 0;
  let treasuryNetBalance = 0;

  for (const w of walletBreakdown) {
    totalRealizedProfit += w.totalRealizedProfit;
    totalRealizedLoss += w.totalRealizedLoss;
    pendingPnlCount += w.pendingPnlCount;
    openPositionCount += w.openPositionCount;
    closedPositionCount += w.closedPositionCount;
    failedBuyCount += w.failedBuyCount ?? 0;
    timedOutBuyCount += w.timedOutBuyCount ?? 0;
    unresolvedCount += w.unresolvedCount ?? 0;
    totalFees += w.totalFees;
    treasuryNetBalance += w.treasuryNetBalance;
  }

  // Also aggregate positions not yet assigned to a wallet_id
  const unassigned = getPositionsByStatus([
    "open", "buy_submitted", "closing", "sold_tp", "sold_sl", "manual_closed", "buy_failed", "buy_timeout", "unresolved"
  ]).filter(p => !p.walletId);
  for (const pos of unassigned) {
    if (["open", "buy_submitted", "closing"].includes(pos.status)) openPositionCount++;
    if (["sold_tp", "sold_sl", "manual_closed"].includes(pos.status)) closedPositionCount++;
    if (pos.status === "buy_failed") failedBuyCount++;
    else if (pos.status === "buy_timeout") timedOutBuyCount++;
    else if (pos.status === "unresolved") unresolvedCount++;
    if (pos.pnlStatus === "calculated" && pos.realizedPnl != null) {
      if (pos.realizedPnl > 0) totalRealizedProfit += pos.realizedPnl;
      else if (pos.realizedPnl < 0) totalRealizedLoss += Math.abs(pos.realizedPnl);
    } else if (!pos.pnlStatus || pos.pnlStatus === "pnl_pending") {
      pendingPnlCount++;
    }
  }

  return {
    totalRealizedPnl: totalRealizedProfit - totalRealizedLoss,
    totalRealizedProfit,
    totalRealizedLoss,
    pendingPnlCount,
    openPositionCount,
    closedPositionCount,
    failedBuyCount,
    timedOutBuyCount,
    unresolvedCount,
    totalFees,
    treasuryNetBalance,
    walletBreakdown,
  };
}

// ─── Wallet Full Report ───────────────────────────────────────

export function getWalletReport(walletId: string): WalletReport | null {
  const wallet = getWalletAccount(walletId);
  if (!wallet) {
    logger.warn(`⚠️  [OWNER] Wallet '${walletId}' not found.`);
    return null;
  }

  const routes = getAllProviderRoutes(walletId);
  const providerRoutes = routes.map(r => {
    const proxy = r.proxyId ? getProxyConfig(r.proxyId) : null;
    return {
      provider: r.provider,
      status: r.status,
      proxyId: r.proxyId ?? null,
      proxyHealthStatus: proxy?.healthStatus ?? null,
    };
  });

  return {
    walletId: wallet.id,
    walletLabel: wallet.label,
    status: wallet.status,
    evmAddress: wallet.evmAddress ?? null,
    solanaAddress: wallet.solanaAddress ?? null,
    credentialRefPresent: Boolean(wallet.credentialRef),  // NEVER expose the actual ref
    providerRoutes,
    deployments: getDeployLogsByWallet(walletId),
    positions: getPositionsByWallet(walletId),
    pnl: getWalletPnlSummary(walletId),
    treasury: getTreasurySummaryByWallet(walletId),
    fees: getFeeEvents({ walletId }),
  };
}

// ─── Position History ─────────────────────────────────────────

export function getPositionHistory(filter?: PositionHistoryFilter): PositionHistoryEntry[] {
  let positions: ActivePosition[] = [];

  const status = filter?.status ?? "all";

  if (status === "open") {
    positions = getPositionsByStatus(["open", "buy_submitted", "closing"]);
  } else if (status === "closed") {
    positions = getClosedPositions({
      walletId: filter?.walletId,
      chain: filter?.chain,
      exitReason: filter?.exitReason,
    });
  } else if (status === "failed") {
    positions = getPositionsByStatus(["buy_failed"]);
  } else if (status === "timeout") {
    positions = getPositionsByStatus(["buy_timeout"]);
  } else if (status === "unresolved") {
    positions = getPositionsByStatus(["unresolved"]);
  } else {
    // all: combine open + closed + failed + timeout + unresolved
    positions = getPositionsByStatus([
      "open", "buy_submitted", "closing", "sold_tp", "sold_sl", "manual_closed", "buy_failed", "buy_timeout", "unresolved"
    ]);
  }

  // Apply remaining filters
  if (filter?.walletId && status !== "closed") {
    positions = positions.filter(p => p.walletId === filter.walletId);
  }
  if (filter?.chain && status !== "closed") {
    positions = positions.filter(p => p.chain === filter.chain);
  }
  if (filter?.pnlStatus) {
    positions = positions.filter(p => p.pnlStatus === filter.pnlStatus);
  }
  if (filter?.attributionStatus) {
    positions = positions.filter(p => p.attributionStatus === filter.attributionStatus);
  }

  // Join with deploy logs for full lineage
  const allDeploys = getAllDeployLogs();
  const deployMap = new Map<number, DeployLogRow>(allDeploys.map(d => [d.id, d]));

  if (filter?.candidateId) {
    positions = positions.filter(p => {
      const deploy = p.deployLogId ? deployMap.get(p.deployLogId) : null;
      return deploy?.candidateId === filter.candidateId;
    });
  }

  return positions.map(pos => ({
    position: pos,
    deployment: pos.deployLogId ? (deployMap.get(pos.deployLogId) ?? null) : null,
    pnlStatusLabel: getPnlStatusLabel(pos),
    attributionLabel: getAttributionLabel(pos),
  }));
}

// ─── Unresolved Transactions ──────────────────────────────────

export function getUnresolvedTransactions(): UnresolvedTxEntry[] {
  const positions = getPositionsByStatus(["buy_submitted", "open", "closing", "unresolved", "buy_timeout"]);
  return positions
    .filter(p =>
      // Genuine unresolved or timed-out positions
      p.status === "unresolved" ||
      p.status === "buy_timeout" ||
      p.reconciliationStatus === "unresolved" ||
      p.attributionStatus === "unresolved"
    )
    .map(p => ({
      contractAddr: p.contractAddr,
      ticker: p.ticker,
      chain: p.chain,
      walletId: p.walletId ?? null,
      status: p.status,
      reconciliationStatus: p.reconciliationStatus ?? null,
      buyTxHash: p.buyTxHash ?? null,
      sellTxHash: p.sellTxHash ?? null,
      lastReconciledAt: p.lastReconciledAt ?? null,
    }));
}

// ─── Execution Lifecycle Summary (V2.7) ─────────────────────────

export function getExecutionLifecycleSummary(walletId?: string): ExecutionLifecycleSummary {
  const positions = walletId
    ? getPositionsByWallet(walletId)
    : getPositionsByStatus([
        "open", "buy_submitted", "closing", "sold_tp", "sold_sl", "manual_closed", "buy_failed", "buy_timeout", "unresolved"
      ]);

  let activePendingCount = 0;
  let openCount = 0;
  let closedCount = 0;
  let failedBuyCount = 0;
  let timedOutBuyCount = 0;
  let unresolvedCount = 0;

  for (const pos of positions) {
    if (pos.status === "open") openCount++;
    else if (pos.status === "buy_submitted" || pos.status === "closing") activePendingCount++;
    else if (["sold_tp", "sold_sl", "manual_closed"].includes(pos.status)) closedCount++;
    else if (pos.status === "buy_failed") failedBuyCount++;
    else if (pos.status === "buy_timeout") timedOutBuyCount++;
    else if (pos.status === "unresolved") unresolvedCount++;
  }

  return {
    walletId,
    activePendingCount,
    openCount,
    closedCount,
    failedBuyCount,
    timedOutBuyCount,
    unresolvedCount,
  };
}

// ─── Treasury Report ──────────────────────────────────────────

export interface TreasuryReport {
  walletId?: string;
  netBalance: number;
  totalCredits: number;
  totalDebits: number;
  realizedProfits: number;
  realizedLosses: number;
  feesClaimed: number;
  swept: number;
  pendingItems: number;
  entries: ReturnType<typeof getTreasuryLedgerEntries>;
  sweeps: ReturnType<typeof getTreasurySweeps>;
}

export function getTreasuryReport(walletId?: string): TreasuryReport {
  const summary = getTreasurySummaryByWallet(walletId);
  const entries = getTreasuryLedgerEntries(walletId ? { walletId } : undefined);
  const sweeps = getTreasurySweeps(walletId);

  let totalCredits = 0;
  let totalDebits = 0;
  let realizedProfits = 0;
  let realizedLosses = 0;

  for (const entry of entries) {
    if (entry.direction === "credit") {
      totalCredits += entry.amountFormatted;
      if (entry.eventType === "realized_pnl_credited") realizedProfits += entry.amountFormatted;
    } else {
      totalDebits += entry.amountFormatted;
      if (entry.eventType === "realized_pnl_credited") realizedLosses += entry.amountFormatted;
    }
  }

  const pendingItems = sweeps.filter(s => s.status === "pending" || s.status === "submitted").length;

  return {
    walletId,
    netBalance: summary.netTreasuryBalanceFormatted,
    totalCredits,
    totalDebits,
    realizedProfits,
    realizedLosses,
    feesClaimed: summary.totalFeesClaimedFormatted,
    swept: summary.totalSweptFormatted,
    pendingItems,
    entries,
    sweeps,
  };
}

// ─── V2.4.2 Historical Performance Analytics ──────────────────

export interface CandidateChainBreakdown {
  chain: string;
  deploymentCount: number;
  successfulDeployments: number;
  failedDeployments: number;
  simulatedDeployments: number;
  positionCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  calculatedPnlCount: number;
  realizedPnl: number;           // Only from pnl_status === 'calculated'
  pendingPnlCount: number;       // Positions with pnl_status === 'pnl_pending'
  priceReturns: number[];        // Market metrics only, separate from monetary PnL
  averagePriceReturnPercent: number | null; // Market performance metric only, NOT monetary PnL
  observedSaturationCount?: number | null; // V2.4.3: Observed saturation matches specific to this chain
}

export interface CandidatePerformanceSummary {
  candidateId: string;
  tokenName: string;
  ticker: string;
  // Signal metadata from evaluation cycle
  viralScore: number | null;
  saturationCount: number | null;
  signalSources: string[] | null;
  signalScrapedAt: string | null;
  // Deployments
  totalDeployments: number;
  successfulDeployments: number;
  failedDeployments: number;
  simulatedDeployments: number;
  deployments: DeployLogRow[];
  // Positions
  totalPositions: number;
  openPositions: number;
  closedPositions: number;
  calculatedPnlCount: number;
  // Financial PnL (strictly calculated only)
  totalRealizedPnl: number;       // Sum of realizedPnl where pnl_status === 'calculated'
  totalRealizedProfit: number;    // Sum of positive realizedPnl
  totalRealizedLoss: number;      // Sum of negative realizedPnl (absolute)
  pendingPnlCount: number;        // Positions awaiting exit proceeds or reconciliation
  // Market metric (explicitly separate from realized PnL)
  averagePriceReturnPercent: number | null;
  priceReturns: number[];
  // Cross-chain breakdown
  chains: string[];
  byChain: Record<string, CandidateChainBreakdown>;
  // V2.4.3: Cross-chain saturation observations
  saturationObservations?: SaturationObservation[];
  crossChainSaturation?: Record<string, number>;
}

export interface CandidatePerformanceHistoryFilter {
  chain?: string;
  minViralScore?: number;
  maxViralScore?: number;
  hasPositions?: boolean;
  limit?: number;
  createdAfter?: string;
  createdBefore?: string;
}

export interface SignalPerformanceBucket {
  bucketKey: string;             // e.g. "90-100", "80-89", "70-79", "<70", "unrecorded"
  candidateCount: number;
  totalDeployments: number;
  successfulDeployments: number;
  failedDeployments: number;
  deploymentSuccessRate: number; // 0 to 1
  totalPositions: number;
  calculatedPnlCount: number;    // Count of positions with pnl_status === 'calculated'
  totalRealizedPnl: number;      // STRICTLY from pnl_status === 'calculated'
  totalRealizedProfit: number;
  totalRealizedLoss: number;
  pendingPnlCount: number;       // Count of positions with pnl_status === 'pnl_pending'
  averagePriceReturnPercent: number | null; // Market metric only
}

export interface HistoricalSignalPerformanceReport {
  summary: {
    totalCandidatesEvaluated: number;
    totalDeployments: number;
    totalPositions: number;
    totalRealizedPnl: number;
    pendingPnlCount: number;
  };
  byViralScoreTier: Record<string, SignalPerformanceBucket>;
  bySaturationCount: Record<string, SignalPerformanceBucket>;
  bySignalSource: Record<string, SignalPerformanceBucket>;
}

/**
 * Returns complete performance summary for a specific candidateId,
 * including multi-chain deployment outcomes, position statuses, and calculated PnL.
 *
 * Special candidateId "legacy_unassigned" aggregates deployments with candidate_id IS NULL.
 */
export function getCandidatePerformanceSummary(candidateId: string): CandidatePerformanceSummary | null {
  if (!candidateId) return null;

  const isLegacy = candidateId === "legacy_unassigned";
  const deploys = isLegacy ? getDeployLogsWithoutCandidate() : getDeployLogsByCandidate(candidateId);
  if (deploys.length === 0) return null;

  const positions = isLegacy ? getPositionsForLegacyDeployments() : getPositionsByCandidate(candidateId);

  const openStatuses = new Set(["open", "buy_submitted", "closing"]);
  const closedStatuses = new Set(["sold_tp", "sold_sl", "manual_closed"]);

  const sampleDeploy = deploys[0];
  const tokenName = isLegacy ? "Legacy Unassigned Deployments" : sampleDeploy.tokenName;
  const ticker = isLegacy ? "LEGACY" : sampleDeploy.ticker;
  const viralScore = isLegacy ? null : sampleDeploy.viralScore;
  const saturationCount = isLegacy ? null : sampleDeploy.saturationCount;
  const signalSources = isLegacy ? null : sampleDeploy.signalSources;
  const signalScrapedAt = isLegacy ? null : sampleDeploy.signalScrapedAt;

  let totalRealizedProfit = 0;
  let totalRealizedLoss = 0;
  let pendingPnlCount = 0;
  let calculatedPnlCount = 0;
  let openPositions = 0;
  let closedPositions = 0;
  const priceReturns: number[] = [];

  for (const pos of positions) {
    if (openStatuses.has(pos.status)) openPositions++;
    if (closedStatuses.has(pos.status)) closedPositions++;

    // Monetary realized PnL only from 'calculated' — never fabricate from price return
    if (pos.pnlStatus === "calculated" && pos.realizedPnl != null) {
      calculatedPnlCount++;
      if (pos.realizedPnl > 0) totalRealizedProfit += pos.realizedPnl;
      else if (pos.realizedPnl < 0) totalRealizedLoss += Math.abs(pos.realizedPnl);
    } else if (pos.pnlStatus === "pnl_pending" || pos.pnlStatus == null) {
      pendingPnlCount++;
    }

    // Price return is purely an observational market metric
    if (pos.priceReturnPercent != null) {
      priceReturns.push(pos.priceReturnPercent);
    }
  }

  // Cross-chain saturation observations
  const saturationObservations = isLegacy ? [] : getSaturationObservationsByCandidate(candidateId);
  const crossChainSaturation: Record<string, number> = {};
  for (const obs of saturationObservations) {
    crossChainSaturation[obs.chain] = obs.observedCount;
  }

  // Chain breakdown
  const chainSet = new Set<string>();
  deploys.forEach((d) => chainSet.add(d.chain));
  positions.forEach((p) => chainSet.add(p.chain));
  const chains = Array.from(chainSet).sort();

  const byChain: Record<string, CandidateChainBreakdown> = {};
  for (const chain of chains) {
    const chainDeploys = deploys.filter((d) => d.chain === chain);
    const chainPositions = positions.filter((p) => p.chain === chain);

    let chainProfit = 0;
    let chainLoss = 0;
    let chainPendingPnl = 0;
    let chainCalculatedPnlCount = 0;
    let chainOpen = 0;
    let chainClosed = 0;
    const chainPriceReturns: number[] = [];

    for (const p of chainPositions) {
      if (openStatuses.has(p.status)) chainOpen++;
      if (closedStatuses.has(p.status)) chainClosed++;

      if (p.pnlStatus === "calculated" && p.realizedPnl != null) {
        chainCalculatedPnlCount++;
        if (p.realizedPnl > 0) chainProfit += p.realizedPnl;
        else if (p.realizedPnl < 0) chainLoss += Math.abs(p.realizedPnl);
      } else if (p.pnlStatus === "pnl_pending" || p.pnlStatus == null) {
        chainPendingPnl++;
      }

      if (p.priceReturnPercent != null) {
        chainPriceReturns.push(p.priceReturnPercent);
      }
    }

    const avgChainPriceReturn =
      chainPriceReturns.length > 0
        ? chainPriceReturns.reduce((sum, r) => sum + r, 0) / chainPriceReturns.length
        : null;

    byChain[chain] = {
      chain,
      deploymentCount: chainDeploys.length,
      successfulDeployments: chainDeploys.filter((d) => d.status === "success").length,
      failedDeployments: chainDeploys.filter((d) => d.status === "failed").length,
      simulatedDeployments: chainDeploys.filter((d) => d.simulated).length,
      positionCount: chainPositions.length,
      openPositionCount: chainOpen,
      closedPositionCount: chainClosed,
      calculatedPnlCount: chainCalculatedPnlCount,
      realizedPnl: chainProfit - chainLoss,
      pendingPnlCount: chainPendingPnl,
      priceReturns: chainPriceReturns,
      averagePriceReturnPercent: avgChainPriceReturn,
      observedSaturationCount: crossChainSaturation[chain] ?? null,
    };
  }

  const averagePriceReturnPercent =
    priceReturns.length > 0
      ? priceReturns.reduce((sum, r) => sum + r, 0) / priceReturns.length
      : null;

  return {
    candidateId,
    tokenName,
    ticker,
    viralScore,
    saturationCount,
    signalSources,
    signalScrapedAt,
    totalDeployments: deploys.length,
    successfulDeployments: deploys.filter((d) => d.status === "success").length,
    failedDeployments: deploys.filter((d) => d.status === "failed").length,
    simulatedDeployments: deploys.filter((d) => d.simulated).length,
    deployments: deploys,
    totalPositions: positions.length,
    openPositions,
    closedPositions,
    calculatedPnlCount,
    totalRealizedPnl: totalRealizedProfit - totalRealizedLoss,
    totalRealizedProfit,
    totalRealizedLoss,
    pendingPnlCount,
    averagePriceReturnPercent,
    priceReturns,
    chains,
    byChain,
    saturationObservations,
    crossChainSaturation,
  };
}

export interface CrossChainSaturationReport {
  candidateId: string;
  ticker: string;
  globalCount: number;
  isGloballySaturated: boolean;
  byChain: Record<string, { observedCount: number; isSaturated: boolean }>;
  observedChains: string[];
  source: string;
  providerStatus: "available" | "unavailable";
  observedAt: string;
}

export function getCrossChainSaturationReport(candidateId: string): CrossChainSaturationReport | null {
  const observations = getSaturationObservationsByCandidate(candidateId);
  if (observations.length === 0) return null;

  const globalObs = observations.find((o) => o.chain === "global");
  const chainObs = observations.filter((o) => o.chain !== "global");

  const byChain: Record<string, { observedCount: number; isSaturated: boolean }> = {};
  for (const o of chainObs) {
    byChain[o.chain] = {
      observedCount: o.observedCount,
      isSaturated: o.isSaturated,
    };
  }

  const observedChains = chainObs
    .filter((o) => o.observedCount > 0)
    .map((o) => o.chain)
    .sort();

  return {
    candidateId,
    ticker: observations[0].ticker,
    globalCount: globalObs?.observedCount ?? 0,
    isGloballySaturated: globalObs?.isSaturated ?? false,
    byChain,
    observedChains,
    source: observations[0].source,
    providerStatus: observations[0].providerStatus,
    observedAt: observations[0].observedAt,
  };
}

/**
 * Returns historical performance summaries for all candidates, with optional filtering.
 */
export function getCandidatePerformanceHistory(filter?: CandidatePerformanceHistoryFilter): CandidatePerformanceSummary[] {
  const candidateIds = getAllCandidateIds({
    createdAfter: filter?.createdAfter,
    createdBefore: filter?.createdBefore,
  });
  const summaries: CandidatePerformanceSummary[] = [];

  for (const cid of candidateIds) {
    const summary = getCandidatePerformanceSummary(cid);
    if (!summary) continue;

    if (filter?.chain && !summary.chains.includes(filter.chain)) {
      continue;
    }
    if (filter?.minViralScore !== undefined && (summary.viralScore == null || summary.viralScore < filter.minViralScore)) {
      continue;
    }
    if (filter?.maxViralScore !== undefined && (summary.viralScore == null || summary.viralScore > filter.maxViralScore)) {
      continue;
    }
    if (filter?.hasPositions && summary.totalPositions === 0) {
      continue;
    }

    summaries.push(summary);
  }

  if (filter?.limit && filter.limit > 0) {
    return summaries.slice(0, filter.limit);
  }

  return summaries;
}

/**
 * Aggregates historical deployment outcomes and calculated PnL by signal dimension:
 *  - Viral score tiers (90-100, 80-89, 70-79, <70, unrecorded)
 *  - Saturation count tiers (0, 1, 2, 3+, unrecorded)
 *  - Scraped signal sources
 *
 * Strictly observational and non-causal. Monetary PnL is computed ONLY from calculated positions.
 */
export function getHistoricalSignalPerformance(): HistoricalSignalPerformanceReport {
  const candidates = getCandidatePerformanceHistory();

  function createBucket(bucketKey: string): SignalPerformanceBucket {
    return {
      bucketKey,
      candidateCount: 0,
      totalDeployments: 0,
      successfulDeployments: 0,
      failedDeployments: 0,
      deploymentSuccessRate: 0,
      totalPositions: 0,
      calculatedPnlCount: 0,
      totalRealizedPnl: 0,
      totalRealizedProfit: 0,
      totalRealizedLoss: 0,
      pendingPnlCount: 0,
      averagePriceReturnPercent: null,
    };
  }

  const byViralScoreTier: Record<string, SignalPerformanceBucket> = {
    "90-100": createBucket("90-100"),
    "80-89": createBucket("80-89"),
    "70-79": createBucket("70-79"),
    "<70": createBucket("<70"),
    unrecorded: createBucket("unrecorded"),
  };

  const bySaturationCount: Record<string, SignalPerformanceBucket> = {
    "0": createBucket("0"),
    "1": createBucket("1"),
    "2": createBucket("2"),
    "3+": createBucket("3+"),
    unrecorded: createBucket("unrecorded"),
  };

  const bySignalSource: Record<string, SignalPerformanceBucket> = {};

  const viralPriceReturns: Record<string, number[]> = {
    "90-100": [],
    "80-89": [],
    "70-79": [],
    "<70": [],
    unrecorded: [],
  };
  const saturationPriceReturns: Record<string, number[]> = {
    "0": [],
    "1": [],
    "2": [],
    "3+": [],
    unrecorded: [],
  };
  const sourcePriceReturns: Record<string, number[]> = {};

  let totalRealizedPnl = 0;
  let totalDeployments = 0;
  let totalPositions = 0;
  let pendingPnlCount = 0;

  for (const c of candidates) {
    totalRealizedPnl += c.totalRealizedPnl;
    totalDeployments += c.totalDeployments;
    totalPositions += c.totalPositions;
    pendingPnlCount += c.pendingPnlCount;

    // 1. Viral score tier
    let viralKey = "unrecorded";
    if (c.viralScore != null) {
      if (c.viralScore >= 90) viralKey = "90-100";
      else if (c.viralScore >= 80) viralKey = "80-89";
      else if (c.viralScore >= 70) viralKey = "70-79";
      else viralKey = "<70";
    }
    const vBucket = byViralScoreTier[viralKey];
    vBucket.candidateCount++;
    vBucket.totalDeployments += c.totalDeployments;
    vBucket.successfulDeployments += c.successfulDeployments;
    vBucket.failedDeployments += c.failedDeployments;
    vBucket.totalPositions += c.totalPositions;
    vBucket.calculatedPnlCount += c.calculatedPnlCount;
    vBucket.totalRealizedPnl += c.totalRealizedPnl;
    vBucket.totalRealizedProfit += c.totalRealizedProfit;
    vBucket.totalRealizedLoss += c.totalRealizedLoss;
    vBucket.pendingPnlCount += c.pendingPnlCount;
    c.priceReturns.forEach((pr) => viralPriceReturns[viralKey].push(pr));

    // 2. Saturation count tier
    let satKey = "unrecorded";
    if (c.saturationCount != null) {
      if (c.saturationCount === 0) satKey = "0";
      else if (c.saturationCount === 1) satKey = "1";
      else if (c.saturationCount === 2) satKey = "2";
      else satKey = "3+";
    }
    const sBucket = bySaturationCount[satKey];
    sBucket.candidateCount++;
    sBucket.totalDeployments += c.totalDeployments;
    sBucket.successfulDeployments += c.successfulDeployments;
    sBucket.failedDeployments += c.failedDeployments;
    sBucket.totalPositions += c.totalPositions;
    sBucket.calculatedPnlCount += c.calculatedPnlCount;
    sBucket.totalRealizedPnl += c.totalRealizedPnl;
    sBucket.totalRealizedProfit += c.totalRealizedProfit;
    sBucket.totalRealizedLoss += c.totalRealizedLoss;
    sBucket.pendingPnlCount += c.pendingPnlCount;
    c.priceReturns.forEach((pr) => saturationPriceReturns[satKey].push(pr));

    // 3. Signal sources
    const sources = c.signalSources && c.signalSources.length > 0 ? c.signalSources : ["unrecorded"];
    for (const src of sources) {
      if (!bySignalSource[src]) {
        bySignalSource[src] = createBucket(src);
        sourcePriceReturns[src] = [];
      }
      const srcBucket = bySignalSource[src];
      srcBucket.candidateCount++;
      srcBucket.totalDeployments += c.totalDeployments;
      srcBucket.successfulDeployments += c.successfulDeployments;
      srcBucket.failedDeployments += c.failedDeployments;
      srcBucket.totalPositions += c.totalPositions;
      srcBucket.calculatedPnlCount += c.calculatedPnlCount;
      srcBucket.totalRealizedPnl += c.totalRealizedPnl;
      srcBucket.totalRealizedProfit += c.totalRealizedProfit;
      srcBucket.totalRealizedLoss += c.totalRealizedLoss;
      srcBucket.pendingPnlCount += c.pendingPnlCount;
      c.priceReturns.forEach((pr) => sourcePriceReturns[src].push(pr));
    }
  }

  // Calculate success rates and average price returns
  for (const key of Object.keys(byViralScoreTier)) {
    const b = byViralScoreTier[key];
    b.deploymentSuccessRate = b.totalDeployments > 0 ? b.successfulDeployments / b.totalDeployments : 0;
    const prs = viralPriceReturns[key];
    b.averagePriceReturnPercent = prs.length > 0 ? prs.reduce((sum, r) => sum + r, 0) / prs.length : null;
  }

  for (const key of Object.keys(bySaturationCount)) {
    const b = bySaturationCount[key];
    b.deploymentSuccessRate = b.totalDeployments > 0 ? b.successfulDeployments / b.totalDeployments : 0;
    const prs = saturationPriceReturns[key];
    b.averagePriceReturnPercent = prs.length > 0 ? prs.reduce((sum, r) => sum + r, 0) / prs.length : null;
  }

  for (const key of Object.keys(bySignalSource)) {
    const b = bySignalSource[key];
    b.deploymentSuccessRate = b.totalDeployments > 0 ? b.successfulDeployments / b.totalDeployments : 0;
    const prs = sourcePriceReturns[key];
    b.averagePriceReturnPercent = prs.length > 0 ? prs.reduce((sum, r) => sum + r, 0) / prs.length : null;
  }

  return {
    summary: {
      totalCandidatesEvaluated: candidates.length,
      totalDeployments,
      totalPositions,
      totalRealizedPnl,
      pendingPnlCount,
    },
    byViralScoreTier,
    bySaturationCount,
    bySignalSource,
  };
}
