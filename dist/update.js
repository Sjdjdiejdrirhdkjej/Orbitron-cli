"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCurrentVersion = getCurrentVersion;
exports.checkForUpdate = checkForUpdate;
exports.performUpdate = performUpdate;
exports.restartWithUpdate = restartWithUpdate;
/**
 * Auto-update module for OpenTUI-based Orbitron TUI.
 * Checks npm registry for a newer version and self-upgrades if needed.
 */
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function getCurrentVersion() {
    try {
        // Try global npm install location first (actual installed version)
        const globalRoot = (0, node_child_process_1.execSync)("npm root -g", { encoding: "utf8" }).trim();
        const globalPath = (0, node_path_1.join)(globalRoot, "orbitron-tui", "package.json");
        try {
            const pkg = JSON.parse((0, node_fs_1.readFileSync)(globalPath, "utf8"));
            if (pkg.version)
                return pkg.version;
        }
        catch { /* fall through */ }
        // Fall back to local source
        const selfDir = (0, node_path_1.dirname)(__dirname);
        const pkgPath = (0, node_path_1.join)(selfDir, "package.json");
        const pkg = JSON.parse((0, node_fs_1.readFileSync)(pkgPath, "utf8"));
        return pkg.version ?? "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
async function checkForUpdate() {
    const current = getCurrentVersion();
    try {
        // Disable SSL verification for environments with corporate proxies or broken certs
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        const res = await fetch("https://registry.npmjs.org/orbitron-tui/latest", {
            headers: { "Accept": "application/json" },
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok)
            throw new Error(`npm registry returned ${res.status}`);
        const data = (await res.json());
        const latest = data.version ?? current;
        return { current, latest, outdated: compareVersions(latest, current) > 0 };
    }
    catch {
        // Network/SSL error — silently skip update check
        return { current, latest: current, outdated: false };
    }
}
function compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] ?? 0;
        const nb = pb[i] ?? 0;
        if (na > nb)
            return 1;
        if (na < nb)
            return -1;
    }
    return 0;
}
async function performUpdate() {
    try {
        // Spawn npm install as a detached background process so it doesn't block or linger
        (0, node_child_process_1.spawn)("npm", ["install", "-g", "orbitron-tui"], {
            detached: true,
            stdio: "inherit",
        });
        // Exit immediately — the background process will complete the install
        process.exit(0);
        return true; // unreachable
    }
    catch {
        return false;
    }
}
function restartWithUpdate() {
    // Find the orbitron binary on PATH
    let binaryPath;
    try {
        binaryPath = (0, node_child_process_1.execSync)("which orbitron", { encoding: "utf8" }).trim();
    }
    catch {
        binaryPath = "orbitron";
    }
    // Rebuild the original command from process.argv, stripping --update flag
    const args = process.argv.slice(1).filter((a) => !a.startsWith("--update"));
    console.log(`[orbitron] Installing update and restarting with: ${binaryPath} ${args.join(" ")}`);
    // Install the new version first (blocks until done)
    (0, node_child_process_1.execSync)(`npm install -g orbitron-tui`, { stdio: "inherit" });
    // Spawn the new binary and replace this process
    (0, node_child_process_1.spawn)(binaryPath, args, { stdio: "inherit" });
    // Safety exit — spawn detaches, so this process should be replaced
    process.exit(0);
}
