'use client';

import React, { useState, useEffect } from 'react';

export default function HeaderNav() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'GUEST' | 'TRADER' | 'CREATOR' | 'AGENT_OWNER'>('TRADER');
  const [credits, setCredits] = useState(15000);

  useEffect(() => {
    // Check if session token cookie exists
    const cookies = document.cookie.split(';');
    const sessionCookie = cookies.find((c) => c.trim().startsWith('rtrader_session='));
    if (sessionCookie) {
      setIsLoggedIn(true);
      const val = sessionCookie.split('=')[1];
      try {
        const decoded = atob(val);
        const parts = decoded.split(':');
        if (parts.length >= 2) {
          setWalletAddress(parts[1]);
        }
      } catch {
        // Fallback demo address
        setWalletAddress('0x1234...7890');
      }
    } else {
      // Default demo connected state for smooth UI preview
      setIsLoggedIn(true);
      setWalletAddress('0x71C7...890A');
    }
  }, []);

  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', backgroundColor: '#131822', borderBottom: '1px solid #1E2638' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <a href="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontWeight: 800, fontSize: '20px', background: 'linear-gradient(90deg, #3B82F6, #8B5CF6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            RTRADER PLATFORM
          </span>
        </a>
        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#1E293B', color: '#94A3B8', border: '1px solid #334155' }}>
          100% Native dRPC
        </span>
        {/* Active Role Badge */}
        <span style={{ fontSize: '11px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px', backgroundColor: '#581c87', color: '#c084fc', border: '1px solid #7e22ce' }}>
          ROLE: {userRole}
        </span>
      </div>

      <nav style={{ display: 'flex', gap: '20px', fontSize: '14px', fontWeight: 500 }}>
        <a href="/" style={{ color: '#94A3B8', textDecoration: 'none' }}>Dashboard</a>
        <a href="/launchpad" style={{ color: '#94A3B8', textDecoration: 'none' }}>Launchpad</a>
        <a href="/trading" style={{ color: '#94A3B8', textDecoration: 'none' }}>Trading Terminal</a>
        <a href="/agent" style={{ color: '#94A3B8', textDecoration: 'none' }}>AI Proposals</a>
        <a href="/billing" style={{ color: '#94A3B8', textDecoration: 'none' }}>Billing & Credits</a>
      </nav>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        {/* Live Credit Meter */}
        <div style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '6px', backgroundColor: '#0F172A', border: '1px solid #1E293B', color: '#38BDF8' }}>
          Credits: <strong>{credits.toLocaleString()} / 15,000</strong>
        </div>

        {/* SIWE Wallet Badge / Login Link */}
        {isLoggedIn ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 12px', borderRadius: '6px', backgroundColor: '#065f46', border: '1px solid #047857', color: '#34d399', fontWeight: 'bold' }}>
            <span>● SIWE ACTIVE</span>
            <span style={{ color: '#a7f3d0' }}>({walletAddress || '0x71C...890A'})</span>
          </div>
        ) : (
          <a href="/auth/login" style={{ fontSize: '13px', fontWeight: 600, padding: '8px 16px', borderRadius: '6px', backgroundColor: '#2563EB', color: '#FFF', textDecoration: 'none' }}>
            Connect Wallet (SIWE)
          </a>
        )}
      </div>
    </header>
  );
}
