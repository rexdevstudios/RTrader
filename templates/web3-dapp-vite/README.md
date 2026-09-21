# Web3 Token DApp Starter (Cloudflare Pages Ready)

Modern, ultra-fast Web3 DApp for Base L2 tokens with interactive on-chain swap powered by Wagmi v2, Viem, and Tailwind CSS.

## Features
- **100% Cloudflare Pages Compliant:** Pure client-side SPA with zero Node.js server overhead.
- **On-Chain Doppler Swap:** Embedded Buy & Sell swap widget interacting with the Doppler Settler contract (`0x0000000000001ff3684f28c67538d4d072c22734`).
- **Live DexScreener Embed:** Real-time responsive chart.
- **Bento Box Grid Design:** Inspired by `ui-ux-pro-max-skill`.

## Quick Start

```bash
# 1. Install dependencies
bun install

# 2. Start local development server
bun run dev

# 3. Build static production bundle
bun run build

# 4. Deploy to Cloudflare Pages
bun run deploy:pages
# or use Wrangler CLI:
wrangler pages deploy dist --project-name=web3-token-dapp
```
