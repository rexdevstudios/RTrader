/**
 * src/modules/fleet/fleet-registry.ts
 *
 * Canonical Fleet Registry & Deployment State Classifier.
 *
 * Single Source of Truth (SSOT) defining:
 *  - LIVE / PRODUCTION: Confirmed on-chain deployment with valid non-simulated CA and TX hash.
 *  - SIMULATED / TESTNET: Dry-run or testnet simulation with valid predicted/mock CA and simulated=true.
 *  - TEST_FIXTURE / EPHEMERAL: Unit test fixture without contract address or temporary test row.
 *  - FAILED: Explicitly failed deployment.
 *
 * Prevents ad-hoc, disparate predicates across scripts and guarantees consistent
 * filtering in Dashboard, Fleet Matrix, and Growth engines.
 */

import { getAllDeployLogs, type DeployLog, type DeployLogRow } from "../../db/vault.ts";

export type DeploymentCategory = "LIVE" | "SIMULATED" | "TEST_FIXTURE" | "FAILED";

export interface FleetClassification {
  category: DeploymentCategory;
  isLive: boolean;
  isSimulated: boolean;
  isTestFixture: boolean;
  isFailed: boolean;
}

/**
 * Checks whether a deployment record represents a genuine, confirmed on-chain token.
 */
export function isLiveDeployment(log?: DeployLog | DeployLogRow | null): boolean {
  if (!log) return false;
  if (log.simulated) return false;

  const ca = log.contractAddr?.trim();
  if (!ca || ca === "n/a" || ca.toLowerCase().includes("undefined") || ca.toLowerCase().includes("null")) {
    return false;
  }

  const tx = log.txHash?.trim();
  if (!tx || tx.startsWith("sim_") || tx === "n/a") {
    return false;
  }

  const chain = log.chain?.toLowerCase();
  if (chain === "base" || chain === "ethereum" || chain === "bsc" || chain === "robinhood" || chain === "clanker" || chain === "arc") {
    // EVM: Must start with 0x and be a 42-character hex address
    if (!ca.startsWith("0x") || ca.length !== 42) return false;
    if (!tx.startsWith("0x")) return false;
  } else if (chain === "solana") {
    // Solana: Base58 string (32-44 chars) and not mock prefix
    if (ca.startsWith("pump_sim") || ca.startsWith("sim_")) return false;
    if (ca.length < 32 || ca.length > 44) return false;
  } else {
    // Other chains: Must be non-trivial
    if (ca.length < 20 || ca.startsWith("sim_")) return false;
  }

  const status = log.status?.toLowerCase();
  const lifecycle = log.lifecycleState?.toUpperCase();
  const isConfirmed = status === "confirmed" || status === "success" || lifecycle === "DEPLOY_CONFIRMED";
  if (!isConfirmed) return false;

  return true;
}

/**
 * Checks whether a deployment record represents a controlled simulation / testnet run.
 */
export function isSimulatedDeployment(log?: DeployLog | DeployLogRow | null): boolean {
  if (!log) return false;
  if (!log.simulated) return false;

  const ca = log.contractAddr?.trim();
  if (!ca || ca === "n/a" || ca.toLowerCase().includes("undefined") || ca.toLowerCase().includes("null")) {
    return false;
  }

  return true;
}

/**
 * Checks whether a deployment record is an ephemeral test fixture (e.g. inserted by test runners).
 */
export function isTestFixture(log?: DeployLog | DeployLogRow | null): boolean {
  if (!log) return true;
  const ca = log.contractAddr?.trim();
  if (!ca || ca === "" || ca === "n/a") return true;
  return false;
}

/**
 * Classifies a deployment record into its canonical category.
 */
export function classifyDeployment(log?: DeployLog | DeployLogRow | null): DeploymentCategory {
  if (!log) return "TEST_FIXTURE";
  if (log.status === "failed" || log.lifecycleState === "FAILED") return "FAILED";
  if (isLiveDeployment(log)) return "LIVE";
  if (isSimulatedDeployment(log)) return "SIMULATED";
  return "TEST_FIXTURE";
}

