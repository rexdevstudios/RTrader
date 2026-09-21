/**
 * scripts/setup-service-daemon.ts
 *
 * Resilient Background Service Daemon Provisioner (Windows Task Scheduler & Linux Systemd).
 *
 * Capabilities:
 *   1. Windows: Registers persistent background tasks via PowerShell / Task Scheduler (schtasks.exe).
 *   2. Linux/VPS: Generates standard systemd service unit files with auto-restart on failure.
 *   3. Supports: Webhook Daemon, Flywheel Harvester Worker, and Master Autopilot.
 *
 * Usage:
 *   bun run scripts/setup-service-daemon.ts --service=webhook --action=install
 *   bun run scripts/setup-service-daemon.ts --service=flywheel --action=install
 *   bun run scripts/setup-service-daemon.ts --action=status
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { logger } from "../src/logger.ts";

const CWD = process.cwd();
const LOGS_DIR = path.join(CWD, "logs");

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  scriptPath: string;
  batPath: string;
  logFile: string;
}

export const SERVICES: Record<string, ServiceDefinition> = {
  webhook: {
    id: "OmnichainWebhookDaemon",
    name: "Omnichain Fast-Track Webhook Daemon",
    description: "24/7 DexScreener Fast-Track Payment Webhook Listener on port 3001",
    scriptPath: "scripts/run-webhook-daemon.ts",
    batPath: "WEBHOOK_DAEMON.bat",
    logFile: path.join(LOGS_DIR, "webhook-daemon.log"),
  },
  flywheel: {
    id: "OmnichainFlywheelWorker",
    name: "Omnichain Flywheel Harvester Daemon",
    description: "24/7 Perpetual WETH Flywheel Fee Harvester & Revenue Recycler",
    scriptPath: "scripts/run-flywheel-worker.ts",
    batPath: "START_FLYWHEEL_WORKER.bat",
    logFile: path.join(LOGS_DIR, "flywheel-worker.log"),
  },
};

/**
 * Generates Linux systemd unit content.
 */
