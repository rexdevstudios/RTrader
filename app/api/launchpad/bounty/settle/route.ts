import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { defaultBountyDbAdapter } from '@/packages/shared/db-pool';

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { claimId, txHash, chain } = body;

    // 1. Input Validation
    if (!claimId || !isUuid(claimId)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_CLAIM_ID: Format UUID klaim tidak valid.' },
        { status: 400 }
      );
    }

    if (!txHash || !ethers.isHexString(txHash, 32)) {
      return NextResponse.json(
        { success: false, error: 'INVALID_TX_HASH: Hash transaksi harus berformat 32-byte hex (0x...).' },
        { status: 400 }
      );
    }

    // 2. Multi-Chain RPC Node Selection
    const isRobinhood =
      String(chain || '').toLowerCase().includes('robinhood') ||
      String(chain || '').toLowerCase() === '0x1237' ||
      String(chain || '') === '4663';

    const rpcUrl = isRobinhood
      ? 'https://rpc.mainnet.chain.robinhood.com'
      : 'https://mainnet.base.org';

    let blockNumber: number | undefined;

    // 3. Optional On-Chain Receipt Verification (with graceful network timeout)
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        if (receipt.status === 0) {
          return NextResponse.json(
            { success: false, error: 'TRANSACTION_REVERTED_ONCHAIN: Transaksi gagal dieksekusi di blockchain.' },
            { status: 400 }
          );
        }
        blockNumber = receipt.blockNumber;
      }
    } catch (rpcErr: any) {
      console.warn('[POST /api/launchpad/bounty/settle] RPC verification warning (non-blocking):', rpcErr?.message);
    }

    // 4. Settle Claim Idempotently in PostgreSQL SSOT
    await defaultBountyDbAdapter.settleClaimOnChain?.(claimId, txHash, blockNumber);

    return NextResponse.json({
      success: true,
      message: 'Klaim reward SocialFi berhasil diselesaikan on-chain.',
      data: {
        claimId,
        txHash,
        blockNumber: blockNumber || null,
        status: 'CLAIMED',
        settledAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error('[POST /api/launchpad/bounty/settle] Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'INTERNAL_SERVER_ERROR' },
      { status: 500 }
    );
  }
}
