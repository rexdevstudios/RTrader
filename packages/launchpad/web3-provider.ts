// ============================================================================
// REUSABLE WEB3 CLIENT PROVIDER & BASE CHAIN ENFORCEMENT
// Aligned with SSOT, AGENTS.md, Rule 6, 7, 8, 9 of Forensic Architecture
// ============================================================================

import { ethers } from 'ethers';
import { BONDING_CURVE_LAUNCHPAD_ABI } from './contracts/BondingCurveLaunchpadAbi';

export interface ChainConfig {
  chainId: number;
  hexChainId: string;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorerUrl: string;
}

export const SUPPORTED_BASE_CHAINS: Record<string, ChainConfig> = {
  BASE_MAINNET: {
    chainId: 8453,
    hexChainId: '0x2105',
    name: 'Base Mainnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
  },
  BASE_SEPOLIA: {
    chainId: 84532,
    hexChainId: '0x14a34',
    name: 'Base Sepolia Testnet',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  ROBINHOOD_MAINNET: {
    chainId: 4663,
    hexChainId: '0x1237',
    name: 'Robinhood Chain L2',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerUrl: 'https://robinhoodchain.blockscout.com',
  },
};

// Known dummy / simulation addresses that MUST NEVER be permitted for live write transactions
const REJECTED_DUMMY_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
]);

export interface ContractConfigStatus {
  isConfigured: boolean;
  status: 'CONFIGURED' | 'BLOCKED_UNVERIFIED' | 'BLOCKED_DUMMY_ADDRESS' | 'BLOCKED_INVALID_ADDRESS';
  contractAddress: string | null;
  message: string;
}

/**
 * Validates configured contract address against Rule 6 hard security constraints.
 * Rejects missing, zero, malformed, or dummy addresses.
 */
export function getContractConfiguration(): ContractConfigStatus {
  const envAddress = process.env.NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ADDRESS?.trim();

  if (!envAddress) {
    return {
      isConfigured: false,
      status: 'BLOCKED_UNVERIFIED',
      contractAddress: null,
      message: 'BLOCKED — Smart contract belum ter-deploy atau NEXT_PUBLIC_LAUNCHPAD_CONTRACT_ADDRESS belum diset.',
    };
  }

  if (REJECTED_DUMMY_ADDRESSES.has(envAddress.toLowerCase())) {
    return {
      isConfigured: false,
      status: 'BLOCKED_DUMMY_ADDRESS',
      contractAddress: null,
      message: 'BLOCKED — Alamat kontrak adalah dummy/mock address (0x111...111). Transaksi on-chain diblokir.',
    };
  }

  if (!ethers.isAddress(envAddress)) {
    return {
      isConfigured: false,
      status: 'BLOCKED_INVALID_ADDRESS',
      contractAddress: null,
      message: 'BLOCKED — Alamat kontrak bukan alamat Ethereum (EVM) yang valid.',
    };
  }

  return {
    isConfigured: true,
    status: 'CONFIGURED',
    contractAddress: ethers.getAddress(envAddress),
    message: 'Alamat smart contract terverifikasi.',
  };
}

/**
 * Returns an ethers BrowserProvider instance connected to window.ethereum.
 */
export function getBrowserProvider(): ethers.BrowserProvider {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    throw new Error('WALLET_NOT_DETECTED: Ekstensi MetaMask atau dompet Web3 EIP-1193 tidak ditemukan.');
  }
  return new ethers.BrowserProvider((window as any).ethereum);
}

/**
 * Returns a signer from the browser wallet.
 */
export async function getBrowserSigner(): Promise<ethers.JsonRpcSigner> {
  const provider = getBrowserProvider();
  return provider.getSigner();
}

/**
 * Reads current chainId from the connected browser wallet.
 */
export async function getCurrentChainId(): Promise<number> {
  const provider = getBrowserProvider();
  const network = await provider.getNetwork();
  return Number(network.chainId);
}

/**
 * Validates and enforces that user is connected to a supported Base network.
 * Prompts user to switch network via wallet_switchEthereumChain if necessary.
 */
