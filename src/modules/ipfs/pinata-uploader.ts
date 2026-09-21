/**
 * pinata-uploader.ts — Upload logo dan metadata token ke IPFS via Pinata.
 *
 * Standar metadata token Web3 (ERC-20 / SPL compatible):
 * {
 *   "name": "TokenName",
 *   "symbol": "TICKR",
 *   "description": "...",
 *   "image": "ipfs://Qm...",
 *   "external_url": "https://...",
 *   "twitter": "https://...",
 *   "telegram": "https://..."
 * }
 */
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import FormData from "form-data";
import { getConfig } from "../../config.ts";
import { logger } from "../../logger.ts";
import type { TokenIdentity } from "../ai/gemini-brain.ts";

const PINATA_BASE = "https://api.pinata.cloud";

interface PinataUploadResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

/**
 * Uploads an arbitrary asset file (SVG banner, PNG logo, etc.) to Pinata IPFS.
 * Returns public IPFS gateway URL, or null if unconfigured/failed.
 */
export async function uploadAssetFileToPinata(
  filePath: string,
  customFilename?: string
): Promise<string | null> {
  const cfg = getConfig();
  if (!cfg.PINATA_JWT || cfg.PINATA_JWT.trim().length === 0 || cfg.PINATA_JWT.startsWith("mock_")) {
    logger.warn(`[IPFS] PINATA_JWT tidak dikonfigurasi atau mock. Menggunakan fallback lokal.`);
    return null;
  }

  if (!fs.existsSync(filePath)) {
    logger.warn(`[IPFS] File aset tidak ditemukan di: ${filePath}`);
    return null;
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const filename = customFilename || path.basename(filePath);
    const contentType = filePath.endsWith(".svg")
      ? "image/svg+xml"
      : filePath.endsWith(".png")
      ? "image/png"
      : filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")
      ? "image/jpeg"
      : filePath.endsWith(".html")
      ? "text/html; charset=utf-8"
      : filePath.endsWith(".css")
      ? "text/css"
      : filePath.endsWith(".js")
      ? "application/javascript"
      : "application/octet-stream";

    const form = new FormData();
    form.append("file", fileBuffer, {
      filename,
      contentType,
    });
    form.append("pinataMetadata", JSON.stringify({ name: filename }));

    const response = await axios.post<PinataUploadResponse>(
      `${PINATA_BASE}/pinning/pinFileToIPFS`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${cfg.PINATA_JWT}`,
        },
        timeout: 30000,
      }
    );

    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`;
    logger.success(`✅ [IPFS] Berhasil upload ${filename} ke IPFS: ${ipfsUrl}`);
    return ipfsUrl;
  } catch (err: any) {
    logger.warn(`⚠️ [IPFS] Gagal mengunggah ${filePath} ke Pinata: ${err?.message || err}`);
    return null;
  }
}

/**
 * Upload file binary (gambar logo) ke Pinata IPFS.
 * Mengembalikan URL IPFS publik.
 */
async function uploadFileToPinata(
  fileBuffer: Buffer,
  filename: string,
  jwt: string
): Promise<string> {
  const form = new FormData();
  form.append("file", fileBuffer, {
    filename,
    contentType: "image/png",
  });
  form.append(
    "pinataMetadata",
    JSON.stringify({ name: filename })
  );

  const response = await axios.post<PinataUploadResponse>(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${jwt}`,
      },
      timeout: 30000,
    }
  );

  return `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`;
}

/**
 * Upload JSON metadata token ke Pinata IPFS.
 */
async function uploadJsonToPinata(
  metadata: Record<string, unknown>,
  name: string,
  jwt: string
): Promise<string> {
  const response = await axios.post<PinataUploadResponse>(
    `${PINATA_BASE}/pinning/pinJSONToIPFS`,
    {
      pinataContent: metadata,
      pinataMetadata: { name: `${name}-metadata.json` },
    },
    {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  return `https://gateway.pinata.cloud/ipfs/${response.data.IpfsHash}`;
}

export interface UploadResult {
  imageUrl: string;
  metadataUrl: string;
  ipfsImageUri: string;
}

/**
 * Pipeline lengkap: upload logo → upload metadata → kembalikan URL.
 */
export async function uploadTokenAssets(
  logoBuffer: Buffer | null,
  identity: TokenIdentity
): Promise<UploadResult | null> {
  const cfg = getConfig();
  logger.info(`📦 Mengupload aset token ${identity.ticker} ke IPFS...`);

  try {
    // Jika tidak ada logo, gunakan placeholder publik
    let imageUrl: string;
    let ipfsImageUri: string;

    if (logoBuffer) {
      imageUrl = await uploadFileToPinata(
        logoBuffer,
        `${identity.ticker.toLowerCase()}-logo.png`,
        cfg.PINATA_JWT
      );
      ipfsImageUri = imageUrl.replace("https://gateway.pinata.cloud/ipfs/", "ipfs://");
      logger.success(`✅ Logo ter-upload: ${imageUrl}`);
    } else {
      // Placeholder logo jika generate gambar gagal
      imageUrl = "https://via.placeholder.com/512x512.png";
      ipfsImageUri = imageUrl;
      logger.warn("⚠️  Menggunakan logo placeholder.");
    }

    // Build metadata JSON (standar ERC-20 & SPL / Pump.fun compliant)
    const metadata = {
      name: identity.name,
      symbol: identity.ticker,
      description: identity.description,
      image: ipfsImageUri,
      showName: true,
      createdOn: "https://pump.fun",
      website: identity.website,
      external_url: identity.website,
      twitter: identity.twitter,
      telegram: identity.telegram,
      attributes: [
        { trait_type: "Chain", value: "Multi-Chain" },
        { trait_type: "Type", value: "Meme Token" },
      ],
    };

    const metadataUrl = await uploadJsonToPinata(
      metadata,
      identity.ticker.toLowerCase(),
      cfg.PINATA_JWT
    );
    logger.success(`✅ Metadata ter-upload: ${metadataUrl}`);

    return { imageUrl, metadataUrl, ipfsImageUri };
  } catch (err) {
    logger.error(`❌ Upload IPFS gagal: ${String(err)}`);
    return null;
  }
}
