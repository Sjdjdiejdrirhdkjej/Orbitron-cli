import kleur from 'kleur';
import { renderModelsCard, renderScreen, renderSettingsCard, renderStatusCard } from './render.js';
import { renderKeyboardHelp, renderBudgetMeter } from './screens/overview.js';
import { readPreview } from './files.js';

/**
 * Render a rich, Codebuff CLI-style welcome screen with ASCII art,
 * connection status, model info, and quick-reference commands.
 */
export function banner(state = null) {
  const lines = [];

  // ── ASCII art header ─────────────────────────────────────────────
  const logo = [
    '  ╔═══════════════════════════════════════╗',
    '  ║                                       ║',
    '  ║   ██████  ██████  ██████  ████████    ║',
    '  ║  ██    ██ ██   ██ ██   ██ ██          ║',
    '  ║  ██    ██ ██████  ██   ██ █████       ║',
    '  ║  ██    ██ ██   ██ ██   ██ ██          ║',
    '  ║   ██████  ██   ██ ██████  ██          ║',
    '  ║                                       ║',
    '  ╚═══════════════════════════════════════╝',
  ];
  for (const line of logo) {
    lines.push(kleur.cyan(line));
  }
  lines.push('');

  // ── Status line ──────────────────────────────────────────────────
  const health = state?.backend?.health ?? 'unknown';
  const dot = health === 'ok' ? kleur.green('●') : health === 'error' ? kleur.red('●') : kleur.gray('○');
  const statusText = health === 'ok' ? 'connected' : health === 'error' ? 'disconnected' : 'connecting…';
  const latency = state?.backend?.lastLatencyMs ? ` · ${state.backend.lastLatencyMs}ms` : '';
  lines.push(`  ${dot}  ${kleur.gray('backend')} ${kleur.cyan(statusText)}${kleur.gray(latency)}`);

  // ── Model / config info ──────────────────────────────────────────
  const model = state?.config?.model ?? 'gpt-4.1-mini';
  const temp = state?.config?.temperature ?? 0.2;
  const maxTok = state?.config?.maxTokens ?? 2048;
  lines.push(`  ${kleur.gray('model')} ${kleur.cyan(model)} ${kleur.gray('·')} ${kleur.gray('temp')} ${kleur.cyan(temp)} ${kleur.gray('·')} ${kleur.gray('max')} ${kleur.cyan(maxTok)}`);

  // ── Workspace / git ──────────────────────────────────────────────
  if (state?.gitBranch) {
    const dirty = state.gitStatus === 'dirty';
    const branchColor = dirty ? kleur.yellow : kleur.green;
    const statusIcon = dirty ? kleur.red('*') : kleur.green('✓');
    lines.push(`  ${kleur.gray('git')} ${branchColor(state.gitBranch)} ${statusIcon}`);
  }
  if (state?.cwd) {
    const folder = state.cwd.split('/').filter(Boolean).pop() ?? state.cwd;
    lines.push(`  ${kleur.gray('cwd')} ${kleur.cyan(folder)}`);
  }
  lines.push('');

  // ── Quick reference ──────────────────────────────────────────────
  lines.push(`  ${kleur.bold('Quick Reference')}`);
  lines.push(`  ${kleur.gray('─'.repeat(45))}`);
  const shortcuts = [
    ['⏎', 'send', '↑↓', 'history'],
    ['Tab', 'complete', '⌘P', 'commands'],
    ['/clear', 'clear chat', '/models', 'pick model'],
    ['/help', 'all commands', 'Esc', 'close'],
  ];
  for (const [k1, v1, k2, v2] of shortcuts) {
    const left = `${kleur.cyan().inverse(` ${k1} `)} ${kleur.gray(v1)}`;
    const right = `${kleur.cyan().inverse(` ${k2} `)} ${kleur.gray(v2)}`;
    lines.push(`  ${left.padEnd(24)} ${right}`);
  }
  lines.push(`  ${kleur.gray('─'.repeat(45))}`);
  lines.push('');

  // ── Prompt ───────────────────────────────────────────────────────
  lines.push(`  ${kleur.green('Ready')} ${kleur.gray('— type your first message')}`);
  lines.push('');

  return lines.join('\n');
}

export function renderTranscript(messages, limit = 18) {
  const slice = messages.slice(-limit);
  return slice
    .map((message) => {
      const label = message.role === 'assistant' ? kleur.green('assistant') : message.role === 'system' ? kleur.yellow('system') : kleur.cyan('you');
      return `${label} ${kleur.gray('›')} ${message.content}`;
    })
    .join('\n\n');
}

export { renderStatusCard as renderStatus, renderSettingsCard as renderSettings, renderModelsCard as renderModels, renderScreen };

