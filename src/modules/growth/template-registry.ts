/**
 * src/modules/growth/template-registry.ts
 *
 * Web3 Sector Taxonomy & Curated GitHub Template Registry.
 *
 * Maps token narratives (from Firecrawl trend scraping, Gemini AI, or token metadata)
 * to 4 distinct Web3 Archetypes, visual 3D styling themes, and vetted open-source
 * GitHub repositories ready for dynamic cloning & deployment.
 */

export type Web3Sector = "AI_AGENT" | "DEFI_TREASURY" | "VIRAL_MEME" | "GAMING_UTILITY";

export type ThemeStylePreset =
  | "BENTO_GRID_DAPP"
  | "CYBER_TERMINAL_HUD"
  | "GLASSMORPHISM_PORTAL"
  | "SWISS_MINIMALIST_CLEAN"
  | "NEO_BRUTALISM"
  | "GLASSMORPHISM"
  | "MINIMALIST_CLEAN"
  | "RETRO_ARCADE";

export interface AlgorithmicPalette {
  primaryColor: string;
  secondaryColor: string;
  accentGlow: string;
  backgroundGradient: string;
  cardBackground: string;
  borderColor: string;
  textColor: string;
  shadowStyle: string;
  badgeBg: string;
  badgeText: string;
}

export interface ThemeStyleConfig {
  preset: ThemeStylePreset;
  displayName: string;
  bodyClasses: string;
  cardClasses: string;
  buttonPrimaryClasses: string;
  buttonSecondaryClasses: string;
  badgeClasses: string;
  borderStyleCss: string;
  cardShadowCss: string;
}

export interface CuratedGithubTemplate {
  id: string;
  name: string;
  sector: Web3Sector;
  repoUrl: string;
  defaultBranch: string;
  stars: number;
  description: string;
  configFilePath: string;
  features: string[];
}

export interface SectorThemeConfig {
  sector: Web3Sector;
  displayName: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  accentGlow: string;
  backgroundGradient: string;
  cardBackground: string;
  visualEffect: "matrix-rain" | "3d-tilt-particles" | "cyber-grid" | "fomo-fire";
  curatedTemplate: CuratedGithubTemplate;
  hasTerminalSandbox: boolean;
  hasLiveBuyToast: boolean;
  hasTreasuryCounter: boolean;
  hasNodePowerGauge: boolean;
  badgeText: string;
  themeStyle?: ThemeStylePreset;
  palette?: AlgorithmicPalette;
  styleConfig?: ThemeStyleConfig;
}

export const CURATED_GITHUB_TEMPLATES: Record<Web3Sector, CuratedGithubTemplate> = {
  VIRAL_MEME: {
    id: "shadcn-landing-meme",
    name: "Shadcn Next.js Landing Page",
    sector: "VIRAL_MEME",
    repoUrl: "https://github.com/nobruf/shadcn-landing-page",
    defaultBranch: "main",
    stars: 1285,
    description: "Ultra-responsive Next.js 14 + Shadcn UI + Tailwind CSS landing page with dark mode and viral layout.",
    configFilePath: "config/token.ts",
    features: ["Zero npm build friction", "FOMO Countdown", "DexScreener Embed", "Mobile First"],
  },
  AI_AGENT: {
    id: "terminal-ai-agent",
    name: "Autonomous AI Terminal Portfolio",
    sector: "AI_AGENT",
    repoUrl: "https://github.com/satnaing/terminal-portfolio",
    defaultBranch: "master",
    stars: 818,
    description: "Interactive cyber-terminal with live command sandbox, token intelligence logs, and matrix aesthetic.",
    configFilePath: "config/token.ts",
    features: ["Interactive Command Sandbox", "Matrix Rain Background", "Prompt Telemetry", "1-Click Copy CA"],
  },
  DEFI_TREASURY: {
    id: "turbo-web3-defi",
    name: "Turbo Eth Web3 DApp Starter",
    sector: "DEFI_TREASURY",
    repoUrl: "https://github.com/turbo-eth/template-web3-app",
    defaultBranch: "main",
    stars: 384,
    description: "Modern DeFi dashboard with RainbowKit wallet connection, Wagmi v2 on-chain stats, and APY visuals.",
    configFilePath: "config/token.ts",
    features: ["RainbowKit Wallet Connect", "Wagmi On-Chain Balance", "Flywheel APY", "Treasury Metrics"],
  },
  GAMING_UTILITY: {
    id: "gaming-depin-hud",
    name: "Cyberpunk DePIN & Gaming HUD",
    sector: "GAMING_UTILITY",
    repoUrl: "https://github.com/nobruf/shadcn-landing-page",
    defaultBranch: "main",
    stars: 1285,
    description: "Futuristic HUD interface with hardware node telemetry, tier roadmap, and ecosystem partner grid.",
    configFilePath: "config/token.ts",
    features: ["Hardware Telemetry", "Tier Roadmap", "Ecosystem Grid", "Cyberpunk Neomorphism"],
  },
};

