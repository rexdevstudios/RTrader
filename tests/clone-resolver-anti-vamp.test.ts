/**
 * tests/clone-resolver-anti-vamp.test.ts
 *
 * Anti-Vamp & Clone Resolver Intelligence Test Suite.
 *
 * Verifies:
 *  1. Homoglyph Folding:
 *     - Maps Cyrillic and Greek lookalikes to Latin letters.
 *  2. Leetspeak Normalization:
 *     - Folds numbers into letters (e.g. 0 -> O, 1 -> I, 3 -> E, 4 -> A, 5 -> S).
 *  3. Filler Word Stripping:
 *     - Strips COIN, TOKEN, INU, V2, OFFICIAL, etc. without damaging short stems.
 *  4. Clone Match Evaluation:
 *     - Correctly classifies exact, homoglyph, leetspeak, filler_variant, and name_variant matches.
 *  5. Clone Cluster Analysis:
 *     - Produces correct clusterStatus: SOLO, CLEAN, CONTESTED, and SWARM.
 *  6. End-to-End Saturation Integration:
 *     - checkCrossChainSaturation flags homoglyphs and clone wars on live/mocked pairs.
 */

import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import axios from "axios";
import {
  foldHomoglyphs,
  foldLeetspeak,
  stripFillerWords,
  normalizeTokenKey,
  evaluateCloneMatch,
  analyzeCloneCluster,
} from "../src/modules/market/clone-resolver.ts";
import { checkCrossChainSaturation } from "../src/modules/market/saturation-checker.ts";

