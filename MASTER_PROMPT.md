# MASTER PROMPT
## Degen Launchpad, Trading Terminal, & AI Agent Platform

### Purpose
This document is the canonical operating context for all future AI-assisted development, planning, implementation, review, and evolution of the platform. It exists so the AI agent, future contributors, and operators never lose the architectural intent, domain boundaries, safety rules, and long-term product direction.

### North Star
Build and maintain a crypto platform that combines:
- a degen token launchpad
- a Binance-connected trading terminal
- an AI agent for analysis and proposal generation
- onchain and web intelligence enrichment
- strong governance, compliance, auditability, and production stewardship

The system must remain:
- safe
- modular
- auditable
- cost-aware
- extensible
- production-ready
- future-proof
- easy to maintain

### Non-Negotiable Architecture Principles
- Next.js + Vercel is the Control Plane only.
- Always-on workers run in a separate Execution Plane.
- Postgres is the Operational SSOT.
- Critical live trading paths must remain isolated from optional extensions.
- AI agents must remain proposal-only and never execute live trades directly.
- Binance API keys must be rejected if withdrawal permission is enabled.
- All sensitive actions must be audited.
- All changes to critical systems must respect dual-control and approval discipline.
- All extensions must be bounded and failure-contained.
- All evolution must preserve the core path and existing maturity level.

### Core System Invariant
The critical live execution path is:

User Action -> RBAC Middleware -> Deterministic Risk Gate -> Binance Order Worker -> Postgres SSOT

This path must not import or depend directly on optional services such as:
- bots
- telemetry analytics
- Firecrawl
- external enrichment modules
- experimental adapters

Optional systems must receive data asynchronously and must not block or slow down core live execution.

### Product Domains
The platform is composed of these domains:

#### 1. Identity
Owns:
- SIWE / wallet login
- sessions
- role and permission mapping
- ownership anchors
- approval identity tracing

#### 2. Billing
Owns:
- subscriptions
- usage-based credits
- entitlements
- invoices
- overage handling
- ledger entries

#### 3. Launchpad
Owns:
- token drafts
- fair launch
- bonding curve launch
- fixed-price launch
- whitelist/private launch
- community pre-launch
- graduation rules
- moderation
- launch risk scoring

#### 4. Trading
Owns:
- Binance credential vault
- order intent state machine
- paper trading
- testnet trading
- live trading
- execution worker
- websocket reconciliation

#### 5. Agent
Owns:
- proposal generation
- approval workflow
- sandbox execution
- backtesting
- strategy simulation
- run logs

#### 6. Intelligence
Owns:
- Firecrawl ingestion
- onchain intelligence
- entity / wallet enrichment
- watchlists
- labels
- cross-source fusion

#### 7. Risk
Owns:
- deterministic risk evaluation
- max order cap
- slippage checks
- daily loss cap
- kill switch evaluation
- policy enforcement

#### 8. Compliance
Owns:
- sanctions / geofencing
- account freeze / thaw
- review cases
- evidence trails
- jurisdiction restrictions

#### 9. Admin
Owns:
- dual-control approval
- overrides
- incident actions
- kill switches
- operational governance
- support tooling

#### 10. Platform Ops
Owns:
- RPC registry
- worker health
- backups
- restore
- rollback
- stewardship
- long-term sustainment
- maturity assessment
- future-proof governance

### Feature List by Category
#### Identity & Access
- wallet login
- session management
- RBAC middleware
- role-based authorization
- ownership mapping
- approval traceability

#### Launchpad
- create token draft
- fair launch
- bonding curve
- fixed price launch
- whitelist/private launch
- community pre-launch
- anti-bot logic
- graduation to DEX
- launch moderation
- reputation / passport scoring

#### Trading
- encrypted Binance vault
- no-withdrawal validation
- paper / testnet / live modes
- deterministic risk gate
- idempotent order execution
- websocket fill sync
- balance reconciliation
- emergency disable per user

#### AI Agent
- proposal-only agent
- approval flow
- backtesting
- sandbox execution
- confidence scoring
- rationale capture
- audit trail

#### Intelligence
- Firecrawl scraping
- web enrichment
- onchain indexing
- entity labels
- wallet intelligence
- watchlists

#### Risk
- max order cap
- max slippage
- daily loss cap
- kill switch
- trade halt
- risk scoring
- policy decisions

#### Compliance
- geofencing
- sanctions screening
- freeze / thaw
- compliance review queue
- evidence trail
- account restriction logic

#### Billing
- Stripe subscriptions
- wallet credit ledger
- usage metering
- entitlement checks
- overage control
- billing audit logs

#### Admin
- dual-control approval queue
- no self-approval
- emergency override
- freeze token / user / agent
- configuration governance
- audit trails

#### Platform Operations
- network registry
- RPC hot reload
- fallback provider support
- runbook
- backup / restore
- rollback
- observability
- stewardship
- maturity scoring
- future-proof evolution
- core path protection
- async extension boundary
- adapter-based bounded evolution

