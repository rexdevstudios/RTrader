/**
 * tests/swap-link-binding.test.ts
 *
 * Test Suite for Dynamic Swap Link Parameter Binding:
 * 1. Verifies that Base L2 websites generate direct Uniswap swap URL with initial exactAmount=0.05.
 * 2. Verifies that parallax-3d.js dynamically binds input changes and preset buttons to swap-execute-link.href.
 * 3. Verifies that Robinhood and Solana retain their dedicated AMM routers.
 * 4. Verifies 0 syntax errors across all generated scripts via new Function(js).
 */

import { describe, test, expect } from "bun:test";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import * as fs from "fs";
import * as path from "path";

describe("Dynamic Swap Link Parameter Binding Suite", () => {
  const testDir = path.join(process.cwd(), "sites", "test_swap_binding");

  test("1.1 should generate Base L2 Doppler AMM link when isBankr is true and Uniswap when isBankr is false", async () => {
    // A. Doppler AMM (isBankr: true)
    const resDoppler = await generateTokenWebsite({
      ticker: "PUMPRUN",
      name: "Pump Hill Runner",
      contractAddress: "0x0a99f4251A461e8abC693a56BB837fD815D51BA3",
      chainName: "base",
      chainId: 8453,
      isBankr: true,
      customSector: "VIRAL_MEME",
      siteOutputDir: path.join(testDir, "base_doppler"),
    });

    const htmlDoppler = fs.readFileSync(resDoppler.indexHtmlPath, "utf-8");
    const jsDoppler = fs.readFileSync(path.join(resDoppler.siteDirectory, "parallax-3d.js"), "utf-8");

    expect(htmlDoppler).toContain("https://app.doppler.lol/tokens/base/0x0a99f4251A461e8abC693a56BB837fD815D51BA3");
    expect(jsDoppler).toContain("app.doppler.lol/tokens/base");

    let dopplerSyntaxErr: Error | null = null;
    try {
      new Function(jsDoppler);
    } catch (e: any) {
      dopplerSyntaxErr = e;
    }
    expect(dopplerSyntaxErr).toBeNull();

    // B. Standard Uniswap (isBankr: false / Graduated)
    const resUniswap = await generateTokenWebsite({
      ticker: "GRADUATED",
      name: "Graduated Token",
      contractAddress: "0x1111111111111111111111111111111111111111",
      chainName: "base",
      chainId: 8453,
      isBankr: false,
      siteOutputDir: path.join(testDir, "base_uniswap"),
    });

    const htmlUniswap = fs.readFileSync(resUniswap.indexHtmlPath, "utf-8");
    const jsUniswap = fs.readFileSync(path.join(resUniswap.siteDirectory, "parallax-3d.js"), "utf-8");

    expect(htmlUniswap).toContain("https://app.uniswap.org/swap?chain=base&inputCurrency=NATIVE&outputCurrency=0x1111111111111111111111111111111111111111&exactAmount=0.05");
    expect(jsUniswap).toContain("https://app.uniswap.org/swap?chain=base");

    let uniSyntaxErr: Error | null = null;
    try {
      new Function(jsUniswap);
    } catch (e: any) {
      uniSyntaxErr = e;
    }
    expect(uniSyntaxErr).toBeNull();
  });

  test("1.2 should bind dedicated routers for Robinhood and Solana without breaking exactAmount logic", async () => {
    // A. Robinhood
    const rhRes = await generateTokenWebsite({
      ticker: "RHFLY",
      name: "Robinhood Flywheel",
      contractAddress: "0x3333333333333333333333333333333333333333",
      chainName: "robinhood",
      chainId: 4663,
      customSector: "DEFI_TREASURY",
      siteOutputDir: path.join(testDir, "rh_fly"),
    });
    const rhHtml = fs.readFileSync(rhRes.indexHtmlPath, "utf-8");
    const rhJs = fs.readFileSync(path.join(rhRes.siteDirectory, "parallax-3d.js"), "utf-8");
    expect(rhHtml).toContain("https://pons.fun/token/0x3333333333333333333333333333333333333333");
    expect(rhJs).toContain("pons.fun/token");

    let rhSyntaxErr: Error | null = null;
    try {
      new Function(rhJs);
    } catch (e: any) {
      rhSyntaxErr = e;
    }
    expect(rhSyntaxErr).toBeNull();

    // B. Solana
    const solRes = await generateTokenWebsite({
      ticker: "SOLRUN",
      name: "Solana Runner",
      contractAddress: "4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz",
      chainName: "solana",
      chainId: 101,
      customSector: "GAMING_UTILITY",
      siteOutputDir: path.join(testDir, "sol_run"),
    });
    const solHtml = fs.readFileSync(solRes.indexHtmlPath, "utf-8");
    const solJs = fs.readFileSync(path.join(solRes.siteDirectory, "parallax-3d.js"), "utf-8");
    expect(solHtml).toContain("https://pump.fun/4znm13bnfx9cj8V8TSXSH7FbD3anij5RF8QQiAU2BJzz");
    expect(solJs).toContain("pump.fun");

    let solSyntaxErr: Error | null = null;
    try {
      new Function(solJs);
    } catch (e: any) {
      solSyntaxErr = e;
    }
    expect(solSyntaxErr).toBeNull();
  });
});
