import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { uploadFileToR2, syncSiteAssetsToR2 } from "../src/modules/storage/r2-storage-client.ts";

describe("Cloudflare R2 Storage Client Test Suite", () => {
  const tempDir = path.resolve(process.cwd(), "temp-r2-test");

  it("should handle non-existent file gracefully without throwing", async () => {
    const res = await uploadFileToR2({
      localPath: "non/existent/file.svg",
      remoteKey: "test/file.svg",
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain("File lokal tidak ditemukan");
  });

  it("should handle non-existent directory in syncSiteAssetsToR2", async () => {
    const res = await syncSiteAssetsToR2("non/existent/dir", "TEST");
    expect(res.success).toBe(false);
    expect(res.uploadedCount).toBe(0);
  });

  it("should successfully prepare and sync assets for a valid site folder", async () => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const sampleSvg = path.join(tempDir, "card.svg");
    fs.writeFileSync(sampleSvg, "<svg></svg>", "utf-8");

    const res = await syncSiteAssetsToR2(tempDir, "TEST");
    expect(res.success).toBe(true);
    expect(res.uploadedCount).toBeGreaterThanOrEqual(1);

    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }, 30000);
});
