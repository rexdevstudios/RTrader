import { Role } from '../shared/types/domain';

export type Capability =
  | 'VIEW_TOKENS'
  | 'CONNECT_WALLET'
  | 'CREATE_LAUNCH_DRAFT'
  | 'PUBLISH_LAUNCH'
  | 'TRADE_MANUALLY'
  | 'ENABLE_LIVE_AGENT'
  | 'REVIEW_FLAGGED_TOKEN'
  | 'FREEZE_TOKEN'
  | 'MANAGE_BILLING_PLANS'
  | 'OVERRIDE_RISK_ENGINE';

const RBAC_MATRIX: Record<Capability, Role[]> = {
  VIEW_TOKENS: [
    'SUPER_ADMIN', 'SYSTEM_ADMIN', 'RISK_ADMIN', 'LAUNCH_ADMIN',
    'BILLING_ADMIN', 'MODERATOR', 'TRADER', 'CREATOR'
  ],
  CONNECT_WALLET: [
    'SUPER_ADMIN', 'SYSTEM_ADMIN', 'RISK_ADMIN', 'LAUNCH_ADMIN',
    'BILLING_ADMIN', 'MODERATOR', 'TRADER', 'CREATOR'
  ],
  CREATE_LAUNCH_DRAFT: ['SUPER_ADMIN', 'LAUNCH_ADMIN', 'CREATOR', 'TRADER'],
  PUBLISH_LAUNCH: ['SUPER_ADMIN', 'LAUNCH_ADMIN', 'CREATOR'],
  TRADE_MANUALLY: ['SUPER_ADMIN', 'TRADER', 'CREATOR'],
  ENABLE_LIVE_AGENT: ['SUPER_ADMIN', 'TRADER'],
  REVIEW_FLAGGED_TOKEN: ['SUPER_ADMIN', 'MODERATOR', 'RISK_ADMIN'],
  FREEZE_TOKEN: ['SUPER_ADMIN', 'MODERATOR', 'RISK_ADMIN'],
  MANAGE_BILLING_PLANS: ['SUPER_ADMIN', 'BILLING_ADMIN'],
  OVERRIDE_RISK_ENGINE: ['SUPER_ADMIN'], // Requires Dual Control Break-Glass!
};

export interface UserContext {
  userId: string;
  roles: Role[];
  status: 'ACTIVE' | 'SUSPENDED' | 'FROZEN';
}

export class RbacGuard {
  /**
   * Memeriksa apakah user memiliki peran yang diizinkan untuk kapabilitas tertentu.
   */
  static authorize(user: UserContext, capability: Capability): void {
    if (user.status !== 'ACTIVE') {
      throw new Error(`AUTH_ACCOUNT_${user.status}: User account is ${user.status}. Access denied.`);
    }

    const allowedRoles = RBAC_MATRIX[capability];
    if (!allowedRoles) {
      throw new Error(`RBAC_UNKNOWN_CAPABILITY: Capability ${capability} is not defined in RBAC Matrix.`);
    }

    const hasPermission = user.roles.some((role) => allowedRoles.includes(role));

    if (!hasPermission) {
      throw new Error(
        `RBAC_FORBIDDEN: User ${user.userId} with roles [${user.roles.join(', ')}] lacks capability ${capability}`
      );
    }
  }

  /**
   * Memeriksa apakah suatu aksi membutuhkan Dual-Control (Multi-Admin approval)
   */
  static requiresDualControl(capability: Capability): boolean {
    return capability === 'OVERRIDE_RISK_ENGINE' || capability === 'MANAGE_BILLING_PLANS';
  }
}
