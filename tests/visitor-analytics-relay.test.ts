/**
 * tests/visitor-analytics-relay.test.ts
 *
 * Automated tests for Visitor Analytics Relay (Edge & Bun.serve compatible).
 */

import { describe, it, expect } from "bun:test";
import {
  handleWeb3EventRequest,
  startLocalAnalyticsServer,
} from "../src/modules/analytics/visitor-analytics-relay.ts";

describe("Visitor Analytics Relay Suite", () => {
  it("should respond with 204 to CORS OPTIONS preflight request", async () => {
    const req = new Request("https://pumprun-web3.pages.dev/api/event", {
      method: "OPTIONS",
    });
    const res = await handleWeb3EventRequest(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("should reject GET or PUT requests with 405 Method Not Allowed", async () => {
    const req = new Request("https://pumprun-web3.pages.dev/api/event", {
      method: "GET",
    });
    const res = await handleWeb3EventRequest(req);
    expect(res.status).toBe(405);
  });

  it("should reject invalid payloads missing ticker or eventType with 400 Bad Request", async () => {
    const req = new Request("https://pumprun-web3.pages.dev/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractAddress: "0x123" }),
    });
    const res = await handleWeb3EventRequest(req);
    expect(res.status).toBe(400);
  });

  it("should accept valid telemetry event and return 200 with JSON payload", async () => {
    const req = new Request("https://pumprun-web3.pages.dev/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: "$PUMPRUN",
        contractAddress: "0x7CE19E4F978009EB644c27946B47221b824C0bA3",
        eventType: "connect_wallet",
        userAddress: "0x946657d19760775988582d1c68f278d655f7418a",
        walletProvider: "evm",
      }),
    });
    const res = await handleWeb3EventRequest(req);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.ticker).toBe("PUMPRUN");
    expect(json.eventType).toBe("connect_wallet");
  });

  it("should spin up local analytics server and respond to /health endpoint", async () => {
    const port = 8799;
    const server = startLocalAnalyticsServer(port);
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.status).toBe("ok");
    } finally {
      server.stop();
    }
  });
});
