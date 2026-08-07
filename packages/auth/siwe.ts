import { ethers } from 'ethers';

export interface SiweChallenge {
  nonce: string;
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  issuedAt: string;
  expirationTime: string;
}

export interface SessionPayload {
  userId: string;
  walletAddress: string;
  roles: string[];
  chainType: 'EVM' | 'SOLANA';
  iat: number;
  exp: number;
}

export class SiweAuthService {
  private static readonly STATEMENT = 'Sign in to Degen Launchpad & Trading Terminal Platform';

  /**
   * Generasi Nonce & Challenge Message untuk SIWE Login
   */
  static generateChallenge(
    domain: string,
    walletAddress: string,
    uri: string,
    chainId: number = 8453 // Default Base Mainnet
  ): { challenge: SiweChallenge; messageText: string } {
    const nonce = ethers.hexlify(ethers.randomBytes(16)).substring(2);
    const issuedAt = new Date().toISOString();
    const expirationTime = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 menit expiry

    const normalizedAddress = ethers.getAddress(walletAddress);

    const challenge: SiweChallenge = {
      nonce,
      domain,
      address: normalizedAddress,
      statement: this.STATEMENT,
      uri,
      version: '1',
      chainId,
      issuedAt,
      expirationTime,
    };

    const messageText = `${domain} wants you to sign in with your Ethereum account:\n` +
      `${normalizedAddress}\n\n` +
      `${this.STATEMENT}\n\n` +
      `URI: ${uri}\n` +
      `Version: 1\n` +
      `Chain ID: ${chainId}\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}\n` +
      `Expiration Time: ${expirationTime}`;

    return { challenge, messageText };
  }

  /**
   * Verifikasi ECDSA Signature SIWE dari Wallet User
   */
  static verifySignature(
    messageText: string,
    signature: string,
    expectedAddress: string
  ): boolean {
    try {
      const recoveredAddress = ethers.verifyMessage(messageText, signature);
      return ethers.getAddress(recoveredAddress) === ethers.getAddress(expectedAddress);
    } catch (err) {
      console.error('[SIWE Auth Error] Signature verification failed:', err);
      return false;
    }
  }
}