export const SECTOR_THEMES: Record<Web3Sector, SectorThemeConfig> = {
  AI_AGENT: {
    sector: "AI_AGENT",
    displayName: "Autonomous AI Agent & Matrix Swarm",
    tagline: "Autonomous On-Chain AI Agent Protocol powered by LLMs & Machine Intelligence",
    primaryColor: "#00ff66", // Cyber green
    secondaryColor: "#00ccff", // Cyan
    accentGlow: "rgba(0, 255, 102, 0.4)",
    backgroundGradient: "radial-gradient(circle at 50% 0%, #052e16 0%, #020617 70%)",
    cardBackground: "rgba(5, 46, 22, 0.25)",
    visualEffect: "matrix-rain",
    curatedTemplate: CURATED_GITHUB_TEMPLATES.AI_AGENT,
    hasTerminalSandbox: true,
    hasLiveBuyToast: false,
    hasTreasuryCounter: false,
    hasNodePowerGauge: false,
    badgeText: "⚡ Autonomous AI Agent",
  },
  DEFI_TREASURY: {
    sector: "DEFI_TREASURY",
    displayName: "Decentralized Treasury & Yield Flywheel",
    tagline: "Positive-Sum Autonomous Flywheel with 30% Buyback & 20% Passive WETH Dividends",
    primaryColor: "#3b82f6", // Electric blue
    secondaryColor: "#8b5cf6", // Purple
    accentGlow: "rgba(59, 130, 246, 0.4)",
    backgroundGradient: "radial-gradient(circle at 50% 0%, #1e1b4b 0%, #030712 70%)",
    cardBackground: "rgba(30, 27, 75, 0.3)",
    visualEffect: "3d-tilt-particles",
    curatedTemplate: CURATED_GITHUB_TEMPLATES.DEFI_TREASURY,
    hasTerminalSandbox: false,
    hasLiveBuyToast: false,
    hasTreasuryCounter: true,
    hasNodePowerGauge: false,
    badgeText: "💎 Treasury Flywheel",
  },
  VIRAL_MEME: {
    sector: "VIRAL_MEME",
    displayName: "Viral Community Flywheel & Meme Degen",
    tagline: "High-Energy Community Token with 10-Minute FOMO Jackpot and 0% Friction Tax",
    primaryColor: "#ff007a", // Neon magenta
    secondaryColor: "#ffb703", // Gold amber
    accentGlow: "rgba(255, 0, 122, 0.4)",
    backgroundGradient: "radial-gradient(circle at 50% 0%, #4c0519 0%, #09090b 70%)",
    cardBackground: "rgba(76, 5, 25, 0.25)",
    visualEffect: "fomo-fire",
    curatedTemplate: CURATED_GITHUB_TEMPLATES.VIRAL_MEME,
    hasTerminalSandbox: false,
    hasLiveBuyToast: true,
    hasTreasuryCounter: false,
    hasNodePowerGauge: false,
    badgeText: "🔥 Viral Community Degen",
  },
  GAMING_UTILITY: {
    sector: "GAMING_UTILITY",
    displayName: "DePIN Infrastructure & Gaming Utility",
    tagline: "Decentralized Physical Infrastructure and Gaming Protocol on High-Speed L2",
    primaryColor: "#06b6d4", // Cyan
    secondaryColor: "#f59e0b", // Amber
    accentGlow: "rgba(6, 182, 212, 0.4)",
    backgroundGradient: "radial-gradient(circle at 50% 0%, #083344 0%, #020617 70%)",
    cardBackground: "rgba(8, 51, 68, 0.25)",
    visualEffect: "cyber-grid",
    curatedTemplate: CURATED_GITHUB_TEMPLATES.GAMING_UTILITY,
    hasTerminalSandbox: false,
    hasLiveBuyToast: false,
    hasTreasuryCounter: false,
    hasNodePowerGauge: true,
    badgeText: "🕹️ DePIN Infrastructure",
  },
};

