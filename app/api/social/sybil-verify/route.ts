import { NextRequest, NextResponse } from 'next/server';
import { SybilResistanceService } from '@/packages/social/sybil-resistance-service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mode, walletAddress, minScore, worldIdPayload, campaignId } = body;

    if (mode === 'WORLD_ID') {
      if (!worldIdPayload || !campaignId) {
        return NextResponse.json(
          { success: false, error: 'MISSING_FIELDS: worldIdPayload and campaignId are required for World ID verification' },
          { status: 400 }
        );
      }

      const result = SybilResistanceService.verifyWorldIdProof(worldIdPayload, campaignId);
      return NextResponse.json({
        success: result.isValid,
        data: result,
      });
    } else {
      // Default Gitcoin Passport
      if (!walletAddress) {
        return NextResponse.json(
          { success: false, error: 'MISSING_WALLET: walletAddress required for Gitcoin Passport' },
          { status: 400 }
        );
      }

      const result = SybilResistanceService.verifyGitcoinPassport(walletAddress, minScore);
      return NextResponse.json({
        success: result.passedThreshold,
        data: result,
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'SYBIL_VERIFICATION_FAILED' },
      { status: 500 }
    );
  }
}
