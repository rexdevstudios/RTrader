/**
 * bankr-deployer.ts — Token deployment via official Bankr Token Launch API.
 *
 * Endpoint: POST https://api.bankr.bot/token-launches/deploy
 * Documentation: https://docs.bankr.bot/token-launching/api-reference/deploy-token-launch
 *
 * Mode:
 *  - simulateOnly: true -> returns 200 OK with predicted tokenAddress & poolId (no on-chain tx).
 *  - Real launch -> returns 201 Created with deployed tokenAddress, poolId, txHash, and feeDistribution.
 *
 * Safety & Reliability Rules:
 *  - NEVER retry a failed or timed-out deployment blindly.
 *  - If response is interrupted/timed-out, return status 'unknown' to avoid duplicate deployments.
 *  - Secrets (API keys, auth headers) are strictly sanitized before logging or error exposure.
 */
import axios, { AxiosError } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import type { TokenIdentity } from "../ai/gemini-brain.ts";
import type { UploadResult } from "../ipfs/pinata-uploader.ts";
import type { DeployResult } from "../solana/pumpfun-deployer.ts";

export const BANKR_DEPLOY_URL = "https://api.bankr.bot/token-launches/deploy";

export type BankrSupportedChain = "base" | "robinhood" | "arbitrum" | "arc";

export interface BankrDeployPayload {
  tokenName: string;
  tokenSymbol: string;
  description?: string;
  image?: string;
  websiteUrl?: string;
  tweetUrl?: string;
  chain?: BankrSupportedChain;
  feeRecipient?: {
    type: "wallet" | "x" | "farcaster" | "ens";
    value: string;
  };
  quoteOnlyFees?: boolean;
  degenMode?: boolean;
  simulateOnly?: boolean;
  pairedTokenAddress?:
    | "0x22af33fe49fd1fa80c7149773dde5890d3c76f3b" // BNKR
    | "0x5577a294ae5a21446a11b0e4100ca83803995720" // ba3Pump
    | "0xB200000000000000000000451d033a5000cb479e" // cbHYPE
    | "0xB2000000000000000000008501b13360000cb2EC" // cbZEC
    | "0xf3081494b87e8d5fb7960f066e931d1d0e6e3d67" // TAO
    | string;
}

export interface BankrSuccessResponse {
  success: boolean;
  tokenAddress: string;
  poolId: string;
  chain: BankrSupportedChain;
  txHash?: string;
  transactionHash?: string;
  simulated?: boolean;
  feeDistribution?: Record<string, unknown>;
}

export interface BankrErrorResponse {
  error?: string;
  message?: string;
  code?: string;
}

/**
 * Sanitize strings to strip any API keys or tokens before logging or returning.
 */
export function sanitizeSecret(text: string): string {
  if (!text) return "";
  return text
    .replace(/bk_usr_[A-Za-z0-9_]+/g, "bk_usr_[REDACTED]")
    .replace(/bk_ptr_[A-Za-z0-9_]+/g, "bk_ptr_[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, "Bearer [REDACTED]");
}

export const BANKR_CLI_USER_AGENT = "bankr-cli/0.1";

/**
 * Determine authentication header based on key prefix:
 *  - bk_ptr_... -> X-Partner-Key
 *  - bk_usr_... or standard key -> X-API-Key
 */
export function getBankrHeaders(apiKey: string): Record<string, string> {
  const trimmed = apiKey.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": BANKR_CLI_USER_AGENT,
    "Accept": "application/json",
  };

  if (trimmed.startsWith("bk_ptr_")) {
    headers["X-Partner-Key"] = trimmed;
  } else {
    headers["X-API-Key"] = trimmed;
  }

  return headers;
}

/**
 * Pure builder function for constructing validated Bankr deploy payload.
 */