/**
 * Classifies a token into one of 4 Web3 Sectors based on its name, ticker,
 * description, or scraped Firecrawl trend narrative.
 */
export function detectSector(
  name: string,
  ticker: string,
  description: string = "",
  trendNarrative: string = ""
): Web3Sector {
  const titleText = `${name} ${ticker}`.toLowerCase();
  const descText = `${description} ${trendNarrative}`.toLowerCase();

  // 1. Precise check on Token Name & Ticker
  const defiNameKeywords = ["yield", "treasury", "vault", "cash", "bank", "pay", "finance", "stake", "swap", "dividend", "flywheel"];
  if (defiNameKeywords.some((k) => titleText.includes(k))) {
    return "DEFI_TREASURY";
  }

  const aiNameKeywords = ["agent", "ai", "brain", "cortex", "neural", "intel", "matrix", "clank", "gpt", "swarm", "bot", "deepmind"];
  if (aiNameKeywords.some((k) => titleText.includes(k))) {
    return "AI_AGENT";
  }

  const gamingNameKeywords = ["game", "play", "node", "depin", "compute", "gpu", "quest", "pixel", "arcade"];
  if (gamingNameKeywords.some((k) => titleText.includes(k))) {
    return "GAMING_UTILITY";
  }

  // 2. Secondary check on Description & Trends
  if (aiNameKeywords.some((k) => descText.includes(k))) {
    return "AI_AGENT";
  }
  if (gamingNameKeywords.some((k) => descText.includes(k))) {
    return "GAMING_UTILITY";
  }
  const defiDescKeywords = ["yield", "treasury", "vault", "cash", "bank", "pay", "finance", "stake", "swap", "dividend"];
  if (defiDescKeywords.some((k) => descText.includes(k))) {
    return "DEFI_TREASURY";
  }

  // 3. Default: Viral Community Meme
  return "VIRAL_MEME";
}

/**
 * Retrieves the theme configuration for a given Web3 sector.
 */
export function getSectorTheme(sector: Web3Sector): SectorThemeConfig {
  return SECTOR_THEMES[sector] || SECTOR_THEMES.VIRAL_MEME;
}

/**
 * Deterministic hash function for string inputs.
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Converts HSL values to a Hex color string.
 */
export function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Generates an algorithmic, distinct color palette for a token based on its ticker and name.
 * Guarantees that every token gets a unique, harmonious color signature.
 */
