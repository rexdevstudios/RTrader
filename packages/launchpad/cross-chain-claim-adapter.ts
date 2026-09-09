// ============================================================================
// LAYERZERO V2 CROSS-CHAIN CLAIM ADAPTER
// ============================================================================

import { ethers } from 'ethers';
import { CcipBridgeQuote } from '../shared/types/domain';

export const LAYERZERO_ENDPOINT_IDS = {
  BASE_MAINNET: 30184,
  ARBITRUM_ONE: 30110,
  OPTIMISM_MAINNET: 30111,
  POLYGON_MAINNET: 30109,
} as const;

export const CHAINLINK_CCIP_SELECTORS = {
  BASE_MAINNET: '15971525489660198786',
  ARBITRUM_ONE: '4949039107694359620',
  OPTIMISM_MAINNET: '5224473277236331295',
  POLYGON_MAINNET: '4051577828743386545',
} as const;

export type SupportedDestinationChain = keyof typeof LAYERZERO_ENDPOINT_IDS;
export type SupportedCcipDestinationChain = keyof typeof CHAINLINK_CCIP_SELECTORS;

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

  static getCcipChainName(selector: string): string {
    switch (selector) {
      case CHAINLINK_CCIP_SELECTORS.BASE_MAINNET:
        return 'Base Mainnet';
      case CHAINLINK_CCIP_SELECTORS.ARBITRUM_ONE:
        return 'Arbitrum One';
      case CHAINLINK_CCIP_SELECTORS.OPTIMISM_MAINNET:
        return 'Optimism Mainnet';
      case CHAINLINK_CCIP_SELECTORS.POLYGON_MAINNET:
        return 'Polygon PoS';
      default:
        return `CCIP Chain (${selector})`;
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

  /**
   * Encodes standard Chainlink CCIP Any2EVMMessage payload
   */
  static encodeCcipBridgeMessage(
    recipient: string,
    tokenAddress: string,
    amountWei: bigint,
    destinationChainSelector: string
  ): string {
    if (!ethers.isAddress(recipient)) {
      throw new Error(`INVALID_RECIPIENT_ADDRESS: ${recipient}`);
    }
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`INVALID_TOKEN_ADDRESS: ${tokenAddress}`);
    }
    if (!Object.values(CHAINLINK_CCIP_SELECTORS).includes(destinationChainSelector as any)) {
      throw new Error(`UNSUPPORTED_CCIP_CHAIN_SELECTOR: ${destinationChainSelector}`);
    }

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    // Encode Any2EVMMessage format: (address receiver, address token, uint256 amount, uint64 chainSelector)
    return abiCoder.encode(
      ['address', 'address', 'uint256', 'uint64'],
      [ethers.getAddress(recipient), ethers.getAddress(tokenAddress), amountWei, BigInt(destinationChainSelector)]
    );
  }

  /**
   * Stateless estimation of Chainlink CCIP cross-chain yield bridge fee
   */
  static estimateCcipBridgeFee(
    destinationChainSelector: string,
    amountWei: bigint,
    recipient: string = '0x1111111111111111111111111111111111111111',
    tokenAddress: string = '0x2222222222222222222222222222222222222222'
  ): CcipBridgeQuote {
    const chainName = CrossChainClaimAdapter.getCcipChainName(destinationChainSelector);
    // CCIP base messaging + token transfer fee: ~0.00065 ETH on L2
    const baseCcipFeeWei = 650000000000000n; // 0.00065 ETH

    const encodedMessage = CrossChainClaimAdapter.encodeCcipBridgeMessage(
      recipient,
      tokenAddress,
      amountWei,
      destinationChainSelector
    );

    return {
      destinationChainSelector,
      chainName,
      recipientAddress: ethers.getAddress(recipient),
      tokenAddress: ethers.getAddress(tokenAddress),
      amountWei: amountWei.toString(),
      estimatedFeeEth: ethers.formatEther(baseCcipFeeWei),
      encodedMessage,
    };
  }
}

