import { NextResponse } from 'next/server';
import { SystemOrchestrator } from '../../../../../../packages/shared/orchestrator';
import { ModularRpcManager } from '../../../../../../packages/network-registry/rpc-manager';
import { DaytonaSandboxRunner } from '../../../../../execution-plane/workers/daytona-sandbox-runner';
import { FirecrawlScraperService } from '../../../../../../packages/intelligence/firecrawl-scraper';
import { ApiResponse } from '../../../../../../packages/shared/contracts/api-contracts';


// Mock DB adapters for read-only system overview query
const mockDb = {
  getEndpointsForNetwork: async () => [],
  getDomainConfig: async () => null,
  updateEndpointHealth: async () => {},
  createAuditLog: async () => {},
  recordSandboxStart: async () => 'sb-1',
  recordSandboxFinish: async () => {},
  deductUserCredits: async () => {},
  recordScrapedDocument: async () => 'doc-1',
  deductCredits: async () => {},
};

const rpcManager = new ModularRpcManager(mockDb);
const sandboxRunner = new DaytonaSandboxRunner('dtn_api_key', mockDb);
const scraperService = new FirecrawlScraperService('fc_api_key', mockDb);

const orchestrator = new SystemOrchestrator(rpcManager, sandboxRunner, scraperService);

export async function GET() {
  try {
    const overview = await orchestrator.getSystemOverview();
    const response: ApiResponse<Record<string, unknown>> = {
      success: true,
      data: overview,
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: { code: 'SERVER_ERROR', message: (err as Error).message },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(response, { status: 500 });
  }
}
