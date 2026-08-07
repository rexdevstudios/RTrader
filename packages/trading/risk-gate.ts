import {
  TradeIntentInput,
  UserRiskLimits,
  KillSwitch,
  RiskDecision,
  evaluateTradeRisk,
} from '../shared/types/domain';

export type TradeIntentStatus =
  | 'PENDING_RISK'
  | 'RISK_APPROVED'
  | 'RISK_REJECTED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'CANCELLED'
  | 'FAILED';

export interface EntitlementCheck {
  planId: string;
  hasLiveTrading: boolean;
}

export class TradingRiskGate {
  /**
   * Pipeline Evaluasi Deterministik Risk Engine untuk Live & Testnet Order Intent
   */
  static evaluateIntent(
    intent: TradeIntentInput,
    userLimits: UserRiskLimits,
    userEntitlement: EntitlementCheck,
    activeKillSwitches: KillSwitch[]
  ): { status: TradeIntentStatus; decision: RiskDecision } {
    // 1. Entitlement Guard Check: Live Trading memuat ijin plan
    if (intent.stage === 'LIVE' && !userEntitlement.hasLiveTrading) {
      return {
        status: 'RISK_REJECTED',
        decision: {
          isApproved: false,
          score: 100,
          reason: `ENTITLEMENT_DENIED: Plan ${userEntitlement.planId} does not support live Binance trading`,
          riskFactors: ['NO_LIVE_TRADING_ENTITLEMENT'],
        },
      };
    }

    // 2. Paper Trading Auto-Approval (tanpa batas risiko live exchange)
    if (intent.stage === 'PAPER') {
      return {
        status: 'RISK_APPROVED',
        decision: {
          isApproved: true,
          score: 0,
          riskFactors: [],
        },
      };
    }

    // 3. Evaluasi Deterministik Risk Engine (Kill Switch, Slippage, Max Order, Daily Loss)
    const decision = evaluateTradeRisk(intent, userLimits, activeKillSwitches);

    const status: TradeIntentStatus = decision.isApproved ? 'RISK_APPROVED' : 'RISK_REJECTED';

    return { status, decision };
  }
}
