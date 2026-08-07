import { ethers } from 'ethers';
import { ModularRpcManager } from '../../../packages/network-registry/rpc-manager';

export interface DatabaseIndexerAdapter {
  recordChainEvent(event: {
    networkId: string;
    blockNumber: bigint;
    txHash: string;
    eventName: string;
    contractAddress: string;
    eventData: Record<string, unknown>;
  }): Promise<void>;

  updateTokenLaunchProgress(
    contractAddress: string,
    raisedAmountWei: string,
    currentSupply: string,
    isGraduated: boolean
  ): Promise<void>;

  getLastIndexedBlock(networkId: string, contractAddress: string): Promise<bigint>;
  saveLastIndexedBlock(networkId: string, contractAddress: string, blockNumber: bigint): Promise<void>;
}

export class LaunchpadIndexerWorker {
  private isRunning: boolean = false;
  private readonly CONFIRMATIONS_REQUIRED = 12; // Re-org resilience guard

  constructor(
    private networkId: string,
    private launchpadContractAddress: string,
    private contractAbi: ethers.InterfaceAbi,
    private rpcManager: ModularRpcManager,
    private db: DatabaseIndexerAdapter
  ) {}

  /**
   * Start Loop Indexing Chain Events
   */
  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[Launchpad Indexer] Started indexing for network ${this.networkId} at contract ${this.launchpadContractAddress}`);

    while (this.isRunning) {
      try {
        await this.indexBlockRange();
      } catch (err) {
        console.error('[Launchpad Indexer Error] Failure in indexing loop:', err);
      }
      // Wait 5 seconds before next polling iteration
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  stop(): void {
    this.isRunning = false;
    console.log(`[Launchpad Indexer] Stopped indexer worker for network ${this.networkId}`);
  }

  /**
   * Main Block Range Indexer Iteration with Re-org Guard
   */
  private async indexBlockRange(): Promise<void> {
    // 1. Get Active RPC URL via Modular RPC Manager (dRPC primary, Ankr fallback)
    const rpcUrl = await this.rpcManager.getActiveHttpRpc(this.networkId, 'LAUNCHPAD');
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // 2. Fetch Latest Confirmed Block Number (Confirmed = Latest - 12)
    const latestBlock = await provider.getBlockNumber();
    const safeBlock = BigInt(latestBlock - this.CONFIRMATIONS_REQUIRED);

    const lastIndexedBlock = await this.db.getLastIndexedBlock(this.networkId, this.launchpadContractAddress);
    const startBlock = lastIndexedBlock + 1n;

    if (startBlock > safeBlock) {
      // Already caught up to safe confirmed block
      return;
    }

    // Limit block chunk to 100 blocks per iteration to prevent RPC overload
    const endBlock = startBlock + 100n < safeBlock ? startBlock + 100n : safeBlock;

    console.log(`[Launchpad Indexer] Scanning blocks ${startBlock} to ${endBlock} on ${this.networkId}`);

    const contract = new ethers.Contract(this.launchpadContractAddress, this.contractAbi, provider);

    // 3. Query Filter Events
    const events = await contract.queryFilter('*', Number(startBlock), Number(endBlock));

    for (const event of events) {
      if ('args' in event) {
        const logEvent = event as ethers.EventLog;
        await this.processLogEvent(logEvent);
      }
    }

    // 4. Update Last Indexed Block State in DB SSOT
    await this.db.saveLastIndexedBlock(this.networkId, this.launchpadContractAddress, endBlock);
  }

  /**
   * Idempotent Event Processor
   */
  private async processLogEvent(log: ethers.EventLog): Promise<void> {
    const eventName = log.eventName;
    const txHash = log.transactionHash;
    const blockNumber = BigInt(log.blockNumber);

    console.log(`[Launchpad Indexer] Processing event ${eventName} in tx ${txHash}`);

    // Parse event args to JSON object
    const eventData: Record<string, unknown> = {};
    if (log.args) {
      log.args.forEach((val: unknown, idx: number) => {
        eventData[`arg_${idx}`] = typeof val === 'bigint' ? val.toString() : val;
      });
    }

    // A. Record Raw Event to chain_events table (Idempotent PK / unique index on tx_hash + contract)
    await this.db.recordChainEvent({
      networkId: this.networkId,
      blockNumber,
      txHash,
      eventName,
      contractAddress: this.launchpadContractAddress,
      eventData,
    });

    // B. Handle Business Logic Updates in SSOT
    if (eventName === 'TokenPurchased') {
      const tokenAddress = log.args[0] as string;
      const amountTokens = (log.args[2] as bigint).toString();
      const newTotalRaisedWei = (log.args[4] as bigint).toString();

      await this.db.updateTokenLaunchProgress(tokenAddress, newTotalRaisedWei, amountTokens, false);
    } else if (eventName === 'TokenGraduated') {
      const tokenAddress = log.args[0] as string;
      const totalRaisedWei = (log.args[1] as bigint).toString();
      const totalTokensSold = (log.args[2] as bigint).toString();

      console.log(`[GRADUATION EVENT] Token ${tokenAddress} graduated with raised amount ${totalRaisedWei} wei!`);
      await this.db.updateTokenLaunchProgress(tokenAddress, totalRaisedWei, totalTokensSold, true);
    }
  }
}
