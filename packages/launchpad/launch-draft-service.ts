// ============================================================================
// LAUNCH DRAFT SERVICE (5 LAUNCH MODES & ANGEL WHITELIST)
// ============================================================================

import { CreateLaunchDraftRequest } from '../shared/contracts/api-contracts';
import { LaunchRiskPassportService } from './risk-passport';
import { ethers } from 'ethers';

export interface LaunchDraftDbAdapter {
  saveDraft(draft: any): Promise<string>;
  saveWhitelist(launchDraftId: string, merkleRoot: string, maxAllocation: bigint): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
  getDrafts?(): Promise<any[]>;
  getActiveTokenLaunches?(): Promise<any[]>;
  getTokenLaunchByAddress?(chain: string, address: string): Promise<any | null>;
  publishLaunchDraft?(params: {
    draftId: string;
    contractAddress: string;
    chain: string;
    txHash?: string;
    currentSupply?: string;
    graduationThreshold?: number;
    riskScore?: number;
  }): Promise<{ launchId: string; contractAddress: string }>;
}

export class LaunchDraftService {
  constructor(
    private db: LaunchDraftDbAdapter,
    private riskPassportService?: LaunchRiskPassportService
  ) {}

  static hashWallet(wallet: string): string {
    if (!ethers.isAddress(wallet)) {
      throw new Error(`INVALID_WALLET_ADDRESS: ${wallet} is not a valid EVM address`);
    }
    return ethers.solidityPackedKeccak256(['address'], [ethers.getAddress(wallet)]);
  }

  static generateMerkleTree(wallets: string[]): { root: string; getProof: (wallet: string) => string[] } {
    const cleaned = wallets
      .map((w) => w.trim())
      .filter((w) => ethers.isAddress(w))
      .map((w) => ethers.getAddress(w));
    if (cleaned.length === 0) {
      return {
        root: '0x0000000000000000000000000000000000000000000000000000000000000000',
        getProof: () => [],
      };
    }

    const leaves = cleaned.map((w) => LaunchDraftService.hashWallet(w));
    if (leaves.length === 1) {
      return {
        root: leaves[0],
        getProof: (w) => (ethers.isAddress(w) && ethers.getAddress(w) === cleaned[0] ? [] : []),
      };
    }

    // Pairwise sort hash
    const combine = (a: string, b: string) => {
      return a <= b
        ? ethers.keccak256(ethers.concat([a, b]))
        : ethers.keccak256(ethers.concat([b, a]));
    };

    let currentLevel = [...leaves];
    const treeLevels: string[][] = [currentLevel];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(combine(currentLevel[i], currentLevel[i + 1]));
        } else {
          nextLevel.push(currentLevel[i]);
        }
      }
      currentLevel = nextLevel;
      treeLevels.push(currentLevel);
    }

    const root = treeLevels[treeLevels.length - 1][0];

    const getProof = (targetWallet: string): string[] => {
      if (!ethers.isAddress(targetWallet)) return [];
      const targetHash = LaunchDraftService.hashWallet(targetWallet);
      let index = treeLevels[0].indexOf(targetHash);
      if (index === -1) return [];

      const proof: string[] = [];
      for (let level = 0; level < treeLevels.length - 1; level++) {
        const isRight = index % 2 === 1;
        const pairIndex = isRight ? index - 1 : index + 1;
        if (pairIndex < treeLevels[level].length) {
          proof.push(treeLevels[level][pairIndex]);
        }
        index = Math.floor(index / 2);
      }
      return proof;
    };

    return { root, getProof };
  }

  async createDraft(actorId: string, creatorWallet: string, req: CreateLaunchDraftRequest) {
    if (!req.name || !req.ticker) {
      throw new Error('INVALID_DRAFT_INPUT: Token name and ticker are required');
    }

    let merkleRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';

    // 1. Validasi spesifik per-mode
    if (req.launchMode === 'WHITELIST_PRIVATE') {
      const rawWallets = req.socialLinks?.['whitelist_wallets'];
      const whitelistAddresses = rawWallets ? rawWallets.split(',').map((w) => w.trim()).filter(Boolean) : [];
      if (whitelistAddresses.length > 0) {
        const tree = LaunchDraftService.generateMerkleTree(whitelistAddresses);
        merkleRoot = tree.root;
      }
    } else if (req.launchMode === 'BONDING_CURVE' || req.launchMode === 'FAIR_LAUNCH') {
      if (!req.bondingCurveConfig) {
        req.bondingCurveConfig = {
          initialPriceWei: '10000000000000', // 0.00001 ETH
          graduationThresholdWei: '24000000000000000000', // 24 ETH (~$69,000)
          maxPerWalletPct: req.launchMode === 'FAIR_LAUNCH' ? 1.0 : 5.0,
        };
      }
    }

    // 2. Evaluasi Risk Passport jika service terpasang
    let riskScore = 75;
    if (this.riskPassportService) {
      try {
        const passport = await this.riskPassportService.generate(actorId, {
          creatorWallet,
          chainId: req.targetChain || 'base-mainnet',
          reason: `Launch Draft for ${req.name}`,
        });
        riskScore = passport.overallRiskScore;
      } catch {
        riskScore = 70; // Graceful fallback jika Arkham offline
      }
    }

    const draftId = `draft-${Date.now()}`;
    const draftRecord = {
      id: draftId,
      creatorId: actorId,
      creatorWallet,
      name: req.name,
      ticker: req.ticker.toUpperCase(),
      description: req.description,
      imageUrl: req.imageUrl,
      launchMode: req.launchMode,
      targetChain: req.targetChain || 'base-mainnet',
      totalSupply: req.totalSupply || '1000000000',
      merkleRoot,
      riskPassportScore: riskScore,
      status: 'DRAFT_CREATED',
      createdAt: new Date().toISOString(),
    };

    await this.db.saveDraft(draftRecord);
    if (req.launchMode === 'WHITELIST_PRIVATE') {
      await this.db.saveWhitelist(draftId, merkleRoot, BigInt(draftRecord.totalSupply) / BigInt(10));
    }
    await this.db.createAuditLog(actorId, 'LAUNCH_DRAFT_CREATED', draftId, `Mode: ${req.launchMode}`);

    return draftRecord;
  }
}
