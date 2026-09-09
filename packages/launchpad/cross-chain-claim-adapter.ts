// ============================================================================
// LAYERZERO V2 CROSS-CHAIN CLAIM ADAPTER
// ============================================================================

import { ethers } from 'ethers';

export const LAYERZERO_ENDPOINT_IDS = {
  BASE_MAINNET: 30184,
  ARBITRUM_ONE: 30110,
  OPTIMISM_MAINNET: 30111,
  POLYGON_MAINNET: 30109,
} as const;

export type SupportedDestinationChain = keyof typeof LAYERZERO_ENDPOINT_IDS;

export interface CrossChainQuoteResult {
  dstEid: number;
  chainName: string;
  nativeFeeWei: string;
  lzTokenFeeWei: string;
  estimatedFeeEth: string;
  encodedPayload: string;
}

export class CrossChainClaimAdapter {
  static getChainName(dstEid: number): string {
    switch (dstEid) {
      case LAYERZERO_ENDPOINT_IDS.BASE_MAINNET:
        return 'Base Mainnet';
      case LAYERZERO_ENDPOINT_IDS.ARBITRUM_ONE:
        return 'Arbitrum One';
      case LAYERZERO_ENDPOINT_IDS.OPTIMISM_MAINNET:
        return 'Optimism Mainnet';
      case LAYERZERO_ENDPOINT_IDS.POLYGON_MAINNET:
        return 'Polygon PoS';
      default:
        return `EVM Chain (EID: ${dstEid})`;
    }
  }

  /**
   * Encodes standard LayerZero v2 claim message payload
   */
  static encodeCrossChainPayload(
    kolWallet: string,
    tokenAddress: string,
    tokenAmount: bigint
  ): string {
    if (!ethers.isAddress(kolWallet)) {
      throw new Error(`INVALID_KOL_WALLET: ${kolWallet}`);
    }
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`INVALID_TOKEN_ADDRESS: ${tokenAddress}`);
    }

    const recipientBytes32 = ethers.zeroPadValue(ethers.getAddress(kolWallet), 32);
    const tokenBytes32 = ethers.zeroPadValue(ethers.getAddress(tokenAddress), 32);

    // ABI-encode: (bytes32 recipient, bytes32 token, uint256 amount)
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    return abiCoder.encode(['bytes32', 'bytes32', 'uint256'], [recipientBytes32, tokenBytes32, tokenAmount]);
  }

  /**
   * Stateless estimation of LayerZero cross-chain message verification & execution fee
   */
  static estimateCrossChainFee(dstEid: number, tokenAmount: bigint): CrossChainQuoteResult {
    const chainName = CrossChainClaimAdapter.getChainName(dstEid);

    // Standard cross-chain base fee ~0.0008 ETH for LayerZero message dispatching
    const baseFeeWei = 800000000000000n; // 0.0008 ETH
    const encodedPayload = CrossChainClaimAdapter.encodeCrossChainPayload(
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      tokenAmount
    );

    return {
      dstEid,
      chainName,
      nativeFeeWei: baseFeeWei.toString(),
      lzTokenFeeWei: '0',
      estimatedFeeEth: ethers.formatEther(baseFeeWei),
      encodedPayload,
    };
  }
}
