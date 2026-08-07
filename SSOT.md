# SSOT: Degen Launchpad, Trading Terminal, and AI Agent Platform

## Purpose
This document is the single source of truth for product, operational, data, and security decisions for the platform.

## Product Scope
The platform includes:

- token launchpad for meme/degen assets
- creator tooling and launch configuration
- user trading terminal
- Binance integration for live and test trading
- AI agent for analysis, alerting, and assisted execution
- web intelligence and onchain intelligence enrichment
- admin, moderation, billing, and compliance operations

## Product Principles
- Launches must be transparent.
- Live trading must be guarded by deterministic risk controls.
- AI agents may suggest, never freely bypass policy.
- User funds and platform funds must be separated logically.
- Auditability is mandatory for money movement and admin actions.
- The platform must support a low-cost MVP path first.

## Core Roles

### External Roles
- Guest
- User
- Creator
- Trader
- Agent Owner
- Moderator
- Compliance User

### Internal Roles
- Super Admin
- System Admin
- Billing Admin
- Risk Admin
- Launch Admin
- Support Admin
- Read-only Auditor

## RBAC Matrix

| Capability | Guest | User | Creator | Trader | Agent Owner | Moderator | Compliance | Super Admin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| View tokens | Y | Y | Y | Y | Y | Y | Y | Y |
| Connect wallet | N | Y | Y | Y | Y | Y | Y | Y |
| Create launch draft | N | N | Y | N | N | N | N | Y |
| Publish launch | N | N | Y | N | N | N | N | Y |
| Trade manually | N | Y | Y | Y | Y | N | N | Y |
| Enable live agent | N | N | N | N | Y | N | N | Y |
| Review flagged token | N | N | N | N | N | Y | Y | Y |
| Freeze token/listing | N | N | N | N | N | Y | Y | Y |
| Manage billing plans | N | N | N | N | N | N | N | Y |
| Override risk engine | N | N | N | N | N | N | N | Break-glass only |

## Monetization Model

### Platform-paid costs
These are paid by the operator:
- Vercel / Cloudflare hosting
- Postgres hosting
- RPC provider calls
- scraping calls
- queue/cache usage
- sandbox compute
- observability and logs

### User-paid costs
These are paid by the customer or creator:
- subscription plans
- usage-based credits
- launch fees
- trading fees
- agent execution fees
- featured placement
- premium data access

### Payment rails
- Automated Crypto Payment Rail (USDT / USDC / ETH / BNB with dRPC verification) as Primary Payment Engine
- Wallet-based Credit Ledger (Postgres SSOT) for internal metered credit usage
- Custom Deployed Token Payment Rail as Optional Staged Extension (Stage 2/3)
- Optional Stripe Integration for fiat credit cards (non-mandatory)

### Billing logic
- Every billable action creates a ledger entry.
- Every plan grants a base allowance.
- Overages are either blocked or charged, depending on account type.
- Live trading and high-cost agent actions require valid billing state.
- Free users can explore, paper trade, and test, but not consume expensive resources indefinitely.

## Technical SSOT

### Control Plane
- Next.js
- Vercel
- Auth layer with wallet login and normal account login
- Admin UI
- Creator dashboard
- Trading dashboard

### Data Plane
- Postgres as operational SSOT
- Event log for all user, admin, and system actions
- Chain indexer
- Market data cache
- Risk scoring pipeline
- Billing ledger

### Execution Plane
- Binance trading worker
- websocket listener
- chain indexer worker
- AI sandbox runtime
- scheduled jobs and retries

## Recommended Service Map

| Need | Recommended Option | Notes |
|---|---|---|
| Web app | Vercel | Best for Next.js control plane |
| Low-cost edge logic | Cloudflare Workers / Pages | Good for light APIs and protection |
| Postgres | Neon or Supabase | Neon for lean DB; Supabase for integrated auth/storage |
| Cache / queue | Upstash Redis / QStash | Good for rate limits, jobs, and retries |
| Object storage | Cloudflare R2 | Good for token images and artifacts |
| RPC | dRPC | Strong cost/performance for chain reads |
| Onchain analytics | DefiLlama / Dune / Alchemy | Mix based on workload |
| Entity & Wallet Intelligence | Arkham API | Wallet risk profiling & counterparty screening |
| Web scraping | Firecrawl | Good for token/project intelligence |
| AI sandbox | Daytona | Good for isolated agent execution |
| Exchange trading | Binance API | Use read + trade only |

