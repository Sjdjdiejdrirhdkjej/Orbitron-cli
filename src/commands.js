import fs from 'node:fs';
import path from 'node:path';
import kleur from 'kleur';
import { execSync } from 'node:child_process';
import { readPreview, safeRelativePath, walkWorkspace } from './files.js';
import { fetchModels, streamChatCompletion, resolveApiUrl } from './protocol.js';
import { parseConfigValue } from './config.js';
import { THEME_NAMES } from './themes.js';
import { promptContextManager, promptSessionPicker, promptCommandPalette } from './ui.js';
import { listSessions, serializeSession, recomputeContextTokens, parseThinkingAndExtractDiffs, cycleMode, normalizeMode, formatModeName } from './state.js';
import { truncate, colourLine } from './components/text.js';

// ─── Connection health helpers ────────────────────────────────────────────────

/**
 * Ping the backend to check connectivity.
 * Returns { ok, latencyMs, error }.
 */
export async function pingBackend(baseUrl) {
  const url = resolveApiUrl(baseUrl, '/api/models');
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timeout);
    return { ok: res.ok, latencyMs: Date.now() - started, error: null };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err?.name === 'AbortError' ? 'timeout (5s)' : (err?.message ?? String(err));
    return { ok: false, latencyMs, error: msg };
  }
}

/**
 * Run a connectivity check and return a one-line status string for the Status card.
 */
export async function checkConnectionHealth(state) {
  const result = await pingBackend(state.config.baseUrl);
  state.backend.lastLatencyMs = result.latencyMs;
  if (result.ok) {
    state.backend.health = 'ok';
    return `connected · ${result.latencyMs}ms`;
  } else {
    state.backend.health = 'error';
    return `disconnected · ${result.error ?? 'unreachable'}`;
  }
}

// ─── Model picker UI helpers ───────────────────────────────────────────────────

/**
 * Filter and sort models by provider and search query.
 * Returns a list of { id, name, provider, context_window, input_price, output_price }
 * for all models that match query (case-insensitive) in priority order.
 */
function filterModels(models, query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? models.filter((m) => {
        const id = (m.id ?? '').toLowerCase();
        const name = (m.name ?? '').toLowerCase();
        const prov = (m.provider ?? '').toLowerCase();
        return id.includes(q) || name.includes(q) || prov.includes(q);
      })
    : [...models];

  // Sort: OpenAI → Anthropic → Google → others, then by id
  const provOrder = { OpenAI: 0, Anthropic: 1, Google: 2 };
  return filtered.sort((a, b) => {
    const pa = provOrder[a.provider] ?? 9;
    const pb = provOrder[b.provider] ?? 9;
    if (pa !== pb) return pa - pb;
    return (a.id ?? '').localeCompare(b.id ?? '');
  });
}

/**
 * Render a list of model options as a menu string for ora/console display.
 * Each line: [provider] id · context_window · input_price/1M / output_price/1M
 */
function renderModelOptions(models, selectedIndex, maxLines = 12) {
  const visible = models.slice(0, maxLines);
  return visible.map((m, i) => {
    const marker = i === selectedIndex ? kleur.inverse('▶') : ' ';
    const prov = (m.provider ?? '?').padEnd(10, ' ');
    const id = m.id ?? m.name ?? '?';
    const ctx = m.context_window
      ? `ctx:${(m.context_window / 1000).toFixed(0)}K`
      : '';
    const ip = m.pricing?.input_per_million != null
      ? `$${m.pricing.input_per_million}/1M`
      : null;
    const op = m.pricing?.output_per_million != null
      ? `$${m.pricing.output_per_million}/1M`
      : null;
    const price = [ip, op].filter(Boolean).join(' / ') || '';
    const detail = [ctx, price].filter(Boolean).join(' · ');
    const meta = detail ? kleur.gray(` · ${detail}`) : '';
    return `${marker} ${kleur.cyan(id)} · ${kleur.gray(prov)}${meta}`;
  });
}

/**
 * Interactive model picker using raw TTY input.
 * Returns the selected model id string, or null on Escape/Ctrl+C.
 */
async function promptModelPicker(models, currentModel, initialQuery = '') {
  let filtered = filterModels(models, initialQuery);
  if (!filtered.length) return null;

  let selected = filtered.findIndex((m) => m.id === currentModel || m.name === currentModel);
  if (selected < 0) selected = 0;

  let query = initialQuery;

  process.stdout.write('\x1b[?25l'); // hide cursor

  function draw() {
    const lines = renderModelOptions(filtered, selected, 14);
    const qDisplay = query
      ? kleur.cyan('Filter: ') + kleur.yellow(query)
      : kleur.gray('Filter (type to search, Esc to cancel):');
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(kleur.bold('▸ Model Picker\n'));
    process.stdout.write(kleur.gray('─'.repeat(60)) + '\n');
    for (const line of lines) process.stdout.write(line + '\n');
    process.stdout.write(kleur.gray('─'.repeat(60)) + '\n');
    process.stdout.write(qDisplay + '\n');
    process.stdout.write(kleur.gray('↑↓ navigate  Enter=select  Esc=cancel  / = provider filter\n'));
  }

  return new Promise((resolve) => {
    let escapeBuffer = '';
    const handler = (chunk) => {
      const str = chunk.toString('utf8');

      if (str === '\u0003') {
        process.stdout.write('\x1b[?25h');
        process.off('data', handler);
        resolve(null);
        return;
      }
      if (str === '\x1b') {
        escapeBuffer = '\x1b';
        return;
      }
      if (escapeBuffer === '\x1b') {
        escapeBuffer = '';
        if (str === '[A') {
          selected = Math.max(0, selected - 1);
          draw();
          return;
        }
        if (str === '[B') {
          selected = Math.min(filtered.length - 1, selected + 1);
          draw();
          return;
        }
        if (str === '[C' || str === '[D') {
          // Left/Right: jump by provider
          const curProv = filtered[selected]?.provider ?? '';
          const provs = [...new Set(filtered.map((m) => m.provider))];
          const provIdx = provs.indexOf(curProv);
          if (str === '[C') {
            // Right: next provider
            const nextProv = provs[(provIdx + 1) % provs.length];
            const firstOfProv = filtered.findIndex((m) => m.provider === nextProv);
            if (firstOfProv >= 0) selected = firstOfProv;
          } else {
            // Left: prev provider
            const prevProv = provs[(provIdx - 1 + provs.length) % provs.length];
            const firstOfProv = filtered.findIndex((m) => m.provider === prevProv);
            if (firstOfProv >= 0) selected = firstOfProv;
          }
          draw();
          return;
        }
        if (str === '\x1b') {
          // Escape key
          process.stdout.write('\x1b[?25h');
          process.off('data', handler);
          resolve(null);
          return;
        }
        escapeBuffer = '';
        return;
      }
      if (str === '\r' || str === '\n') {
        process.stdout.write('\x1b[?25h');
        process.off('data', handler);
        resolve(filtered[selected]?.id ?? null);
        return;
      }
      if (str === '\u007f') {
        // Backspace
        query = query.slice(0, -1);
        filtered = filterModels(models, query);
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        draw();
        return;
      }
      if (str === '/' && query === '') {
        // "/" — filter by provider
        query = '/';
        draw();
        return;
      }
      if (str >= ' ' || str === '/') {
        query += str;
        filtered = filterModels(models, query);
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        draw();
        return;
      }
    };

    process.stdin.on('data', handler);
    draw();
  });
}

function parseArgs(command) {
  const parts = command.trim().split(/\s+/);
  return { name: parts[0]?.toLowerCase() || '', args: parts.slice(1) };
}

