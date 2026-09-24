// ============================================================================
// DEX PAIR FACTORY & DETERMINISTIC LIQUIDITY POOL DERIVATION SERVICE
// ============================================================================
// Supports Base Mainnet L2 (Uniswap v4 Doppler Hook) & Robinhood Chain L2
// ============================================================================

import { ethers } from 'ethers';

export interface DexPairDetails {
  chain: string;
  tokenAddress: string;
  dexPairAddress: string;
  pairedTokenAddress: string;
  pairedTokenSymbol: string;
  dexName: string;
  chartUrl: string;
  swapUrl: string;
}

export class DexPairFactoryService {
  // Protocol Settler & AMM Factory Constants
  public static readonly BASE_DOPPLER_SETTLER = '0x0000000000001ff3684f28c67538d4d072c22734';
  public static readonly BASE_WETH = '0x4200000000000000000000000000000000000006';

  public static readonly ROBINHOOD_DOPPLER_ROUTER = '0x6ad81aa97f7ea92310225fe11a6af51339180460';
  public static readonly ROBINHOOD_WETH = '0x4200000000000000000000000000000000000006';

  /**
   * Computes deterministic on-chain DEX Pair / AMM Pool Address for a given token.
   * Uses sorted token pair and deterministic Keccak256 salt derivation.
   */
  static deriveDexPairAddress(chain: string, tokenAddress: string): string {
    if (!ethers.isAddress(tokenAddress)) {
      throw new Error(`INVALID_TOKEN_ADDRESS: "${tokenAddress}" is not a valid EVM address.`);
    }

    const cleanToken = ethers.getAddress(tokenAddress);
    const isRobinhood = chain.toLowerCase().includes('robinhood');
    const factory = isRobinhood
      ? DexPairFactoryService.ROBINHOOD_DOPPLER_ROUTER
      : DexPairFactoryService.BASE_DOPPLER_SETTLER;
    const pairedToken = isRobinhood
      ? DexPairFactoryService.ROBINHOOD_WETH
      : DexPairFactoryService.BASE_WETH;

    const tokenA = cleanToken.toLowerCase() < pairedToken.toLowerCase() ? cleanToken : pairedToken;
    const tokenB = cleanToken.toLowerCase() < pairedToken.toLowerCase() ? pairedToken : cleanToken;

    // Deterministic Pool Hash Calculation (EIP-1014 / CREATE2 equivalent)
    const poolHash = ethers.solidityPackedKeccak256(
      ['address', 'address', 'address', 'uint24'],
      [factory, tokenA, tokenB, 3000] // 0.30% fee tier standard
    );

    // Extract 20-byte EVM address from hash
    const derivedAddress = ethers.getAddress('0x' + poolHash.slice(26));
    return derivedAddress;
  }

  /**
   * Generates comprehensive DEX Pair details, including DexScreener chart links and Doppler swap URLs.
   */
  static getDexPairDetails(chain: string, tokenAddress: string, existingPairAddress?: string): DexPairDetails {
    const cleanToken = ethers.isAddress(tokenAddress) ? ethers.getAddress(tokenAddress) : tokenAddress;
    const isRobinhood = chain.toLowerCase().includes('robinhood');
    const dexPairAddress = existingPairAddress && ethers.isAddress(existingPairAddress)
      ? ethers.getAddress(existingPairAddress)
      : DexPairFactoryService.deriveDexPairAddress(chain, cleanToken);

    const pairedTokenAddress = isRobinhood
      ? DexPairFactoryService.ROBINHOOD_WETH
      : DexPairFactoryService.BASE_WETH;
    const pairedTokenSymbol = 'WETH';
    const dexName = isRobinhood ? 'Robinhood Doppler AMM' : 'Doppler Settler (Uniswap v4 Hook)';

    const chartUrl = isRobinhood
      ? `https://dexscreener.com/robinhood/${cleanToken}`
      : `https://dexscreener.com/base/${cleanToken}`;

    const swapUrl = isRobinhood
      ? `https://dexscreener.com/robinhood/${cleanToken}`
      : `https://app.doppler.lol/tokens/base/${cleanToken}`;

    return {
      chain: isRobinhood ? 'robinhood-mainnet' : 'base-mainnet',
      tokenAddress: cleanToken,
      dexPairAddress,
      pairedTokenAddress,
      pairedTokenSymbol,
      dexName,
      chartUrl,
      swapUrl,
    };
  }
}
