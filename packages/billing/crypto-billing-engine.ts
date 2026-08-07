import { ethers } from 'ethers';
import { ModularRpcManager } from '../network-registry/rpc-manager';

export type CryptoPaymentStatus =
  | 'CREATED'
  | 'PENDING_CONFIRMATION'
  | 'SETTLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FALLBACK_REQUIRED';

export interface CryptoPaymentIntent {
  id: string;
  userId: string;
  planId?: string;
  tokenSymbol: string;
  tokenAddress: string;
  chainType: string;
  expectedAmountWei: string;
  expectedCredits: number;
  treasuryWallet: string;
  txHash?: string;
  blockNumber?: bigint;
  confirmations: number;
  status: CryptoPaymentStatus;
  expiresAt: Date;
  settledAt?: Date;
  createdAt: Date;
}

export interface CryptoBillingDbAdapter {
  createCryptoPaymentIntent(intent: Omit<CryptoPaymentIntent, 'id' | 'createdAt' | 'confirmations' | 'status'>): Promise<CryptoPaymentIntent>;
  getCryptoPaymentIntent(id: string): Promise<CryptoPaymentIntent | null>;
  getCryptoPaymentByTxHash(txHash: string): Promise<CryptoPaymentIntent | null>;
  updateCryptoPaymentStatus(id: string, status: CryptoPaymentStatus, updates?: { txHash?: string; blockNumber?: bigint; confirmations?: number; settledAt?: Date }): Promise<void>;
  grantWalletCredits(userId: string, credits: number, refTx: string, desc: string): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class CryptoBillingEngine {
  private static readonly REQUIRED_CONFIRMATIONS = 12;
  private static readonly PAYMENT_TTL_MINUTES = 30;

  constructor(
    private rpcManager: ModularRpcManager,
    private db: CryptoBillingDbAdapter
  ) {}

  /**
   * 1. Buat Intent Pembayaran Kripto Baru (Status: CREATED)
   */
  async createPaymentIntent(params: {
    userId: string;
    planId?: string;
    tokenSymbol: string;
    tokenAddress: string;
    chainType: string;
    expectedAmountWei: string;
    expectedCredits: number;
    treasuryWallet: string;
  }): Promise<CryptoPaymentIntent> {
    const expiresAt = new Date(Date.now() + CryptoBillingEngine.PAYMENT_TTL_MINUTES * 60 * 1000);

    const intent = await this.db.createCryptoPaymentIntent({
      ...params,
      expiresAt,
    });

    await this.db.createAuditLog(
      params.userId,
      'CRYPTO_PAYMENT_INTENT_CREATED',
      intent.id,
      `Created crypto payment intent for ${params.tokenSymbol} (Expected: ${params.expectedCredits} credits)`
    );

    return intent;
  }

  /**
   * 2. Submit Transaction Hash Pengguna (Status Transition: CREATED -> PENDING_CONFIRMATION)
   */
  async submitTransactionHash(paymentId: string, txHash: string): Promise<void> {
    const intent = await this.db.getCryptoPaymentIntent(paymentId);
    if (!intent) throw new Error(`CRYPTO_BILLING_INTENT_NOT_FOUND: Payment intent ${paymentId} does not exist`);

    if (intent.status !== 'CREATED' && intent.status !== 'PENDING_CONFIRMATION') {
      throw new Error(`CRYPTO_BILLING_INVALID_STATE: Cannot submit txHash for payment in state ${intent.status}`);
    }

    // Check Idempotency / Replay Attack Prevention
    const existingTx = await this.db.getCryptoPaymentByTxHash(txHash);
    if (existingTx && existingTx.id !== paymentId && existingTx.status === 'SETTLED') {
      throw new Error(`CRYPTO_BILLING_REPLAY_ATTACK: Transaction hash ${txHash} has already been settled!`);
    }

    await this.db.updateCryptoPaymentStatus(paymentId, 'PENDING_CONFIRMATION', { txHash });
    await this.db.createAuditLog(intent.userId, 'CRYPTO_PAYMENT_TX_SUBMITTED', intent.id, `Submitted txHash ${txHash}`);
  }

  /**
   * 3. Verifikasi Settlement Onchain Otomatis via dRPC (Status Transition: PENDING_CONFIRMATION -> SETTLED / FALLBACK_REQUIRED)
   */
  async verifyAndSettlePayment(paymentId: string): Promise<{ isSettled: boolean; status: CryptoPaymentStatus }> {
    const intent = await this.db.getCryptoPaymentIntent(paymentId);
    if (!intent) throw new Error(`CRYPTO_BILLING_INTENT_NOT_FOUND: Payment intent ${paymentId} does not exist`);

    // Expired Check
    if (new Date() > intent.expiresAt && intent.status !== 'SETTLED') {
      await this.db.updateCryptoPaymentStatus(paymentId, 'EXPIRED');
      await this.db.createAuditLog(intent.userId, 'CRYPTO_PAYMENT_EXPIRED', intent.id, 'Payment TTL expired');
      return { isSettled: false, status: 'EXPIRED' };
    }

    if (!intent.txHash) {
      return { isSettled: false, status: intent.status };
    }

    try {
      const rpcUrl = await this.rpcManager.getActiveHttpRpc(intent.chainType, 'BILLING');
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const receipt = await provider.getTransactionReceipt(intent.txHash);
      if (!receipt || receipt.status !== 1) {
        // Transaction pending or failed onchain
        return { isSettled: false, status: 'PENDING_CONFIRMATION' };
      }

      const latestBlock = await provider.getBlockNumber();
      const confirmations = latestBlock - receipt.blockNumber;

      if (confirmations < CryptoBillingEngine.REQUIRED_CONFIRMATIONS) {
        await this.db.updateCryptoPaymentStatus(paymentId, 'PENDING_CONFIRMATION', {
          blockNumber: BigInt(receipt.blockNumber),
          confirmations,
        });
        return { isSettled: false, status: 'PENDING_CONFIRMATION' };
      }

      // Verify ERC-20 / Native Transfer Recipient and Amount
      const expectedAmount = BigInt(intent.expectedAmountWei);
      let isValidTransfer = false;

      if (intent.tokenAddress === '0x0' || intent.tokenAddress === 'NATIVE') {
        // Native Transfer (ETH/BNB)
        const tx = await provider.getTransaction(intent.txHash);
        if (tx && tx.to?.toLowerCase() === intent.treasuryWallet.toLowerCase() && tx.value >= expectedAmount) {
          isValidTransfer = true;
        }
      } else {
        // ERC-20 Transfer
        const transferTopic = ethers.id('Transfer(address,address,uint256)');
        const log = receipt.logs.find(
          (l: any) => l.address.toLowerCase() === intent.tokenAddress.toLowerCase() && l.topics[0] === transferTopic
        );

        if (log) {
          const toAddress = ethers.getAddress(ethers.dataSlice(log.topics[2], 12));
          const amountWei = BigInt(log.data);

          if (toAddress.toLowerCase() === intent.treasuryWallet.toLowerCase() && amountWei >= expectedAmount) {
            isValidTransfer = true;
          }
        }
      }

      if (!isValidTransfer) {
        await this.db.updateCryptoPaymentStatus(paymentId, 'REJECTED');
        await this.db.createAuditLog(
          intent.userId,
          'CRYPTO_PAYMENT_REJECTED',
          intent.id,
          'Invalid recipient treasury wallet or insufficient transfer amount'
        );
        return { isSettled: false, status: 'REJECTED' };
      }

      // SETTLED SUCCESS! Grant Credits & Update State
      const settledAt = new Date();
      await this.db.updateCryptoPaymentStatus(paymentId, 'SETTLED', {
        blockNumber: BigInt(receipt.blockNumber),
        confirmations,
        settledAt,
      });

      await this.db.grantWalletCredits(
        intent.userId,
        intent.expectedCredits,
        intent.txHash,
        `Automated Crypto Payment Settled (${intent.tokenSymbol})`
      );

      await this.db.createAuditLog(
        intent.userId,
        'CRYPTO_PAYMENT_SETTLED',
        intent.id,
        `Granted ${intent.expectedCredits} credits for ${intent.tokenSymbol} payment`
      );

      return { isSettled: true, status: 'SETTLED' };
    } catch (error) {
      console.error(`[CryptoBillingEngine] Error verifying tx ${intent.txHash}:`, error);

      // Trigger Safe Fallback Requirement
      await this.db.updateCryptoPaymentStatus(paymentId, 'FALLBACK_REQUIRED');
      await this.db.createAuditLog(
        intent.userId,
        'CRYPTO_PAYMENT_FALLBACK_TRIGGERED',
        intent.id,
        `Verification error: ${(error as Error).message}`
      );

      return { isSettled: false, status: 'FALLBACK_REQUIRED' };
    }
  }
}
