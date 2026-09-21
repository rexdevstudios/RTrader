#!/usr/bin/env bash
# deploy-cloudflare.sh
# 1-Click Cloudflare Pages Build & Deployment Script for Bash / Linux / macOS
set -euo pipefail

echo "=========================================================="
echo "  Cloudflare Pages 1-Click Deploy: Web3 DApp"
echo "=========================================================="

RUNNER="bun"
if ! command -v bun &> /dev/null; then
    RUNNER="npm"
fi

echo "[1/3] Installing dependencies ($RUNNER install)..."
$RUNNER install

echo "[2/3] Building production static bundle ($RUNNER run build)..."
$RUNNER run build

if [ ! -f "dist/index.html" ]; then
    echo "Error: Build failed: dist/index.html does not exist." >&2
    exit 1
fi

echo "[3/3] Deploying dist/ to Cloudflare Pages via Wrangler..."
npx wrangler pages deploy dist --project-name=web3-token-dapp

echo "Deployment complete! Visit your Cloudflare Pages URL."
