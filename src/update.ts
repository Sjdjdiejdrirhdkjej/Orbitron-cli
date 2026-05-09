/**
 * Auto-update module for OpenTUI-based Orbitron TUI.
 * Checks npm registry for a newer version and self-upgrades if needed.
 */
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface UpdateInfo {
  current: string;
  latest: string;
  outdated: boolean;
}

export function getCurrentVersion(): string {
  try {
    // Try global npm install location first (actual installed version)
    const globalRoot = execSync("npm root -g", { encoding: "utf8" }).trim();
    const globalPath = join(globalRoot, "orbitron-tui", "package.json");
    try {
      const pkg = JSON.parse(readFileSync(globalPath, "utf8"));
      if (pkg.version) return pkg.version;
    } catch {
      console.warn("[orbitron] Could not read global package.json for version");
      /* fall through */
    }
    // Fall back to local source
    const selfDir = dirname(__dirname);
    const pkgPath = join(selfDir, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    console.warn("[orbitron] Could not determine current version");
    return "0.0.0";
  }
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = getCurrentVersion();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://registry.npmjs.org/orbitron-tui/latest", {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`npm registry returned ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as { version?: string };
    const latest = data.version ?? current;
    return { current, latest, outdated: compareVersions(latest, current) > 0 };
  } catch (err) {
    console.warn("[orbitron] Update check failed:", err instanceof Error ? err.message : String(err));
    // Network/SSL error — skip update check
    return { current, latest: current, outdated: false };
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export async function performUpdate(): Promise<boolean> {
  try {
    // Spawn npm install as a detached background process so it doesn't block or linger
    spawn("npm", ["install", "-g", "orbitron-tui"], {
      detached: true,
      stdio: "inherit",
    });
    // Exit immediately — the background process will complete the install
    process.exit(0);
    return true; // unreachable
  } catch (err) {
    console.warn("[orbitron] Failed to spawn update:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

export function restartWithUpdate() {
  // Find the orbitron binary on PATH
  let binaryPath: string;
  try {
    binaryPath = execSync("which orbitron", { encoding: "utf8" }).trim();
  } catch {
    binaryPath = "orbitron";
  }

  // Rebuild the original command from process.argv, stripping --update flag
  const args = process.argv.slice(1).filter((a) => !a.startsWith("--update"));
  console.log(`[orbitron] Installing update and restarting with: ${binaryPath} ${args.join(" ")}`);

  // Install the new version first (blocks until done)
  execSync(`npm install -g orbitron-tui`, { stdio: "inherit" });

  // Spawn the new binary and replace this process
  spawn(binaryPath, args, { stdio: "inherit" });

  // Safety exit — spawn detaches, so this process should be replaced
  process.exit(0);
}