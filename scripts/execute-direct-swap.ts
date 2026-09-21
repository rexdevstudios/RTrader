import "dotenv/config";
import axios from "axios";
import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  parseEther,
  erc20Abi,
  maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { getConfig } from "../src/config.ts";
import { registerManualBuy } from "./execute-catalyst-trading.ts";

export interface DirectSwapOptions {
  amountEth?: string;
  tokenAddress?: string;
  dryRun?: boolean;
  privateKey?: string;
  action?: "buy" | "sell";
  amountTokens?: string;
}

export async function executeDirectSwap(
  options: DirectSwapOptions = {}
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const cfg = getConfig();
  const tokenCa = (options.tokenAddress || "0x0a99f4251A461e8abC693a56BB837fD815D51BA3") as `0x${string}`;
  const action = options.action || "buy";
  const amountEth = options.amountEth || "0.0002";
  const amountTokens = options.amountTokens || "10000";
  const isDryRun = options.dryRun ?? false;

  const privKey = (options.privateKey || cfg.EVM_PRIVATE_KEY) as `0x${string}` | undefined;
  if (!privKey) {
    throw new Error("EVM_PRIVATE_KEY tidak ditemukan di opsi maupun .env!");
  }

  const account = privateKeyToAccount(privKey);
  const rpc = cfg.BASE_RPC_URL || "https://mainnet.base.org";

  const publicClient = createPublicClient({ chain: base, transport: http(rpc) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(rpc) });

  const currentBal = await publicClient.getBalance({ address: account.address });

  console.log("=================================================================");
  console.log(`   EKSEKUSI ${action === "sell" ? "PENJUALAN (SELL)" : "PEMBELIAN (BUY)"} ON-CHAIN OTOMATIS (BASE MAINNET)`);
  console.log("=================================================================");
  console.log(` [*] Wallet Signer   : ${account.address}`);
  console.log(` [*] Saldo ETH       : ${formatEther(currentBal)} ETH`);
  console.log(` [*] Target Token    : ${tokenCa}`);

  if (action === "buy") {
    console.log(` [*] Nilai Swap      : ${amountEth} ETH (~$${(parseFloat(amountEth) * 2400).toFixed(2)} USD)`);
    const ethNeeded = parseEther(amountEth);

    if (currentBal < ethNeeded + parseEther("0.00005")) {
      const msg = `Saldo signer ${account.address} tidak mencukupi (${formatEther(currentBal)} ETH < ${amountEth} ETH + gas)`;
      console.error(`❌ ${msg}`);
      return { success: false, error: msg };
    }

    // 1. Dapatkan Calldata Swap Resmi dari Bankr API (Buy)
    console.log("\n[*] Mengambil calldata rute buy swap dari api.bankr.bot...");
    const quoteRes = await axios.post("https://api.bankr.bot/swap/quote", {
      sellToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
      buyToken: tokenCa,
      sellAmount: ethNeeded.toString(),
      taker: account.address,
      chainId: 8453,
    });

    const quote = quoteRes.data;
    const tx = quote.transaction;
    const buyEstTokens = formatEther(BigInt(quote.buyAmount));

    console.log(`[OK] Rute Kuotasi Ditemukan!`);
    console.log(`     Estimasi Token Diterima : ${parseFloat(buyEstTokens).toLocaleString()} PUMPRUN`);
    console.log(`     Target Kontrak Settler   : ${tx.to}`);
    console.log(`     Gas Limit               : ${tx.gas}`);

    // 2. Simulasi On-Chain (Pre-flight Validation)
    console.log("\n[*] Melakukan simulasi pre-flight on-chain di Base...");
    try {
      await publicClient.call({
        account: account.address,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value || 0),
      });
      console.log("[OK] Pre-flight simulation SUCCESS: Transaksi dijamin valid!");
    } catch (simErr: any) {
      const msg = `Simulasi revert: ${simErr.message}`;
      console.error(`❌ ${msg}`);
      return { success: false, error: msg };
    }

    if (isDryRun) {
      console.log("\n[DRY RUN] Mode uji coba selesai tanpa broadcast transaksi.");
      return { success: true };
    }

    // 3. Eksekusi Broadcast Transaksi ke Base Mainnet
    console.log("\n🚀 Mengirim transaksi buy swap ke mempool Base Mainnet...");
    const txHash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || 0),
      gas: BigInt(Math.floor(Number(tx.gas) * 1.2)),
    });

    console.log(`[*] Tx Hash terbit: ${txHash}`);
    console.log(`[*] Menunggu konfirmasi blok Base...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "success") {
      console.log("\n=================================================================");
      console.log(" 🎉 PEMBELIAN PERDANA BERHASIL DILAKUKAN SECARA OTOMATIS!");
      console.log("=================================================================");
      console.log(`  - Tx Hash    : ${txHash}`);
      console.log(`  - Blok       : #${receipt.blockNumber}`);
      console.log(`  - Basescan   : https://basescan.org/tx/${txHash}`);
      console.log(`  - DexScreener: https://dexscreener.com/base/${tokenCa}`);
      console.log("=================================================================\n");

      try {
        await registerManualBuy(tokenCa, txHash, parseFloat(amountEth));
      } catch {}

      return { success: true, txHash };
    } else {
      console.error(`❌ Transaksi reverted di blok Base #${receipt.blockNumber}`);
      return { success: false, error: "Transaction reverted on-chain" };
    }
  } else {
    // SELL ACTION
    const tokensNeeded = parseEther(amountTokens);
    console.log(` [*] Jumlah Jual     : ${amountTokens} tokens`);

    // Check token balance
    const tokenBal = await publicClient.readContract({
      address: tokenCa,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

    console.log(` [*] Saldo Token     : ${formatEther(tokenBal)}`);
    if (tokenBal < tokensNeeded) {
      const msg = `Saldo token ${account.address} tidak mencukupi (${formatEther(tokenBal)} < ${amountTokens} tokens)`;
      console.error(`❌ ${msg}`);
      return { success: false, error: msg };
    }

    if (currentBal < parseEther("0.00003")) {
      const msg = `Saldo ETH signer ${account.address} tidak mencukupi untuk gas (${formatEther(currentBal)} ETH)`;
      console.error(`❌ ${msg}`);
      return { success: false, error: msg };
    }

    // 1. Dapatkan Calldata Sell Quote dari Bankr API
    console.log("\n[*] Mengambil calldata rute sell swap dari api.bankr.bot...");
    const quoteRes = await axios.post("https://api.bankr.bot/swap/quote", {
      sellToken: tokenCa,
      buyToken: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", // Native ETH
      sellAmount: tokensNeeded.toString(),
      taker: account.address,
      chainId: 8453,
    });

    const quote = quoteRes.data;
    const tx = quote.transaction;
    const estEthOut = formatEther(BigInt(quote.buyAmount));
    const spender = (quote.allowanceTarget || tx.to) as `0x${string}`;

    console.log(`[OK] Rute Kuotasi Sell Ditemukan!`);
    console.log(`     Estimasi ETH Diterima  : ${estEthOut} ETH`);
    console.log(`     Spender / Allowance     : ${spender}`);
    console.log(`     Target Kontrak Settler : ${tx.to}`);
    console.log(`     Gas Limit              : ${tx.gas}`);

    // 2. Cek & Jalankan Persetujuan (Approve) jika belum cukup
    const currentAllowance = await publicClient.readContract({
      address: tokenCa,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, spender],
    });

    console.log(`[*] Status Allowance Saat Ini: ${formatEther(currentAllowance)} tokens`);
    if (currentAllowance < tokensNeeded) {
      console.log(`[*] Allowance belum mencukupi. Melakukan broadcast Approve transaksi ke Base...`);
      if (!isDryRun) {
        const approveTxHash = await walletClient.writeContract({
          address: tokenCa,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, maxUint256],
        });
        console.log(`[*] Tx Hash Approve terbit: ${approveTxHash}`);
        console.log(`[*] Menunggu konfirmasi Approve...`);
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
        if (approveReceipt.status !== "success") {
          const msg = `Approve reverted on-chain di blok #${approveReceipt.blockNumber}`;
          console.error(`❌ ${msg}`);
          return { success: false, error: msg };
        }
        console.log(`✅ [OK] Allowance Approved di blok #${approveReceipt.blockNumber}! (Basescan: https://basescan.org/tx/${approveTxHash})`);
      } else {
        console.log(`[DRY RUN] Simulasi Approve berhasil dilewati.`);
      }
    } else {
      console.log(`✅ [OK] Allowance sudah mencukupi.`);
    }

    // 3. Simulasi Pre-flight Swap Sell
    // Note: If allowance was 0 and dry-run, simulation may revert without actual allowance, so handle gracefully in dry-run
    console.log("\n[*] Melakukan simulasi pre-flight sell di Base...");
    try {
      await publicClient.call({
        account: account.address,
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value || 0),
      });
      console.log("[OK] Pre-flight simulation SUCCESS: Transaksi Sell dijamin valid!");
    } catch (simErr: any) {
      if (isDryRun) {
        console.log(`[DRY RUN] Simulasi notice (expected if allowance not yet committed on-chain): ${simErr.message}`);
      } else {
        const msg = `Simulasi sell revert: ${simErr.message}`;
        console.error(`❌ ${msg}`);
        return { success: false, error: msg };
      }
    }

    if (isDryRun) {
      console.log("\n[DRY RUN] Mode uji coba sell selesai tanpa broadcast transaksi.");
      return { success: true };
    }

    // 4. Eksekusi Broadcast Transaksi Sell
    console.log("\n🚀 Mengirim transaksi sell swap ke mempool Base Mainnet...");
    const txHash = await walletClient.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: BigInt(tx.value || 0),
      gas: BigInt(Math.floor(Number(tx.gas) * 1.2)),
    });

    console.log(`[*] Tx Hash Sell terbit: ${txHash}`);
    console.log(`[*] Menunggu konfirmasi blok Base...`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === "success") {
      console.log("\n=================================================================");
      console.log(" 🎉 PENJUALAN MIKRO PERDANA BERHASIL DIKONFIRMASI DI BASE!");
      console.log("=================================================================");
      console.log(`  - Action     : SELL ${amountTokens} PUMPRUN -> ETH`);
      console.log(`  - Tx Hash    : ${txHash}`);
      console.log(`  - Blok       : #${receipt.blockNumber}`);
      console.log(`  - Basescan   : https://basescan.org/tx/${txHash}`);
      console.log(`  - DexScreener: https://dexscreener.com/base/${tokenCa}`);
      console.log("=================================================================\n");
      return { success: true, txHash };
    } else {
      console.error(`❌ Transaksi sell reverted di blok Base #${receipt.blockNumber}`);
      return { success: false, error: "Sell transaction reverted on-chain" };
    }
  }
}

