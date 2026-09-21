/**
 * logger.ts — Logger terpusat dengan timestamp dan level (INFO/WARN/ERROR/SUCCESS).
 * Semua output juga disimpan ke file logs/bot.log.
 */
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "bot.log");

mkdirSync(LOG_DIR, { recursive: true });

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: string, color: string, ...args: unknown[]): void {
  const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ");
  const line = `[${timestamp()}] [${level}] ${msg}`;
  console.log(`${color}${line}\x1b[0m`);
  try {
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Jika file log gagal ditulis, abaikan (jangan crash bot)
  }
}

export const logger = {
  info: (...args: unknown[]) => write("INFO   ", "\x1b[36m", ...args),
  warn: (...args: unknown[]) => write("WARN   ", "\x1b[33m", ...args),
  error: (...args: unknown[]) => write("ERROR  ", "\x1b[31m", ...args),
  success: (...args: unknown[]) => write("SUCCESS", "\x1b[32m", ...args),
  deploy: (...args: unknown[]) => write("DEPLOY ", "\x1b[35m", ...args),
};
