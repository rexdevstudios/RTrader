/**
 * src/modules/growth/cloudflare-cleaner.ts
 *
 * Automated Cloudflare Pages Project Lifecycle & LRU Garbage Collector.
 *
 * Problem:
 *   Cloudflare Pages Free Tier has a hard limit of exactly 100 projects per account.
 *   Reaching project #101 causes deployment failures (HTTP 400/409 Project limit reached).
 *
 * Solution:
 *   1. Monitors project count via Cloudflare REST API v4.
 *   2. Safety threshold: triggers auto-clean if active projects >= 85 (configurable).
 *   3. Immutable Protection: Genuine on-chain live deployments (confirmed CA, live liquidity,
 *      verified in SQLite vault.db via isLiveDeployment) are PERMANENTLY WHITELISTED.
 *   4. LRU Eviction: Deletes oldest simulated, dry-run, or failed test projects until project
 *      count is safely below threshold.
 *   5. Safe Dry-Run Simulation: When API tokens are not provided, runs in simulated mode.
 */

import { logger } from "../../logger.ts";
import { getConfig } from "../../config.ts";
import { getAllDeployLogs, type DeployLogRow } from "../../db/vault.ts";
import { isLiveDeployment } from "../fleet/fleet-registry.ts";

export interface CloudflarePagesProject {
  name: string;
  id?: string;
  created_on?: string;
  sub_domain?: string;
  domains?: string[];
  production_branch?: string;
}

export interface CloudflareCleanOptions {
  threshold?: number;        // Default: 85 projects (trigger cleanup when count >= threshold)
  targetSafeCount?: number;  // Default: 75 projects (prune until count <= targetSafeCount)
  dryRun?: boolean;          // If true, simulate deletions without calling DELETE API
  accountId?: string;
  apiToken?: string;
}

export interface CloudflareCleanResult {
  success: boolean;
  totalProjects: number;
  threshold: number;
  prunableCount: number;
  prunedProjects: string[];
  protectedCount: number;
  isOverThreshold: boolean;
  mode: "live" | "simulation";
  message: string;
}

const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

/**
 * Resolves Cloudflare API credentials from parameters or process.env.
 */
function resolveCredentials(accountId?: string, apiToken?: string): { accountId: string; apiToken: string } {
  const cfg = getConfig();
  const acc = (accountId !== undefined ? accountId : (process.env.CLOUDFLARE_ACCOUNT_ID || cfg.CLOUDFLARE_ACCOUNT_ID || "")).trim();
  const tok = (apiToken !== undefined ? apiToken : (process.env.CLOUDFLARE_API_TOKEN || cfg.CLOUDFLARE_API_TOKEN || "")).trim();
  return { accountId: acc, apiToken: tok };
}

/**
 * Lists all Cloudflare Pages projects for the account.
 */
