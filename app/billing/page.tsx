'use client';

import React, { useState, useEffect } from 'react';

interface Plan {
  id: string;
  name: string;
  priceUsd: number;
  monthlyCredits: number;
  hasLiveTrading: boolean;
  hasAgentAccess: boolean;
  hasPriorityScrape: boolean;
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activePlanId, setActivePlanId] = useState('agent');
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [paymentFeedback, setPaymentFeedback] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    async function fetchPlans() {
      try {
        const res = await fetch('/api/billing/plans');
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setPlans(json.data);
        }
      } catch (err) {
        console.warn('[Billing UI] API fetch error (using fallback plans):', (err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchPlans();
  }, []);

  const handleSubscribe = (plan: Plan) => {
    setSelectedPlan(plan);
    setIsProcessing(true);
    setPaymentFeedback(null);

    // Simulate dRPC Onchain Crypto Payment Rail Intent
    setTimeout(() => {
      setActivePlanId(plan.id);
      setPaymentFeedback(`✅ Payment Intent Created! Subscribed to ${plan.name} ($${plan.priceUsd}/mo) via dRPC Onchain Settlement.`);
      setIsProcessing(false);
    }, 600);
  };

  const defaultPlans: Plan[] = [
    { id: 'free', name: 'Free Degen', priceUsd: 0, monthlyCredits: 100, hasLiveTrading: false, hasAgentAccess: false, hasPriorityScrape: false },
    { id: 'creator', name: 'Token Creator', priceUsd: 29, monthlyCredits: 2000, hasLiveTrading: false, hasAgentAccess: false, hasPriorityScrape: true },
    { id: 'trader', name: 'Pro Terminal Trader', priceUsd: 99, monthlyCredits: 5000, hasLiveTrading: true, hasAgentAccess: false, hasPriorityScrape: true },
    { id: 'agent', name: 'AI Autonomous Agent', priceUsd: 299, monthlyCredits: 15000, hasLiveTrading: true, hasAgentAccess: true, hasPriorityScrape: true },
  ];

  const displayPlans = plans.length > 0 ? plans : defaultPlans;

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#0f172a', color: '#f8fafc', minHeight: '80vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', margin: 0, color: '#fbbf24' }}>💳 Billing & Payment Rails</h1>
          <p style={{ color: '#94a3b8', margin: '0.25rem 0 0 0' }}>
            Multi-channel payment billing engine with automated dRPC onchain verifier & wallet credit ledger.
          </p>
        </div>
        <span style={{ backgroundColor: '#065f46', color: '#34d399', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 'bold' }}>
          {loading ? '● Loading API Plans...' : '● dRPC Onchain Settlement Active'}
        </span>
      </div>

      {paymentFeedback && (
        <div style={{ backgroundColor: '#065f46', border: '1px solid #34d399', color: '#34d399', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem', fontWeight: 'bold' }}>
          {paymentFeedback}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {displayPlans.map((plan) => {
          const isActive = plan.id === activePlanId;
          return (
            <div
              key={plan.id}
              style={{
                backgroundColor: '#1e293b',
                border: isActive ? '2px solid #fbbf24' : '1px solid #334155',
                borderRadius: '12px',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',

              }}
            >
              {isActive && (
                <span style={{ position: 'absolute', top: '12px', right: '12px', backgroundColor: '#fbbf24', color: '#0f172a', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                  ACTIVE PLAN
                </span>
              )}

              <div>
                <h3 style={{ color: '#e2e8f0', marginTop: 0, fontSize: '1.25rem' }}>{plan.name}</h3>
                <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: '#38bdf8', marginBottom: '1rem' }}>
                  ${plan.priceUsd} <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>/ month</span>
                </div>

                <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginBottom: '1rem', lineHeight: '1.5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ color: '#34d399' }}>✓</span> {plan.monthlyCredits.toLocaleString()} Monthly Credits
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ color: plan.hasLiveTrading ? '#34d399' : '#64748b' }}>{plan.hasLiveTrading ? '✓' : '✕'}</span>
                    <span style={{ color: plan.hasLiveTrading ? '#f8fafc' : '#64748b' }}>Binance Live Trading</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ color: plan.hasAgentAccess ? '#34d399' : '#64748b' }}>{plan.hasAgentAccess ? '✓' : '✕'}</span>
                    <span style={{ color: plan.hasAgentAccess ? '#f8fafc' : '#64748b' }}>AI Proposal Engine</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: plan.hasPriorityScrape ? '#34d399' : '#64748b' }}>{plan.hasPriorityScrape ? '✓' : '✕'}</span>
                    <span style={{ color: plan.hasPriorityScrape ? '#f8fafc' : '#64748b' }}>Firecrawl Scrape Priority</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleSubscribe(plan)}
                disabled={isProcessing || isActive}
                style={{
                  backgroundColor: isActive ? '#334155' : '#0284c7',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  cursor: isProcessing || isActive ? 'not-allowed' : 'pointer',
                  marginTop: '1rem',
                  width: '100%',
                }}
              >
                {isActive ? 'Current Active Plan' : isProcessing && selectedPlan?.id === plan.id ? 'Processing Intent...' : `Subscribe via Crypto ($${plan.priceUsd})`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
