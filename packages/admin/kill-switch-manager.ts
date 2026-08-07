import { KillSwitch } from '../shared/types/domain';

export interface KillSwitchDbAdapter {
  activateKillSwitch(ks: Omit<KillSwitchRecord, 'id' | 'activatedAt'>): Promise<string>;
  deactivateKillSwitch(id: string, deactivatedBy: string): Promise<void>;
  getActiveKillSwitches(): Promise<KillSwitchRecord[]>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export interface KillSwitchRecord extends KillSwitch {
  id: string;
  activatedBy: string;
  deactivatedBy?: string;
  activatedAt: string;
  deactivatedAt?: string;
}

export class KillSwitchManager {
  /**
   * Aktifkan Kill Switch (Global, User, Agent, atau Token)
   */
  static async activate(
    scope: 'GLOBAL' | 'USER' | 'AGENT' | 'TOKEN',
    activatedBy: string,
    reason: string,
    targetId: string | undefined,
    db: KillSwitchDbAdapter
  ): Promise<KillSwitchRecord> {
    console.warn(`[EMERGENCY KILL SWITCH] Activating ${scope} kill switch by admin ${activatedBy}. Reason: ${reason}`);

    const activatedAt = new Date().toISOString();
    const record: Omit<KillSwitchRecord, 'id' | 'activatedAt'> = {
      scope,
      targetId,
      isActive: true,
      reason,
      activatedBy,
    };

    const id = await db.activateKillSwitch(record);

    // Audit Trail
    await db.createAuditLog(
      activatedBy,
      `KILL_SWITCH_ACTIVATED_${scope}`,
      id,
      `Emergency kill switch activated for ${scope} (Target: ${targetId || 'ALL'}). Reason: ${reason}`
    );

    return { id, activatedAt, ...record };
  }

  /**
   * Deaktifkan Kill Switch (Recovery Workflow)
   */
  static async deactivate(
    killSwitchId: string,
    deactivatedBy: string,
    reason: string,
    db: KillSwitchDbAdapter
  ): Promise<void> {
    console.log(`[KILL SWITCH RECOVERY] Deactivating kill switch ${killSwitchId} by admin ${deactivatedBy}`);

    await db.deactivateKillSwitch(killSwitchId, deactivatedBy);

    // Audit Trail
    await db.createAuditLog(
      deactivatedBy,
      'KILL_SWITCH_DEACTIVATED',
      killSwitchId,
      `Kill switch recovered/deactivated. Reason: ${reason}`
    );
  }

  /**
   * Pengecekan Cepat Apakah Target Memiliki Kill Switch Aktif
   */
  static isTargetHalted(
    activeSwitches: KillSwitch[],
    targetScope: 'USER' | 'AGENT' | 'TOKEN',
    targetId: string
  ): boolean {
    for (const ks of activeSwitches) {
      if (!ks.isActive) continue;
      if (ks.scope === 'GLOBAL') return true;
      if (ks.scope === targetScope && ks.targetId === targetId) return true;
    }
    return false;
  }
}
