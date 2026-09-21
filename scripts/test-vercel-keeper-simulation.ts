#!/usr/bin/env bun
/**
 * scripts/test-vercel-keeper-simulation.ts
 *
 * Automated E2E Simulation Test for Vercel Serverless Keeper & On-Chain Webhook.
 * Verifies:
 *   1. GET /api/launchpad/keeper (batch sweep across Neon token_launches)
 *   2. POST /api/launchpad/keeper (batch execution & audit logging)
 *   3. POST /api/launchpad/webhook (on-chain swap ingestion & chain_events persistence)
 *   4. Latency performance gate (< 3000ms, strictly compliant with Vercel Hobby 10s limit)
 *
 * Usage:
 *   bun run scripts/test-vercel-keeper-simulation.ts
 */

import { getDbPool } from '../packages/shared/db-pool';
import crypto from 'crypto';

const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';

async function main() {
  console.log(`\n=================================================================`);
  console.log(`   [+] VERCEL HOBBY KEEPER & WEBHOOK SIMULATION TEST SUITE [+]`);
  console.log(`=================================================================`);
  console.log(`Target URL : ${BASE_URL}`);

  // Warm up dev server routes
  console.log(`Warming up route bundles...`);
  await fetch(`${BASE_URL}/api/launchpad/webhook`).catch(() => {});
  await fetch(`${BASE_URL}/api/launchpad/keeper`).catch(() => {});

  let passedTests = 0;
  let totalTests = 0;

  function assertTest(name: string, condition: boolean, details?: any) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ [PASS] ${name}`);
    } else {
      console.error(`  ❌ [FAIL] ${name}`, details || '');
    }
  }

  // ---------------------------------------------------------------------------
  // Test 1: Healthcheck Webhook Gateway
  // ---------------------------------------------------------------------------
  console.log(`\n--- Test 1: Webhook Gateway Handshake (GET /api/launchpad/webhook) ---`);
  try {
    const res = await fetch(`${BASE_URL}/api/launchpad/webhook`);
    const json = await res.json();
    assertTest('Webhook gateway returns status 200', res.status === 200);
    assertTest('Webhook gateway status is ACTIVE', json.status === 'ACTIVE');
  } catch (err: any) {
    assertTest('Webhook gateway unreachable', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 2: Ingest On-Chain Swap Event via Webhook
  // ---------------------------------------------------------------------------
  console.log(`\n--- Test 2: Ingest On-Chain Swap Event (POST /api/launchpad/webhook) ---`);
  const testTxHash = `0x${crypto.randomBytes(32).toString('hex')}`;
  const clankerToken = '0x814620255bf422d45c0f8aBF7ad89F40a1CBCA4A';

  try {
    const t0 = performance.now();
    const webhookRes = await fetch(`${BASE_URL}/api/launchpad/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        networkId: 'base-mainnet',
        blockNumber: 51578900,
        txHash: testTxHash,
        eventName: 'UNISWAP_V4_SWAP',
        contractAddress: clankerToken,
        eventData: {
          tokenIn: 'WETH',
          tokenOut: 'PUMPRUN',
          volumeUsd: 1250.50,
          sender: '0x946657d17c7e3E52faB5fa4d41F6131c9a09418a',
        },
      }),
    });
    const elapsed = Math.round(performance.now() - t0);
    const json = await webhookRes.json();

    assertTest('Webhook returns status 201 Created', webhookRes.status === 201);
    assertTest('Webhook processedCount is 1', json?.data?.processedCount === 1);
    assertTest(`Webhook latency is fast (< 3000ms): ${elapsed}ms`, elapsed < 3000);
  } catch (err: any) {
    assertTest('Webhook POST failed', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 3: Keeper Evaluation Batch Sweep (GET /api/launchpad/keeper)
  // ---------------------------------------------------------------------------
  console.log(`\n--- Test 3: Keeper Batch Sweep (GET /api/launchpad/keeper) ---`);
  try {
    const t0 = performance.now();
    const keeperGetRes = await fetch(`${BASE_URL}/api/launchpad/keeper`);
    const elapsed = Math.round(performance.now() - t0);
    const json = await keeperGetRes.json();

    assertTest('Keeper GET returns status 200', keeperGetRes.status === 200);
    assertTest('Keeper returned success true', json.success === true);
    assertTest('Keeper evaluated active tokens count > 0', json?.data?.evaluatedCount > 0);
    assertTest(`Keeper GET latency is compliant (< 3000ms): ${elapsed}ms`, elapsed < 3000);

    const hasClanker = json?.data?.tokens?.some((t: any) =>
      t.tokenAddress.toLowerCase() === clankerToken.toLowerCase()
    );
    assertTest('Keeper evaluated Clanker v4 token (0x8146...) in Neon DB', hasClanker);
  } catch (err: any) {
    assertTest('Keeper GET failed', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 4: Keeper Batch Execution (POST /api/launchpad/keeper)
  // ---------------------------------------------------------------------------
  console.log(`\n--- Test 4: Keeper Batch Execution (POST /api/launchpad/keeper) ---`);
  try {
    const t0 = performance.now();
    const keeperPostRes = await fetch(`${BASE_URL}/api/launchpad/keeper`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'simulation-test' }),
    });
    const elapsed = Math.round(performance.now() - t0);
    const json = await keeperPostRes.json();

    assertTest('Keeper POST returns status 200', keeperPostRes.status === 200);
    assertTest('Keeper POST returned success true', json.success === true);
    assertTest('Keeper POST executed action BATCH_HARVEST_AND_COMPOUND', json?.data?.action === 'BATCH_HARVEST_AND_COMPOUND');
    assertTest(`Keeper POST latency is compliant (< 3000ms): ${elapsed}ms`, elapsed < 3000);
  } catch (err: any) {
    assertTest('Keeper POST failed', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Test 5: Verify Neon DB Persistence (chain_events & audit_logs)
  // ---------------------------------------------------------------------------
  console.log(`\n--- Test 5: Verify Neon PostgreSQL Cloud Persistence ---`);
  const pool = getDbPool();
  if (pool) {
    try {
      // 5a. Verify chain_events
      const eventRes = await pool.query(
        'SELECT id, event_name, tx_hash FROM chain_events WHERE tx_hash = $1',
        [testTxHash]
      );
      assertTest('Ingested webhook event persisted in chain_events table', eventRes.rows.length > 0);

      // 5b. Verify audit_logs
      const auditRes = await pool.query(
        "SELECT id, action, created_at FROM audit_logs WHERE action IN ('KEEPER_UPKEEP_EVALUATION', 'KEEPER_BATCH_EXECUTION') ORDER BY created_at DESC LIMIT 5"
      );
      assertTest('Keeper execution recorded in audit_logs table', auditRes.rows.length > 0);

      await pool.end();
    } catch (err: any) {
      assertTest('Database verification query failed', false, err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log(`\n=================================================================`);
  console.log(`   SIMULATION RESULTS: ${passedTests}/${totalTests} TESTS PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log(`=================================================================\n`);

  if (passedTests === totalTests) {
    console.log(`🚀 All tests passed! Vercel Hobby Hardening & Smart Contract Automation is VERIFIED.`);
    process.exit(0);
  } else {
    console.error(`⚠️ Some tests failed. Check logs above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
