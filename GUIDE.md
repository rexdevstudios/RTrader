# Guide: Platform Rules and Reading Order

## How to Read This System
Read in this order:

1. `ADR.md` for architectural decisions
2. `SSOT.md` for the canonical product and data rules
3. `DOMAIN_MAP.md` for domain boundaries and ownership
4. `API_MAP.md` for service contracts and integration flow

## Core Rules
- Keep the control plane separate from execution workloads.
- Treat Postgres as the operational SSOT.
- Never allow AI to bypass deterministic policy checks.
- Never expose withdrawal-enabled exchange credentials to the platform.
- Every sensitive action must create an audit trail.
- Every money-moving action must pass billing and risk checks.
- Every launch configuration must be explicit, versioned, and reviewable.

## Operating Rules by Topic

### Launchpad
- Launches must declare mode, allocation, fees, and graduation rules.
- Fair launch mode must not allow hidden creator advantage.
- Launch moderation is required before public listing.
- Risk flags can block, delay, or downgrade a launch.

### Trading
- Paper trading is the default safe entry point.
- Testnet must precede live trading.
- Live trading requires valid entitlement, risk clearance, and exchange permissions.
- All order paths must be idempotent and auditable.

### AI Agents
- Agents may analyze, propose, and simulate.
- Agents may not settle trades by themselves.
- Agent actions must be bounded by plan, credit, and risk policy.
- Agent outputs are advisory until approved by the execution layer.

### Billing
- Every billable event writes to the ledger.
- Plans grant allowances; overages are either blocked or charged.
- Billing state can gate access to premium features and live actions.
- Creator, trader, and agent usage should be priced separately when needed.

### Admin and Security
- Admin roles must be separated by function.
- High-risk actions require dual control or break-glass approval.
- Compliance and risk teams can freeze or review entities.
- Audit logs are immutable and retained independently from app logs.

## Implementation Guidance
- If a rule affects money, trading, or launch issuance, model it as data first and UI second.
- If a rule may change later, version it.
- If a decision can be automated, still keep a manual override path for admins.
- If two systems disagree, use the external source of truth for settlement and the internal ledger for platform state.

