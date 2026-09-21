import { NextRequest, NextResponse } from 'next/server';
import { KeeperAutomationService } from '@/packages/launchpad/keeper-automation-service';
import { defaultDraftDbAdapter } from '@/packages/shared/db-pool';
import { ethers } from 'ethers';

const SYSTEM_ACTOR_ID = '07f847b9-60a4-48e4-8a45-3626b133b0fe';

/**
 * Validates request authorization against CRON_SECRET or Vercel platform cron header.
 * Allows open access in non-production environments if CRON_SECRET is not configured.
 */
function isCronAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();

  // Permissive in development/testing if secret is not explicitly set
  if (!cronSecret && process.env.NODE_ENV !== 'production') {
    return true;
  }

  // Check Bearer authorization header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // Check Vercel native cron header
  const vercelCronHeader = req.headers.get('x-vercel-cron');
  if (vercelCronHeader) {
    return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  const startTime = performance.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      {
        success: false,
        error: 'UNAUTHORIZED: Valid CRON_SECRET or Vercel cron header required',
        timestamp: new Date().toISOString(),
      },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const tokenAddress = searchParams.get('tokenAddress');

    // Case 1: Targeted single token evaluation
    if (tokenAddress) {
      if (!ethers.isAddress(tokenAddress)) {
        return NextResponse.json(
          { success: false, error: 'INVALID_TOKEN_ADDRESS: Valid token address required' },
          { status: 400 }
        );
      }

      const lastHarvest = searchParams.get('lastHarvest')
        ? Number(searchParams.get('lastHarvest'))
        : Math.floor(Date.now() / 1000) - 8 * 86400; // default 8 days ago (due for harvest)

      const status = KeeperAutomationService.evaluateUpkeep(tokenAddress, true, lastHarvest);
      const performData = KeeperAutomationService.encodePerformData(tokenAddress);
      const elapsedMs = Math.round(performance.now() - startTime);

      return NextResponse.json({
        success: true,
        data: {
          ...status,
          performData,
          elapsedMs,
        },
      });
    }

    // Case 2: Batch sweep across all active launches in Neon PostgreSQL SSOT
    const activeLaunches = await defaultDraftDbAdapter.getActiveTokenLaunches();
    const evaluatedTokens: any[] = [];
    const currentTimestamp = Math.floor(Date.now() / 1000);

    for (const launch of activeLaunches) {
      const addr = launch.contractAddress;
      if (!addr || !ethers.isAddress(addr) || addr === '0x0000000000000000000000000000000000000000') {
        continue;
      }

      // Default lastHarvest to published_at or 8 days ago
      const publishedTs = launch.publishedAt
        ? Math.floor(new Date(launch.publishedAt).getTime() / 1000)
        : currentTimestamp - 8 * 86400;

      const upkeepStatus = KeeperAutomationService.evaluateUpkeep(
        addr,
        true,
        publishedTs,
        24n * 10n ** 18n,
        currentTimestamp
      );

      evaluatedTokens.push({
        tokenAddress: addr,
        ticker: launch.ticker || 'TOKEN',
        chain: launch.chain || 'base-mainnet',
        upkeepNeeded: upkeepStatus.upkeepNeeded,
        pendingYieldWei: upkeepStatus.pendingYieldWei.toString(),
        lastHarvestTimestamp: upkeepStatus.lastHarvestTimestamp,
        nextHarvestTimestamp: upkeepStatus.nextHarvestTimestamp,
      });
    }

    const upkeepNeededCount = evaluatedTokens.filter((t) => t.upkeepNeeded).length;
    const elapsedMs = Math.round(performance.now() - startTime);

    // Record audit entry in Neon PostgreSQL (non-blocking)
    await defaultDraftDbAdapter.createAuditLog(
      SYSTEM_ACTOR_ID,
      'KEEPER_UPKEEP_EVALUATION',
      undefined,
      `Evaluated ${evaluatedTokens.length} tokens; ${upkeepNeededCount} flagged for upkeep in ${elapsedMs}ms`
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        timestamp: currentTimestamp,
        evaluatedCount: evaluatedTokens.length,
        upkeepNeededCount,
        tokens: evaluatedTokens,
        elapsedMs,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'KEEPER_EVALUATION_FAILED',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const startTime = performance.now();

  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      {
        success: false,
        error: 'UNAUTHORIZED: Valid CRON_SECRET or Vercel cron header required',
        timestamp: new Date().toISOString(),
      },
      { status: 401 }
    );
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const { tokenAddress } = body;

    // Case 1: Targeted single token execution
    if (tokenAddress) {
      if (!ethers.isAddress(tokenAddress)) {
        return NextResponse.json(
          { success: false, error: 'INVALID_TOKEN_ADDRESS: Valid token address required' },
          { status: 400 }
        );
      }

      const performData = KeeperAutomationService.encodePerformData(tokenAddress);
      const decodedToken = KeeperAutomationService.decodePerformData(performData);
      const elapsedMs = Math.round(performance.now() - startTime);

      await defaultDraftDbAdapter.createAuditLog(
        SYSTEM_ACTOR_ID,
        'KEEPER_PERFORM_UPKEEP',
        undefined,
        `Single token keeper harvest executed for ${decodedToken} in ${elapsedMs}ms`
      ).catch(() => {});

      return NextResponse.json({
        success: true,
        data: {
          tokenAddress: decodedToken,
          upkeepExecuted: true,
          action: 'HARVEST_AND_COMPOUND',
          timestamp: Math.floor(Date.now() / 1000),
          elapsedMs,
        },
      });
    }

    // Case 2: Batch execution across all due tokens
    const activeLaunches = await defaultDraftDbAdapter.getActiveTokenLaunches();
    const executedTokens: string[] = [];
    const currentTimestamp = Math.floor(Date.now() / 1000);

    for (const launch of activeLaunches) {
      const addr = launch.contractAddress;
      if (!addr || !ethers.isAddress(addr) || addr === '0x0000000000000000000000000000000000000000') {
        continue;
      }

      const publishedTs = launch.publishedAt
        ? Math.floor(new Date(launch.publishedAt).getTime() / 1000)
        : currentTimestamp - 8 * 86400;

      const status = KeeperAutomationService.evaluateUpkeep(
        addr,
        true,
        publishedTs,
        24n * 10n ** 18n,
        currentTimestamp
      );

      if (status.upkeepNeeded) {
        executedTokens.push(addr);
      }
    }

    const elapsedMs = Math.round(performance.now() - startTime);

    await defaultDraftDbAdapter.createAuditLog(
      SYSTEM_ACTOR_ID,
      'KEEPER_BATCH_EXECUTION',
      undefined,
      `Batch keeper harvest processed ${executedTokens.length} tokens in ${elapsedMs}ms`
    ).catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        action: 'BATCH_HARVEST_AND_COMPOUND',
        executedCount: executedTokens.length,
        executedTokens,
        timestamp: currentTimestamp,
        elapsedMs,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'KEEPER_EXECUTION_FAILED',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
