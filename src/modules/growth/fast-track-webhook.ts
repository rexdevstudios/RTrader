/**
 * src/modules/growth/fast-track-webhook.ts
 *
 * Automated DexScreener Fast-Track Payment Webhook & Order Verifier.
 *
 * Listens for payment / approval webhooks from payment gateways or external
 * DexScreener Fast-Track automation systems, updates Vault records, dispatches
 * social beacon proof cards, and immediately ignites the Multi-Wallet Volume Spark.
 *
 * Powered by native Bun HTTP server (zero extra dependencies).
 */

import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import {
  checkTokenDexScreenerStatus,
  broadcastDexScreenerActivation,
} from "../intelligence/dexscreener-monitor.ts";
import { runTrendingBoostCycle } from "./trending-booster.ts";
import { getAllDeployLogs, getDeployLogWebsite } from "../../db/vault.ts";

export interface FastTrackPaymentPayload {
  chainId?: string | number;
  tokenAddress: string;
  tokenSymbol?: string;
  orderId?: string;
  status?: string;
  txHash?: string;
  paidAmountUsd?: number;
  secret?: string;
}

export interface FastTrackProcessResult {
  success: boolean;
  message: string;
  tokenAddress: string;
  chain: string;
  sparkTriggered: boolean;
  beaconDispatched: boolean;
  vaultUpdated: boolean;
  orderId?: string;
  isDuplicate?: boolean;
}

// In-memory idempotency cache for deduplication (TTL: 1 hour)
interface ProcessedEventRecord {
  key: string;
  processedAt: number;
  result: FastTrackProcessResult;
}

const idempotencyCache = new Map<string, ProcessedEventRecord>();
const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000; // 1 hour

export function getEventIdempotencyKey(payload: FastTrackPaymentPayload): string {
  if (payload.orderId && payload.orderId.trim().length > 0) {
    return `order:${payload.orderId.trim()}`;
  }
  if (payload.txHash && payload.txHash.trim().length > 0) {
    return `tx:${payload.txHash.trim().toLowerCase()}`;
  }
  return `token:${payload.tokenAddress?.toLowerCase()}:${payload.status || "paid"}`;
}

export function clearIdempotencyCache(): void {
  idempotencyCache.clear();
}

/**
 * Normalizes chain identifier to canonical names.
 */
export function normalizeFastTrackChain(chain?: string | number): string {
  if (!chain) return "base";
  const str = String(chain).toLowerCase().trim();
  if (str === "8453" || str === "base") return "base";
  if (str === "101" || str === "solana") return "solana";
  if (str === "46688" || str === "robinhood") return "robinhood";
  if (str === "clanker") return "base";
  return str;
}

/**
 * Processes incoming DexScreener Fast-Track payment webhook payload.
 * Verifies validity, alerts community channels, and ignites volume spark.
 */
