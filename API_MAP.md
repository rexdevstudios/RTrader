# API Map

## Purpose
This document maps the major APIs and integration surfaces so the platform can be implemented consistently.

## Internal API Layers

### Web API
Used by:
- Next.js frontend
- admin console
- creator dashboard
- trading dashboard

Responsibilities:
- auth
- read models
- drafts
- settings
- plan state
- UI actions

### Execution API
Used by:
- trading worker
- chain indexer
- agent sandbox
- job runner

Responsibilities:
- order submission
- websocket reconciliation
- event ingestion
- job execution
- backtest runs

### Admin API
Used by:
- platform operators
- risk team
- compliance team
- billing team

Responsibilities:
- feature flags
- moderation
- refunds
- freezes
- overrides

## External API Map

### Authentication
- Wallet login
- password/email login
- session management
- role resolution

### Billing
- Stripe subscriptions
- usage events
- invoice status
- credit balance
- plan upgrades

### Launchpad
- create draft
- update draft
- validate launch
- publish launch
- flag launch
- graduate launch
- delist launch

### Trading
- connect Binance API key
- verify key permissions
- create paper order
- create testnet order
- create live order
- receive fill events
- sync balances

### Agents
- create agent
- update strategy
- run backtest
- start sandbox run
- generate proposal
- approve proposal
- archive run

### Intelligence
- fetch chain data
- fetch market data
- run scrape job
- normalize labels
- store derived signals
- fetch macro TVL snapshot (DefiLlama)
- compute market regime
- generate trading alerts and strategy signals

## Implemented Route Registry (as of Phase N)

### Auth Routes (Public)
- `POST /api/auth/challenge` — Generate SIWE nonce challenge
- `POST /api/auth/verify` — Verify SIWE signature → returns session token + sets `rtrader_session` HttpOnly cookie (8h TTL)

### System Routes (Public)
- `GET /api/system/overview` — Platform health, telemetry buffer, Redis/Postgres status

### Market Routes (Public, CDN-cacheable)
- `GET /api/market/chart?symbol=&interval=` — OHLCV candles + orderbook + IntelligenceSignal + macroContext + tradingAnalysis (regime, alerts, strategySignals, RSI, whale walls)
- `GET /api/market/macro` — DefiLlama chain TVL snapshot + macroSentiment (`s-maxage=60`)

### Trading Routes (Protected — requires session token)
- `POST /api/trade-intents` — Create trade intent, evaluated by TradingRiskGate and persisted to PostgreSQL trade_intents table

### Agent Routes (Protected — requires session token)
- `POST /api/agent/proposals/intelligence` — Generate AI proposal with IntelligenceSignal + DefiLlama macro enrichment

### Billing Routes (Public read / Protected write)
- `GET /api/billing/plans` — List available subscription plans
- `POST /api/billing/subscribe` — Subscribe user to plan (protected)

### Launchpad & SocialFi Routes (Public / Non-Custodial)
- `GET /api/launchpad/draft` — Fetch launch drafts and configurations
- `POST /api/launchpad/draft` — Create new multi-chain launch draft
- `POST /api/launchpad/publish` — Finalize on-chain deployment record into token_launches SSOT & mark draft PUBLISHED
- `GET /api/launchpad/tokens` — List active token launches from PostgreSQL SSOT
- `GET /api/launchpad/bounty/claim` — Fetch Merkle proof and claim eligibility (Base / Robinhood)
- `POST /api/launchpad/bounty/claim` — Submit or verify social bounty claim
- `POST /api/launchpad/bounty/verify-hodl` — Live on-chain HODL balance verification
- `POST /api/launchpad/seed-whitelist` — Verify angel/seed whitelist Merkle proofs
- `POST /api/launchpad/bounty/settle` — Settle verified claim on-chain with txHash confirmation
- `POST /api/launchpad/webhook` — Process external telemetry and indexing webhooks

## Security Layer (Edge Middleware)
- All `/api/*` routes (except PUBLIC_API_PATHS whitelist) require `rtrader_session` cookie or `Authorization: Bearer <token>` header
- 6 security headers applied universally: `X-Frame-Options: DENY`, `HSTS`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`
- Middleware is 100% stateless (Edge Runtime) — no DB/Redis calls

## Suggested API Contract Shape

### Entity APIs
Standardize around:
- `GET /entities/:id`
- `GET /entities/:id/events`
- `POST /entities`
- `PATCH /entities/:id`

### Launchpad APIs
- `POST /launch-drafts`
- `PATCH /launch-drafts/:id`
- `POST /launch-drafts/:id/validate`
- `POST /launches`
- `POST /launches/:id/graduate`
- `POST /launches/:id/freeze`

### Trading APIs
- `POST /trade-intents`
- `POST /trade-intents/:id/approve`
- `POST /trade-intents/:id/execute`
- `GET /portfolios/:id`
- `GET /orders/:id`
- `GET /fills`

### Agent APIs
- `POST /agents`
- `PATCH /agents/:id`
- `POST /agents/:id/backtests`
- `POST /agents/:id/runs`
- `POST /agent-proposals/:id/approve`

### Billing APIs
- `GET /billing/plans`
- `POST /billing/subscribe`
- `POST /billing/usage-events`
- `GET /billing/invoices`
- `POST /billing/credits/grant`

### Admin APIs
- `POST /admin/flags`
- `POST /admin/freezes`
- `POST /admin/overrides`
- `POST /admin/refunds`
- `GET /admin/audit-logs`

## Mapping Rules
- Every public write API must emit an event.
- Every execution API call must carry an idempotency key.
- Every admin mutation must record actor, target, reason, and timestamp.
- Every billing event must be traceable to a user action or system job.
- Every launch and trade decision must be reconstructable from logs and events.