export function renderHelp() {
  return [
    kleur.bold('Orbitron commands'),
    kleur.gray('/help      Show this help'),
    kleur.gray('/status    Show the pinned backend snapshot'),
    kleur.gray('/mode      Cycle or set the active mode (default/max/plan/lite)'),
    kleur.gray('/models    Refresh available models'),
    kleur.gray('/settings  Edit config values'),
    kleur.gray('/clear     Clear the transcript'),
    kleur.gray('/quit      Exit Orbitron'),
    kleur.gray('/set <field> <value>   Update a config field quickly'),
    kleur.gray('/model <name>          Set the active model'),
    kleur.gray('/include <path>        Add a file to context'),
    kleur.gray('/exclude <path>        Remove a file from context'),
    kleur.gray('/export <path>         Export the transcript to a file'),
    kleur.gray('/copy <path>           Copy the transcript to the clipboard'),
    kleur.bold('Keyboard shortcuts'),
    kleur.gray('Tab       Auto-complete commands and model names'),
    kleur.gray('Shift+Tab Cycle modes backwards'),
    kleur.gray('Up/Down   Navigate command history'),
    kleur.gray('Ctrl+A/E  Jump to start/end of input line'),
    kleur.gray('Ctrl+W    Delete previous word'),
    kleur.gray('Ctrl+K    Delete from cursor to end of line'),
    kleur.gray('Ctrl+U    Clear from cursor to line start'),
    kleur.gray('Enter     Send message or finish a blank line'),
    kleur.gray('```<lang>  Enter code-block mode — type code, close with another ``` on its own line'),
    kleur.gray('Ctrl+C    Abort streaming, keep user message'),
    kleur.gray('Ctrl+L    Clear screen'),
  ].join('\n');
}

export function promptCommandPalette(commands, initialQuery = '') {
  let filtered = filterCommands(commands, initialQuery);
  if (!filtered.length) return null;

  let selected = 0;

  process.stdout.write('\x1b[?25l'); // hide cursor

  function draw() {
    const maxLines = 12;
    const visible = filtered.slice(0, maxLines);
    process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(kleur.bold('▸ Orbitron Commands\n'));
    process.stdout.write(kleur.gray('─'.repeat(60)) + '\n');
    for (const cmd of visible) {
      const marker = cmd === filtered[selected] ? kleur.inverse('▶') : ' ';
      const nameLen = Math.max(...filtered.map(c => c.name.length));
      const paddedName = cmd.name.padEnd(nameLen + 2, ' ');
      process.stdout.write(`${marker} ${kleur.cyan(paddedName)}${kleur.gray(cmd.description ?? '')}\n`);
    }
    process.stdout.write(kleur.gray('─'.repeat(60)) + '\n');
    const qDisplay = initialQuery
      ? kleur.cyan('Filter: ') + kleur.yellow(initialQuery)
      : kleur.gray('Type to filter · ↑↓ navigate · Enter select · Esc cancel');
    process.stdout.write(qDisplay + '\n');
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
        if (str === '\x1b') {
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
        resolve(filtered[selected]?.name ?? null);
        return;
      }
      if (str === '\u007f') {
        initialQuery = initialQuery.slice(0, -1);
        filtered = filterCommands(commands, initialQuery);
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        draw();
        return;
      }
      if (str >= ' ' || str === '/') {
        initialQuery += str;
        filtered = filterCommands(commands, initialQuery);
        selected = Math.min(selected, Math.max(0, filtered.length - 1));
        draw();
        return;
      }
    };

    process.stdin.on('data', handler);
    draw();
  });
}

export const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all commands' },
  { name: '/status', description: 'Show the pinned backend snapshot' },
  { name: '/explain', description: 'Explain a file in context or selected in the explorer' },
  { name: '/models', description: 'Fetch and pick a model' },
  { name: '/model', description: 'Set active model (use alone to pick)' },
  { name: '/mode', description: 'Set mode (default/max/plan/lite) or cycle forward — Shift+Tab also cycles' },
  { name: '/settings', description: 'Interactive settings editor' },
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

function fuzzyScore(cmd, query) {
  const name = cmd.name.toLowerCase();
  const desc = (cmd.description ?? '').toLowerCase();
  const q = query.toLowerCase().replace(/^\/+/, '');

  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (desc.includes(q)) return 3;

  let score = 4;
  let qi = 0;
  for (const ch of name) {
    if (qi < q.length && ch === q[qi]) {
      score += 1;
      qi++;
    }
  }
  return qi === q.length ? score : 99;
}

function filterCommands(commands, query) {
  if (!query.trim()) return [...commands];
  return [...commands]
    .map(cmd => ({ cmd, score: fuzzyScore(cmd, query) }))
    .sort((a, b) => a.score - b.score)
    .map(({ cmd }) => cmd);
}

