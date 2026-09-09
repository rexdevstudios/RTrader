'use client';

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { ShieldAlert, Zap, LayoutDashboard, Rocket, Network, LogOut, Wallet, ChevronDown, MonitorDot, BrainCircuit, Award } from 'lucide-react';

export default function HeaderNav() {
  const { walletAddress, isConnected, userRole, credits, isConnecting, connectMetaMask, disconnectWallet, switchRole } = useAuth();
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  return (
    <header className="header-nav">
      {/* Brand & Dynamic Role Badge */}
      <div className="flex-row items-center gap-md">
        <a href="/" className="terminal-text" style={{ fontSize: '18px', fontWeight: 900 }}>
          RTRADER
        </a>
        <span className="badge" style={{ backgroundColor: '#1A1E2F', border: '1px solid #334155', color: '#94A3B8' }}>
          v2.5
        </span>

        {/* Dynamic Role Badge */}
        {userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN' ? (
          <span className="badge badge-admin">
            <ShieldAlert size={14} style={{ marginRight: '4px' }} />
            SYSTEM ADMIN
          </span>
        ) : userRole === 'TRADER' ? (
          <span className="badge badge-trader">
            <Zap size={14} style={{ marginRight: '4px' }} />
            TRADER
          </span>
        ) : userRole === 'CREATOR' ? (
          <span className="badge" style={{ backgroundColor: 'rgba(213,0,249,0.1)', color: '#D500F9', border: '1px solid rgba(213,0,249,0.2)' }}>
            <Rocket size={14} style={{ marginRight: '4px' }} />
            CREATOR
          </span>
        ) : (
          <span className="badge badge-guest">
            <MonitorDot size={14} style={{ marginRight: '4px' }} />
            GUEST (DISCONNECTED)
          </span>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="nav-links">
        <a href="/" className="nav-link"><LayoutDashboard size={16} style={{display:'inline', marginRight: '4px', verticalAlign: 'text-bottom'}} /> Dashboard</a>
        <a href="/launchpad" className="nav-link"><Rocket size={16} style={{display:'inline', marginRight: '4px', verticalAlign: 'text-bottom'}} /> Launchpad</a>
        <a href="/kol" className="nav-link"><Award size={16} style={{display:'inline', marginRight: '4px', verticalAlign: 'text-bottom'}} /> KOL Hub</a>
        <a href="/trading" className="nav-link nav-link-active"><Network size={16} style={{display:'inline', marginRight: '4px', verticalAlign: 'text-bottom'}} /> Trading Terminal</a>
        <a href="/agent" className="nav-link"><BrainCircuit size={16} style={{display:'inline', marginRight: '4px', verticalAlign: 'text-bottom'}} /> AI Proposals</a>
      </nav>

      {/* Account & Session Controls */}
      <div className="flex-row items-center gap-md" style={{ position: 'relative' }}>
        {isConnected ? (
          <>
            <div className="badge" style={{ border: '1px solid var(--color-border)' }}>
              Credits: {userRole === 'SYSTEM_ADMIN' ? '∞' : `${credits.toLocaleString()}`}
            </div>

            <div className={`badge ${userRole === 'SYSTEM_ADMIN' ? 'badge-admin' : 'badge-trader'}`}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'currentColor', marginRight: '6px' }}></span>
              SIWE ACTIVE ({truncatedAddress})
            </div>

            {/* Role Switcher Pill */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowRoleMenu(!showRoleMenu)}
                className="btn-secondary"
                style={{ padding: '4px 8px', fontSize: '12px' }}
              >
                <span>Switch Role</span>
                <ChevronDown size={14} />
              </button>

              {showRoleMenu && (
                <div className="bg-panel" style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  borderRadius: '6px',
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  zIndex: 999,
                  minWidth: '150px',
                  boxShadow: 'var(--shadow-xl)',
                }}>
                  <button
                    onClick={() => { switchRole('TRADER'); setShowRoleMenu(false); }}
                    className="btn-secondary"
                    style={{ border: 'none', justifyContent: 'flex-start', width: '100%', fontSize: '12px' }}
                  >
                    <Zap size={14} /> Regular Trader
                  </button>
                  <button
                    onClick={() => { switchRole('CREATOR'); setShowRoleMenu(false); }}
                    className="btn-secondary"
                    style={{ border: 'none', justifyContent: 'flex-start', width: '100%', fontSize: '12px' }}
                  >
                    <Rocket size={14} /> Token Creator
                  </button>
                  <button
                    onClick={() => { switchRole('CREATOR'); setShowRoleMenu(false); }}
                    className="btn-secondary"
                    style={{ border: 'none', justifyContent: 'flex-start', width: '100%', fontSize: '12px', color: '#60A5FA' }}
                  >
                    <Award size={14} /> KOL & Influencer
                  </button>
                  <button
                    onClick={() => { switchRole('SYSTEM_ADMIN'); setShowRoleMenu(false); }}
                    className="btn-secondary"
                    style={{ border: 'none', justifyContent: 'flex-start', width: '100%', fontSize: '12px', color: '#FCA5A5' }}
                  >
                    <ShieldAlert size={14} /> System Admin
                  </button>
                  <div style={{ height: '1px', backgroundColor: 'var(--color-border)', margin: '4px 0' }}></div>
                  <button
                    onClick={() => { disconnectWallet(); setShowRoleMenu(false); }}
                    className="btn-secondary"
                    style={{ border: 'none', justifyContent: 'flex-start', width: '100%', fontSize: '12px', color: 'var(--color-destructive)' }}
                  >
                    <LogOut size={14} /> Disconnect
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-row items-center gap-sm">
            <button
              onClick={async () => {
                const res = await connectMetaMask();
                if (!res.success && res.error) {
                  alert(`MetaMask Error: ${res.error}`);
                }
              }}
              disabled={isConnecting}
              className="btn-primary"
            >
              <Wallet size={16} />
              <span>{isConnecting ? 'Signing SIWE...' : 'Connect MetaMask'}</span>
            </button>
            
            <a href="/auth/login" className="btn-secondary" style={{ textDecoration: 'none' }}>
              SIWE Portal
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