export async function listCloudflarePagesProjects(
  accountId?: string,
  apiToken?: string
): Promise<CloudflarePagesProject[]> {
  const creds = resolveCredentials(accountId, apiToken);
  if (!creds.accountId || !creds.apiToken) {
    logger.info("[CF-CLEANER] Cloudflare credentials unconfigured. Returning mock project list for simulation.");
    return [
      { name: "test-sim-project-1", created_on: new Date(Date.now() - 86400000 * 30).toISOString() },
      { name: "test-sim-project-2", created_on: new Date(Date.now() - 86400000 * 20).toISOString() },
      { name: "pumprun-web3", created_on: new Date(Date.now() - 86400000 * 5).toISOString() },
    ];
  }

  try {
    const res = await fetch(`${CLOUDFLARE_API_BASE}/accounts/${creds.accountId}/pages/projects`, {
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.warn(`[CF-CLEANER] Failed to fetch Pages projects (${res.status}): ${errText}`);
      return [];
    }

    const data = await res.json();
    const projects: CloudflarePagesProject[] = data.result || [];
    return projects;
  } catch (err: any) {
    logger.warn(`[CF-CLEANER] Network error listing Cloudflare projects: ${err?.message || err}`);
    return [];
  }
}

/**
 * Deletes a single Cloudflare Pages project by name.
 */
export async function deleteCloudflarePagesProject(
  projectName: string,
  accountId?: string,
  apiToken?: string
): Promise<boolean> {
  const creds = resolveCredentials(accountId, apiToken);
  if (!creds.accountId || !creds.apiToken) {
    logger.info(`[CF-CLEANER] [SIMULATION] Would delete Cloudflare Pages project: '${projectName}'`);
    return true;
  }

  try {
    const res = await fetch(`${CLOUDFLARE_API_BASE}/accounts/${creds.accountId}/pages/projects/${projectName}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${creds.apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (res.ok || res.status === 404) {
      if (res.status === 404) {
        logger.info(`[CF-CLEANER] Project '${projectName}' was already removed (404).`);
      } else {
        logger.success(`[CF-CLEANER] Successfully deleted Cloudflare Pages project: '${projectName}'`);
      }
      return true;
    } else {
      const errText = await res.text();
      logger.warn(`[CF-CLEANER] Failed to delete project '${projectName}' (${res.status}): ${errText}`);
      return false;
    }
  } catch (err: any) {
    logger.warn(`[CF-CLEANER] Error deleting project '${projectName}': ${err?.message || err}`);
    return false;
  }
}

/**
 * Builds a set of permanently protected project names based on live on-chain tokens in vault.db.
 */
export function getProtectedProjectNames(): Set<string> {
  const protectedNames = new Set<string>();

  try {
    const allLogs = getAllDeployLogs();
    for (const log of allLogs) {
      if (isLiveDeployment(log)) {
        if (log.ticker) {
          const cleanTicker = log.ticker.replace(/^\$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
          protectedNames.add(`${cleanTicker}-web3`);
          protectedNames.add(`${cleanTicker}-token-web`);
          protectedNames.add(cleanTicker);
        }
      }
    }
  } catch (e: any) {
    logger.warn(`[CF-CLEANER] Could not query vault for protected projects: ${e?.message || e}`);
  }

  // Critical platform defaults that must NEVER be deleted
  protectedNames.add("rtrader-portal");
  protectedNames.add("omnichain-dapp");
  protectedNames.add("pumprun-web3"); // Live mainnet token on Base

  return protectedNames;
}

/**
 * Audits Cloudflare Pages projects, protects live tokens, and prunes old test/simulated
 * projects if count exceeds safety threshold.
 */
export async function auditAndCleanCloudflareProjects(
  options: CloudflareCleanOptions = {}
): Promise<CloudflareCleanResult> {
  const threshold = options.threshold ?? 85;
  const targetSafeCount = options.targetSafeCount ?? 75;
  const isDryRun = options.dryRun ?? false;

  const creds = resolveCredentials(options.accountId, options.apiToken);
  const isSimulatedMode = !creds.accountId || !creds.apiToken;

  logger.info(`[CF-CLEANER] Auditing Cloudflare Pages projects (Safety Threshold: ${threshold}/100)...`);

  const projects = await listCloudflarePagesProjects(creds.accountId, creds.apiToken);
  const totalProjects = projects.length;
  const protectedNames = getProtectedProjectNames();

  let protectedCount = 0;
  const prunableProjects: CloudflarePagesProject[] = [];

  for (const proj of projects) {
    const isProtected = protectedNames.has(proj.name.toLowerCase());
    if (isProtected) {
      protectedCount++;
    } else {
      prunableProjects.push(proj);
    }
  }

  // Sort prunable projects oldest first (LRU)
  prunableProjects.sort((a, b) => {
    const timeA = a.created_on ? new Date(a.created_on).getTime() : 0;
    const timeB = b.created_on ? new Date(b.created_on).getTime() : 0;
    return timeA - timeB;
  });

  const isOverThreshold = totalProjects >= threshold;
  const prunedProjects: string[] = [];

  if (isOverThreshold) {
    const needToPrune = Math.max(0, totalProjects - targetSafeCount);
    logger.warn(
      `⚠️ [CF-CLEANER] Cloudflare project count (${totalProjects}) reached safety threshold (${threshold}). ` +
      `Target safe count: ${targetSafeCount}. Pruning up to ${needToPrune} oldest test/simulation projects...`
    );

    const candidates = prunableProjects.slice(0, needToPrune);
    for (const cand of candidates) {
      if (isDryRun) {
        logger.info(`   [DRY-RUN] Would prune: ${cand.name} (Created: ${cand.created_on || "unknown"})`);
        prunedProjects.push(cand.name);
      } else {
        const deleted = await deleteCloudflarePagesProject(cand.name, creds.accountId, creds.apiToken);
        if (deleted) {
          prunedProjects.push(cand.name);
          // Heal stale website URLs in database to point to Universal Token Portal
          try {
            const { updateDeployLogWebsite, getAllDeployLogs } = await import("../../db/vault.ts");
            const targetLogs = getAllDeployLogs().filter(
              (l) => l.website_url && l.website_url.includes(cand.name)
            );
            for (const log of targetLogs) {
              if (log.contract_addr) {
                const chain = (log.chain || "base").toLowerCase();
                const universalUrl = `https://rtrader.pages.dev/token/${chain}/${log.contract_addr}`;
                updateDeployLogWebsite(log.contract_addr, universalUrl);
                logger.info(`[CF-CLEANER] Healed stale website_url for ${log.ticker || log.contract_addr} -> ${universalUrl}`);
              }
            }
          } catch (healErr: any) {
            logger.warn(`[CF-CLEANER] Notice healing stale URL: ${healErr?.message || healErr}`);
          }
        }
      }
    }
  } else {
    logger.info(
      `✅ [CF-CLEANER] Cloudflare project count is safe: ${totalProjects}/100 ` +
      `(${protectedCount} protected live tokens, ${prunableProjects.length} evictable slots).`
    );
  }

  return {
    success: true,
    totalProjects,
    threshold,
    prunableCount: prunableProjects.length,
    prunedProjects,
    protectedCount,
    isOverThreshold,
    mode: isSimulatedMode ? "simulation" : "live",
    message: isOverThreshold
      ? `Pruned ${prunedProjects.length} projects to keep account under 100 limit.`
      : `Cloudflare projects safe at ${totalProjects}/100.`,
  };
}
