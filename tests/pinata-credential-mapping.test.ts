import { describe, it, expect, beforeEach } from "bun:test";
import { getConfig, resetConfig } from "../src/config.ts";
import { resolveCredential } from "../src/modules/identity/wallet-manager.ts";

describe("Pinata Credential Mapping & Config Verification", () => {
  beforeEach(() => {
    resetConfig();
  });

  it("should validate and load PINATA_JWT from process.env", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "dummy_ai_key";
    process.env.FIRECRAWL_API_KEY = "dummy_firecrawl_key";
    process.env.PINATA_JWT = "mock_valid_pinata_jwt";
    process.env.PINATA_API_KEY = "mock_api_key";
    process.env.PINATA_API_SECRET = "mock_api_secret";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.SOLANA_PRIVATE_KEY = "4wBqpZM9xaSheZzBSPRHKJHsNYmAQhFocDPStpwFnGRHaKHt64VpR1LPMaxpCjBFRcYCLFUJL4kP18tJbRBr7HRQ";

    resetConfig();
    const cfg = getConfig();

    expect(cfg.PINATA_JWT).toBe("mock_valid_pinata_jwt");
    expect(cfg.PINATA_API_KEY).toBe("mock_api_key");
    expect(cfg.PINATA_API_SECRET).toBe("mock_api_secret");
  });

  it("should succeed even if PINATA_API_KEY and PINATA_API_SECRET are omitted", () => {
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_API_SECRET;
    process.env.PINATA_JWT = "mock_valid_pinata_jwt";

    resetConfig();
    const cfg = getConfig();

    expect(cfg.PINATA_JWT).toBe("mock_valid_pinata_jwt");
    expect(cfg.PINATA_API_KEY).toBeUndefined();
    expect(cfg.PINATA_API_SECRET).toBeUndefined();
  });

  it("should resolve PINATA_JWT via resolveCredential without database plaintext exposure", () => {
    process.env.PINATA_JWT = "secret_pinata_jwt_token";

    const resolvedWithPrefix = resolveCredential("env:PINATA_JWT");
    const resolvedWithoutPrefix = resolveCredential("PINATA_JWT");

    expect(resolvedWithPrefix).toBe("secret_pinata_jwt_token");
    expect(resolvedWithoutPrefix).toBe("secret_pinata_jwt_token");

    // Invalid or non-existent ref returns undefined
    expect(resolveCredential("env:NON_EXISTENT_KEY")).toBeUndefined();
    expect(resolveCredential("")).toBeUndefined();
    expect(resolveCredential(null)).toBeUndefined();
  });
});
