import { generateTokenWebsite } from "../src/modules/growth/website-generator.ts";
import path from "path";

async function main() {
  console.log("🚀 Re-generating $PUMPRUN website with Upgraded Doppler Settler Web3 Widget & Bento Grid...");
  const result = await generateTokenWebsite({
    name: "Pump Hill Runner",
    ticker: "PUMPRUN",
    contractAddress: "0x0a99f4251A461e8abC693a56BB837fD815D51BA3",
    chainId: 8453,
    chainName: "base",
    description: "Autonomous high-energy community runner token with 30% perpetual buyback and 0% tax on Base Mainnet L2.",
    poolId: "0x645d579d8002a6ac09d67c59526d065321b07570b1d9f359a70346c072ca7584",
    isBankr: true,
    preferredStyle: "BENTO_GRID_DAPP",
    outputDir: path.resolve(process.cwd(), "sites", "pumprun"),
  });

  console.log("✅ Successfully generated website bundle!");
  console.log("   Directory   :", result.siteDirectory);
  console.log("   Index HTML  :", result.indexHtmlPath);
  console.log("   Preview URL :", result.previewUrl);
  console.log("   Live URL    :", result.liveUrl);
}

main().catch((err) => {
  console.error("❌ Error regenerating website:", err);
  process.exit(1);
});
