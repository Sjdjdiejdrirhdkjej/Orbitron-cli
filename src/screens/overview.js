import fs from 'node:fs';
import path from 'node:path';
import kleur from 'kleur';
import { estimateCost, estimateTokens, pad, repeat, truncate, wrapText } from '../render.js';
import { readPreview, formatFileSize, formatFileMtime } from '../files.js';
import { cycleMode, formatModeName, MODE_NAMES } from '../state.js';

function renderModeStrip(state, width) {
  const current = String(state.mode ?? 'default').trim().toLowerCase();
  const parts = MODE_NAMES.map((mode) => {
    const label = formatModeName(mode);
    return mode === current ? kleur.bold().cyan(label) : kleur.gray(label);
  });
  return truncate(`${kleur.gray('Mode: ')}${parts.join(kleur.gray(' | '))}${kleur.gray('   /mode   Shift+Tab')}`, width);
}

function renderGitInfo(state) {
  const branchIcon = '⎇';
  const parts = [];
  if (state.gitBranch) {
    const dirty = state.gitStatus === 'dirty';
    const branchColor = dirty ? kleur.yellow(state.gitBranch) : kleur.green(state.gitBranch);
    const statusIcon = dirty ? kleur.red('*') : kleur.green('✓');
    parts.push(kleur.gray(`${branchIcon} ${branchColor} ${statusIcon}`));
  }
  return parts.join(kleur.gray(' · '));
}

function renderConnectionDot(state) {
  if (state.backend?.health === 'ok') {
    return kleur.green('●');
  } else if (state.backend?.health === 'error') {
    return kleur.red('●');
  }
  return kleur.gray('○');
}

function formatDuration(ms) {
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function renderSlimBanner(state, width) {
  const gitInfo = renderGitInfo(state);
  const connDot = renderConnectionDot(state);
  const sessionAge = state.conversationStartedAt
    ? kleur.gray(`session ${formatDuration(Date.now() - state.conversationStartedAt)}`)
    : '';
  const lines = [
    truncate(
      kleur.cyan().bold('Orbitron')
      + kleur.gray('  ')
      + kleur.white().bold('「')
      + kleur.cyan(state.config.model)
      + kleur.white().bold('」')
      + kleur.gray('  ·  ')
      + (gitInfo || '')
      + (sessionAge ? kleur.gray('  ·  ') + sessionAge : '')
      + kleur.gray('  ·  ')
      + kleur.gray(connDot + ' ' + (state.config.baseUrl.replace('https://', '').replace('http://', ''))),
      width
    ),
    truncate(
      kleur.gray('mode ')
      + kleur.white(formatModeName(state.mode))
      + kleur.gray('  ·  cwd ')
      + kleur.cyan(state.cwd.split('/').filter(Boolean).pop() ?? state.cwd)
      + kleur.gray('  ·  /mode to switch  ·  /help for commands'),
      width
    ),
  ];
  return lines.filter(l => l.trim().length > 0);
}

function renderCompactBanner(state, width) {
  const gitInfo = renderGitInfo(state);
  return [
    truncate(
      kleur.cyan().bold('Orbitron')
      + kleur.gray(' · ')
      + kleur.white(state.config.model)
      + kleur.gray(' · ')
      + kleur.cyan(formatModeName(state.mode))
      + (gitInfo ? kleur.gray(' · ') + gitInfo : '')
      + kleur.gray(' · /mode · /help'),
      width
    ),
  ];
}

/**
 * Detect language from file extension.
 */
function langFromExt(ext) {
  const map = {
    js: 'js', ts: 'js', jsx: 'js', tsx: 'js', mjs: 'js', cjs: 'js',
    py: 'py', pyw: 'py',
    json: 'json', jsonc: 'json',
    html: 'html', htm: 'html',
    css: 'css', scss: 'css', less: 'css',
    sh: 'sh', bash: 'sh', zsh: 'sh',
    md: 'md', markdown: 'md',
    yaml: 'yaml', yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    cs: 'csharp', rb: 'ruby', php: 'php',
    txt: 'text', text: 'text',
  };
  return map[ext?.toLowerCase()] ?? 'text';
}

/**
 * Read file synchronously, return array of lines or null on error.
 */
export function readFilePreviewSync(absPath, maxLines = 24) {
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const lines = raw.split('\n');
    return { lines, total: lines.length };
  } catch {
    return null;
  }
}

/**
 * Colourise a single line of code based on detected language (file extension).
 * Zero-dependency — uses only kleur primitives.
 */
