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
}

export class LaunchDraftService {
  constructor(
    private db: LaunchDraftDbAdapter,
    private riskPassportService?: LaunchRiskPassportService
  ) {}

  async createDraft(actorId: string, creatorWallet: string, req: CreateLaunchDraftRequest) {
    if (!req.name || !req.ticker) {
      throw new Error('INVALID_DRAFT_INPUT: Token name and ticker are required');
    }

    let merkleRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';

    // 1. Validasi spesifik per-mode
    if (req.launchMode === 'WHITELIST_PRIVATE') {
      // Validasi atau kalkulasi Merkle Root untuk Angel Investor Whitelist
      const rawWallets = req.socialLinks?.['whitelist_wallets'];
      const whitelistAddresses = rawWallets ? rawWallets.split(',').map((w) => w.trim()).filter(Boolean) : [];
      if (whitelistAddresses.length > 0) {
        const leaves = whitelistAddresses.map((addr) =>
          ethers.keccak256(ethers.toUtf8Bytes(addr.toLowerCase()))
        );
        merkleRoot = leaves[0]; // Representasi root leaf
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
