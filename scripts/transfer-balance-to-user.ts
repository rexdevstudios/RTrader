import "dotenv/config";
import { createWalletClient, createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getConfig } from "../src/config.ts";

async function main() {
  const args = process.argv.slice(2);
  const toAddress = args[0];
  const amountStr = args[1] || "0.0006";

  if (!toAddress || !/^0x[a-fA-F0-9]{40}$/.test(toAddress.trim())) {
    console.log("Silakan masukkan alamat dompet tujuan EVM yang valid (0x...)!");
    console.log("Contoh: bun run scripts/transfer-balance-to-user.ts 0x1234... 0.0006");
    process.exit(1);
  }

  const dest = toAddress.trim() as `0x${string}`;
  const amount = parseEther(amountStr);

  const cfg = getConfig();
  if (!cfg.EVM_PRIVATE_KEY) {
    console.log("EVM_PRIVATE_KEY tidak ditemukan di .env!");
    process.exit(1);
  }

  const account = privateKeyToAccount(cfg.EVM_PRIVATE_KEY as `0x${string}`);
  const rpc = cfg.BASE_RPC_URL || "https://mainnet.base.org";

  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) });

  const currentBal = await publicClient.getBalance({ address: account.address });
  console.log(`[*] Dompet Pengirim : ${account.address}`);
  console.log(`[*] Saldo Saat Ini  : ${formatEther(currentBal)} ETH`);
  console.log(`[*] Tujuan Transfer : ${dest}`);
  console.log(`[*] Jumlah Transfer : ${amountStr} ETH`);

  if (currentBal < amount + parseEther("0.00005")) {
    console.log(`Saldo tidak mencukupi untuk transfer ${amountStr} ETH + gas!`);
    process.exit(1);
  }

  console.log(`\n🚀 Mengirim ${amountStr} ETH ke ${dest} di jaringan Base...`);
  const txHash = await walletClient.sendTransaction({
    to: dest,
    value: amount,
  });

  console.log(`Tx terkirim! Menunggu konfirmasi: ${txHash}...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status === "success") {
    console.log(`\n✅ TRANSFER BERHASIL!`);
    console.log(`   Tx Hash    : ${txHash}`);
    console.log(`   Block      : #${receipt.blockNumber}`);
    console.log(`   Basescan   : https://basescan.org/tx/${txHash}`);
    console.log(`   Saldo baru telah masuk ke dompet Anda! Sekarang Anda dapat melakukan swap di terminal.`);
  } else {
    console.log("Transaksi reverted di blockchain Base.");
  }
}

main().catch((err) => {
  console.error("Fatal exception:", err);
  process.exit(1);
});
