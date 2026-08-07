import { OrderSide } from '../shared/types/domain';
import { IntelligenceSignal } from '../intelligence/feature-engine';

export interface AgentProposalInput {
  agentId: string;
  userId: string;
  targetSymbol: string;
  action: OrderSide;
  suggestedQty: number;
  suggestedPrice?: number;
  rationale: string;
  confidenceScore: number; // 0.0 - 1.0
  validityMinutes?: number; // Default 15 mins
}

export interface AgentProposalRecord extends AgentProposalInput {
  id: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  intelligenceSignal?: IntelligenceSignal; // attached for audit trail
}

export interface ProposalDbAdapter {
  createProposal(proposal: Omit<AgentProposalRecord, 'id'>): Promise<string>;
  getProposalById(proposalId: string): Promise<AgentProposalRecord | null>;
  updateProposalStatus(proposalId: string, status: string): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

/**
 * Input untuk proposal yang menggunakan IntelligenceSignal sebagai sumber utama.
 * confidenceScore dan rationale diturunkan dari FeatureEngine — bukan manual input.
 */
export interface IntelligenceEnrichedProposalInput {
  agentId: string;
  userId: string;
  targetSymbol: string;
  action: OrderSide;
  suggestedQty: number;
  suggestedPrice?: number;
  intelligenceSignal: IntelligenceSignal; // required — from FeatureEngine.computeSignal()
  validityMinutes?: number;
}

export class AgentProposalEngine {
  /**
   * [ORIGINAL] Generasi Proposal AI Agent (Proposal Only Model - No Direct Execution)
   * Dipertahankan 100% untuk backward-compatibility — menerima confidenceScore manual.
   */
  static async generateProposal(
    input: AgentProposalInput,
    db: ProposalDbAdapter
  ): Promise<AgentProposalRecord> {
    const validityMs = (input.validityMinutes || 15) * 60 * 1000;
    const expiresAt = new Date(Date.now() + validityMs).toISOString();

    const proposalRecord: Omit<AgentProposalRecord, 'id'> = {
      ...input,
      status: 'PENDING_APPROVAL',
      expiresAt,
      createdAt: new Date().toISOString(),
    };

    const id = await db.createProposal(proposalRecord);

    // Audit Trail
    await db.createAuditLog(
      input.userId,
      'AGENT_PROPOSAL_GENERATED',
      id,
      `AI Agent ${input.agentId} proposed ${input.action} ${input.targetSymbol} (Confidence: ${input.confidenceScore})`
    );

    return { id, ...proposalRecord };
  }

