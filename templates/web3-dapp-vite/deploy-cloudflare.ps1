# deploy-cloudflare.ps1
# 1-Click Cloudflare Pages Build & Deployment Script for Windows PowerShell
$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Cloudflare Pages 1-Click Deploy: Web3 DApp" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check bun or npm
$runner = "bun"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    $runner = "npm"
}

Write-Host "[1/3] Installing dependencies ($runner install)..." -ForegroundColor Yellow
& $runner install

Write-Host "[2/3] Building production static bundle ($runner run build)..." -ForegroundColor Yellow
& $runner run build

if (-not (Test-Path "dist\index.html")) {
    Write-Error "Build failed: dist\index.html does not exist."
    exit 1
}

Write-Host "[3/3] Deploying dist/ to Cloudflare Pages via Wrangler..." -ForegroundColor Green
npx wrangler pages deploy dist --project-name=web3-token-dapp

Write-Host "Deployment complete! Visit your Cloudflare Pages URL." -ForegroundColor Green
