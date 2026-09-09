// ============================================================================
// SHARED DOMAIN TYPES, GUARDRAILS, & DETERMINISTIC ENGINE RULES
// ============================================================================

export type Role =
  | 'SUPER_ADMIN'
  | 'SYSTEM_ADMIN'
  | 'RISK_ADMIN'
  | 'LAUNCH_ADMIN'
  | 'BILLING_ADMIN'
  | 'MODERATOR'
  | 'TRADER'
  | 'CREATOR';

export type LaunchMode =
  | 'FAIR_LAUNCH'
  | 'BONDING_CURVE'
  | 'FIXED_PRICE'
  | 'WHITELIST_PRIVATE'
  | 'COMMUNITY_PRELAUNCH';

export type TradeStage = 'PAPER' | 'TESTNET' | 'LIVE';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'TAKE_PROFIT';

export interface BinanceKeyPermissions {
  read: boolean;
  trade: boolean;
  withdraw: boolean;
}

export interface TradeIntentInput {
  userId: string;
  stage: TradeStage;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  maxSlippagePct: number;
  idempotencyKey: string;
}

export interface UserRiskLimits {
  maxOrderValueUsd: number;
  maxDailyLossUsd: number;
  currentDailyLossUsd: number;
  maxOpenPositions: number;
  currentOpenPositions: number;
}

export interface KillSwitch {
  scope: 'GLOBAL' | 'USER' | 'AGENT' | 'TOKEN';
  targetId?: string;
  isActive: boolean;
  reason: string;
}

export interface RiskDecision {
  isApproved: boolean;
  score: number;
  reason?: string;
  riskFactors: string[];
}

/**
 * Subset dari ArkhamEntityProfile yang relevan untuk risk gate.
 * Dikirim secara optional — kegagalan Arkham tidak memblok evaluasi.
 */
export interface ArkhamCounterpartyProfile {
  walletAddress: string;
  riskPassportScore: number; // 0–100 (0 = paling berisiko)
  isCounterpartyBlocked: boolean;
  arkhamEntityType: string;
}

// ----------------------------------------------------------------------------
// 1. BINANCE KEY SECURITY GUARDRAIL
// ----------------------------------------------------------------------------
export function validateBinancePermissions(perms: BinanceKeyPermissions): void {
  if (perms.withdraw) {
    throw new Error(
      'SECURITY_REJECT_WITHDRAWAL_KEY: Binance API Keys with withdrawal permissions (enableWithdrawals) are strictly prohibited for platform security!'
    );
  }
  if (!perms.read || !perms.trade) {
    throw new Error(
      'INVALID_KEY_PERMISSIONS: Binance API Key must have both READ and TRADE permissions enabled.'
    );
  }
}

// ----------------------------------------------------------------------------
// 2. DETERMINISTIC RISK ENGINE EVALUATOR
// ----------------------------------------------------------------------------
export function evaluateTradeRisk(
  intent: TradeIntentInput,
  userLimits: UserRiskLimits,
  activeKillSwitches: KillSwitch[],
  counterpartyProfile?: ArkhamCounterpartyProfile // optional — out-of-band Arkham enrichment
): RiskDecision {
  const riskFactors: string[] = [];

  // A0. Arkham Counterparty Risk Block (out-of-band advisory — checked first as hard block)
  if (counterpartyProfile?.isCounterpartyBlocked === true) {
    return {
      isApproved: false,
      score: 100,
      reason: `COUNTERPARTY_BLOCKED: Wallet ${counterpartyProfile.walletAddress} is flagged as blocked by Arkham Intelligence (Type: ${counterpartyProfile.arkhamEntityType}, Score: ${counterpartyProfile.riskPassportScore})`,
      riskFactors: ['COUNTERPARTY_BLOCKED', 'ARKHAM_INTELLIGENCE_FLAG'],
    };
  }

  // A. Check Global & Target Kill Switches
  for (const ks of activeKillSwitches) {
    if (!ks.isActive) continue;
    if (ks.scope === 'GLOBAL') {
      return {
        isApproved: false,
        score: 100,
        reason: `GLOBAL_KILL_SWITCH_ACTIVE: ${ks.reason}`,
        riskFactors: ['GLOBAL_KILL_SWITCH'],
      };
    }
    if (ks.scope === 'USER' && ks.targetId === intent.userId) {
      return {
        isApproved: false,
        score: 100,
        reason: `USER_KILL_SWITCH_ACTIVE: ${ks.reason}`,
        riskFactors: ['USER_SUSPENDED'],
      };
    }
  }

  // B. Max Slippage Guardrail (Max 3%)
  if (intent.maxSlippagePct > 3.0) {
    return {
      isApproved: false,
      score: 85,
      reason: `SLIPPAGE_EXCEEDED: Requested slippage ${intent.maxSlippagePct}% exceeds maximum allowed (3.0%)`,
      riskFactors: ['HIGH_SLIPPAGE'],
    };
  }

  // C. Max Single Order Value Guardrail
  const estimatedOrderValueUsd = intent.quantity * (intent.price || 1.0);
  if (estimatedOrderValueUsd > userLimits.maxOrderValueUsd) {
    return {
      isApproved: false,
      score: 90,
      reason: `MAX_ORDER_LIMIT_EXCEEDED: Order value $${estimatedOrderValueUsd.toFixed(2)} exceeds limit $${userLimits.maxOrderValueUsd}`,
      riskFactors: ['EXCESSIVE_ORDER_SIZE'],
    };
  }

  // D. Daily Loss Limit Guardrail
  if (userLimits.currentDailyLossUsd >= userLimits.maxDailyLossUsd) {
    return {
      isApproved: false,
      score: 95,
      reason: `DAILY_LOSS_LIMIT_REACHED: Current loss $${userLimits.currentDailyLossUsd.toFixed(2)} reached cap $${userLimits.maxDailyLossUsd}`,
      riskFactors: ['DAILY_LOSS_CAP_REACHED'],
    };
  }

  // Approved
  return {
    isApproved: true,
    score: 10,
    riskFactors: [],
  };
}

