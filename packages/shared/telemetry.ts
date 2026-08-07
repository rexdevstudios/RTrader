// ============================================================================
// TELEMETRY & OBSERVABILITY LOGGER — Async Non-Blocking Metrics & Event Logger
// ============================================================================
//
// INVARIANT (MASTER_PROMPT.md & SSOT.md):
//   - Telemetry adalah OUT-OF-BAND & NON-BLOCKING 100%.
//   - Tidak boleh memblokir critical live execution path (Risk Gate, Order Worker).
//   - Seluruh logging dilakukan secara fire-and-forget async dengan try/catch.
// ============================================================================

export interface MetricEvent {
  metricName: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: string;
}

export interface TelemetryDbAdapter {
  createAuditLog(actorId: string, action: string, entityId?: string, reason?: string): Promise<void>;
}

export class TelemetryLogger {
  private static metricsBuffer: MetricEvent[] = [];
  private static readonly MAX_BUFFER_SIZE = 100;

  /**
   * Record a numerical metric (e.g., API latency ms, Risk Gate score, RPC ping ms).
   * Fire-and-forget non-blocking execution.
   */
  static recordMetric(metricName: string, value: number, tags?: Record<string, string>): void {
    try {
      const event: MetricEvent = {
        metricName,
        value,
        tags,
        timestamp: new Date().toISOString(),
      };

      TelemetryLogger.metricsBuffer.push(event);
      if (TelemetryLogger.metricsBuffer.length > TelemetryLogger.MAX_BUFFER_SIZE) {
        TelemetryLogger.metricsBuffer.shift(); // Evict oldest
      }

      console.log(`[Telemetry Metric] ${metricName}: ${value} | Tags:`, JSON.stringify(tags || {}));
    } catch (err) {
      // Ignore telemetry errors — never disrupt main thread
    }
  }

  /**
   * Record a domain event to PostgreSQL audit trail asynchronously.
   * Fire-and-forget non-blocking execution.
   */
  static async recordEvent(
    actorId: string,
    action: string,
    entityId?: string,
    reason?: string,
    db?: TelemetryDbAdapter
  ): Promise<void> {
    try {
      if (db) {
        await db.createAuditLog(actorId, action, entityId, reason);
      }
      console.log(`[Telemetry Event] Actor=${actorId} | Action=${action} | Entity=${entityId || 'N/A'} | Reason=${reason || 'N/A'}`);
    } catch (err) {
      console.warn(`[Telemetry Warning] Non-blocking event logging failed:`, (err as Error).message);
    }
  }

  /**
   * Get buffer stats for observability endpoints.
   */
  static getMetricsBuffer(): MetricEvent[] {
    return [...TelemetryLogger.metricsBuffer];
  }

  /**
   * Clear buffer.
   */
  static clearBuffer(): void {
    TelemetryLogger.metricsBuffer = [];
  }
}
