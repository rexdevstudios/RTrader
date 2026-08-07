import { NextResponse } from 'next/server';
import { ApiResponse } from '@packages/shared/contracts/api-contracts';




const PLANS = [
  { id: 'FREE', name: 'Free Degen', monthlyPriceUsd: 0, monthlyCredits: 100, features: ['Paper Trading', 'Basic Launchpad View'] },
  { id: 'CREATOR', name: 'Token Creator', monthlyPriceUsd: 29, monthlyCredits: 2000, features: ['Token Launchpad Wizard', 'Fair Launch & Bonding Curve', 'Daytona Sandbox'] },
  { id: 'TRADER', name: 'Pro Terminal Trader', monthlyPriceUsd: 99, monthlyCredits: 5000, features: ['Binance Live Trading', 'WebSocket Stream Listener', 'Deterministic Risk Gate'] },
  { id: 'AGENT', name: 'AI Autonomous Agent', monthlyPriceUsd: 299, monthlyCredits: 15000, features: ['AI Proposal Generation', 'Firecrawl Web Scraping', 'Arkham Wallet Profiling', 'RSI Strategy Backtester'] },
];

export async function GET() {
  const response: ApiResponse<typeof PLANS> = {
    success: true,
    data: PLANS,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(response, { status: 200 });
}