// Completions for Tab auto-complete
export const COMMAND_COMPLETIONS = [
  '/help', '/status', '/models', '/settings', '/search', '/clear', '/quit',
  '/set', '/model', '/mode', '/include', '/exclude', '/export', '/copy',
  '/theme', '/context', '/files', '/write', '/append', '/run', '/sessions', '/save',
  '/compact', '/c', '/retry', '/explain', '/grep', '/expand', '/collapse', '/commit', '/diff',
];

export const CONFIG_FIELD_COMPLETIONS = [
  'chatPath', 'modelsPath', 'model', 'temperature',
  'maxTokens', 'apiKey', 'systemPrompt', 'autosave', 'theme',
];

export function getCompletions(partial, state) {
  if (partial.startsWith('/set ')) {
    const fieldPart = partial.slice(5);
    return CONFIG_FIELD_COMPLETIONS.filter(f => f.toLowerCase().startsWith(fieldPart.toLowerCase()))
      .map(f => `/set ${f} `);
  }

  if (partial.startsWith('/model ')) {
    return (state.modelList ?? []).map(m => `/model ${m}`).filter(m => m.toLowerCase().startsWith(partial.toLowerCase()));
  }

  const fileCmdPrefixes = ['/include ', '/exclude ', '/explain ', '/write ', '/append '];
  for (const prefix of fileCmdPrefixes) {
    if (partial.startsWith(prefix)) {
      const pathPart = partial.slice(prefix.length);
      const files = state.files ?? [];
      const matches = files
        .map(f => f.path)
        .filter(p => p.toLowerCase().startsWith(pathPart.toLowerCase()))
        .sort()
        .slice(0, 10);
      return matches.map(m => `${prefix}${m}`);
    }
  }

  return COMMAND_COMPLETIONS.filter(cmd => cmd.startsWith(partial.toLowerCase()));
}

export function renderExportPreview(transcript, path) {
  const content = renderTranscript(transcript);
  const filename = path.split('/').pop();
  return [
    kleur.bold('Export Preview'),
    kleur.gray(`File: ${filename}`),
    kleur.gray('Content:'),
    kleur.gray('---'),
    kleur.gray(content),
    kleur.gray('---'),
    kleur.gray('To export, run:'),
    kleur.gray(`  /export ${path}`),
  ].join('\n');
}

export function promptKeyboardHelp() {
  const help = renderKeyboardHelp();
  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(kleur.bold('▸ Keyboard Help\n'));
  process.stdout.write(kleur.gray('─'.repeat(60)) + '\n');
  process.stdout.write(help);
  process.stdout.write(kleur.gray('─'.repeat(60)) + '\n');
  process.stdout.write(kleur.gray('Press any key to continue...'));
  return new Promise((resolve) => {
    process.stdin.once('data', () => {
      process.stdout.write('\x1b[2J\x1b[H');
      resolve();
    });
  });
}

// ─── Context Manager overlay ───────────────────────────────────────────────────

export function renderContextManager(state, width = 70) {
  const lines = [];
  lines.push(kleur.bold('▸ Context Manager'));
  lines.push(kleur.gray('─'.repeat(width)));

  const ctxFiles = [...state.contextPaths].sort();
  if (ctxFiles.length === 0) {
    lines.push(kleur.gray('  No context files included.'));
  } else {
    lines.push(kleur.gray(`  ${kleur.green('Included files')} (press number to remove):`));
    for (let i = 0; i < ctxFiles.length; i++) {
      const relPath = ctxFiles[i];
      const content = readPreview(state.cwd, relPath, 6000);
      const tokens = estimateTokens(content);
      const marker = kleur.cyan(`[${i + 1}]`);
      const pathCol = relPath.padEnd(Math.max(...ctxFiles.map(p => p.length), 20));
      const tokCol = kleur.gray(`≈${tokens} tok`);
      lines.push(`  ${marker} ${kleur.green(pathCol)}  ${tokCol}`);
    }
    const allContent = ctxFiles.map(p => readPreview(state.cwd, p, 6000)).join('\n');
    const totalTokens = estimateTokens(allContent);
    lines.push(kleur.gray(`  Total context: ${ctxFiles.length} files · ≈${totalTokens} ctx tok`));
  }

  lines.push(kleur.gray('─'.repeat(width)));

  const sysPrompt = state.config.systemPrompt ?? '';
  const sysLines = sysPrompt.split('\n').slice(0, 4);
  const sysPreview = sysLines.join(' ');
  lines.push(kleur.gray(`  ${kleur.bold('System prompt')} (${sysPrompt.length} chars):`));
  lines.push(kleur.gray(`  ${truncate(sysPreview, width - 6)}`));
  if (sysPrompt.length > 0) lines.push(kleur.gray('  (edit via /set systemPrompt <text> or /settings)'));

  lines.push(kleur.gray('─'.repeat(width)));
  lines.push(kleur.gray(`  model: ${state.config.model}  ·  temp: ${state.config.temperature}  ·  max-tok: ${state.config.maxTokens}`));
  lines.push(kleur.gray('─'.repeat(width)));
  lines.push(kleur.gray('  1–9 = remove file  Enter = close  Tab = add selected file to context  Esc = cancel'));

  return lines;
}