export function generateAlgorithmicPalette(
  ticker: string,
  name: string,
  preset: ThemeStylePreset = "NEO_BRUTALISM"
): AlgorithmicPalette {
  const seed = hashString(`${ticker.toUpperCase()}_${name}`);
  const baseHue = seed % 360;
  const secondaryHue = (baseHue + 45 + (seed % 90)) % 360;

  if (preset === "BENTO_GRID_DAPP") {
    // Modular bento tiles, high contrast, dark slate surface
    const primary = hslToHex(baseHue, 95, 55);
    const secondary = hslToHex(secondaryHue, 95, 52);
    return {
      primaryColor: primary,
      secondaryColor: secondary,
      accentGlow: "rgba(0, 0, 0, 0.9)",
      backgroundGradient: "radial-gradient(circle at 50% 0%, #111422 0%, #08090d 85%)",
      cardBackground: "#0f121d",
      borderColor: "#1e2438",
      textColor: "#ffffff",
      shadowStyle: "0 10px 30px -10px rgba(0,0,0,0.6)",
      badgeBg: primary,
      badgeText: "#000000",
    };
  }

  if (preset === "NEO_BRUTALISM") {
    // Bold high-contrast Neo-Brutalist borders and hard black drop shadows
    const primary = hslToHex(baseHue, 95, 55);
    const secondary = hslToHex(secondaryHue, 95, 52);
    return {
      primaryColor: primary,
      secondaryColor: secondary,
      accentGlow: "rgba(0, 0, 0, 0.9)",
      backgroundGradient: "radial-gradient(circle at 50% 0%, #111422 0%, #08090d 85%)",
      cardBackground: "#18181b",
      borderColor: "#000000",
      textColor: "#ffffff",
      shadowStyle: "6px 6px 0px #000000",
      badgeBg: primary,
      badgeText: "#000000",
    };
  }

  if (preset === "GLASSMORPHISM_PORTAL" || preset === "GLASSMORPHISM") {
    // Elegant translucent glass with neon glowing accents
    const primary = hslToHex(baseHue, 90, 60);
    const secondary = hslToHex(secondaryHue, 85, 65);
    return {
      primaryColor: primary,
      secondaryColor: secondary,
      accentGlow: `rgba(${parseInt(primary.slice(1, 3), 16)}, ${parseInt(primary.slice(3, 5), 16)}, ${parseInt(primary.slice(5, 7), 16)}, 0.45)`,
      backgroundGradient: "radial-gradient(circle at 50% 10%, #0f172a 0%, #020617 80%)",
      cardBackground: "rgba(30, 41, 59, 0.35)",
      borderColor: "rgba(255, 255, 255, 0.12)",
      textColor: "#f8fafc",
      shadowStyle: "0 20px 50px rgba(0, 0, 0, 0.5)",
      badgeBg: "rgba(255, 255, 255, 0.08)",
      badgeText: primary,
    };
  }

  if (preset === "SWISS_MINIMALIST_CLEAN" || preset === "MINIMALIST_CLEAN") {
    // Swiss style, clean monochrome typography with single high-impact accent
    const accent = hslToHex(baseHue, 80, 50);
    return {
      primaryColor: accent,
      secondaryColor: "#ffffff",
      accentGlow: "rgba(255, 255, 255, 0.15)",
      backgroundGradient: "#09090b",
      cardBackground: "#121215",
      borderColor: "rgba(255, 255, 255, 0.08)",
      textColor: "#f4f4f5",
      shadowStyle: "0 4px 20px rgba(0, 0, 0, 0.3)",
      badgeBg: "#27272a",
      badgeText: "#fafafa",
    };
  }

  // CYBER_TERMINAL_HUD / RETRO_ARCADE
  const primary = hslToHex(baseHue, 100, 50);
  const secondary = hslToHex((baseHue + 180) % 360, 100, 50);
  return {
    primaryColor: primary,
    secondaryColor: secondary,
    accentGlow: "rgba(0, 255, 128, 0.4)",
    backgroundGradient: "radial-gradient(circle at 50% 0%, #022c22 0%, #020617 80%)",
    cardBackground: "#051510",
    borderColor: primary,
    textColor: "#a7f3d0",
    shadowStyle: "4px 4px 0px " + primary,
    badgeBg: primary,
    badgeText: "#000000",
  };
}

