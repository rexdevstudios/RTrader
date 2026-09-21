// ============================================================================
// TOKEN IDENTIFIER NORMALIZER & MULTI-CHAIN DISCRIMINATOR
// ============================================================================

import { ethers } from 'ethers';

export type SupportedChainId =
  | 'base'
  | 'ethereum'
  | 'solana'
  | 'robinhood'
  | 'arc'
  | 'clanker'
  | 'arbitrum'
  | 'bsc';

export interface NormalizedTokenIdentifier {
  chain: SupportedChainId;
  rawAddress: string;
  isSolana: boolean;
  isEvm: boolean;
  contractAddress: string; // Uniform alias for backward compatibility
  mintAddress?: string;     // Explicit Solana SPL Mint address
  isValid: boolean;
  validationError?: string;
}

/**
 * Normalizes chain alias strings into standardized SupportedChainId.
 */
export function normalizeChainName(chain?: string): SupportedChainId {
  if (!chain) return 'base';
  const c = chain.trim().toLowerCase();
  if (c === 'sol' || c === 'solana' || c === '101') return 'solana';
  if (c === 'eth' || c === 'ethereum' || c === '1') return 'ethereum';
  if (c === 'base' || c === '8453') return 'base';
  if (c === 'rh' || c === 'robinhood' || c === '46688' || c === '4663') return 'robinhood';
  if (c === 'arc' || c === '5042') return 'arc';
  if (c === 'clanker') return 'clanker';
  if (c === 'arb' || c === 'arbitrum' || c === '42161') return 'arbitrum';
  if (c === 'bsc' || c === 'binance' || c === '56') return 'bsc';
  return 'base';
}

/**
 * Validates whether a string matches Solana Base58 public key format.
 * (32 to 44 characters, valid Base58 alphabet, no 0x prefix).
 */
export function isSolanaBase58Address(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  const clean = addr.trim();
  if (clean.startsWith('0x') || clean.startsWith('0X')) return false;
  // Solana Base58 regex
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
}

/**
 * Pure function to safely parse, validate, and normalize token identifiers
 * across EVM (contractAddress) and Solana (mintAddress).
 */
export function normalizeTokenIdentifier(
  chainInput: string,
  addressOrMint: string
): NormalizedTokenIdentifier {
  const chain = normalizeChainName(chainInput);
  const rawAddress = (addressOrMint || '').trim();
  const isSolana = chain === 'solana';

  if (!rawAddress) {
    return {
      chain,
      rawAddress,
      isSolana,
      isEvm: !isSolana,
      contractAddress: '',
      isValid: false,
      validationError: 'Address or Mint parameter is missing or empty.',
    };
  }

  if (isSolana) {
    const valid = isSolanaBase58Address(rawAddress);
    return {
      chain: 'solana',
      rawAddress,
      isSolana: true,
      isEvm: false,
      contractAddress: rawAddress, // Kept for 100% backward compatibility
      mintAddress: valid ? rawAddress : undefined,
      isValid: valid,
      validationError: valid
        ? undefined
        : `INVALID_SOLANA_MINT: "${rawAddress}" is not a valid Solana Base58 address (must be 32-44 characters without '0x' prefix).`,
    };
  }

  // EVM chains (base, ethereum, robinhood, arc, clanker, etc.)
  const valid = ethers.isAddress(rawAddress);
  const checksummed = valid ? ethers.getAddress(rawAddress) : rawAddress;

  return {
    chain,
    rawAddress,
    isSolana: false,
    isEvm: true,
    contractAddress: checksummed,
    isValid: valid,
    validationError: valid
      ? undefined
      : `INVALID_EVM_CONTRACT_ADDRESS: "${rawAddress}" is not a valid 20-byte hex address for chain ${chain}.`,
  };
}
