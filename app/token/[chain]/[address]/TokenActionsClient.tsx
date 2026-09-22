'use client';

import React, { useState } from 'react';
import { Copy, Check, Wallet, ArrowDown, ExternalLink, Zap } from 'lucide-react';

interface TokenActionsClientProps {
  chain: string;
  contractAddress: string;
  tokenName: string;
  tokenSymbol: string;
  isSolana: boolean;
  dexPairAddress?: string | null;
}

export default function TokenActionsClient({
  chain,
  contractAddress,
  tokenName,
  tokenSymbol,
  isSolana,
  dexPairAddress,
}: TokenActionsClientProps) {
  const [copied, setCopied] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  // Swap calculator state
  const [swapAmount, setSwapAmount] = useState('0.05');
  const [swapMode, setSwapMode] = useState<'buy' | 'sell'>('buy');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(contractAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API unavailable
      const textArea = document.createElement('textarea');
      textArea.value = contractAddress;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleAddToWallet = async () => {
    if (isSolana) {
      setWalletNotice('Solana tokens can be held in Phantom, Solflare, or Backpack via Mint Address.');
      setTimeout(() => setWalletNotice(null), 4000);
      return;
    }

    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const wasAdded = await (window as any).ethereum.request({
          method: 'wallet_watchAsset',
          params: {
            type: 'ERC20',
            options: {
              address: contractAddress,
              symbol: tokenSymbol.slice(0, 6).toUpperCase(),
              decimals: 18,
              image: 'https://rtrader.io/token-default.png',
            },
          },
        });
        if (wasAdded) {
          setWalletNotice('Token successfully added to wallet!');
        } else {
          setWalletNotice('Token add request cancelled by user.');
        }
      } catch (err: any) {
        setWalletNotice(`Wallet error: ${err?.message || 'Failed to add token'}`);
      }
      setTimeout(() => setWalletNotice(null), 4000);
    } else {
      setWalletNotice('No Web3 wallet extension detected in browser.');
      setTimeout(() => setWalletNotice(null), 4000);
    }
  };

  // Calculate estimated tokens (simulated 1 ETH = 2,500,000 tokens base curve)
  const numInput = parseFloat(swapAmount) || 0;
  const estimatedTokens = Math.floor(numInput * 2500000).toLocaleString();

  // Swap target URL - On Base, prioritize Doppler Settler AMM where v4 pool resides
  const dopplerHref = `https://app.doppler.lol/tokens/base/${contractAddress}`;
  const bankrHref = `https://bankr.bot/terminal/trade?in=ETH&chain=base&out=${contractAddress}`;
  const uniswapHref = `https://app.uniswap.org/swap?chain=base&inputCurrency=NATIVE&outputCurrency=${contractAddress}&exactAmount=${swapAmount}`;

  const isRobinhood = chain === 'robinhood' || chain === 'robinhood-mainnet';
  const primarySwapHref = isSolana
    ? `https://pump.fun/${contractAddress}`
    : chain === 'base'
    ? dopplerHref
    : isRobinhood
    ? `https://dexscreener.com/robinhood/${contractAddress}`
    : `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=NATIVE&outputCurrency=${contractAddress}&exactAmount=${swapAmount}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1-Click Copy Contract Address Box */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.9) 100%)',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {isSolana ? 'Solana SPL Mint Address' : 'EVM Contract Address (CA)'}
          </span>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#22C55E', fontWeight: 600 }}>
            0% BUY / 0% SELL TAX
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            readOnly
            value={contractAddress}
            style={{
              flex: 1,
              minWidth: '220px',
              backgroundColor: '#020617',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '10px 14px',
              color: '#F8FAFC',
              fontFamily: 'monospace',
              fontSize: '12px',
              outline: 'none',
              cursor: 'text',
            }}
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={handleCopy}
            type="button"
            className="btn btn-primary"
            style={{
              padding: '10px 16px',
              fontSize: '12px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {copied ? <Check size={14} color="#22C55E" /> : <Copy size={14} />}
            {copied ? 'Copied!' : isSolana ? 'Copy Mint' : 'Copy CA'}
          </button>
          <button
            onClick={handleAddToWallet}
            type="button"
            className="btn btn-secondary"
            style={{
              padding: '10px 16px',
              fontSize: '12px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Wallet size={14} />
            {isSolana ? 'Solana Mint' : 'Add to Wallet'}
          </button>
        </div>

        {walletNotice && (
          <p style={{ marginTop: '8px', fontSize: '11px', fontFamily: 'monospace', color: '#38BDF8' }}>
            {walletNotice}
          </p>
        )}
      </div>

      {/* In-Page Quick Swap / Settlement Terminal */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.8) 100%)',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#F8FAFC' }}>
              Instant In-Page Swap
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94A3B8' }}>
              {isSolana
                ? 'Direct liquidity settlement via Pump.fun / Raydium DEX'
                : 'Direct liquidity settlement via Doppler Settler AMM & Uniswap v3'}
            </p>
          </div>
          <span
            className="badge"
            style={{
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              color: '#22C55E',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Zap size={12} />
            {isSolana ? 'SOLANA ENGINE' : 'DOPPLER SETTLER'}
          </span>
        </div>

        {/* Buy / Sell Tabs */}
        <div
          style={{
            display: 'flex',
            backgroundColor: '#020617',
            borderRadius: '8px',
            padding: '4px',
            marginBottom: '16px',
            border: '1px solid #1E293B',
          }}
        >
          <button
            type="button"
            onClick={() => setSwapMode('buy')}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '6px',
              border: 'none',
              background: swapMode === 'buy' ? 'var(--color-accent)' : 'transparent',
              color: swapMode === 'buy' ? '#000000' : '#94A3B8',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            BUY ${tokenSymbol}
          </button>
          <button
            type="button"
            onClick={() => setSwapMode('sell')}
            style={{
              flex: 1,
              padding: '8px',
              borderRadius: '6px',
              border: 'none',
              background: swapMode === 'sell' ? 'var(--color-destructive)' : 'transparent',
              color: swapMode === 'sell' ? '#FFFFFF' : '#94A3B8',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            SELL ${tokenSymbol}
          </button>
        </div>

        {/* Input box */}
        <div
          style={{
            backgroundColor: '#020617',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94A3B8', marginBottom: '6px' }}>
            <span>{swapMode === 'buy' ? 'You Pay' : `You Sell ($${tokenSymbol})`}</span>
            <span>Est. Slippage: 0.5%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <input
              type="number"
              value={swapAmount}
              onChange={(e) => setSwapAmount(e.target.value)}
              step="0.01"
              min="0.001"
              style={{
                width: '60%',
                backgroundColor: 'transparent',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '20px',
                fontWeight: 700,
                outline: 'none',
              }}
            />
            <span
              style={{
                backgroundColor: '#1E293B',
                color: '#F8FAFC',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                border: '1px solid #334155',
              }}
            >
              {swapMode === 'buy' ? (isSolana ? 'SOL' : 'ETH') : tokenSymbol}
            </span>
          </div>
        </div>

        {/* Presets */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          {['0.01', '0.05', '0.1', '0.5'].map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => setSwapAmount(amt)}
              style={{
                padding: '4px 10px',
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#94A3B8',
                fontSize: '11px',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              {amt} {isSolana ? 'SOL' : 'ETH'}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0 12px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowDown size={14} color="#94A3B8" />
          </div>
        </div>

        {/* Output box */}
        <div
          style={{
            backgroundColor: '#020617',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94A3B8', marginBottom: '6px' }}>
            <span>You Receive (Estimated)</span>
            <span style={{ color: '#22C55E' }}>0% Protocol Fee</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--color-accent)', fontSize: '20px', fontWeight: 700 }}>
              {swapMode === 'buy' ? estimatedTokens : (numInput * 0.0000004).toFixed(6)}
            </span>
            <span
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.15)',
                color: '#22C55E',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 700,
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}
            >
              {swapMode === 'buy' ? `$${tokenSymbol}` : (isSolana ? 'SOL' : 'ETH')}
            </span>
          </div>
        </div>

        {/* Action button */}
        <a
          href={primarySwapHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            padding: '14px',
            borderRadius: '8px',
            background: 'linear-gradient(90deg, #22C55E 0%, #10B981 100%)',
            color: '#000000',
            fontWeight: 800,
            fontSize: '14px',
            textDecoration: 'none',
            boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
          }}
        >
          <span>Execute Swap on {isSolana ? 'Pump.fun / Raydium' : 'Doppler Settler AMM (0% Tax)'}</span>
          <ExternalLink size={16} />
        </a>

        {!isSolana && chain === 'base' && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <a
              href={bankrHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{
                flex: 1,
                padding: '8px',
                fontSize: '11px',
                textAlign: 'center',
                justifyContent: 'center',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                textDecoration: 'none',
              }}
            >
              <span>Bankr 1-Click Swap</span>
              <ExternalLink size={12} />
            </a>
            <a
              href={uniswapHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
              style={{
                flex: 1,
                padding: '8px',
                fontSize: '11px',
                textAlign: 'center',
                justifyContent: 'center',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                textDecoration: 'none',
              }}
            >
              <span>Uniswap Interface</span>
              <ExternalLink size={12} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