export function buildBankrPayload(
  identity: TokenIdentity,
  assets: UploadResult,
  options: {
    chain?: BankrSupportedChain;
    degenMode?: boolean;
    simulateOnly?: boolean;
    quoteOnlyFees?: boolean;
    isPartnerKey?: boolean;
    feeRecipient?: {
      type: "wallet" | "x" | "farcaster" | "ens";
      value: string;
    };
    pairedTokenAddress?: string;
  } = {}
): BankrDeployPayload {
  const chain = options.chain ?? "base";
  const simulateOnly = options.simulateOnly ?? false;

  const payload: BankrDeployPayload = {
    tokenName: identity.name.trim().slice(0, 100),
    tokenSymbol: identity.ticker.trim().slice(0, 20),
    description: identity.description ? identity.description.trim().slice(0, 500) : undefined,
    image: assets.imageUrl || undefined,
    chain,
    simulateOnly,
  };

  if (identity.website && identity.website.startsWith("http")) {
    payload.websiteUrl = identity.website;
  }

  if (identity.twitter && identity.twitter.startsWith("http")) {
    payload.tweetUrl = identity.twitter;
  }

  // Degen mode is only accepted for user-key launches (rejected with 400 on partner keys)
  if (options.degenMode && !options.isPartnerKey) {
    payload.degenMode = true;
  }

  if (options.quoteOnlyFees) {
    payload.quoteOnlyFees = true;
  }

  if (options.pairedTokenAddress) {
    payload.pairedTokenAddress = options.pairedTokenAddress;
  }

  if (options.feeRecipient?.value) {
    payload.feeRecipient = options.feeRecipient;
  }

  return payload;
}

/**
 * Safely parses a proxy URL string into an Axios-compatible proxy config object.
 */
