/**
 * pollinations-gen.ts — Generator gambar logo token GRATIS.
 *
 * Menggunakan Pollinations.ai — layanan AI image generation gratis
 * tanpa API key. Cukup panggil URL dengan prompt dan dapatkan gambar.
 */
import axios from "axios";
import { logger } from "../../logger.ts";

const BASE_URL = "https://image.pollinations.ai/prompt";
const IMAGE_WIDTH = 512;
const IMAGE_HEIGHT = 512;

// Valid 64x64 PNG buffer fallback when external image provider is unavailable
const FALLBACK_PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAPUlEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOwa8AABb0qZ2wAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Generate logo token dan kembalikan sebagai Buffer (binary PNG).
 * Jika gagal, kembalikan fallback valid PNG buffer (jangan crash).
 */
export async function generateTokenLogo(
  imagePrompt: string,
  tokenName: string
): Promise<Buffer> {
  // Tambahkan context kripto ke prompt agar hasilnya lebih relevan
  const fullPrompt = `${imagePrompt}, crypto token logo, minimalist, high quality, white background, centered`;
  const encodedPrompt = encodeURIComponent(fullPrompt);
  const url = `${BASE_URL}/${encodedPrompt}?width=${IMAGE_WIDTH}&height=${IMAGE_HEIGHT}&seed=${Date.now()}&nologo=true`;

  logger.info(`🎨 Generating logo untuk ${tokenName}...`);

  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 30000, // Pollinations bisa lambat, beri waktu 30 detik
    });

    const buffer = Buffer.from(response.data);
    logger.success(`✅ Logo berhasil di-generate (${buffer.length} bytes)`);
    return buffer;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      logger.warn(`⚠️  Pollinations gagal: ${err.message}. Menggunakan logo placeholder.`);
    }
    return FALLBACK_PNG_BUFFER;
  }
}
