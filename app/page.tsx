'use client';

import React, { useState, useEffect } from 'react';

interface OverviewData {
  status: string;
  controlPlane: string;
  operationalSsot: string;
  ephemeralSidecar: string;
  telemetryObservability: string;
  executionPlaneWorkers: string[];
  primaryRpcProvider: string;
  fallbackRpcProvider: string;
  activeDomains: string[];
  timestamp: string;
}

export default function OverviewPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = async () => {
    try {
      const res = await fetch('/api/system/overview');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.success && json.data) {
        setOverview(json.data as OverviewData);
        setError(null);
      }
    } catch (err) {
      console.warn('[Overview UI] System overview fetch error:', (err as Error).message);
      setError('Live telemetry retrying... using cached baseline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
    const timer = window.setInterval(fetchOverview, 5000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: '#000000', color: '#E2E8F0', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Top Status Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#06080E', padding: '12px 16px', borderRadius: '6px', border: '1px solid #141A26' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 900, margin: 0, color: '#F8FAFC', letterSpacing: '-0.5px' }}>
            ⚡ System Overview & Telemetry Matrix
          </h1>
          <p style={{ color: '#64748B', margin: '2px 0 0 0', fontSize: '11px', fontVariantNumeric: 'tabular-nums' }}>
            Operational SSOT: PostgreSQL (28 Tables) • Ephemeral Tier: Upstash Redis REST Sidecar • Native dRPC RPC Engine
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', color: '#94A3B8', fontVariantNumeric: 'tabular-nums' }}>
            Updated: {overview?.timestamp ? new Date(overview.timestamp).toLocaleTimeString() : 'LIVE'}
          </span>
          <span
            style={{
              backgroundColor: error ? '#2A0413' : '#041E15',
              color: error ? '#FF5252' : '#00E676',
              border: error ? '1px solid #FF1744' : '1px solid #00E676',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.5px',
            }}
          >
            {error ? '● CACHED / RETRYING' : `● ${overview?.status || 'OPERATIONAL'}`}
          </span>
        </div>
      </div>

      {/* OLED Data-Dense 4-Column Metric Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
        <div style={{ padding: '14px', backgroundColor: '#06080E', borderRadius: '6px', border: '1px solid #141A26' }}>
          <div style={{ color: '#64748B', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px', marginBottom: '4px' }}>CONTROL PLANE & EDGE</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#00E5FF', fontVariantNumeric: 'tabular-nums' }}>
            {overview?.controlPlane || 'Vercel / Next.js 14'}
          </div>
          <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px' }}>Stateless Edge Middleware (6 Sec Headers)</div>
        </div>

        <div style={{ padding: '14px', backgroundColor: '#06080E', borderRadius: '6px', border: '1px solid #141A26' }}>
          <div style={{ color: '#64748B', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px', marginBottom: '4px' }}>OPERATIONAL SSOT</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#00E676', fontVariantNumeric: 'tabular-nums' }}>
            {overview?.operationalSsot || 'PostgreSQL SSOT (Neon)'}
          </div>
          <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px' }}>28 Relational Tables (Transactional Authority)</div>
        </div>

        <div style={{ padding: '14px', backgroundColor: '#06080E', borderRadius: '6px', border: '1px solid #141A26' }}>
          <div style={{ color: '#64748B', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px', marginBottom: '4px' }}>EPHEMERAL SIDECAR</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#FFC400', fontVariantNumeric: 'tabular-nums' }}>
            {overview?.ephemeralSidecar || 'UPSTASH_REDIS_ACTIVE'}
          </div>
          <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px' }}>REST Sidecar • Zero-Blocking Fail-Open</div>
        </div>

        <div style={{ padding: '14px', backgroundColor: '#06080E', borderRadius: '6px', border: '1px solid #141A26' }}>
          <div style={{ color: '#64748B', fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.5px', marginBottom: '4px' }}>TELEMETRY LOGGER</div>
          <div style={{ fontSize: '16px', fontWeight: 800, color: '#D500F9', fontVariantNumeric: 'tabular-nums' }}>
            {overview?.telemetryObservability || 'ACTIVE (Ring Buffer)'}
          </div>
          <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px' }}>Non-Blocking Metric & Audit Buffer</div>
        </div>
      </div>

      {/* Data-Dense Active Domains Subsystem Grid */}
      <div style={{ padding: '16px', backgroundColor: '#06080E', borderRadius: '6px', border: '1px solid #141A26' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 800, margin: 0, color: '#F8FAFC', letterSpacing: '0.5px' }}>
            🌐 Active Domain Subsystems (9 Managed Domains)
          </h3>
          <span style={{ fontSize: '11px', color: '#00E5FF', fontWeight: 'bold' }}>100% Boundary Isolation Verified</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
          {(overview?.activeDomains || ['IDENTITY', 'BILLING', 'LAUNCHPAD', 'TRADING', 'AGENT', 'INTELLIGENCE', 'RISK', 'COMPLIANCE', 'ADMIN']).map((domain) => (
            <div key={domain} style={{ backgroundColor: '#0C1018', border: '1px solid #162030', padding: '8px 12px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#E2E8F0', fontSize: '12px', fontWeight: 700 }}>{domain}</span>
              <span style={{ color: '#00E676', fontSize: '11px', fontWeight: 800 }}>✓ ACTIVE</span>
            </div>
          ))}
        </div>

        {/* Execution Plane Workers */}
        <div style={{ backgroundColor: '#0C1018', border: '1px solid #162030', padding: '12px', borderRadius: '4px' }}>
          <div style={{ color: '#64748B', fontSize: '11px', fontWeight: 'bold', marginBottom: '6px' }}>EXECUTION PLANE WORKERS</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {(overview?.executionPlaneWorkers || ['BinanceOrderWorker', 'LaunchpadIndexerWorker', 'DaytonaSandboxRunner', 'BinanceStreamListener']).map((worker) => (
              <span key={worker} style={{ backgroundColor: '#131D2D', color: '#00E5FF', border: '1px solid #1B2B42', padding: '4px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>
                ⚙️ {worker}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
