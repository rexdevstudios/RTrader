// ============================================================================
// DYNAMIC SLIPPAGE & ANTI-MEV PROTECTION ENGINE (UNISWAP V3 GRADUATION)
// ============================================================================

import { ethers } from 'ethers';
import { MevProtectionQuote } from '../shared/types/domain';

export class MevProtectionService {
  public static readonly MAX_ALLOWED_GRADUATION_SLIPPAGE_BPS = 150; // 1.5% hard cap
  public static readonly BASE_MEV_BLOCKER_RPC = 'https://base.mevblocker.io';
  public static readonly FLASHBOTS_PROTECT_RPC = 'https://rpc.flashbots.net?fast=true';

  /**
   * Evaluasi slippage dinamis dan tentukan RPC anti-MEV privat
   */
  static evaluateGraduationSlippage(
    tokenAddress: string,
    liquidityWei: bigint = 24n * 10n ** 18n,
    chainId: number = 8453 // Base default
  ): MevProtectionQuote {
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`INVALID_TOKEN_ADDRESS: ${tokenAddress}`);
    }

    if (liquidityWei <= 0n) {
      throw new Error('INVALID_LIQUIDITY_AMOUNT: Must be positive');
    }

    const liquidityEth = Number(ethers.formatEther(liquidityWei));
    let calculatedSlippageBps = 50; // 0.5% default

    if (liquidityEth > 20) {
      calculatedSlippageBps = 150; // 1.5% cap for full graduation liquidity
    } else if (liquidityEth > 5) {
      calculatedSlippageBps = 100; // 1.0%
    }

    const recommendedRpc =
      chainId === 8453
        ? MevProtectionService.BASE_MEV_BLOCKER_RPC
        : MevProtectionService.FLASHBOTS_PROTECT_RPC;

    return {
      tokenAddress: ethers.getAddress(tokenAddress),
      liquidityWei,
      recommendedRpc,
      maxSlippageBps: calculatedSlippageBps,
      isProtected: calculatedSlippageBps <= MevProtectionService.MAX_ALLOWED_GRADUATION_SLIPPAGE_BPS,
    };
  }

  /**
   * Verifikasi keamanan eksekusi migrasi likuiditas
   */
  static verifyMevProtection(quote: MevProtectionQuote): {
    isSafe: boolean;
    reason?: string;
  } {
    if (quote.maxSlippageBps > MevProtectionService.MAX_ALLOWED_GRADUATION_SLIPPAGE_BPS) {
      return {
        isSafe: false,
        reason: `EXCESSIVE_SLIPPAGE: Slippage ${quote.maxSlippageBps} bps exceeds MEV protection limit (150 bps)`,
      };
    }

    if (!quote.recommendedRpc.includes('mev') && !quote.recommendedRpc.includes('flashbots')) {
      return {
        isSafe: false,
        reason: 'UNPROTECTED_RPC: Public mempool RPC poses sandwich attack risk',
      };
    }

    return { isSafe: true };
  }
}