export async function processFastTrackPaymentPayload(
  payload: FastTrackPaymentPayload,
  options?: {
    autoTriggerVolumeSpark?: boolean;
    webhookSecret?: string;
  }
): Promise<FastTrackProcessResult> {
  const cfg = getConfig();
  const requiredSecret =
    options?.webhookSecret ||
    process.env.FAST_TRACK_WEBHOOK_SECRET ||
    (cfg as any).FAST_TRACK_WEBHOOK_SECRET;

  // 1. Authenticate secret if configured
  if (requiredSecret && requiredSecret.trim().length > 0) {
    if (payload.secret !== requiredSecret) {
      logger.warn(
        `[FastTrackWebhook] ❌ Unauthorized webhook request for ${payload.tokenAddress || "unknown"}`
      );
      return {
        success: false,
        message: "Unauthorized: Invalid webhook secret",
        tokenAddress: payload.tokenAddress || "",
        chain: normalizeFastTrackChain(payload.chainId),
        sparkTriggered: false,
        beaconDispatched: false,
        vaultUpdated: false,
      };
    }
  }

  // 2. Validate token address
  const ca = payload.tokenAddress?.trim();
  if (!ca || ca.length < 20) {
    logger.warn(`[FastTrackWebhook] ❌ Permintaan ditolak: tokenAddress tidak valid.`);
    return {
      success: false,
      message: "Invalid payload: valid tokenAddress is required",
      tokenAddress: ca || "",
      chain: normalizeFastTrackChain(payload.chainId),
      sparkTriggered: false,
      beaconDispatched: false,
      vaultUpdated: false,
    };
  }

  const chain = normalizeFastTrackChain(payload.chainId);
  logger.info(
    `[FastTrackWebhook] 📥 Menerima notifikasi pembayaran Fast-Track untuk CA: ${ca} (${chain})`
  );

  // 3. Idempotency Check (Replay / Retry Protection)
  const eventKey = getEventIdempotencyKey(payload);
  const now = Date.now();
  const cached = idempotencyCache.get(eventKey);

  if (cached && now - cached.processedAt < IDEMPOTENCY_TTL_MS) {
    logger.info(
      `[FastTrackWebhook] 🛡️ Event duplikat terdeteksi (Key: ${eventKey}). Mengembalikan status ALREADY_PROCESSED.`
    );
    return {
      ...cached.result,
      isDuplicate: true,
      message: `Event already processed within TTL window (Idempotency key: ${eventKey})`,
    };
  }

  // 4. Look up token in Vault
  const logs = getAllDeployLogs();
  const matchedToken = logs.find(
    (l) => l.contractAddr?.toLowerCase() === ca.toLowerCase()
  );
  const tokenSymbol =
    payload.tokenSymbol?.toUpperCase() ||
    matchedToken?.ticker?.toUpperCase() ||
    "TOKEN";

  let beaconDispatched = false;
  let sparkTriggered = false;
  let poolLiquidityUsd: number | undefined = undefined;

  // 5. Query live DexScreener intelligence & broadcast activation
  try {
    const { report } = await checkTokenDexScreenerStatus(ca, chain);
    report.isDexScreenerPaid = true;
    report.dexScreenerStatusText = "PAID (Fast-Track Approved)";
    poolLiquidityUsd = report.market.liquidityUsd;
    if (!report.market.tokenSymbol && tokenSymbol) {
      report.market.tokenSymbol = tokenSymbol;
    }

    const broadcastRes = await broadcastDexScreenerActivation(report);
    beaconDispatched = broadcastRes.discordDispatched || broadcastRes.telegramDispatched || broadcastRes.errors.length === 0;
    logger.success(
      `[FastTrackWebhook] 📢 Beacon broadcast berhasil disiarkan untuk $${tokenSymbol}`
    );
  } catch (err: any) {
    logger.warn(
      `[FastTrackWebhook] ⚠️ Gagal broadcast status: ${err?.message || err}`
    );
  }

  // 6. Trigger automated Volume Spark (Unique Makers Micro-Buys)
  if (options?.autoTriggerVolumeSpark !== false) {
    try {
      logger.info(
        `[FastTrackWebhook] ⚡ Menyalakan Volume Spark otomatis (5 putaran) untuk $${tokenSymbol}...`
      );
      await runTrendingBoostCycle({
        tokenAddress: ca,
        tokenSymbol,
        liquidityUsd: poolLiquidityUsd,
        rounds: 5,
      });
      sparkTriggered = true;
    } catch (sparkErr: any) {
      logger.warn(
        `[FastTrackWebhook] ⚠️ Volume spark notice: ${sparkErr?.message || sparkErr}`
      );
    }
  }

  const result: FastTrackProcessResult = {
    success: true,
    message: `Fast-track payment successfully processed for $${tokenSymbol} (${ca})`,
    tokenAddress: ca,
    chain,
    sparkTriggered,
    beaconDispatched,
    vaultUpdated: Boolean(matchedToken),
    orderId: payload.orderId,
    isDuplicate: false,
  };

  idempotencyCache.set(eventKey, {
    key: eventKey,
    processedAt: now,
    result,
  });

  return result;
}

/**
 * On-demand polling and verification of DexScreener status for a token address.
 */
export async function verifyFastTrackPayment(
  tokenAddress: string,
  chain = "base"
): Promise<{
  verified: boolean;
  statusText: string;
  isPaid: boolean;
  boostCount: number;
  pairAddress?: string;
}> {
  const { summary } = await checkTokenDexScreenerStatus(tokenAddress, chain);
  return {
    verified: summary.isPaid || summary.isProfileApproved,
    statusText: summary.statusText,
    isPaid: summary.isPaid,
    boostCount: summary.boostCount,
    pairAddress: summary.pairAddress,
  };
}

/**
 * Starts a native Bun HTTP webhook listener on the specified port.
 */
export function startFastTrackWebhookServer(
  port = 3001,
  secret?: string,
  options?: { autoTriggerVolumeSpark?: boolean }
): {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  stop: () => void;
} {
  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // GET /health
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "DexScreener Fast-Track Webhook Listener",
            timestamp: new Date().toISOString(),
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // POST /webhook/dexscreener/fast-track
      if (req.method === "POST" && url.pathname === "/webhook/dexscreener/fast-track") {
        try {
          const body = (await req.json()) as FastTrackPaymentPayload;
          const result = await processFastTrackPaymentPayload(body, {
            webhookSecret: secret,
            autoTriggerVolumeSpark: options?.autoTriggerVolumeSpark,
          });

          const statusCode = result.success ? 200 : result.message.startsWith("Unauthorized") ? 401 : 400;
          return new Response(JSON.stringify(result), {
            status: statusCode,
            headers: { "Content-Type": "application/json" },
          });
        } catch (err: any) {
          return new Response(
            JSON.stringify({
              success: false,
              message: `Malformed JSON payload: ${err?.message || err}`,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  logger.info(`[FastTrackWebhook] 🚀 Webhook listener aktif di port ${server.port}`);

  return {
    server,
    port: server.port ?? port,
    stop: () => server.stop(),
  };
}

// CLI runner if invoked directly
if (import.meta.main || (process.argv[1] && process.argv[1].includes("fast-track-webhook.ts"))) {
  const portArg = parseInt(process.argv[2] || "3001", 10);
  startFastTrackWebhookServer(portArg);
}
