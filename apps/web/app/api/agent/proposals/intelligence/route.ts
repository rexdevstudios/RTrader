import { NextRequest, NextResponse } from 'next/server';
import { AgentProposalEngine, ProposalDbAdapter } from '../../../../../../../packages/agent/proposal-engine';
import { FeatureEngine } from '../../../../../../../packages/intelligence/feature-engine';
import { intelligenceCache } from '../../../../../../../packages/intelligence/market-data-cache';
import { ApiResponse } from '../../../../../../../packages/shared/contracts/api-contracts';



const mockProposalDb: ProposalDbAdapter = {
  createProposal: async () => `prop-${Date.now()}`,
  getProposalById: async () => null,
  updateProposalStatus: async () => {},
  createAuditLog: async () => {},
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const symbol = body.targetSymbol || 'DEGEN/USDT';
    const action = body.action || 'BUY';
    const suggestedQty = body.suggestedQty || 100;
    const userId = body.userId || 'usr-trader';
    const agentId = body.agentId || 'agent-alpha';

    // Compute Intelligence Signal
    const signal = FeatureEngine.computeSignal(symbol, intelligenceCache, null, null);

    const proposal = await AgentProposalEngine.generateProposalWithIntelligence(
      {
        agentId,
        userId,
        targetSymbol: symbol,
        action,
        suggestedQty,
        intelligenceSignal: signal,
      },
      mockProposalDb
    );

    const response: ApiResponse<typeof proposal> = {
      success: true,
      data: proposal,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'PROPOSAL_GENERATION_FAILED', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 400 });
  }
}