// ----------------------------------------------------------------------------
// 3. FAIR LAUNCH & BONDING CURVE RULES EVALUATOR
// ----------------------------------------------------------------------------
export interface FairLaunchConfig {
  totalSupply: bigint;
  maxPerWalletPct: number; // e.g. 1.0 = 1%
  initialPriceWei: bigint;
  graduationThresholdWei: bigint;
  raisedAmountWei: bigint;
}

export function calculateBondingCurvePrice(
  currentSupply: bigint,
  amountToBuy: bigint,
  config: FairLaunchConfig
): bigint {
  // Constant product / linear polynomial curve: P = P0 + k * S
  // Return total cost in wei
  const priceMultiplier = BigInt(100);
  const cost = (amountToBuy * config.initialPriceWei) + (currentSupply * amountToBuy / priceMultiplier);
  return cost;
}

export function validateFairLaunchPurchase(
  buyerWallet: string,
  buyerCurrentBalance: bigint,
  buyAmount: bigint,
  config: FairLaunchConfig
): void {
  const maxAllowedPerWallet = (config.totalSupply * BigInt(Math.floor(config.maxPerWalletPct * 100))) / BigInt(10000);
  
  if (buyerCurrentBalance + buyAmount > maxAllowedPerWallet) {
    throw new Error(
      `FAIR_LAUNCH_ANTI_SNIPE: Purchase would exceed max per-wallet limit of ${config.maxPerWalletPct}% (${maxAllowedPerWallet.toString()} tokens)`
    );
  }
}

// ----------------------------------------------------------------------------
// 4. SOCIALFI & KOL DOMAIN CONTRACTS
// ----------------------------------------------------------------------------
export interface KolProfile {
  id: string;
  userId: string;
  twitterHandle?: string;
  followersCount: number;
  farcasterFid?: number;
  farcasterUsername?: string;
  lensHandle?: string;
  web3SocialScore?: number;
  stakingBoosterMultiplier?: number;
  trustScore: number;
  completedBounties: number;
  totalEarnedUsd: number;
  isVerified: boolean;
}

export interface BountyCampaign {
  id: string;
  launchId: string;
  creatorId: string;
  title: string;
  requiredHashtag: string;
  minFollowers: number;
  rewardPerKol: bigint;
  maxParticipants: number;
  currentParticipants: number;
  isActive: boolean;
  requiresHumanityProof?: boolean;
  minGitcoinScore?: number;
}

export interface BountyClaim {
  id: string;
  campaignId: string;
  kolId: string;
  proofUrl: string;
  verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'CLAIMED';
  sybilVerified?: boolean;
  humanityScore?: number;
  nullifierHash?: string;
  claimedAt?: Date;
  createdAt: Date;
}

export interface NutritionLabelRiskScore {
  tokenAddress: string;
  liquidityLocked: boolean;
  liquidityUnlockTimestamp?: number;
  timeLockDays?: number;
  yieldStakingActive?: boolean;
  stakingApy?: number;
  accruedYieldWei?: bigint;
  autoCompoundingActive?: boolean;
  mevProtectedGraduation?: boolean;
  maxGraduationSlippagePct?: number;
  mintRevoked: boolean;
  creatorTrustScore: number; // 0-100
  arkhamRiskScore: number; // 0-100
  overallRiskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
}

export interface PaymasterSponsorshipQuote {
  sponsorAddress: string;
  sponsoredTxType: 'BOUNTY_CLAIM' | 'PROFILE_REGISTRATION';
  kolWallet: string;
  tokenAddress: string;
  tokenAmount: string;
  deadline: number;
  chainId: number;
  signature: string;
}

export interface Web3SocialProfile {
  walletAddress: string;
  farcasterFid?: number;
  farcasterUsername?: string;
  farcasterFollowers?: number;
  lensHandle?: string;
  lensProfileId?: string;
  lensFollowers?: number;
  web3SocialScore: number; // 0-100
  isWeb3Verified: boolean;
}

export interface UpkeepStatus {
  tokenAddress: string;
  upkeepNeeded: boolean;
  lastHarvestTimestamp: number;
  nextHarvestTimestamp: number;
  pendingYieldWei: bigint;
}

export interface MevProtectionQuote {
  tokenAddress: string;
  liquidityWei: bigint;
  recommendedRpc: string;
  maxSlippageBps: number;
  isProtected: boolean;
}

export interface WorldIdProofPayload {
  merkleRoot: string;
  nullifierHash: string;
  proof: string;
  credentialType?: 'orb' | 'phone';
  action: string;
  signal: string;
}

export interface CcipBridgeQuote {
  destinationChainSelector: string;
  chainName: string;
  recipientAddress: string;
  tokenAddress: string;
  amountWei: string;
  estimatedFeeEth: string;
  encodedMessage: string;
}



