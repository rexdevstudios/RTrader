// ============================================================================
// REAL NEON POSTGRESQL PERSISTENCE & LIFECYCLE TEST (CROSS-PROCESS VERIFICATION)
// ============================================================================

import fs from 'fs';
import { defaultDraftDbAdapter, defaultKolDbAdapter, getDbPool, isDatabaseConfigured } from '../packages/shared/db-pool';

if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let val = trimmed.slice(idx + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

async function runPersistenceTest() {
  console.log('================================================================');
  console.log('STARTING REAL NEON POSTGRESQL PERSISTENCE & ISOLATION TEST');
  console.log('================================================================');

  if (!isDatabaseConfigured()) {
    console.error('FAIL: DATABASE_URL is not configured! Cannot run real Neon persistence test.');
    process.exit(1);
  }

  const pool = getDbPool();
  if (!pool) {
    console.error('FAIL: Could not initialize Neon connection pool!');
    process.exit(1);
  }

  const mode = process.argv[2] || 'write';
  const timestamp = Date.now();
  const testWallet = '0x1234567890123456789012345678901234567890';
  const uniqueTicker = `PST_${timestamp.toString().slice(-4)}`;
  const uniqueTwitter = `persister_${timestamp.toString().slice(-4)}`;

  if (mode === 'write') {
    console.log('[Phase 1: Process WRITE] Writing fresh state to Neon PostgreSQL...');
    
    // 1. Write Draft
    const draftRecord = {
      id: `draft-${timestamp}`,
      creatorId: `usr-${testWallet.slice(0, 8)}`,
      creatorWallet: testWallet,
      name: `Neon Persistent Token ${uniqueTicker}`,
      ticker: uniqueTicker,
      description: 'Verifying real Neon database persistence',
      launchMode: 'BONDING_CURVE',
      targetChain: 'base-mainnet',
      totalSupply: '1000000000',
      status: 'DRAFT_CREATED',
    };
    const savedDraftId = await defaultDraftDbAdapter.saveDraft(draftRecord);
    console.log(`SUCCESS: Draft written to Neon with ID: ${savedDraftId}`);

    // 2. Write KOL Profile
    const kolProfile = await defaultKolDbAdapter.upsertKolProfile({
      userId: testWallet,
      twitterHandle: uniqueTwitter,
      followersCount: 15000,
      trustScore: 92,
      isVerified: true,
    });
    console.log(`SUCCESS: KOL Profile written to Neon: @${kolProfile.twitterHandle} (Trust: ${kolProfile.trustScore})`);

    // Output keys for next process
    console.log(`PERSISTENCE_KEYS:${savedDraftId}:${testWallet}:${uniqueTwitter}`);
    process.exit(0);
  }

  if (mode === 'read') {
    const targetDraftId = process.argv[3];
    const targetWallet = process.argv[4];
    const targetTwitter = process.argv[5];

    console.log('[Phase 2: Fresh Process READ] Reading state in independent memory space...');

    // 1. Read Draft from Neon
    const drafts = await defaultDraftDbAdapter.getDrafts();
    const matchedDraft = drafts.find((d: any) => d.id === targetDraftId || d.ticker?.includes(targetDraftId));
    if (!matchedDraft) {
      console.error(`FAIL: Draft ${targetDraftId} not found in Neon database!`);
      process.exit(1);
    }
    console.log(`SUCCESS: Found persisted draft in Neon: ${matchedDraft.name} ($${matchedDraft.ticker})`);

    // 2. Read KOL Profile from Neon
    const profile = await defaultKolDbAdapter.getKolProfile(targetWallet);
    if (!profile || profile.twitterHandle !== targetTwitter) {
      console.error(`FAIL: KOL Profile for ${targetWallet} (@${targetTwitter}) not found in Neon! Found:`, profile);
      process.exit(1);
    }
    console.log(`SUCCESS: Found persisted KOL in Neon: @${profile.twitterHandle} (Trust: ${profile.trustScore}/100)`);

    // 3. Verify Fail-Closed in Production
    console.log('[Phase 3: Production Fail-Closed Security Test]...');
    const originalEnv = process.env.DATABASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      (process.env as any).NODE_ENV = 'production';
      process.env.DATABASE_URL = '';
      let caught = false;
      try {
        getDbPool();
      } catch (err: any) {
        caught = true;
        if (err.message.includes('CRITICAL_CONFIG_ERROR')) {
          console.log('SUCCESS: Production fail-closed properly threw CRITICAL_CONFIG_ERROR when DATABASE_URL is missing!');
        } else {
          console.error('FAIL: Unexpected error message:', err.message);
          process.exit(1);
        }
      }
      if (!caught) {
        console.error('FAIL: getDbPool() did not throw in production when DATABASE_URL was missing!');
        process.exit(1);
      }
    } finally {
      process.env.DATABASE_URL = originalEnv;
      (process.env as any).NODE_ENV = originalNodeEnv;
    }

    console.log('================================================================');
    console.log('✅ REAL NEON PERSISTENCE & FAIL-CLOSED TESTS PASSED 100%');
    console.log('================================================================');
    process.exit(0);
  }
}

runPersistenceTest().catch((err) => {
  console.error('Persistence Test Error:', err);
  process.exit(1);
});