function pushAssistant(state, content) {
  state.messages.push({ role: 'assistant', content });
  state.messageTimestamps.push(Date.now());
}

/**
 * Get current terminal dimensions synchronously using ioctl.
 * Falls back to { cols: 80, rows: 24 } if unavailable.
 * @returns {{ cols: number, rows: number }}
 */
export function getTerminalSize() {
  // Fast path: Node.js exposes columns/rows on TTY streams
  if (process.stdout.isTTY && process.stdout.columns && process.stdout.rows) {
    return { cols: process.stdout.columns, rows: process.stdout.rows };
  }
  // Environment variable fallback (set by terminal multiplexers)
  const envCols = parseInt(process.env.COLUMNS ?? '', 10);
  const envRows = parseInt(process.env.LINES ?? '', 10);
  if (envCols > 0 && envRows > 0) {
    return { cols: envCols, rows: envRows };
  }
  // ioctl fallback — try stty first (most portable), then raw ioctl
  try {
    // stty size writes "rows cols\n" to stdout
    const out = execSync('stty size 2>/dev/null', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [rows, cols] = out.trim().split(/\s+/).map(Number);
    if (cols > 0 && rows > 0) return { cols, rows };
  } catch {
    // stty not available
  }
  try {
    const fd = fs.openSync('/dev/tty', 'r');
    try {
      const ws = Buffer.alloc(8);
      const TIOCGWINSZ = process.platform === 'darwin' ? 0x40087468 : 0x5413;
      const ret = fs.ioctlSync(fd, TIOCGWINSZ, ws);
      if (ret === 0) {
        const rows = ws.readUInt16LE(0);
        const cols = ws.readUInt16LE(2);
        if (cols > 0 && rows > 0) return { cols, rows };
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // ignore
  }
  return { cols: 80, rows: 24 };
}

// ─── Workspace grep ───────────────────────────────────────────────────────────

/**
 * Search all text files in workspace for a pattern.
 * Returns matches as a streamed result shown in the conversation.
 * Handles: .js, .ts, .jsx, .tsx, .py, .json, .html, .css, .md, .yaml, .sh, .txt
 * Falls back to safeRelativePath to stay within workspace.
 */
export async function grepWorkspace(state, pattern, options = {}) {
  const { maxResults = 50, maxFiles = 20 } = options;
  const q = pattern.trim();
  if (!q) return [];

  const seen = new Set();
  const matches = [];

  // Files to search (skip node_modules, .git, dist, build, sessions, Trash)
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'sessions', 'Trash', 'trash', '.cache']);
  const INCLUDE_EXTS = new Set([
    'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs',
    'py', 'json', 'html', 'css', 'scss', 'less',
    'md', 'markdown', 'yaml', 'yml', 'toml', 'xml',
    'sh', 'bash', 'zsh', 'txt', 'text',
  ]);

  async function searchDir(dir, depth = 0) {
    if (depth > 4 || matches.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) break;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await searchDir(full, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = entry.name.includes('.') ? entry.name.split('.').pop().toLowerCase() : '';
      if (!INCLUDE_EXTS.has(ext)) continue;

      // Skip very large files (>100KB)
      try {
        const stat = fs.statSync(full);
        if (stat.size > 100_000) continue;
      } catch {
        continue;
      }

      // Use safeRelativePath to verify within workspace
      const rel = safeRelativePath(state.cwd, full);
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);

      if (matches.length >= maxFiles) break;

      let content;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }

      // Search content line by line
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxResults) break;
        const line = lines[i];
        // Case-insensitive search
        const lowerLine = line.toLowerCase();
        const lowerQ = q.toLowerCase();
        let idx = 0;
        while ((idx = lowerLine.indexOf(lowerQ, idx)) !== -1) {
          matches.push({
            path: rel,
            line: i + 1,
            col: idx + 1,
            text: line,
            preview: line.trim(),
          });
          idx += 1; // move past this match to find overlapping in same line (unlikely but safe)
          if (matches.length >= maxResults) break;
        }
      }
    }
  }

  await searchDir(state.cwd);
  return matches;
}

/**
 * Paginate a multi-line string one screen at a time.
 * drawFn(pageLines) renders the current page; onDismiss() is called when the user dismisses.
 * Returns a Promise that resolves when the user finishes viewing.
 */
async function paginateOutput(lines, { drawFn, onDismiss, pageSize = null }) {
  const totalLines = Array.isArray(lines) ? lines : String(lines).split('\n');
  const height = pageSize ?? process.stdout.rows ?? 24;
  let offset = 0;

  return new Promise((resolve) => {
    function drawPage() {
      const page = totalLines.slice(offset, offset + height);
      process.stdout.write('\x1b[2J\x1b[H');
      drawFn(page);
      const more = offset + height < totalLines.length;
      const footer = more
        ? kleur.gray(`▸ ${totalLines.length - offset - height} more lines · ↑↓ scroll · Esc/dismiss`)
        : kleur.gray('▸ End · ↑↓ scroll · Esc/dismiss');
      process.stdout.write(footer + '\n');
    }

    drawPage();

    let escapeBuffer = '';
    const handler = (chunk) => {
      const str = chunk.toString('utf8');

      if (str === '\u0003') {
        process.stdout.write('\x1b[2J\x1b[H');
        process.off('data', handler);
        onDismiss?.();
        resolve();
        return;
      }
      if (str === '\x1b') {
        escapeBuffer = '\x1b';
        return;
      }
      if (escapeBuffer === '\x1b') {
        escapeBuffer = '';
        if (str === '[A') { // Up
          offset = Math.max(0, offset - Math.floor(height / 2));
          drawPage();
          return;
        }
        if (str === '[B') { // Down
          offset = Math.min(totalLines.length - height, offset + Math.floor(height / 2));
          drawPage();
          return;
        }
        if (str === '\x1b') {
          process.stdout.write('\x1b[2J\x1b[H');
          process.off('data', handler);
          onDismiss?.();
          resolve();
          return;
        }
        escapeBuffer = '';
        return;
      }
      // Space / PageDown = forward one page
      if (str === ' ' || str === '\x0c') {
        offset = Math.min(totalLines.length - height, offset + height);
        drawPage();
        return;
      }
      // Ctrl+U / PageUp = back one page
      if (str === '\x15') {
        offset = Math.max(0, offset - height);
        drawPage();
        return;
      }
    };

    process.stdin.on('data', handler);
  });
}

