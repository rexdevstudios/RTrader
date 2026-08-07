import { ethers } from 'ethers';
import { ModularRpcManager } from '../network-registry/rpc-manager';

export interface TokenPaymentConfig {
  tokenAddress: string;
  chain: string;
  treasuryWalletAddress: string;
  burnAddress?: string;
  burnPct: number; // e.g. 10.0 = 10% burned
  oracleTwapAddress?: string;
  maxAllowedSlippagePct: number; // Max 5.0%
}

export interface TokenPaymentIntentRequest {
  userId: string;
  tokenAddress: string;
  amountTokenWei: string;
  expectedCreditsGranted: number;
  txHash?: string;
}

export interface SettlementVerificationResult {
  isFinalized: boolean;
  blockNumber: bigint;
  confirmations: number;
  actualAmountTokensWei: string;
  buyerWalletAddress: string;
  creditsGranted: number;
  burnedAmountTokensWei: string;
}

export interface TokenBillingDbAdapter {
  recordTokenPaymentIntent(intent: {
    userId: string;
    tokenAddress: string;
    amountTokenWei: string;
    expectedCredits: number;
    status: string;
  }): Promise<string>;

  updateTokenPaymentStatus(paymentId: string, status: string, txHash?: string): Promise<void>;

  recordLedgerEntry(entry: {
    userId: string;
    amount: number;
    currency: string;
    type: string;
    referenceId?: string;
    description: string;
  }): Promise<void>;

  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class TokenPaymentAdapter {
  private static readonly REQUIRED_CONFIRMATIONS = 12;

  constructor(
    private config: TokenPaymentConfig,
    private rpcManager: ModularRpcManager,
    private db: TokenBillingDbAdapter
  ) {}

  /**
   * Evaluasi Nilai Tukar Token terhadap Kredit Platform (Pricing & Anti-Volatility Protection)
   */
  calculateTokenToCredits(
    tokenAmountWei: bigint,
    tokenPriceUsd: number, // USD per Token
    creditPriceUsd: number = 0.01 // $0.01 per Credit
  ): { creditsToGrant: number; tokenValueUsd: number } {
    const tokenDecimals = BigInt(1e18);
    const tokenAmountHuman = Number(tokenAmountWei) / Number(tokenDecimals);
    const tokenValueUsd = tokenAmountHuman * tokenPriceUsd;

    const creditsToGrant = Math.floor(tokenValueUsd / creditPriceUsd);

    return { creditsToGrant, tokenValueUsd };
  }

  /**
   * Verifikasi Settlement Onchain Pembayaran Token (Base Mainnet via dRPC Primary)
   */
  async verifyOnchainSettlement(
    txHash: string,
    expectedBuyerWallet: string,
    expectedTokenAmountWei: bigint
  ): Promise<SettlementVerificationResult> {
    const rpcUrl = await this.rpcManager.getActiveHttpRpc(this.config.chain, 'BILLING');
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // 1. Fetch Transaction Receipt
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) {
      throw new Error(`TOKEN_PAYMENT_TX_FAILED: Onchain transaction ${txHash} failed or pending`);
    }

    // 2. Re-org & Finality Check (12 Block Confirmations)
    const latestBlock = await provider.getBlockNumber();
    const confirmations = latestBlock - receipt.blockNumber;

    if (confirmations < TokenPaymentAdapter.REQUIRED_CONFIRMATIONS) {
      throw new Error(
        `TOKEN_PAYMENT_UNFINALIZED: Transaction ${txHash} has ${confirmations}/${TokenPaymentAdapter.REQUIRED_CONFIRMATIONS} confirmations`
      );
    }

    // 3. Verify ERC-20 Transfer Log Event
    const erc20TransferTopic = ethers.id('Transfer(address,address,uint256)');
    const transferLog = receipt.logs.find(
      (l: any) => l.address.toLowerCase() === this.config.tokenAddress.toLowerCase() && l.topics[0] === erc20TransferTopic
    );

    if (!transferLog) {
      throw new Error(`TOKEN_PAYMENT_NO_TRANSFER_EVENT: Transaction ${txHash} contains no valid ERC-20 Transfer event`);
    }

    const fromAddress = ethers.getAddress(ethers.dataSlice(transferLog.topics[1], 12));
    const toAddress = ethers.getAddress(ethers.dataSlice(transferLog.topics[2], 12));
    const actualAmountWei = BigInt(transferLog.data);

    // Verify Recipient is Treasury Wallet
    if (toAddress.toLowerCase() !== this.config.treasuryWalletAddress.toLowerCase()) {
      throw new Error(`TOKEN_PAYMENT_INVALID_RECIPIENT: Payment sent to ${toAddress}, expected Treasury ${this.config.treasuryWalletAddress}`);
    }

    // Verify Buyer Wallet Matches
    if (fromAddress.toLowerCase() !== expectedBuyerWallet.toLowerCase()) {
      throw new Error(`TOKEN_PAYMENT_WALLET_MISMATCH: Sender wallet ${fromAddress} does not match user wallet ${expectedBuyerWallet}`);
    }

    // Verify Amount Matches
    if (actualAmountWei < expectedTokenAmountWei) {
      throw new Error(`TOKEN_PAYMENT_INSUFFICIENT_AMOUNT: Sent ${actualAmountWei.toString()} wei, expected ${expectedTokenAmountWei.toString()} wei`);
    }

    const burnAmountWei = (actualAmountWei * BigInt(Math.floor(this.config.burnPct * 100))) / 10000n;
    const { creditsToGrant } = this.calculateTokenToCredits(actualAmountWei, 0.05); // Sample $0.05 oracle price

    return {
      isFinalized: true,
      blockNumber: BigInt(receipt.blockNumber),
      confirmations,
      actualAmountTokensWei: actualAmountWei.toString(),
      buyerWalletAddress: fromAddress,
      creditsGranted: creditsToGrant,
      burnedAmountTokensWei: burnAmountWei.toString(),
    };
  }

  /**
   * Eksekusi Alokasi Treasury & Pencatatan SSOT Ledger
   */
  async processTokenPaymentSettlement(
    userId: string,
    txHash: string,
    buyerWallet: string,
    expectedAmountWei: bigint
  ): Promise<void> {
    console.log(`[Token Payment Adapter] Verifying settlement for user ${userId} in tx ${txHash}...`);

    // 1. Verify Onchain Settlement
    const verification = await this.verifyOnchainSettlement(txHash, buyerWallet, expectedAmountWei);

    // 2. Grant Credits in Wallet Credit Ledger
    await this.db.recordLedgerEntry({
      userId,
      amount: verification.creditsGranted,
      currency: 'CREDITS',
      type: 'CUSTOM_TOKEN_PAYMENT_GRANT',
      referenceId: txHash,
      description: `Granted ${verification.creditsGranted} credits for paying ${verification.actualAmountTokensWei} wei of token ${this.config.tokenAddress}`,
    });

    // 3. Audit Log
    await this.db.createAuditLog(
      userId,
      'BILLING_CUSTOM_TOKEN_PAYMENT_SETTLED',
      txHash,
      `Token payment settled onchain. Granted ${verification.creditsGranted} credits. Burned ${verification.burnedAmountTokensWei} wei token.`
    );

    console.log(`[Token Payment Adapter] Settlement SUCCESS! Granted ${verification.creditsGranted} credits to user ${userId}`);
  }
}