function colourLine(line, lang) {
  if (lang === 'py') {
    return line
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m))
      .replace(/#.*/, (m) => kleur.gray(m))
      .replace(/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|raise|pass|break|continue|and|or|not|in|is|lambda|yield|global|nonlocal|True|False|None|async|await)\b/g, (m) => kleur.cyan(m));
  }
  if (lang === 'js' || lang === 'ts') {
    return line
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m))
      .replace(/`[^`]*`/g, (m) => kleur.green(m))
      .replace(/\/\/.*/, (m) => kleur.gray(m))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => kleur.gray(m))
      .replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|this|typeof|instanceof|switch|case|default|break|continue|void|delete|in|of|null|undefined|true|false|interface|type|enum|implements|extends|static|readonly|abstract|private|public|protected)\b/g, (m) => kleur.cyan(m));
  }
  if (lang === 'json') {
    return line
      .replace(/"([^"]+)":?/g, (_, k) => kleur.yellow(`"${k}"`) + (line.includes(':') ? kleur.gray(':') : ''))
      .replace(/\b(true|false|null)\b/g, (m) => kleur.magenta(m))
      .replace(/\b\d+(\.\d+)?([eE][+-]?\d+)?\b/g, (m) => kleur.magenta(m));
  }
  if (lang === 'html') {
    return line
      .replace(/<\/?[\w\-]+/g, (m) => kleur.cyan(m))
      .replace(/>[^<]*/g, (m) => kleur.gray(m))
      .replace(/\s([\w\-]+)=/g, (_, a) => ` ${kleur.yellow(a)}=`)
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m));
  }
  if (lang === 'css') {
    return line
      .replace(/[.#][\w\-]+/g, (m) => kleur.cyan(m))
      .replace(/[\w\-]+:(?!\s)/g, (m) => kleur.yellow(m))
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m))
      .replace(/\/\*[\s\S]*?\*\//g, (m) => kleur.gray(m));
  }
  if (lang === 'sh') {
    return line
      .replace(/#.*/, (m) => kleur.gray(m))
      .replace(/\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit|export|source|alias|echo|read|local|readonly|declare|shift|set|unset|test)\b/g, (m) => kleur.cyan(m))
      .replace(/"[^"]*"/g, (m) => kleur.green(m))
      .replace(/'[^']*'/g, (m) => kleur.green(m));
  }
  if (lang === 'md') {
    return line
      .replace(/#{1,6}\s.*/, (m) => kleur.cyan().bold(m))
      .replace(/```[\w]*\s*/, (m) => kleur.cyan(m))
      .replace(/\*\*[^*]+\*\*/g, (m) => kleur.bold(m))
      .replace(/\*[^*]+\*/g, (m) => kleur.italic(m))
      .replace(/`[^`]+`/g, (m) => kleur.bgBlack().white(m))
      .replace(/\[([^\]]+)\]\([^)]+\)/g, (_, t) => kleur.underline().cyan(t));
  }
  if (lang === 'yaml') {
    return line
      .replace(/^(\s*)(\S[\w\-]*):/, (_, indent, k) => `${indent}${kleur.yellow(k)}:`)
      .replace(/:\s*(".*?"|'.*?')/g, (_, v) => `: ${kleur.green(v)}`)
      .replace(/#.*/, (m) => kleur.gray(m));
  }
  return line;
}

/**
 * Estimate the total tokens and cost for a pending user message.
 * Includes: context files + conversation history (last 12 messages) + current input.
 * Returns { tok, cost } where cost is in USD.
 */
function estimatePendingCost(inputText, state) {
  const ctxFiles = [...state.contextPaths].sort();
  let ctxTok = 0;
  for (const relPath of ctxFiles) {
    const content = readPreview(state.cwd, relPath, 6000);
    ctxTok += estimateTokens(content);
  }
  const histTok = state.messages.slice(-12).reduce((sum, m) => sum + estimateTokens(m.content.slice(0, 300)), 0);
  const inputTok = estimateTokens(inputText);
  const total = ctxTok + histTok + inputTok;
  const costObj = estimateCost(total, 0, state.config.model);
  return { tok: total, cost: costObj.totalCost };
}

export function renderHeader(state, width) {
  if (width < 92) return renderCompactBanner(state, width);
  const workspace = state.cwd.split('/').filter(Boolean).pop() ?? state.cwd;
  const lines = renderSlimBanner(state, width);
  lines.push(truncate(kleur.gray(`Directory ${state.cwd}`), width));
  lines.push(truncate(kleur.gray(`workspace ${workspace} · /mode to switch · /help for commands`), width));
  return lines;
}

function mutedStateLabel(status) {
  return kleur.gray(String(status || 'ready').toLowerCase());
}

/**
 * Render the Status Card — a dense, colour-coded summary panel.
 * Sections (top to bottom by priority):
 *   1. Header — "STATUS" label with session age
 *   2. Connection health — always visible
 *   3. Orchestrator pipeline — shown during multi-stage runs
 *   4. Live streaming bar — replaces idle metrics when busy
 *   5. Last reply stats — token/speed/cost (idle state)
 *   6. Context budget meter
 *   7. Session metadata (messages, mode, backend)
 */
export function renderStatusCard(state, width = 58) {
  const lines = [];
  const w = Math.max(20, width);

  // ── 0. Card header with session age ──────────────────────────────────
  {
    const ageLabel = state.conversationStartedAt
      ? `session ${formatDuration(Date.now() - state.conversationStartedAt)}`
      : 'fresh session';
    lines.push(kleur.bold().gray('▸ STATUS  ') + kleur.gray(ageLabel));
  }

  // ── 1. Connection health ──────────────────────────────────────────────
  if (state.backend?.health === 'ok') {
    const ms = state.backend.lastLatencyMs;
    lines.push(kleur.green('●') + kleur.gray(` connected  ${ms != null ? ms + 'ms' : '…'}`));
  } else if (state.backend?.health === 'error') {
    lines.push(kleur.red('●') + kleur.gray(` disconnected  ${state.backend.lastError ?? 'unreachable'}`));
  } else {
    lines.push(kleur.gray('○') + kleur.gray(' connecting…'));
  }

  // ── 2. Orchestrator pipeline ─────────────────────────────────────────
  if (state.orchestrator?.active) {
    const roles = Array.isArray(state.orchestrator.roles) ? state.orchestrator.roles : [];
    const completed = new Set(state.orchestrator.completedRoles ?? []);
    const currentRole = state.orchestrator.currentRole || '';
    const chain = roles.length
      ? roles.map((role) => {
          if (role === currentRole) return kleur.cyan(role);
          if (completed.has(role)) return kleur.green(role);
          return kleur.gray(role);
        }).join(kleur.gray(' › '))
      : kleur.gray('discover › think › review');
    lines.push(kleur.gray('▸ subagents: ') + chain);
    if (state.orchestrator.currentDetail) {
      lines.push(kleur.gray(`  ${state.orchestrator.currentRole}: ${state.orchestrator.currentDetail}`));
    }
  }

  // ── 3. Live streaming ───────────────────────────────────────────────
  if (state.busy && state.streamingStartTime) {
    const elapsed = ((Date.now() - state.streamingStartTime) / 1000).toFixed(1);
    const count = state.streamingTokenCount ?? 0;
    const tpm = state.streamingTokMin ?? '…';
    const totalBars = Math.min(w - 32, 20);
    const fill = Math.min(totalBars, Math.round(((Date.now() - state.streamingStartTime) / 1000 / 10) * totalBars));
    const empty = totalBars - fill;
    const bar = kleur.green('█'.repeat(fill)) + kleur.gray('░'.repeat(empty));
    lines.push(kleur.green(bar) + kleur.gray(`  ${count}tok  ${elapsed}s  ${tpm}tpm`));
  }

  // ── 4. Last reply stats (idle) ───────────────────────────────────────
  if (!state.busy && state.lastOutputTokens > 0) {
    const dur = (state.lastReplyDurationMs / 1000).toFixed(1);
    const costStr = state.lastReplyCost < 0.001
      ? '<$0.001'
      : `$${state.lastReplyCost.toFixed(4)}`;
    const tpm = state.lastReplyTpm ?? '?';
    lines.push(
      kleur.cyan(String(state.lastOutputTokens).padStart(5)) + kleur.gray(' tok  ')
      + kleur.cyan(dur.padStart(5)) + kleur.gray('s  ')
      + kleur.cyan(String(tpm).padStart(5)) + kleur.gray(' tpm  ')
      + kleur.cyan(costStr)
    );
  }

  // ── 5. Context budget meter ──────────────────────────────────────────
  {
    const ctxFiles = [...state.contextPaths].sort();
    const budget = state.contextBudget ?? 8192;
    const used = state.contextTokens ?? 0;
    const pct = Math.min(1, used / budget);
    const filled = Math.round(pct * 10);
    const emptyBars = 10 - filled;
    const barColor = pct < 0.6 ? kleur.green : pct < 0.85 ? kleur.yellow : kleur.red;
    const bar = barColor('█'.repeat(filled)) + kleur.gray('░'.repeat(emptyBars));
    const pctLabel = `${(pct * 100).toFixed(0)}%`;
    lines.push(bar + ' ' + kleur.gray(pctLabel) + ' ' + kleur.gray(`${used}/${budget}`));
  }

  // ── 6. Session metadata ─────────────────────────────────────────────
  lines.push(
    kleur.gray('▸ msg ') + kleur.white(String(state.messages.length))
    + kleur.gray('  mode ') + kleur.white(formatModeName(state.mode))
    + kleur.gray('  backend ') + kleur.gray(state.config.baseUrl.replace('https://', '').replace('http://', ''))
  );

  return lines.map(line => truncate(line, w));
}

export function renderSettingsCard(config, width = 58) {
  const lines = [
    kleur.bold('Config'),
    kleur.gray(`• config: ${config.configPath ?? 'workspace default'}`),
    kleur.gray(`• chat path: ${config.chatPath}`),
    kleur.gray(`• models path: ${config.modelsPath}`),
    kleur.gray(`• temperature: ${config.temperature}`),
    kleur.gray(`• max tokens: ${config.maxTokens}`),
    kleur.gray(`• API key: ${config.apiKey ? 'set' : 'unset'}`),
    kleur.gray(`• autosave: ${config.autosave ? 'on' : 'off'}`),
    kleur.gray(`• theme: ${config.theme}`),
  ];

  return lines.map((line) => truncate(line, width));
}

export function renderModelsCard(models, width = 58) {
  if (!models.length) return [kleur.bold('Models'), kleur.gray('No models loaded. Use /models to refresh.')];
  return [kleur.bold('Models'), ...models.map((model) => kleur.gray(`• ${truncate(model.id ?? model.name ?? JSON.stringify(model), width - 2)}`))];
}

/**
 * Render the Files pane — workspace file tree with selection and context markers.
 * Layout: [▶][✓ ][icon][name][size·mtime] per row, right-padded to `width`.
 * Selected row uses kleur.inverse highlight.
 * Context-marked files show a green checkmark.
 * Directories use a ▸ icon; files use •.
 */
export function renderFilesPane(files, selectedFileIndex, contextPaths, width, height) {
  const h = Math.max(1, height);
  const w = Math.max(4, width);

  if (!files.length) {
    const emptyLine = truncate(kleur.gray('(no files)'), w);
    return Array(h).fill(emptyLine);
  }

  // Determine how many rows to show from the top of the list
  // so that the selected item is always visible
  const sel = Math.max(0, Math.min(selectedFileIndex, files.length - 1));
  const startIdx = Math.max(0, sel - h + 1);
  const visible = files.slice(startIdx, startIdx + h);

  const rows = visible.map((entry, index) => {
    const absoluteIndex = startIdx + index;
    const isSelected = absoluteIndex === sel;

    // Selection highlight: inverse the whole line
    const prefix = isSelected ? kleur.inverse('▶') : kleur.gray(' ');
    const contextMark = contextPaths.has(entry.path)
      ? (isSelected ? kleur.green('✓') : kleur.green('✓ '))
      : '  ';
    const indent = '  '.repeat(Math.min(entry.depth, 4));
    const icon = entry.type === 'dir' ? '▸' : '•';
    const rel = entry.path;
    const name = rel.split('/').pop() ?? rel;

    // Build the base line
    let line = `${prefix} ${contextMark}${indent}${icon} ${name}`;

    // Add size + mtime for files (not dirs), with ellipsis if needed
    if (entry.type === 'file' && entry._stats) {
      const sizeStr = formatFileSize(entry._stats.size);
      const mtimeStr = formatFileMtime(entry._stats.mtimeMs);
      line += kleur.gray(` · ${sizeStr} · ${mtimeStr}`);
    }

    const truncated = truncate(line, w);

    // Apply inverse highlight to the selected row
    if (isSelected) {
      // Build a masked version: pad to full width, then inverse the visible part
      const padded = truncated.padEnd(w);
      return kleur.inverse(padded);
    }
    return truncated;
  });

  while (rows.length < h) rows.push('');
  return rows;
}

// ─── Auth prompt screen ───────────────────────────────────────────────────────

export function renderAuthPromptScreen(state, width, height, themeColors) {
  const h = Math.max(1, height);
  const { muted = (t) => t, accent = (t) => t, prompt: promptFn = (t) => t } = themeColors;
  const lines = [];

  lines.push(kleur.bold().white('Orbitron') + kleur.gray('  ·  direct chat mode'));
  lines.push(repeat('─', width));

  const midRow = Math.floor(height / 2);
  for (let i = 0; i < Math.max(0, midRow - 5); i++) lines.push('');

  const panelW = Math.min(width - 4, 56);
  const panelX = Math.max(0, Math.floor((width - panelW) / 2));
  const padLeft = ' '.repeat(panelX);

  lines.push(padLeft + kleur.bold().cyan('Pinned backend'));
  lines.push(padLeft + repeat('─', panelW));
  lines.push(padLeft + truncate('Orbitron starts directly in chat; no login gate is required.', panelW));
  lines.push(padLeft + '');
  lines.push(padLeft + kleur.inverse('  Ready to chat  '));
  lines.push(padLeft + '');
  lines.push(padLeft + kleur.gray('If your backend needs a credential, configure it separately.'));

  lines.push(repeat('─', width));
  lines.push(truncate(kleur.gray(`/help  ·  backend: ${state.config.baseUrl}`), width));

  while (lines.length < h) lines.push('');

  return lines.join('\n');
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function renderStreamingPreview(partial, availableHeight, themeColors) {
  if (!partial || availableHeight <= 0) return [];
  const clean = stripAnsi(partial);
  const trimmed = clean.length > 4000 ? clean.slice(-4000) : clean;
  const rawLines = trimmed.split('\n');
  const lines = rawLines.slice(Math.max(0, rawLines.length - availableHeight));
  return lines.map((line) => truncate(renderMarkdownLine(line), 120));
}

function renderMarkdownLine(raw) {
  const trimmed = raw.trim();
  const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const text = headingMatch[2];
    const style = level === 1 ? kleur.bold().cyan : kleur.bold;
    return style(text);
  }
  if (trimmed === '```' || trimmed === '~~~') return kleur.gray(trimmed);
  const fenceMatch = trimmed.match(/^```(\w*)/);
  if (fenceMatch) return kleur.gray('```' + fenceMatch[1]);
  const listMatch = trimmed.match(/^(\s*)([-*+])\s(.+)/);
  if (listMatch) return kleur.gray(listMatch[1] + listMatch[2] + ' ') + renderInlineSpans(listMatch[3]);
  if (trimmed.startsWith('> ')) return kleur.gray('▌ ') + renderInlineSpans(trimmed.slice(2));
  if (!trimmed) return '';
  return renderInlineSpans(trimmed);
}