/**
 * Returns complete UI styling classes and CSS properties for a chosen style preset.
 */
export function getThemeStyleConfig(
  preset: ThemeStylePreset,
  palette: AlgorithmicPalette
): ThemeStyleConfig {
  if (preset === "BENTO_GRID_DAPP") {
    return {
      preset,
      displayName: "Bento Grid DApp (Modular Asymmetric Tiles & Live Telemetry)",
      bodyClasses: "font-sans bg-[#08090d] text-slate-100 selection:bg-brandPrimary selection:text-black",
      cardClasses: "bg-slate-900/70 border border-slate-800/80 rounded-2xl shadow-xl hover:border-brandPrimary/40 transition duration-300",
      buttonPrimaryClasses: "px-4 py-2.5 rounded-xl bg-gradient-to-r from-brandPrimary to-brandSecondary text-black font-bold shadow-lg shadow-brandPrimary/20 hover:brightness-110 active:scale-95 transition",
      buttonSecondaryClasses: "px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-slate-200 font-semibold active:scale-95 transition",
      badgeClasses: "px-2.5 py-1 rounded-full bg-brandPrimary/15 border border-brandPrimary/30 text-brandPrimary font-mono text-xs font-semibold",
      borderStyleCss: "border: 1px solid rgba(255, 255, 255, 0.08);",
      cardShadowCss: "box-shadow: 0 10px 30px -10px rgba(0,0,0,0.5);",
    };
  }

  if (preset === "NEO_BRUTALISM") {
    return {
      preset,
      displayName: "Neo-Brutalism (Bold Black Borders & Hard Shadows)",
      bodyClasses: "font-mono bg-[#0c0d12] text-white selection:bg-brandPrimary selection:text-black",
      cardClasses: "border-[3px] border-black bg-zinc-900 shadow-[6px_6px_0px_#000000] rounded-none transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5",
      buttonPrimaryClasses: "px-4 py-2 border-[3px] border-black bg-brandPrimary text-black font-black uppercase shadow-[4px_4px_0px_#000000] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#000000] transition-all",
      buttonSecondaryClasses: "px-4 py-2 border-[3px] border-black bg-white text-black font-bold uppercase shadow-[4px_4px_0px_#000000] hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0px_#000000] transition-all",
      badgeClasses: "px-2.5 py-1 border-2 border-black bg-brandPrimary text-black font-black uppercase text-xs shadow-[2px_2px_0px_#000000]",
      borderStyleCss: "border: 3px solid #000000;",
      cardShadowCss: "box-shadow: 6px 6px 0px #000000;",
    };
  }

  if (preset === "GLASSMORPHISM_PORTAL" || preset === "GLASSMORPHISM") {
    return {
      preset,
      displayName: "Glassmorphism (Frosted Glass & Cyber Glow)",
      bodyClasses: "font-sans bg-[#070913] text-gray-100 selection:bg-brandPrimary selection:text-black",
      cardClasses: "backdrop-blur-xl bg-slate-900/40 border border-white/10 rounded-2xl shadow-2xl transition hover:border-brandPrimary/40 hover:shadow-brandPrimary/10",
      buttonPrimaryClasses: "px-4 py-2.5 rounded-xl bg-gradient-to-r from-brandPrimary to-brandSecondary text-black font-bold shadow-lg shadow-brandPrimary/25 hover:opacity-90 transition",
      buttonSecondaryClasses: "px-4 py-2.5 rounded-xl backdrop-blur-md bg-white/10 border border-white/20 text-white font-medium hover:bg-white/15 transition",
      badgeClasses: "px-2.5 py-1 rounded-full backdrop-blur-md bg-brandPrimary/20 text-brandPrimary border border-brandPrimary/30 font-mono text-xs",
      borderStyleCss: "border: 1px solid rgba(255, 255, 255, 0.12);",
      cardShadowCss: "box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6);",
    };
  }

  if (preset === "SWISS_MINIMALIST_CLEAN" || preset === "MINIMALIST_CLEAN") {
    return {
      preset,
      displayName: "Minimalist Clean (Swiss Grid & High Readability)",
      bodyClasses: "font-sans bg-[#09090b] text-zinc-100 selection:bg-brandPrimary selection:text-black",
      cardClasses: "bg-zinc-900/60 border border-zinc-800/80 rounded-lg shadow-sm hover:border-zinc-700 transition",
      buttonPrimaryClasses: "px-4 py-2.5 rounded-md bg-brandPrimary text-black font-semibold hover:opacity-90 transition",
      buttonSecondaryClasses: "px-4 py-2.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition",
      badgeClasses: "px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono text-xs",
      borderStyleCss: "border: 1px solid rgba(255, 255, 255, 0.08);",
      cardShadowCss: "box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);",
    };
  }

  // CYBER_TERMINAL_HUD / RETRO_ARCADE
  return {
    preset,
    displayName: "Cyberpunk Terminal HUD (Pixel Phosphor & Scanlines)",
    bodyClasses: "font-mono bg-[#030706] text-emerald-300 selection:bg-emerald-400 selection:text-black",
    cardClasses: "border-2 border-emerald-500/60 bg-emerald-950/20 shadow-[4px_4px_0px_#10b981] rounded-none hover:border-emerald-400 transition",
    buttonPrimaryClasses: "px-4 py-2 border-2 border-emerald-400 bg-emerald-400 text-black font-bold uppercase shadow-[3px_3px_0px_#065f46] hover:translate-x-0.5 hover:translate-y-0.5 transition",
    buttonSecondaryClasses: "px-4 py-2 border-2 border-emerald-500/60 bg-black text-emerald-300 font-bold uppercase shadow-[3px_3px_0px_#065f46] hover:bg-emerald-950/40 transition",
    badgeClasses: "px-2 py-0.5 border border-emerald-400 bg-emerald-950/80 text-emerald-400 font-mono text-xs uppercase",
    borderStyleCss: "border: 2px solid #10b981;",
    cardShadowCss: "box-shadow: 4px 4px 0px #065f46;",
  };
}

