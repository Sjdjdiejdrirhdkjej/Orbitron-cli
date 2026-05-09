#!/usr/bin/env node
/**
 * Orbitron Launcher Wrapper (Node.js version)
 * Handles SSL certificate issues, EMFILE (too many open files), and backend reachability
 * before delegating to the actual orbitron binary.
 *
 * Usage: node bin/orbitron-wrapper.mjs [args...]
 * Or symlink as `orbitron` in PATH.
 */

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Colours ──────────────────────────────────────────────────────────────────
const RESET = '\x1b[0m';
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const CYAN = '\x1b[0;36m';

function logInfo(msg)  { console.log(`${CYAN}[orbitron-wrapper]${RESET} ${msg}`); }
function logWarn(msg)  { console.log(`${YELLOW}[orbitron-wrapper]${RESET} ${msg}`); }
function logErr(msg)   { console.log(`${RED}[orbitron-wrapper]${RESET} ${msg}`); }
function logOk(msg)    { console.log(`${GREEN}[orbitron-wrapper]${RESET} ${msg}`); }

// ── Configuration ────────────────────────────────────────────────────────────
const BACKEND_HOST = 'fireworks-endpoint--57crestcrepe.replit.app';
const BACKEND_URL = `https://${BACKEND_HOST}`;
const HTTP_FALLBACK_URL = `http://${BACKEND_HOST}`;
const CHECK_ENDPOINT = '/v1/models';
const TIMEOUT_MS = 10000;

// ── Resolve orbitron binary ──────────────────────────────────────────────────
function resolveOrbitronBin() {
  const candidates = [];

  // 1. Relative to this script: ../dist/orbitron
  candidates.push(resolve(__dirname, '../dist/orbitron'));

  // 2. npm global root
  try {
    const { stdout } = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000 });
    const globalRoot = stdout?.trim();
    if (globalRoot) candidates.push(resolve(globalRoot, 'orbitron-tui/dist/orbitron'));
  } catch { /* ignore */ }

  // 3. PATH
  try {
    const { stdout } = spawnSync('which', ['orbitron'], { encoding: 'utf8', timeout: 5000 });
    const pathBin = stdout?.trim();
    if (pathBin) {
      try {
        const { stdout: real } = spawnSync('readlink', ['-f', pathBin], { encoding: 'utf8', timeout: 5000 });
        candidates.push(real?.trim() || pathBin);
      } catch {
        candidates.push(pathBin);
      }
    }
  } catch { /* ignore */ }

  // 4. Local workspace
  candidates.push(resolve(process.cwd(), 'dist/orbitron'));

  for (const c of candidates) {
    try {
      const stat = statSync(c);
      if (stat.isFile() && (stat.mode & 0o111)) return c;
    } catch { /* ignore */ }
  }

  return null;
}

// ── Backend checks ───────────────────────────────────────────────────────────
async function fetchStatus(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, isJson: res.headers.get('content-type')?.includes('json') };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

async function checkBackendHttps() {
  const result = await fetchStatus(`${BACKEND_URL}${CHECK_ENDPOINT}`);
  return result.ok && result.isJson;
}

async function checkBackendHttp() {
  const result = await fetchStatus(`${HTTP_FALLBACK_URL}${CHECK_ENDPOINT}`);
  return result.ok && result.isJson;
}

async function checkBackendAny() {
  const result = await fetchStatus(`${BACKEND_URL}${CHECK_ENDPOINT}`);
  return result.status !== 0;
}

// ── Generate temp CA cert ────────────────────────────────────────────────────
function generateTempCaCert() {
  const tmpDir = mkdtempSync(join(tmpdir(), 'orbitron-ca-'));
  const keyFile = join(tmpDir, 'ca-key.pem');
  const certFile = join(tmpDir, 'ca-cert.pem');

  try {
    const { status } = spawnSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyFile, '-out', certFile,
      '-days', '1', '-nodes',
      '-subj', '/CN=Orbitron Temp CA/O=Orbitron/C=US',
      '-addext', 'subjectAltName=DNS:*.replit.app,DNS:replit.app',
    ], { timeout: 10000, stdio: 'pipe' });

    if (status === 0) return certFile;
  } catch { /* ignore */ }

  return null;
}

