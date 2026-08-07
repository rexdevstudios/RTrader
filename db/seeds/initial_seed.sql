-- ============================================================================
-- INITIAL SEED DATA FOR PLATFORM SSOT
-- ============================================================================

-- 1. NETWORKS SEED
INSERT INTO networks (id, chain_id, name, network_family, native_currency_symbol, native_currency_decimals, explorer_url) VALUES
('base-mainnet', 8453, 'Base Mainnet', 'EVM', 'ETH', 18, 'https://basescan.org'),
('base-sepolia', 84532, 'Base Sepolia Testnet', 'EVM', 'ETH', 18, 'https://sepolia.basescan.org'),
('bsc-mainnet', 56, 'BNB Smart Chain Mainnet', 'EVM', 'BNB', 18, 'https://bscscan.com'),
('bsc-testnet', 97, 'BNB Smart Chain Testnet', 'EVM', 'tBNB', 18, 'https://testnet.bscscan.com')
ON CONFLICT (id) DO NOTHING;

-- 2. RPC ENDPOINTS SEED (dRPC Primary, Ankr Fallback)
INSERT INTO rpc_endpoints (id, network_id, provider, purpose, http_url, ws_url, priority, weight, rate_limit_rps) VALUES
('11111111-1111-1111-1111-111111111111', 'base-mainnet', 'DRPC', 'PRIMARY', 'https://lb.drpc.org/ogrpc?network=base&key=AswKP7vLrEsUmdIDLg6ZgrwzsKMjkiIR8YUJRoYgFhqK', 'wss://lb.drpc.org/ogws?network=base&key=AswKP7vLrEsUmdIDLg6ZgrwzsKMjkiIR8YUJRoYgFhqK', 1, 100, 200),
('22222222-2222-2222-2222-222222222222', 'base-mainnet', 'ANKR', 'FALLBACK', 'https://rpc.ankr.com/base', NULL, 2, 50, 50),
('33333333-3333-3333-3333-333333333333', 'bsc-mainnet', 'DRPC', 'PRIMARY', 'https://lb.drpc.org/ogrpc?network=bsc&key=AswKP7vLrEsUmdIDLg6ZgrwzsKMjkiIR8YUJRoYgFhqK', 'wss://lb.drpc.org/ogws?network=bsc&key=AswKP7vLrEsUmdIDLg6ZgrwzsKMjkiIR8YUJRoYgFhqK', 1, 100, 200),
('44444444-4444-4444-4444-444444444444', 'bsc-mainnet', 'ANKR', 'FALLBACK', 'https://rpc.ankr.com/bsc', NULL, 2, 50, 50)
ON CONFLICT (id) DO NOTHING;

-- 3. RPC DOMAIN CONFIG SEED
INSERT INTO rpc_domain_configs (domain, network_id, primary_rpc_id, fallback_rpc_id) VALUES
('LAUNCHPAD', 'base-mainnet', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
('TRADING', 'base-mainnet', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
('INTELLIGENCE', 'base-mainnet', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
('AGENT', 'base-mainnet', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
('LAUNCHPAD', 'bsc-mainnet', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444')
ON CONFLICT (domain, network_id) DO NOTHING;

-- 4. BILLING PLANS SEED
INSERT INTO plans (id, name, base_price_cents, monthly_credits, features) VALUES
('FREE', 'Free Tier', 0, 100, '{"paper_trading": true, "view_launchpad": true, "live_trading": false, "daytona_sandbox": false}'::jsonb),
('CREATOR', 'Creator Tier', 4900, 2000, '{"paper_trading": true, "view_launchpad": true, "create_launch": true, "auto_moderation_priority": true}'::jsonb),
('TRADER', 'Trader Tier', 7900, 5000, '{"paper_trading": true, "view_launchpad": true, "live_trading": true, "binance_ws_streams": true}'::jsonb),
('AGENT', 'Agent Tier', 14900, 15000, '{"paper_trading": true, "view_launchpad": true, "live_trading": true, "daytona_sandbox": true, "ai_proposals": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;
