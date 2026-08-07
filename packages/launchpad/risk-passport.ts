// ============================================================================
// LAUNCHPAD RISK PASSPORT COMPOSITION
// ============================================================================

import { ArkhamIntelligenceService, ArkhamLaunchRiskPassport } from '../intelligence/arkham-intelligence';

export interface LaunchPassportRequest {
  creatorWallet: string;
  treasuryWallet?: string;
  websiteUrl?: string;
  chainId: string;
  reason: string;
}

export interface LaunchPassportDbAdapter {
  saveLaunchPassport(passport: ArkhamLaunchRiskPassport): Promise<string>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class LaunchRiskPassportService {
  constructor(
    private intelligence: ArkhamIntelligenceService,
    private db: LaunchPassportDbAdapter
  ) {}

  async generate(actorId: string, request: LaunchPassportRequest): Promise<ArkhamLaunchRiskPassport> {
    const passport = await this.intelligence.buildLaunchRiskPassport(actorId, {
      creatorWallet: request.creatorWallet,
      treasuryWallet: request.treasuryWallet,
      websiteUrl: request.websiteUrl,
      chainId: request.chainId,
      reason: request.reason,
    });

    await this.db.saveLaunchPassport(passport);
    await this.db.createAuditLog(
      actorId,
      'LAUNCH_RISK_PASSPORT_SAVED',
      request.creatorWallet,
      request.reason
    );

    return passport;
  }
}

