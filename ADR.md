# ADR: Degen Launchpad, Trading Terminal, and AI Agent Platform

## Status
Active (Updated: Phase N — 2026-08-07)

## Context
We are designing a crypto platform inspired by pump.fun-style launchpads and bankr-style agent-driven workflows. The product includes:

- token launchpad for degen/meme assets
- trading terminal with Binance integration
- AI agent for market analysis and assisted execution
- onchain intelligence and web intelligence enrichment
- admin, risk, compliance, and billing controls

The architecture must fit a Vercel-friendly web stack, remain cost-conscious, and still support real-time trading, auditability, and strong security.

## Decision Summary

1. Use Next.js on Vercel as the control plane.
2. Use Postgres as the system of record for operational data.
3. Keep long-running streaming, indexer, and execution workloads outside Vercel functions.
4. Use a polymorphic entity model for users, agents, tokens, wallets, orders, and projects.
5. Treat AI agents as proposal engines, not unconstrained executors.
6. Use Binance API only with read + trade permissions, never withdrawal permission.
7. Build launchpad fairness, moderation, and graduation rules into the product, not as afterthoughts.
8. Design monetization as freemium + subscription + usage-based billing + optional protocol fees.

## ADRs

### ADR-001: Vercel as Control Plane Only
We will use Vercel for the user-facing web app, admin panels, lightweight APIs, and SSR/edge-adjacent logic.

Rationale:
- fast developer workflow
- strong DX for Next.js
- enough for dashboards, forms, and short-lived requests

Consequences:
- live websocket streams and 24/7 trading loops must run elsewhere
- execution services need a separate runtime

### ADR-002: Separate Execution Plane for Trading and Streaming
We will run Binance websocket listeners, chain indexers, and order execution workers in always-on services outside Vercel.

Rationale:
- real-time workloads need persistent connections
- order execution should not depend on serverless runtime limits

Consequences:
- added deployment surface
- stronger reliability for trading and indexing

### ADR-003: Postgres as Operational SSOT
We will keep Postgres as the operational source of truth for users, roles, plans, tokens, orders, policies, and audit events.

Rationale:
- transactionality
- relational integrity
- easier auditing and reporting

Consequences:
- chain state and exchange state are mirrored into Postgres as indexed operational copies
- blockchain/exchange remain external truth for final settlement

### ADR-004: Polymorphic Entity Registry
We will model users, agents, tokens, wallets, orders, projects, and alerts through a shared entity registry and event log.

Rationale:
- launchpad and trading objects are highly cross-linked
- a single model avoids duplicated foreign key patterns

Consequences:
- schema discipline is required
- entity typing must be enforced by constraints and application logic

### ADR-005: AI Agents Propose, Risk Engine Approves
AI agents may analyze data, generate signals, and prepare order proposals, but a deterministic risk engine must approve all live trades.

Rationale:
- prevents uncontrolled autonomous execution
- keeps auditability and predictable guardrails

Consequences:
- every live order requires a risk decision path
- model output alone can never execute a trade

### ADR-006: Binance Integration Without Withdrawal Permission
Binance API keys will be stored encrypted and must not include withdrawal permissions.

Rationale:
- reduces blast radius if credentials are compromised
- aligns with least-privilege access

Consequences:
- deposit/withdrawal flows stay out of the trading agent path
- user education is required during onboarding

### ADR-007: Launchpad Must Support Fair Launch and Moderated Launch Modes
The launchpad will support fair launch, bonding curve launch, fixed-price launch, whitelist launch, and community pre-launch modes.

Rationale:
- different creators need different issuance mechanics
- fairness and anti-abuse controls must be explicit

Consequences:
- launch configuration becomes part of the token contract and UI
- risk scoring and moderation are required before listing

### ADR-008: Monetization Is Multi-Channel
We will support subscription, usage-based billing, launch fees, trading fees, and optional featured placement fees.

Rationale:
- one billing model will not fit all product surfaces
- some actions are cheap to serve, others are expensive

Consequences:
- billing ledger must be first-class
- feature gating must map to plan and usage state

### ADR-009: Security by Design
The platform will implement encryption, audit logs, rate limits, role separation, dual-control for critical actions, and emergency kill switches.

Rationale:
- crypto trading and launchpads carry high operational risk
- admin misuse is as dangerous as external compromise

Consequences:
- more governance overhead
- fewer silent high-impact actions

### ADR-010: Compliance-Aware Architecture
We will design the platform so that KYC, AML, geofencing, and policy gating can be added without redesigning the core system.

Rationale:
- token launch and trading may create regulatory exposure
- the architecture must support progressive compliance

Consequences:
- user access may vary by jurisdiction and risk tier
- compliance state becomes part of account eligibility