export function generateSystemdUnit(service: ServiceDefinition): string {
  let bunPath = "/usr/local/bin/bun";
  if (process.platform !== "win32") {
    try {
      bunPath = execSync("which bun").toString().trim();
    } catch {
      bunPath = "/usr/local/bin/bun";
    }
  }
  return `[Unit]
Description=${service.description}
After=network.target

[Service]
Type=simple
User=${process.env.USER || "root"}
WorkingDirectory=${CWD}
ExecStart=${bunPath} run ${service.scriptPath}
Restart=always
RestartSec=10
StandardOutput=append:${service.logFile}
StandardError=append:${service.logFile}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Generates Windows schtasks registration command.
 */
export function getWindowsTaskCommand(service: ServiceDefinition): {
  installCmd: string;
  uninstallCmd: string;
  statusCmd: string;
} {
  const batFullPath = path.join(CWD, service.batPath);
  return {
    installCmd: `schtasks /create /tn "${service.id}" /tr "cmd.exe /c \\"${batFullPath}\\"" /sc onlogon /rl highest /f`,
    uninstallCmd: `schtasks /delete /tn "${service.id}" /f`,
    statusCmd: `schtasks /query /tn "${service.id}"`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const serviceKey = args.find((a) => a.startsWith("--service="))?.split("=")[1] || "webhook";
  const action = args.find((a) => a.startsWith("--action="))?.split("=")[1] || "status";
  const isWindows = process.platform === "win32";

  const targetService = SERVICES[serviceKey] || SERVICES.webhook;

  console.log(`\n===============================================================================`);
  console.log(`  [+] OMNICHAIN SERVICE DAEMON SETUP (${targetService.name}) [+]`);
  console.log(`===============================================================================\n`);

  if (action === "install") {
    if (isWindows) {
      const cmds = getWindowsTaskCommand(targetService);
      console.log(`Platform: Windows (Task Scheduler & Startup Manager)`);
      console.log(`Mencoba registrasi: ${cmds.installCmd}\n`);
      let registered = false;
      try {
        execSync(cmds.installCmd, { stdio: "pipe" });
        logger.success(`✅ Service ${targetService.id} berhasil didaftarkan ke Windows Task Scheduler!`);
        registered = true;
      } catch (err: any) {
        logger.warn(`⚠️ Task Scheduler (elevated) dibatasi tanpa hak Admin. Mengaktifkan User Startup Manager...`);
      }

      const startupDir = process.env.APPDATA
        ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
        : null;
      if (startupDir && fs.existsSync(startupDir)) {
        const startupBat = path.join(startupDir, `${targetService.id}.bat`);
        const batFullPath = path.join(CWD, targetService.batPath);
        fs.writeFileSync(startupBat, `@echo off\nstart /min "" cmd.exe /c "${batFullPath}"\n`, "utf-8");
        logger.success(`✅ Service ${targetService.id} aktif di Windows User Startup Folder (Auto-start saat login):`);
        console.log(`   Lokasi: ${startupBat}`);
        registered = true;
      }

      if (!registered) {
        console.log(`Jalankan terminal sebagai Administrator untuk mendaftarkan task scheduler.`);
      }
    } else {
      const unitContent = generateSystemdUnit(targetService);
      const unitFile = `/etc/systemd/system/${targetService.id.toLowerCase()}.service`;
      console.log(`Platform: Linux (systemd)`);
      console.log(`Menulis unit file ke: ${unitFile}\n`);
      try {
        fs.writeFileSync(`/tmp/${targetService.id.toLowerCase()}.service`, unitContent);
        console.log(`File siap. Jalankan dengan sudo:`);
        console.log(`  sudo mv /tmp/${targetService.id.toLowerCase()}.service ${unitFile}`);
        console.log(`  sudo systemctl daemon-reload`);
        console.log(`  sudo systemctl enable --now ${targetService.id.toLowerCase()}`);
      } catch (err: any) {
        console.log(unitContent);
      }
    }
  } else if (action === "uninstall") {
    if (isWindows) {
      const cmds = getWindowsTaskCommand(targetService);
      try {
        execSync(cmds.uninstallCmd, { stdio: "pipe" });
        logger.success(`✅ Service ${targetService.id} berhasil dicopot dari Windows Task Scheduler!`);
      } catch (err: any) {
        // Not registered in task scheduler
      }

      const startupDir = process.env.APPDATA
        ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
        : null;
      if (startupDir) {
        const startupBat = path.join(startupDir, `${targetService.id}.bat`);
        if (fs.existsSync(startupBat)) {
          fs.unlinkSync(startupBat);
          logger.success(`✅ Service ${targetService.id} berhasil dicopot dari Windows User Startup Folder!`);
        }
      }
    } else {
      console.log(`Jalankan pada terminal Linux:`);
      console.log(`  sudo systemctl disable --now ${targetService.id.toLowerCase()}`);
      console.log(`  sudo rm /etc/systemd/system/${targetService.id.toLowerCase()}.service`);
    }
  } else {
    // Status check
    console.log(`Service ID:   ${targetService.id}`);
    console.log(`Deskripsi:    ${targetService.description}`);
    console.log(`Script:       ${targetService.scriptPath}`);
    console.log(`Log File:     ${targetService.logFile}`);

    if (isWindows) {
      const startupDir = process.env.APPDATA
        ? path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
        : null;
      const startupBat = startupDir ? path.join(startupDir, `${targetService.id}.bat`) : null;
      const isStartupInstalled = startupBat && fs.existsSync(startupBat);
      console.log(`User Startup: ${isStartupInstalled ? "✅ Aktif (" + startupBat + ")" : "❌ Belum Terpasang"}`);
    }

    console.log(`\nPerintah Tersedia:`);
    console.log(`  bun run scripts/setup-service-daemon.ts --service=${serviceKey} --action=install`);
    console.log(`  bun run scripts/setup-service-daemon.ts --service=${serviceKey} --action=uninstall`);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
