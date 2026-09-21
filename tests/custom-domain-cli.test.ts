/**
 * tests/custom-domain-cli.test.ts
 *
 * Automated verification suite for:
 * 1. Domain parser utility in setup-custom-domain.ts (subdomain vs apex).
 * 2. Custom domain binding error handling and fallbacks.
 * 3. On-chain dividend eligibility checker in website-generator.ts.
 * 4. Zero-emoji compliance across newly rendered DApp features.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { parseDomainParts } from "../scripts/setup-custom-domain.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import {
  bindCustomDomainToPages,
  bindCustomDomainToVercel,
} from "../src/modules/growth/cloudflare-dns.ts";

describe("Custom Domain CLI & Dividend Checker Suite", () => {
  const testDir = path.resolve(process.cwd(), "sites", "test_div_checker");

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("1. should correctly parse subdomain and rootDomain", () => {
    const p1 = parseDomainParts("app.pumprun.xyz");
    expect(p1.subdomain).toBe("app");
    expect(p1.rootDomain).toBe("pumprun.xyz");

    const p2 = parseDomainParts("pumprun.xyz");
    expect(p2.subdomain).toBe("@");
    expect(p2.rootDomain).toBe("pumprun.xyz");

    const p3 = parseDomainParts("https://beta.dev.token.io/path");
    expect(p3.subdomain).toBe("beta");
    expect(p3.rootDomain).toBe("dev.token.io");
  });

  it("2. should generate DApp website with Wallet Dividend Checker and ZERO emojis", async () => {
    const siteResult = await generateTokenWebsite({
      name: "Dividend Alpha",
      ticker: "DIVALPHA",
      contractAddress: "0x9999999999999999999999999999999999999999",
      chainName: "base",
      outputDir: testDir,
    });

    expect(fs.existsSync(siteResult.indexHtmlPath)).toBe(true);
    const html = fs.readFileSync(siteResult.indexHtmlPath, "utf-8");

    // 1. Verify Dividend Checker components exist
    expect(html).toContain('id="check-wallet-div-btn"');
    expect(html).toContain('id="checker-result-box"');
    expect(html).toContain('id="detected-holdings"');
    expect(html).toContain('id="detected-weight"');
    expect(html).toContain('id="detected-dividend"');

    // 2. Strict zero emoji check
    const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]/g;
    const emojiMatches = html.match(emojiRegex);
    expect(emojiMatches).toBeNull();
  });

  it("3. should handle Pages domain binding error safely", async () => {
    const res = await bindCustomDomainToPages({
      projectName: "invalid-cf-project-mock-9999",
      domain: "sub.domain.xyz",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("ERROR");
  });

  it("4. should handle Vercel domain binding unconfigured state safely", async () => {
    const res = await bindCustomDomainToVercel({
      token: "",
      projectId: "",
      domain: "sub.domain.xyz",
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe("UNCONFIGURED");
  });
});
