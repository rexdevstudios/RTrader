import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios, { AxiosError } from "axios";
import { Database } from "bun:sqlite";
import { DB_PATH } from "../src/db/vault.ts";
import {
  buildAxiosProxyConfig,
  deployViaBankr,
  getBankrHeaders,
  BANKR_DEPLOY_URL,
} from "../src/modules/evm/bankr-deployer.ts";
import {
  bootstrapDefaultWallet,
  resolveOperationalContext,
  resolveCredential,
  registerWalletAccount,
  registerProxyConfig,
  setWalletProviderRoute,
} from "../src/modules/identity/wallet-manager.ts";
import { resetConfig } from "../src/config.ts";

const db = new Database(DB_PATH);

const mockIdentity = {
  name: "Safe Test Token",
  ticker: "SAFE",
  description: "Safe identity test token",
  viralScore: 90,
  imagePrompt: "safe test prompt",
  website: "https://test.com",
  twitter: "https://x.com/test",
  telegram: "https://t.me/test",
};

const mockAssets = {
  imageUrl: "https://ipfs.io/ipfs/QmTestImage",
  metadataUrl: "https://ipfs.io/ipfs/QmTestMeta",
  ipfsImageUri: "ipfs://QmTestImage",
};

describe("1:1 Identity Mapping & Gateway Safety Tests", () => {
  let axiosPostSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    resetConfig();
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
    process.env.FIRECRAWL_API_KEY = "test";
    process.env.PINATA_JWT = "test";
    process.env.EVM_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    process.env.BANKR_API_KEY = "bk_usr_test_key";
    process.env.DEPLOY_MODE = "mainnet";
    process.env.BANKR_CHAIN = "base";
  });

  afterEach(() => {
    axiosPostSpy?.mockRestore();
    // Clean up test identities to maintain test database isolation
    db.run("DELETE FROM wallet_accounts WHERE id LIKE 'test_%' OR id LIKE 'wallet_test_%'");
    db.run("DELETE FROM proxy_configs WHERE id LIKE 'test_%' OR id LIKE 'proxy_test_%'");
    db.run("DELETE FROM wallet_provider_routes WHERE wallet_id LIKE 'test_%' OR wallet_id LIKE 'wallet_test_%'");
  });

  describe("1. buildAxiosProxyConfig", () => {
    it("1.1 should parse HTTP proxy URL without credentials", () => {
      const cfg = buildAxiosProxyConfig("http://192.168.1.100:8080");
      expect(cfg).toBeDefined();
      expect(cfg.protocol).toBe("http");
      expect(cfg.host).toBe("192.168.1.100");
      expect(cfg.port).toBe(8080);
      expect(cfg.auth).toBeUndefined();
    });

    it("1.2 should parse HTTP proxy URL with username and password", () => {
      const cfg = buildAxiosProxyConfig("http://operator:secret123@proxy.datacenter.com:3128");
      expect(cfg).toBeDefined();
      expect(cfg.protocol).toBe("http");
      expect(cfg.host).toBe("proxy.datacenter.com");
      expect(cfg.port).toBe(3128);
      expect(cfg.auth).toEqual({ username: "operator", password: "secret123" });
    });

    it("1.3 should URL-decode special characters in proxy credentials", () => {
      const cfg = buildAxiosProxyConfig("http://user%40domain:p%23ss%24@10.0.0.1:8888");
      expect(cfg).toBeDefined();
      expect(cfg.auth).toEqual({ username: "user@domain", password: "p#ss$" });
    });

    it("1.4 should return undefined for empty or invalid proxy URLs", () => {
      expect(buildAxiosProxyConfig(undefined)).toBeUndefined();
      expect(buildAxiosProxyConfig("")).toBeUndefined();
      expect(buildAxiosProxyConfig("invalid-not-a-url")).toBeUndefined();
    });
  });

  describe("2. AWS ALB / WAF Gateway 403 Detection in deployViaBankr", () => {
    it("2.1 should detect awselb/2.0 server header on 403 and format as GATEWAY_WAF_BLOCK", async () => {
      const err403 = new AxiosError("Request failed with status code 403");
      err403.response = {
        status: 403,
        statusText: "Forbidden",
        headers: { server: "awselb/2.0", "content-type": "text/html" },
        config: {} as any,
        data: "<html><head><title>403 Forbidden</title></head><body><center><h1>403 Forbidden</h1></center></body></html>",
      };
      axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(err403);

      const result = await deployViaBankr(mockIdentity, mockAssets, { simulateOnly: false });
      expect(result.success).toBe(false);
      expect(result.error).toContain("ELIGIBILITY_OR_PERMISSION_ERROR (403)");
      expect(result.error).toContain("GATEWAY_WAF_BLOCK");
      expect(result.error).toContain("awselb/2.0");
    });

    it("2.2 should detect HTML body 403 even if server header is absent", async () => {
      const err403 = new AxiosError("Request failed with status code 403");
      err403.response = {
        status: 403,
        statusText: "Forbidden",
        headers: {},
        config: {} as any,
        data: "<html><body>Access Denied by WAF</body></html>",
      };
      axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(err403);

      const result = await deployViaBankr(mockIdentity, mockAssets, { simulateOnly: false });
      expect(result.success).toBe(false);
      expect(result.error).toContain("ELIGIBILITY_OR_PERMISSION_ERROR (403)");
      expect(result.error).toContain("GATEWAY_WAF_BLOCK");
    });

    it("2.3 should route via proxy when proxyUrl is supplied in overrides", async () => {
      axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          tokenAddress: "0x1111111111111111111111111111111111111111",
          txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          poolId: "pool_123",
          chain: "base",
        },
      });

      const result = await deployViaBankr(mockIdentity, mockAssets, {
        simulateOnly: false,
        proxyUrl: "http://proxyuser:proxypass@proxy.test.com:8080",
      });

      expect(result.success).toBe(true);
      const callConfig = axiosPostSpy.mock.calls[0][2];
      expect(callConfig.proxy).toBeDefined();
      expect(callConfig.proxy.host).toBe("proxy.test.com");
      expect(callConfig.proxy.port).toBe(8080);
      expect(callConfig.proxy.auth).toEqual({ username: "proxyuser", password: "proxypass" });
    });

    it("2.4 should handle HTTP 429 Too many launch simulations gracefully in deployViaBankr", async () => {
      const err429 = new AxiosError("Request failed with status code 429");
      err429.response = {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "3600" },
        config: {} as any,
        data: { error: "Too many launch simulations in the last 24 hours. Please try again later." },
      };
      axiosPostSpy = spyOn(axios, "post").mockRejectedValueOnce(err429);

      const result = await deployViaBankr(mockIdentity, mockAssets, { simulateOnly: true });
      expect(result.success).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("RATE_LIMIT_EXCEEDED (429)");
      expect(result.error).toContain("Too many launch simulations");
      expect(result.error).toContain("Retry after 3600s");
    });
  });

  describe("3. 1:1 Identity Mapping Resolution Integrity", () => {
    it("3.1 should resolve default operator wallet and direct route", () => {
      const wallet = bootstrapDefaultWallet();
      expect(wallet).toBeDefined();
      expect(wallet.id).toBe("default-operator");
      expect(wallet.status).toBe("ACTIVE");

      const context = resolveOperationalContext(wallet.id, "bankr");
      expect(context.isUsable).toBe(true);
      expect(context.wallet.id).toBe("default-operator");
      expect(context.provider).toBe("bankr");
    });

    it("3.2 should resolve 1:1 proxy binding when configured", () => {
      const pId = `proxy_test_${Date.now()}`;
      const wId = `wallet_test_${Date.now()}`;

      registerWalletAccount({
        id: wId,
        label: "Isolated Identity",
        evmAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        status: "ACTIVE",
      });

      registerProxyConfig({
        id: pId,
        protocol: "http",
        host: "10.10.10.10",
        port: 8888,
        username: "testuser",
        password: "testpassword",
        status: "ACTIVE",
      });

      setWalletProviderRoute(wId, "bankr", {
        proxyId: pId,
        status: "ACTIVE",
      });

      const context = resolveOperationalContext(wId, "bankr");
      expect(context.isUsable).toBe(true);
      expect(context.proxy).toBeDefined();
      expect(context.proxy?.host).toBe("10.10.10.10");
      expect(context.proxyUrl).toBe("http://testuser:testpassword@10.10.10.10:8888");
      expect(context.maskedProxyUrl).toBe("http://testuser:****@10.10.10.10:8888");

      const axiosCfg = buildAxiosProxyConfig(context.proxyUrl ?? undefined);
      expect(axiosCfg.host).toBe("10.10.10.10");
      expect(axiosCfg.auth).toEqual({ username: "testuser", password: "testpassword" });
    });

    it("3.3 should resolve secondary isolated Bankr API key via credentialRef pointer", () => {
      process.env.BANKR_API_KEY_SECONDARY = "bk_usr_custom_isolated_operator_key";
      const resolved = resolveCredential("env:BANKR_API_KEY_SECONDARY");
      expect(resolved).toBe("bk_usr_custom_isolated_operator_key");
      delete process.env.BANKR_API_KEY_SECONDARY;
    });

    it("3.4 should pass apiKey override to deployViaBankr and include in request headers", async () => {
      const customKey = "bk_usr_custom_isolated_operator_key";
      axiosPostSpy = spyOn(axios, "post").mockResolvedValueOnce({
        status: 200,
        data: {
          success: true,
          tokenAddress: "0x3333333333333333333333333333333333333333",
          txHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
          poolId: "pool_custom",
          chain: "base",
        },
      });

      const result = await deployViaBankr(mockIdentity, mockAssets, {
        simulateOnly: false,
        apiKey: customKey,
      });

      expect(result.success).toBe(true);
      const callHeaders = axiosPostSpy.mock.calls[0][2]?.headers;
      expect(callHeaders).toBeDefined();
      expect(callHeaders["X-API-Key"]).toBe(customKey);
    });

    it("3.5 should fail closed and return undefined when credentialRef does not exist in environment", () => {
      const resolved = resolveCredential("env:NON_EXISTENT_BANKR_KEY_12345");
      expect(resolved).toBeUndefined();
    });
  });
});