function renderInlineSpans(text) {
  const spans = [];
  {
    const re = /\*\*\*(.+?)\*\*\*/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: kleur.bold().italic });
  }
  {
    const re = /___(\w[\s\S]*?)___/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: kleur.bold().italic });
  }
  {
    const re = /\*\*(.+?)\*\*/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: kleur.bold });
  }
  {
    const re = /__(.+?)__/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: kleur.bold });
  }
  {
    const re = /(?<!\*)\*([^*\n]+?)\*(?!\*)/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: kleur.italic });
  }
  {
    const re = /(?<!_)_\w[\w]*?_/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: kleur.italic });
  }
  {
    const re = /`([^`]+)`/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: (t) => kleur.bgBlack().white(t) });
  }
  {
    const re = /~~(.+?)~~/g; let m; while ((m = re.exec(text)) !== null) spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: kleur.strikethrough });
  }
  if (!spans.length) return kleur.white(text);
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const result = [];
  let pos = 0;
  for (const span of spans) {
    if (span.start < pos) continue;
    if (span.start > pos) result.push({ text: text.slice(pos, span.start), style: kleur.white });
    result.push({ text: span.text, style: span.style });
    pos = span.end;
  }
  if (pos < text.length) result.push({ text: text.slice(pos), style: kleur.white });
  return result.map(({ text: t, style }) => style(t)).join('');
}

/**
 * Render the chat pane — the main message area with role labels, timestamps,
 * streaming stats, and expand/collapse controls.
 *
 * Improvements vs the old version:
 * - Role labels with emoji icons (👤 you, 🤖 assistant, ⚙ system)
 * - Inline timestamp in the header line
 * - Streaming progress indicator with elapsed time, token count, TPM
 * - /result and /think toggle rows when content is available
 * - Cleaner divider between messages with role-coloured separators
 */
export function renderChatPane(messages, messageTimestamps, input, width, height, runningCommand, inputCursor, streamingPartial, conversationScroll, typingIndicator, typingDots, streamingStartTime, streamingTokenCount, streamingTokMin, lastResponseDiff, diffExpanded, lastResponseThink, thinkExpanded) {
  const rows = [];
  const pageSize = Math.max(4, height - 5);
  const totalPages = Math.max(1, Math.ceil(messages.length / pageSize));
  const clampedScroll = Math.min(conversationScroll, Math.max(0, totalPages - 1));
  const startIdx = Math.max(0, messages.length - pageSize * (clampedScroll + 1));
  const endIdx = Math.min(messages.length, startIdx + pageSize);
  const msgSlice = messages.slice(startIdx, endIdx);

  if (totalPages > 1 && clampedScroll > 0) {
    rows.push(kleur.gray(`▴ page ${clampedScroll + 1}/${totalPages} (older)`));
  }

  for (let i = 0; i < msgSlice.length; i++) {
    const message = msgSlice[i];
    const isLast = i === msgSlice.length - 1 && clampedScroll === 0;
    const origIdx = startIdx + i;
    const msgTs = messageTimestamps?.[origIdx] ?? null;
    const timeLabel = msgTs ? formatMsgTime(msgTs) : '';

    // Role label with colour and icon
    let roleLabel, roleColor;
    if (message.role === 'assistant') {
      roleLabel = '🤖 assistant';
      roleColor = kleur.green;
    } else if (message.role === 'system') {
      roleLabel = '⚙ system';
      roleColor = kleur.yellow;
    } else {
      roleLabel = '👤 you';
      roleColor = kleur.cyan;
    }

    let content = message.content;
    if (isLast && message.role === 'assistant' && streamingPartial) content = streamingPartial;
    const timeStr = timeLabel ? `${timeLabel} ` : '         ';
    const headerLine = `${kleur.gray('[')}${timeStr}${roleColor(roleLabel)}${kleur.gray(']›')}`;
    const showInlineStats = isLast && message.role === 'assistant' && streamingPartial && streamingStartTime != null;
    const contentLines = renderMarkdownLines(content, width - headerLine.length - 2);
    for (let j = 0; j < contentLines.length; j++) {
      const line = contentLines[j];
      rows.push(j === 0 ? `${headerLine} ${line}` : `${kleur.gray('          ')}  ${line}`);
    }
    if (showInlineStats) {
      const elapsed = ((Date.now() - streamingStartTime) / 1000).toFixed(1);
      const count = streamingTokenCount ?? 0;
      const tpm = streamingTokMin ?? '…';
      rows.push(kleur.gray(`           ▸ ${elapsed}s · ${count} tok · ${tpm} tok/min`));
    }
    // Typing indicator — shown when AI is composing a response (before first token)
    if (isLast && message.role === 'assistant' && typingIndicator) {
      const dots = '○'.repeat(typingDots) + '◌'.repeat(3 - typingDots);
      rows.push(kleur.gray(`           ${kleur.cyan('▸')} assistant is thinking${dots}`));
    }
    // ── Expandable result block (model reasoning output) ────────────
    if (isLast && message.role === 'assistant' && lastResponseDiff) {
      const icon = diffExpanded ? '▼' : '▶';
      const label = kleur.gray(`           ${icon} `) + kleur.cyan().inverse(' result ') + kleur.gray(' /expand · /collapse');
      rows.push(label);
      if (diffExpanded) {
        const diffLines = lastResponseDiff.split('\n');
        const maxLines = 8;
        const shown = diffLines.slice(0, maxLines);
        for (const line of shown) {
          const rendered = renderMarkdownLine(line);
          rows.push(kleur.gray('             ') + rendered);
        }
        if (diffLines.length > maxLines) {
          rows.push(kleur.gray(`             … ${diffLines.length - maxLines} more lines`));
        }
      }
    }
    // ── Expandable think block (chain-of-thought reasoning) ─────────
    if (isLast && message.role === 'assistant' && lastResponseThink) {
      const icon = thinkExpanded ? '▼' : '▶';
      const label = kleur.gray(`           ${icon} `) + kleur.yellow().inverse(' think ') + kleur.gray(' /expand · /collapse');
      rows.push(label);
      if (thinkExpanded) {
        const thinkLines = lastResponseThink.split('\n');
        const maxLines = 8;
        const shown = thinkLines.slice(0, maxLines);
        for (const line of shown) {
          const rendered = renderMarkdownLine(line);
          rows.push(kleur.gray('             ') + rendered);
        }
        if (thinkLines.length > maxLines) {
          rows.push(kleur.gray(`             … ${thinkLines.length - maxLines} more lines`));
        }
      }
    }
    rows.push('');
  }

  if (typingIndicator) {
    const frames = ['   ', '.  ', '.. ', '...'];
    const dots = frames[typingDots % 4];
    const indicator = kleur.gray('          ') + '  ' + kleur.italic().dim('typing' + dots);
    rows.push(indicator);
    rows.push('');
  }

  while (rows.length < height) rows.push('');
  return rows.slice(0, height);
}

export function renderContextStrip(state, width) {
  const w = Math.max(1, width);
  const maxWidth = w - 4;

  const ctxFiles = [...state.contextPaths].sort();
  const hasFiles = ctxFiles.length > 0;
  const hasSystem = state.config.systemPrompt?.trim();

  const lines = [];

  if (hasFiles) {
    const fileList = ctxFiles.join(', ');
    const budgetLines = ctxFiles.map((p) => estimateTokens(readPreview(state.cwd, p, 6000)));
    const totalCtxTokens = budgetLines.reduce((s, n) => s + n, 0);
    lines.push(truncate(kleur.green('▸ context:'), maxWidth - 4) + ' ' + truncate(fileList, maxWidth - 14));
    lines.push(truncate(kleur.gray(`  ${ctxFiles.length} files · ≈${totalCtxTokens} ctx tok`), maxWidth));
  } else {
    lines.push(truncate(kleur.gray('▸ no context files  ·  Tab to include, /include <path>'), maxWidth));
  }

  if (hasSystem) {
    const summary = truncate(state.config.systemPrompt, maxWidth - 14);
    lines.push(truncate(kleur.gray('▸ ' ) + truncate(kleur.cyan('sys: ') + summary, maxWidth - 2), maxWidth));
  }

  const modelLine = `▸ model: ${state.config.model}  ·  temp: ${state.config.temperature}  ·  max-tok: ${state.config.maxTokens}`;
  lines.push(truncate(kleur.gray(modelLine), maxWidth));

  return lines;
}

/**
 * Render the input line with cursor, pending cost preview, and key hint strip.
 * Layout: [› prompt][input with cursor inversion][  hint strip]
 */
export function renderInputLine(input, cursorPos, width, themeColors, pendingCost = null) {
  const w = Math.max(1, width);
  const { muted = (t) => t, accent = (t) => t } = themeColors;
  const prefix = `${kleur.bold().white('›')} `;
  const inputStart = prefix.length;

  // Build the cursor-inverted display string
  let display = '';
  for (let i = 0; i <= input.length; i++) {
    display += i === cursorPos ? kleur.inverse(input[i] ?? ' ') : (input[i] ?? '');
  }

  // Pending cost preview — show token count and estimated cost
  const costPreview = pendingCost && pendingCost.tok > 0
    ? kleur.cyan(`≈${pendingCost.tok} tok`) + kleur.gray(' · ')
    : kleur.gray('· ');

  // Key hint strip — compact, scannable key badges
  const hint = muted(
    costPreview
    + kleur.cyan().inverse(' Tab ') + kleur.gray(' comp')
    + '  '
    + kleur.cyan().inverse(' ⏎ ') + kleur.gray(' send')
    + '  '
    + kleur.cyan().inverse(' ⌘J ') + kleur.gray(' run')
    + '  '
    + kleur.cyan().inverse(' ⌘P ') + kleur.gray(' cmd')
  );

  const availForInput = Math.max(4, w - inputStart - hint.length - 2);
  const truncated = truncate(display, availForInput);
  return truncate(`${prefix}${truncated} ${hint}`, w);
}

export function parseInlineMarkdown(text) {
  if (!text) return [{ text: '', style: null }];
  return applyMarkdownSpans(text, [
    { pat: /\*\*\*(.+?)\*\*\*/gs, style: kleur.bold().italic },
    { pat: /\*\*(.+?)\*\*/g, style: kleur.bold },
    { pat: /\*(.+?)\*/g, style: kleur.italic },
    { pat: /~~(.+?)~~/g, style: kleur.strikethrough },
    { pat: /`([^`]+)`/g, style: (t) => kleur.bgBlack().white(t) },
    { pat: /\[([^\]]+)\]\(([^)]+)\)/g, style: kleur.underline().cyan },
  ]);
}

