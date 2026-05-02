import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'Trash', '.cache']);
const MAX_DEPTH = 8;

/**
 * Get the current git branch name, or null if not in a git repo.
 */
export function gitBranch(cwd) {
  try {
    const branch = execSync('git branch --show-current 2>/dev/null', {
      encoding: 'utf8',
      cwd,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * Get a short git status summary: 'clean' | 'dirty' | null (not a git repo).
 * Runs `git status --porcelain` and checks if any lines were produced.
 */
export function gitStatus(cwd) {
  try {
    const out = execSync('git status --porcelain 2>/dev/null', {
      encoding: 'utf8',
      cwd,
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out.length > 0 ? 'dirty' : 'clean';
  } catch {
    return null;
  }
}

/**
 * Get file stats: size in bytes, modification timestamp.
 * Returns null on error (file not found, permission denied, etc.).
 */
export function fileStats(absPath) {
  try {
    const stat = fs.statSync(absPath);
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

/**
 * Format byte count as a compact human-readable string.
 * e.g. 1024 → "1.0K", 1536000 → "1.5M", 500 → "500B"
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

/**
 * Format a modification timestamp (epoch ms) as a compact relative string.
 * e.g. now → "just now", 2m ago → "2m", 3h ago → "3h", 2d ago → "2d"
 */
export function formatFileMtime(mtimeMs) {
  const diff = Date.now() - mtimeMs;
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  // Older — show absolute date
  const d = new Date(mtimeMs);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function walkWorkspace(root, { maxEntries = 4000, maxDepth = MAX_DEPTH } = {}) {
  const entries = [];
  const stack = [{ dir: root, depth: 0 }];

  while (stack.length && entries.length < maxEntries) {
    const { dir, depth } = stack.pop();
    let children = [];
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    children
      .filter((entry) => !entry.name.startsWith('.') || entry.name === '.gitignore')
      .sort((a, b) => a.name.localeCompare(b.name))
      .reverse()
      .forEach((entry) => {
        if (DEFAULT_IGNORES.has(entry.name)) return;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(root, abs) || '.';
        if (entry.isDirectory()) {
          entries.push({ path: rel, type: 'dir', depth });
          if (depth < maxDepth) stack.push({ dir: abs, depth: depth + 1 });
        } else {
          // Collect size + mtime for each file (fast statSync, skip if fails)
          let _stats = null;
          try {
            const stat = fs.statSync(abs);
            _stats = { size: stat.size, mtimeMs: stat.mtimeMs };
          } catch {
            // ignore — file may be deleted between readdir and stat
          }
          entries.push({ path: rel, type: 'file', depth, _stats });
        }
      });
  }

  return entries;
}

export function readPreview(root, relPath, maxBytes = 12000) {
  const abs = path.resolve(root, relPath);
  if (!abs.startsWith(path.resolve(root))) {
    throw new Error(`Refusing to read outside workspace: ${relPath}`);
  }

  const stat = fs.statSync(abs);
  if (!stat.isFile()) return '[not a file]';
  const raw = fs.readFileSync(abs);
  const preview = raw.subarray(0, maxBytes).toString('utf8');
  const suffix = raw.length > maxBytes ? `\n… truncated (${raw.length} bytes total)` : '';
  return preview + suffix;
}

export function safeRelativePath(root, candidate) {
  const resolved = path.resolve(root, candidate);
  const base = path.resolve(root);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return path.relative(root, resolved) || '.';
}

/**
 * Filter a file list by a query string, matching against filename.
 * Returns indices into the original array for best performance.
 * Score by: exact prefix = 0, prefix match = 1, substring match = 2.
 */
export function filterFilesByQuery(entries, query) {
  if (!query?.trim()) return null; // null = no filter active
  const q = query.toLowerCase();
  const scored = [];
  for (let i = 0; i < entries.length; i++) {
    const name = entries[i].path.split('/').pop()?.toLowerCase() ?? '';
    if (name === q) {
      scored.push({ i, score: 0 });
    } else if (name.startsWith(q)) {
      scored.push({ i, score: 1 });
    } else if (name.includes(q)) {
      scored.push({ i, score: 2 });
    }
  }
  if (!scored.length) return null;
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map(s => s.i);
}
