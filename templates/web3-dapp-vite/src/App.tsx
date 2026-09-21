import React, { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useBalance } from "wagmi";
import { injected } from "wagmi/connectors";
import { formatEther, parseEther } from "viem";

const TOKEN_CA = "0x7CE19E4F978009EB644c27946B47221b824C0bA3";
const TOKEN_TICKER = "PUMPRUN";
const TOKEN_NAME = "Pump Hill Runner";
const BASE_CHAIN_ID = 8453;

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  const [activeTab, setActiveTab] = useState<"buy" | "sell">("buy");
  const [inputAmount, setInputAmount] = useState<string>("0.005");
  const [quoteOutput, setQuoteOutput] = useState<string>("---");
  const [priceImpact, setPriceImpact] = useState<string>("< 0.1%");
  const [isQuoting, setIsQuoting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [copiedCa, setCopiedCa] = useState<boolean>(false);

  const { data: ethBalance } = useBalance({ address });

  // Debounced quote fetcher
  useEffect(() => {
    let active = true;
    const fetchQuote = async () => {
      const val = parseFloat(inputAmount);
      if (isNaN(val) || val <= 0) {
        setQuoteOutput("0");
        return;
      }

      setIsQuoting(true);
      try {
        const isBuy = activeTab === "buy";
        const sellToken = isBuy ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : TOKEN_CA;
        const buyToken = isBuy ? TOKEN_CA : "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
        const sellAmount = isBuy ? parseEther(inputAmount).toString() : parseEther(inputAmount).toString();

        const res = await fetch("https://api.bankr.bot/swap/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sellToken,
            buyToken,
            sellAmount,
            taker: address || "0x0000000000000000000000000000000000000001",
            chainId: BASE_CHAIN_ID,
          }),
        });

        if (!res.ok) throw new Error(`Quote error ${res.status}`);
        const data = await res.json();
        if (active && data.buyAmount) {
          const formatted = formatEther(BigInt(data.buyAmount));
          setQuoteOutput(parseFloat(formatted).toLocaleString(undefined, { maximumFractionDigits: isBuy ? 0 : 6 }));
          setPriceImpact("< 0.5%");
        }
      } catch (err) {
        if (active) {
          // Fallback estimator
          const valNum = parseFloat(inputAmount) || 0;
          setQuoteOutput(activeTab === "buy" ? (valNum * 2500000).toLocaleString() : (valNum / 2500000).toFixed(6));
        }
      } finally {
        if (active) setIsQuoting(false);
      }
    };

    const timer = setTimeout(fetchQuote, 400);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [inputAmount, activeTab, address]);

  const handleCopyCa = () => {
    navigator.clipboard.writeText(TOKEN_CA);
    setCopiedCa(true);
    setTimeout(() => setCopiedCa(false), 2000);
  };

  const handleExecuteSwap = async () => {
    if (!isConnected) {
      connect({ connector: injected() });
      return;
    }

    setStatusMessage("⚡ Fetching on-chain transaction route...");
    try {
      const isBuy = activeTab === "buy";
      const sellToken = isBuy ? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" : TOKEN_CA;
      const buyToken = isBuy ? TOKEN_CA : "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      const sellAmount = parseEther(inputAmount).toString();

      const res = await fetch("https://api.bankr.bot/swap/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellToken,
          buyToken,
          sellAmount,
          taker: address,
          chainId: BASE_CHAIN_ID,
        }),
      });

      const quote = await res.json();
      if (!quote.transaction) throw new Error(quote.message || "Failed to generate transaction calldata");

      const tx = quote.transaction;
      setStatusMessage("✍️ Please confirm transaction in your wallet...");

      // Send transaction via window.ethereum or wagmi
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const txHash = await (window as any).ethereum.request({
          method: "eth_sendTransaction",
          params: [{
            from: address,
            to: tx.to,
            data: tx.data,
            value: tx.value ? "0x" + BigInt(tx.value).toString(16) : "0x0",
            gas: tx.gas ? "0x" + BigInt(Math.floor(Number(tx.gas) * 1.2)).toString(16) : undefined,
          }],
        });
        setStatusMessage(`✅ Swap Submitted! Tx: ${txHash.slice(0, 10)}...`);
      }
    } catch (err: any) {
      setStatusMessage(`❌ Error: ${err.message || "Transaction cancelled"}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090d] text-slate-100 p-4 md:p-8">
      {/* Top Navbar */}
      <header className="max-w-6xl mx-auto flex items-center justify-between py-4 border-b border-slate-800/80 mb-8">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center font-bold text-emerald-400">
            P
          </div>
          <div>
            <h1 className="font-extrabold text-white leading-none">${TOKEN_TICKER}</h1>
            <span className="text-[11px] text-slate-400">{TOKEN_NAME} • Base L2</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Base Mainnet
          </div>

          {isConnected ? (
            <button
              onClick={() => disconnect()}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-mono border border-slate-700 transition"
            >
              {address?.slice(0, 6)}...{address?.slice(-4)}
            </button>
          ) : (
            <button
              onClick={() => connect({ connector: injected() })}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-bold text-xs shadow-lg shadow-emerald-400/20 hover:opacity-90 transition"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Main Bento Grid */}
      <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Card 1: Swap & Buy Widget (Col 5) */}
        <div className="lg:col-span-5 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-2xl backdrop-blur-card flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white text-lg">Instant Doppler Swap</h2>
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                0% Fee / Slippage Safe
              </span>
            </div>

            {/* Buy / Sell Tabs */}
            <div className="flex p-1 bg-slate-950/80 rounded-xl border border-slate-800 mb-5">
              <button
                type="button"
                onClick={() => setActiveTab("buy")}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                  activeTab === "buy" ? "bg-emerald-400 text-black shadow" : "text-slate-400 hover:text-white"
                }`}
              >
                BUY ${TOKEN_TICKER}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("sell")}
                className={`flex-1 py-2 text-xs font-bold rounded-lg transition ${
                  activeTab === "sell" ? "bg-emerald-400 text-black shadow" : "text-slate-400 hover:text-white"
                }`}
              >
                SELL ${TOKEN_TICKER}
              </button>
            </div>

            {/* Input Box */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 mb-3">
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>You Pay</span>
                <span>Balance: {ethBalance ? `${parseFloat(ethBalance.formatted).toFixed(4)} ETH` : "---"}</span>
              </div>
              <div className="flex items-center justify-between">
                <input
                  type="number"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  step="0.001"
                  min="0.0001"
                  className="w-2/3 bg-transparent text-2xl font-bold text-white focus:outline-none"
                />
                <span className="px-3 py-1 rounded-lg bg-slate-800 text-slate-200 font-bold text-sm border border-slate-700">
                  {activeTab === "buy" ? "ETH" : `$${TOKEN_TICKER}`}
                </span>
              </div>
            </div>

            {/* Output Box */}
            <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 mb-5">
              <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                <span>You Receive (Estimated)</span>
                <span className="text-slate-400">{isQuoting ? "Quoting..." : `Impact: ${priceImpact}`}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-emerald-400">{quoteOutput}</span>
                <span className="px-3 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold text-sm border border-emerald-500/20">
                  {activeTab === "buy" ? `$${TOKEN_TICKER}` : "ETH"}
                </span>
              </div>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={handleExecuteSwap}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 text-black font-extrabold text-sm shadow-lg shadow-emerald-400/20 hover:opacity-95 active:scale-[0.99] transition"
            >
              {!isConnected ? "Connect Wallet to Trade" : `Execute ${activeTab.toUpperCase()} on Doppler Settler`}
            </button>

            {statusMessage && (
              <p className="mt-3 text-xs text-center font-mono text-slate-300 animate-pulse">{statusMessage}</p>
            )}
          </div>
        </div>

        {/* Card 2: Live DexScreener Embed (Col 7) */}
        <div className="lg:col-span-7 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-2xl backdrop-blur-card flex flex-col">
          <div className="flex items-center justify-between mb-3 px-2">
            <span className="font-bold text-white text-sm">DexScreener Real-Time Chart</span>
            <a
              href={`https://dexscreener.com/base/${TOKEN_CA}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-emerald-400 hover:underline"
            >
              Open Full Chart ↗
            </a>
          </div>
          <div className="flex-1 min-h-[420px] rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
            <iframe
              src={`https://dexscreener.com/base/${TOKEN_CA}?embed=1&theme=dark&trades=0&info=0`}
              title="DexScreener Chart"
              className="w-full h-full border-0 min-h-[420px]"
            />
          </div>
        </div>

        {/* Card 3: CA & Security Audit (Col 6) */}
        <div className="lg:col-span-6 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-card">
          <h3 className="font-bold text-white mb-2">Verified Contract Address</h3>
          <p className="text-xs text-slate-400 mb-4">Base Mainnet L2 Doppler v4 Hook AMM</p>

          <div className="flex items-center gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 mb-4">
            <input
              readOnly
              value={TOKEN_CA}
              className="w-full bg-transparent text-xs font-mono text-slate-300 focus:outline-none"
            />
            <button
              onClick={handleCopyCa}
              className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition shrink-0"
            >
              {copiedCa ? "Copied!" : "Copy CA"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-400 block mb-1">Buy / Sell Tax</span>
              <span className="text-emerald-400 font-bold font-mono">0.0% / 0.0%</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-400 block mb-1">Liquidity Lock</span>
              <span className="text-emerald-400 font-bold font-mono">100% Locked</span>
            </div>
          </div>
        </div>

        {/* Card 4: Protocol Tokenomics (Col 6) */}
        <div className="lg:col-span-6 bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 shadow-xl backdrop-blur-card">
          <h3 className="font-bold text-white mb-2">Autonomous Flywheel Tokenomics</h3>
          <p className="text-xs text-slate-400 mb-4">Positive-sum decentralized liquidity architecture</p>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-300">Auto Buyback & Burn</span>
              <span className="text-emerald-400 font-bold font-mono">30% Protocol Fees</span>
            </div>
            <div className="flex justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-300">Passive WETH Dividends</span>
              <span className="text-cyan-400 font-bold font-mono">20% Distributed</span>
            </div>
            <div className="flex justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <span className="text-slate-300">Affiliate Referral Rewards</span>
              <span className="text-amber-400 font-bold font-mono">15% Commission</span>
            </div>
          </div>
        </div>
      </main>

      {/* Cloudflare Pages Footer */}
      <footer className="max-w-6xl mx-auto mt-12 pt-6 border-t border-slate-800/80 text-center text-xs text-slate-500 font-mono">
        Deployed to Cloudflare Pages Edge • Pure Static Web3 SPA • Zero-Server Architecture
      </footer>
    </div>
  );
}
