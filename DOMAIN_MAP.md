# Domain Map

## Purpose
This document splits the platform into domains so the codebase and teams can stay readable, testable, and independently evolvable.

## Domains

### 1. Identity Domain
Owns:
- user accounts
- wallet connections
- sessions
- roles and permissions
- access policies

Primary data:
- users
- sessions
- wallets
- roles
- permissions
- policy grants

### 2. Billing Domain
Owns:
- plans
- subscriptions
- credits
- invoices
- usage meters
- automated crypto payment rail (dRPC onchain verifier)
- custom token payment adapter (staged extension)

Primary data:
- plans
- subscriptions
- invoices
- ledger entries
- usage events
- crypto_payment_intents

### 3. Launchpad Domain
Owns:
- token drafts
- launch configuration
- fair launch rules
- bonding curve configuration
- graduation logic
- token moderation workflow

Primary data:
- launch drafts
- token metadata
- allocations
- vesting schedules
- risk reviews
- launch events

### 4. Trading Domain
Owns:
- order intents
- portfolio state
- paper trading
- testnet trading
- live order orchestration
- execution receipts

Primary data:
- orders
- fills
- positions
- balances
- execution reports
- trade limits

### 5. Agent Domain
Owns:
- agent definitions
- strategies
- prompts
- sandbox runs
- backtests
- signal generation

Primary data:
- agent profiles
- strategy versions
- run logs
- backtest results
- proposals

### 6. Intelligence Domain
Owns:
- onchain data ingestion
- wallet labeling & risk profiling (Arkham API)
- market data aggregation
- web scraping enrichment (Firecrawl)
- event normalization

Primary data:
- chain events
- price series
- labels
- scraped documents
- derived signals
- arkham_intelligence_profiles

### 7. Risk Domain
Owns:
- risk scoring
- trade limits
- launch flags
- anomaly detection
- kill switches
- escalation rules

Primary data:
- risk scores
- policy decisions
- flags
- freezes
- overrides

### 8. Compliance Domain
Owns:
- KYC and AML state
- jurisdiction gating
- blacklists
- case review
- evidence trails

Primary data:
- compliance cases
- checks
- jurisdiction records
- audit artifacts

### 9. Admin Domain
Owns:
- internal operations
- feature flags
- configuration
- support tooling
- incident response

Primary data:
- admin actions
- config versions
- feature toggles
- support cases

## Domain Boundaries
- Identity can authorize, but not settle trades.
- Billing can bill, but not override risk.
- Launchpad can configure launches, but not bypass compliance.
- Trading can execute approved orders, but not modify launch rules.
- Agents can propose, but not self-approve live money movement.
- Intelligence can enrich data, but not become settlement truth.
- Risk can block and require review, but should not rewrite user intent.
- Admin can operate the platform, but must leave a complete audit trail.

## Ownership Rules
- Each domain owns its own write model.
- Cross-domain data is replicated by events or read models.
- Shared IDs should use the entity registry pattern.
- One domain should not directly mutate another domain's core tables.

