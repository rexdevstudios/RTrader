'use client';

import React, { useState } from 'react';
import { useAuth, UserRole } from '../context/AuthContext';

export default function HeaderNav() {
  const { walletAddress, isConnected, userRole, credits, isConnecting, connectWallet, connectMetaMask, disconnectWallet, switchRole } = useAuth();
  const [showRoleMenu, setShowRoleMenu] = useState(false);

  const truncatedAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

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
      {/* Brand, Architecture Version & Dynamic Role Badge */}
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

        {/* Dynamic Role Badge */}
        {userRole === 'SYSTEM_ADMIN' || userRole === 'SUPER_ADMIN' ? (
          <span style={{
            fontSize: '10px',
            fontWeight: 800,
            padding: '2px 8px',
            borderRadius: '3px',
            backgroundColor: '#261704',
            color: '#FFD600',
            border: '1px solid #FF9100',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 0 8px rgba(255, 214, 0, 0.25)',
          }}>
            👑 ROLE: SYSTEM ADMIN
          </span>
        ) : userRole === 'TRADER' ? (
          <span style={{
            fontSize: '10px',
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: '3px',
            backgroundColor: '#041E15',
            color: '#00E676',
            border: '1px solid #00E676',
          }}>
            ROLE: TRADER
          </span>
        ) : userRole === 'CREATOR' ? (
          <span style={{
            fontSize: '10px',
            fontWeight: 800,
            padding: '2px 6px',
            borderRadius: '3px',
            backgroundColor: '#1C0D2E',
            color: '#D500F9',
            border: '1px solid #3B1566',
          }}>
            ROLE: CREATOR
          </span>
        ) : (
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            padding: '2px 6px',
            borderRadius: '3px',
            backgroundColor: '#0F172A',
            color: '#64748B',
            border: '1px solid #1E293B',
          }}>
            ROLE: GUEST (DISCONNECTED)
          </span>
        )}
      </div>

      {/* High Density Navigation Links */}
      <nav style={{ display: 'flex', gap: '16px', fontSize: '12px', fontWeight: 600 }}>
        <a href="/" style={{ color: '#E2E8F0', textDecoration: 'none', transition: 'color 0.15s' }}>Dashboard</a>
        <a href="/launchpad" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.15s' }}>Launchpad</a>
        <a href="/trading" style={{ color: '#00E5FF', textDecoration: 'none', fontWeight: 700 }}>Trading Terminal</a>
        <a href="/agent" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.15s' }}>AI Proposals</a>
        <a href="/billing" style={{ color: '#94A3B8', textDecoration: 'none', transition: 'color 0.15s' }}>Billing Rails</a>
      </nav>

      {/* Account, Role Switcher & Session Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', position: 'relative' }}>
        {isConnected ? (
          <>
            {/* Compact Credit Meter */}
            <div style={{
              fontSize: '11px',
              fontVariantNumeric: 'tabular-nums',
              padding: '4px 10px',
              borderRadius: '4px',
              backgroundColor: '#090D14',
              border: '1px solid #1A2436',
              color: userRole === 'SYSTEM_ADMIN' ? '#FFD600' : '#00E5FF',
            }}>
              Credits: <strong>{userRole === 'SYSTEM_ADMIN' ? '∞ (ADMIN)' : `${credits.toLocaleString()} / 15,000`}</strong>
            </div>

            {/* SIWE Connected Pill */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '4px',
              backgroundColor: userRole === 'SYSTEM_ADMIN' ? '#261704' : '#041E15',
              border: userRole === 'SYSTEM_ADMIN' ? '1px solid #FF9100' : '1px solid #00E676',
              color: userRole === 'SYSTEM_ADMIN' ? '#FFD600' : '#00E676',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: userRole === 'SYSTEM_ADMIN' ? '#FFD600' : '#00E676' }}></span>
              <span>{userRole === 'SYSTEM_ADMIN' ? 'ADMIN ACTIVE' : 'SIWE ACTIVE'}</span>
              <span style={{ color: userRole === 'SYSTEM_ADMIN' ? '#FFE082' : '#B9F6CA' }}>({truncatedAddress})</span>
            </div>

            {/* Role Switcher Pill */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowRoleMenu(!showRoleMenu)}
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: '#0C1017',
                  color: '#CBD5E1',
                  border: '1px solid #1E293B',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>Switch Role ▾</span>
              </button>

              {showRoleMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  backgroundColor: '#06080E',
                  border: '1px solid #1E293B',
                  borderRadius: '6px',
                  padding: '4px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  zIndex: 999,
                  minWidth: '150px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.8)',
                }}>
                  <button
                    onClick={() => { switchRole('TRADER'); setShowRoleMenu(false); }}
                    style={{ textAlign: 'left', backgroundColor: userRole === 'TRADER' ? '#041E15' : 'transparent', color: userRole === 'TRADER' ? '#00E676' : '#94A3B8', border: 'none', padding: '6px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    👤 Regular Trader
                  </button>
                  <button
                    onClick={() => { switchRole('CREATOR'); setShowRoleMenu(false); }}
                    style={{ textAlign: 'left', backgroundColor: userRole === 'CREATOR' ? '#1C0D2E' : 'transparent', color: userRole === 'CREATOR' ? '#D500F9' : '#94A3B8', border: 'none', padding: '6px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    🎨 Token Creator
                  </button>
                  <button
                    onClick={() => { switchRole('SYSTEM_ADMIN'); setShowRoleMenu(false); }}
                    style={{ textAlign: 'left', backgroundColor: userRole === 'SYSTEM_ADMIN' ? '#261704' : 'transparent', color: userRole === 'SYSTEM_ADMIN' ? '#FFD600' : '#94A3B8', border: 'none', padding: '6px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    👑 System Admin
                  </button>
                  <div style={{ height: '1px', backgroundColor: '#1E293B', margin: '2px 0' }}></div>
                  <button
                    onClick={() => { disconnectWallet(); setShowRoleMenu(false); }}
                    style={{ textAlign: 'left', backgroundColor: 'transparent', color: '#FF5252', border: 'none', padding: '6px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    ⛔ Disconnect (Guest)
                  </button>
                </div>
              )}
            </div>

            {/* Direct Disconnect Button */}
            <button
              onClick={disconnectWallet}
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '4px 8px',
                borderRadius: '4px',
                backgroundColor: 'transparent',
                color: '#FF5252',
                border: '1px solid #7F1D1D',
                cursor: 'pointer',
              }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Dynamic MetaMask Connect & Cryptographic Signature Button */}
            <button
              onClick={async () => {
                const res = await connectMetaMask();
                if (!res.success && res.error) {
                  alert(`MetaMask Error: ${res.error}`);
                }
              }}
              disabled={isConnecting}
              style={{
                fontSize: '11px',
                fontWeight: 900,
                padding: '6px 14px',
                borderRadius: '4px',
                backgroundColor: isConnecting ? '#141A26' : '#E2761B',
                color: isConnecting ? '#64748B' : '#FFFFFF',
                border: 'none',
                cursor: isConnecting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: isConnecting ? 'none' : '0 0 14px rgba(226, 118, 27, 0.45)',
                transition: 'all 0.15s ease',
              }}
            >
              <span>🦊</span>
              <span>{isConnecting ? 'Signing SIWE...' : 'Connect MetaMask'}</span>
            </button>

            {/* Sandbox Quick Presets Container */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: '#090D14',
              border: '1px dashed #1E293B',
            }}>
              <span style={{ fontSize: '9px', color: '#64748B', fontWeight: 700, marginRight: '2px' }}>DEMO:</span>
              <button
                onClick={() => connectWallet('0x71C7656EC7ab88b098defB751B7401B5f6d8976F', 'TRADER')}
                title="Quick demo login as Trader without MetaMask extension"
                style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  padding: '3px 6px',
                  borderRadius: '3px',
                  backgroundColor: '#041E15',
                  color: '#00E676',
                  border: '1px solid #00E676',
                  cursor: 'pointer',
                }}
              >
                Trader
              </button>
              <button
                onClick={() => connectWallet('0xADMIN99999999999999999999999999999999999', 'SYSTEM_ADMIN')}
                title="Quick demo login as Admin without MetaMask extension"
                style={{
                  fontSize: '10px',
                  fontWeight: 800,
                  padding: '3px 6px',
                  borderRadius: '3px',
                  backgroundColor: '#261704',
                  color: '#FFD600',
                  border: '1px solid #FF9100',
                  cursor: 'pointer',
                }}
              >
                Admin
              </button>
            </div>

            <a
              href="/auth/login"
              style={{
                fontSize: '11px',
                fontWeight: 800,
                padding: '6px 10px',
                borderRadius: '4px',
                backgroundColor: '#00E5FF',
                color: '#000000',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              SIWE Portal
            </a>
          </div>
        )}
      </div>
    </header>
  );
}

