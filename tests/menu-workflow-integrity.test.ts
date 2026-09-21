/**
 * tests/menu-workflow-integrity.test.ts
 *
 * Automated regression test verifying that MENU_UTAMA.bat is syntactically sound,
 * all target batch scripts and TypeScript files exist, all goto labels resolve,
 * and no hardcoded balance strings remain.
 */

import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

describe("MENU_UTAMA.bat Workflow & Toolchain Integrity Suite", () => {
  const rootDir = resolve(__dirname, "..");
  const menuBatPath = resolve(rootDir, "MENU_UTAMA.bat");

  it("1. should find MENU_UTAMA.bat on disk", () => {
    expect(existsSync(menuBatPath)).toBe(true);
  });

  it("2. should not contain hardcoded snapshot balance strings", () => {
    const content = readFileSync(menuBatPath, "utf-8");
    // Verify stale static balance labels are eliminated
    expect(content).not.toContain("$7.79");
    expect(content).not.toContain("0.0280 SOL");
  });

  it("3. should verify all referenced .bat files exist in the repository root", () => {
    const content = readFileSync(menuBatPath, "utf-8");
    // Match patterns like 'call SOMETHING.bat'
    const batMatches = content.match(/call\s+([A-Za-z0-9_\-]+\.bat)/gi) || [];
    expect(batMatches.length).toBeGreaterThan(10);

    const checked = new Set<string>();
    for (const match of batMatches) {
      const batFilename = match.replace(/^call\s+/i, "").trim();
      if (!checked.has(batFilename)) {
        checked.add(batFilename);
        const fullBatPath = resolve(rootDir, batFilename);
        expect(existsSync(fullBatPath)).toBe(true);
      }
    }

    // Explicit check for newly wired batch files
    expect(checked.has("RECONCILE_FLEET.bat")).toBe(true);
    expect(checked.has("REHEARSE_DEPLOYMENT.bat")).toBe(true);
    expect(checked.has("DEPLOY_1_TOKEN_BASE.bat")).toBe(true);
  });

  it("4. should verify all referenced TypeScript scripts exist on disk", () => {
    const content = readFileSync(menuBatPath, "utf-8");
    // Match patterns like 'call bun run scripts/something.ts' or 'scripts/something.ts'
    const tsMatches = content.match(/scripts\/[A-Za-z0-9_\-]+\.ts/g) || [];
    expect(tsMatches.length).toBeGreaterThan(3);

    for (const relPath of tsMatches) {
      const fullTsPath = resolve(rootDir, relPath);
      expect(existsSync(fullTsPath)).toBe(true);
    }
  });

  it("5. should verify that every goto target in MENU_UTAMA.bat has a corresponding label", () => {
    const content = readFileSync(menuBatPath, "utf-8");
    const lines = content.split(/\r?\n/);

    // Extract all defined labels: lines starting with :label (excluding comments ::)
    const definedLabels = new Set<string>();
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith(":") && !trimmed.startsWith("::")) {
        const labelName = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
        if (labelName) {
          definedLabels.add(labelName);
        }
      }
    }

    // Extract all goto targets: 'goto target'
    const gotoMatches = content.match(/goto\s+([A-Za-z0-9_\-]+)/gi) || [];
    for (const gm of gotoMatches) {
      const target = gm.replace(/^goto\s+/i, "").trim().toLowerCase();
      expect(definedLabels.has(target)).toBe(true);
    }
  });

  it("6. should verify all menu options 1 through 25 and exit aliases are routed", () => {
    const content = readFileSync(menuBatPath, "utf-8");

    for (let i = 1; i <= 25; i++) {
      expect(content).toContain(`if "%pilihan%"=="${i}" goto`);
    }

    // Exit shortcuts
    expect(content).toContain('if /i "%pilihan%"=="q" goto keluar');
    expect(content).toContain('if /i "%pilihan%"=="x" goto keluar');
    expect(content).toContain('if /i "%pilihan%"=="exit" goto keluar');
  });

  it("7. should verify single base deploy delegates to DEPLOY_1_TOKEN_BASE.bat for multi-wallet selection", () => {
    const content = readFileSync(menuBatPath, "utf-8");
    const singleDeployBlock = content.split(":single_deploy")[1]?.split(":solana_deploy")[0];
    expect(singleDeployBlock).toBeDefined();
    expect(singleDeployBlock).toContain("call DEPLOY_1_TOKEN_BASE.bat");
  });
});
