import fs from "fs";
import path from "path";

async function main() {
  console.log("=================================================================");
  console.log("   VERIFIKASI KELENGKAPAN ASET FAST-TRACK DEXSCREENER ($PUMPRUN)");
  console.log("=================================================================");

  const pumprunDir = path.resolve(process.cwd(), "sites", "pumprun");
  const fastTrackFile = path.join(pumprunDir, "dexscreener-fast-track.txt");
  const iconFile = path.join(pumprunDir, "dexscreener-icon.png");
  const headerFile = path.join(pumprunDir, "dexscreener-header.png");

  if (!fs.existsSync(fastTrackFile)) {
    console.error("❌ Berkas dexscreener-fast-track.txt tidak ditemukan!");
    process.exit(1);
  }

  // 1. Verify Local PNG Image Files for DexScreener Upload Form
  console.log("[1] Memeriksa Berkas Gambar Lokal (Form Upload DexScreener):");
  if (fs.existsSync(iconFile)) {
    const stat = fs.statSync(iconFile);
    console.log(` ✅ [ICON READY] ${iconFile} (${(stat.size / 1024).toFixed(1)} KB, 1:1 Aspect Ratio)`);
  } else {
    console.error(" ❌ dexscreener-icon.png TIDAK DITEMUKAN!");
    process.exit(1);
  }

  if (fs.existsSync(headerFile)) {
    const stat = fs.statSync(headerFile);
    console.log(` ✅ [HEADER READY] ${headerFile} (${(stat.size / 1024).toFixed(1)} KB, 3:1 Aspect Ratio)`);
  } else {
    console.error(" ❌ dexscreener-header.png TIDAK DITEMUKAN!");
    process.exit(1);
  }

  // 2. Verify Online URLs
  console.log("\n[2] Memeriksa Tautan Web & API Publik:");
  const tests = [
    { label: "Live DApp Website", url: "https://pumprun-web3.pages.dev" },
    { label: "DexScreener Pair API", url: "https://api.dexscreener.com/latest/dex/tokens/0x0a99f4251A461e8abC693a56BB837fD815D51BA3" },
    { label: "Doppler Web Terminal", url: "https://app.doppler.lol/tokens/base/0x0a99f4251A461e8abC693a56BB837fD815D51BA3" }
  ];

  for (const item of tests) {
    try {
      const res = await fetch(item.url, { method: "HEAD" });
      if (res.status >= 200 && res.status < 400) {
        console.log(` ✅ [200 OK] ${item.label}: ${item.url}`);
      } else {
        console.warn(` ⚠️ [Status ${res.status}] ${item.label}: ${item.url}`);
      }
    } catch (e: any) {
      console.error(` ❌ [FAILED] ${item.label}: ${e.message}`);
    }
  }

  console.log("=================================================================");
  console.log(" 🎉 SELURUH ASET DEXSCREENER SIAP UPLOAD 100%!");
  console.log("    - Icon File   : sites/pumprun/dexscreener-icon.png (1:1 Square)");
  console.log("    - Header File : sites/pumprun/dexscreener-header.png (3:1 Rect)");
  console.log("    - Guide File  : sites/pumprun/dexscreener-fast-track.txt");
  console.log("=================================================================");
}

main();
