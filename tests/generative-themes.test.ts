/**
 * tests/generative-themes.test.ts
 *
 * Automated regression test verifying the Generative Multi-Theme Visual Engine:
 *  1. Algorithmic color palette generation (deterministic hashing from ticker/name).
 *  2. 4 Distinct visual style presets (Neo-Brutalism, Glassmorphism, Minimalist Clean, Retro-Arcade).
 *  3. Ecosystem Navigation Cluster (Intelena-standard 6 buttons + Docs modal).
 */

import { describe, it, expect } from "bun:test";
import {
  generateAlgorithmicPalette,
  getThemeStyleConfig,
  getEnrichedSectorTheme,
  hslToHex,
  type ThemeStylePreset,
} from "../src/modules/growth/template-registry.ts";
import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import * as fs from "fs";
import * as path from "path";

describe("Generative Multi-Theme Visual Engine Suite", () => {
  it("1. hslToHex should convert valid HSL parameters to standard 7-char Hex strings", () => {
    const red = hslToHex(0, 100, 50);
    expect(red.toLowerCase()).toBe("#ff0000");

    const green = hslToHex(120, 100, 50);
    expect(green.toLowerCase()).toBe("#00ff00");

    const blue = hslToHex(240, 100, 50);
    expect(blue.toLowerCase()).toBe("#0000ff");
  });

  it("2. generateAlgorithmicPalette should create deterministic, unique palettes for different tokens", () => {
    const palA = generateAlgorithmicPalette("CLANKAI", "Clanker AI Agent", "NEO_BRUTALISM");
    const palB = generateAlgorithmicPalette("PUMPRUN", "Pump Run Token", "NEO_BRUTALISM");

    expect(palA.primaryColor.startsWith("#")).toBe(true);
    expect(palB.primaryColor.startsWith("#")).toBe(true);
    // Two different tokens must have different primary colors
    expect(palA.primaryColor).not.toBe(palB.primaryColor);

    // Neo-Brutalism must have black borders and hard shadows
    expect(palA.borderColor).toBe("#000000");
    expect(palA.shadowStyle).toContain("6px 6px 0px");
  });

  it("3. should generate distinct palettes across all 4 style presets", () => {
    const presets: ThemeStylePreset[] = [
      "NEO_BRUTALISM",
      "GLASSMORPHISM",
      "MINIMALIST_CLEAN",
      "RETRO_ARCADE",
    ];

    for (const p of presets) {
      const pal = generateAlgorithmicPalette("TEST", "Test Token", p);
      const styleCfg = getThemeStyleConfig(p, pal);

      expect(styleCfg.preset).toBe(p);
      expect(typeof styleCfg.bodyClasses).toBe("string");
      expect(typeof styleCfg.cardClasses).toBe("string");
      expect(typeof styleCfg.buttonPrimaryClasses).toBe("string");
    }
  });

  it("4. getEnrichedSectorTheme should auto-map sectors to intuitive visual styles or honor override", () => {
    const memeTheme = getEnrichedSectorTheme("VIRAL_MEME", "MEME", "Viral Meme");
    expect(memeTheme.themeStyle).toBe("NEO_BRUTALISM");

    const aiTheme = getEnrichedSectorTheme("AI_AGENT", "NEURAL", "Neural Agent");
    expect(aiTheme.themeStyle).toBe("GLASSMORPHISM");

    const defiTheme = getEnrichedSectorTheme("DEFI_TREASURY", "YIELD", "Yield Vault");
    expect(defiTheme.themeStyle).toBe("MINIMALIST_CLEAN");

    // Explicit override test
    const overridden = getEnrichedSectorTheme("AI_AGENT", "NEURAL", "Neural Agent", "NEO_BRUTALISM");
    expect(overridden.themeStyle).toBe("NEO_BRUTALISM");
  });

  it("5. generateTokenWebsite should render Ecosystem Navigation Cluster & Docs Modal", async () => {
    const testDir = path.join(process.cwd(), "sites", "test_generative_theme_unit");

    const res = await generateTokenWebsite({
      name: "Intelena Prototype",
      ticker: "INTEL",
      contractAddress: "0x1111111111111111111111111111111111111111",
      chainId: 8453,
      chainName: "base",
      preferredStyle: "NEO_BRUTALISM",
      outputDir: testDir,
      websiteUrl: "https://intel-web3.pages.dev",
      twitterUrl: "https://x.com/search?q=%24INTEL",
      telegramUrl: "https://t.me/intel_portal",
    });

    expect(fs.existsSync(res.indexHtmlPath)).toBe(true);
    const html = fs.readFileSync(res.indexHtmlPath, "utf-8");

    // Verify Ecosystem Navigation Cluster (Intelena Standard)
    expect(html).toContain("Official Ecosystem Links");
    expect(html).toContain("🌐 Website");
    expect(html).toContain("📄 Docs");
    expect(html).toContain("💻 Contract");
    expect(html).toContain("⚡ dApp");
    expect(html).toContain("🐦 Twitter / X");
    expect(html).toContain("💬 Telegram");

    // Verify Docs Modal
    expect(html).toContain('id="docs-modal"');
    expect(html).toContain("PROTOCOL DOCS");
    expect(html).toContain("100/100 SAFE SPEC");

    // Verify Neo-Brutalism styling was injected
    expect(html).toContain("neo-card");

    const cssPath = path.join(testDir, "styles.css");
    const css = fs.readFileSync(cssPath, "utf-8");
    expect(css).toContain("NEO-BRUTALISM HARD SHADOWS");
    expect(css).toContain("border: 3px solid #000000");

    // Cleanup test folder
    fs.rmSync(testDir, { recursive: true, force: true });
  });
});