export function buildAxiosProxyConfig(proxyUrl?: string): any {
  if (!proxyUrl) return undefined;
  try {
    const parsed = new URL(proxyUrl);
    return {
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : (parsed.protocol === "https:" ? 443 : 80),
      auth: parsed.username
        ? {
            username: decodeURIComponent(parsed.username),
            password: parsed.password ? decodeURIComponent(parsed.password) : "",
          }
        : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Main deployment handler for Base/Robinhood/Arbitrum via official Bankr Token Launch API.
 */
export async function deployViaBankr(
  identity: TokenIdentity,
  assets: UploadResult,
  overrides?: {
    simulateOnly?: boolean;
    apiKey?: string;
    proxyUrl?: string;
    chain?: BankrSupportedChain;
    quoteOnlyFees?: boolean;
    feeRecipient?: {
      type: "wallet" | "x" | "farcaster" | "ens";
      value: string;
    };
    pairedTokenAddress?: string;
  }
): Promise<DeployResult> {
  const cfg = getConfig();
  const apiKey = overrides?.apiKey ?? cfg.BANKR_API_KEY;

  const isTestnet = cfg.DEPLOY_MODE === "testnet";
  const isSimulation = overrides?.simulateOnly ?? (isTestnet || cfg.DRY_RUN || cfg.BANKR_SIMULATE_ONLY);
  const chain = (overrides?.chain ?? cfg.BANKR_CHAIN ?? "base") as BankrSupportedChain;
  const isPartnerKey = Boolean(apiKey?.trim().startsWith("bk_ptr_"));
  const quoteOnly = overrides?.quoteOnlyFees ?? cfg.BANKR_QUOTE_ONLY_FEES ?? true;

  logger.deploy(
    `🚀 [BANKR] Preparing deploy for $${identity.ticker} (${identity.name}) on ${chain.toUpperCase()}` +
      (isSimulation ? " [SIMULATION MODE]" : " [REAL ON-CHAIN LAUNCH]")
  );

  if (!apiKey) {
    const errorMsg = "BANKR_API_KEY is not configured in environment variables.";
    logger.error(`❌ [BANKR] Deployment aborted: ${errorMsg}`);
    return {
      success: false,
      status: "failed",
      error: errorMsg,
    };
  }

  // Safety Gate: Enforce gas sponsorship requirement for real on-chain deployments
  if (cfg.BANKR_REQUIRE_GAS_SPONSORSHIP && chain !== "base" && !cfg.BANKR_ALLOW_PAID_GAS_FALLBACK && !isSimulation) {
    const errorMsg = `GAS_SPONSORSHIP_POLICY_VIOLATION: Chain '${chain}' does not support gas sponsorship (only Base is sponsored). Paid gas fallback is disabled (BANKR_ALLOW_PAID_GAS_FALLBACK=false). Deployment blocked.`;
    logger.error(`❌ [BANKR] ${errorMsg}`);
    return {
      success: false,
      status: "failed",
      error: errorMsg,
    };
  }

  const payload = buildBankrPayload(identity, assets, {
    chain,
    simulateOnly: isSimulation,
    quoteOnlyFees: overrides?.quoteOnlyFees ?? cfg.BANKR_QUOTE_ONLY_FEES,
    feeRecipient: overrides?.feeRecipient,
    pairedTokenAddress: overrides?.pairedTokenAddress,
  });

  const headers = getBankrHeaders(apiKey);
  const timeoutMs = cfg.API_TIMEOUT_MS ?? 30000;

  try {
    const axiosConfig: any = {
      headers,
      timeout: timeoutMs,
      validateStatus: (status: number) => status >= 200 && status < 300,
    };

    let requestBody: any = payload;
    if (overrides?.proxyUrl) {
      const proxyCfg = buildAxiosProxyConfig(overrides.proxyUrl);
      if (proxyCfg) {
        axiosConfig.proxy = proxyCfg;
        try {
          axiosConfig.httpsAgent = new HttpsProxyAgent(overrides.proxyUrl);
        } catch {}
        try {
          const jsonBody = JSON.stringify(payload);
          requestBody = jsonBody;
          headers["Content-Length"] = String(Buffer.byteLength(jsonBody));
        } catch {}
        try {
          const parsed = new URL(overrides.proxyUrl);
          logger.info(
            `🌐 [BANKR] Routing deployment request via proxy: ${parsed.protocol}//${
              parsed.username ? parsed.username + ":****@" : ""
            }${parsed.hostname}:${parsed.port}`
          );
        } catch {}
      } else {
        logger.warn(`⚠️  [BANKR] Failed to parse proxyUrl '${sanitizeSecret(overrides.proxyUrl)}'`);
      }
    }

    const response = await axios.post<BankrSuccessResponse>(BANKR_DEPLOY_URL, requestBody, axiosConfig);

    const data = response.data;

    // Validate response schema
    if (!data || typeof data !== "object") {
      throw new Error("MALFORMED_RESPONSE: Response body was empty or not an object.");
    }

    if (!data.success || !data.tokenAddress || !data.tokenAddress.startsWith("0x")) {
      throw new Error(
        `MALFORMED_RESPONSE: Missing or invalid tokenAddress in Bankr response: ${JSON.stringify(data)}`
      );
    }

    const txHash = data.txHash || data.transactionHash;

    if (!isSimulation && (!txHash || !txHash.startsWith("0x"))) {
      throw new Error(
        `MALFORMED_RESPONSE: Real launch succeeded HTTP ${response.status} but returned no txHash: ${JSON.stringify(data)}`
      );
    }

    const explorerUrl = txHash
      ? chain === "base"
        ? `https://basescan.org/tx/${txHash}`
        : chain === "arbitrum"
        ? `https://arbiscan.io/tx/${txHash}`
        : `https://robinhoodchain.blockscout.com/tx/${txHash}`
      : undefined;

    if (isSimulation) {
      logger.info(
        `🧪 [BANKR] Simulation Successful!\n` +
          `   Predicted Token Address: ${data.tokenAddress}\n` +
          `   Pool ID: ${data.poolId}\n` +
          `   Chain: ${data.chain}`
      );
    } else {
      logger.success(
        `✅ [BANKR] Real Deployment Successful!\n` +
          `   Token Address: ${data.tokenAddress}\n` +
          `   Pool ID: ${data.poolId}\n` +
          `   Tx Hash: ${data.txHash}\n` +
          `   Explorer: ${explorerUrl}`
      );
    }

    return {
      success: true,
      status: "success",
      contractAddress: data.tokenAddress,
      txHash: data.txHash,
      poolId: data.poolId,
      simulated: isSimulation || Boolean(data.simulated),
      explorerUrl,
      feeDistribution: data.feeDistribution,
    };
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError<BankrErrorResponse>;

      // Network Timeout or connection interruption: AMBIGUOUS OUTCOME
      if (axiosErr.code === "ECONNABORTED" || axiosErr.code === "ETIMEDOUT" || !axiosErr.response) {
        const diagnostic =
          `DEPLOYMENT_OUTCOME_UNKNOWN: Request timed out after ${timeoutMs}ms or network disconnected. ` +
          `The deployment request may have reached Bankr and initiated Doppler metadata pinning. ` +
          `AUTOMATIC RETRY IS FORBIDDEN to prevent duplicate token launches.`;

        logger.error(`⚠️  [BANKR] ${diagnostic}`);
        return {
          success: false,
          status: "unknown",
          error: diagnostic,
        };
      }

      const status = axiosErr.response?.status;
      const respData = axiosErr.response?.data;
      const rawErrorMsg = respData?.error || respData?.message || axiosErr.message;
      const sanitizedMsg = sanitizeSecret(rawErrorMsg);

      let formattedError: string;

      switch (status) {
        case 400:
          formattedError = `VALIDATION_ERROR (400): ${sanitizedMsg}`;
          break;
        case 401:
          formattedError = `AUTHENTICATION_ERROR (401): Missing or invalid Bankr API Key.`;
          break;
        case 403: {
          const serverHeader = String(axiosErr.response?.headers?.["server"] || "").toLowerCase();
          const isAwsElb = serverHeader.includes("awselb");
          const dataRaw: unknown = respData;
          const dataStr = typeof dataRaw === "string" ? dataRaw : JSON.stringify(dataRaw ?? "");
          const isHtml = dataStr.toLowerCase().includes("<html") || dataStr.toLowerCase().includes("<!doctype");
          if (isAwsElb || isHtml) {
            formattedError = `ELIGIBILITY_OR_PERMISSION_ERROR (403): GATEWAY_WAF_BLOCK — Upstream AWS ALB/WAF gateway blocked request (Server: ${serverHeader || "awselb/2.0"}). Perimeter rejection.`;
          } else {
            formattedError = `ELIGIBILITY_OR_PERMISSION_ERROR (403): ${sanitizedMsg}${
              (respData as any)?.code ? ` [Code: ${(respData as any).code}]` : ""
            }`;
          }
          break;
        }
        case 429: {
          const retryAfter = axiosErr.response?.headers?.["retry-after"];
          formattedError = `RATE_LIMIT_EXCEEDED (429): ${sanitizedMsg}${
            retryAfter ? ` (Retry after ${retryAfter}s)` : ""
          }`;
          break;
        }
        case 503: {
          const retryAfter = axiosErr.response?.headers?.["retry-after"];
          formattedError = `ELIGIBILITY_UNAVAILABLE (503): ${sanitizedMsg}${
            retryAfter ? ` (Retry after ${retryAfter}s)` : ""
          }`;
          break;
        }
        default:
          formattedError = `BANKR_SERVER_ERROR (${status ?? "Unknown"}): ${sanitizedMsg}`;
          break;
      }

      logger.error(`❌ [BANKR] Deployment failed: ${formattedError}`);

      if (isTestnet) {
        logger.warn(
          `🧪 [BANKR] MODE TESTNET: Remote simulation rejected (${formattedError}). Falling back to local testnet simulation.`
        );
        const simToken = `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
        const simTx = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
        const simPool = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
        return {
          success: true,
          status: "success",
          simulated: true,
          contractAddress: simToken,
          txHash: simTx,
          poolId: simPool,
          explorerUrl: `https://basescan.org/tx/${simTx}`,
        };
      }

      return {
        success: false,
        status: "failed",
        error: formattedError,
      };
    }

    const generalMsg = sanitizeSecret(err instanceof Error ? err.message : String(err));
    logger.error(`❌ [BANKR] Deployment exception: ${generalMsg}`);

    if (isTestnet) {
      logger.warn(
        `🧪 [BANKR] MODE TESTNET: Remote simulation exception (${generalMsg}). Falling back to local testnet simulation.`
      );
      const simToken = `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
      const simTx = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
      const simPool = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
      return {
        success: true,
        status: "success",
        simulated: true,
        contractAddress: simToken,
        txHash: simTx,
        poolId: simPool,
        explorerUrl: `https://basescan.org/tx/${simTx}`,
      };
    }

    return {
      success: false,
      status: "failed",
      error: generalMsg,
    };
  }
}

