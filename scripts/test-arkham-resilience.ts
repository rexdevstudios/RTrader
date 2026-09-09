// ============================================================================
// ARKHAM INTELLIGENCE RESILIENCE & TIMEOUT TEST SUITE
// ============================================================================

import { ArkhamIntelligenceService } from '../packages/intelligence/arkham-enrichment';
import { TradingRiskGate } from '../packages/trading/risk-gate';

async function testArkhamResilience() {
  console.log('================================================================');
  console.log('STARTING ARKHAM RESILIENCE & BOUNDED TIMEOUT AUDIT');
  console.log('================================================================');

  const testWallet = '0x1234567890123456789012345678901234567890';

  // 1. Normal fallback when API key is mock
  console.log('[1/4] Testing Fallback on Unreachable/Mock URL...');
  const serviceFallback = new ArkhamIntelligenceService('mock-key', undefined, 'http://127.0.0.1:19999');
  const profile1 = await serviceFallback.profileWallet(testWallet, 'usr-test');
  if (profile1.riskPassportScore === 70 && !profile1.isCounterpartyBlocked) {
    console.log('SUCCESS: Handled unreachable URL gracefully with safe score 70');
  } else {
    console.error('FAIL: Unreachable URL did not return expected fallback profile:', profile1);
    process.exit(1);
  }

  // 2. Timeout simulation with slow local mock server
  console.log('[2/4] Testing 5000ms Bounded AbortSignal Timeout...');
  const http = require('http');
  const server = http.createServer((req: any, res: any) => {
    // Hang request for 8 seconds to exceed 5000ms timeout
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entity: { name: 'Slow Entity' } }));
    }, 8000);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;

  const startMs = Date.now();
  const serviceTimeout = new ArkhamIntelligenceService('key', undefined, `http://127.0.0.1:${port}`);
  const profileTimeout = await serviceTimeout.profileWallet(testWallet, 'usr-test');
  const elapsedMs = Date.now() - startMs;
  server.close();

  console.log(`Request resolved after ${elapsedMs}ms`);
  if (elapsedMs < 7000 && profileTimeout.riskPassportScore === 70) {
    console.log('SUCCESS: Request aborted cleanly within bounded timeout window!');
  } else {
    console.error(`FAIL: Timeout exceeded expected threshold! Elapsed: ${elapsedMs}ms`);
    process.exit(1);
  }

  // 3. HTTP 500 Server Error
  console.log('[3/4] Testing HTTP 500 Server Error Response...');
  const errorServer = http.createServer((req: any, res: any) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error' }));
  });
  await new Promise<void>((resolve) => errorServer.listen(0, resolve));
  const errPort = (errorServer.address() as any).port;

  const serviceHttpErr = new ArkhamIntelligenceService('key', undefined, `http://127.0.0.1:${errPort}`);
  const profileErr = await serviceHttpErr.profileWallet(testWallet, 'usr-test');
  errorServer.close();

  if (profileErr.riskPassportScore === 70) {
    console.log('SUCCESS: HTTP 500 returned safe fallback profile score 70');
  } else {
    console.error('FAIL: HTTP 500 did not fallback correctly');
    process.exit(1);
  }

  // 4. Deterministic Risk Gate Compatibility
  console.log('[4/4] Testing Fallback Profile through Deterministic Risk Gate...');
  const riskResult = TradingRiskGate.evaluateIntent(
    {
      symbol: 'ETH/USDT',
      side: 'BUY',
      quantity: 1,
      maxSlippagePct: 1.5,
      stage: 'TESTNET',
      arkhamRiskScore: profileTimeout.riskPassportScore,
    } as any,
    { maxOrderValueUsd: 5000, dailyLossLimitUsd: 1000, currentDailyLossUsd: 0 } as any,
    { planId: 'TRADER', hasLiveTrading: true },
    []
  );

  if (riskResult.status === 'RISK_APPROVED') {
    console.log('SUCCESS: Trade intent with fallback profile passed Risk Gate within safe bounds');
  } else {
    console.error('FAIL: Risk Gate evaluation failed:', riskResult);
    process.exit(1);
  }

  console.log('================================================================');
  console.log('✅ ALL ARKHAM RESILIENCE & TIMEOUT TESTS PASSED CLEANLY!');
  console.log('================================================================');
}

testArkhamResilience().catch((err) => {
  console.error('Arkham Resilience Test Error:', err);
  process.exit(1);
});