function applyMarkdownSpans(text, spans) {
  const matches = [];
  for (const rule of spans) {
    let m;
    const re = new RegExp(rule.pat.source, rule.pat.flags);
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], style: rule.style });
    }
  }
  if (!matches.length) return [{ text, style: null }];
  matches.sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  let pos = 0;
  for (const match of matches) {
    if (match.start < pos) continue;
    if (match.start > pos) out.push({ text: text.slice(pos, match.start), style: null });
    out.push({ text: match.text, style: match.style });
    pos = match.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), style: null });
  return out;
}

export function renderMarkdownLines(text, width) {
  const lines = String(text ?? '').split('\n');
  return lines.map((line) => truncate(parseInlineMarkdown(line).map(({ text, style }) => style ? style(text) : text).join(''), width));
}

export function renderBudgetMeter(state, width) {
  const inputText = state.input ?? '';
  const ctxFiles = [...state.contextPaths].sort();
  let ctxTok = 0;
  for (const relPath of ctxFiles) {
    const content = readPreview(state.cwd, relPath, 6000);
    ctxTok += estimateTokens(content);
  }
  const inputTok = estimateTokens(inputText);
  const totalTok = ctxTok + inputTok;
  const budget = state.contextBudget ?? 8192;
  const pct = Math.min(1, totalTok / budget);
  const filled = Math.round(pct * 10);
  const empty = 10 - filled;
  const barColor = pct < 0.6 ? kleur.green : pct < 0.85 ? kleur.yellow : kleur.red;
  const bar = barColor('█'.repeat(filled)) + kleur.gray('░'.repeat(empty));
  const costObj = estimateCost(totalTok, 0, state.config.model);
  const costStr = costObj.totalCost < 0.001 ? '<$0.001' : `$${costObj.totalCost.toFixed(3)}`;
  const ctxLabel = ctxFiles.length > 0 ? kleur.green(`${ctxFiles.length} ctx`) : kleur.gray('no ctx');
  const pctLabel = `${(pct * 100).toFixed(0)}%`;
  const label = `${bar}  ${kleur.gray('budget')} ${pctLabel}  ${kleur.gray('·')}  ${kleur.cyan(`${totalTok.toLocaleString()} tok`)}  ${kleur.gray('·')}  ${kleur.cyan(costStr)}  ${kleur.gray('·')}  ${ctxLabel}`;
  return truncate(label, width);
}

