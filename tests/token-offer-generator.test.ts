import { describe, it, expect, beforeEach } from "bun:test";
import { generateIrresistibleOffer } from "../src/modules/growth/token-offer-generator.ts";
import { resolveTargetToken } from "../scripts/generate-token-offer.ts";
import { logDeploy, getAllDeployLogs } from "../src/db/vault.ts";

describe("Irresistible Token Offer & Fleet Generator", () => {
  it("should generate a complete value proposition and marketing pitch for a Base token", () => {
    const offer = generateIrresistibleOffer({
      name: "Cyber Doge",
      ticker: "CDOGE",
      contractAddress: "0xe62ea6e25c1d7318265c70f16a9645e775e43d2f",
      chain: "base",
    });

    expect(offer.tokenSymbol).toBe("CDOGE");
    expect(offer.tokenName).toBe("Cyber Doge");
    expect(offer.contractAddress).toBe("0xe62ea6e25c1d7318265c70f16a9645e775e43d2f");
    expect(offer.chain).toBe("base");

    // Executive Summary Assertions
    expect(offer.executiveSummary).toContain("0% BUY / SELL TAX");
    expect(offer.executiveSummary).toContain("30% PERPETUAL DEFLATIONARY BURN");
    expect(offer.executiveSummary).toContain("20% PASSIVE NATIVE DIVIDENDS");
    expect(offer.executiveSummary).toContain("15% 10-MINUTE FOMO JACKPOT");
    expect(offer.executiveSummary).toContain("RENOUNCED BY DESIGN");
    expect(offer.executiveSummary).toContain("0xdead");

    // Twitter Thread Assertions
    expect(offer.twitterThread.length).toBe(6);
    expect(offer.twitterThread[0]).toContain("Base Mainnet");
    expect(offer.twitterThread[0]).toContain("https://dexscreener.com/base/0xe62ea6e25c1d7318265c70f16a9645e775e43d2f");
    expect(offer.twitterThread[1]).toContain("Renounced by Design");

    // Telegram Post Assertions
    expect(offer.telegramPost).toContain("*NEW LAUNCH ALERT: $CDOGE (Cyber Doge)*");
    expect(offer.telegramPost).toContain("0xe62ea6e25c1d7318265c70f16a9645e775e43d2f");
    expect(offer.telegramPost).toContain("Renounced by Design");

    // DexScreener Bio
    expect(offer.dexScreenerBio).toContain("$CDOGE");
    expect(offer.dexScreenerBio).toContain("0% Tax");
    expect(offer.dexScreenerBio).toContain("Renounced by Design");
    expect(offer.dexScreenerBio).toContain("30% Auto Buyback & Burn");
  });

  it("should generate proper links for a Solana token", () => {
    const offer = generateIrresistibleOffer({
      name: "Sol Speed",
      ticker: "$SOLSPEED",
      contractAddress: "pumpxti9h9imezh",
      chain: "solana",
    });

    expect(offer.tokenSymbol).toBe("SOLSPEED");
    expect(offer.twitterThread[0]).toContain("Solana Mainnet");
    expect(offer.twitterThread[0]).toContain("https://dexscreener.com/solana/pumpxti9h9imezh");
    expect(offer.executiveSummary).toContain("SOLSPEED");
  });

  it("should resolve target tokens by ticker or CA correctly", () => {
    const logs = getAllDeployLogs();
    if (logs.length > 0) {
      const firstWithCa = logs.find((l) => l.contractAddr);
      if (firstWithCa && firstWithCa.contractAddr) {
        const resolvedByCa = resolveTargetToken(firstWithCa.contractAddr);
        expect(resolvedByCa).toBeDefined();
        expect(resolvedByCa?.contractAddr).toBe(firstWithCa.contractAddr);

        if (firstWithCa.ticker) {
          const resolvedByTicker = resolveTargetToken(firstWithCa.ticker);
          expect(resolvedByTicker).toBeDefined();
        }
      }

      // Default resolution should return a token
      const defaultResolved = resolveTargetToken();
      expect(defaultResolved).toBeDefined();
      expect(defaultResolved?.contractAddr).toBeDefined();
    }
  });
});
