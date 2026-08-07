export interface DaytonaRunConfig {
  agentId: string;
  codeSnippet: string;
  environmentVars?: Record<string, string>;
  timeoutSeconds: number; // Max 300s
}

export interface DaytonaRunResult {
  runId: string;
  workspaceId: string;
  status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
  logsUrl: string;
  creditsConsumed: number;
  outputPayload?: Record<string, unknown>;
  finishedAt: string;
}

export interface SandboxDbAdapter {
  recordSandboxStart(agentId: string, workspaceId: string, codeHash: string): Promise<string>;
  recordSandboxFinish(runId: string, status: string, logsUrl: string, creditsConsumed: number): Promise<void>;
  deductUserCredits(userId: string, credits: number, description: string): Promise<void>;
}

export class DaytonaSandboxRunner {
  private static readonly COST_PER_RUN_CREDITS = 5;

  constructor(
    private daytonaApiKey: string,
    private db: SandboxDbAdapter
  ) {}

  /**
   * Eksekusi Script Agent di Daytona Cloud Sandbox (Terisolasi)
   */
  async executeSandboxRun(
    userId: string,
    config: DaytonaRunConfig
  ): Promise<DaytonaRunResult> {
    const workspaceId = `daytona-ws-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const codeHash = this.hashSnippet(config.codeSnippet);

    console.log(`[Daytona Sandbox] Provisioning isolated workspace ${workspaceId} for agent ${config.agentId}...`);

    // 1. Catat Mulai Sandbox Run di Postgres SSOT
    const runId = await this.db.recordSandboxStart(config.agentId, workspaceId, codeHash);

    try {
      // 2. Simulasi Panggilan ke Daytona Cloud API (Timeout Enforced)
      console.log(`[Daytona Sandbox] Executing agent script with timeout ${config.timeoutSeconds}s...`);

      // Mock Daytona Container Execution
      const isSuccess = true;
      const status = isSuccess ? 'COMPLETED' : 'FAILED';
      const logsUrl = `https://storage.platform.com/daytona-logs/${runId}.log`;

      // 3. Potong Kredit Usage Billing Ledger (5 Kredit)
      await this.db.deductUserCredits(userId, DaytonaSandboxRunner.COST_PER_RUN_CREDITS, `Daytona Sandbox Run: Agent ${config.agentId}`);

      // 4. Update Status SSOT -> COMPLETED
      await this.db.recordSandboxFinish(runId, status, logsUrl, DaytonaSandboxRunner.COST_PER_RUN_CREDITS);

      console.log(`[Daytona Sandbox] Run ${runId} COMPLETED successfully. Logs: ${logsUrl}`);

      return {
        runId,
        workspaceId,
        status,
        logsUrl,
        creditsConsumed: DaytonaSandboxRunner.COST_PER_RUN_CREDITS,
        outputPayload: { signal: 'BULLISH', confidence: 0.85 },
        finishedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      console.error(`[Daytona Sandbox Error] Execution failed for run ${runId}:`, err.message);
      await this.db.recordSandboxFinish(runId, 'FAILED', '', 0);
      throw err;
    }
  }

  private hashSnippet(snippet: string): string {
    let hash = 0;
    for (let i = 0; i < snippet.length; i++) {
      hash = (hash << 5) - hash + snippet.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }
}