function renderKeyboardHintsStrip(state, width, isNarrow) {
  // One or two rows of key → action hints, dense and scannable
  // Key badges use cyan inverse (matching the input line hint strip style)
  const shortcuts = [
    { key: '⏎',  label: 'send' },
    { key: '⇥',  label: 'complete' },
    { key: '⌫',  label: 'delete' },
    { key: '↑↓', label: 'history/files' },
    { key: '⌘P', label: 'commands' },
    { key: '⌘J', label: 'run' },
    { key: '⌘R', label: 'search' },
    { key: '⌘L', label: 'clear' },
    { key: 'Esc', label: 'close' },
  ];

  if (isNarrow) {
    // Single compact row — show first 5 only
    const row = shortcuts.slice(0, 5).map(({ key, label }) =>
      kleur.cyan().inverse(' ' + key + ' ') + kleur.gray(' ' + label)
    ).join(kleur.gray('  ·  '));
    return truncate(row, width);
  }

  // Wide: two rows of hints, each key badge styled with cyan inverse
  const mid = Math.ceil(shortcuts.length / 2);
  const row1 = shortcuts.slice(0, mid).map(({ key, label }) =>
    kleur.cyan().inverse(' ' + key + ' ') + kleur.gray(' ' + label)
  ).join(kleur.gray('  ·  '));
  const row2 = shortcuts.slice(mid).map(({ key, label }) =>
    kleur.cyan().inverse(' ' + key + ' ') + kleur.gray(' ' + label)
  ).join(kleur.gray('  ·  '));
  return [
    truncate(row1, width),
    truncate(row2, width),
  ];
}

