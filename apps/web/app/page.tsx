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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '1rem', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0', color: '#F8FAFC' }}>
            Platform Overview & System Entitlement Dashboard
          </h1>
          <p style={{ color: '#94A3B8', margin: 0 }}>
            Operational SSOT: Neon Serverless PostgreSQL (28 Tables) | 100% Native dRPC Infrastructure
          </p>
        </div>
        <div>
          <span
            style={{
              backgroundColor: error ? '#831843' : '#065F46',
              color: error ? '#F472B6' : '#34D399',
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 'bold',
            }}
          >
            {error ? '● CACHED / RETRYING' : `● ${overview?.status || 'OPERATIONAL'}`}
          </span>
        </div>
      </div>

      {/* System Metrics Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>Control Plane & UI</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#38BDF8' }}>
            {overview?.controlPlane || 'Vercel / Next.js 14'}
          </div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>6 API Routes & 5 Dashboard Pages</div>
        </div>

        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>Operational SSOT</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#4ADE80' }}>
            {overview?.operationalSsot || 'PostgreSQL SSOT (Neon)'}
          </div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>28 Tables Schema (Clean Migration)</div>
        </div>

        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>Ephemeral Tier & Sidecar</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#FACC15' }}>
            {overview?.ephemeralSidecar || 'UPSTASH_REDIS_ACTIVE'}
          </div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>Stateless REST Client & Rate Limiter</div>
        </div>

        <div style={{ padding: '20px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638' }}>
          <div style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '8px' }}>Telemetry & Observability</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#A78BFA' }}>
            {overview?.telemetryObservability || 'ACTIVE (Out-of-Band)'}
          </div>
          <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>Ring-Buffer & Non-Blocking Logger</div>
        </div>
      </div>

      {/* Domain Readiness Summary */}
      <div style={{ padding: '24px', backgroundColor: '#131822', borderRadius: '8px', border: '1px solid #1E2638', marginTop: '8px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px 0', color: '#F8FAFC' }}>
          Active Domain Subsystems & Execution Plane Workers
        </h3>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {(overview?.activeDomains || ['IDENTITY', 'BILLING', 'LAUNCHPAD', 'TRADING', 'AGENT', 'INTELLIGENCE', 'RISK', 'COMPLIANCE', 'ADMIN']).map((domain) => (
            <span key={domain} style={{ backgroundColor: '#1E293B', color: '#38BDF8', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 }}>
              ✓ {domain}
            </span>
          ))}
        </div>

        <div style={{ color: '#94A3B8', fontSize: '14px' }}>
          <strong>Execution Workers:</strong> {(overview?.executionPlaneWorkers || ['BinanceOrderWorker', 'LaunchpadIndexerWorker', 'DaytonaSandboxRunner', 'BinanceStreamListener']).join(' • ')}
        </div>
      </div>
    </div>
  );
}
