/**
 * src/modules/arc/tolly-adapter.ts
 *
 * Implementation of the Tolly DEX & Launchpad Adapter on Arc Mainnet (Chain ID 5042).
 * Verifies Tolly API health, queries Tolly Pad status, and inspects $TOLLY platform token.
 */

import {
  formatUnits,
  type PublicClient,
  type Address,
} from "viem";
import {
  TOLLY_PAD_ADDRESS,
  TOLLY_TOKEN_ADDRESS,
  TOLLY_API_BASE,
  ERC20_ABI,
  type TollyHealthStatus,
  type TollyTokenInfo,
} from "./types.ts";
import { logger } from "../../logger.ts";

export class TollyAdapter {
  /**
   * Fetches health status and active pad address from Tolly's backend API.
   */
  public static async getHealth(): Promise<TollyHealthStatus> {
    const url = `${TOLLY_API_BASE}/health`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `Tolly API health check failed: HTTP ${response.status} - ${await response.text()}`
      );
    }

    return (await response.json()) as TollyHealthStatus;
  }

  /**
   * Reads on-chain metadata and total supply for the $TOLLY platform token.
   */
  public static async getTollyTokenInfo(
    publicClient: PublicClient,
    tokenAddress: Address = TOLLY_TOKEN_ADDRESS
  ): Promise<TollyTokenInfo> {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "name",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "totalSupply",
      }),
    ]);

    return {
      address: tokenAddress,
      name,
      symbol,
      decimals,
      totalSupply,
      formattedSupply: formatUnits(totalSupply, decimals),
    };
  }

  /**
   * Fetches $TOLLY token balance for a specified wallet account.
   */
  public static async getTollyBalance(
    publicClient: PublicClient,
    walletAddress: Address,
    tokenAddress: Address = TOLLY_TOKEN_ADDRESS
  ): Promise<{ raw: bigint; formatted: string }> {
    const [balance, decimals] = await Promise.all([
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [walletAddress],
      }),
      publicClient.readContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);

    return {
      raw: balance,
      formatted: formatUnits(balance, decimals),
    };
  }
}
