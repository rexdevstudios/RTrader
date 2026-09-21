/**
 * src/modules/growth/cloudflare-dns.ts
 *
 * Automated Cloudflare DNS API v4 Provisioner.
 *
 * Programmatically provisions custom subdomain CNAME records (e.g. token.domain.xyz -> cname.vercel-dns.com)
 * for newly generated Web3 websites directly from the CLI or automated pipelines.
 *
 * Gracefully falls back to manual DNS guidance if Cloudflare credentials are not provided.
 */

import axios from "axios";
import { logger } from "../../logger.ts";
import { updateDeployLogWebsite } from "../../db/vault.ts";

export interface CloudflareDnsOptions {
  ticker: string;
  contractAddress?: string;
  rootDomain?: string;
  subdomain?: string;
  apiToken?: string;
  zoneId?: string;
  targetHosting?: "vercel" | "cloudflare_pages";
  targetCname?: string;
  proxied?: boolean;
}

export interface CloudflareDnsResult {
  success: boolean;
  action: "CREATED" | "ALREADY_EXISTS" | "CONFIG_MISSING" | "API_ERROR";
  fullDomain: string;
  subdomain: string;
  rootDomain: string;
  targetCname: string;
  recordId?: string;
  domainBindingStatus?: string;
  message: string;
  manualGuide?: string;
}

/**
 * Generates formatted manual DNS configuration instructions.
 */
