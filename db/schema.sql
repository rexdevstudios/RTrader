-- ============================================================================
-- Degen Crypto Launchpad, Trading Terminal, & AI Agent Platform
-- OPERATIONAL SSOT DDL SCHEMA
-- ============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0. POLYMORPHIC ENTITY REGISTRY
-- ----------------------------------------------------------------------------
CREATE TYPE entity_type AS ENUM (
    'USER',
    'AGENT',
    'TOKEN',
    'WALLET',
    'ORDER',
    'PROJECT',
    'LAUNCH_DRAFT',
    'COMPLIANCE_CASE'
);

CREATE TABLE entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type entity_type NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_entities_type ON entities(type);

-- ----------------------------------------------------------------------------
-- 1. NETWORK REGISTRY & RPC SUBSYSTEM
-- ----------------------------------------------------------------------------
CREATE TABLE networks (
    id VARCHAR(50) PRIMARY KEY, -- e.g. 'base-mainnet', 'base-sepolia', 'bsc-mainnet', 'solana-mainnet'
    chain_id BIGINT UNIQUE,     -- 8453, 84532, 56 (NULL for non-EVM like Solana)
    name VARCHAR(100) NOT NULL,
    network_family VARCHAR(20) NOT NULL DEFAULT 'EVM', -- EVM, SOLANA, MOVE
    native_currency_symbol VARCHAR(20) NOT NULL,        -- ETH, BNB, SOL
    native_currency_decimals INT NOT NULL DEFAULT 18,
    explorer_url TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE rpc_provider_type AS ENUM ('DRPC', 'DRPC_NODECLOUD', 'DRPC_NODECORE', 'ALCHEMY', 'ANKR', 'QUIKNODE', 'CUSTOM');
CREATE TYPE rpc_purpose AS ENUM ('PRIMARY', 'FALLBACK', 'ARCHIVE', 'INDEXER', 'TRANSACT');
CREATE TYPE rpc_health_status AS ENUM ('HEALTHY', 'DEGRADED', 'UNHEALTHY');

CREATE TABLE rpc_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id VARCHAR(50) NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
    provider rpc_provider_type NOT NULL DEFAULT 'DRPC',
    purpose rpc_purpose NOT NULL DEFAULT 'PRIMARY',
    http_url TEXT NOT NULL,
    ws_url TEXT,
    priority INT NOT NULL DEFAULT 1, -- 1 = Highest Priority
    weight INT NOT NULL DEFAULT 100, -- Load balancing weight
    rate_limit_rps INT NOT NULL DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE,
    health_status rpc_health_status NOT NULL DEFAULT 'HEALTHY',
    latency_ms INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rpc_endpoints_network ON rpc_endpoints(network_id, purpose, priority);

CREATE TABLE rpc_domain_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domain VARCHAR(50) NOT NULL, -- 'LAUNCHPAD', 'INTELLIGENCE', 'TRADING', 'AGENT'
    network_id VARCHAR(50) NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
    primary_rpc_id UUID NOT NULL REFERENCES rpc_endpoints(id),
    fallback_rpc_id UUID REFERENCES rpc_endpoints(id),
    archive_rpc_id UUID REFERENCES rpc_endpoints(id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID,
    UNIQUE(domain, network_id)
);

-- ----------------------------------------------------------------------------
-- 2. IDENTITY DOMAIN
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, FROZEN
    kyc_status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED', -- UNVERIFIED, PENDING, VERIFIED, REJECTED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address VARCHAR(255) NOT NULL,
    chain_type VARCHAR(50) NOT NULL, -- EVM, SOLANA
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(address, chain_type)
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- SUPER_ADMIN, SYSTEM_ADMIN, RISK_ADMIN, LAUNCH_ADMIN, BILLING_ADMIN, MODERATOR, TRADER, CREATOR
    granted_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(user_id, role)
);

