import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { logMessage } from './logger.js';

export const PACKAGE_NAME = 'orbitron-tui';
const PACKAGE_JSON_PATH = new URL('../package.json', import.meta.url);
const DEFAULT_UPDATE_LOG = '/dev/shm/orbitron-tui-update.log';

function readGlobalNpmInstalledVersion() {
  try {
    const out = spawnSync('npm', ['ls', '-g', PACKAGE_NAME, '--json', '--depth=0'], {
      encoding: 'utf8',
      env: process.env,
    });
    if (out.status !== 0 || !out.stdout) return null;
    const parsed = JSON.parse(out.stdout);
    const version = parsed?.dependencies?.[PACKAGE_NAME]?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

export function getInstalledVersion() {
  const globalVersion = readGlobalNpmInstalledVersion();
  if (globalVersion) return globalVersion;
  try {
    const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
    const pkg = JSON.parse(raw);
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function compareVersions(current, latest) {
  if (!current || !latest) return 0;

  const parse = (value) => {
    const [main, pre = ''] = String(value).split('-', 2);
    const parts = main.split('.').map((part) => Number(part || 0));
    return {
      parts,
      pre: pre.split('.').filter(Boolean),
    };
  };

  const a = parse(current);
  const b = parse(latest);

  const maxLen = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < maxLen; i += 1) {
    const x = a.parts[i] ?? 0;
    const y = b.parts[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }

  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;

  const preLen = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < preLen; i += 1) {
    const x = a.pre[i] ?? '';
    const y = b.pre[i] ?? '';
    const xNum = Number(x);
    const yNum = Number(y);
    const xIsNum = Number.isFinite(xNum) && String(xNum) === x;
    const yIsNum = Number.isFinite(yNum) && String(yNum) === y;
    if (xIsNum && yIsNum) {
      if (xNum < yNum) return -1;
      if (xNum > yNum) return 1;
      continue;
    }
    if (xIsNum && !yIsNum) return 1;
    if (!xIsNum && yIsNum) return -1;
    if (x < y) return -1;
    if (x > y) return 1;
  }

  return 0;
}

export function isGlobalInstall() {
  try {
    const entry = process.argv[1] ? fs.realpathSync(process.argv[1]) : '';
    return /[\\/]node_modules[\\/]/.test(entry);
  } catch {
    return false;
  }
}

export async function fetchLatestVersion(fetchImpl = fetch) {
  const res = await fetchImpl(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`npm registry request failed (${res.status})`);
  }
  const data = await res.json();
  if (typeof data?.version !== 'string') {
    throw new Error('npm registry response did not include a version');
  }
  return data.version;
}

export async function checkForUpdate({ fetchImpl = fetch } = {}) {
  const current = getInstalledVersion();
  const latest = await fetchLatestVersion(fetchImpl);
  return {
    current,
    latest,
    available: compareVersions(current, latest) < 0,
  };
}

export function launchBackgroundUpdate({ logPath = DEFAULT_UPDATE_LOG } = {}) {
  if (!isGlobalInstall()) {
    return { started: false, reason: 'not-global-install' };
  }

  const resolvedLog = path.resolve(logPath);
  fs.mkdirSync(path.dirname(resolvedLog), { recursive: true });
  const out = fs.openSync(resolvedLog, 'a');
  const err = fs.openSync(resolvedLog, 'a');

  try {
    const child = spawn('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
      detached: true,
      stdio: ['ignore', out, err],
      env: process.env,
    });
    child.unref();
    return { started: true, pid: child.pid ?? null, logPath: resolvedLog };
  } catch (error) {
    return {
      started: false,
      reason: error instanceof Error ? error.message : String(error),
      logPath: resolvedLog,
    };
  } finally {
    try {
      fs.closeSync(out);
    } catch {}
    try {
      fs.closeSync(err);
    } catch {}
  }
}

export function runForegroundUpdate() {
  if (!isGlobalInstall()) {
    return { ok: false, reason: 'not-global-install' };
  }
  const result = spawnSync('npm', ['install', '-g', `${PACKAGE_NAME}@latest`], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status === 0) return { ok: true };
  return {
    ok: false,
    reason: result.error?.message || `npm exited with code ${result.status ?? 'unknown'}`,
  };
}

export function restartCurrentProcess() {
  const argv = process.argv.slice(1);
  const child = spawn(process.execPath, argv, {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
    detached: true,
  });
  child.unref();
  return { started: true, pid: child.pid ?? null };
}

export function restartWithUpdate() {
  const updateProcess = spawn('npm', ['run', 'update'], {
    stdio: 'inherit',
    detached: true,
    shell: true,
  });

  updateProcess.unref();
  logMessage('Update started in the background. Please restart the app manually to apply changes.');
}

export async function performUpdate() {
  try {
    logMessage('Starting update...');
    await runUpdateScript();
    logMessage('Update completed successfully! Please restart the app to apply the changes.');
  } catch (error) {
    logMessage(`Update failed: ${error.message}`);
    throw error;
  }
}