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

      // Fallback check from localStorage for sandbox/dev mode
      const storedRole = (localStorage.getItem('rtrader_role') as UserRole) || null;
      const cookies = document.cookie.split(';');
      const sessionCookie = cookies.find((c) => c.trim().startsWith('rtrader_session='));

      if (sessionCookie) {
        const val = sessionCookie.split('=')[1];
        let addr = '';
        let uId = '';
        try {
          const decoded = atob(val);
          const parts = decoded.split(':');
          if (parts.length >= 2) {
            uId = parts[0];
            addr = parts[1];
          }
        } catch {
          // ignore decode error
        }

        if (addr) {
          const activeRole: UserRole = storedRole || (addr.toLowerCase().includes('admin') ? 'SYSTEM_ADMIN' : 'TRADER');
          setWalletAddress(addr);
          setUserId(uId || `usr-${addr.slice(0, 10).toLowerCase()}`);
          setIsConnected(true);
          setUserRole(activeRole);
          setCredits(activeRole === 'SYSTEM_ADMIN' ? 999999 : 15000);
          return;
        }
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
    const uId = `usr-${address.slice(0, 10).toLowerCase()}`;
    const issuedAt = Date.now().toString();
    const nonce = `nonce-${Date.now()}`;
    const rawToken = `${uId}:${address}:${issuedAt}:${nonce}`;
    const sessionToken = typeof btoa === 'function' ? btoa(rawToken) : Buffer.from(rawToken).toString('base64');

    // Set cookie for Edge Middleware
    document.cookie = `rtrader_session=${sessionToken}; path=/; max-age=28800; SameSite=Strict`;
    localStorage.setItem('rtrader_role', role);

    setWalletAddress(address);
    setUserId(uId);
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
      const signature: string = await ethereum.request({
        method: 'personal_sign',
        params: [messageToSign, activeAddress],
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

      // 5. Update local state and revalidate from server
      connectWallet(activeAddress, 'TRADER');
      await refreshSession();

      return { success: true, address: activeAddress };
    } catch (err: any) {
      const msg = err?.message || 'Wallet connection was cancelled or failed';
      return { success: false, error: msg };
    } finally {
      setIsConnecting(false);
    }
  }, [connectWallet, refreshSession]);

  // Listen for MetaMask account & chain changes dynamically (EIP-1193)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      const ethereum = (window as any).ethereum;

      const handleAccountsChanged = (accounts: string[]) => {
        if (!accounts || accounts.length === 0) {
          disconnectWallet();
        } else if (accounts[0].toLowerCase() !== walletAddress?.toLowerCase()) {
          // Dynamic account switch
          connectWallet(accounts[0], userRole === 'GUEST' ? 'TRADER' : userRole);
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
  }, [walletAddress, userRole, connectWallet, disconnectWallet]);

  const switchRole = useCallback((role: UserRole) => {
    if (role === 'GUEST') {
      disconnectWallet();
      return;
    }

    let targetAddr = walletAddress;
    if (!targetAddr) {
      targetAddr =
        role === 'SYSTEM_ADMIN' || role === 'SUPER_ADMIN'
          ? '0xADMIN99999999999999999999999999999999999'
          : '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
    }

    connectWallet(targetAddr, role);
  }, [walletAddress, connectWallet, disconnectWallet]);

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
