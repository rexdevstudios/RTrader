/**
 * src/modules/analytics/visitor-analytics-relay.ts
 *
 * Serverless / Edge Visitor Analytics Relay for Web3 DApps.
 * Receives visitor interaction telemetry (wallet connects, CA copies, wallet additions)
 * and records events directly to the isolated Neon PostgreSQL database for that token.
 *
 * Compatible with Cloudflare Workers fetch handler and Bun.serve.
 */

import { logger } from "../../logger.ts";
import { recordTokenWeb3Event } from "../../db/neon-vault.ts";

export interface Web3EventPayload {
  ticker: string;
  contractAddress: string;
  eventType: "connect_wallet" | "copy_ca" | "add_token" | "swap_click" | string;
  userAddress?: string | null;
  walletProvider?: string | null;
  clientTimestamp?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

/**
 * Universal request handler compatible with Cloudflare Workers and Bun.serve.
 */
export async function handleWeb3EventRequest(req: Request): Promise<Response> {
  // 1. Handle CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 2. Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST /api/event." }),
      {
        status: 405,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  try {
    const body = (await req.json()) as Web3EventPayload;

    if (!body || !body.ticker || !body.eventType) {
      return new Response(
        JSON.stringify({ error: "Invalid payload. Missing ticker or eventType." }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        }
      );
    }

    const cleanTicker = body.ticker.replace(/^\$/, "").toUpperCase();
    const cleanEventType = body.eventType.toLowerCase().slice(0, 32);
    const cleanUserAddr = body.userAddress ? body.userAddress.slice(0, 66) : null;
    const cleanProvider = body.walletProvider ? body.walletProvider.slice(0, 32) : null;

    // Record event to isolated Neon PostgreSQL database (non-blocking / fail-safe)
    const recorded = await recordTokenWeb3Event(cleanTicker, {
      contractAddr: body.contractAddress || cleanTicker,
      eventType: cleanEventType,
      userAddress: cleanUserAddr,
      walletProvider: cleanProvider,
    });

    return new Response(
      JSON.stringify({
        success: true,
        recorded,
        ticker: cleanTicker,
        eventType: cleanEventType,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  } catch (err: any) {
    logger.warn(`⚠️  [ANALYTICS-RELAY] Request error: ${err?.message || err}`);
    return new Response(
      JSON.stringify({ error: "Internal error processing telemetry event." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }
}

/**
 * Starts a lightweight local analytics HTTP server for testing or local relay.
 */
export function startLocalAnalyticsServer(port: number = 8787) {
  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/event" || url.pathname === "/event") {
        return handleWeb3EventRequest(req);
      }
      if (url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
          headers: { "Content-Type": "application/json", ...CORS_HEADERS },
        });
      }
      return new Response("Omnichain Web3 Visitor Analytics Relay Server", {
        headers: CORS_HEADERS,
      });
    },
  });

  logger.info(`📡 [ANALYTICS-RELAY] Server aktif di: http://localhost:${port}/api/event`);
  return server;
}
