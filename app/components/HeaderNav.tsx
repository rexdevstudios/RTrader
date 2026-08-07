'use client';

import React, { useState, useEffect } from 'react';

export default function HeaderNav() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'GUEST' | 'TRADER' | 'CREATOR' | 'AGENT_OWNER'>('TRADER');
  const [credits, setCredits] = useState(15000);

  useEffect(() => {
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
        setWalletAddress('0x1234...7890');
      }
    } else {
      setIsLoggedIn(true);
      setWalletAddress('0x71C7...890A');
    }
  }, []);

  return (
    <header style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',

      padding: '10px 20px',
      backgroundColor: '#05070B',
      borderBottom: '1px solid #161D2A',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Brand & Infrastructure Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <a href="/" style={{ textDecoration: 'none' }}>
          <span style={{
            fontWeight: 900,
            fontSize: '18px',
            letterSpacing: '-0.5px',
            background: 'linear-gradient(90deg, #00E5FF, #7C4DFF)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            RTRADER
          </span>
        </a>
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: '3px',
          backgroundColor: '#0C1017',
          color: '#00E5FF',
          border: '1px solid #162232',
          letterSpacing: '0.5px',
        }}>
          OLED DENSE v2.5
        </span>
        <span style={{
          fontSize: '10px',
          fontWeight: 800,
          padding: '2px 6px',
          borderRadius: '3px',
          backgroundColor: '#1C0D2E',
          color: '#D500F9',
          border: '1px solid #3B1566',
        }}>
          ROLE: {userRole}
        </span>
      </div>

      {/* High Density Navigation Links */}
      <nav style={{ display: 'flex', gap: '16px', fontSize: '12px', fontWeight: 600 }}>
        <a href="/" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.15s' }}>Dashboard</a>
        <a href="/launchpad" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.15s' }}>Launchpad</a>
        <a href="/trading" style={{ color: '#00E5FF', textDecoration: 'none', fontWeight: 700 }}>Trading Terminal</a>
        <a href="/agent" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.15s' }}>AI Proposals</a>
        <a href="/billing" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.15s' }}>Billing Rails</a>
      </nav>

      {/* Account & Session Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {/* Compact Credit Meter */}
        <div style={{
          fontSize: '11px',
          fontVariantNumeric: 'tabular-nums',
          padding: '4px 10px',
          borderRadius: '4px',
          backgroundColor: '#090D14',
          border: '1px solid #1A2436',
          color: '#00E5FF',
        }}>
          Credits: <strong>{credits.toLocaleString()} / 15,000</strong>
        </div>

        {/* SIWE Badge */}
        {isLoggedIn ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            padding: '4px 10px',
            borderRadius: '4px',
            backgroundColor: '#041E15',
            border: '1px solid #00E676',
            color: '#00E676',
            fontWeight: 700,
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#00E676' }}></span>
            <span>SIWE ACTIVE</span>
            <span style={{ color: '#B9F6CA' }}>({walletAddress || '0x71C...890A'})</span>
          </div>
        ) : (
          <a href="/auth/login" style={{
            fontSize: '12px',
            fontWeight: 700,
            padding: '6px 12px',
            borderRadius: '4px',
            backgroundColor: '#00E5FF',
            color: '#000000',
            textDecoration: 'none',
          }}>
            Connect Wallet
          </a>
        )}
      </div>
    </header>
  );
}