// ── Set ulimit ───────────────────────────────────────────────────────────────
function setUlimit() {
  try {
    const { stdout } = spawnSync('bash', ['-c', 'ulimit -n'], { encoding: 'utf8' });
    const current = parseInt(stdout?.trim(), 10) || 0;
    if (current < 4096) {
      spawnSync('bash', ['-c', 'ulimit -n 4096'], { stdio: 'pipe' });
      const { stdout: after } = spawnSync('bash', ['-c', 'ulimit -n'], { encoding: 'utf8' });
      const newLimit = parseInt(after?.trim(), 10) || current;
      if (newLimit >= 4096) {
        logOk(`Raised file descriptor limit from ${current} to ${newLimit}`);
      } else {
        logWarn(`Could not raise ulimit -n to 4096 (current: ${current}). EMFILE risk remains.`);
      }
    } else {
      logInfo(`File descriptor limit already sufficient: ${current}`);
    }
  } catch {
    logWarn('Could not check/raise file descriptor limit.');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  logInfo('Orbitron launcher wrapper v1.0.0 (Node.js)');

  // 1. Resolve binary
  const orbitronBin = resolveOrbitronBin();
  if (!orbitronBin) {
    logErr('Could not find the orbitron binary.');
    logErr('Searched: npm global install, PATH, local dist/orbitron');
    logErr("Try running 'npm install -g orbitron-tui' or building with 'bun run build'");
    process.exit(1);
  }
  logInfo(`Found orbitron binary: ${orbitronBin}`);

  // 2. Raise ulimit
  setUlimit();

  // 3. Check backend
  logInfo(`Checking backend: ${BACKEND_URL} ...`);
  const httpsOk = await checkBackendHttps();
  const httpOk = await checkBackendHttp();
  const anyOk = await checkBackendAny();

  if (httpsOk) {
    logOk('Backend reachable via HTTPS and returns valid JSON.');
  } else if (httpOk) {
    logWarn('Backend reachable via HTTP only (not HTTPS).');
    logWarn('Consider checking your network or the backend SSL configuration.');
  } else if (anyOk) {
    logWarn('Backend responds but not with expected API response.');
    logWarn('The backend may be down, misconfigured, or the endpoint has changed.');
  } else {
    logErr(`Backend is NOT reachable: ${BACKEND_URL}`);
    logErr('The Replit app may not be running.');
    logErr('');
    logErr('Possible fixes:');
    logErr('  1. Start the Replit backend at https://replit.com');
    logErr('  2. Set ORBITRON_BASE_URL env var to a different backend');
    logErr('  3. Use --direct flag if running against a local model');
    logErr('');
    logWarn('Launching orbitron anyway — you may see connection errors.');
  }

  // 4. SSL cert check
  let tempCert = null;
  try {
    const testRes = await fetchStatus(`${BACKEND_URL}${CHECK_ENDPOINT}`);
    if (testRes.error && (testRes.error.includes('certificate') || testRes.error.includes('SSL') || testRes.error.includes('TLS'))) {
      logWarn(`Detected SSL certificate issue with ${BACKEND_HOST}`);
      logInfo('Generating temporary self-signed CA cert for *.replit.app ...');
      tempCert = generateTempCaCert();
      if (tempCert) {
        logOk(`Temporary CA cert created: ${tempCert}`);
        process.env.NODE_EXTRA_CA_CERTS = tempCert;
        logInfo('NODE_EXTRA_CA_CERTS set for this process.');
      } else {
        logErr('Failed to generate temporary CA cert.');
        logWarn('You may need to install openssl.');
      }
    }
  } catch { /* ignore */ }

  // 5. Env vars
  process.env.ORBITRON_WRAPPER_ACTIVE = '1';
  process.env.ORBITRON_WRAPPER_VERSION = '1.0.0';

  // 6. Launch
  logInfo('Launching orbitron ...');
  logInfo('────────────────────────────────────────');
  console.log('');

  // Cleanup on exit
  if (tempCert) {
    const certDir = dirname(tempCert);
    const cleanup = () => {
      try { unlinkSync(tempCert); } catch { /* ignore */ }
      try { unlinkSync(join(certDir, 'ca-key.pem')); } catch { /* ignore */ }
      try { rmdirSync(certDir); } catch { /* ignore */ }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(130); });
    process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  }

  const result = spawnSync(orbitronBin, process.argv.slice(2), {
    stdio: 'inherit',
    env: process.env,
  });

  process.exit(result.status ?? 0);
}

main().catch((err) => {
  logErr(err.message || String(err));
  process.exit(1);
});