## Data Ownership and Truth

### External truth
- blockchain state
- exchange balances and fills
- fiat processor payment status
- KYC/AML provider status

### Internal truth
- user profile
- role assignments
- plan and entitlement
- token draft metadata
- launch configuration
- order intent
- risk decisions
- billing ledger
- admin actions

### Mirror data
- chain events
- wallet labels
- token price history
- exchange user stream events
- scraping results

## Launchpad Truth Model

### Launch modes
- Fair launch
- Bonding curve launch
- Fixed price launch
- Whitelist/private launch
- Community pre-launch

### Fair launch rules
- No hidden allocation
- No creator early access before public phase
- Per-wallet buy limits in early phase
- Anti-bot and anti-sybil protections
- Public disclosure of supply, fees, and allocation
- Transparent graduation conditions

### Required launch metadata
- name
- ticker
- description
- image
- socials
- chain
- contract address
- supply
- creator allocation
- vesting schedule
- fee schedule
- launch mode
- graduation rule
- risk score
- audit status

### Risk checks
- ownership and mint authority
- freeze authority
- liquidity lock status
- holder concentration
- suspicious wallet clustering
- tax/honeypot patterns
- creator wallet behavior
- contract verification

## Trading Truth Model

### Trading stages
- paper trading
- Binance testnet
- restricted live trading
- scaled live trading

### Execution rules
- every order has an idempotency key
- every order passes risk checks
- no withdrawal permission on API keys
- live orders are logged immutably
- all fills reconcile to the ledger
- kill switch can stop user, agent, or whole platform

### Risk controls
- max order size
- max daily loss
- max slippage
- max open positions
- cooldown after repeated losses
- per-user and per-agent rate limits

## AI Agent Truth Model

### What the agent may do
- scan market data
- read chain data
- read web intelligence
- propose trades
- run backtests
- produce alerts
- suggest launch risk scores

### What the agent may not do
- bypass risk engine
- hold withdrawal-enabled exchange keys
- write directly to settlement state
- silently change billing or permissions
- execute unapproved live trades

### Agent pipeline
input data -> feature assembly -> strategy model -> proposal -> risk engine -> execution gateway -> audit log

## Admin Domain Model

### Platform Ops
- feature flags
- config
- incidents
- environment management

### Money Ops
- billing plans
- invoice adjustments
- usage limits
- credit grants
- refunds

### Risk Ops
- token flagging
- trade halts
- manual review
- global kill switch

### Compliance Ops
- KYC and AML review
- jurisdictional gating
- blacklists
- audit review

### Launch Ops
- listing moderation
- promotion decisions
- emergency delisting
- creator verification review

## Security Requirements
- Encrypt secrets at rest.
- Use least-privilege API keys.
- Separate platform funds from user funds.
- Maintain immutable audit logs for all sensitive actions.
- Require dual approval for fee changes, role changes, payout changes, and emergency overrides.
- Rate-limit all public and admin endpoints.
- Store sensitive credentials outside frontend access.
- Rotate credentials on schedule.
- Treat AI output as untrusted until validated.

## Compliance Hooks
- KYC gating must be addable without redesign.
- Jurisdiction filtering must be configurable.
- Suspicious activity must be traceable by user, wallet, agent, and token.
- Platform must support account freezing and case review.

## Observability
- application logs
- audit logs
- billing logs
- trading logs
- risk decisions
- webhook delivery logs
- agent run logs

## Recommended Revenue Structure
- Free tier: browsing, paper trading, basic watchlists
- Creator tier: launch tools, analytics, moderation queue
- Trader tier: live trading, alerts, advanced analytics
- Agent tier: sandbox runs, backtests, live agent limit
- Enterprise tier: API access, custom limits, dedicated support

## Assumptions
- The first market is web, not mobile native.
- Launchpad and trading will be built for one chain/exchange first, then expanded.
- The team wants a bootstrap path using free tiers where possible.
- Compliance requirements can increase over time without a re-architecture.

