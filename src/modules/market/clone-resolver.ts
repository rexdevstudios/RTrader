/**
 * clone-resolver.ts — Deteksi Kloning & Anti-Vamp Token Lintas-Chain
 *
 * Mengadopsi prinsip intelijen Novamp Terminal:
 * 1. Normalisasi Homoglyph (mendeteksi huruf Cyrillic/Greek yang mirip huruf Latin).
 * 2. Normalisasi Leetspeak (0 -> O, 1 -> I, 3 -> E, 4 -> A, 5 -> S, 7 -> T).
 * 3. Pelipatan Kata Pengisi (Filler words: COIN, TOKEN, INU, OFFICIAL, V2, dll).
 * 4. Analisis Klaster Kloning (SOLO, CLEAN, CONTESTED, SWARM).
 */

// Peta Homoglif Cyrillic / Greek ke Latin
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic Small
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d",
  // Cyrillic Capital
  "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X", "І": "I",
  // Greek
  "α": "a", "β": "b", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
  "Α": "A", "Β": "B", "Ε": "E", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Χ": "X",
};

// Peta Leetspeak (hanya angka ke huruf)
const LEET_MAP: Record<string, string> = {
  "0": "O",
  "1": "I",
  "3": "E",
  "4": "A",
  "5": "S",
  "7": "T",
  "8": "B",
};

// Kata pengisi (filler words) yang sering dipakai token tiruan
const FILLER_WORDS = [
  "COIN",
  "TOKEN",
  "INU",
  "OFFICIAL",
  "REAL",
  "OG",
  "V2",
  "V3",
  "V4",
  "REBORN",
  "MEME",
  "CLASSIC",
  "ETH",
  "SOL",
  "BASE",
  "PUMP",
  "AI",
];

export interface HomoglyphResult {
  folded: string;
  hasHomoglyphs: boolean;
  detectedChars: string[];
}

/**
 * Melipat karakter homoglif (Cyrillic/Greek) menjadi karakter ASCII Latin.
 */
export function foldHomoglyphs(input: string): HomoglyphResult {
  let folded = "";
  let hasHomoglyphs = false;
  const detectedChars: string[] = [];

  for (const char of input) {
    if (HOMOGLYPH_MAP[char]) {
      folded += HOMOGLYPH_MAP[char];
      hasHomoglyphs = true;
      if (!detectedChars.includes(char)) {
        detectedChars.push(char);
      }
    } else {
      folded += char;
    }
  }

  return { folded, hasHomoglyphs, detectedChars };
}

/**
 * Melipat substitusi leetspeak umum (angka ke huruf).
 */
export function foldLeetspeak(input: string): string {
  let result = "";
  for (const char of input.toUpperCase()) {
    result += LEET_MAP[char] ?? char;
  }
  return result;
}

/**
 * Menghilangkan kata-kata pengisi (filler words) dari awal atau akhir string.
 */
export function stripFillerWords(input: string): string {
  let clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let changed = true;

  while (changed && clean.length > 3) {
    changed = false;
    for (const filler of FILLER_WORDS) {
      if (clean.endsWith(filler) && clean.length - filler.length >= 3) {
        clean = clean.slice(0, -filler.length);
        changed = true;
        break;
      }
      if (clean.startsWith(filler) && clean.length - filler.length >= 3) {
        clean = clean.slice(filler.length);
        changed = true;
        break;
      }
    }
  }

  return clean;
}

export interface TokenKeyResult {
  rawTicker: string;
  tightKey: string;
  looseKey: string;
  hasHomoglyphs: boolean;
  detectedHomoglyphs: string[];
}

/**
 * Menghasilkan kunci normalisasi ketat (tight) dan longgar (loose).
 */
export function normalizeTokenKey(ticker: string, name?: string): TokenKeyResult {
  const raw = ticker.trim();
  const homoglyphRes = foldHomoglyphs(raw);

  // Tight: Homoglyph folded + uppercase alphanum
  const tightKey = homoglyphRes.folded.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Loose: Tight + Leetspeak folded + filler words stripped
  const leet = foldLeetspeak(tightKey);
  const looseKey = stripFillerWords(leet);

  return {
    rawTicker: raw,
    tightKey,
    looseKey,
    hasHomoglyphs: homoglyphRes.hasHomoglyphs,
    detectedHomoglyphs: homoglyphRes.detectedChars,
  };
}

export type CloneMatchType =
  | "exact"
  | "homoglyph"
  | "leetspeak"
  | "filler_variant"
  | "name_variant"
  | "none";

export interface CloneMatchEvaluation {
  isMatch: boolean;
  matchType: CloneMatchType;
  confidence: number; // 0..100
  reason?: string;
}

/**
 * Mengevaluasi apakah kandidat token merupakan tiruan atau variasi dari target ticker/name.
 */
