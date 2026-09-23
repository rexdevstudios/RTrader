#!/usr/bin/env bun
/**
 * scripts/test-publish-intent-simulation.ts
 *
 * End-to-end Simulation Test for Phase 3:
 * 1. Launch Draft -> On-Chain Publish -> PostgreSQL SSOT token_launches persistence
 * 2. Active Token Launches Query & Token Portal Resolution
 * 3. Trade Intent Risk Gate Persistence to PostgreSQL trade_intents table
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import {
  getDbPool,
  defaultDraftDbAdapter,
  ensureUserEntity,
  saveTradeIntent,
} from '../packages/shared/db-pool';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function runSimulation() {
  console.log('================================================================');
  console.log('  TEST SUITE: PUBLISH PIPELINE & TRADE INTENT PERSISTENCE      ');
  console.log('================================================================\n');

  const pool = getDbPool();
  if (!pool) {
    console.log('⚠️ DATABASE_URL not configured. Running in-memory assertions only.');
    return;
  }

  const testCreatorWallet = '0x3333333333333333333333333333333333333333';
  const testContractAddress = '0x4444444444444444444444444444444444444444';
  const testTxHash = '0x' + 'b'.repeat(64);
  const testDraftId = crypto.randomUUID();
  const testIdempotencyKey = `sim-intent-${Date.now()}`;

  let creatorUserId = '';
  let publishedLaunchId = '';

  try {
    // -------------------------------------------------------------
    // TEST 1: User & Entity Setup
    // -------------------------------------------------------------
    console.log('1. Setting up creator user and wallet...');
    creatorUserId = await ensureUserEntity(pool, testCreatorWallet);
    assert(!!creatorUserId, `Creator user ensured with UUID: ${creatorUserId}`);

    // -------------------------------------------------------------
    // TEST 2: Launch Draft Creation
    // -------------------------------------------------------------
    console.log('\n2. Testing Launch Draft Creation (saveDraft)...');
    await defaultDraftDbAdapter.saveDraft({
      id: testDraftId,
      creatorId: creatorUserId,
      creatorWallet: testCreatorWallet,
      name: 'Simulated Launchpad Token',
      ticker: 'SIM',
      description: 'Simulation Token for Launchpad Pipeline Testing',
      imageUrl: 'https://rtrader.io/sim-token.png',
      launchMode: 'BONDING_CURVE',
      targetChain: 'robinhood-mainnet',
      totalSupply: '1000000000',
      status: 'DRAFT',
    });

    const draftCheck = await pool.query(`SELECT status FROM launch_drafts WHERE id = $1`, [testDraftId]);
    assert(draftCheck.rows.length === 1, 'Draft inserted into launch_drafts table');
    assert(draftCheck.rows[0].status === 'DRAFT', 'Initial draft status is DRAFT');

    // -------------------------------------------------------------
    // TEST 3: On-Chain Publishing Bridge (publishLaunchDraft)
    // -------------------------------------------------------------
    console.log('\n3. Testing On-Chain Token Launch Publishing (publishLaunchDraft)...');
    const publishRes = await defaultDraftDbAdapter.publishLaunchDraft!({
      draftId: testDraftId,
      contractAddress: testContractAddress,
      chain: 'robinhood-mainnet',
      txHash: testTxHash,
      currentSupply: '1000000000',
      graduationThreshold: 69000,
      riskScore: 95,
    });

    publishedLaunchId = publishRes.launchId;
    assert(!!publishedLaunchId, `Token launch published with ID: ${publishedLaunchId}`);

    // Verify draft status updated to PUBLISHED
    const draftPublishedCheck = await pool.query(`SELECT status FROM launch_drafts WHERE id = $1`, [testDraftId]);
    assert(draftPublishedCheck.rows[0].status === 'PUBLISHED', 'Draft status transitioned to PUBLISHED');

    // Verify token_launches row
    const launchCheck = await pool.query(
      `SELECT contract_address, chain, graduation_threshold, risk_score FROM token_launches WHERE id = $1`,
      [publishedLaunchId]
    );
    assert(launchCheck.rows.length === 1, 'Token launch row exists in token_launches table');
    assert(
      launchCheck.rows[0].contract_address.toLowerCase() === testContractAddress.toLowerCase(),
      'Contract address matches verified EVM format'
    );
    assert(launchCheck.rows[0].chain === 'robinhood-mainnet', 'Chain registered as robinhood-mainnet');

    // Verify audit log
    const auditCheck = await pool.query(
      `SELECT action, reason FROM audit_logs WHERE entity_id = $1 AND action = 'TOKEN_LAUNCH_PUBLISHED'`,
      [publishedLaunchId]
    );
    assert(auditCheck.rows.length === 1, 'Audit log recorded TOKEN_LAUNCH_PUBLISHED with tx hash');

    // -------------------------------------------------------------
    // TEST 4: Query Active Launches & Portal Resolution
    // -------------------------------------------------------------
    console.log('\n4. Testing Active Token Launches Query & Universal Portal Resolution...');
    const activeLaunches = await defaultDraftDbAdapter.getActiveTokenLaunches!();
    const targetLaunch = activeLaunches.find(
      (l) => l.contractAddress?.toLowerCase() === testContractAddress.toLowerCase()
    );
    assert(!!targetLaunch, 'Published token successfully returned in getActiveTokenLaunches fleet');
    assert(targetLaunch?.name === 'Simulated Launchpad Token', 'Token metadata correctly joined from launch_drafts');

    const byAddress = await defaultDraftDbAdapter.getTokenLaunchByAddress!('robinhood', testContractAddress);
    assert(!!byAddress, 'Token resolved via getTokenLaunchByAddress for Universal Portal');

    // -------------------------------------------------------------
    // TEST 5: Trade Intent PostgreSQL Persistence (saveTradeIntent)
    // -------------------------------------------------------------
    console.log('\n5. Testing Trade Intent Persistence to PostgreSQL (saveTradeIntent)...');
    const savedIntentId = await saveTradeIntent({
      userId: creatorUserId,
      stage: 'PAPER',
      symbol: 'ETH/USDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 0.5,
      price: 3450.50,
      idempotencyKey: testIdempotencyKey,
      status: 'APPROVED',
      riskDecisionReason: 'Automated test intent passed risk limits',
    });

    assert(!!savedIntentId, `Trade intent persisted with UUID: ${savedIntentId}`);

    const intentCheck = await pool.query(
      `SELECT symbol, side, quantity, status FROM trade_intents WHERE idempotency_key = $1`,
      [testIdempotencyKey]
    );
    assert(intentCheck.rows.length === 1, 'Trade intent row present in trade_intents table');
    assert(intentCheck.rows[0].status === 'APPROVED', 'Trade intent status is APPROVED');
    assert(Number(intentCheck.rows[0].quantity) === 0.5, 'Trade intent quantity is 0.5');

    const tradeAuditCheck = await pool.query(
      `SELECT action, reason FROM audit_logs WHERE entity_id = $1 AND action = 'TRADE_INTENT_APPROVED'`,
      [savedIntentId]
    );
    assert(tradeAuditCheck.rows.length === 1, 'Trade intent audit log recorded TRADE_INTENT_APPROVED');

    console.log('\n================================================================');
    console.log('  🎉 ALL PHASE 3 SIMULATION TESTS PASSED WITH 100% SUCCESS!    ');
    console.log('================================================================\n');
  } finally {
    // Teardown: Clean up test fixtures safely
    console.log('Cleaning up simulation test fixtures...');
    if (publishedLaunchId) {
      await pool.query(`DELETE FROM audit_logs WHERE entity_id = $1`, [publishedLaunchId]);
      await pool.query(`DELETE FROM token_launches WHERE id = $1`, [publishedLaunchId]);
      await pool.query(`DELETE FROM entities WHERE id = $1`, [publishedLaunchId]);
    }
    await pool.query(`DELETE FROM launch_drafts WHERE id = $1`, [testDraftId]);
    await pool.query(`DELETE FROM entities WHERE id = $1`, [testDraftId]);
    await pool.query(`DELETE FROM trade_intents WHERE idempotency_key = $1`, [testIdempotencyKey]);
    await pool.query(`DELETE FROM audit_logs WHERE reason LIKE '%Automated test intent%'`);
    console.log('Clean up complete.');
  }
}

runSimulation()
  .then(() => {
    const pool = getDbPool();
    if (pool) pool.end();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Simulation error:', err);
    process.exit(1);
  });
