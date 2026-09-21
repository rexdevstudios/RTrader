// ============================================================================
// RBAC MATRIX & CRYPTOGRAPHIC SESSION SECURITY REGRESSION TEST SUITE
// ============================================================================
// NOTE: Tests 1-7 are Unit / Helper Security Tests.
//       Test 8 is a Real Next.js Route Handler Integration Test.
// ============================================================================

import { NextRequest } from 'next/server';
import {
  createSessionToken,
  verifySessionToken,
  resolveUserRoles,
  authenticateSession,
  requireCapability,
} from '../packages/auth/session';
import { RbacGuard, UserContext } from '../packages/auth/rbac-middleware';
import { POST as draftPostHandler } from '../app/api/launchpad/draft/route';
import { POST as tradePostHandler } from '../app/api/trade-intents/route';

async function runRbacSecurityTests() {
  console.log('================================================================');
  console.log('STARTING P0 RBAC MATRIX & SESSION SECURITY REGRESSION TESTS');
  console.log('================================================================\n');

  let testsPassed = 0;

  // --------------------------------------------------------------------------
  // TEST 1: Production + Missing Session Secret => Hard Failure
  // --------------------------------------------------------------------------
  console.log('[1/8] [UNIT] Testing Production + Missing Session Secret => Hard Failure...');
  const originalEnv = process.env.NODE_ENV;
  const originalVaultKey = process.env.MASTER_VAULT_KEY;
  const originalSessionSecret = process.env.SESSION_SECRET;

  try {
    (process.env as any).NODE_ENV = 'production';
    delete process.env.MASTER_VAULT_KEY;
    delete process.env.SESSION_SECRET;

    let threwExpectedError = false;
    try {
      createSessionToken({ userId: 'usr-test', walletAddress: '0x1111111111111111111111111111111111111111' });
    } catch (err: any) {
      if (err.message.includes('FATAL_CONFIG_ERROR')) {
        threwExpectedError = true;
      }
    }

    if (!threwExpectedError) {
      throw new Error('SECURITY_BREACH: Production mode allowed session creation without a configured secret!');
    }
    console.log('SUCCESS: Production environment threw FATAL_CONFIG_ERROR when secret was missing.');
    testsPassed++;
  } finally {
    (process.env as any).NODE_ENV = originalEnv;
    if (originalVaultKey) process.env.MASTER_VAULT_KEY = originalVaultKey;
    if (originalSessionSecret) process.env.SESSION_SECRET = originalSessionSecret;
  }

  // --------------------------------------------------------------------------
  // TEST 2: Production + Configured Secret => Normal Session Lifecycle Works
  // --------------------------------------------------------------------------
  console.log('\n[2/8] [UNIT] Testing Production + Configured Secret => Normal Lifecycle...');
  const testSecret = 'test-production-secret-32-bytes-long!';
  process.env.SESSION_SECRET = testSecret;

  const testWallet = '0x1234567890123456789012345678901234567890';
  const testUserId = 'usr-0x12345678';
  const validToken = createSessionToken({ userId: testUserId, walletAddress: testWallet });

  const decoded = verifySessionToken(validToken);
  if (!decoded || decoded.walletAddress.toLowerCase() !== testWallet.toLowerCase()) {
    throw new Error('TEST_FAILED: Valid session token failed verification with configured secret!');
  }
  console.log('SUCCESS: Session created and verified cleanly with explicit secret.');
  testsPassed++;

  // --------------------------------------------------------------------------
  // TEST 3: Tampered Token => Rejected (HMAC Integrity)
  // --------------------------------------------------------------------------
  console.log('\n[3/8] [UNIT] Testing Tampered Token => Rejected...');
  const raw = Buffer.from(validToken, 'base64').toString('utf8');
  const parts = raw.split(':');
  // Tamper wallet address
  const tamperedRaw = [parts[0], '0x9999999999999999999999999999999999999999', parts[2], parts[3], parts[4]].join(':');
  const tamperedToken = Buffer.from(tamperedRaw).toString('base64');
  const tamperedResult = verifySessionToken(tamperedToken);

  if (tamperedResult !== null) {
    throw new Error('SECURITY_BREACH: Tampered session token was accepted!');
  }

  // Fake unsigned legacy token
  const fakeToken = Buffer.from('usr-hacker:0xHacker:1700000000000:nonce123').toString('base64');
  if (verifySessionToken(fakeToken) !== null) {
    throw new Error('SECURITY_BREACH: Unsigned 4-part token was accepted!');
  }
  console.log('SUCCESS: All tampered and forged tokens were rejected (HMAC mismatch).');
  testsPassed++;

  // --------------------------------------------------------------------------
  // TEST 4: Database Role/Account Lookup Failure => NOT ACTIVE (Fail Closed)
  // --------------------------------------------------------------------------
  console.log('\n[4/8] [UNIT] Testing Database Failure => Fail Closed (NOT ACTIVE)...');
  const originalDbUrl = process.env.DATABASE_URL;
  try {
    // Set invalid DATABASE_URL to simulate a broken database connection
    process.env.DATABASE_URL = 'postgresql://baduser:badpass@127.0.0.1:54329/baddb?sslmode=disable';

    let dbFailClosed = false;
    try {
      await resolveUserRoles('0x7777777777777777777777777777777777777777');
    } catch (err: any) {
      if (err.message.includes('DATABASE_UNAVAILABLE')) {
        dbFailClosed = true;
      }
    }

    if (!dbFailClosed) {
      throw new Error('SECURITY_BREACH: Database failure did NOT fail closed! It may have returned ACTIVE status.');
    }
    console.log('SUCCESS: Database error threw DATABASE_UNAVAILABLE and did NOT return ACTIVE status.');
    testsPassed++;
  } finally {
    if (originalDbUrl) {
      process.env.DATABASE_URL = originalDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  }

  // --------------------------------------------------------------------------
  // TEST 5: Existing Valid TRADER => Still Works
  // --------------------------------------------------------------------------
  console.log('\n[5/8] [UNIT] Testing Existing Valid TRADER => Still Works...');
  const traderContext: UserContext = {
    userId: 'usr-trader-1',
    roles: ['TRADER'],
    status: 'ACTIVE',
  };

  // Trader can trade
  RbacGuard.authorize(traderContext, 'TRADE_MANUALLY');

  // Trader CANNOT create launch draft
  let traderDraftBlocked = false;
  try {
    RbacGuard.authorize(traderContext, 'CREATE_LAUNCH_DRAFT');
  } catch (err: any) {
    if (err.message.includes('RBAC_FORBIDDEN')) {
      traderDraftBlocked = true;
    }
  }

  if (!traderDraftBlocked) {
    throw new Error('SECURITY_BREACH: TRADER was permitted to execute CREATE_LAUNCH_DRAFT!');
  }
  console.log('SUCCESS: TRADER role allows TRADE_MANUALLY and correctly blocks CREATE_LAUNCH_DRAFT.');
  testsPassed++;

  // --------------------------------------------------------------------------
  // TEST 6: Existing Valid CREATOR => Still Works
  // --------------------------------------------------------------------------
  console.log('\n[6/8] [UNIT] Testing Existing Valid CREATOR => Still Works...');
  const creatorContext: UserContext = {
    userId: 'usr-creator-1',
    roles: ['CREATOR'],
    status: 'ACTIVE',
  };

  RbacGuard.authorize(creatorContext, 'CREATE_LAUNCH_DRAFT');
  RbacGuard.authorize(creatorContext, 'TRADE_MANUALLY');
  console.log('SUCCESS: CREATOR role allows CREATE_LAUNCH_DRAFT and TRADE_MANUALLY.');
  testsPassed++;

  // --------------------------------------------------------------------------
  // TEST 7: Existing Valid Admin => Still Works
  // --------------------------------------------------------------------------
  console.log('\n[7/8] [UNIT] Testing Existing Valid Admin => Still Works...');
  const adminContext: UserContext = {
    userId: 'usr-admin-1',
    roles: ['SUPER_ADMIN'],
    status: 'ACTIVE',
  };

  RbacGuard.authorize(adminContext, 'CREATE_LAUNCH_DRAFT');
  RbacGuard.authorize(adminContext, 'TRADE_MANUALLY');
  RbacGuard.authorize(adminContext, 'FREEZE_TOKEN');
  RbacGuard.authorize(adminContext, 'OVERRIDE_RISK_ENGINE');
  console.log('SUCCESS: SUPER_ADMIN role authorizes all operations.');
  testsPassed++;

  // --------------------------------------------------------------------------
  // TEST 8: Real Next.js Route Handler Execution (Integration Test)
  // --------------------------------------------------------------------------
  console.log('\n[8/8] [INTEGRATION] Testing Real Next.js Route Handlers (POST /api/launchpad/draft & /api/trade-intents)...');

  // 8A. Test POST /api/launchpad/draft with TRADER token => Must return HTTP 403
  const draftReqTrader = new NextRequest('http://localhost:3000/api/launchpad/draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + validToken,
    },
    body: JSON.stringify({
      name: 'Forbidden Test Token',
      ticker: 'FORBID',
      description: 'Testing 403',
      imageUrl: 'https://rtrader.io/icon.png',
      launchMode: 'BONDING_CURVE',
      targetChain: 'base-mainnet',
      totalSupply: '1000000000',
      creatorAllocationPct: 0.0,
      socialLinks: {},
    }),
  });

  const draftResTrader = await draftPostHandler(draftReqTrader);
  if (draftResTrader.status !== 403) {
    throw new Error(`SECURITY_BREACH: Real route handler returned HTTP ${draftResTrader.status}, expected 403!`);
  }
  const draftJsonTrader = await draftResTrader.json();
  if (draftJsonTrader.error?.code !== 'FORBIDDEN') {
    throw new Error('TEST_FAILED: Route handler did not return FORBIDDEN error code!');
  }
  console.log('SUCCESS: Real POST /api/launchpad/draft returned HTTP 403 FORBIDDEN for authenticated TRADER.');

  // 8B. Test POST /api/launchpad/draft without token => Must return HTTP 401
  const draftReqUnauth = new NextRequest('http://localhost:3000/api/launchpad/draft', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Unauth Token', ticker: 'UNAUTH' }),
  });

  const draftResUnauth = await draftPostHandler(draftReqUnauth);
  if (draftResUnauth.status !== 401) {
    throw new Error(`SECURITY_BREACH: Real route handler returned HTTP ${draftResUnauth.status}, expected 401!`);
  }
  console.log('SUCCESS: Real POST /api/launchpad/draft returned HTTP 401 UNAUTHORIZED for missing session.');

  // 8C. Test POST /api/trade-intents with valid TRADER token => Must return HTTP 200
  const tradeReq = new NextRequest('http://localhost:3000/api/trade-intents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + validToken,
    },
    body: JSON.stringify({
      stage: 'PAPER',
      symbol: 'DEGEN/USDT',
      side: 'BUY',
      type: 'MARKET',
      quantity: 1.0,
      maxSlippagePct: 1.0,
    }),
  });

  const tradeRes = await tradePostHandler(tradeReq);
  if (tradeRes.status !== 200) {
    throw new Error(`TEST_FAILED: Real trade handler returned HTTP ${tradeRes.status}, expected 200!`);
  }
  const tradeJson = await tradeRes.json();
  if (!tradeJson.success || !tradeJson.data?.tradeIntentId) {
    throw new Error('TEST_FAILED: Trade intent was not created successfully!');
  }
  console.log('SUCCESS: Real POST /api/trade-intents returned HTTP 200 for authenticated TRADER.');
  testsPassed++;

  console.log('\n================================================================');
  console.log(`ALL ${testsPassed}/8 P0 SECURITY & ROUTE INTEGRATION TESTS PASSED CLEANLY!`);
  console.log('================================================================');
}

runRbacSecurityTests().catch((err) => {
  console.error('\n❌ P0 SECURITY TEST SUITE FAILED:', err);
  process.exit(1);
});