export function evaluateCloneMatch(
  targetTicker: string,
  targetName: string | undefined,
  candidateTicker: string,
  candidateName?: string
): CloneMatchEvaluation {
  const normTarget = normalizeTokenKey(targetTicker, targetName);
  const normCandidate = normalizeTokenKey(candidateTicker, candidateName);

  // 1. Exact Match
  if (normTarget.rawTicker.toUpperCase() === normCandidate.rawTicker.toUpperCase()) {
    return {
      isMatch: true,
      matchType: "exact",
      confidence: 100,
      reason: "Exact ticker match",
    };
  }

  // 2. Homoglyph Match (e.g. Cyrillic lookalikes)
  if (normCandidate.hasHomoglyphs && normTarget.tightKey === normCandidate.tightKey) {
    return {
      isMatch: true,
      matchType: "homoglyph",
      confidence: 95,
      reason: `Homoglyph lookalike characters detected: [${normCandidate.detectedHomoglyphs.join(", ")}]`,
    };
  }

  // 3. Leetspeak Match (e.g. N0VA vs NOVA)
  const leetTarget = foldLeetspeak(normTarget.tightKey);
  const leetCand = foldLeetspeak(normCandidate.tightKey);
  if (leetTarget === leetCand && leetTarget.length >= 3) {
    return {
      isMatch: true,
      matchType: "leetspeak",
      confidence: 90,
      reason: `Leetspeak number substitution match (${candidateTicker} -> ${normCandidate.tightKey})`,
    };
  }

  // 4. Filler Word Variant (e.g. PEANUT vs PEANUTCOIN, PEANUT_INU)
  if (normTarget.looseKey === normCandidate.looseKey && normTarget.looseKey.length >= 3) {
    return {
      isMatch: true,
      matchType: "filler_variant",
      confidence: 85,
      reason: `Filler word suffix/prefix variant (loose key: ${normTarget.looseKey})`,
    };
  }

  // 5. Name Variant Match (jika nama token candidate cocok dengan target ticker/name)
  if (targetName && candidateName) {
    const cleanTargetName = targetName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const cleanCandName = candidateName.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleanTargetName.length >= 4 && cleanTargetName === cleanCandName) {
      return {
        isMatch: true,
        matchType: "name_variant",
        confidence: 80,
        reason: `Full token name identical (${candidateName})`,
      };
    }
  }

  return {
    isMatch: false,
    matchType: "none",
    confidence: 0,
  };
}

export interface CloneClusterAnalysis {
  targetTicker: string;
  clusterStatus: "SOLO" | "CLEAN" | "CONTESTED" | "SWARM";
  totalObserved: number;
  exactCount: number;
  lookalikeCount: number;
  homoglyphCount: number;
  hasHomoglyphs: boolean;
  matches: Array<{
    symbol: string;
    name?: string;
    chain: string;
    matchType: CloneMatchType;
    createdAt?: number;
  }>;
  summaryNote: string;
}

/**
 * Menganalisis seluruh daftar token pasar terhadap target ticker untuk membentuk klaster anti-vamp.
 */
export function analyzeCloneCluster(
  targetTicker: string,
  targetName: string | undefined,
  pairs: Array<{
    chainId?: string;
    pairCreatedAt?: number;
    baseToken?: { symbol?: string; name?: string };
  }>
): CloneClusterAnalysis {
  const matches: CloneClusterAnalysis["matches"] = [];
  let exactCount = 0;
  let lookalikeCount = 0;
  let homoglyphCount = 0;

  for (const p of pairs) {
    const candSymbol = p.baseToken?.symbol ?? "";
    const candName = p.baseToken?.name;
    const chain = p.chainId ?? "unknown";
    const evalRes = evaluateCloneMatch(targetTicker, targetName, candSymbol, candName);

    if (evalRes.isMatch) {
      if (evalRes.matchType === "exact") {
        exactCount++;
      } else {
        lookalikeCount++;
        if (evalRes.matchType === "homoglyph") {
          homoglyphCount++;
        }
      }

      matches.push({
        symbol: candSymbol,
        name: candName,
        chain,
        matchType: evalRes.matchType,
        createdAt: p.pairCreatedAt,
      });
    }
  }

  const total = matches.length;
  let clusterStatus: CloneClusterAnalysis["clusterStatus"] = "SOLO";
  let summaryNote = "Token unik, belum terdeteksi kloning di pasar.";

  if (total >= 5) {
    clusterStatus = "SWARM";
    summaryNote = `PERINGATAN SWARM: Terdeteksi ${total} token klon/varian (${lookalikeCount} lookalikes). Pasar sedang mengalami clone war hebat!`;
  } else if (total >= 3) {
    clusterStatus = "CONTESTED";
    summaryNote = `PERINGATAN SATURASI: Terdapat ${total} token serupa. Nama ini sedang diperebutkan di pasar.`;
  } else if (total >= 1) {
    clusterStatus = "CLEAN";
    summaryNote = `Terdapat ${total} token dengan nama serupa. Pasar masih relatif bersih/terkendali.`;
  }

  return {
    targetTicker,
    clusterStatus,
    totalObserved: total,
    exactCount,
    lookalikeCount,
    homoglyphCount,
    hasHomoglyphs: homoglyphCount > 0,
    matches,
    summaryNote,
  };
}