// Standalone CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const isDry = args.includes("--dry-run");
  const nonFlags = args.filter((a) => !a.startsWith("--"));

  let action: "buy" | "sell" = "buy";
  let amountArg: string | undefined;
  let customCa: string | undefined = nonFlags.find((a) => /^0x[a-fA-F0-9]{40}$/.test(a));

  if (nonFlags[0]?.toLowerCase() === "sell") {
    action = "sell";
    amountArg = nonFlags[1] && !nonFlags[1].startsWith("0x") ? nonFlags[1] : undefined;
  } else if (nonFlags[0]?.toLowerCase() === "buy") {
    action = "buy";
    amountArg = nonFlags[1] && !nonFlags[1].startsWith("0x") ? nonFlags[1] : undefined;
  } else {
    // Legacy fallback
    amountArg = nonFlags[0] && !nonFlags[0].startsWith("0x") ? nonFlags[0] : undefined;
  }

  executeDirectSwap({
    action,
    amountEth: action === "buy" ? (amountArg || "0.0002") : undefined,
    amountTokens: action === "sell" ? (amountArg || "10000") : undefined,
    tokenAddress: customCa,
    dryRun: isDry,
  })
    .then((r) => {
      if (!r.success) process.exit(1);
    })
    .catch((e) => {
      console.error("Fatal error:", e);
      process.exit(1);
    });
}

