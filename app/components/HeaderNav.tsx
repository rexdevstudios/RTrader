'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../context/AuthContext';
import {
  ShieldAlert,
  Zap,
  LayoutDashboard,
  Rocket,
  Network,
  LogOut,
  Wallet,
  BrainCircuit,
  Award,
} from 'lucide-react';

export default function HeaderNav() {
  const pathname = usePathname();
  const {
    walletAddress,
    isConnected,
    userRole,
    credits,
    isConnecting,
    connectMetaMask,
    disconnectWallet,
  } = useAuth();

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/launchpad', label: 'Launchpad', icon: Rocket },
    { href: '/kol', label: 'KOL Hub', icon: Award },
    { href: '/trading', label: 'Trading Terminal', icon: Network },
    { href: '/agent', label: 'AI Proposals', icon: BrainCircuit },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <header className="header-nav">
      {/* Brand & Network Indicator */}
      <div className="flex-row items-center gap-md">
        <Link href="/" className="terminal-text" style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '-0.5px' }}>
          RTRADER
        </Link>
        <span className="badge" style={{ backgroundColor: '#1A1E2F', border: '1px solid #334155', color: '#94A3B8', fontSize: '11px', padding: '2px 6px' }}>
          v2.5
        </span>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '3px 8px',
            borderRadius: '12px',
            backgroundColor: 'rgba(34, 197, 94, 0.08)',
            border: '1px solid rgba(34, 197, 94, 0.2)',
            fontSize: '11px',
            color: '#86EFAC',
            fontWeight: 600,
          }}
        >
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22C55E' }} />
          Base Mainnet
        </div>
      </div>

      {/* Dynamic Navigation Links */}
      <nav className="nav-links">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link ${active ? 'nav-link-active' : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: active ? 'rgba(34, 197, 94, 0.1)' : 'transparent',
                transition: 'all 150ms ease',
              }}
            >
              <Icon size={15} style={{ verticalAlign: 'middle' }} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Account & Session Controls */}
      <div className="flex-row items-center gap-sm">
        {isConnected ? (
          <>
            {userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN' ? (
              <span className="badge badge-admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <ShieldAlert size={12} />
                ADMIN
              </span>
            ) : userRole === 'TRADER' ? (
              <span className="badge badge-trader" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Zap size={12} />
                TRADER
              </span>
            ) : null}

            <div
              className="badge"
              style={{
                border: '1px solid var(--color-border)',
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                color: '#94A3B8',
                fontSize: '12px',
              }}
            >
              Credits: {userRole === 'SYSTEM_ADMIN' ? '∞' : `${credits.toLocaleString()}`}
            </div>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-primary)',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--color-foreground)',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#22C55E' }} />
              {truncatedAddress}
            </div>

            <button
              onClick={() => disconnectWallet()}
              className="btn-secondary"
              style={{
                padding: '6px 10px',
                fontSize: '12px',
                color: 'var(--color-destructive)',
                borderColor: 'rgba(239, 68, 68, 0.3)',
              }}
              title="Disconnect Wallet"
            >
              <LogOut size={14} />
            </button>
          </>
        ) : (
          <button
            onClick={async () => {
              const res = await connectMetaMask();
              if (!res.success && res.error) {
                alert(`MetaMask Error: ${res.error}`);
              }
            }}
            disabled={isConnecting}
            className="btn-primary"
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              borderRadius: '6px',
            }}
          >
            <Wallet size={15} />
            <span>{isConnecting ? 'Signing SIWE...' : 'Connect Wallet'}</span>
          </button>
        )}
      </div>
    </header>
  );
}
