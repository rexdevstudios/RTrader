export type PlanId = 'FREE' | 'CREATOR' | 'TRADER' | 'AGENT';

export interface PlanEntitlements {
  paperTrading: boolean;
  viewLaunchpad: boolean;
  createLaunch: boolean;
  liveTrading: boolean;
  binanceWsStreams: boolean;
  daytonaSandbox: boolean;
  aiProposals: boolean;
}

export interface BillingDbAdapter {
  getUserPlan(userId: string): Promise<PlanId>;
  getUserCreditBalance(userId: string): Promise<number>;
  recordLedgerEntry(entry: {
    userId: string;
    amount: number;
    currency: string;
    type: string;
    referenceId?: string;
    description: string;
  }): Promise<void>;
  updateUserSubscription(userId: string, planId: PlanId, stripeSubId?: string): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class SubscriptionsEngine {
  private static readonly PLAN_MONTHLY_CREDITS: Record<PlanId, number> = {
    FREE: 100,
    CREATOR: 2000,
    TRADER: 5000,
    AGENT: 15000,
  };

  /**
   * Pengecekan Entitlement Fitur berdasarkan Plan Aktif User
   */
  static async checkEntitlement(
    userId: string,
    feature: keyof PlanEntitlements,
    db: BillingDbAdapter
  ): Promise<boolean> {
    const planId = await db.getUserPlan(userId);

    const entitlements: Record<PlanId, PlanEntitlements> = {
      FREE: { paperTrading: true, viewLaunchpad: true, createLaunch: false, liveTrading: false, binanceWsStreams: false, daytonaSandbox: false, aiProposals: false },
      CREATOR: { paperTrading: true, viewLaunchpad: true, createLaunch: true, liveTrading: false, binanceWsStreams: false, daytonaSandbox: false, aiProposals: false },
      TRADER: { paperTrading: true, viewLaunchpad: true, createLaunch: false, liveTrading: true, binanceWsStreams: true, daytonaSandbox: false, aiProposals: false },
      AGENT: { paperTrading: true, viewLaunchpad: true, createLaunch: true, liveTrading: true, binanceWsStreams: true, daytonaSandbox: true, aiProposals: true },
    };

    return entitlements[planId]?.[feature] || false;
  }

  /**
   * Pengurangan Kredit Metered Usage (Daytona Sandbox = 5, Scrape = 1, Launch = 50)
   */
  static async deductMeteredCredits(
    userId: string,
    creditsToDeduct: number,
    actionType: string,
    referenceId: string,
    db: BillingDbAdapter
  ): Promise<void> {
    const currentBalance = await db.getUserCreditBalance(userId);

    if (currentBalance < creditsToDeduct) {
      throw new Error(
        `BILLING_INSUFFICIENT_CREDITS: Required ${creditsToDeduct} credits for ${actionType}, but current balance is ${currentBalance}`
      );
    }

    // Catat Double-Entry Ledger Debit (Negatif)
    await db.recordLedgerEntry({
      userId,
      amount: -creditsToDeduct,
      currency: 'CREDITS',
      type: actionType,
      referenceId,
      description: `Metered usage deduction for ${actionType}`,
    });

    console.log(`[Billing Ledger] Deducted ${creditsToDeduct} credits from user ${userId} for ${actionType}`);
  }

  /**
   * Penambahan Kredit Bulanan (Stripe Webhook Sync / Monthly Cycle Grant)
   */
  static async grantMonthlyPlanCredits(
    userId: string,
    planId: PlanId,
    stripeSubscriptionId: string | undefined,
    db: BillingDbAdapter
  ): Promise<void> {
    const creditAmount = this.PLAN_MONTHLY_CREDITS[planId];

    await db.updateUserSubscription(userId, planId, stripeSubscriptionId);

    // Catat Double-Entry Ledger Credit (Positif)
    await db.recordLedgerEntry({
      userId,
      amount: creditAmount,
      currency: 'CREDITS',
      type: 'SUBSCRIPTION_GRANT',
      referenceId: stripeSubscriptionId,
      description: `Monthly credit grant for ${planId} plan`,
    });

    await db.createAuditLog(
      userId,
      'BILLING_SUBSCRIPTION_UPDATED',
      planId,
      `Subscription updated to ${planId}. Granted ${creditAmount} credits.`
    );
  }
}
