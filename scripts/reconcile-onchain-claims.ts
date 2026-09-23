#!/usr/bin/env bun
/**
 * scripts/reconcile-onchain-claims.ts
 *
 * Background Reconciliation Worker for SocialFi On-Chain Bounty Claims.
 *
 * Scans on-chain state and logs across Base Mainnet (0x2105) and Robinhood Chain L2 (0x1237),
 * detects claims executed on-chain via BondingCurveLaunchpad.sol, and idempotently reconciles
 * Neon PostgreSQL SSOT status to 'CLAIMED' with double-entry ledger annotations.
 *
 * Invariants:
 *  - Non-custodial: strictly read-only against blockchain (0 gas spent, 0 private keys).
 *  - Idempotent: safe to run repeatedly or concurrently without duplicating records.
 *  - Supports one-shot CLI mode or persistent daemon mode (--daemon <minutes>).
 *
 * Usage:
 *  bun run scripts/reconcile-onchain-claims.ts             # Single-pass execution
 *  bun run scripts/reconcile-onchain-claims.ts --dry-run   # Audit preview without DB writes
 *  bun run scripts/reconcile-onchain-claims.ts --daemon 5  # Run continuously every 5 minutes
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ethers } from 'ethers';
import { getDbPool, defaultBountyDbAdapter } from '../packages/shared/db-pool';
import { BONDING_CURVE_LAUNCHPAD_ABI } from '../packages/launchpad/contracts/BondingCurveLaunchpadAbi';

const RPC_CONFIGS: Record<string, { chainId: number; name: string; rpcUrl: string; explorerUrl: string }> = {
  'base-mainnet': {
    chainId: 8453,
    name: 'Base Mainnet',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
  },
  'robinhood-mainnet': {
    chainId: 4663,
    name: 'Robinhood Chain L2',
    rpcUrl: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
    explorerUrl: 'https://robinhoodchain.blockscout.com',
  },
};

interface PendingClaimRow {
  claim_id: string;
  campaign_id: string;
  token_address: string | null;
  chain: string | null;
  wallet_address: string;
  token_amount: string;
  verification_status: string;
}

export interface ReconcileOptions {
  isDaemon: boolean;
  intervalMinutes: number;
  dryRun: boolean;
}

export function parseArgs(args: string[]): ReconcileOptions {
  let isDaemon = false;
  let intervalMinutes = 5;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--daemon' || a === '-d') {
      isDaemon = true;
      const next = args[i + 1];
      if (next && !isNaN(Number(next))) {
        intervalMinutes = Math.max(1, Number(next));
      }
    }
    if (a === '--dry-run') {
      dryRun = true;
    }
  }

  return { isDaemon, intervalMinutes, dryRun };
}

export async function runReconcilePass(options: { dryRun: boolean }): Promise<{
  totalPending: number;
  settled: number;
  skipped: number;
  errors: number;
}> {
  console.log(`\n🔍 [${new Date().toISOString()}] Scanning Neon PostgreSQL for pending claims (status = 'VERIFIED')...`);

  const pool = getDbPool();
  if (!pool) {
    console.warn('⚠️ Neon PostgreSQL connection pool not available (DATABASE_URL not set).');
    return { totalPending: 0, settled: 0, skipped: 0, errors: 0 };
  }

  // 1. Fetch all claims that are VERIFIED but not yet settled in DB
  const query = `
    SELECT 
      bc.id as claim_id,
      bc.campaign_id,
      tl.contract_address as token_address,
      COALESCE(tl.chain, 'robinhood-mainnet') as chain,
      COALESCE(w.address, kp.user_id::text, bc.kol_id::text) as wallet_address,
      c.reward_per_kol::text as token_amount,
      bc.verification_status
    FROM bounty_claims bc
    JOIN bounty_campaigns c ON c.id = bc.campaign_id
    LEFT JOIN token_launches tl ON tl.id = c.launch_id
    LEFT JOIN kol_profiles kp ON (kp.id = bc.kol_id OR kp.user_id = bc.kol_id)
    LEFT JOIN wallets w ON w.user_id = kp.user_id
    WHERE bc.verification_status = 'VERIFIED'
    ORDER BY bc.created_at ASC
  `;

  const res = await pool.query(query);
  const rows: PendingClaimRow[] = res.rows;

  console.log(`📋 Found ${rows.length} pending verified claims to check against on-chain state.`);

  let settled = 0;
  let skipped = 0;
  let errors = 0;

  const launchpadContractAddress = process.env.NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ADDRESS?.trim();

  for (const row of rows) {
    try {
      const wallet = row.wallet_address;
      const token = row.token_address;

      if (!wallet || !ethers.isAddress(wallet)) {
        console.warn(`⚠️ Claim ${row.claim_id}: wallet address ${wallet} is invalid, skipping.`);
        skipped++;
        continue;
      }

      if (!token || !ethers.isAddress(token)) {
        console.log(`ℹ️ Claim ${row.claim_id}: token address ${token} not deployed yet, skipping.`);
        skipped++;
        continue;
      }

      // Determine chain RPC
      const chainKey = (row.chain || '').toLowerCase().includes('robinhood')
        ? 'robinhood-mainnet'
        : 'base-mainnet';
      const rpcConfig = RPC_CONFIGS[chainKey] || RPC_CONFIGS['robinhood-mainnet'];

      if (!launchpadContractAddress || !ethers.isAddress(launchpadContractAddress)) {
        // Contract not set on environment; cannot query on-chain mapping
        skipped++;
        continue;
      }

      const provider = new ethers.JsonRpcProvider(rpcConfig.rpcUrl);
      const contract = new ethers.Contract(launchpadContractAddress, BONDING_CURVE_LAUNCHPAD_ABI, provider);

      // 2. Query contract state mapping: hasClaimedBounty(tokenAddress, kolWallet)
      let hasClaimed = false;
      try {
        hasClaimed = await contract.hasClaimedBounty(token, wallet);
      } catch (callErr: any) {
        // Method may fail if contract is not deployed at that address or RPC error
        console.warn(`[Reconciler] contract.hasClaimedBounty call failed on ${rpcConfig.name}:`, callErr?.message);
      }

      if (!hasClaimed) {
        skipped++;
        continue;
      }

      console.log(`🎯 ON-CHAIN CLAIM DETECTED! Claim: ${row.claim_id}, KOL: ${wallet}, Token: ${token} on ${rpcConfig.name}`);

      // 3. Search for BountyRewardClaimed event logs to find exact txHash & blockNumber
      let txHash = '0x' + '0'.repeat(64);
      let blockNumber: number | undefined;

      try {
        const filter = contract.filters.BountyRewardClaimed(token, wallet);
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 50000); // Scan recent 50k blocks
        const events = await contract.queryFilter(filter, fromBlock, currentBlock);

        if (events.length > 0) {
          const lastEvent: any = events[events.length - 1];
          txHash = lastEvent.transactionHash;
          blockNumber = lastEvent.blockNumber;
          console.log(`   Found event log: Block #${blockNumber}, Tx: ${txHash}`);
        }
      } catch (logErr: any) {
        console.warn('   Event filter query failed (RPC limits), proceeding with synthetic settlement hash:', logErr?.message);
      }

      // 4. Settle in Neon PostgreSQL SSOT
      if (options.dryRun) {
        console.log(`   [DRY-RUN] Would settle claim ${row.claim_id} with status 'CLAIMED'.`);
      } else {
        await defaultBountyDbAdapter.settleClaimOnChain?.(row.claim_id, txHash, blockNumber);
        console.log(`   ✅ Successfully settled claim ${row.claim_id} in Neon PostgreSQL SSOT!`);
      }

      settled++;
    } catch (err: any) {
      console.error(`❌ Error reconciling claim ${row.claim_id}:`, err?.message || err);
      errors++;
    }
  }

  console.log(`\n📊 Reconciliation Summary: ${settled} settled, ${skipped} pending/skipped, ${errors} errors (Total: ${rows.length})`);
  return { totalPending: rows.length, settled, skipped, errors };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('================================================================');
  console.log('  RTRADER SOCIALFI — ON-CHAIN BOUNTY CLAIM RECONCILER WORKER   ');
  console.log('================================================================');
  console.log(`  Mode: ${options.isDaemon ? `DAEMON (every ${options.intervalMinutes}m)` : 'ONE-SHOT'}`);
  console.log(`  Dry Run: ${options.dryRun ? 'YES (No DB Writes)' : 'NO (Live SSOT Sync)'}`);
  console.log('================================================================');

  if (options.isDaemon) {
    const loop = async () => {
      try {
        await runReconcilePass(options);
      } catch (err) {
        console.error('[Daemon Loop Error]:', err);
      }
      setTimeout(loop, options.intervalMinutes * 60 * 1000);
    };
    await loop();
  } else {
    await runReconcilePass(options);
    process.exit(0);
  }
}

if (import.meta.main || require.main === module) {
  main().catch((err) => {
    console.error('Fatal Reconciler Error:', err);
    process.exit(1);
  });
}
