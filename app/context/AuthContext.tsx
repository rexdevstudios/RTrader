'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type UserRole =
  | 'GUEST'
  | 'TRADER'
  | 'CREATOR'
  | 'SYSTEM_ADMIN'
  | 'SUPER_ADMIN';

export interface AuthContextType {
  walletAddress: string | null;
  userId: string | null;
  isConnected: boolean;
  userRole: UserRole;
  credits: number;
  isConnecting: boolean;
  chainId: string | null;
  connectWallet: (address: string, role?: UserRole) => void;
  connectMetaMask: () => Promise<{ success: boolean; address?: string; error?: string }>;
  disconnectWallet: () => void;
  switchRole: (role: UserRole) => void;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<UserRole>('GUEST');
  const [credits, setCredits] = useState<number>(0);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [chainId, setChainId] = useState<string | null>(null);

  // Server-Side Session Revalidation (SSOT)
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const json = await res.json();

      if (json.success && json.data && json.data.authenticated) {
        setWalletAddress(json.data.walletAddress);
        setUserId(json.data.userId);
        setIsConnected(true);
        setUserRole(json.data.userRole);
        setCredits(json.data.credits);
        return;
      }

      // Disconnected state (Guest)
      setWalletAddress(null);
      setUserId(null);
      setIsConnected(false);
      setUserRole('GUEST');
      setCredits(0);
    } catch (e) {
      console.warn('[AuthContext] Session revalidation warning:', e);
      setIsConnected(false);
      setUserRole('GUEST');
    }
  }, []);

  // Initial load
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const disconnectWallet = useCallback(() => {
    document.cookie = 'rtrader_session=; path=/; max-age=0; SameSite=Strict';
    localStorage.removeItem('rtrader_role');

    setWalletAddress(null);
    setUserId(null);
    setIsConnected(false);
    setUserRole('GUEST');
    setCredits(0);
  }, []);

  const connectWallet = useCallback((address: string, role: UserRole = 'TRADER') => {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[AuthContext] Direct connectWallet without cryptographic SIWE signature is disabled in production.');
      return;
    }
    // In local development / test harness:
    setWalletAddress(address);
    setUserId(`usr-${address.slice(0, 10).toLowerCase()}`);
    setIsConnected(true);
    setUserRole(role);
    setCredits(role === 'SYSTEM_ADMIN' ? 999999 : 15000);
  }, []);

  // Real Dynamic MetaMask Connection with EIP-4361 SIWE Signature Flow
  const connectMetaMask = useCallback(async (): Promise<{ success: boolean; address?: string; error?: string }> => {
    if (typeof window === 'undefined' || !(window as any).ethereum) {
      return {
        success: false,
        error: 'MetaMask or Web3 wallet extension not detected in this browser. Please install MetaMask.',
      };
    }

    setIsConnecting(true);
    try {
      const ethereum = (window as any).ethereum;

      // 1. Request dynamic accounts from MetaMask
      const accounts: string[] = await ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (!accounts || accounts.length === 0) {
        throw new Error('No Ethereum account selected in MetaMask.');
      }

      const activeAddress = accounts[0];

      // Request Chain ID
      try {
        const cId = await ethereum.request({ method: 'eth_chainId' });
        setChainId(cId);
      } catch {
        // chain fetch optional
      }

      // 2. Request SIWE Challenge from backend for this dynamic address
      const challengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: activeAddress, chainType: 'EVM' }),
      });
      const challengeJson = await challengeRes.json();

      if (!challengeJson.success || !challengeJson.data) {
        throw new Error(challengeJson.error?.message || 'Failed to obtain SIWE challenge');
      }

      const { nonce, messageToSign } = challengeJson.data;

      // 3. Prompt MetaMask popup to sign challenge with user's private key
      const { ethers } = await import('ethers');
      const hexMessage = ethers.hexlify(ethers.toUtf8Bytes(messageToSign));
      const signature: string = await ethereum.request({
        method: 'personal_sign',
        params: [hexMessage, activeAddress],
      });

      // 4. Verify cryptographic signature on backend
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: activeAddress,
          chainType: 'EVM',
          signature,
          nonce,
          message: messageToSign,
        }),
      });
      const verifyJson = await verifyRes.json();

      if (!verifyJson.success) {
        throw new Error(verifyJson.error?.message || 'SIWE cryptographic verification failed');
      }

      // 5. Store cryptographic session token & revalidate from authoritative server
      if (verifyJson.data?.sessionToken) {
        document.cookie = `rtrader_session=${verifyJson.data.sessionToken}; path=/; max-age=28800; SameSite=Strict`;
      }
      await refreshSession();

      return { success: true, address: activeAddress };
    } catch (err: any) {
      const msg = err?.message || 'Wallet connection was cancelled or failed';
      return { success: false, error: msg };
    } finally {
      setIsConnecting(false);
    }
  }, [refreshSession]);

  // Listen for MetaMask account & chain changes dynamically (EIP-1193)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const ethereum = (window as any).ethereum;

      const handleAccountsChanged = (accounts: string[]) => {
        if (!accounts || accounts.length === 0) {
          disconnectWallet();
        } else if (accounts[0].toLowerCase() !== walletAddress?.toLowerCase()) {
          // Dynamic account switch requires fresh SIWE re-authentication
          refreshSession();
        }
      };

      const handleChainChanged = (newChainId: string) => {
        setChainId(newChainId);
      };

      ethereum.on?.('accountsChanged', handleAccountsChanged);
      ethereum.on?.('chainChanged', handleChainChanged);

      return () => {
        ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
        ethereum.removeListener?.('chainChanged', handleChainChanged);
      };
    }
  }, [walletAddress, disconnectWallet, refreshSession]);

  const switchRole = useCallback((role: UserRole) => {
    if (role === 'GUEST') {
      disconnectWallet();
      return;
    }

    if (process.env.NODE_ENV === 'production') {
      console.warn('[AuthContext] Role switching is disabled in production. Roles are strictly authoritative from backend SIWE session.');
      return;
    }

    console.warn('[AuthContext] Role switching is only permitted in local dev sandbox and does not elevate backend API permissions.');
    setUserRole(role);
  }, [disconnectWallet]);

  return (
    <AuthContext.Provider
      value={{
        walletAddress,
        userId,
        isConnected,
        userRole,
        credits,
        isConnecting,
        chainId,
        connectWallet,
        connectMetaMask,
        disconnectWallet,
        switchRole,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