export function promptContextManager(state) {
  return new Promise((resolve) => {
    process.stdout.write('\x1b[?25l');

    function draw() {
      process.stdout.write('\x1b[2J\x1b[H');
      const width = process.stdout.columns || 80;
      const lines = renderContextManager(state, width);
      for (const line of lines) process.stdout.write(line + '\n');
    }

    const ctxFiles = [...state.contextPaths].sort();

    draw();

    let escapeBuffer = '';
    const handler = (chunk) => {
      const str = chunk.toString('utf8');

      if (str === '\u0003') {
        process.stdout.write('\x1b[?25h');
        process.off('data', handler);
        resolve(false);
        return;
      }

      if (str === '\x1b') {
        escapeBuffer = '\x1b';
        return;
      }

      if (escapeBuffer === '\x1b') {
        escapeBuffer = '';
        if (str === '\x1b' || str === '[C' || str === '[D') {
          process.stdout.write('\x1b[?25h');
          process.off('data', handler);
          resolve(false);
          return;
        }
        return;
      }

      if (str === '\r' || str === '\n') {
        process.stdout.write('\x1b[?25h');
        process.off('data', handler);
        resolve(false);
        return;
      }

      const num = parseInt(str, 10);
      if (num >= 1 && num <= ctxFiles.length) {
        const toRemove = ctxFiles[num - 1];
        state.contextPaths.delete(toRemove);
        ctxFiles.splice(num - 1, 1);
        if (ctxFiles.length === 0) state.contextPaths.clear();
        draw();
        return;
      }

      if (str === '\t') {
        const selected = state.files[state.selectedFileIndex];
        if (selected && selected.type === 'file' && !state.contextPaths.has(selected.path)) {
          state.contextPaths.add(selected.path);
          ctxFiles.push(selected.path);
          ctxFiles.sort();
        }
        draw();
        return;
      }
    };

    process.stdin.on('data', handler);
  });
}

export function renderSessionPicker(sessions, selectedIndex, width = 70) {
  const lines = [];
  lines.push(kleur.bold('▸ Session Browser'));
  lines.push(kleur.gray('─'.repeat(width)));
  if (!sessions.length) {
    lines.push(kleur.gray('  No saved sessions found. Use /sessions to save one.'));
    lines.push(kleur.gray('─'.repeat(width)));
    lines.push(kleur.gray('  Enter = close'));
    return lines;
  }
  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    const marker = i === selectedIndex ? kleur.inverse('▶') : ' ';
    const timeStr = formatSessionTime(s.savedAt);
    const msgStr = `${s.messageCount} msg${s.messageCount !== 1 ? 's' : ''}`;
    const nameStr = s.name.replace(/\.json$/, '');
    const detail = `${timeStr} · ${msgStr}`;
    lines.push(`  ${marker} ${kleur.cyan(nameStr.padEnd(24))}  ${kleur.gray(detail)}`);
    if (s.preview) {
      const previewText = s.preview.slice(0, width - 8).replace(/\n/g, ' ');
      lines.push(kleur.gray(`    ${previewText}`));
    }
  }
  lines.push(kleur.gray('─'.repeat(width)));
  lines.push(kleur.gray('  ↑↓ navigate  Enter=restore  Esc=cancel'));
  return lines;
}

export async function promptSessionPicker(sessions) {
  if (!sessions.length) return null;

  let selected = 0;

  process.stdout.write('\x1b[?25l');

  function draw() {
    const width = process.stdout.columns || 80;
    process.stdout.write('\x1b[2J\x1b[H');
    const lines = renderSessionPicker(sessions, selected, width);
    for (const line of lines) process.stdout.write(line + '\n');
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
          selected = Math.min(sessions.length - 1, selected + 1);
          draw();
          return;
        }
        if (str === '\x1b') {
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
        resolve(sessions[selected] ?? null);
        return;
      }
      if (str === '\u007f') {
        return;
      }
    };

    process.stdin.on('data', handler);
    draw();
  });
}

function formatSessionTime(savedAt) {
  if (!savedAt) return 'unknown';
  const diff = Date.now() - savedAt.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return savedAt.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}