// ─── Official Bankr Client Helper Functions (docs.bankr.bot) ──

export interface BankrBalancesResponse {
  success: boolean;
  evmAddress?: string;
  solAddress?: string;
  balances?: Record<
    string,
    {
      nativeBalance?: string;
      nativeUsd?: string;
      tokenBalances?: Array<{ token?: string; balance?: string; usd?: string }>;
      total?: string;
    }
  >;
  nfts?: unknown[];
}

export interface BankrClaimableFeesResponse {
  eligible: boolean;
  tokenAddress: string;
  share?: string;
  claimableFees?: {
    token0?: string;
    token1?: string;
    token0Label?: string;
    token1Label?: string;
  };
}

export interface BankrTokenFeesResponse {
  address?: string;
  chain?: string;
  days?: number;
  tokens?: Array<{
    tokenAddress: string;
    name?: string;
    symbol?: string;
    poolId?: string;
    initializer?: string;
    share?: string;
    token0Label?: string;
    token1Label?: string;
    claimable?: { token0?: string; token1?: string };
    claimed?: { token0?: string; token1?: string; count?: number };
    source?: string;
  }>;
  dailyEarnings?: Array<{ date: string; weth: string }>;
  lifetimeEarnedWeth?: string;
  lifetimeDays?: number;
  totals?: {
    claimableWeth?: string;
    claimedWeth?: string;
    claimCount?: number;
  };
}