export function renderOverview(state, width, height, themeColors = {}) {
  const w = Math.max(20, width);
  const h = Math.max(10, height);
  const {
    prompt = (t) => t,
    assistant = (t) => t,
    user = (t) => t,
    system = (t) => t,
    error = (t) => t,
    muted = (t) => t,
    accent = (t) => t,
    bold = (t) => t,
  } = themeColors;

  const isNarrow = width < 92;
  const headerLines = renderHeader(state, width);
  const contextPane = isNarrow ? [] : renderContextStrip(state, width);
  const statusPane = renderStatusCard(state, width);
  const inputText = state.input ?? '';
  const historyText = state.messages.map(m => m.content).join(' ');
  const totalTokens = estimateTokens(inputText) + estimateTokens(historyText);
  const cost = estimateCost(totalTokens, 0, state.config.model);
  const budgetLine = `≈${totalTokens} tok · ~$${cost.totalCost.toFixed(3)}`;
  const footerLines = isNarrow ? 2 : 4;
  const topBlock = headerLines.length + (isNarrow ? 0 : contextPane.length) + 1;
  const availableMiddle = Math.max(8, height - topBlock - footerLines - 2);

  // On wide screens: files pane on left (30% width), chat on right (70%)
  // On narrow screens: chat pane takes full width
  let middleRows;
  if (isNarrow) {
    const chatHeight = availableMiddle;
    const chatRows = renderChatPane(
      state.messages,
      state.messageTimestamps,
      state.input,
      width,
      chatHeight,
      state.runningCommand,
      state.inputCursor ?? 0,
      state.streamingPartial ?? '',
      state.conversationScroll ?? 0,
      state.typingIndicator ?? false,
      state.typingDots ?? 0,
      null,
      null,
      state.streamingTokMin ?? null,
      state.lastResponseDiff ?? null,
      state.diffExpanded,
      state.lastResponseThink ?? null,
      state.thinkExpanded,
    );
    middleRows = chatRows;
  } else {
    // Split middle area: files pane (left) + chat pane (right)
    const filesWidth = Math.floor(width * 0.30);
    const chatWidth = width - filesWidth - 1; // -1 for separator
    const filesHeight = availableMiddle;
    const chatHeight = availableMiddle;

    const filesPaneLines = renderFilesPane(
      state.files,
      state.selectedFileIndex,
      state.contextPaths,
      filesWidth,
      filesHeight,
    );
    const chatPaneLines = renderChatPane(
      state.messages,
      state.messageTimestamps,
      state.input,
      chatWidth,
      chatHeight,
      state.runningCommand,
      state.inputCursor ?? 0,
      state.streamingPartial ?? '',
      state.conversationScroll ?? 0,
      state.typingIndicator ?? false,
      state.typingDots ?? 0,
      null,
      null,
      state.streamingTokMin ?? null,
      state.lastResponseDiff ?? null,
      state.diffExpanded,
      state.lastResponseThink ?? null,
      state.thinkExpanded,
    );

    // Merge files pane (left) with chat pane (right) side by side
    middleRows = [];
    for (let i = 0; i < Math.max(filesPaneLines.length, chatPaneLines.length); i++) {
      const fileLine = filesPaneLines[i] ?? '';
      const chatLine = chatPaneLines[i] ?? '';
      const separator = i === 0 ? '│' : (i === 1 ? '│' : '│');
      middleRows.push(`${fileLine.padEnd(filesWidth)}${kleur.gray(separator)}${chatLine}`);
    }
  }
  const inputLine = renderInputLine(
    state.input ?? '',
    state.inputCursor ?? 0,
    width,
    themeColors,
    estimatePendingCost(state.input ?? '', state),
  );
  const statusSummary = state.busy
    ? kleur.cyan('working...')
    : state.lastError
      ? kleur.red(`error: ${state.lastError}`)
      : kleur.green('ready');
  const narrowFooterMenu = '/help /mode /models';
  const footerMenu = isNarrow ? narrowFooterMenu : '/help /models /theme /sessions';
  const statusDetail = truncate(statusPane[statusPane.length - 1] ?? '', Math.max(0, width - 12));

  const lines = [
    ...headerLines,
    repeat('─', width),
    ...(isNarrow ? [] : contextPane),
    ...(isNarrow ? [] : [repeat('─', width)]),
    ...middleRows,
    repeat('─', width),
    inputLine,
    truncate(kleur.gray(`/${state.mode} mode · ${budgetLine} · ${footerMenu}`), width),
    ...(isNarrow ? [truncate(`${statusSummary} ${kleur.gray('·')} ${statusDetail}`, width)] : [truncate(`${statusSummary} ${kleur.gray('·')} ${statusDetail}`, width)]),
  ];

  const streamingBar = renderStreamingStatusBar(state, width);
  if (streamingBar) lines.push(truncate(streamingBar, width));

  return lines.join('\n');
}