/**
 * Returns an enriched SectorThemeConfig with procedural palette and styling preset attached.
 */
export function getEnrichedSectorTheme(
  sector: Web3Sector,
  ticker: string,
  name: string,
  preferredStyle?: ThemeStylePreset
): SectorThemeConfig {
  const baseTheme = { ...getSectorTheme(sector) };

  // Map sector to sensible default style if preferredStyle is not provided
  let stylePreset: ThemeStylePreset = preferredStyle || "NEO_BRUTALISM";
  if (!preferredStyle) {
    if (sector === "AI_AGENT") stylePreset = "GLASSMORPHISM";
    else if (sector === "DEFI_TREASURY") stylePreset = "MINIMALIST_CLEAN";
    else if (sector === "GAMING_UTILITY") stylePreset = "RETRO_ARCADE";
    else stylePreset = "NEO_BRUTALISM";
  }

  const palette = generateAlgorithmicPalette(ticker, name, stylePreset);
  const styleConfig = getThemeStyleConfig(stylePreset, palette);

  baseTheme.themeStyle = stylePreset;
  baseTheme.palette = palette;
  baseTheme.styleConfig = styleConfig;
  baseTheme.primaryColor = preferredStyle ? palette.primaryColor : (baseTheme.primaryColor || palette.primaryColor);
  baseTheme.secondaryColor = preferredStyle ? palette.secondaryColor : (baseTheme.secondaryColor || palette.secondaryColor);
  baseTheme.accentGlow = palette.accentGlow;
  baseTheme.backgroundGradient = palette.backgroundGradient;
  baseTheme.cardBackground = palette.cardBackground;

  return baseTheme;
}
