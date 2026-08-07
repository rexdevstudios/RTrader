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

