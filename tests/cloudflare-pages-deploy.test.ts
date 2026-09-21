/**
 * tests/cloudflare-pages-deploy.test.ts
 *
 * Automated tests for Cloudflare Pages direct deployment, simulation fallback, and vault sync.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { deployWebsiteToCloudflarePages } from "../src/modules/growth/website-deployer.ts";
import {
  logDeploy,
  getDeployLogWebsite,
} from "../src/db/vault.ts";

describe("Cloudflare Pages Deployer Suite", () => {
  const testDir = path.resolve(process.cwd(), "sites", "test_cf_deploy");

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(path.join(testDir, "index.html"), "<h1>Test CF</h1>", "utf-8");
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    try {
      const { Database } = require("bun:sqlite");
      const { DB_PATH } = require("../src/db/vault.ts");
      const db = new Database(DB_PATH);
      db.run("DELETE FROM deploy_logs WHERE ticker = 'CFTEST' OR contract_addr = '0x8888888888888888888888888888888888888888'");
    } catch {}
  });

  it("1. should fail gracefully if siteDir does not exist", async () => {
    const result = await deployWebsiteToCloudflarePages({
      siteDir: path.resolve(process.cwd(), "sites", "non_existent_folder_xyz"),
      ticker: "FAIL",
    });

    expect(result.success).toBe(false);
    expect(result.deploymentUrl).toBe("");
  });

  it("2. should use simulation mode when Cloudflare credentials are unset", async () => {
    const result = await deployWebsiteToCloudflarePages({
      siteDir: testDir,
      ticker: "CFTEST",
      projectName: "cftest-web",
      accountId: "",
      apiToken: "",
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("simulation");
    expect(result.deploymentUrl).toBe("https://cftest-web.pages.dev");
    expect(result.cliInstruction).toContain("wrangler pages deploy");
  });

  it("3. should synchronize deploymentUrl to Vault DB when contractAddress is provided", async () => {
    const testCA = "0x8888888888888888888888888888888888888888";
    logDeploy({
      chain: "base",
      contractAddr: testCA,
      status: "confirmed",
      ticker: "CFTEST",
      tokenName: "Cloudflare Test Token",
    });

    const result = await deployWebsiteToCloudflarePages({
      siteDir: testDir,
      ticker: "CFTEST",
      contractAddress: testCA,
      projectName: "cftest-web",
      accountId: "",
      apiToken: "",
    });

    expect(result.success).toBe(true);
    const dbWebsite = getDeployLogWebsite(testCA);
    expect(dbWebsite).toBe(result.deploymentUrl);
  });

  it("4. should verify live Cloudflare Pages deployment when credentials are provided", async () => {
    if (!process.env.CLOUDFLARE_API_TOKEN) return;
    const result = await deployWebsiteToCloudflarePages({
      siteDir: testDir,
      ticker: "CFTEST",
      projectName: "cftest-web",
    });

    expect(result.success).toBe(true);
    expect(result.provider).toBe("cloudflare_pages");
    expect(result.deploymentUrl).toContain("cftest-web.pages.dev");
  }, 60000);
});
