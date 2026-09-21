/**
 * src/modules/evm/bankr-project.ts
 *
 * Official Bankr Agent Profile & Project Integration Module.
 *
 * Core functionalities:
 *  1. Query operator's agent projects (GET /agent/profile?multi=true)
 *  2. Create new agent projects linked to tokens (POST /agent/profile?multi=true)
 *  3. Update project metadata, teams, products (PUT /agent/profile/:slug)
 *  4. High-level unified linker with multi-proxy and isolated credential support
 */

import axios from "axios";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import {
  getBankrHeaders,
  buildAxiosProxyConfig,
} from "./bankr-deployer.ts";
import { resolveOperationalContext, resolveCredential } from "../identity/wallet-manager.ts";

export interface BankrProfile {
  id: string;
  slug: string;
  projectName: string;
  description?: string;
  approved: boolean;
  isPublished?: boolean;
  tokenAddress?: string;
  tokenChainId?: string;
  tokenSymbol?: string;
  tokenName?: string;
  website?: string;
  twitterUsername?: string;
  profileImageUrl?: string;
  marketCapUsd?: number;
  weeklyRevenueWeth?: number;
  productsCount?: number;
  teamMembers?: Array<{ name: string; role: string; links?: Array<{ type: string; url: string }> }>;
  products?: Array<{ name: string; description?: string; url?: string }>;
  revenueSources?: Array<{ name: string; description?: string }>;
  projectUpdates?: Array<{ content: string; createdAt: string }>;
  createdAt?: string;
}

export interface CreateProfilePayload {
  projectName: string;
  description?: string;
  tokenAddress?: string;
  website?: string;
  profileImageUrl?: string;
  isPublished?: boolean;
  teamMembers?: Array<{ name: string; role: string; links?: Array<{ type: string; url: string }> }>;
  products?: Array<{ name: string; description?: string; url?: string }>;
  revenueSources?: Array<{ name: string; description?: string }>;
}

export interface RequestOptions {
  walletId?: string;
  apiKey?: string;
  proxyUrl?: string;
  timeoutMs?: number;
}

export function resolveContext(options?: RequestOptions) {
  const cfg = getConfig();
  const walletId = options?.walletId ?? "default-operator";
  const opCtx = resolveOperationalContext(walletId, "bankr");
  const resolvedKey = opCtx.credentialRef ? resolveCredential(opCtx.credentialRef) : undefined;
  const apiKey = options?.apiKey ?? resolvedKey ?? cfg.BANKR_API_KEY;
  const proxyUrl = options?.proxyUrl ?? opCtx.proxyUrl ?? undefined;
  const timeout = options?.timeoutMs ?? Math.min(cfg.API_TIMEOUT_MS ?? 15000, 10000);

  if (!apiKey) {
    throw new Error("BANKR_API_KEY tidak ditemukan di environment atau database vault.");
  }

  const headers = getBankrHeaders(apiKey);
  const proxy = buildAxiosProxyConfig(proxyUrl);

  return { apiKey, proxyUrl, headers, proxy, timeout };
}

/**
 * Mengambil seluruh profil proyek milik akun operator di Bankr.
 */
export async function getBankrProfiles(options?: RequestOptions): Promise<BankrProfile[]> {
  const ctx = resolveContext(options);
  const url = "https://api.bankr.bot/agent/profile?multi=true";

  const response = await axios.get(url, {
    headers: ctx.headers,
    proxy: ctx.proxy,
    timeout: ctx.timeout,
    validateStatus: (s) => s === 200 || s === 404,
  });

  if (response.status === 404 || !response.data) {
    return [];
  }

  return Array.isArray(response.data) ? response.data : [response.data];
}

/**
 * Membuat profil proyek baru di Bankr dan menautkan token address.
 */
export async function createBankrProfile(
  payload: CreateProfilePayload,
  options?: RequestOptions
): Promise<BankrProfile> {
  const ctx = resolveContext(options);
  const url = "https://api.bankr.bot/agent/profile?multi=true";

  const response = await axios.post(url, payload, {
    headers: ctx.headers,
    proxy: ctx.proxy,
    timeout: ctx.timeout,
  });

  return response.data;
}

/**
 * Memperbarui profil proyek yang ada di Bankr berdasarkan slug.
 */
export async function updateBankrProfile(
  slug: string,
  payload: Partial<CreateProfilePayload>,
  options?: RequestOptions
): Promise<BankrProfile> {
  const ctx = resolveContext(options);
  const url = `https://api.bankr.bot/agent/profile/${encodeURIComponent(slug)}`;

  const response = await axios.put(url, payload, {
    headers: ctx.headers,
    proxy: ctx.proxy,
    timeout: ctx.timeout,
  });

  return response.data;
}

export interface LinkProjectOptions {
  description?: string;
  website?: string;
  profileImageUrl?: string;
  isPublished?: boolean;
  teamMembers?: Array<{ name: string; role: string; links?: Array<{ type: string; url: string }> }>;
  products?: Array<{ name: string; description?: string; url?: string }>;
  revenueSources?: Array<{ name: string; description?: string }>;
  requestOptions?: RequestOptions;
  ticker?: string;
}

/**
 * Helper terpadu: Menautkan token ke proyek Bankr lengkap dengan Tim & Produk.
 * Jika proyek belum ada, otomatis membuat proyek baru.
 * Jika proyek sudah ada, memperbarui tautan token dan kelengkapan profil pada proyek yang ada.
 */
export async function linkTokenToBankrProject(
  tokenAddress: string,
  projectName: string,
  options?: LinkProjectOptions
): Promise<{ profile: BankrProfile; action: "created" | "updated" }> {
  const existingProfiles = await getBankrProfiles(options?.requestOptions);

  if (existingProfiles.length > 0) {
    const primary = existingProfiles.find(
      (p) =>
        p.tokenAddress?.toLowerCase() === tokenAddress.toLowerCase() ||
        p.projectName.toLowerCase() === projectName.toLowerCase()
    ) || existingProfiles[0];

    logger.info(`🔄 [BANKR PROJECT] Memperbarui proyek yang sudah ada: "${primary.projectName}" (${primary.slug})...`);

    const updatePayload: Partial<CreateProfilePayload> = {
      tokenAddress,
    };
    if (options?.description) updatePayload.description = options.description;
    if (options?.website) updatePayload.website = options.website;
    if (options?.profileImageUrl) updatePayload.profileImageUrl = options.profileImageUrl;
    if (options?.isPublished !== undefined) updatePayload.isPublished = options.isPublished;
    if (options?.teamMembers) updatePayload.teamMembers = options.teamMembers;
    if (options?.products) updatePayload.products = options.products;
    if (options?.revenueSources) updatePayload.revenueSources = options.revenueSources;

    const updated = await updateBankrProfile(primary.slug, updatePayload, options?.requestOptions);
    return { profile: updated, action: "updated" };
  }

  logger.info(`✨ [BANKR PROJECT] Membuat proyek baru di Bankr: "${projectName}"...`);
  const createPayload: CreateProfilePayload = {
    projectName,
    tokenAddress,
    description: options?.description,
    website: options?.website,
    profileImageUrl: options?.profileImageUrl,
    isPublished: options?.isPublished ?? true,
    teamMembers: options?.teamMembers,
    products: options?.products,
    revenueSources: options?.revenueSources,
  };

  const created = await createBankrProfile(createPayload, options?.requestOptions);
  return { profile: created, action: "created" };
}