export function getManualDnsInstructions(subdomain: string, rootDomain: string, targetCname = "cname.vercel-dns.com"): string {
  const fullDomain = `${subdomain}.${rootDomain}`;
  return [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🌐 PANDUAN PENGATURAN DNS CUSTOM DOMAIN (${fullDomain})`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Tambahkan record berikut di dashboard DNS provider Anda (Cloudflare / Namecheap / dll):`,
    ``,
    `1. CNAME Record:`,
    `   - Type:    CNAME`,
    `   - Name:    ${subdomain}`,
    `   - Target:  ${targetCname}`,
    `   - TTL:     Auto / 1 (DNS Only / Gray Cloud di Cloudflare jika hosting di Vercel)`,
    ``,
    `2. Root A Record (Jika menggunakan apex domain @):`,
    `   - Type:    A`,
    `   - Name:    @`,
    `   - Target:  76.76.21.21 (Vercel Global Anycast)`,
    ``,
    `3. Daftarkan domain ke penyedia hosting:`,
    `   - Jika Vercel: npx vercel domains add ${fullDomain}`,
    `   - Jika Cloudflare Pages: Otomatis terikat pada project ${subdomain}-web3`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join("\n");
}

/**
 * Provisions a CNAME subdomain record on Cloudflare pointing to Vercel or Cloudflare Pages.
 */
export async function provisionSubdomainDns(
  options: CloudflareDnsOptions
): Promise<CloudflareDnsResult> {
  const cleanTicker = options.ticker.replace(/^\$/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const rootDomain = (options.rootDomain || process.env.ROOT_DOMAIN || "mytoken.xyz").trim();
  const subdomain = (options.subdomain || cleanTicker).trim();
  const fullDomain = `${subdomain}.${rootDomain}`;
  const isCfPages = options.targetHosting === "cloudflare_pages";
  const targetCname = options.targetCname || (isCfPages ? `${cleanTicker}-web3.pages.dev` : "cname.vercel-dns.com");
  const proxied = options.proxied ?? (isCfPages ? true : false);

  const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = options.zoneId || process.env.CLOUDFLARE_ZONE_ID;

  // 1. Check if Cloudflare credentials are configured
  if (!apiToken || !zoneId) {
    const guide = getManualDnsInstructions(subdomain, rootDomain, targetCname);
    return {
      success: false,
      action: "CONFIG_MISSING",
      fullDomain,
      subdomain,
      rootDomain,
      targetCname,
      message: "Kredensial Cloudflare (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID) belum diset.",
      manualGuide: guide,
    };
  }

  try {
    const client = axios.create({
      baseURL: `https://api.cloudflare.com/client/v4/zones/${zoneId}`,
      headers: {
        Authorization: `Bearer ${apiToken.trim()}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    // 2. Check if CNAME record already exists
    const searchRes = await client.get(`/dns_records`, {
      params: {
        name: fullDomain,
        type: "CNAME",
      },
    });

    const existingRecords = searchRes.data?.result || [];
    if (existingRecords.length > 0) {
      const existing = existingRecords[0];
      logger.info(`[CloudflareDNS] Record CNAME untuk ${fullDomain} sudah ada (ID: ${existing.id}).`);

      if (options.contractAddress) {
        updateDeployLogWebsite(options.contractAddress, `https://${fullDomain}`);
      }

      // Otomatis ikat domain ke Cloudflare Pages atau Vercel jika relevan
      let bindingStatus: string | undefined;
      if (isCfPages) {
        const pagesRes = await bindCustomDomainToPages({
          projectName: `${cleanTicker}-web3`,
          domain: fullDomain,
          apiToken,
          accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        });
        bindingStatus = pagesRes.status;
      } else if (options.targetHosting === "vercel") {
        const vercelRes = await bindCustomDomainToVercel({ domain: fullDomain });
        bindingStatus = vercelRes.status;
      }

      return {
        success: true,
        action: "ALREADY_EXISTS",
        fullDomain,
        subdomain,
        rootDomain,
        targetCname,
        recordId: existing.id,
        domainBindingStatus: bindingStatus,
        message: `Subdomain ${fullDomain} sudah aktif di Cloudflare DNS.`,
      };
    }

    // 3. Create new CNAME DNS record
    const createRes = await client.post(`/dns_records`, {
      type: "CNAME",
      name: subdomain,
      content: targetCname,
      ttl: 1, // Automatic TTL
      proxied: proxied,
      comment: `Omnichain Web3 Token Landing Page ($${options.ticker.toUpperCase()})`,
    });

    const createdRecord = createRes.data?.result;
    logger.success(`[CloudflareDNS] Berhasil membuat CNAME record: ${fullDomain} -> ${targetCname}`);

    // 4. Update Database Vault with the new custom domain URL
    if (options.contractAddress) {
      updateDeployLogWebsite(options.contractAddress, `https://${fullDomain}`);
    }

    // 5. Otomatis ikat domain ke Cloudflare Pages atau Vercel
    let bindingStatus: string | undefined;
    if (isCfPages) {
      const pagesRes = await bindCustomDomainToPages({
        projectName: `${cleanTicker}-web3`,
        domain: fullDomain,
        apiToken,
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      });
      bindingStatus = pagesRes.status;
    } else if (options.targetHosting === "vercel") {
      const vercelRes = await bindCustomDomainToVercel({ domain: fullDomain });
      bindingStatus = vercelRes.status;
    }

    return {
      success: true,
      action: "CREATED",
      fullDomain,
      subdomain,
      rootDomain,
      targetCname,
      recordId: createdRecord?.id,
      domainBindingStatus: bindingStatus,
      message: `Subdomain ${fullDomain} berhasil dibuat di Cloudflare DNS!`,
    };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errors?.[0]?.message || err.message;
    logger.warn(`[CloudflareDNS] Gagal membuat DNS record via Cloudflare API: ${errorMsg}`);

    const guide = getManualDnsInstructions(subdomain, rootDomain, targetCname);
    return {
      success: false,
      action: "API_ERROR",
      fullDomain,
      subdomain,
      rootDomain,
      targetCname,
      message: `Cloudflare API error: ${errorMsg}`,
      manualGuide: guide,
    };
  }
}

export interface PagesDomainBindOptions {
  accountId?: string;
  apiToken?: string;
  projectName: string;
  domain: string;
}

export interface PagesDomainBindResult {
  success: boolean;
  domain: string;
  status: "ACTIVE" | "PENDING" | "ALREADY_BOUND" | "ERROR";
  message: string;
}

/**
 * Programmatically binds a custom domain to a Cloudflare Pages project via Cloudflare API v4.
 */
export async function bindCustomDomainToPages(
  options: PagesDomainBindOptions
): Promise<PagesDomainBindResult> {
  const accountId = (options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = (options.apiToken || process.env.CLOUDFLARE_API_TOKEN || "").trim();

  if (!accountId || !apiToken) {
    return {
      success: false,
      domain: options.domain,
      status: "ERROR",
      message: "Kredensial Cloudflare (CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN) belum diset.",
    };
  }

  try {
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${options.projectName.trim()}/domains`;
    const res = await axios.post(
      url,
      { name: options.domain.trim() },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );

    const data = res.data?.result;
    logger.success(`[CloudflarePages] Berhasil mengikat domain ${options.domain} ke project ${options.projectName}`);
    return {
      success: true,
      domain: options.domain,
      status: data?.status === "active" ? "ACTIVE" : "PENDING",
      message: `Domain ${options.domain} berhasil diikat ke Cloudflare Pages project ${options.projectName}!`,
    };
  } catch (err: any) {
    const errCode = err.response?.data?.errors?.[0]?.code;
    const errMsg = err.response?.data?.errors?.[0]?.message || err.message;
    if (errMsg?.toLowerCase().includes("already") || errCode === 8000009 || errCode === 8000010) {
      logger.info(`[CloudflarePages] Domain ${options.domain} sudah terikat pada project ${options.projectName}.`);
      return {
        success: true,
        domain: options.domain,
        status: "ALREADY_BOUND",
        message: `Domain ${options.domain} sudah terikat sebelumnya.`,
      };
    }
    logger.warn(`[CloudflarePages] Gagal mengikat domain via Pages API: ${errMsg}`);
    return {
      success: false,
      domain: options.domain,
      status: "ERROR",
      message: `Cloudflare Pages API error: ${errMsg}`,
    };
  }
}

export interface VercelDomainBindOptions {
  projectId?: string;
  token?: string;
  domain: string;
}

export interface VercelDomainBindResult {
  success: boolean;
  domain: string;
  status: "BOUND" | "ALREADY_BOUND" | "UNCONFIGURED" | "ERROR";
  message: string;
}

/**
 * Programmatically binds a custom domain to a Vercel project via Vercel REST API v9.
 */
export async function bindCustomDomainToVercel(
  options: VercelDomainBindOptions
): Promise<VercelDomainBindResult> {
  const token = (options.token || process.env.VERCEL_TOKEN || "").trim();
  const projectId = (options.projectId || process.env.VERCEL_PROJECT_ID || "").trim();

  if (!token || !projectId) {
    return {
      success: false,
      domain: options.domain,
      status: "UNCONFIGURED",
      message: `VERCEL_TOKEN atau VERCEL_PROJECT_ID belum diset. Jalankan 'npx vercel domains add ${options.domain}' secara manual jika diperlukan.`,
    };
  }

  try {
    const res = await axios.post(
      `https://api.vercel.com/v9/projects/${projectId}/domains`,
      { name: options.domain },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 10000,
      }
    );
    logger.success(`[VercelDomains] Berhasil mengikat domain ${options.domain} ke Vercel project ${projectId}`);
    return {
      success: true,
      domain: options.domain,
      status: "BOUND",
      message: `Domain ${options.domain} berhasil diikat ke Vercel project!`,
    };
  } catch (err: any) {
    const errMsg = err.response?.data?.error?.message || err.message;
    if (errMsg?.toLowerCase().includes("already")) {
      return {
        success: true,
        domain: options.domain,
        status: "ALREADY_BOUND",
        message: `Domain ${options.domain} sudah terikat di Vercel.`,
      };
    }
    logger.warn(`[VercelDomains] Gagal mengikat domain via Vercel API: ${errMsg}`);
    return {
      success: false,
      domain: options.domain,
      status: "ERROR",
      message: `Vercel API error: ${errMsg}`,
    };
  }
}

