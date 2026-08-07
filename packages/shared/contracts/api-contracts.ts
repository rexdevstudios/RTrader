// ============================================================================
// DOMAIN-BY-DOMAIN API CONTRACT SPECIFICATIONS
// ============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

// 1. IDENTITY & AUTH CONTRACTS
export interface WalletChallengeRequest {
  walletAddress: string;
  chainType: 'EVM' | 'SOLANA';
}

export interface WalletChallengeResponse {
  nonce: string;
  messageToSign: string;
  expiresAt: string;
}

export interface WalletVerifyRequest {
  walletAddress: string;
  chainType: 'EVM' | 'SOLANA';
  signature: string;
  nonce: string;
}

export interface UserProfileResponse {
  userId: string;
  email?: string;
  status: string;
  kycStatus: string;
  roles: string[];
  primaryWallet?: string;
}

// 2. BILLING CONTRACTS
export interface CheckoutSessionRequest {
  planId: 'CREATOR' | 'TRADER' | 'AGENT';
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResponse {
  sessionId: string;
  stripeUrl: string;
}

export interface LedgerBalanceResponse {
  creditBalance: number;
  currency: string;
  planId: string;
  currentPeriodEnd: string;
}

// 2b. PAYMENT METHOD / TOKEN RAIL CONTRACTS
export interface PaymentMethodOptionResponse {
  method: 'STRIPE' | 'WALLET_CREDITS' | 'TOKEN_PAYMENT';
  displayName: string;
  isRecommended: boolean;
  isOptional: boolean;
  instant?: boolean;
  requiresFinality?: boolean;
  confirmations?: number;
  notes: string[];
}

export interface SelectPaymentMethodRequest {
  amountCredits: number;
  preferredMethod: 'STRIPE' | 'WALLET_CREDITS' | 'TOKEN_PAYMENT';
  allowFallbackToStripe: boolean;
  allowFallbackToWalletCredits: boolean;
}

export interface TokenPaymentSettlementRequest {
  userId: string;
  txHash: string;
  buyerWallet: string;
  expectedAmountWei: string;
}

// 3. LAUNCHPAD CONTRACTS
export interface CreateLaunchDraftRequest {
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  socialLinks?: Record<string, string>;
  launchMode: 'FAIR_LAUNCH' | 'BONDING_CURVE' | 'FIXED_PRICE' | 'WHITELIST_PRIVATE' | 'COMMUNITY_PRELAUNCH';
  targetChain: string;
  totalSupply: string;
  creatorAllocationPct: number;
  bondingCurveConfig?: {
    initialPriceWei: string;
    graduationThresholdWei: string;
    maxPerWalletPct: number;
  };
}

export interface BuyBondingCurveTokenRequest {
  launchId: string;
  amountToBuy: string;
  maxCostWei: string;
  buyerWallet: string;
}

export interface GraduationStatusResponse {
  launchId: string;
  isGraduated: boolean;
  raisedAmountWei: string;
  graduationThresholdWei: string;
  dexPairAddress?: string;
}

// 4. TRADING CONTRACTS
export interface RegisterBinanceCredentialsRequest {
  apiKey: string;
  secretKey: string;
  permissions: {
    read: boolean;
    trade: boolean;
    withdraw: boolean; // Must be false!
  };
}

export interface CreateTradeIntentRequest {
  stage: 'PAPER' | 'TESTNET' | 'LIVE';
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'TAKE_PROFIT';
  quantity: number;
  price?: number;
  maxSlippagePct: number;
}

// 5. AGENT CONTRACTS
export interface CreateAgentProfileRequest {
  name: string;
  strategyDescription: string;
  systemPrompt: string;
  riskToleranceLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'DEGEN';
}

export interface TriggerDaytonaSandboxRunRequest {
  agentId: string;
  codeSnippet: string;
  strategyParams: Record<string, unknown>;
}

export interface ApproveAgentProposalRequest {
  proposalId: string;
  userConfirmation: boolean;
}

// 6. ADMIN & RISK CONTRACTS
export interface TriggerKillSwitchRequest {
  scope: 'GLOBAL' | 'USER' | 'AGENT' | 'TOKEN';
  targetId?: string;
  reason: string;
}

export interface UpdateRpcEndpointRequest {
  endpointId: string;
  httpUrl: string;
  wsUrl?: string;
  isActive: boolean;
  reason: string;
}

export interface CreateDualControlRequest {
  actionType: 'OVERRIDE_RISK' | 'UPDATE_RPC' | 'REFUND_USER' | 'CHANGE_FEE';
  payload: Record<string, unknown>;
  reason: string;
}

// 7. INTELLIGENCE & LAUNCH RISK PASSPORT CONTRACTS
export interface BuildLaunchRiskPassportRequest {
  creatorWallet: string;
  treasuryWallet?: string;
  websiteUrl?: string;
  chainId: string;
  reason: string;
}

export interface LaunchRiskPassportResponse {
  creatorWallet: unknown;
  treasuryWallet?: unknown;
  docsSummary?: unknown;
  chainSignals: {
    chainId: string;
    liquidityLockObserved: boolean;
    exchangeExposureUsd: number;
    whaleClusterRiskScore: number;
  };
  overallRiskScore: number;
  riskNotes: string[];
}
