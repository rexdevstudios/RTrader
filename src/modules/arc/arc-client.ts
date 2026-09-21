/**
 * src/modules/arc/arc-client.ts
 *
 * Viem client factories and conversion utilities for Arc Chain (5042).
 * Operates in non-custodial mode; private keys are transiently loaded into viem account.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type PublicClient,
  type WalletClient,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcMainnet } from "./arc-chain-definition.ts";
import {
  ARC_RPC_DEFAULT,
  ARC_NATIVE_DECIMALS,
  ARC_USDC_FACADE_DECIMALS,
} from "./types.ts";

/**
 * Creates an isolated PublicClient for Arc Mainnet.
 */
export function getArcPublicClient(rpcUrl: string = ARC_RPC_DEFAULT): PublicClient {
  return createPublicClient({
    chain: arcMainnet,
    transport: http(rpcUrl, {
      timeout: 15_000,
      retryCount: 3,
      retryDelay: 1_000,
    }),
  });
}

/**
 * Creates an isolated WalletClient for signing and broadcasting transactions on Arc.
 */
export function getArcWalletClient(
  privateKey: Hex,
  rpcUrl: string = ARC_RPC_DEFAULT
): WalletClient {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: arcMainnet,
    transport: http(rpcUrl, {
      timeout: 25_000,
      retryCount: 2,
      retryDelay: 1_500,
    }),
  });
}

/**
 * Converts native USDC quantity (e.g., 1.5 USDC) to 18-decimal wei representation
 * used by Arc L1 for msg.value and native gas payments.
 */
export function nativeUsdcToWei(usdcAmount: string | number): bigint {
  const str = typeof usdcAmount === "number" ? usdcAmount.toString() : usdcAmount;
  return parseUnits(str, ARC_NATIVE_DECIMALS);
}

/**
 * Formats 18-decimal wei native USDC into human-readable string.
 */
export function weiToNativeUsdc(weiAmount: bigint): string {
  return formatUnits(weiAmount, ARC_NATIVE_DECIMALS);
}

/**
 * Converts USDC quantity to 6-decimal raw representation
 * used by the ERC-20 facade contract (0x3600...0000) on Uniswap V3.
 */
export function facadeUsdcToRaw(usdcAmount: string | number): bigint {
  const str = typeof usdcAmount === "number" ? usdcAmount.toString() : usdcAmount;
  return parseUnits(str, ARC_USDC_FACADE_DECIMALS);
}

/**
 * Formats 6-decimal ERC-20 facade USDC into human-readable string.
 */
export function rawToFacadeUsdc(rawAmount: bigint): string {
  return formatUnits(rawAmount, ARC_USDC_FACADE_DECIMALS);
}

/**
 * Fetches the native USDC balance of an address on Arc Chain.
 */
export async function getArcNativeBalance(
  publicClient: PublicClient,
  address: Address
): Promise<{ wei: bigint; usdc: string; numeric: number }> {
  const balanceWei = await publicClient.getBalance({ address });
  const usdcString = weiToNativeUsdc(balanceWei);
  return {
    wei: balanceWei,
    usdc: usdcString,
    numeric: parseFloat(usdcString),
  };
}