export function renderKeyboardHelp(width = 60) {
  const w = Math.max(20, width);
  const shortcuts = [
    ['Enter', 'Send message (or toggle file preview if input is empty)'],
    ['Tab', 'Tab-complete slash commands; include selected file into context'],
    ['↑ / ↓', 'Browse command history (when input is empty); navigate files/preview'],
    ['← / →', 'Move cursor left/right in input'],
    ['Home / End', 'Jump to start / end of input line'],
    ['Ctrl+A', 'Jump to start of input line'],
    ['Ctrl+E', 'Jump to end of input line'],
    ['Ctrl+J', 'Run code block from last AI reply (or send if none)'],
    ['Ctrl+Shift+C', 'Copy last AI reply to clipboard'],
    ['Ctrl+Shift+E', 'Move cursor to end of line'],
    ['Backspace', 'Delete character before cursor'],
    ['Delete', 'Delete character after cursor'],
    ['Ctrl+U', 'Delete from cursor to start of line'],
    ['Ctrl+K', 'Delete from cursor to end of line'],
    ['Ctrl+W', 'Delete last word'],
    ['Ctrl+P', 'Open command palette'],
    ['Ctrl+R', 'Reverse history search (type to find past commands)'],
    ['Ctrl+F', 'Find file by name in the Files pane'],
    ['Ctrl+L', 'Clear screen'],
    ['Ctrl+C', 'Abort streaming / cancel input'],
    ['Esc', 'Close preview / close overlay'],
    ['?', 'Show this keyboard reference'],
    ['PageUp / PageDown', 'Scroll conversation history (when input is empty)'],
  ];

  const col1 = 18;
  const col2 = Math.max(0, w - col1 - 2);
  const header = kleur.bold('▸ Keyboard Shortcuts');
  const divider = kleur.gray('─'.repeat(w));

  const rows = [
    header,
    divider,
    ...shortcuts.map(([keys, desc]) => {
      const keyCol = truncate(kleur.cyan().inverse(` ${keys} `), col1);
      const descCol = truncate(kleur.gray(desc), col2);
      return keyCol + ' ' + descCol;
    }),
    divider,
    kleur.gray('Press Esc or Enter to close this overlay.'),
  ];

  while (rows.length < Math.max(10, Math.floor(w / 2))) rows.push('');
  return rows.join('\n');
}

function formatMsgTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderStreamingStatusBar(state, width) {
  if (!state.busy || !state.streamingStartTime) return '';
  const elapsed = ((Date.now() - state.streamingStartTime) / 1000).toFixed(1);
  const count = state.streamingTokenCount;
  const tpm = state.streamingTokMin ?? '…';
  const totalBars = Math.min(width - 30, 20);
  const elapsedSecs = (Date.now() - state.streamingStartTime) / 1000;
  const fill = Math.min(totalBars, Math.round((elapsedSecs / 10) * totalBars));
  const empty = totalBars - fill;
  const bar = kleur.green('█'.repeat(fill)) + kleur.gray('░'.repeat(empty));
  return truncate(`${bar}  ${kleur.green(count + ' tok')}  ${kleur.gray(elapsed + 's')}  ${kleur.cyan(tpm + ' tpm')}`, width);
}

function renderPreviewPane(state, width, height) {
  if (!state.previewFile) return [];
  const w = Math.max(20, width);
  const h = Math.max(5, height);

  const absPath = path.resolve(state.cwd, state.previewFile);
  let content;
  try {
    content = fs.readFileSync(absPath, 'utf8');
  } catch (err) {
    return [
      kleur.bold('▸ Preview'),
      kleur.gray('─'.repeat(w)),
      kleur.red(`  Could not read: ${state.previewFile}`),
      kleur.gray('─'.repeat(w)),
      kleur.gray('  Esc to close'),
    ];
  }

  const stat = fs.statSync(absPath);
  const sizeStr = formatFileSize(stat.size);
  const ext = state.previewFile.includes('.') ? state.previewFile.split('.').pop() : '';
  const lang = langFromExt(ext);

  const lines = content.split('\n');
  const maxContentLines = h - 4; // header + separators + hint
  const scroll = Math.max(0, Math.min(state.previewScroll ?? 0, Math.max(0, lines.length - maxContentLines)));
  const visible = lines.slice(scroll, scroll + maxContentLines);

  const lineNumWidth = String(scroll + visible.length).length;
  const maxCodeWidth = w - lineNumWidth - 3; // space for line num + margin

  const out = [];
  out.push(kleur.bold(`▸ Preview: ${kleur.cyan(state.previewFile)}  ${kleur.gray(sizeStr)}  ${kleur.gray('·  Esc close  ·  ↑↓ scroll')}`));
  out.push(kleur.gray('─'.repeat(w)));

  for (let i = 0; i < visible.length; i++) {
    const lineNum = scroll + i + 1;
    const num = kleur.gray(String(lineNum).padStart(lineNumWidth) + ' │ ');
    const raw = visible[i];
    const highlighted = colourLine(raw, lang);
    const truncated = truncate(highlighted, maxCodeWidth);
    out.push(num + truncated);
  }

  if (lines.length > scroll + visible.length) {
    const remaining = lines.length - (scroll + visible.length);
    out.push(kleur.gray(`  … ${remaining} more line${remaining !== 1 ? 's' : ''} · ↓ to scroll`));
  }

  if (scroll > 0) {
    out.push(kleur.gray(`  … ${scroll} line${scroll !== 1 ? 's' : ''} above · ↑ to scroll`));
  }

  out.push(kleur.gray('─'.repeat(w)));
  return out;
}

// Export the helpers so cli.js can use them
export { langFromExt, colourLine };