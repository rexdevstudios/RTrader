#!/usr/bin/env bun
/**
 * scripts/test-blackbox-suite.ts
 *
 * Comprehensive Blackbox Testing Suite for RTrader SocialFi Platform:
 * Tests the system strictly as an external client / caller over HTTP:
 * 1. HTTP Security Headers Audit (HSTS, CSP, Frame Options, Sniffing)
 * 2. System Overview & Macro Telemetry APIs
 * 3. Active Token Fleet Query Contract
 * 4. Merkle Bounty Claim Verification & Unregistered Wallet Fallbacks
 * 5. On-Chain Settle API Input Fuzzing & RPC Validation
 * 6. Launchpad Publish API Boundary & Format Validation
 * 7. DEX Graduation API Query & Negative Boundary Tests
 * 8. Middleware RBAC Edge Route Guard Protection
 */

const BASE_URL = process.env.TEST_TARGET_URL || 'https://rtrader-degen-platform.vercel.app';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    failedTests++;
    throw new Error(`Assertion Failed: ${message}`);
  } else {
    console.log(`  ✓ ${message}`);
    passedTests++;
  }
}

async function runBlackboxSuite() {
  console.log('================================================================');
  console.log(`  BLACKBOX TESTING SUITE: LIVE EXTERNAL API & BOUNDARY FUZZING  `);
  console.log(`  Target: ${BASE_URL}`);
  console.log('================================================================\n');

  // ==========================================================================
  // TEST 1: HTTP Security Headers Audit
  // ==========================================================================
  console.log('--- [TEST 1: Edge Security Headers Audit] ---');
  const healthRes = await fetch(`${BASE_URL}/api/system/overview`);
  assert(healthRes.status === 200, `GET /api/system/overview returns HTTP 200 (Got ${healthRes.status})`);

  const headers = healthRes.headers;
  assert(headers.get('x-frame-options') === 'DENY', 'Header X-Frame-Options is DENY (Clickjacking Guard)');
  assert(headers.get('x-content-type-options') === 'nosniff', 'Header X-Content-Type-Options is nosniff (MIME Sniff Guard)');
  assert(headers.has('strict-transport-security'), 'Header Strict-Transport-Security (HSTS) is present');
  assert(headers.has('referrer-policy'), 'Header Referrer-Policy is configured');

  // ==========================================================================
  // TEST 2: System Health & Macro Signals
  // ==========================================================================
  console.log('\n--- [TEST 2: System Health & Macro Telemetry Contracts] ---');
  const healthJson = await healthRes.json();
  assert(healthJson.status === 'ok' || healthJson.success === true, 'System overview payload reports healthy status');

  const macroRes = await fetch(`${BASE_URL}/api/market/macro`);
  assert(macroRes.status === 200, 'GET /api/market/macro returns HTTP 200');
  const macroJson = await macroRes.json();
  assert(macroJson.success === true, 'Macro telemetry returns success: true');
  assert(typeof macroJson.data?.totalDefiTvlUsd === 'number', 'Total Defi TVL is valid number');
  assert(macroJson.data.totalDefiTvlUsd > 0, `Total Defi TVL is positive ($${(macroJson.data.totalDefiTvlUsd / 1e9).toFixed(2)}B)`);
  assert(typeof macroJson.data?.macroSentiment === 'string', 'Macro sentiment signal is present');

  // ==========================================================================
  // TEST 3: Launchpad Fleet Query Contract
  // ==========================================================================
  console.log('\n--- [TEST 3: Launchpad Active Token Fleet Contract] ---');
  const tokensRes = await fetch(`${BASE_URL}/api/launchpad/tokens`);
  assert(tokensRes.status === 200, 'GET /api/launchpad/tokens returns HTTP 200');
  const tokensJson = await tokensRes.json();
  assert(tokensJson.success === true, 'Active tokens response has success: true');
  assert(Array.isArray(tokensJson.data), 'Active tokens payload is an Array');
  assert(tokensJson.data.length > 0, `Active tokens fleet contains live launches (Count: ${tokensJson.data.length})`);

  const firstToken = tokensJson.data[0];
  assert(typeof firstToken.contractAddress === 'string', 'Token contains contractAddress');
  assert(firstToken.contractAddress.startsWith('0x'), 'contractAddress is valid EVM hex address');
  assert(typeof firstToken.chain === 'string', 'Token specifies network chain');
  assert(typeof firstToken.isGraduated === 'boolean', 'Token specifies isGraduated flag');

  // ==========================================================================
  // TEST 4: Bounty Claim & Merkle Proof Query
  // ==========================================================================
  console.log('\n--- [TEST 4: Merkle Bounty Claim Contract & Negative Queries] ---');
  // 4.1 Missing Parameters
  const missingParamRes = await fetch(`${BASE_URL}/api/launchpad/bounty/claim`);
  assert(missingParamRes.status === 400, 'Missing campaignId/wallet returns HTTP 400 Bad Request');

  // 4.2 Unregistered Random Wallet (Must not crash, must return isEligible: false)
  const randomWallet = '0x1234567890123456789012345678901234567890';
  const unregRes = await fetch(
    `${BASE_URL}/api/launchpad/bounty/claim?campaignId=a2be3882-2861-49be-8acc-b4ace0ec993d&walletAddress=${randomWallet}`
  );
  assert(unregRes.status === 200, 'Query with unregistered wallet returns HTTP 200');
  const unregJson = await unregRes.json();
  assert(unregJson.success === true, 'Unregistered wallet query has success: true');
  assert(unregJson.data.isEligible === false, 'Unregistered wallet isEligible is FALSE');
  assert(Array.isArray(unregJson.data.merkleProof), 'merkleProof is an Array');
  assert(unregJson.data.merkleProof.length === 0, 'Unregistered wallet receives empty merkleProof array');

  // ==========================================================================
  // TEST 5: On-Chain Claim Settlement Boundary Fuzzing
  // ==========================================================================
  console.log('\n--- [TEST 5: On-Chain Settle API Input Fuzzing] ---');
  // 5.1 Invalid JSON payload
  const badJsonRes = await fetch(`${BASE_URL}/api/launchpad/bounty/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'this is not json{',
  });
  assert(badJsonRes.status === 400 || badJsonRes.status === 500, 'Malformed JSON rejected');

  // 5.2 Missing parameters
  const emptyBodyRes = await fetch(`${BASE_URL}/api/launchpad/bounty/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(emptyBodyRes.status === 400, 'Empty settle payload returns HTTP 400');
  const emptyBodyJson = await emptyBodyRes.json();
  const emptyErr = typeof emptyBodyJson.error === 'string' ? emptyBodyJson.error : emptyBodyJson.error?.code || '';
  assert(emptyErr.includes('INVALID_CLAIM_ID') || emptyErr.includes('MISSING_PARAMETERS'), 'Returns INVALID_CLAIM_ID or MISSING_PARAMETERS');

  // 5.3 Malformed UUID
  const badUuidRes = await fetch(`${BASE_URL}/api/launchpad/bounty/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claimId: 'not-a-uuid', txHash: '0x123' }),
  });
  assert(badUuidRes.status === 400, 'Invalid UUID rejected with HTTP 400');
  const badUuidJson = await badUuidRes.json();
  const uuidErr = typeof badUuidJson.error === 'string' ? badUuidJson.error : badUuidJson.error?.code || '';
  assert(uuidErr.includes('INVALID_CLAIM_ID'), 'Returns INVALID_CLAIM_ID code');

  // 5.4 Malformed txHash (not 32-byte hex)
  const badTxRes = await fetch(`${BASE_URL}/api/launchpad/bounty/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      claimId: '00000000-0000-4000-8000-000000000000',
      txHash: '0xinvalidhash',
    }),
  });
  assert(badTxRes.status === 400, 'Invalid txHash format rejected with HTTP 400');
  const badTxJson = await badTxRes.json();
  const txErr = typeof badTxJson.error === 'string' ? badTxJson.error : badTxJson.error?.code || '';
  assert(txErr.includes('INVALID_TX_HASH'), 'Returns INVALID_TX_HASH code');

  // ==========================================================================
  // TEST 6: Launchpad Publish API Boundary Fuzzing
  // ==========================================================================
  console.log('\n--- [TEST 6: Launchpad Publish API Boundary Fuzzing] ---');
  // 6.1 Missing parameters
  const pubEmptyRes = await fetch(`${BASE_URL}/api/launchpad/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert(pubEmptyRes.status === 400, 'Empty publish payload rejected with HTTP 400');

  // 6.2 Invalid draftId format
  const pubBadDraftRes = await fetch(`${BASE_URL}/api/launchpad/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftId: 'non-uuid-string', contractAddress: '0x123' }),
  });
  assert(pubBadDraftRes.status === 400, 'Non-UUID draftId rejected with HTTP 400');
  const pubBadDraftJson = await pubBadDraftRes.json();
  assert(pubBadDraftJson.error.code === 'INVALID_DRAFT_ID', 'Returns INVALID_DRAFT_ID');

  // 6.3 Invalid contractAddress format
  const pubBadContractRes = await fetch(`${BASE_URL}/api/launchpad/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      draftId: 'd4e5f6a7-b8c9-4012-8345-6789abcdef01',
      contractAddress: '0xinvalidcontract',
    }),
  });
  assert(pubBadContractRes.status === 400, 'Non-EVM contractAddress rejected with HTTP 400');
  const pubBadContractJson = await pubBadContractRes.json();
  assert(pubBadContractJson.error.code === 'INVALID_CONTRACT_ADDRESS', 'Returns INVALID_CONTRACT_ADDRESS');

  // ==========================================================================
  // TEST 7: DEX Graduation API Boundary & Query Fuzzing
  // ==========================================================================
  console.log('\n--- [TEST 7: DEX Graduation API Boundary & Query Tests] ---');
  // 7.1 Valid token graduation query
  const gradQueryRes = await fetch(
    `${BASE_URL}/api/launchpad/graduate?contractAddress=0xa5f832390447b050955d7b734a9a2fa861b4d3ab&chain=robinhood`
  );
  assert(gradQueryRes.status === 200, 'GET /api/launchpad/graduate with valid token returns HTTP 200');
  const gradQueryJson = await gradQueryRes.json();
  assert(gradQueryJson.success === true, 'Graduation query returns success: true');
  assert(gradQueryJson.data.ticker === 'NOIR', 'Resolved correct token ticker');
  assert(typeof gradQueryJson.data.dexDetails?.dexPairAddress === 'string', 'Returns derived/registered dexPairAddress');
  assert(gradQueryJson.data.dexDetails.dexPairAddress.startsWith('0x'), 'dexPairAddress is valid EVM hex');

  // 7.2 Missing query parameter
  const gradMissingRes = await fetch(`${BASE_URL}/api/launchpad/graduate`);
  assert(gradMissingRes.status === 400, 'GET /api/launchpad/graduate without params returns HTTP 400');

  // 7.3 Non-existent token query
  const gradNotFoundRes = await fetch(
    `${BASE_URL}/api/launchpad/graduate?contractAddress=0x0000000000000000000000000000000000000000`
  );
  assert(gradNotFoundRes.status === 404, 'GET /api/launchpad/graduate for unlisted token returns HTTP 404');

  // 7.4 POST Graduation invalid contractAddress
  const gradBadPostRes = await fetch(`${BASE_URL}/api/launchpad/graduate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractAddress: '0xinvalid' }),
  });
  assert(gradBadPostRes.status === 400, 'POST /api/launchpad/graduate with invalid address returns HTTP 400');
  const gradBadPostJson = await gradBadPostRes.json();
  assert(gradBadPostJson.error.code === 'INVALID_CONTRACT_ADDRESS', 'Returns INVALID_CONTRACT_ADDRESS');

  // ==========================================================================
  // TEST 8: Protected Route RBAC / Edge Guard
  // ==========================================================================
  console.log('\n--- [TEST 8: Edge Middleware RBAC Route Protection] ---');
  // Attempt unauthenticated write to protected trade-intents route
  const unauthRes = await fetch(`${BASE_URL}/api/trade-intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol: 'ETH/USDT', quantity: 1 }),
  });
  assert(unauthRes.status === 401, 'Unauthenticated call to /api/trade-intents strictly rejected with HTTP 401');
  const unauthJson = await unauthRes.json();
  assert(unauthJson.success === false, 'Rejection response contains success: false');

  console.log('\n================================================================');
  console.log(`  🎉 BLACKBOX SUITE COMPLETED: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runBlackboxSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Blackbox testing error:', err);
    process.exit(1);
  });
