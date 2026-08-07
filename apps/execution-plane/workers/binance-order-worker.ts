import { BinanceCredentialVault } from '../../../packages/trading/binance-vault';
import { TradeIntentInput } from '../../../packages/shared/types/domain';

export interface TradeIntentRecord extends TradeIntentInput {
  id: string;
  userId: string;
  status: string;
}

export interface BinanceExecutionDbAdapter {
  getApprovedIntentsQueue(): Promise<TradeIntentRecord[]>;
  updateIntentStatus(intentId: string, status: string, riskDecisionId?: string): Promise<void>;
  getBinanceCredentials(userId: string): Promise<{ encryptedApiKey: string; encryptedSecretKey: string; iv: string; authTag: string; id: string } | null>;
  recordOrderFill(fill: {
    intentId: string;
    exchangeOrderId: string;
    symbol: string;
    status: string;
    executedQty: number;
    cummulativeQuoteQty: number;
  }): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class BinanceOrderWorker {
  private isRunning: boolean = false;

  constructor(
    private db: BinanceExecutionDbAdapter,
    private masterKeyHex: string,
    private isTestnet: boolean = false
  ) {}

  /**
   * Start Execution Worker Loop
   */
  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[Binance Order Worker] Started processing trade intents queue (Testnet: ${this.isTestnet})`);

    while (this.isRunning) {
      try {
        await this.processQueueIteration();
      } catch (err) {
        console.error('[Binance Order Worker Error] Queue processing failed:', err);
      }
      await new Promise(res => setTimeout(res, 2000)); // Poll every 2s
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log('[Binance Order Worker] Worker stopped');
  }

  /**
   * Iterasi Pemrosesan Queue Order Intent yang Ter-approve
   */
  private async processQueueIteration(): Promise<void> {
    const intents = await this.db.getApprovedIntentsQueue();

    for (const intent of intents) {
      await this.executeSingleIntent(intent);
    }
  }

  /**
   * Eksekusi Order Intent Tunggal ke Binance Spot REST API (Idempotent)
   */
  private async executeSingleIntent(intent: TradeIntentRecord): Promise<void> {
    console.log(`[Binance Order Worker] Executing intent ${intent.id} for symbol ${intent.symbol} (${intent.side})`);

    // 1. Set status -> EXECUTING untuk mencegah double execution
    await this.db.updateIntentStatus(intent.id, 'EXECUTING');

    try {
      // 2. Dekripsi Kunci Binance terenkripsi via Vault (Audit Logged)
      const creds = await this.db.getBinanceCredentials(intent.userId);
      if (!creds) {
        throw new Error(`BINANCE_CREDS_NOT_FOUND: User ${intent.userId} has no registered Binance API credentials`);
      }

      const apiKey = await BinanceCredentialVault.decrypt(
        { encryptedData: creds.encryptedApiKey, iv: creds.iv, authTag: creds.authTag },
        this.masterKeyHex,
        intent.userId,
        creds.id,
        this.db
      );

      // 3. Simulasi / Post order ke Binance REST API dengan Idempotency Key (newClientOrderId)
      const baseUrl = this.isTestnet
        ? 'https://testnet.binance.vision/api/v3/order'
        : 'https://api.binance.com/api/v3/order';

      console.log(`[Binance REST Call] Submitting order to ${baseUrl} with clientOrderId: ${intent.idempotencyKey}`);

      // Mock Receipt response (di lingkungan produksi ini menembak Binance REST Signed Request)
      const mockExchangeOrderId = `BNB-ORD-${Date.now()}`;
      const executedQty = intent.quantity;
      const cummulativeQuoteQty = intent.quantity * (intent.price || 1.0);

      // 4. Catat Fills & Update Status SSOT -> EXECUTED
      await this.db.recordOrderFill({
        intentId: intent.id,
        exchangeOrderId: mockExchangeOrderId,
        symbol: intent.symbol,
        status: 'FILLED',
        executedQty,
        cummulativeQuoteQty,
      });

      await this.db.updateIntentStatus(intent.id, 'EXECUTED');
      console.log(`[Binance Order Worker] Intent ${intent.id} successfully EXECUTED!`);

    } catch (err: any) {
      console.error(`[Binance Order Worker Error] Intent ${intent.id} execution failed:`, err.message);
      await this.db.updateIntentStatus(intent.id, 'FAILED');
    }
  }
}
