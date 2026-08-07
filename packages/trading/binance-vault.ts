import * as crypto from 'crypto';
import { BinanceKeyPermissions, validateBinancePermissions } from '../shared/types/domain';

export interface EncryptedPayload {
  encryptedData: string;
  iv: string;
  authTag: string;
}

export interface AuditAdapter {
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class BinanceCredentialVault {
  private static readonly ALGORITHM = 'aes-256-gcm';

  /**
   * Enkripsi API Key / Secret Key menggunakan AES-256-GCM
   */
  static encrypt(text: string, masterKeyHex: string): EncryptedPayload {
    const key = Buffer.from(masterKeyHex, 'hex');
    if (key.length !== 32) {
      throw new Error('VAULT_INVALID_MASTER_KEY: Master key must be 32 bytes (64 hex chars)');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    return {
      encryptedData: encrypted,
      iv: iv.toString('hex'),
      authTag,
    };
  }

  /**
   * Dekripsi API Key / Secret Key terenkripsi dengan Audit Trail Mandatori
   */
  static async decrypt(
    payload: EncryptedPayload,
    masterKeyHex: string,
    actorId: string,
    credentialId: string,
    auditDb?: AuditAdapter
  ): Promise<string> {
    // 1. Mandatory Audit Logging
    if (auditDb) {
      await auditDb.createAuditLog(
        actorId,
        'BINANCE_CREDENTIAL_DECRYPT',
        credentialId,
        'Decrypted Binance API Credential for trading execution worker'
      );
    }

    const key = Buffer.from(masterKeyHex, 'hex');
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');

    const decipher = crypto.createDecipheriv(this.ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(payload.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Validasi Keamanan Kunci Binance: Wajib ditolak jika `enableWithdrawals = true`
   */
  static validatePermissions(perms: BinanceKeyPermissions): void {
    validateBinancePermissions(perms);
  }
}