export async function ensureBaseNetwork(
  targetHexChainId: string = '0x2105'
): Promise<{ success: boolean; chainId?: number; error?: string }> {
  if (typeof window === 'undefined' || !(window as any).ethereum) {
    return { success: false, error: 'Dompet Web3 tidak terdeteksi.' };
  }

  const ethereum = (window as any).ethereum;
  const targetConfig =
    Object.values(SUPPORTED_BASE_CHAINS).find(
      (c) => c.hexChainId.toLowerCase() === targetHexChainId.toLowerCase()
    ) || SUPPORTED_BASE_CHAINS.BASE_MAINNET;

  try {
    const currentChainHex: string = await ethereum.request({ method: 'eth_chainId' });
    if (currentChainHex && currentChainHex.toLowerCase() === targetHexChainId.toLowerCase()) {
      return { success: true, chainId: targetConfig.chainId };
    }

    // Attempt to switch network
    try {
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetHexChainId }],
      });
      return { success: true, chainId: targetConfig.chainId };
    } catch (switchErr: any) {
      // Error code 4902: Unrecognized chain, needs to be added
      if (switchErr?.code === 4902) {
        await ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: targetConfig.hexChainId,
              chainName: targetConfig.name,
              nativeCurrency: targetConfig.nativeCurrency,
              rpcUrls: [targetConfig.rpcUrl],
              blockExplorerUrls: [targetConfig.explorerUrl],
            },
          ],
        });
        return { success: true, chainId: targetConfig.chainId };
      }

      // User rejected switch
      if (switchErr?.code === 4001) {
        return {
          success: false,
          error: 'USER_REJECTED: Pengguna menolak perpindahan jaringan ke ' + targetConfig.name,
        };
      }

      throw switchErr;
    }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Gagal mengubah jaringan dompet.' };
  }
}

/**
 * Instantiates the BondingCurveLaunchpad contract with a verified deployment address.
 * Throws an explicit error if the contract is not verified or blocked.
 */
export function getLaunchpadContract(
  signerOrProvider: ethers.Signer | ethers.Provider
): ethers.Contract {
  const config = getContractConfiguration();
  if (!config.isConfigured || !config.contractAddress) {
    throw new Error(config.message);
  }
  return new ethers.Contract(config.contractAddress, BONDING_CURVE_LAUNCHPAD_ABI, signerOrProvider);
}

/**
 * Normalizes Web3 and RPC errors into actionable user-facing messages.
 */
export function normalizeWeb3Error(error: any): string {
  if (!error) return 'Terjadi kesalahan transaksi yang tidak diketahui.';

  const msg = typeof error === 'string' ? error : error?.message || error?.reason || '';
  const code = error?.code;

  if (code === 4001 || code === 'ACTION_REJECTED' || msg.includes('user rejected') || msg.includes('User rejected')) {
    return 'Transaksi dibatalkan oleh pengguna di MetaMask.';
  }

  if (msg.includes('insufficient funds') || code === 'INSUFFICIENT_FUNDS') {
    return 'Saldo ETH tidak mencukupi untuk membayar biaya gas atau harga pembelian.';
  }

  if (msg.includes('BLOCKED')) {
    return msg;
  }

  if (msg.includes('INVALID_BOUNTY_PROOF') || msg.includes('INVALID_MERKLE_PROOF')) {
    return 'Verifikasi Merkle Proof gagal: Dompet atau alokasi tidak terdaftar dalam whitelist kampanye.';
  }

  if (msg.includes('FAIR_LAUNCH_BUY_LIMIT_EXCEEDED')) {
    return 'Pembelian melebihi batas alokasi maksimum per-dompet (Fair Launch Anti-Bot Limit).';
  }

  if (msg.includes('Bounty reward already claimed')) {
    return 'Alokasi bounty sudah pernah diklaim sebelumnya oleh dompet ini.';
  }

  if (msg.includes('Ownable: caller is not the owner')) {
    return 'Akses ditolak: Operasi ini membutuhkan otoritas Platform Admin / Contract Owner.';
  }

  if (msg.includes('TIMELOCK_ACTIVE')) {
    return 'Likuiditas masih terkunci on-chain selama periode anti-rugpull 180 hari.';
  }

  return msg.length > 120 ? msg.substring(0, 120) + '...' : msg;
}

/**
 * Generates an explorer link for a transaction hash or address on Base.
 */
export function getExplorerUrl(
  hashOrAddress: string,
  targetChainHex: string = '0x2105',
  type: 'tx' | 'address' = 'tx'
): string {
  const norm = targetChainHex.toLowerCase();
  if (norm.includes('robinhood') || norm === '0x1237' || norm === '4663') {
    return `https://robinhoodchain.blockscout.com/${type}/${hashOrAddress}`;
  }
  const isSepolia = norm === '0x14a34';
  const baseUrl = isSepolia ? 'https://sepolia.basescan.org' : 'https://basescan.org';
  return `${baseUrl}/${type}/${hashOrAddress}`;
}