  /**
   * [NEW — Phase D] Generasi Proposal dengan Intelligence Signal terkomputasi dari FeatureEngine.
   *
   * - confidenceScore diisi dari IntelligenceSignal.computedConfidenceScore (bukan manual).
   * - rationale diisi dari IntelligenceSignal.rationale.
   * - riskFlags dari signal dicatat di audit log.
   * - IntelligenceSignal dilampirkan ke record untuk inspeksi dan audit.
   *
   * INVARIANT (MASTER_PROMPT.md §AI Agent Rules):
   *   Proposal ini tetap PENDING_APPROVAL — user harus approve sebelum execution.
   *   Tidak ada auto-execution. Risk Gate masih wajib dilewati setelah approval.
   */
  static async generateProposalWithIntelligence(
    input: IntelligenceEnrichedProposalInput,
    db: ProposalDbAdapter
  ): Promise<AgentProposalRecord> {
    const signal = input.intelligenceSignal;

    // Reject immediately if intelligence signal says counterparty is blocked
    if (signal.riskFlags.includes('COUNTERPARTY_BLOCKED')) {
      throw new Error(
        `PROPOSAL_INTELLIGENCE_BLOCKED: FeatureEngine detected COUNTERPARTY_BLOCKED for ${input.targetSymbol}. ` +
        `Rationale: ${signal.rationale}`
      );
    }

    // Derive confidence and rationale from the computed signal
    const confidenceScore = signal.computedConfidenceScore;
    const rationale = [
      `[Intelligence-Driven Proposal]`,
      `Symbol: ${input.targetSymbol} | Action: ${input.action} | Qty: ${input.suggestedQty}`,
      `Computed Confidence: ${(confidenceScore * 100).toFixed(1)}%`,
      `Signal Rationale: ${signal.rationale}`,
      signal.riskFlags.length > 0 ? `Risk Flags: ${signal.riskFlags.join(', ')}` : 'No risk flags.',
      `Market Context: Sentiment=${signal.inputs.webSentiment} | Counterparty=${signal.inputs.counterpartyRisk} | Volatility=${signal.inputs.marketVolatility}`,
    ].join(' | ');

    const validityMs = (input.validityMinutes || 15) * 60 * 1000;
    const expiresAt = new Date(Date.now() + validityMs).toISOString();

    const proposalRecord: Omit<AgentProposalRecord, 'id'> = {
      agentId: input.agentId,
      userId: input.userId,
      targetSymbol: input.targetSymbol,
      action: input.action,
      suggestedQty: input.suggestedQty,
      suggestedPrice: input.suggestedPrice,
      rationale,
      confidenceScore,
      validityMinutes: input.validityMinutes,
      status: 'PENDING_APPROVAL',
      expiresAt,
      createdAt: new Date().toISOString(),
      intelligenceSignal: signal,
    };

    const id = await db.createProposal(proposalRecord);

    // Detailed Audit Trail — includes risk flags and signal metadata
    await db.createAuditLog(
      input.userId,
      'AGENT_PROPOSAL_INTELLIGENCE_GENERATED',
      id,
      `Intelligence-driven proposal: ${input.action} ${input.targetSymbol} | ` +
      `Confidence=${(confidenceScore * 100).toFixed(1)}% | ` +
      `Flags=${signal.riskFlags.join(',') || 'none'} | ` +
      `Sentiment=${signal.inputs.webSentiment} | Volatility=${signal.inputs.marketVolatility}`
    );

    return { id, ...proposalRecord };
  }

  /**
   * User Approval Workflow: User menyetujui proposal AI
   */
  static async approveProposal(
    proposalId: string,
    approverUserId: string,
    db: ProposalDbAdapter
  ): Promise<AgentProposalRecord> {
    const proposal = await db.getProposalById(proposalId);
    if (!proposal) {
      throw new Error(`PROPOSAL_NOT_FOUND: Proposal ${proposalId} does not exist`);
    }

    if (proposal.userId !== approverUserId) {
      throw new Error(`PROPOSAL_UNAUTHORIZED: User ${approverUserId} is not authorized to approve proposal ${proposalId}`);
    }

    if (proposal.status !== 'PENDING_APPROVAL') {
      throw new Error(`PROPOSAL_INVALID_STATE: Proposal ${proposalId} is in state ${proposal.status}`);
    }

    // Check Expiration
    if (new Date() > new Date(proposal.expiresAt)) {
      await db.updateProposalStatus(proposalId, 'EXPIRED');
      throw new Error(`PROPOSAL_EXPIRED: Proposal ${proposalId} expired at ${proposal.expiresAt}`);
    }

    // Update Status -> APPROVED
    await db.updateProposalStatus(proposalId, 'APPROVED');

    // Audit Trail
    await db.createAuditLog(
      approverUserId,
      'AGENT_PROPOSAL_APPROVED',
      proposalId,
      `User ${approverUserId} approved AI Agent proposal ${proposalId}`
    );

    return { ...proposal, status: 'APPROVED' };
  }

  /**
   * User Rejection Workflow: User menolak proposal AI
   */
  static async rejectProposal(
    proposalId: string,
    rejecterUserId: string,
    reason: string,
    db: ProposalDbAdapter
  ): Promise<void> {
    const proposal = await db.getProposalById(proposalId);
    if (!proposal || proposal.userId !== rejecterUserId) {
      throw new Error(`PROPOSAL_UNAUTHORIZED: Unauthorized rejection`);
    }

    await db.updateProposalStatus(proposalId, 'REJECTED');

    await db.createAuditLog(
      rejecterUserId,
      'AGENT_PROPOSAL_REJECTED',
      proposalId,
      `User rejected proposal: ${reason}`
    );
  }
}


