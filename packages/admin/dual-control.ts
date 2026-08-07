export type DualControlActionType =
  | 'OVERRIDE_RISK'
  | 'UPDATE_RPC'
  | 'REFUND_USER'
  | 'CHANGE_FEE'
  | 'FREEZE_TOKEN'
  | 'FREEZE_ACCOUNT';

export interface DualControlRequestRecord {
  id: string;
  actionType: DualControlActionType;
  requestedBy: string;
  approvedBy?: string;
  payload: Record<string, unknown>;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
}

export interface DualControlDbAdapter {
  createRequest(request: Omit<DualControlRequestRecord, 'id'>): Promise<string>;
  getRequestById(id: string): Promise<DualControlRequestRecord | null>;
  updateRequestStatus(id: string, status: string, approvedBy?: string): Promise<void>;
  createAuditLog(entry: {
    actorId: string;
    action: string;
    entityId?: string;
    payloadBefore?: unknown;
    payloadAfter?: unknown;
    reason?: string;
  }): Promise<void>;
}

export class DualControlManager {
  private static readonly DEFAULT_EXPIRY_HOURS = 24;

  /**
   * Inisiasi Request Aksi Dual-Control (Oleh Admin Pertama)
   */
  static async requestAction(
    actionType: DualControlActionType,
    requesterId: string,
    payload: Record<string, unknown>,
    reason: string,
    db: DualControlDbAdapter
  ): Promise<DualControlRequestRecord> {
    const expiresAt = new Date(Date.now() + this.DEFAULT_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    const record: Omit<DualControlRequestRecord, 'id'> = {
      actionType,
      requestedBy: requesterId,
      payload,
      reason,
      status: 'PENDING',
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    const id = await db.createRequest(record);

    // Audit Trail
    await db.createAuditLog({
      actorId: requesterId,
      action: `DUAL_CONTROL_REQUESTED_${actionType}`,
      entityId: id,
      payloadAfter: payload,
      reason: `Dual-control approval requested: ${reason}`,
    });

    return { id, ...record };
  }

  /**
   * Persetujuan Aksi Dual-Control (Wajib Oleh Admin Kedua yang Berbeda)
   */
  static async approveAction(
    requestId: string,
    approverId: string,
    db: DualControlDbAdapter
  ): Promise<DualControlRequestRecord> {
    const request = await db.getRequestById(requestId);
    if (!request) {
      throw new Error(`DUAL_CONTROL_NOT_FOUND: Request ${requestId} does not exist`);
    }

    // Guard 1: Pembatasan Admin Diri Sendiri (Self-Approval Prohibited)
    if (request.requestedBy === approverId) {
      throw new Error(`DUAL_CONTROL_SELF_APPROVAL_FORBIDDEN: Admin ${approverId} cannot approve their own dual-control request`);
    }

    // Guard 2: Status Check
    if (request.status !== 'PENDING') {
      throw new Error(`DUAL_CONTROL_INVALID_STATE: Request ${requestId} is in status ${request.status}`);
    }

    // Guard 3: Expiry Check
    if (new Date() > new Date(request.expiresAt)) {
      await db.updateRequestStatus(requestId, 'EXPIRED');
      throw new Error(`DUAL_CONTROL_EXPIRED: Request ${requestId} has expired`);
    }

    // Update Status -> APPROVED
    await db.updateRequestStatus(requestId, 'APPROVED', approverId);

    // Audit Trail
    await db.createAuditLog({
      actorId: approverId,
      action: `DUAL_CONTROL_APPROVED_${request.actionType}`,
      entityId: requestId,
      payloadBefore: { requestedBy: request.requestedBy },
      payloadAfter: { approvedBy: approverId, payload: request.payload },
      reason: `Dual-control action approved by secondary admin`,
    });

    return { ...request, status: 'APPROVED', approvedBy: approverId };
  }
}