### ADR-011: Automated Crypto Payment Rail as Primary Billing Engine
We will adopt an automated onchain crypto payment rail (USDT/USDC/ETH/BNB with dRPC verification) as the primary billing rail, alongside internal wallet credits, without mandatory Stripe dependency.

Rationale:
- crypto-native users prefer native wallet payments
- eliminates fiat payment processor dependencies
- automated onchain verifier ensures 100% finality and idempotency

Consequences:
- billing state machine must handle `CREATED`, `PENDING_CONFIRMATION`, `SETTLED`, `REJECTED`, `EXPIRED`, and `FALLBACK_REQUIRED`
- custom deployed token payment rail is isolated as an optional staged extension

### ADR-012: Arkham API Integration for Intelligence Enrichment
We will integrate Arkham API as an asynchronous intelligence enrichment layer for wallet risk profiling, counterparty screening, launch passport scoring, and treasury intelligence.

Rationale:
- provides deep entity attribution and risk passport scoring
- enriches risk scoring for launchpad moderation and compliance

Consequences:
- Arkham API runs strictly out-of-band / asynchronously
- Arkham API failure must never block live trade execution or settlement

### ADR-013: TradingSignalEngine as Presentation-Layer Intelligence Aggregator
We will add `TradingSignalEngine` in `packages/intelligence/trading-signal-engine.ts` as a stateless, synchronous aggregator that computes `MarketRegime`, `TradingAlert[]`, and `StrategySignal[]` from already-available data (OHLCV candles, orderbook snapshot, `IntelligenceSignal`).

Rationale:
- traders need structured, actionable alerts derived from multi-factor analysis (RSI, whale walls, spread, macro sentiment, counterparty risk, volatility)
- a single aggregator prevents logic duplication across dashboard and proposal routes
- all computation uses pre-fetched/cached data — no new blocking I/O in this layer

Consequences:
- `TradingSignalEngine` is NEVER called inside the critical execution path (Risk Gate → Order Worker)
- output is strictly advisory/informational — never a settlement decision
- `shouldPauseTrading` and `shouldRejectProposal` flags are UI hints only; Risk Gate remains the authoritative final decision
- AI Proposal Engine remains proposal-only; `StrategySignal` is input to proposal generation, not direct execution

### ADR-014: DefiLlama as Zero-Key Macro Intelligence Sidecar
We will integrate DefiLlama public REST API (`api.llama.fi/v2/chains`) as a zero-dependency, zero-API-key macro enrichment layer inside `packages/intelligence/defillama-client.ts`.

Rationale:
- provides free, public, continuously updated DeFi TVL data across 100+ chains
- enables macro regime detection (BULLISH/NEUTRAL/BEARISH) without any new paid dependency
- 5-second AbortController timeout + complete try/catch ensures zero impact on critical path

Consequences:
- DefiLlama data is OUT-OF-BAND enrichment only — never source of truth
- `macroSentiment: UNAVAILABLE` is always a valid graceful fallback state
- DefiLlama is fetched in parallel via `Promise.allSettled()` alongside OHLCV so it never blocks chart response
- `GET /api/market/macro` provides a standalone CDN-cacheable public endpoint (`s-maxage=60`)

### ADR-015: Next.js Edge Middleware for Stateless Auth Protection and Security Headers
We will use Next.js Edge Middleware (`middleware.ts` at project root) to enforce stateless session token validation on all non-public `/api/*` routes and inject security headers on every HTTP response.

Rationale:
- Edge Middleware runs before any API Route Handler — first-line defense with zero DB calls
- security headers (`X-Frame-Options`, `HSTS`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`) must be applied universally
- stateless session token format (`base64(userId:wallet:issuedAt:nonce)`) enables Edge Runtime compatibility without server state

Consequences:
- `POST /api/auth/verify` must set the `rtrader_session` HttpOnly cookie on successful SIWE verification
- public routes (`/api/auth/*`, `/api/billing/plans`, `/api/system/overview`, `/api/market/*`) are explicitly whitelisted in `PUBLIC_API_PATHS`
- full cryptographic RBAC verification remains in individual API Route Handlers — middleware only validates format/presence
- middleware is 100% stateless and must never call Redis, PostgreSQL, or any external service

## Assumptions
- The initial launch targets a web product first, not native mobile.
- Binance is the first centralized exchange integration.
- Onchain launchpad support can begin on Base/BNB chain and expand later.
- Crypto billing via automated onchain settlement is the primary automated payment rail.
- Paper trading and testnet come before any broad live rollout.
- The team accepts a split architecture with Vercel plus an always-on worker runtime.

## Open Questions
- Which chain is first for launchpad contracts?
- Is the first launchpad mode bonding curve, fair launch, or both?
- Is KYC required before live trading, or only before launch participation and withdrawals?

