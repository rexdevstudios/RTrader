import { OrderSide } from '../shared/types/domain';

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
}

export interface ProposalDbAdapter {
  createProposal(proposal: Omit<AgentProposalRecord, 'id'>): Promise<string>;
  getProposalById(proposalId: string): Promise<AgentProposalRecord | null>;
  updateProposalStatus(proposalId: string, status: string): Promise<void>;
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class AgentProposalEngine {
  /**
   * Generasi Proposal AI Agent (Proposal Only Model - No Direct Execution)
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
