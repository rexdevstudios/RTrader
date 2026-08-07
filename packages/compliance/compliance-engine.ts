export interface ComplianceCaseRecord {
  id: string;
  targetEntityId: string;
  entityType: 'USER' | 'TOKEN' | 'WALLET';
  caseType: 'KYC_AML_REVIEW' | 'SANCTION_MATCH' | 'GEOFENCE_VIOLATION' | 'FRAUD_SUSPECT';
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED_CLEARED' | 'RESOLVED_SANCTIONED';
  assignedTo?: string;
  notes: string;
  createdAt: string;
}

export interface ComplianceDbAdapter {
  createCase(c: Omit<ComplianceCaseRecord, 'id' | 'createdAt'>): Promise<string>;
  updateCaseStatus(caseId: string, status: string, notes: string): Promise<void>;
  updateUserStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'FROZEN'): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class ComplianceEngine {
  private static readonly SANCTIONED_COUNTRIES = ['CU', 'IR', 'KP', 'SY'];

  /**
   * Geofencing & Sanction Check
   */
  static checkJurisdiction(countryCode: string): { isAllowed: boolean; reason?: string } {
    if (this.SANCTIONED_COUNTRIES.includes(countryCode.toUpperCase())) {
      return {
        isAllowed: false,
        reason: `COMPLIANCE_GEOFENCE_BLOCKED: Country ${countryCode} is restricted by sanctions compliance policy`,
      };
    }
    return { isAllowed: true };
  }

  /**
   * Pembekuan Akun User (Account Freeze Workflow)
   */
  static async freezeAccount(
    userId: string,
    complianceOfficerId: string,
    reason: string,
    db: ComplianceDbAdapter
  ): Promise<void> {
    console.warn(`[COMPLIANCE ACTION] Freezing user account ${userId} by officer ${complianceOfficerId}. Reason: ${reason}`);

    // 1. Update Status SSOT -> FROZEN
    await db.updateUserStatus(userId, 'FROZEN');

    // 2. Buat Compliance Case Record
    const caseId = await db.createCase({
      targetEntityId: userId,
      entityType: 'USER',
      caseType: 'KYC_AML_REVIEW',
      status: 'UNDER_REVIEW',
      assignedTo: complianceOfficerId,
      notes: reason,
    });

    // 3. Audit Logging
    await db.createAuditLog(
      complianceOfficerId,
      'COMPLIANCE_ACCOUNT_FREEZE',
      userId,
      `User account frozen. Compliance case created: ${caseId}. Reason: ${reason}`
    );
  }

  /**
   * Pemulihan Akun User (Account Thaw Workflow)
   */
  static async thawAccount(
    userId: string,
    complianceOfficerId: string,
    caseId: string,
    reason: string,
    db: ComplianceDbAdapter
  ): Promise<void> {
    console.log(`[COMPLIANCE ACTION] Unfreezing user account ${userId} by officer ${complianceOfficerId}`);

    await db.updateUserStatus(userId, 'ACTIVE');
    await db.updateCaseStatus(caseId, 'RESOLVED_CLEARED', reason);

    await db.createAuditLog(
      complianceOfficerId,
      'COMPLIANCE_ACCOUNT_THAW',
      userId,
      `User account restored to ACTIVE. Case ${caseId} resolved. Reason: ${reason}`
    );
  }
}
