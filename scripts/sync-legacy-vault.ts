import { Database } from "bun:sqlite";

async function syncVault() {
  const srcPath = "C:/Users/a/Downloads/BOT-Deploy-Multi-Chain/.eliza/vault.db";
  const destPath = "C:/Users/a/Downloads/BOT/.eliza/vault.db";

  console.log(`Migrating proxy configurations from:\n  ${srcPath}\nto:\n  ${destPath}`);

  const srcDb = new Database(srcPath);
  const destDb = new Database(destPath);

  // Sync proxy_configs
  const proxies = srcDb.query("SELECT * FROM proxy_configs").all() as any[];
  console.log(`Found ${proxies.length} proxies in legacy vault.`);

  for (const p of proxies) {
    const cols = Object.keys(p);
    const placeholders = cols.map(() => "?").join(", ");
    const sql = `INSERT OR REPLACE INTO proxy_configs (${cols.join(", ")}) VALUES (${placeholders})`;
    destDb.run(sql, Object.values(p));
    console.log(`  -> Synced proxy: ${p.id} (${p.protocol}://${p.host}:${p.port})`);
  }

  // Also bind proxy_us_la to current active wallets in BOT vault using wallet-manager API
  const { listWalletAccounts, setWalletProviderRoute } = await import("../src/modules/identity/wallet-manager.ts");
  const currentWallets = listWalletAccounts();
  for (const w of currentWallets) {
    const success = setWalletProviderRoute(w.id, "bankr", {
      credentialRef: "env:BANKR_API_KEY",
      proxyId: "proxy_us_la",
      status: "ACTIVE",
    });
    console.log(`  -> Bound wallet '${w.id}' to 'proxy_us_la' on 'bankr': ${success}`);
  }

  console.log("\n✅ Vault Proxy Migration Complete!");
}

syncVault().catch(console.error);
