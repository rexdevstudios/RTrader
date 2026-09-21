/**
 * config.ts — Membaca dan memvalidasi semua environment variables saat startup.
 * Jika ada kunci wajib yang kosong, bot berhenti dengan pesan yang jelas.
 */
import { z } from "zod";

const booleanEnv = (defaultVal = false) =>
  z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (v === "true" || v === "1") return true;
    if (v === "false" || v === "0") return false;
    if (v === undefined || v === "") return defaultVal;
    return Boolean(v);
  }, z.boolean()).default(defaultVal);

const envSchema = z.object({
  // AI (Primary: Google Gemini, Fallback: ByteDance / BytePlus ModelArk)
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  BYTEDANCE_ARK_API_KEY: z.string().optional(),
  BYTEDANCE_MODEL_ENDPOINT: z.string().default("ep-20260906092451-nzlwx"),
  BYTEDANCE_BASE_URL: z.string().url().default("https://ark.ap-southeast.bytepluses.com/api/v3"),

  // Trend
  FIRECRAWL_API_KEY: z.string().min(1, "FIRECRAWL_API_KEY wajib diisi"),

  // IPFS
  PINATA_JWT: z.string().min(1, "PINATA_JWT wajib diisi"),
  PINATA_API_KEY: z.string().optional(),
  PINATA_API_SECRET: z.string().optional(),

  // EVM
  EVM_PRIVATE_KEY: z.string().min(1, "EVM_PRIVATE_KEY wajib diisi"),
  EVM_DEFAULT_CHAIN: z.enum(["base", "bsc", "ethereum"]).default("base"),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org"),
  BSC_RPC_URL: z.string().url().default("https://bsc-dataseed.binance.org"),
  ETH_RPC_URL: z.string().url().default("https://eth.llamarpc.com"),
  ROBINHOOD_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  ARBITRUM_RPC_URL: z.string().url().default("https://arb1.arbitrum.io/rpc"),

  // Bankr
  BANKR_API_KEY: z.string().optional(),
  BANKR_CHAIN: z.enum(["base", "robinhood", "arbitrum", "arc"]).default("base"),
  BANKR_DEGEN_MODE: booleanEnv(true),
  BANKR_SIMULATE_ONLY: booleanEnv(false),
  BANKR_QUOTE_ONLY_FEES: z.string().transform((v) => v !== "false").default("true"),
  BANKR_REQUIRE_GAS_SPONSORSHIP: z.string().transform((v) => v !== "false").default("true"),
  BANKR_ALLOW_PAID_GAS_FALLBACK: booleanEnv(false),
  DRY_RUN: booleanEnv(false),
  API_TIMEOUT_MS: z.coerce.number().default(30000),

  // Solana
  SOLANA_PRIVATE_KEY: z.string().min(1, "SOLANA_PRIVATE_KEY wajib diisi"),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  BASEDBOT_CHAT_ID: z.string().default("@BasedOnBot"),
  SNIPE_AMOUNT_ETH: z.coerce.number().default(0.05),
  SNIPE_AMOUNT_SOL: z.coerce.number().default(0.05),
  SNIPER_MAX_SUPPLY_RATIO: z.coerce.number().min(0.001).max(0.05).default(0.018),
  SNIPE_SAFE_CAP_ETH: z.coerce.number().min(0.001).default(0.02),
  SNIPER_ENABLED: booleanEnv(true),
  SNIPE_WALLET_COUNT: z.coerce.number().min(1).default(3),

  // Bot Behavior
  DEPLOY_MODE: z.enum(["testnet", "mainnet"]).default("testnet"),
  TREND_SCAN_INTERVAL_MINUTES: z.coerce.number().default(30),
  MAX_DEPLOYS_PER_DAY: z.coerce.number().default(10),
  MIN_VIRAL_SCORE: z.coerce.number().default(70),
  ACTIVE_CHAINS: z.string().default("base,solana"),
  ANTI_SNIPE_DELAY_MS: z.coerce.number().default(12000),

  // Exit Strategy (Take Profit / Stop Loss)
  TAKE_PROFIT_MULTIPLIER: z.coerce.number().default(2.0),   // Jual saat harga 2x lipat
  STOP_LOSS_PERCENT: z.coerce.number().default(0.30),       // Jual saat turun 30%

  // Volume Bumper
  VOLUME_BUMP_ENABLED: z.string().transform((v) => v !== "false").default("true"),
  VOLUME_BUMP_ROUNDS: z.coerce.number().default(15),        // Jumlah micro-transaksi

  // Anti-Saturasi
  SATURATION_CHECK_ENABLED: z.string().transform((v) => v !== "false").default("true"),

  // V2.5.2: Scheduling Policy
  SCHEDULING_POLICY_ENABLED: z.string().transform((v) => v !== "false").default("true"),
  SCHEDULING_MIN_INTERVAL_MINUTES: z.coerce.number().default(10),
  SCHEDULING_MAX_INTERVAL_MINUTES: z.coerce.number().default(120),
  SCHEDULING_COOLDOWN_MINUTES: z.coerce.number().default(5),
  SCHEDULING_ADAPTIVE_ENABLED: z.string().transform((v) => v !== "false").default("true"),
  SCHEDULING_ADAPTATION_FACTOR: z.coerce.number().default(0.5),
  SCHEDULING_WARMUP_CYCLES: z.coerce.number().default(5),
  SCHEDULING_CONTEXT_WINDOW_DAYS: z.coerce.number().default(1),

  // Twitter / X Shiller (opsional)
  TWITTER_BEARER_TOKEN: z.string().optional(),
  TWITTER_API_KEY: z.string().optional(),
  TWITTER_API_SECRET: z.string().optional(),
  TWITTER_ACCESS_TOKEN: z.string().optional(),
  TWITTER_ACCESS_SECRET: z.string().optional(),

  // Treasury & Fee Accounting (v2.2)
  TREASURY_EVM_DESTINATION: z.string().optional(),
  TREASURY_SOLANA_DESTINATION: z.string().optional(),
  TREASURY_SWEEP_MIN_ETH: z.coerce.number().default(0.1),
  TREASURY_SWEEP_MIN_SOL: z.coerce.number().default(0.5),
  TREASURY_SWEEP_RESERVE_ETH: z.coerce.number().default(0.01),
  TREASURY_SWEEP_RESERVE_SOL: z.coerce.number().default(0.02),
  TREASURY_AUTO_CLAIM_ENABLED: z.string().transform((v) => v !== "false").default("true"),
  TREASURY_MIN_CLAIM_ETH: z.coerce.number().min(0).default(0.005),

  // V2.7: Execution Lifecycle Timeouts
  BUY_CONFIRMATION_TIMEOUT_MINUTES: z.coerce.number().positive().default(15),
  EXIT_CONFIRMATION_TIMEOUT_MINUTES: z.coerce.number().positive().default(15),

  // V2.9.0: Native Balance Pre-Flight Thresholds
  // Minimum native balance (in ETH) required on EVM wallet before deployment cycle begins.
  // Covers snipe_amount_eth + gas buffer. Set to 0 to disable EVM balance check.
  PREFLIGHT_MIN_BALANCE_ETH: z.coerce.number().min(0).default(0.055),
  // Minimum native balance (in SOL) required on Solana wallet before deployment cycle begins.
  // Covers snipe_amount_sol + rent + fee buffer. Set to 0 to disable Solana balance check.
  PREFLIGHT_MIN_BALANCE_SOL: z.coerce.number().min(0).default(0.06),

  // V3.0: Flywheel Growth Engine Parameters
  FLYWHEEL_ENABLED: z.string().transform((v) => v !== "false").default("true"),
  FLYWHEEL_CREATOR_RATIO: z.coerce.number().min(0).max(1).default(0.35),
  FLYWHEEL_BUYBACK_RATIO: z.coerce.number().min(0).max(1).default(0.30),
  FLYWHEEL_DIVIDEND_RATIO: z.coerce.number().min(0).max(1).default(0.20),
  FLYWHEEL_JACKPOT_RATIO: z.coerce.number().min(0).max(1).default(0.15),
  FLYWHEEL_MIN_TRIGGER_WETH: z.coerce.number().min(0).default(0.005),
  FLYWHEEL_DEAD_ADDRESS: z.string().default("0x000000000000000000000000000000000000dEaD"),

  // V3.2: Community Broadcast & Beacon Webhooks (Optional)
  COMMUNITY_DISCORD_WEBHOOK: z.string().optional(),
  COMMUNITY_TELEGRAM_WEBHOOK: z.string().optional(),

  // V3.3: Project & Social Identity Overrides (Optional)
  DEFAULT_PROJECT_WEBSITE: z.string().url().optional(),
  DEFAULT_TWITTER_HANDLE: z.string().optional(),
  DEFAULT_TELEGRAM_LINK: z.string().url().optional(),

  // V3.4: Webshare Proxy API Integration (Optional)
  WEBSHARE_API_KEY: z.string().optional(),

  // V4.0: Clanker v3.1 On-Chain Deployer (Base Mainnet)
  // Operator pays gas directly (~0.001–0.005 ETH per deploy).
  // No API key required — direct smart contract interaction via viem.
  CLANKER_ENABLED: booleanEnv(true),
  // Optional dev buy in ETH bundled with deploy tx. 0 = no dev buy.
  CLANKER_DEV_BUY_ETH: z.coerce.number().min(0).default(0),
  // Creator fee share % for Uniswap V4 pool liquidity rewards. Range: 0–100.
  CLANKER_CREATOR_REWARD_PCT: z.coerce.number().min(0).max(100).default(40),

  // V4.0: WETH Wrap Utility (Base Mainnet)
  // Gas limit for WETH9.deposit() transactions (actual ~29k, buffer to 35k).
  WETH_WRAP_GAS_LIMIT: z.coerce.number().default(35000),

  // V4.5: Neon Serverless PostgreSQL Multi-Tenant Cloud Database (Optional)
  NEON_DATABASE_URL: z.string().optional(),
  NEON_PROJECT_ID: z.string().optional(),
  NEON_BRANCH_ID: z.string().optional(),

  // V4.6: Cloudflare Pages & R2 Storage (Free Tier)
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_R2_ACCESS_KEY_ID: z.string().optional(),
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: z.string().optional(),
  CLOUDFLARE_R2_ENDPOINT: z.string().optional(),
  CLOUDFLARE_R2_BUCKET: z.string().default("web3-assets"),
}).refine(
  (data) => Boolean((data.GOOGLE_GENERATIVE_AI_API_KEY && data.GOOGLE_GENERATIVE_AI_API_KEY.length > 0) || (data.BYTEDANCE_ARK_API_KEY && data.BYTEDANCE_ARK_API_KEY.length > 0)),
  {
    message: "Setidaknya salah satu dari GOOGLE_GENERATIVE_AI_API_KEY atau BYTEDANCE_ARK_API_KEY wajib diisi.",
    path: ["GOOGLE_GENERATIVE_AI_API_KEY"],
  }
);

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function resetConfig(): void {
  _config = null;
}

export function getConfig(): Config {
  if (_config) return _config;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("\n❌ KONFIGURASI .env TIDAK VALID:");
    result.error.errors.forEach((e) => {
      console.error(`   → ${e.path.join(".")}: ${e.message}`);
    });
    console.error("\nSilakan periksa file .env Anda dan isi semua kunci yang wajib.\n");
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

export function getActiveChains(): string[] {
  const cfg = getConfig();
  return cfg.ACTIVE_CHAINS.split(",").map((c) => c.trim().toLowerCase());
}
