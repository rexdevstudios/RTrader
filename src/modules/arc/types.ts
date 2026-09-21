/**
 * src/modules/arc/types.ts
 *
 * Core type definitions, interfaces, ABIs, and network constants for the Arc Chain
 * (Circle L1, Chain ID 5042) ecosystem, specifically targeting ArcPad and Tolly DEX.
 */

import type { Address, Hash, Hex } from "viem";

// ─── Network Constants ──────────────────────────────────────────────────────────

export const ARC_CHAIN_ID = 5042;
export const ARC_CHAIN_NAME = "Arc Mainnet";
export const ARC_RPC_DEFAULT = "https://rpc.mainnet.arc.io";
export const ARC_EXPLORER_DEFAULT = "https://arcscan.app";
export const ARC_EXPLORER_ALT = "https://explorer.arc.io";

/**
 * Dual-interface USDC representation on Arc Chain:
 * 1. Native Gas / msg.value: 18 decimals (1 USDC = 10^18 wei)
 * 2. Facade ERC-20 contract (quote token in Uniswap V3 pools): 6 decimals (1 USDC = 10^6 units)
 */
export const ARC_NATIVE_DECIMALS = 18;
export const ARC_USDC_FACADE_DECIMALS = 6;
export const ARC_USDC_FACADE_ADDRESS: Address =
  "0x3600000000000000000000000000000000000000";

// ─── Contract Addresses (Verified on Arc Mainnet) ──────────────────────────────

/** ArcPad Primary Launcher: creates token, seeds Uniswap V3 pool, locks LP */
export const ARC_CURVE_PAD_ADDRESS: Address =
  "0x24196CD6e534cfCE8F480B53E70809b68Ea86F29";

/** ArcPad Token Factory */
export const ARC_TOKEN_FACTORY_ADDRESS: Address =
  "0x48EecE92e20f3431B00FD5Bc49D94aBe058E7E8f";

/** ArcPad Permanent LP Fee Locker */
export const ARC_FEE_LOCKER_ADDRESS: Address =
  "0x69A615DD32B89fE40D87b2e3123baE4162f2d450";

/** Canonical Uniswap V3 Factory on Arc */
export const UNISWAP_V3_FACTORY_ADDRESS: Address =
  "0xf0db7b58379503491d857dB50AC9ece64c653918";

/** Canonical Uniswap V3 NonfungiblePositionManager */
export const UNISWAP_V3_POSITION_MGR_ADDRESS: Address =
  "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377";

/** Canonical Uniswap V3 SwapRouter02 */
export const UNISWAP_V3_ROUTER_ADDRESS: Address =
  "0x53bf6b0684ec7ef91e1387da3d1a1769bc5a6f77";

/** Canonical Uniswap V3 QuoterV2 */
export const UNISWAP_V3_QUOTER_ADDRESS: Address =
  "0x7dfd4f31be6814d2906bde155c3e1b146eac1468";

/** Tolly DEX & Launchpad Pad contract on Arc */
export const TOLLY_PAD_ADDRESS: Address =
  "0xcad7ee36ac193bf2eddb7b3e2736c5bdb8269c8b";

/** Tolly Platform Token ($TOLLY) */
export const TOLLY_TOKEN_ADDRESS: Address =
  "0xbc43ce8dec648ea298c4275559b81d6261c90b67";

// ─── API Endpoints ─────────────────────────────────────────────────────────────

export const ARCPAD_API_BASE = "https://arcpad.meme/api";
export const TOLLY_API_BASE = "https://api.tollylabs.com";

// ─── Operational Limits & Defaults ─────────────────────────────────────────────

/** Recommended gas limit for ArcPad createToken call (creates token, pool & locks LP) */
export const ARCPAD_DEPLOY_GAS_LIMIT = 3_500_000n;

/** Anti-snipe duration in blocks on ArcPad (~2 minutes at sub-second blocks) */
export const ARCPAD_ANTI_SNIPE_BLOCKS = 1200;

/** Anti-snipe maximum holding per wallet during initial blocks: 2% of 1B = 20,000,000 tokens */
export const ARCPAD_ANTI_SNIPE_MAX_RATIO = 0.02;

/** Total supply for ArcPad tokens (1,000,000,000 with 18 decimals) */
export const ARCPAD_TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

/** Default pool fee tier on ArcPad Uniswap V3 (1% = 10000 in V3 fee units) */
export const ARCPAD_POOL_FEE_TIER = 10000;

// ─── Interfaces ────────────────────────────────────────────────────────────────

export interface ArcPadTokenMeta {
  imageURI: string;
  website: string;
  twitter: string;
  telegram: string;
}

export interface ArcPadLaunchParams {
  name: string;
  symbol: string;
  meta: ArcPadTokenMeta;
  salt?: Hex;
  devBuyUsdc?: number | string; // in USDC (e.g. 1.0 or "0.5")
  dryRun?: boolean;
}

export interface ArcPadDeployResult {
  success: boolean;
  tokenAddress?: Address;
  poolAddress?: Address;
  transactionHash?: Hash;
  blockNumber?: bigint;
  name: string;
  symbol: string;
  devBuyAmountUsdc: number;
  explorerUrl?: string;
  arcpadUrl?: string;
  error?: string;
  simulated?: boolean;
}

export interface ArcPadTokenRecord {
  token: string;
  creator: string;
  name: string;
  symbol: string;
  pool: string;
  imageURI: string;
  website: string;
  twitter: string;
  telegram: string;
  timestamp: number;
  blockNumber: string;
  pad: string;
  volume24Usd?: number;
  price?: number;
  marketCapUsd?: number;
  kind?: string;
  isReward?: boolean;
}

export interface ArcPadTokensApiResponse {
  chainId: number;
  servedAt: number;
  scanCompletedAt: number;
  state: string;
  creations: ArcPadTokenRecord[];
  nextAfter?: string;
}

export interface TollyHealthStatus {
  ok: boolean;
  chainId: number;
  pad: string;
  indexing?: {
    ok: boolean;
    state: string;
    head: number;
    nativeCursor: number;
    externalCursor: number;
    nativeLag: number;
    externalLag: number;
    checkedAt: number;
  };
}

export interface TollyTokenInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  formattedSupply: string;
}

export interface UniswapV3QuoteParams {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  feeTier?: number;
}

// ─── ABIs ──────────────────────────────────────────────────────────────────────

export const ARC_CURVE_PAD_ABI = [
  {
    type: "function",
    name: "createToken",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      {
        name: "meta",
        type: "tuple",
        components: [
          { name: "imageURI", type: "string" },
          { name: "website", type: "string" },
          { name: "twitter", type: "string" },
          { name: "telegram", type: "string" },
        ],
      },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "token", type: "address" }],
  },
  {
    type: "event",
    name: "TokenCreated",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "pool", type: "address", indexed: false },
      { name: "imageURI", type: "string", indexed: false },
      { name: "website", type: "string", indexed: false },
      { name: "twitter", type: "string", indexed: false },
      { name: "telegram", type: "string", indexed: false },
    ],
  },
] as const;

export const ARC_FEE_LOCKER_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "amount", type: "uint256" }],
  },
  {
    type: "function",
    name: "collectAndClaim",
    stateMutability: "nonpayable",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const UNISWAP_V3_QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;
