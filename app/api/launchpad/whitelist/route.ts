import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';
import { LaunchDraftService } from '@packages/launchpad/launch-draft-service';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tokenAddress = searchParams.get('tokenAddress') || '';
  const walletAddress = searchParams.get('walletAddress') || '';
  const rawWhitelist = searchParams.get('whitelist') || '';

  if (!walletAddress) {
    const res: ApiResponse<null> = {
      success: false,
      error: { code: 'MISSING_WALLET', message: 'walletAddress query parameter is required' },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(res, { status: 400 });
  }

  const wallets = rawWhitelist ? rawWhitelist.split(',').map((w) => w.trim()).filter(Boolean) : [walletAddress];
  const tree = LaunchDraftService.generateMerkleTree(wallets);
  const proof = tree.getProof(walletAddress);
  const isWhitelisted = wallets.map((w) => w.toLowerCase()).includes(walletAddress.toLowerCase());

  const response: ApiResponse<{
    tokenAddress: string;
    walletAddress: string;
    isWhitelisted: boolean;
    merkleRoot: string;
    merkleProof: string[];
  }> = {
    success: true,
    data: {
      tokenAddress,
      walletAddress,
      isWhitelisted,
      merkleRoot: tree.root,
      merkleProof: proof,
    },
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