describe("Anti-Vamp & Clone Resolver Engine", () => {
  let axiosGetSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    axiosGetSpy = spyOn(axios, "get");
  });

  afterEach(() => {
    axiosGetSpy?.mockRestore();
  });

  // ── 1. Homoglyph Normalization ──────────────────────────────
  describe("1. Homoglyph Folding", () => {
    it("1.1 detects and folds Cyrillic lookalike letters to ASCII Latin", () => {
      // Cyrillic 'Т' (U+0422) vs Latin 'T' (U+0054)
      const cyrillicInput = "PEANU\u0422";
      const res = foldHomoglyphs(cyrillicInput);

      expect(res.hasHomoglyphs).toBe(true);
      expect(res.folded).toBe("PEANUT");
      expect(res.detectedChars).toContain("\u0422");
    });

    it("1.2 leaves pure ASCII text untouched with hasHomoglyphs = false", () => {
      const pureAscii = "PUMPRUN";
      const res = foldHomoglyphs(pureAscii);

      expect(res.hasHomoglyphs).toBe(false);
      expect(res.folded).toBe("PUMPRUN");
      expect(res.detectedChars.length).toBe(0);
    });

    it("1.3 handles lowercase Cyrillic lookalikes (а, е, о, р, с, х)", () => {
      // 'n' + Cyrillic 'о' + Cyrillic 'v' (Greek/Cyrillic) + 'a'
      const lookalike = "n\u043Ev\u0430";
      const res = foldHomoglyphs(lookalike);

      expect(res.hasHomoglyphs).toBe(true);
      expect(res.folded).toBe("nova");
    });
  });

  // ── 2. Leetspeak Normalization ─────────────────────────────
  describe("2. Leetspeak Folding", () => {
    it("2.1 folds common leetspeak substitutions (0, 1, 3, 4, 5, 7)", () => {
      expect(foldLeetspeak("N0VA")).toBe("NOVA");
      expect(foldLeetspeak("PUMPRUNN3R")).toBe("PUMPRUNNER");
      expect(foldLeetspeak("CL0N3")).toBe("CLONE");
      expect(foldLeetspeak("B4NK")).toBe("BANK");
      expect(foldLeetspeak("S0L4N4")).toBe("SOLANA");
    });
  });

  // ── 3. Filler Word Stripping ────────────────────────────────
  describe("3. Filler Word Stripping", () => {
    it("3.1 strips common meme token suffixes (COIN, TOKEN, INU, V2, OFFICIAL)", () => {
      expect(stripFillerWords("PEANUTCOIN")).toBe("PEANUT");
      expect(stripFillerWords("PEANUTINU")).toBe("PEANUT");
      expect(stripFillerWords("PEANUTV2")).toBe("PEANUT");
      expect(stripFillerWords("PEANUTOFFICIAL")).toBe("PEANUT");
    });

    it("3.2 does NOT strip filler words if remaining stem would be shorter than 3 characters", () => {
      // 'INU' should not be stripped to empty string
      expect(stripFillerWords("INU")).toBe("INU");
      expect(stripFillerWords("SOL")).toBe("SOL");
      expect(stripFillerWords("ETH")).toBe("ETH");
    });
  });

  // ── 4. Token Key Normalization ──────────────────────────────
  describe("4. Token Key Normalization", () => {
    it("4.1 generates both tight and loose normalization keys", () => {
      const res = normalizeTokenKey("PEANU\u0422COIN");

      expect(res.tightKey).toBe("PEANUTCOIN");
      expect(res.looseKey).toBe("PEANUT");
      expect(res.hasHomoglyphs).toBe(true);
    });
  });

  // ── 5. Clone Match Evaluation ───────────────────────────────
  describe("5. Clone Match Evaluation", () => {
    it("5.1 identifies exact match with 100% confidence", () => {
      const match = evaluateCloneMatch("PUMPRUN", undefined, "PUMPRUN");
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe("exact");
      expect(match.confidence).toBe(100);
    });

    it("5.2 identifies Cyrillic homoglyph lookalike with 95% confidence", () => {
      const match = evaluateCloneMatch("PEANUT", undefined, "PEANU\u0422");
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe("homoglyph");
      expect(match.confidence).toBe(95);
      expect(match.reason).toContain("Homoglyph lookalike");
    });

    it("5.3 identifies leetspeak substitution with 90% confidence", () => {
      const match = evaluateCloneMatch("NOVA", undefined, "N0VA");
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe("leetspeak");
      expect(match.confidence).toBe(90);
    });

    it("5.4 identifies filler word variation with 85% confidence", () => {
      const match = evaluateCloneMatch("PEANUT", undefined, "PEANUTCOIN");
      expect(match.isMatch).toBe(true);
      expect(match.matchType).toBe("filler_variant");
      expect(match.confidence).toBe(85);
    });

    it("5.5 returns none for completely unrelated tokens", () => {
      const match = evaluateCloneMatch("PUMPRUN", undefined, "DOGE");
      expect(match.isMatch).toBe(false);
      expect(match.matchType).toBe("none");
      expect(match.confidence).toBe(0);
    });
  });

  // ── 6. Clone Cluster Analysis ───────────────────────────────
  describe("6. Clone Cluster Analysis", () => {
    it("6.1 classifies 0 matches as SOLO", () => {
      const res = analyzeCloneCluster("UNIQUE", undefined, []);
      expect(res.clusterStatus).toBe("SOLO");
      expect(res.totalObserved).toBe(0);
      expect(res.lookalikeCount).toBe(0);
    });

    it("6.2 classifies 1-2 matches as CLEAN", () => {
      const pairs = [
        { chainId: "base", baseToken: { symbol: "CLEAN" } },
      ];
      const res = analyzeCloneCluster("CLEAN", undefined, pairs);
      expect(res.clusterStatus).toBe("CLEAN");
      expect(res.totalObserved).toBe(1);
    });

    it("6.3 classifies 3-4 matches as CONTESTED", () => {
      const pairs = [
        { chainId: "base", baseToken: { symbol: "TEST" } },
        { chainId: "solana", baseToken: { symbol: "TEST" } },
        { chainId: "base", baseToken: { symbol: "TESTCOIN" } },
      ];
      const res = analyzeCloneCluster("TEST", undefined, pairs);
      expect(res.clusterStatus).toBe("CONTESTED");
      expect(res.totalObserved).toBe(3);
      expect(res.lookalikeCount).toBe(1);
    });

    it("6.4 classifies >= 5 matches as SWARM with clone war alert", () => {
      const pairs = [
        { chainId: "base", baseToken: { symbol: "SWARM" } },
        { chainId: "solana", baseToken: { symbol: "SWARM" } },
        { chainId: "base", baseToken: { symbol: "SWARMCOIN" } },
        { chainId: "base", baseToken: { symbol: "SW\u0410RM" } }, // Cyrillic А lookalike
        { chainId: "solana", baseToken: { symbol: "SW4RM" } },
      ];
      const res = analyzeCloneCluster("SWARM", undefined, pairs);
      expect(res.clusterStatus).toBe("SWARM");
      expect(res.totalObserved).toBe(5);
      expect(res.summaryNote).toContain("SWARM");
    });
  });

  // ── 7. Integration with Saturation Checker ──────────────────
  describe("7. Integration with checkCrossChainSaturation", () => {
    it("7.1 catches homoglyph lookalike tokens and marks saturation = true when cluster is contested", async () => {
      const now = Date.now();
      axiosGetSpy.mockResolvedValueOnce({
        data: {
          pairs: [
            { chainId: "base", pairCreatedAt: now - 1000, baseToken: { symbol: "PEANUT" } },
            { chainId: "base", pairCreatedAt: now - 2000, baseToken: { symbol: "PEANU\u0422" } }, // Cyrillic lookalike
            { chainId: "solana", pairCreatedAt: now - 3000, baseToken: { symbol: "PEANUTCOIN" } }, // Suffix variant
          ],
        },
      });

      const res = await checkCrossChainSaturation("PEANUT", ["base", "solana"]);

      expect(res.saturated).toBe(true);
      expect(res.count).toBe(3);
      expect(res.cloneCluster).toBeDefined();
      expect(res.cloneCluster?.hasHomoglyphs).toBe(true);
      expect(res.cloneCluster?.clusterStatus).toBe("CONTESTED");
      expect(res.cloneCluster?.lookalikeCount).toBe(2);
    });

    it("7.2 preserves clean status when no lookalikes or duplicates exist", async () => {
      axiosGetSpy.mockResolvedValueOnce({
        data: {
          pairs: [],
        },
      });

      const res = await checkCrossChainSaturation("SOLOTOKEN", ["base", "solana"]);

      expect(res.saturated).toBe(false);
      expect(res.count).toBe(0);
      expect(res.cloneCluster?.clusterStatus).toBe("SOLO");
    });
  });
});
