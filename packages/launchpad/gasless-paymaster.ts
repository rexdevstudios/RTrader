// ============================================================================
// ERC-4337 GASLESS PAYMASTER SERVICE (BICONOMY & ZERODEV COMPLIANT)
// ============================================================================

import { ethers } from 'ethers';
import { PaymasterSponsorshipQuote } from '../shared/types/domain';

export interface PaymasterConfig {
  signerPrivateKey?: string;
  sponsorAddress?: string;
  defaultChainId?: number;
  maxSponsorshipPerDay?: number;
}

export class GaslessPaymasterService {
  private signer: ethers.Wallet;
  private defaultChainId: number;

  constructor(config: PaymasterConfig = {}) {
    this.defaultChainId = config.defaultChainId || 8453; // Base Mainnet default
    if (config.signerPrivateKey) {
      this.signer = new ethers.Wallet(config.signerPrivateKey);
    } else {
      // Deterministic fallback mock signer for dev / testing / simulation
      this.signer = new ethers.Wallet('0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d');
    }
  }

  getSponsorAddress(): string {
    return this.signer.address;
  }

  static computeSponsorshipHash(
    tokenAddress: string,
    kolWallet: string,
    tokenAmount: bigint,
    deadline: number,
    chainId: number
  ): string {
    if (!ethers.isAddress(tokenAddress)) throw new Error(`INVALID_TOKEN_ADDRESS: ${tokenAddress}`);
    if (!ethers.isAddress(kolWallet)) throw new Error(`INVALID_KOL_WALLET: ${kolWallet}`);

    return ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256', 'uint256', 'uint256'],
      [
        ethers.getAddress(tokenAddress),
        ethers.getAddress(kolWallet),
        tokenAmount,
        deadline,
        chainId,
      ]
    );
  }

  async signSponsorship(
    tokenAddress: string,
    kolWallet: string,
    tokenAmount: bigint,
    validitySeconds: number = 3600,
    chainId?: number
  ): Promise<PaymasterSponsorshipQuote> {
    const targetChainId = chainId || this.defaultChainId;
    const deadline = Math.floor(Date.now() / 1000) + validitySeconds;

    const hash = GaslessPaymasterService.computeSponsorshipHash(
      tokenAddress,
      kolWallet,
      tokenAmount,
      deadline,
      targetChainId
    );

    // Sign message with Ethereum Signed Message prefix (matching ECDSA.toEthSignedMessageHash in Solidity)
    const signature = await this.signer.signMessage(ethers.getBytes(hash));

    return {
      sponsorAddress: this.signer.address,
      sponsoredTxType: 'BOUNTY_CLAIM',
      kolWallet: ethers.getAddress(kolWallet),
      tokenAddress: ethers.getAddress(tokenAddress),
      tokenAmount: tokenAmount.toString(),
      deadline,
      chainId: targetChainId,
      signature,
    };
  }

  verifySignature(quote: PaymasterSponsorshipQuote): boolean {
    try {
      const hash = GaslessPaymasterService.computeSponsorshipHash(
        quote.tokenAddress,
        quote.kolWallet,
        BigInt(quote.tokenAmount),
        quote.deadline,
        quote.chainId
      );
      const recovered = ethers.verifyMessage(ethers.getBytes(hash), quote.signature);
      return recovered.toLowerCase() === this.signer.address.toLowerCase();
    } catch {
      return false;
    }
  }
}