export async function handleSlashCommand(state, command, redraw, sessionCallbacks = {}, writeToken) {
  const { name, args } = parseArgs(command.replace(/^\//, '').trim());

  switch (name) {
    case 'help': {
      const categories = [
        {
          title: 'Chat & Models',
          commands: [
            { cmd: '/help', desc: 'Show this reference' },
            { cmd: '/models', desc: 'Fetch available models and open the picker' },
            { cmd: '/model <id>', desc: 'Set the active model (omit id to pick interactively)' },
            { cmd: '/mode <name>', desc: 'Set mode: default / max / plan / lite (blank cycles forward)' },
            { cmd: '/think', desc: 'Toggle chain-of-thought reasoning on/off' },
          ],
        },
        {
          title: 'Session & Context',
          commands: [
            { cmd: '/context', desc: 'Manage context files and token budget' },
            { cmd: '/include <path>', desc: 'Add a file to context' },
            { cmd: '/exclude <path>', desc: 'Remove a file from context' },
            { cmd: '/files', desc: 'Re-index workspace files' },
            { cmd: '/save <name>', desc: 'Save current conversation as a named session' },
            { cmd: '/sessions', desc: 'Browse and restore saved sessions' },
          ],
        },
        {
          title: 'Conversation',
          commands: [
            { cmd: '/search <term>', desc: 'Search conversation history' },
            { cmd: '/retry', desc: 'Retry the last failed request' },
            { cmd: '/clear', desc: 'Clear conversation history' },
            { cmd: '/export <path>', desc: 'Save transcript as markdown (default: transcript.md)' },
            { cmd: '/copy <path>', desc: 'Alias for /export' },
          ],
        },
        {
          title: 'Files & Code',
          commands: [
            { cmd: '/explain <path>', desc: 'Explain a file (or the selected explorer file)' },
            { cmd: '/write <path>', desc: 'Create/overwrite a file (multi-line; end with ----)' },
            { cmd: '/append <path>', desc: 'Append to a file (multi-line; end with ----)' },
            { cmd: '/run <cmd>', desc: 'Run a shell command and stream output live' },
            { cmd: '/grep <term>', desc: 'Search all workspace files for a pattern' },
          ],
        },
        {
          title: 'Git',
          commands: [
            { cmd: '/commit <msg>', desc: 'Stage all and commit (opens editor if no msg given)' },
            { cmd: '/diff', desc: 'Show uncommitted git changes (paginated diff viewer)' },
          ],
        },
        {
          title: 'UI & Display',
          commands: [
            { cmd: '/compact  (/c)', desc: 'Toggle compact single-column layout' },
            { cmd: '/theme <name>', desc: 'Switch colour theme: default / forest / solarized / mono' },
            { cmd: '/settings', desc: 'Show current config settings' },
            { cmd: '/status', desc: 'Show runtime status and connection info' },
            { cmd: '/set <field> <val>', desc: 'Update a config field directly' },
            { cmd: '/quit', desc: 'Exit Orbitron' },
          ],
        },
      ];

      const maxCmdLen = 22;
      const divider = kleur.gray('─'.repeat(52));
      const lines = [
        kleur.bold().cyan('▸ Orbitron Command Reference'),
        kleur.gray('Tip: press Tab after "/" to complete commands, Ctrl+P to open the palette'),
        divider,
      ];

      for (const cat of categories) {
        lines.push(kleur.bold().white(`  ${cat.title}`));
        for (const { cmd, desc } of cat.commands) {
          const padded = cmd.padEnd(maxCmdLen, ' ');
          lines.push(`  ${kleur.cyan(padded)} ${kleur.gray(desc)}`);
        }
        lines.push('');
      }
      lines.push(divider);
      lines.push(kleur.gray('  Keyboard: Enter send  ↑↓ hist  Tab complete  ? help  Ctrl+P palette'));
      lines.push(kleur.gray('  Ctrl+E retry  Ctrl+J run code block  Ctrl+F find file  Esc close'));
      pushAssistant(state, lines.join('\n'));
      return { quit: false };
    }
    case 'models': {
      state.status = 'Fetching models';
      state.busy = true;
      try {
        const models = await fetchModels(state.config.baseUrl);
        state.modelList = models;
        state.status = `Loaded ${models.length} models`;
      } catch (err) {
        state.status = 'Model fetch failed';
        pushAssistant(state, `Model fetch failed: ${err.message}`);
        state.busy = false;
        return { quit: false };
      }
      state.busy = false;
      if (!models.length) {
        pushAssistant(state, 'No models returned from the backend. Check the pinned backend in /status.');
        return { quit: false };
      }
      pushAssistant(state, `Loaded ${models.length} models. Use /model (no args) to pick one interactively.`);
      return { quit: false };
    }
    case 'model': {
      const next = args.join(' ').trim();
      if (!next) {
        pushAssistant(state, `Current model: ${state.config.model}. Use /models to browse available models.`);
      } else {
        state.config.model = next;
        pushAssistant(state, `Model set to: ${state.config.model}`);
      }
      return { quit: false };
    }
    case 'backend': {
      pushAssistant(state, `Orbitron is pinned to ${state.config.baseUrl}. Use /status for health and /models for the picker.`);
      return { quit: false };
    }
    case 'theme': {
      const next = args.join(' ').trim();
      if (!next) {
        pushAssistant(state, `Current theme: ${state.config.theme}. Available: ${THEME_NAMES.join(', ')}. Usage: /theme <name>`);
        return { quit: false };
      }
      const allowed = THEME_NAMES;
      if (!allowed.includes(next)) {
        pushAssistant(state, `Unknown theme "${next}". Available: ${allowed.join(', ')}`);
        return { quit: false };
      }
      state.config.theme = next;
      pushAssistant(state, `Theme set to ${next}. Restart or use /set theme ${next} to persist.`);
      return { quit: false };
    }
    case 'settings': {
      pushAssistant(state, `Current settings:\n${Object.entries(state.config).filter(([k]) => !['apiKey'].includes(k)).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`).join('\n')}\n\nUse /set <field> <value> to update a setting, or /model /theme for quick access.`);
      return { quit: false };
    }
    case 'status': {
      pushAssistant(state, [
        `status: ${state.status}`,
        `busy: ${state.busy}`,
        `messages: ${state.messages.length}`,
        `backend: ${state.config.baseUrl}`,
        `model: ${state.config.model}`,
        `temperature: ${state.config.temperature}`,
        `maxTokens: ${state.config.maxTokens}`,
        `theme: ${state.config.theme}`,
        `autosave: ${state.config.autosave}`,
        `context files: ${state.contextPaths.size}`,
        `connection: ${state.backend?.health === 'ok' ? `ok (${state.backend.lastLatencyMs}ms)` : 'unreachable'}`,
      ].join('\n'));
      return { quit: false };
    }
    case 'open':
    case 'include': {
      const relPath = args.join(' ').trim();
      if (!relPath) {
        pushAssistant(state, 'Provide a path.');
        return { quit: false };
      }
      const resolved = path.resolve(state.cwd, relPath);
      if (!fs.existsSync(resolved)) {
        pushAssistant(state, `Not found: ${relPath}`);
        return { quit: false };
      }
      const relative = safeRelativePath(state.cwd, resolved);
      if (!relative) {
        pushAssistant(state, `Refusing to include path outside workspace: ${relPath}`);
        return { quit: false };
      }
      state.contextPaths.add(relative);
      recomputeContextTokens(state);
      const preview = readPreview(state.cwd, relative);
      pushAssistant(state, `Included ${relative}\n\n${preview}`);
      return { quit: false };
    }
    case 'exclude': {
      const relPath = args.join(' ').trim();
      state.contextPaths.delete(relPath);
      recomputeContextTokens(state);
      pushAssistant(state, `Excluded ${relPath}`);
      return { quit: false };
    }
    case 'files': {
      state.files = walkWorkspace(state.cwd);
      pushAssistant(state, `Indexed ${state.files.length} entries under ${state.cwd}`);
      return { quit: false };
    }
    case 'context': {
      await promptContextManager(state);
      recomputeContextTokens(state);
      return { quit: false };
    }
    case 'clear': {
      state.messages = [{ role: 'assistant', content: 'Conversation cleared.' }];
      state.messageTimestamps = [Date.now()];
      state.conversationStartedAt = Date.now();
      return { quit: false };
    }
    case 'set': {
      const [field, ...rest] = args;
      const rawValue = rest.join(' ').trim();
      if (!field || !rawValue) {
        pushAssistant(state, 'Usage: /set <field> <value>');
        return { quit: false };
      }
      if (!(field in state.config)) {
        pushAssistant(state, `Unknown config field: ${field}`);
        return { quit: false };
      }
      state.config[field] = parseConfigValue(field, rawValue);
      pushAssistant(state, `Updated ${field}.`);
      return { quit: false };
    }
    case 'run': {
      const cmd = args.join(' ').trim();
      if (!cmd) {
        pushAssistant(state, 'Usage: /run <command>  —  run a shell command with streaming output.');
        return { quit: false };
      }
      const { spawn } = await import('node:child_process');
      pushAssistant(state, `$ ${cmd}`);
      state.status = `running: ${cmd}`;
      state.busy = true;
      state.runningCommand = cmd;
      state.messages.push({ role: 'system', content: `⏳ Running: ${cmd}…` });
      state.messageTimestamps.push(Date.now());
      const outputMsgIdx = state.messages.length - 1;
      const outputLines = [];
      let stderrLines = [];
      redraw();

      try {
        const child = spawn(cmd, [], {
          shell: true,
          cwd: state.cwd,
          env: { ...process.env },
        });

        child.stdout.on('data', (chunk) => {
          const text = chunk.toString('utf8').replace(/\n+$/, '');
          if (!text) return;
          outputLines.push(text);
          // Stream output incrementally into the conversation
          state.messages[outputMsgIdx] = {
            role: 'system',
            content: outputLines.join('\n') + (stderrLines.length ? '\n\n' + kleur.red(stderrLines.join('\n')) : ''),
          };
          redraw();
        });

        child.stderr.on('data', (chunk) => {
          const text = chunk.toString('utf8').replace(/\n+$/, '');
          if (!text) return;
          stderrLines.push(text);
          if (outputLines.length === 0) {
            // Show stderr as soon as it appears even if no stdout yet
            state.messages[outputMsgIdx] = {
              role: 'system',
              content: kleur.red(stderrLines.join('\n')),
            };
          } else {
            state.messages[outputMsgIdx] = {
              role: 'system',
              content: outputLines.join('\n') + '\n\n' + kleur.red(stderrLines.join('\n')),
            };
          }
          redraw();
        });

        child.on('close', (code) => {
          const exitMsg = code === 0 ? kleur.green(`✓ done`) : kleur.red(`✗ exit ${code}`);
          const combined = [...outputLines, ...stderrLines].join('\n');
          state.messages[outputMsgIdx] = {
            role: 'system',
            content: combined ? `${combined}\n\n${exitMsg}` : exitMsg,
          };
          state.runningCommand = null;
          state.status = 'Ready';
          state.busy = false;
          redraw();
        });

        child.on('error', (err) => {
          state.messages[outputMsgIdx] = {
            role: 'system',
            content: kleur.red(`error: ${err.message}`),
          };
          state.runningCommand = null;
          state.status = 'Ready';
          state.busy = false;
          redraw();
        });
      } catch (error) {
        state.messages[outputMsgIdx] = {
          role: 'system',
          content: kleur.red(`Command failed: ${error.message}`),
        };
        state.runningCommand = null;
        state.status = 'Ready';
        state.busy = false;
        redraw();
      }
      return { quit: false };
    }
    case 'export': {
      const relPath = args.join(' ').trim() || 'transcript.md';
      const resolved = path.resolve(state.cwd, relPath);
      const content = state.messages
        .map((m) => `**${m.role}**: ${m.content}`)
        .join('\n\n');
      try {
        fs.writeFileSync(resolved, content, 'utf8');
        pushAssistant(state, `Transcript exported to ${relPath} (${state.messages.length} messages).`);
      } catch (err) {
        pushAssistant(state, `Export failed: ${err.message}`);
      }
      return { quit: false };
    }
    case 'copy': {
      const relPath = args.join(' ').trim() || 'transcript.md';
      const resolved = path.resolve(state.cwd, relPath);
      const content = state.messages
        .map((m) => `**${m.role}**: ${m.content}`)
        .join('\n\n');
      try {
        fs.writeFileSync(resolved, content, 'utf8');
        pushAssistant(state, `Transcript saved to ${relPath}. Use a clipboard tool to copy it from there.`);
      } catch (err) {
        pushAssistant(state, `Copy failed: ${err.message}`);
      }
      return { quit: false };
    }
    case 'grep': {
      const q = args.join(' ').trim();
      if (!q) {
        pushAssistant(state, 'Usage: /grep <term>  —  searches all workspace code and text files.');
        return { quit: false };
      }
      state.status = `Searching: ${q}`;
      state.busy = true;
      try {
        const results = await grepWorkspace(state, q);
        if (!results.length) {
          pushAssistant(state, `No matches found for "${q}" in workspace.`);
        } else {
          const byFile = new Map();
          for (const m of results) {
            if (!byFile.has(m.path)) byFile.set(m.path, []);
            byFile.get(m.path).push(m);
          }
          const lines = [`Found ${results.length} match${results.length !== 1 ? 'es' : ''} in ${byFile.size} file${byFile.size !== 1 ? 's' : ''}:`];
          for (const [filePath, matches] of byFile) {
            lines.push(kleur.cyan(`  ${filePath}`) + kleur.gray(` (${matches.length} match${matches.length !== 1 ? 'es' : ''})`));
            for (const match of matches.slice(0, 3)) {
              const snippet = match.preview.slice(0, 80).replace(/\n/g, ' ');
              lines.push(`    ${kleur.gray(`${match.line}:${match.col}`)}  ${snippet}`);
            }
            if (matches.length > 3) {
              lines.push(kleur.gray(`    … and ${matches.length - 3} more in this file`));
            }
          }
          pushAssistant(state, lines.join('\n'));
        }
      } catch (err) {
        pushAssistant(state, `Grep failed: ${err.message}`);
      } finally {
        state.status = 'Ready';
        state.busy = false;
      }
      return { quit: false };
    }
    case 'search': {
      const q = args.join(' ').trim();
      if (!q) {
        pushAssistant(state, 'Usage: /search <term>  —  searches conversation history.');
        return { quit: false };
      }
      const lower = q.toLowerCase();
      const matches = state.messages
        .map((m, i) => ({ index: i, role: m.role, content: m.content }))
        .filter(m => m.content.toLowerCase().includes(lower));
      if (!matches.length) {
        pushAssistant(state, `No messages found matching "${q}".`);
      } else {
        const preview = matches.slice(0, 6).map(m => {
          const snippet = m.content.slice(0, 120).replace(/\n/g, ' ');
          return `  [${m.role}] ${snippet}${m.content.length > 120 ? '…' : ''}`;
        }).join('\n');
        const count = matches.length > 6 ? `\n… and ${matches.length - 6} more` : '';
        pushAssistant(state, `Found ${matches.length} message(s) matching "${q}":\n${preview}${count}`);
      }
      return { quit: false };
    }
    case 'write': {
      const relPath = args.join(' ').trim();
      if (!relPath) {
        pushAssistant(state, 'Usage: /write <path> — opens interactive multi-line editor. End with a line containing just "----" on its own line.');
        return { quit: false };
      }
      const resolved = path.resolve(state.cwd, relPath);
      const relative = safeRelativePath(state.cwd, resolved);
      if (!relative) {
        pushAssistant(state, `Refusing to write outside workspace: ${relPath}`);
        return { quit: false };
      }
      pushAssistant(state, `Writing ${relative} — type/paste content, end with a line containing just "${'----'.green}" on its own line. Esc cancels.`);
      state.input = '';
      state.inputCursor = 0;
      state.multilineEditPath = relative;
      state.multilineEditMode = 'write';
      redraw();
      return { quit: false };
    }
    case 'append': {
      const relPath = args.join(' ').trim();
      if (!relPath) {
        pushAssistant(state, 'Usage: /append <path> — opens interactive multi-line editor in append mode. End with a line containing just "----" on its own line.');
        return { quit: false };
      }
      const resolved = path.resolve(state.cwd, relPath);
      const relative = safeRelativePath(state.cwd, resolved);
      if (!relative) {
        pushAssistant(state, `Refusing to write outside workspace: ${relPath}`);
        return { quit: false };
      }
      pushAssistant(state, `Appending to ${relative} — type/paste content, end with a line containing just "${'----'.green}" on its own line. Esc cancels.`);
      state.input = '';
      state.inputCursor = 0;
      state.multilineEditPath = relative;
      state.multilineEditMode = 'append';
      redraw();
      return { quit: false };
    }
    case 'diff': {
      if (!state.gitBranch) {
        pushAssistant(state, 'Not in a git repository. Initialize one first with /run git init.');
        return { quit: false };
      }
      if (state.gitStatus !== 'dirty') {
        pushAssistant(state, 'Nothing to commit — working tree clean. No diff to show.');
        return { quit: false };
      }
      // Show staged + unstaged diff summary inline, then full diff in pager
      let diffOut = '';
      try {
        diffOut = execSync('git diff --stat 2>/dev/null', {
          cwd: state.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        pushAssistant(state, 'Could not run git diff --stat.');
        return { quit: false };
      }
      pushAssistant(state, `Uncommitted changes:\n${kleur.cyan(diffOut.trim() || '(no staged changes)')}`);

      // Stream full diff to stdout (one-page-at-a-time)
      try {
        const fullDiff = execSync('git diff 2>/dev/null', {
          cwd: state.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 10 * 1024 * 1024,
        });
        const lines = fullDiff.split('\n');
        const MAX_LINES = 120;
        const pageSize = Math.max(12, (process.stdout.rows || 24) - 6);
        const totalPages = Math.ceil(Math.min(lines.length, MAX_LINES) / pageSize);
        let page = 0;
        let offset = 0;

        const drawDiffPage = () => {
          process.stdout.write('\x1b[2J\x1b[H');
          process.stdout.write(kleur.bold('▸ git diff  (Esc to close)\n'));
          process.stdout.write(kleur.gray('─'.repeat(Math.min(process.stdout.columns || 80, 80))) + '\n');
          const slice = lines.slice(offset, offset + pageSize);
          for (const line of slice) process.stdout.write(line + '\n');
          process.stdout.write(kleur.gray('─'.repeat(Math.min(process.stdout.columns || 80, 80))) + '\n');
          process.stdout.write(kleur.gray(`page ${page + 1}/${totalPages}  ↑↓ scroll  Esc close`));
        };

        return new Promise((resolve) => {
          let escapeBuffer = '';
          let done = false;
          const handler = (chunk) => {
            const str = chunk.toString('utf8');
            if (str === '\u0003' || (str === '\x1b' && !escapeBuffer)) {
              escapeBuffer = str === '\x1b' ? '\x1b' : '';
              if (str !== '\x1b' || done) {
                process.stdout.write('\x1b[?25h');
                process.off('data', handler);
                state.messages.push({ role: 'assistant', content: 'Diff closed.' });
                state.messageTimestamps.push(Date.now());
                redraw();
                resolve({ quit: false });
                return;
              }
            }
            if (escapeBuffer === '\x1b') {
              escapeBuffer = '';
              if (str === '[A') {
                if (offset > 0) { offset -= pageSize; page--; }
                drawDiffPage();
                return;
              }
              if (str === '[B') {
                if (offset + pageSize < lines.length) { offset += pageSize; page++; }
                drawDiffPage();
                return;
              }
              if (str === '\x1b') {
                done = true;
                process.stdout.write('\x1b[?25h');
                process.off('data', handler);
                state.messages.push({ role: 'assistant', content: 'Diff closed.' });
                state.messageTimestamps.push(Date.now());
                redraw();
                resolve({ quit: false });
                return;
              }
              return;
            }
            // Any other key closes
            done = true;
            process.stdout.write('\x1b[?25h');
            process.off('data', handler);
            state.messages.push({ role: 'assistant', content: 'Diff closed.' });
            state.messageTimestamps.push(Date.now());
            redraw();
            resolve({ quit: false });
          };
          process.stdin.on('data', handler);
          process.stdout.write('\x1b[?25l');
          drawDiffPage();
        });
      } catch (err) {
        pushAssistant(state, `Diff failed: ${err.message}`);
        return { quit: false };
      }
    }
    case 'sessions': {
      const sessionsDir = path.join(state.cwd, 'sessions');
      const sessions = listSessions(sessionsDir);
      const chosen = await promptSessionPicker(sessions);
      if (!chosen) {
        pushAssistant(state, 'Session picker cancelled.');
      } else {
        try {
          const raw = fs.readFileSync(chosen.path, 'utf8');
          const data = JSON.parse(raw);
          const sessionData = restoreSession(data);
          if (sessionData && sessionCallbacks?.restoreAndRedraw) {
            sessionCallbacks.restoreAndRedraw(sessionData);
            pushAssistant(state, `Restored session: ${chosen.name} (${chosen.messageCount} messages).`);
          } else {
            pushAssistant(state, `Failed to restore session: ${chosen.name}`);
          }
        } catch (err) {
          pushAssistant(state, `Failed to load session: ${err.message}`);
        }
      }
      return { quit: false };
    }
    case 'compact': {
      state.compactMode = !state.compactMode;
      pushAssistant(state, state.compactMode
        ? 'Compact mode on — type /compact or /c to restore the full layout.'
        : 'Full layout restored. Type /compact or /c for minimal mode.');
      return { quit: false };
    }
    case 'c': {
      // Alias for /compact
      state.compactMode = !state.compactMode;
      pushAssistant(state, state.compactMode
        ? 'Compact mode on.'
        : 'Full layout restored.');
      return { quit: false };
    }
    case 'think': {
      state.thinkMode = !state.thinkMode;
      pushAssistant(state, state.thinkMode
        ? 'Chain-of-thought mode on — the model will show its reasoning steps before the final answer.'
        : 'Chain-of-thought mode off — normal responses only.');
      return { quit: false };
    }
    case 'mode': {
      const next = args.join(' ').trim();
      if (!next) {
        state.mode = cycleMode(state.mode, 1);
        state.status = `Mode: ${formatModeName(state.mode)}`;
        redraw();
        return { quit: false };
      }
      state.mode = normalizeMode(next);
      state.status = `Mode: ${formatModeName(state.mode)}`;
      redraw();
      return { quit: false };
    }
    case 'expand': {
      if (!state.lastResponseDiff) {
        pushAssistant(state, 'No model result block to expand. Result blocks appear after thinking sections in chain-of-thought responses.');
        return { quit: false };
      }
      state.diffExpanded = !state.diffExpanded;
      pushAssistant(state, state.diffExpanded ? 'Result block expanded.' : 'Result block collapsed.');
      return { quit: false };
    }
    case 'collapse': {
      state.diffExpanded = false;
      pushAssistant(state, 'Result block collapsed.');
      return { quit: false };
    }
    case 'commit': {
      // /commit — stage all changes and open inline commit message editor
      const msg = args.join(' ').trim();
      if (!msg) {
        // No message provided — enter commit message editor mode
        pushAssistant(state, 'Commit message editor — type your message, end with a line containing just "----" on its own line. Esc cancels.');
        state.input = '';
        state.inputCursor = 0;
        state.multilineEditPath = null; // signal: commit editor mode (not file-edit)
        state.multilineEditMode = 'commit';
        state.multilineEditContent = '';
        redraw();
        return { quit: false };
      }
      // Message provided inline — stage and commit immediately
      if (!state.gitBranch) {
        pushAssistant(state, 'Not in a git repository. Initialize one first with /run git init.');
        return { quit: false };
      }
      try {
        execSync('git add -A', { cwd: state.cwd, stdio: 'ignore' });
      } catch {
        pushAssistant(state, 'git add -A failed. Check permissions or git status.');
        return { quit: false };
      }
      let output = '';
      try {
        output = execSync(`git commit -m ${JSON.stringify(msg)}`, {
          cwd: state.cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        const errOut = err.stdout ?? err.stderr ?? '';
        if (errOut.includes('nothing to commit')) {
          state.gitStatus = 'clean';
          pushAssistant(state, 'Nothing to commit — working tree clean.');
        } else {
          pushAssistant(state, `Commit failed: ${errOut.slice(0, 400)}`);
        }
        return { quit: false };
      }
      state.gitStatus = 'clean';
      pushAssistant(state, `✓ Committed: "${msg}"\n${output.slice(0, 200)}`.trim() || `✓ Committed: "${msg}"`);
      return { quit: false };
    }
    case 'save': {
      const name = args.join(' ').trim();
      if (!name) {
        pushAssistant(state, 'Usage: /save <name>  — saves the current conversation as a named session.');
        return { quit: false };
      }
      // Sanitize: lowercase alphanumeric + hyphens, strip leading/trailing hyphens
      const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!safeName) {
        pushAssistant(state, 'Invalid session name — use letters, numbers, and hyphens only.');
        return { quit: false };
      }
      if (sessionCallbacks?.saveNamed) {
        sessionCallbacks.saveNamed(safeName);
        pushAssistant(state, `Session saved as "${safeName}". Use /sessions to browse and restore it.`);
      } else {
        // Fallback: save directly
        const sessionsDir = path.join(state.cwd, 'sessions');
        fs.mkdirSync(sessionsDir, { recursive: true });
        const data = serializeSession(state);
        const filePath = path.join(sessionsDir, `${safeName}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
        pushAssistant(state, `Session saved as "${safeName}" (${data.messages.length} messages, ${state.contextPaths.size} context files).`);
      }
      return { quit: false };
    }
    case 'explain': {
      // /explain — explain a file in the context or selected in the explorer.
      // If no path given, uses the currently selected file.
      let relPath = args.join(' ').trim();
      if (!relPath) {
        // Use the currently selected file from the explorer
        const selected = state.files[state.selectedFileIndex];
        if (selected && selected.type === 'file') {
          relPath = selected.path;
        }
        if (!relPath) {
          pushAssistant(state, 'Usage: /explain <path>  —  or select a file in the explorer first.');
          return { quit: false };
        }
      }

      const resolved = path.resolve(state.cwd, relPath);
      if (!fs.existsSync(resolved)) {
        pushAssistant(state, `File not found: ${relPath}`);
        return { quit: false };
      }

      let content;
      try {
        content = fs.readFileSync(resolved, 'utf8');
      } catch {
        pushAssistant(state, `Could not read file: ${relPath}`);
        return { quit: false };
      }

      const lang = relPath.split('.').pop() ?? 'text';
      const sizeKb = Math.round(Buffer.byteLength(content, 'utf8') / 1024);
      const preview = content.length > 3000 ? content.slice(0, 3000) + '\n…' : content;

      // System directive that tells the model to produce a clear, structured explanation
      const explainSystem = [
        'You are a clear, educational coding assistant. When asked to explain a file, provide:',
        '1. A brief one-sentence summary of what the file does.',
        '2. The main components / sections and their purpose.',
        '3. Any notable patterns, architecture decisions, or interesting idioms.',
        '4. Potential issues or improvement opportunities if any are apparent.',
        'Format the explanation in plain markdown (bold headings, bullet points, inline code for identifiers).',
        'Keep explanations focused and practical — developers use this to quickly understand unfamiliar code.',
        '',
        'Do NOT just echo the file contents. Actually analyze and explain it.',
      ].join('\n');

      const explainMessages = [
        { role: 'system', content: explainSystem },
        {
          role: 'user',
          content: `Explain this ${lang} file (${sizeKb}KB). Show: summary, main components, notable patterns, and any issues:\n\n\`\`\`${lang}\n${preview}\n\`\`\``,
        },
      ];

      state.status = 'Explaining file';
      state.busy = true;
      state.streamingStartTime = Date.now();
      state.streamingTokMin = null;
      state.streamingTokenCount = 0;
      state.streamingPartial = '';
      state.typingIndicator = true;
      state.typingDots = 0;

      const started = Date.now();
      let tokenCount = 0;
      let lastUpdate = started;
      let typingTimer = null;

      const startTypingDots = () => {
        if (typingTimer) return;
        typingTimer = setInterval(() => {
          state.typingDots = (state.typingDots + 1) % 4;
          scheduleRedraw?.();
        }, 400);
      };
      const stopTypingDots = () => {
        if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
        state.typingDots = 0;
      };

      process.stdout.write(kleur.cyan('\nExplanation: '));
      startTypingDots();

      const replyTokens = [];
      const controller = new AbortController();

      try {
        for await (const token of streamChatCompletion({
          baseUrl: state.config.baseUrl,
          apiKey: state.config.apiKey,
          model: state.config.model,
          messages: explainMessages,
          temperature: 0.3,
          maxTokens: 2048,
          retries: state.config.retries,
        }, controller.signal)) {
          if (tokenCount === 0) {
            state.typingIndicator = false;
            stopTypingDots();
            scheduleRedraw?.();
          }
          replyTokens.push(token);
          tokenCount++;
          state.streamingTokenCount = tokenCount;

          if (writeToken) {
            writeToken(token);
          } else {
            process.stdout.write(token);
          }

          if (accumulateToPartial) {
            accumulateToPartial(token);
          }

          const now = Date.now();
          if (now - lastUpdate > 600) {
            const elapsed = (now - started) / 1000;
            const tpm = elapsed > 0 ? Math.round((tokenCount / elapsed) * 60) : tokenCount;
            state.streamingTokMin = tpm;
            process.stdout.write(kleur.gray(`  \b\b${tokenCount} tok · ${elapsed.toFixed(1)}s · ${tpm} tpm`) + '\x1b[K');
            lastUpdate = now;
          }
        }

        state.backend.lastLatencyMs = Date.now() - started;
        const reply = replyTokens.join('');
        pushAssistant(state, reply || '(empty response)');
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        const speed = replyTokens.length ? Math.round((replyTokens.length / (Date.now() - started)) * 60000) : 0;
        // Track last reply summary for the Status card
        state.lastOutputTokens = tokenCount;
        state.lastReplyDurationMs = Date.now() - started;
        state.lastReplyTpm = speed;
        state.lastReplyTimestamp = Date.now();
        state.lastReplyCost = (tokenCount / 1_000_000) * 0.6;
        console.log('\n' + kleur.green('✓ explained in ' + elapsed + 's') + kleur.gray(' (~' + speed + ' tok/min)'));
      } catch (err) {
        state.backend.lastLatencyMs = Date.now() - started;
        pushAssistant(state, `Explanation failed: ${err.message}`);
        console.log('\b\b\n' + kleur.red('✗ ' + err.message));
      } finally {
        stopTypingDots();
        state.busy = false;
        state.typingIndicator = false;
        state.streamAutoScroll = false;
        state.streamingPartial = '';
        state.status = 'Ready';
      }
      return { quit: false };
    }
    case 'retry': {
      // Retry the last failed request: finds the last user message, removes the
      // preceding assistant reply, and resubmits the same prompt with fresh state.
      if (state.messages.length < 2) {
        pushAssistant(state, 'No message to retry. Send a message first.');
        return { quit: false };
      }
      let userMsg = null;
      let userIdx = -1;
      for (let i = state.messages.length - 1; i >= 0; i--) {
        if (state.messages[i].role === 'user') {
          userMsg = state.messages[i].content;
          userIdx = i;
          break;
        }
      }
      if (!userMsg) {
        pushAssistant(state, 'No user message found to retry.');
        return { quit: false };
      }
      // Remove the last assistant response(s) so we regenerate them
      if (state.messages[state.messages.length - 1]?.role === 'assistant') {
        state.messages = state.messages.slice(0, userIdx + 1);
        state.messageTimestamps = state.messageTimestamps.slice(0, userIdx + 1);
      }
      pushAssistant(state, `Retrying: "${truncate(userMsg, 60)}"…`);
      // Strip the "Retrying" note we just added
      state.messages.pop();
      state.messageTimestamps.pop();
      // Push user message fresh so sendPrompt records it correctly
      state.messages.push({ role: 'user', content: userMsg });
      state.messageTimestamps.push(Date.now());
      try {
        await sendPrompt(state, userMsg, {
          writeToken,
          accumulateToPartial: (token) => { state.streamingPartial += token; },
          redraw,
        });
      } catch (err) {
        pushAssistant(state, `Retry failed: ${err.message}`);
        state.status = 'Ready';
        state.busy = false;
      }
      state.streamingPartial = '';
      if (state.config.autosave) saveConfig(state.config);
      redraw();
      return { quit: false };
    }
    case 'runcodeblock':
      await handleRunCodeBlock(state, redraw, sessionCallbacks);
      return { quit: false };
    default:
      pushAssistant(state, `Unknown command: ${command}`);
      return { quit: false };
  }
}