-- ----------------------------------------------------------------------------
-- 3. BILLING DOMAIN (Dual-Rail: Stripe + Wallet Credit Ledger)
-- ----------------------------------------------------------------------------
CREATE TABLE plans (
    id VARCHAR(50) PRIMARY KEY, -- FREE, CREATOR, TRADER, AGENT, ENTERPRISE
    name VARCHAR(100) NOT NULL,
    base_price_cents INT NOT NULL DEFAULT 0,
    monthly_credits INT NOT NULL DEFAULT 0,
    features JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL REFERENCES plans(id),
    stripe_subscription_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(18, 4) NOT NULL, -- positive = credit, negative = debit
    currency VARCHAR(20) NOT NULL DEFAULT 'CREDITS',
    type VARCHAR(50) NOT NULL, -- SUBSCRIPTION_GRANT, AGENT_FEE, LAUNCH_FEE, OVERAGE_CHARGE, REFUND
    reference_id VARCHAR(255),
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_user_date ON ledger_entries(user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 4. LAUNCHPAD DOMAIN (5 Launch Modes & Graduation)
-- ----------------------------------------------------------------------------
CREATE TYPE launch_mode AS ENUM (
    'FAIR_LAUNCH',
    'BONDING_CURVE',
    'FIXED_PRICE',
    'WHITELIST_PRIVATE',
    'COMMUNITY_PRELAUNCH'
);

CREATE TABLE launch_drafts (
    id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    ticker VARCHAR(20) NOT NULL,
    description TEXT,
    image_url TEXT,
    social_links JSONB DEFAULT '{}'::jsonb,
    launch_mode launch_mode NOT NULL DEFAULT 'BONDING_CURVE',
    target_chain VARCHAR(50) NOT NULL REFERENCES networks(id),
    total_supply NUMERIC(36, 0) NOT NULL,
    creator_allocation_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    bonding_curve_config JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PENDING_REVIEW, APPROVED, REJECTED, PUBLISHED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE token_launches (
    id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    draft_id UUID NOT NULL REFERENCES launch_drafts(id),
    contract_address VARCHAR(255) NOT NULL UNIQUE,
    chain VARCHAR(50) NOT NULL REFERENCES networks(id),
    current_supply NUMERIC(36, 0) NOT NULL,
    raised_amount NUMERIC(36, 18) NOT NULL DEFAULT 0,
    graduation_threshold NUMERIC(36, 18) NOT NULL,
    is_graduated BOOLEAN DEFAULT FALSE,
    graduated_at TIMESTAMPTZ,
    dex_pair_address VARCHAR(255),
    risk_score INT DEFAULT 0,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE launch_whitelists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    launch_draft_id UUID NOT NULL REFERENCES launch_drafts(id) ON DELETE CASCADE,
    merkle_root VARCHAR(66) NOT NULL,
    max_allocation_per_wallet NUMERIC(36, 18) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE launch_vesting_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    launch_id UUID NOT NULL REFERENCES token_launches(id) ON DELETE CASCADE,
    beneficiary_wallet VARCHAR(255) NOT NULL,
    total_amount NUMERIC(36, 0) NOT NULL,
    cliff_duration_days INT NOT NULL DEFAULT 0,
    vesting_duration_days INT NOT NULL DEFAULT 365,
    claimed_amount NUMERIC(36, 0) NOT NULL DEFAULT 0,
    start_time TIMESTAMPTZ NOT NULL
);

-- ----------------------------------------------------------------------------
-- 4.1 SOCIALFI & KOL REPUTATION EXTENSION
-- ----------------------------------------------------------------------------
CREATE TABLE kol_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    twitter_handle VARCHAR(100) UNIQUE,
    twitter_id VARCHAR(100),
    followers_count INT NOT NULL DEFAULT 0,
    trust_score INT NOT NULL DEFAULT 50, -- 0 to 100
    completed_bounties INT NOT NULL DEFAULT 0,
    total_earned_usd NUMERIC(18, 4) NOT NULL DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bounty_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    launch_id UUID NOT NULL REFERENCES token_launches(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    required_hashtag VARCHAR(100) NOT NULL,
    min_followers INT NOT NULL DEFAULT 100,
    reward_per_kol NUMERIC(36, 0) NOT NULL,
    max_participants INT NOT NULL DEFAULT 10,
    current_participants INT NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bounty_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES bounty_campaigns(id) ON DELETE CASCADE,
    kol_id UUID NOT NULL REFERENCES kol_profiles(id) ON DELETE CASCADE,
    proof_url TEXT NOT NULL,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, VERIFIED, REJECTED, CLAIMED
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 5. TRADING DOMAIN (Binance Read+Trade Key Guard & Idempotency)
-- ----------------------------------------------------------------------------
CREATE TABLE binance_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    encrypted_api_key TEXT NOT NULL,
    encrypted_secret_key TEXT NOT NULL,
    key_permissions JSONB NOT NULL DEFAULT '{"read": true, "trade": true, "withdraw": false}'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE trade_stage AS ENUM ('PAPER', 'TESTNET', 'LIVE');
CREATE TYPE order_side AS ENUM ('BUY', 'SELL');
CREATE TYPE order_type AS ENUM ('LIMIT', 'MARKET', 'STOP_LOSS', 'TAKE_PROFIT');

CREATE TABLE trade_intents (
    id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_proposal_id UUID,
    stage trade_stage NOT NULL DEFAULT 'PAPER',
    symbol VARCHAR(20) NOT NULL,
    side order_side NOT NULL,
    type order_type NOT NULL,
    quantity NUMERIC(18, 8) NOT NULL,
    price NUMERIC(18, 8),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_RISK', -- PENDING_RISK, APPROVED, REJECTED, EXECUTED, CANCELLED
    risk_decision_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id UUID NOT NULL REFERENCES trade_intents(id) ON DELETE CASCADE,
    exchange_order_id VARCHAR(255),
    symbol VARCHAR(20) NOT NULL,
    status VARCHAR(50) NOT NULL, -- NEW, FILLED, PARTIALLY_FILLED, REJECTED, CANCELED
    executed_qty NUMERIC(18, 8) DEFAULT 0,
    cummulative_quote_qty NUMERIC(18, 8) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 6. AGENT DOMAIN (Daytona Sandbox Execution & Proposals)
-- ----------------------------------------------------------------------------
CREATE TABLE agent_profiles (
    id UUID PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    strategy_description TEXT,
    system_prompt TEXT NOT NULL,
    risk_tolerance_level VARCHAR(20) DEFAULT 'MODERATE', -- LOW, MODERATE, HIGH, DEGEN
    status VARCHAR(50) DEFAULT 'IDLE', -- IDLE, RUNNING_SANDBOX, PAUSED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_sandbox_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    daytona_workspace_id VARCHAR(255) NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    execution_status VARCHAR(50) NOT NULL DEFAULT 'RUNNING', -- RUNNING, COMPLETED, FAILED, TIMED_OUT
    logs_url TEXT,
    credits_consumed INT NOT NULL DEFAULT 5,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE agent_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_symbol VARCHAR(20) NOT NULL,
    action order_side NOT NULL,
    suggested_qty NUMERIC(18, 8) NOT NULL,
    suggested_price NUMERIC(18, 8),
    rationale TEXT NOT NULL,
    confidence_score NUMERIC(5, 4) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_APPROVAL', -- PENDING_APPROVAL, APPROVED, REJECTED, EXPIRED
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7. INTELLIGENCE DOMAIN (Firecrawl Scraping & Chain Events)
-- ----------------------------------------------------------------------------
CREATE TABLE scraped_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_url TEXT NOT NULL,
    domain VARCHAR(100) NOT NULL,
    raw_content TEXT,
    markdown_content TEXT,
    extracted_metadata JSONB DEFAULT '{}'::jsonb,
    firecrawl_job_id VARCHAR(255),
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE chain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    network_id VARCHAR(50) NOT NULL REFERENCES networks(id),
    block_number BIGINT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    contract_address VARCHAR(255) NOT NULL,
    event_data JSONB NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chain_events_tx ON chain_events(tx_hash, contract_address);

-- ----------------------------------------------------------------------------
-- 8. RISK & COMPLIANCE DOMAIN
-- ----------------------------------------------------------------------------
CREATE TABLE risk_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    score INT NOT NULL, -- 0 (safe) to 100 (critical threat)
    factors JSONB NOT NULL DEFAULT '[]'::jsonb,
    calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE kill_switches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope VARCHAR(50) NOT NULL, -- GLOBAL, USER, AGENT, TOKEN
    target_id UUID,
    is_active BOOLEAN DEFAULT TRUE,
    reason TEXT NOT NULL,
    activated_by UUID NOT NULL REFERENCES users(id),
    deactivated_by UUID REFERENCES users(id),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 9. ADMIN & AUDIT DOMAIN (Dual-Control & Audit Log)
-- ----------------------------------------------------------------------------
CREATE TABLE dual_control_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type VARCHAR(100) NOT NULL, -- OVERRIDE_RISK, UPDATE_RPC, REFUND_USER, CHANGE_FEE
    requested_by UUID NOT NULL REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED, EXPIRED
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_id UUID REFERENCES entities(id),
    ip_address VARCHAR(45),
    user_agent TEXT,
    payload_before JSONB,
    payload_after JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_actor_date ON audit_logs(actor_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 10. CRYPTO BILLING ENGINE & ARKHAM INTELLIGENCE TABLES
-- ----------------------------------------------------------------------------
CREATE TABLE crypto_payment_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) REFERENCES plans(id),
    token_symbol VARCHAR(20) NOT NULL, -- USDT, USDC, ETH, BNB, DEGEN
    token_address VARCHAR(255) NOT NULL,
    chain_type VARCHAR(50) NOT NULL, -- BASE_MAINNET, BNB_MAINNET, ETH_MAINNET
    expected_amount_wei VARCHAR(255) NOT NULL,
    expected_credits INT NOT NULL,
    treasury_wallet VARCHAR(255) NOT NULL,
    tx_hash VARCHAR(255),
    block_number BIGINT,
    confirmations INT DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'CREATED', -- CREATED, PENDING_CONFIRMATION, SETTLED, REJECTED, EXPIRED, FALLBACK_REQUIRED
    expires_at TIMESTAMPTZ NOT NULL,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crypto_payment_user ON crypto_payment_intents(user_id, status);
CREATE INDEX idx_crypto_payment_tx ON crypto_payment_intents(tx_hash);

CREATE TABLE arkham_intelligence_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    wallet_address VARCHAR(255) NOT NULL,
    arkham_entity_name VARCHAR(255),
    arkham_entity_type VARCHAR(100), -- EXCHANGE, WHALE, VC, SANCTIONED, UNKNOWN
    risk_passport_score INT DEFAULT 50, -- 0-100 (100 = safest, 0 = high risk)
    is_counterparty_blocked BOOLEAN DEFAULT FALSE,
    raw_intelligence JSONB DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(wallet_address)
);

CREATE INDEX idx_arkham_profile_wallet ON arkham_intelligence_profiles(wallet_address);