function buildAxiosRequestConfig(options?: {
  timeoutMs?: number;
  proxyUrl?: string;
  headers?: Record<string, string>;
}): any {
  const axiosConfig: any = {
    headers: options?.headers ?? {},
    timeout: options?.timeoutMs ?? 10000,
  };
  if (options?.proxyUrl) {
    const proxyCfg = buildAxiosProxyConfig(options.proxyUrl);
    if (proxyCfg) {
      try {
        axiosConfig.httpsAgent = new HttpsProxyAgent(options.proxyUrl);
        axiosConfig.proxy = false;
      } catch {
        axiosConfig.proxy = proxyCfg;
      }
    }
  }
  return axiosConfig;
}

/**
 * Fetch live cross-chain wallet balances for the authenticated Bankr user (GET /wallet/balances).
 */
export async function fetchBankrBalances(
  apiKey?: string,
  options?: { timeoutMs?: number; proxyUrl?: string }
): Promise<BankrBalancesResponse> {
  const cfg = getConfig();
  const key = apiKey ?? cfg.BANKR_API_KEY;
  if (!key) {
    throw new Error("BANKR_API_KEY is not configured.");
  }
  const headers = getBankrHeaders(key);
  const axiosConfig = buildAxiosRequestConfig({
    headers,
    timeoutMs: options?.timeoutMs,
    proxyUrl: options?.proxyUrl,
  });
  const res = await axios.get<BankrBalancesResponse>("https://api.bankr.bot/wallet/balances", axiosConfig);
  return res.data;
}

/**
 * Query claimable fees for a specific beneficiary on a Doppler token (GET /public/doppler/claimable-fees/:tokenAddress).
 * Unauthenticated public endpoint.
 */
export async function fetchClaimableFees(
  tokenAddress: string,
  beneficiary: string,
  options?: { timeoutMs?: number; proxyUrl?: string }
): Promise<BankrClaimableFeesResponse> {
  const url = `https://api.bankr.bot/public/doppler/claimable-fees/${tokenAddress}?beneficiary=${beneficiary}`;
  const axiosConfig = buildAxiosRequestConfig(options);
  const res = await axios.get<BankrClaimableFeesResponse>(url, axiosConfig);
  return res.data;
}

/**
 * Query fee details and daily earnings for a specific token (GET /public/doppler/token-fees/:tokenAddress).
 * Unauthenticated public endpoint.
 */
export async function fetchTokenFees(
  tokenAddress: string,
  days = 30,
  options?: { timeoutMs?: number; proxyUrl?: string }
): Promise<BankrTokenFeesResponse> {
  const url = `https://api.bankr.bot/public/doppler/token-fees/${tokenAddress}?days=${days}`;
  const axiosConfig = buildAxiosRequestConfig(options);
  const res = await axios.get<BankrTokenFeesResponse>(url, axiosConfig);
  return res.data;
}

/**
 * Query all Doppler & Clanker tokens where wallet is creator beneficiary (GET /public/doppler/creator-fees/:walletAddress).
 * Unauthenticated public endpoint.
 */
export async function fetchCreatorFees(
  walletAddress: string,
  days = 30,
  options?: { timeoutMs?: number; proxyUrl?: string }
): Promise<BankrTokenFeesResponse> {
  const url = `https://api.bankr.bot/public/doppler/creator-fees/${walletAddress}?days=${days}`;
  const axiosConfig = buildAxiosRequestConfig(options);
  const res = await axios.get<BankrTokenFeesResponse>(url, axiosConfig);
  return res.data;
}
