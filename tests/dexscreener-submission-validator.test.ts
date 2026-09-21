/**
 * tests/dexscreener-submission-validator.test.ts
 *
 * Automated test suite for DexScreener & GeckoTerminal Submission Validator.
 * Verifies that all metadata, live website HTTP status, local assets,
 * and 1-click update portal URLs are valid and error-free.
 */

import { describe, it, expect } from "bun:test";
import { validateDexScreenerSubmission } from "../scripts/validate-dexscreener-submission.ts";

describe("DexScreener & GeckoTerminal Submission Validator Suite", () => {
  it("1. should validate $PUMPRUN submission pack successfully with 0 errors", async () => {
    const res = await validateDexScreenerSubmission("PUMPRUN");

    expect(res).toBeDefined();
    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.tokenSymbol).toBe("PUMPRUN");
    expect(res.contractAddress.toLowerCase()).toBe("0x0a99f4251a461e8abc693a56bb837fd815d51ba3");
  }, 15000);

  it("2. should verify on-chain bytecode exists for $PUMPRUN on Base Mainnet", async () => {
    const res = await validateDexScreenerSubmission("PUMPRUN");

    expect(res.onChainVerified).toBe(true);
    expect(res.poolVerified).toBe(true);
  }, 15000);

  it("3. should confirm live Cloudflare Pages DApp is reachable with HTTP 200", async () => {
    const res = await validateDexScreenerSubmission("PUMPRUN");

    expect(res.websiteStatus.reachable).toBe(true);
    expect(res.websiteStatus.httpStatus).toBe(200);
    expect(res.websiteStatus.url).toBe("https://pumprun-web3.pages.dev");
  }, 15000);

  it("4. should verify social links and local asset file packaging", async () => {
    const res = await validateDexScreenerSubmission("PUMPRUN");

    expect(res.socialLinks.telegram).toBe("https://t.me/pumprun_portal");
    expect(res.socialLinks.twitter).toBe("https://x.com/PUMPRUN_coin");
    expect(res.localAssets.profileJsonExists).toBe(true);
    expect(res.localAssets.fastTrackTxtExists).toBe(true);
    expect(res.localAssets.ogImageExists).toBe(true);
  }, 15000);

  it("5. should generate correct live chart and portal links", async () => {
    const res = await validateDexScreenerSubmission("PUMPRUN");

    expect(res.portalUrls.dexScreenerChart).toContain("dexscreener.com/base/0x645d579d8002a6ac09d67c59526d065321b07570b1d9f359a70346c072ca7584");
    expect(res.portalUrls.dexScreenerMarketplace).toContain("marketplace.dexscreener.com/product/token-info/order");
    expect(res.portalUrls.basescanUpdate).toContain("0x0a99f4251A461e8abC693a56BB837fD815D51BA3");
  }, 15000);
});
