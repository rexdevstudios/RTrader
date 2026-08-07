// ============================================================================
// PAYMENT METHOD ROUTING, FALLBACKS, & STAGED TOKEN RAIL GOVERNANCE
// ============================================================================

import { TokenPaymentAdapter, TokenBillingDbAdapter } from './token-payment-adapter';

export type PaymentMethod = 'STRIPE' | 'WALLET_CREDITS' | 'TOKEN_PAYMENT';

export interface PaymentOption {
  method: PaymentMethod;
  displayName: string;
  isRecommended: boolean;
  isOptional: boolean;
  instant?: boolean;
  requiresFinality?: boolean;
  confirmations?: number;
  notes: string[];
}

export interface PaymentSelectionContext {
  userId: string;
  amountCredits: number;
  preferredMethod: PaymentMethod;
  allowFallbackToStripe: boolean;
  allowFallbackToWalletCredits: boolean;
}

export interface PaymentGatewayResult {
  method: PaymentMethod;
  status: 'SETTLED' | 'PENDING' | 'FALLBACK_REQUIRED' | 'REJECTED';
  referenceId?: string;
  creditsGranted?: number;
  reason?: string;
}

export interface StripePaymentGateway {
  createCheckoutSession(userId: string, amountCredits: number): Promise<{ sessionId: string; url: string }>;
}

export interface WalletCreditGateway {
  hasCredits(userId: string, amountCredits: number): Promise<boolean>;
  debitCredits(userId: string, amountCredits: number, referenceId: string): Promise<void>;
}

export interface PaymentRoutingDbAdapter extends TokenBillingDbAdapter {
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export interface TokenPaymentSettlementInput {
  userId: string;
  txHash: string;
  buyerWallet: string;
  expectedAmountWei: bigint;
}

export interface TokenPaymentRailContext {
  adapter: TokenPaymentAdapter;
  stage: 'DESIGN' | 'PROTOTYPE' | 'LIMITED_BETA' | 'PRODUCTION';
}

export class PaymentRoutingService {
  constructor(
    private stripe: StripePaymentGateway,
    private walletCredits: WalletCreditGateway,
    private tokenRail?: TokenPaymentRailContext,
    private db?: PaymentRoutingDbAdapter
  ) {}

  getAvailableOptions(): PaymentOption[] {
    return [
      {
        method: 'STRIPE',
        displayName: 'Stripe Credit / Debit Card',
        isRecommended: true,
        isOptional: false,
        instant: true,
        notes: ['Instant checkout', 'Recommended default for MVP', 'Best reliability for billing core'],
      },
      {
        method: 'WALLET_CREDITS',
        displayName: 'Wallet Credit Balance',
        isRecommended: false,
        isOptional: false,
        instant: true,
        notes: ['Instant ledger debit', 'Uses internal credits', 'No onchain finality required'],
      },
      {
        method: 'TOKEN_PAYMENT',
        displayName: 'Custom Deployed Token Payment',
        isRecommended: false,
        isOptional: true,
        requiresFinality: true,
        confirmations: 12,
        notes: [
          'Optional rail only',
          'Requires onchain finality',
          'May fallback to Stripe or Wallet Credits',
        ],
      },
    ];
  }

  async routePayment(selection: PaymentSelectionContext): Promise<PaymentGatewayResult> {
    if (selection.preferredMethod === 'TOKEN_PAYMENT' && this.tokenRail && this.tokenRail.stage !== 'DESIGN') {
      return {
        method: 'TOKEN_PAYMENT',
        status: 'PENDING',
        reason: 'TOKEN_SETTLEMENT_REQUIRED',
      };
    }

    if (selection.preferredMethod === 'WALLET_CREDITS') {
      const hasCredits = await this.walletCredits.hasCredits(selection.userId, selection.amountCredits);
      if (hasCredits) {
        await this.walletCredits.debitCredits(selection.userId, selection.amountCredits, `billing-${Date.now()}`);
        return {
          method: 'WALLET_CREDITS',
          status: 'SETTLED',
          referenceId: `wallet-credit-${Date.now()}`,
        };
      }
      if (selection.allowFallbackToStripe) {
        const session = await this.stripe.createCheckoutSession(selection.userId, selection.amountCredits);
        return {
          method: 'STRIPE',
          status: 'FALLBACK_REQUIRED',
          referenceId: session.sessionId,
          reason: 'WALLET_CREDITS_INSUFFICIENT_FALLING_BACK_TO_STRIPE',
        };
      }
    }

    const session = await this.stripe.createCheckoutSession(selection.userId, selection.amountCredits);
    return {
      method: 'STRIPE',
      status: 'SETTLED',
      referenceId: session.sessionId,
    };
  }

  async settleTokenPayment(input: TokenPaymentSettlementInput): Promise<PaymentGatewayResult> {
    if (!this.tokenRail || this.tokenRail.stage === 'DESIGN') {
      return {
        method: 'TOKEN_PAYMENT',
        status: 'REJECTED',
        reason: 'TOKEN_PAYMENT_RAIL_NOT_ENABLED',
      };
    }

    await this.tokenRail.adapter.processTokenPaymentSettlement(
      input.userId,
      input.txHash,
      input.buyerWallet,
      input.expectedAmountWei
    );

    return {
      method: 'TOKEN_PAYMENT',
      status: 'SETTLED',
      referenceId: input.txHash,
      creditsGranted: undefined,
    };
  }
}