/**
 * Retrieves all live on-chain production deployments from vault.
 */
export function getLiveDeployments(chain?: string): DeployLogRow[] {
  const logs = getAllDeployLogs(chain ? { chain } : undefined);
  return logs.filter(isLiveDeployment);
}

/**
 * Retrieves all simulated deployments from vault.
 */
export function getSimulatedDeployments(chain?: string): DeployLogRow[] {
  const logs = getAllDeployLogs(chain ? { chain } : undefined);
  return logs.filter(isSimulatedDeployment);
}

/**
 * Returns the production fleet (live + simulated), excluding test fixtures.
 */
export function getProductionFleet(chain?: string): {
  live: DeployLogRow[];
  simulated: DeployLogRow[];
  all: DeployLogRow[];
} {
  const logs = getAllDeployLogs(chain ? { chain } : undefined);
  const live = logs.filter(isLiveDeployment);
  const simulated = logs.filter(isSimulatedDeployment);
  return {
    live,
    simulated,
    all: [...live, ...simulated],
  };
}

export interface ResolvedTokenTarget {
  address: string;
  ticker: string;
  name: string;
  poolId?: string;
  walletId?: string;
  index?: number;
  chain?: string;
}

const DEFAULT_BASE_TOKEN = "0x0a99f4251A461e8abC693a56BB837fD815D51BA3"; // $PUMPRUN
const DEFAULT_POOL_ID = "0x645d579d8002a6ac09d67c59526d065321b07570b1d9f359a70346c072ca7584";

/**
 * Resolves target token dynamically by index number (1, 2, 3...), contract address, or defaults to latest live token.
 */
export function resolveTargetToken(input?: string): ResolvedTokenTarget {
  const liveFleet = getLiveDeployments("base");

  // 1. If input is a 1-based index (e.g. "1", "2")
  if (input && /^\d+$/.test(input.trim())) {
    const idx = parseInt(input.trim(), 10) - 1;
    if (idx >= 0 && idx < liveFleet.length) {
      const match = liveFleet[idx];
      return {
        address: match.contractAddr!,
        ticker: match.ticker || "TOKEN",
        name: match.tokenName || "Token",
        poolId: match.poolId || undefined,
        walletId: match.walletId || undefined,
        index: idx + 1,
        chain: match.chain || "base",
      };
    }
  }

  // 2. If input is an EVM address (0x...)
  if (input && /^0x[a-fA-F0-9]{40}$/.test(input.trim())) {
    const addr = input.trim();
    const match = liveFleet.find((d) => d.contractAddr?.toLowerCase() === addr.toLowerCase());
    if (match) {
      return {
        address: match.contractAddr!,
        ticker: match.ticker || "TOKEN",
        name: match.tokenName || "Token",
        poolId: match.poolId || undefined,
        walletId: match.walletId || undefined,
        chain: match.chain || "base",
      };
    }

    return {
      address: addr,
      ticker: addr.toLowerCase() === DEFAULT_BASE_TOKEN.toLowerCase() ? "PUMPRUN" : "CUSTOM",
      name: addr.toLowerCase() === DEFAULT_BASE_TOKEN.toLowerCase() ? "Pump Hill Runner" : "Custom Token",
      poolId: addr.toLowerCase() === DEFAULT_BASE_TOKEN.toLowerCase() ? DEFAULT_POOL_ID : undefined,
      chain: "base",
    };
  }

  // 3. Default: Latest live deployment from fleet
  if (liveFleet.length > 0) {
    const latest = liveFleet[liveFleet.length - 1];
    return {
      address: latest.contractAddr!,
      ticker: latest.ticker || "TOKEN",
      name: latest.tokenName || "Token",
      poolId: latest.poolId || undefined,
      walletId: latest.walletId || undefined,
      index: liveFleet.length,
      chain: latest.chain || "base",
    };
  }

  // 4. Fallback default
  return {
    address: DEFAULT_BASE_TOKEN,
    ticker: "PUMPRUN",
    name: "Pump Hill Runner",
    poolId: DEFAULT_POOL_ID,
    walletId: "default-operator",
    index: 1,
    chain: "base",
  };
}
