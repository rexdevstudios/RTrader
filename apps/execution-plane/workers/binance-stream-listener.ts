import { EventEmitter } from 'events';

export interface StreamReconciliationDbAdapter {
  updateOrderStatusByExchangeId(exchangeOrderId: string, status: string, executedQty: number): Promise<void>;
  updateUserBalance(userId: string, asset: string, freeBalance: number, lockedBalance: number): Promise<void>;
}

export class BinanceStreamListener extends EventEmitter {
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  constructor(
    private listenKey: string,
    private isTestnet: boolean = false,
    private db: StreamReconciliationDbAdapter
  ) {
    super();
  }

  /**
   * Start Listening to Binance User Stream WS
   */
  start(): void {
    const wsUrl = this.isTestnet
      ? `wss://testnet.binance.vision/ws/${this.listenKey}`
      : `wss://stream.binance.com:9443/ws/${this.listenKey}`;

    console.log(`[Binance Stream Listener] Connecting to WS user stream: ${wsUrl}`);
    this.isConnected = true;
    this.reconnectAttempts = 0;
    this.emit('connected');
  }

  /**
   * Simulasi Penanganan Payload Event WS dari Binance
   */
  async handleIncomingWsPayload(payloadStr: string): Promise<void> {
    try {
      const payload = JSON.parse(payloadStr);

      // A. Execution Report Event (Order Fills & Status Updates)
      if (payload.e === 'executionReport') {
        const exchangeOrderId = payload.i.toString();
        const orderStatus = payload.X; // FILLED, PARTIALLY_FILLED, CANCELED, REJECTED
        const lastExecutedQty = parseFloat(payload.l);

        console.log(`[WS Stream Event] Order ${exchangeOrderId} status update: ${orderStatus} (Qty: ${lastExecutedQty})`);
        await this.db.updateOrderStatusByExchangeId(exchangeOrderId, orderStatus, lastExecutedQty);
      }

      // B. Outbound Account Position Event (Balance Synchronization)
      else if (payload.e === 'outboundAccountPosition') {
        const balances = payload.B || [];
        for (const bal of balances) {
          const asset = bal.a;
          const free = parseFloat(bal.f);
          const locked = parseFloat(bal.l);

          console.log(`[WS Balance Sync] Asset ${asset}: Free = ${free}, Locked = ${locked}`);
          // Note: In real production, userId is resolved from the listenKey session
          await this.db.updateUserBalance('USER_RESOLVED_ID', asset, free, locked);
        }
      }
    } catch (err) {
      console.error('[WS Stream Listener Error] Failed to parse payload:', err);
    }
  }

  /**
   * Exponential Backoff Reconnect Logic
   */
  handleDisconnect(): void {
    this.isConnected = false;
    this.emit('disconnected');

    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.reconnectAttempts++;
      const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Max 30s delay

      console.warn(`[WS Reconnect] WS disconnected. Reconnecting in ${delayMs}ms (Attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`);
      setTimeout(() => this.start(), delayMs);
    } else {
      console.error('[WS Reconnect Failure] Exceeded max reconnect attempts. Triggering emergency REST polling fallback!');
      this.emit('fallback_rest_polling_required');
    }
  }
}