### Data Ownership Rules
- Each domain owns its own write model.
- Shared IDs should use the entity registry pattern.
- Cross-domain data should be replicated by events or read models.
- One domain must not mutate another domain’s core tables directly.
- Operational truth lives in Postgres SSOT.
- External sources remain external truth for settlement or verification.

### Security Rules
- Encrypt secrets at rest.
- Do not commit private keys or seed phrases.
- Use least-privilege credentials.
- Reject Binance keys with withdrawal permission.
- Log every sensitive action.
- Require dual approval for high-risk changes.
- Use kill switches for emergency containment.
- Treat all AI output as untrusted until validated.
- Never allow LLMs to bypass the risk gate.

### Core Path Protection Rules
The following are forbidden on the critical live path:
- direct calls to Telegram bots
- direct calls to telemetry services
- direct calls to Firecrawl
- direct calls to optional analytics
- direct AI execution of trades
- bypassing RBAC
- bypassing Risk Gate
- bypassing audit logging
- bypassing vault validation

Extensions must:
- receive data asynchronously
- fail independently
- never block live execution
- never mutate the critical path
- never become a dependency of the order settlement route

### Adapter Evolution Rules
If new infrastructure is added:
- new blockchain support must use an adapter interface
- new exchange support must use a worker adapter interface
- DDL core schema must remain stable unless approved via dual-control
- new adapters must be bounded and isolated
- new adapters must not break the existing SSOT contract
- new adapters must be tested against regression fitness functions

### Governance Rules
- All sensitive actions require traceability.
- All critical changes require review and approval.
- Dual-control is mandatory for high-risk admin actions.
- Self-approval is forbidden for protected actions.
- Emergency actions must be auditable.
- Policy violations must be rejectable by automation.
- Production changes must be rollbackable.
- Decisions must be recorded with rationale.

### Operational Rules
- Production readiness must be continuously maintained.
- Health checks, readiness checks, backups, and rollback must remain active.
- Weekly, monthly, and quarterly reviews must be scheduled.
- Runbooks must match the live system.
- Stewardship docs must be refreshed when the system changes.
- Continuous improvement must be grounded in real operational data.

### Compliance Rules
- KYC / AML hooks must be supported.
- Jurisdiction gating must be configurable.
- Sanctions checks must be auditable.
- Account freeze/thaw must be recoverable and traceable.
- Compliance exceptions require reasons, approval, and expiry.
- Compliance evidence must be retained for review.

### Billing Rules
- Subscription plans must map to entitlements.
- Usage metering must be ledger-backed.
- Overages must either block or bill, based on plan.
- Premium features must check entitlement before execution.
- Billing state must be authoritative for paid actions.
- Billing actions must be auditable.

### Launchpad Rules
- Token launches must support multiple launch modes.
- Fair launch must be transparent.
- Anti-bot and anti-sybil controls must be active.
- Graduation rules must be explicit.
- Moderation must exist for risky launches.
- Launch metadata must remain inspectable.

### Trading Rules
- Binance API keys must be validated on ingestion.
- Keys with withdrawal enabled must be rejected.
- Orders must go through trade intents first.
- Live trades must pass deterministic risk checks.
- Order execution must be idempotent.
- Fill and balance reconciliation must be reliable.
- Paper, testnet, and live modes must stay separated.

### AI Agent Rules
- Agent can propose, not execute.
- Proposal must have rationale, confidence, and expiry.
- User approval is required.
- Risk engine must still approve before execution.
- Agent runs must be sandboxed.
- Backtests must be reproducible.
- Agent output must remain auditable.

### Documentation Rules
The canonical docs are:
- MASTER_PROMPT.md
- ADR.md
- SSOT.md
- GUIDE.md
- DOMAIN_MAP.md
- API_MAP.md
- production_runbook.md
- stewardship_policy.md
- platform_assessment.md
- long_term_sustainment.md
- future_proof_governance.md
- core_path_protection.md
- protected_evolution.md

If any implementation conflicts with these docs, the docs win until formally updated through the proper governance process.

### Future-Proofing Rules
- Keep the core path simple.
- Keep optional systems asynchronous.
- Keep adapters bounded.
- Keep changes reversible.
- Keep operational knowledge documented.
- Keep the system within maturity Level 5.
- Preserve auditability and SSOT integrity.
- Do not let convenience destroy architecture.

### AI Agent Operating Instruction
When working on this platform, the AI agent must:
1. Read the canonical docs first.
2. Respect the domain boundaries.
3. Preserve the core path.
4. Never invent new policy that conflicts with SSOT/ADR.
5. Prefer additive improvements over disruptive rewrites.
6. Keep the architecture explainable to future maintainers.
7. Make the user’s system easier to operate, not harder.
8. Never forget that security and governance are product features, not afterthoughts.

### Final Goal
Build a platform that is:
- technically coherent
- operationally safe
- financially accountable
- compliance-aware
- evolution-ready
- future-proof
- auditable
- maintainable
- production-ready

The platform should remain understandable even after many future changes, and every new feature must fit within the architecture rather than weakening it.
