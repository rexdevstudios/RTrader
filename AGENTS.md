# Antigravity System Rules for RTrader SocialFi Platform

## Core Principles & Invariants
1. **Control Plane Isolation (Vercel):** Next.js and Vercel are strictly for UI, Edge routing, and stateless Serverless APIs. Never implement long-running websockets, persistent background trading workers, or continuous loops inside Vercel functions.
2. **Postgres SSOT:** PostgreSQL is the single operational source of truth for all system states (users, kol_profiles, drafts, bounties, audit logs). Blockchain state is an external settlement layer mirrored into Postgres.
3. **Non-Custodial Guarantee:** NEVER store private keys, seed phrases, or custody user funds in Vercel environment variables or database tables. The platform admin address in Vercel MUST BE a Public Address (`ADMIN_WALLET_PUBLIC_ADDRESS`) only.
4. **Smart Contract Immutability:** Token deployment must strictly use audited factory templates (`BondingCurveLaunchpad.sol`). Never allow arbitrary unverified bytecode deployment.
5. **Deterministic Risk Gate:** Live trading and sensitive transactions must pass through `packages/trading/risk-gate.ts`. AI agents are strictly advisory/proposal-only and cannot execute live transactions without user confirmation and Risk Gate approval.
6. **KOL & Bounty Verification:** Off-chain social proofs (tweets, engagement) must be validated via verified APIs or scrapers (`FirecrawlScraper` / Twitter API) before granting smart contract claim signatures.