export async function sendPrompt(state, prompt, options = {}) {
  let writeToken = typeof options === 'function' ? options : options.writeToken;
  const accumulateToPartial = typeof options === 'function' ? null : options.accumulateToPartial;
  const scheduleRedraw = typeof options === 'function' ? null : options.redraw;

  const context = [...state.contextPaths].slice(0, 8).map((relPath) => ({
    path: relPath,
    content: readPreview(state.cwd, relPath, 6000),
  }));

  const thinkDirective = state.thinkMode
    ? 'Before providing your final answer, briefly outline your reasoning in a collapsible ...</think> block. Show your thinking process step-by-step, then after the block, give your direct answer.'
    : '';

  const system = [
    state.config.systemPrompt,
    thinkDirective,
    `Workspace root: ${state.cwd}`,
    context.length ? `Context files:\n${context.map((item) => `### ${item.path}\n${item.content}`).join('\n\n')}` : 'No extra context files selected.',
  ].filter(Boolean).join('\n\n');

  const messages = [
    { role: 'system', content: system },
    ...state.messages.slice(-12),
    { role: 'user', content: prompt },
  ];

  state.messages.push({ role: 'user', content: prompt });
  state.messageTimestamps.push(Date.now());
  state.status = 'Streaming response';
  state.busy = true;
  state.streamingStartTime = Date.now();
  state.streamingTokMin = null;
  state.streamingTokenCount = 0;
  state.streamingPartial = '';
  state.typingIndicator = true;
  state.typingDots = 0;

  const started = Date.now();
  const replyTokens = [];
  const controller = new AbortController();

  let cursorChar = '█';
  let cursorVisible = true;
  let cursorInterval;
  let tokenCount = 0;
  let lastUpdate = started;
  let lastPartialUpdate = started;

  // Typing dots animation — cycles 0..3 every 400ms while waiting for first token
  let typingTimer = null;
  const startTypingDots = () => {
    if (typingTimer) return;
    typingTimer = setInterval(() => {
      state.typingDots = (state.typingDots + 1) % 4;
      scheduleRedraw?.();
    }, 400);
  };
  const stopTypingDots = () => {
    if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
    state.typingDots = 0;
  };
  startTypingDots();

  const showCursor = () => {
    process.stdout.write(cursorVisible ? kleur.green(cursorChar) : ' ');
    cursorVisible = !cursorVisible;
  };

  // Track partial markdown lines for language-aware streaming highlight
  let partialLine = '';
  let codeLang = 'text';
  let inCodeBlock = false;
  let codeBlockStarted = false;

  const flushLine = () => {
    if (!partialLine) return;
    const trimmed = partialLine.trimEnd();
    if (!trimmed) {
      partialLine = '';
      return;
    }
    // Detect fence language switches even in partial content
    const fenceOpen = trimmed.match(/^```(\w*)/);
    if (fenceOpen) {
      const lang = fenceOpen[1]?.trim() || 'text';
      codeLang = lang;
      inCodeBlock = !inCodeBlock;
      codeBlockStarted = true;
      process.stdout.write(kleur.gray(trimmed) + '\n');
      partialLine = '';
      return;
    }
    if (inCodeBlock) {
      process.stdout.write(colourLine(trimmed, codeLang) + '\n');
    } else {
      process.stdout.write(kleur.white(trimmed) + '\n');
    }
    partialLine = '';
  };

  writeToken = (token) => {
    partialLine += token;
    if (token === '\n') {
      flushLine();
      return;
    }
    // Write char-by-char to keep cursor position accurate
    process.stdout.write(token);
  };

  const updateThroughput = () => {
    const elapsed = (Date.now() - started) / 1000;
    const mins = elapsed / 60;
    const tpm = mins > 0 ? Math.round((tokenCount / mins) * 60000) : tokenCount;
    state.streamingTokMin = tpm;
    const line = `\b\b  \b\b${kleur.green(tokenCount + ' tok')} ${kleur.gray(`· ${elapsed.toFixed(1)}s · ${tpm} tok/min`)}`;
    process.stdout.write(line + '\x1b[K');
  };

  process.stdout.write(kleur.green('\nAssistant: '));

  const abortHandler = () => {
    if (cursorInterval) clearInterval(cursorInterval);
    controller.abort();
    state.busy = false;
    state.status = 'Aborted';
  };
  process.on('SIGINT', abortHandler, { once: true });

  try {
    for await (const token of streamChatCompletion({
      baseUrl: state.config.baseUrl,
      apiKey: state.config.apiKey,
      model: state.config.model,
      messages,
      temperature: state.config.temperature,
      maxTokens: state.config.maxTokens,
      retries: state.config.retries,
    }, controller.signal)) {
      // Clear typing indicator on first token — real response has started
      if (tokenCount === 0) {
        state.typingIndicator = false;
        // Auto-scroll: if user is at bottom (scroll=0) when streaming starts, keep them there.
        // If they manually scrolled up, don't fight their scroll position.
        state.streamAutoScroll = true;
        scheduleRedraw?.();
      }
      if (cursorInterval) clearInterval(cursorInterval);
      process.stdout.write('\b\b');
      replyTokens.push(token);
      tokenCount++;
      state.streamingTokenCount = tokenCount;

      // Write token (highlighted if writeToken provided)
      if (writeToken) {
        writeToken(token);
      } else {
        process.stdout.write(token);
      }

      // Accumulate into streamingPartial so the conversation pane stays in sync
      if (accumulateToPartial) {
        accumulateToPartial(token);
      }

      const now = Date.now();

      // Redraw the TUI pane every ~20 tokens so the conversation pane shows the reply live
      if (scheduleRedraw && now - lastPartialUpdate > 300 && tokenCount % 20 === 0) {
        lastPartialUpdate = now;
        scheduleRedraw();
      }

      if (now - lastUpdate > 600) {
        updateThroughput();
        lastUpdate = now;
      }
      cursorInterval = setInterval(showCursor, 400);
    }

    if (cursorInterval) clearInterval(cursorInterval);
    process.stdout.write('\b\b');
    state.backend.lastLatencyMs = Date.now() - started;
    const reply = replyTokens.join('');
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const speed = replyTokens.length ? Math.round((replyTokens.length / (Date.now() - started)) * 60000) : 0;
    state.messages.push({ role: 'assistant', content: reply || '(empty response)' });
    state.messageTimestamps.push(Date.now());
    state.status = 'Reply received';
    state.lastError = '';

    // Track last reply summary for the Status card
    state.lastOutputTokens = tokenCount;
    state.lastReplyDurationMs = Date.now() - started;
    state.lastReplyTpm = speed;
    state.lastReplyTimestamp = Date.now();
    state.lastReplyCost = (tokenCount / 1_000_000) * 0.6;

    // Parse thinking blocks and extract any diff/ result blocks added by the model
    const diffResult = parseThinkingAndExtractDiffs(reply);
    if (diffResult) {
      state.lastResponseDiff = diffResult.diffContent || null;
      state.diffExpanded = false;
    } else {
      state.lastResponseDiff = null;
      state.diffExpanded = false;
    }

    console.log('\n' + kleur.green('✓ ' + replyTokens.length + ' tokens in ' + elapsed + 's') + kleur.gray(' (~' + speed + ' tok/min)'));
  } catch (error) {
    if (cursorInterval) clearInterval(cursorInterval);
    state.backend.lastLatencyMs = Date.now() - started;
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    state.messages.push({ role: 'assistant', content: `Request failed: ${message}` });
    state.status = 'Request failed';
    console.log('\b\b\n' + kleur.red('✗ ' + message));
  } finally {
    process.off('SIGINT', abortHandler);
    state.busy = false;
    state.typingIndicator = false;
    state.streamAutoScroll = false;
    state.streamingPartial = '';
  }
}

// ─── Code block extraction ────────────────────────────────────────────────────

/**
 * Parse fenced code blocks from a message body.
 * Returns an array of { lang, code, index } for each block.
 */
export function parseCodeBlocks(content) {
  if (!content) return [];
  const blocks = [];
  // Match ```lang\ncode\n``` or ```code\n``` patterns
  const fenceRe = /```(\w*)\n?([\s\S]*?)```/g;
  let match;
  while ((match = fenceRe.exec(content)) !== null) {
    blocks.push({
      lang: match[1]?.trim() || 'text',
      code: match[2].replace(/\n+$/, ''),
      index: blocks.length,
    });
  }
  return blocks;
}

/**
 * Run a code block in a child process and stream output into the conversation.
 * lang: 'js' | 'py' | 'sh' | 'text' (plain shell)
 * onOutput(chunk, isError): called per output line
 * onDone(exitCode): called on process exit
 * Returns the child process handle (for abort).
 */
export async function runCodeBlock({ lang, code, cwd, onOutput, onDone }) {
  const { spawn } = await import('node:child_process');

  let shell;
  let cmdArgs;
  if (lang === 'js' || lang === 'ts') {
    shell = 'node';
    cmdArgs = ['--input-type=module'];
    // Prepend stdin wrapper so imports work
    const wrapped = `import { readFileSync } from 'node:fs';\n${code}`;
    cmdArgs._stdinContent = wrapped;
  } else if (lang === 'py') {
    shell = 'python3';
    cmdArgs = ['-c', code];
  } else if (lang === 'sh' || lang === 'bash' || lang === 'shell' || lang === 'text') {
    shell = 'sh';
    cmdArgs = ['-c', code];
  } else {
    shell = lang;
    cmdArgs = code.split(/\s+/);
  }

  const child = spawn(shell, cmdArgs, { cwd, env: process.env });

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8').replace(/\n+$/, '');
    if (text) onOutput(text, false);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString('utf8').replace(/\n+$/, '');
    if (text) onOutput(text, true);
  });

  child.on('close', (code) => onDone(code ?? 0));
  child.on('error', (err) => onOutput(`error: ${err.message}`, true));

  return child;
}

// Add runcodeblock handler to handleSlashCommand — called programmatically
// (case 'runcodeblock' is used internally by bin/orbitron for Ctrl+J)
export async function handleRunCodeBlock(state, redraw, sessionCallbacks) {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== 'assistant') return;

  const blocks = parseCodeBlocks(last.content);
  if (!blocks.length) return;

  const block = blocks[0];
  const shell = block.lang === 'py' ? 'python3' : block.lang === 'js' || block.lang === 'ts' ? 'node' : 'sh';

  state.messages.push({ role: 'system', content: `⏳ Running (${shell}): ${block.lang || 'shell'}…` });
  state.messageTimestamps.push(Date.now());
  redraw();

  let outputLines = [];
  let stderrLines = [];
  let exited = -1;

  try {
    await runCodeBlock({
      lang: block.lang,
      code: block.code,
      cwd: state.cwd,
      onOutput: (text, isError) => {
        if (isError) stderrLines.push(text);
        else outputLines.push(text);
      },
      onDone: (code) => {
        exited = code;
      },
    });
    // Wait briefly for process to finish
    await new Promise(r => setTimeout(r, 300));
  } catch (err) {
    stderrLines.push(err.message);
  }

  const output = [...outputLines, ...stderrLines].join('\n');
  state.messages.push({
    role: 'system',
    content: exited === 0
      ? (output || '(no output)')
      : `(exited ${exited})${output ? '\n' + output : ''}`,
  });
  state.messageTimestamps.push(Date.now());
  redraw();
}

export const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all commands' },
  { name: '/explain', description: 'Explain a file in context or selected in the explorer' },
  { name: '/models', description: 'Fetch and pick a model' },
  { name: '/model', description: 'Set active model (use alone to pick)' },
  { name: '/mode', description: 'Set mode (default/max/plan/lite) or cycle forward — Shift+Tab also cycles' },
  { name: '/settings', description: 'Interactive settings editor' },
  { name: '/status', description: 'Show runtime status' },
  { name: '/search', description: 'Search conversation history' },
  { name: '/clear', description: 'Clear conversation' },
  { name: '/export', description: 'Save transcript to a file' },
  { name: '/copy', description: 'Copy transcript (alias for /export)' },
  { name: '/sessions', description: 'Browse and restore saved sessions' },
  { name: '/think', description: 'Toggle reasoning display before answer' },
  { name: '/compact', description: 'Toggle compact single-column layout (also: /c)' },
  { name: '/c', description: 'Alias for /compact — toggle compact layout' },
  { name: '/set', description: 'Update a config field: /set <field> <value>' },
  { name: '/include', description: 'Add a file to context: /include <path>' },
  { name: '/exclude', description: 'Remove a file from context' },
  { name: '/files', description: 'Re-index workspace files' },
  { name: '/context', description: 'Manage context files and budget' },
  { name: '/write', description: 'Create/overwrite a file interactively' },
  { name: '/append', description: 'Append to a file interactively' },
  { name: '/run', description: 'Run a shell command: /run <command>' },
  { name: '/retry', description: 'Retry the last failed request' },
  { name: '/grep', description: 'Search workspace files for a pattern' },
  { name: '/expand', description: 'Expand or collapse the last model result block' },
  { name: '/collapse', description: 'Collapse the last model result block' },
  { name: '/quit', description: 'Exit Orbitron' },
  { name: '/commit', description: 'Stage all and commit (optional: /commit <msg> or open inline editor)' },
  { name: '/diff', description: 'Show uncommitted git changes with paginated diff viewer' },
];

export const COMMAND_COMPLETIONS = [
  '/help', '/models', '/settings', '/status', '/search', '/clear', '/quit',
  '/set', '/model', '/mode', '/include', '/exclude', '/export', '/copy',
  '/theme', '/context', '/files', '/write', '/append', '/run', '/sessions', '/save',
  '/compact', '/c', '/retry', '/explain', '/grep', '/expand', '/collapse', '/commit', '/diff',
];

export const CONFIG_FIELD_COMPLETIONS = [
  'chatPath', 'modelsPath', 'model', 'temperature',
  'maxTokens', 'systemPrompt', 'autosave', 'theme',
];
