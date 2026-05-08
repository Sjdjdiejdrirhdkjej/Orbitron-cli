#!/usr/bin/env node
import prompts from 'prompts';
import ora from 'ora';
import kleur from 'kleur';
import { Command } from 'commander';
import fs from 'node:fs';
import { BackendClient } from './backend-client.js';
import { createState, parseThinkingAndExtractDiffs, serializeSession, listSessions } from './state.js';
import { DEFAULT_CONFIG, parseConfigValue, saveConfig } from './config.js';
import { banner, renderHelp, renderModels, renderSettings, renderStatus, renderTranscript, getCompletions, promptCommandPalette, SLASH_COMMANDS } from './ui.js';
import { walkWorkspace, gitBranch, gitStatus } from './files.js';
import { MarkdownStream } from './markdown.js';
import { renderScreen } from './render.js';
import { getTheme } from './themes.js';
import { checkForUpdate, getInstalledVersion, isGlobalInstall, restartCurrentProcess, runForegroundUpdate } from './update.js';
import { runOrchestratedReply } from './orchestrator.js';
import { handleSlashCommand } from './commands.js';
import path from 'node:path';

// Session auto-save — call after every message exchange
let lastSaveAt = 0;

function autoSaveSession() {
  if (!state.config.autosave) return;
  const now = Date.now();
  if (now - lastSaveAt < 5000) return; // throttle: once per 5s max
  lastSaveAt = now;
  try {
    const sessionsDir = path.join(state.cwd, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const data = serializeSession(state);
    const safeName = `session-${Date.now()}`;
    const filePath = path.join(sessionsDir, `${safeName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
    // Keep only last 10 sessions
    const allSessions = listSessions(sessionsDir);
    for (const s of allSessions.slice(10)) {
      try { fs.unlinkSync(s.path); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ─── File watcher for live workspace updates ─────────────────────────────────

let fileWatcher = null;
let fileWatcherDebounce = null;

/**
 * Start watching the workspace directory for file changes.
 * Debounces rapid events and calls `redraw()` to refresh the file pane.
 */
function startFileWatcher(cwd, redraw) {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  if (fileWatcherDebounce) {
    clearTimeout(fileWatcherDebounce);
    fileWatcherDebounce = null;
  }

  try {
    fileWatcher = fs.watch(cwd, { recursive: true }, (eventType, filename) => {
      // Ignore noisy dirs and temp files
      if (!filename) return;
      const skip = ['node_modules', '.git', '.cache', 'sessions', 'Trash'];
      if (skip.some(d => filename.includes(d))) return;

      if (fileWatcherDebounce) clearTimeout(fileWatcherDebounce);
      fileWatcherDebounce = setTimeout(() => {
        fileWatcherDebounce = null;
        // Refresh git info and files before each redraw
        state.gitBranch = gitBranch(cwd);
        state.gitStatus = gitStatus(cwd);
        state.files = walkWorkspace(cwd);
        redraw();
      }, 800); // debounce ~800ms to coalesce rapid changes
    });
  } catch {
    // Filesystem watch not supported — silently skip
  }
}

function stopFileWatcher() {
  if (fileWatcher) {
    try { fileWatcher.close(); } catch { /* ignore */ }
    fileWatcher = null;
  }
  if (fileWatcherDebounce) {
    clearTimeout(fileWatcherDebounce);
    fileWatcherDebounce = null;
  }
}

const program = new Command();
const cliVersion = getInstalledVersion();
program
  .name('orbitron')
  .description('A polished terminal chat prototype with neutral workflow UX')
  .version(cliVersion, '--version', 'print version')
  .option('-m, --message <text>', 'send a one-off message and print the response')
  .option('--model <name>', 'override model for this run')
  .option('--api-key <key>', 'override API key for this run')
  .option('--temperature <number>', 'override temperature for this run')
  .option('--max-tokens <number>', 'override max tokens for this run')
  .option('--retries <number>', 'override retries for this run')
  .parse(process.argv);

const opts = program.opts();
const state = createState();
state.files = walkWorkspace(state.cwd);
state.appVersion = cliVersion || 'dev';
state.gitBranch = gitBranch(state.cwd);
state.gitStatus = gitStatus(state.cwd);

state.config = {
  ...state.config,
  baseUrl: state.config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
  model: opts.model ? parseConfigValue('model', opts.model) : state.config.model ?? DEFAULT_CONFIG.model,
  apiKey: opts.apiKey ? parseConfigValue('apiKey', opts.apiKey) : state.config.apiKey ?? '',
  temperature: opts.temperature !== undefined ? parseConfigValue('temperature', opts.temperature) : state.config.temperature,
  maxTokens: opts.maxTokens !== undefined ? parseConfigValue('maxTokens', opts.maxTokens) : state.config.maxTokens,
  retries: opts.retries !== undefined ? parseConfigValue('retries', opts.retries) : state.config.retries ?? DEFAULT_CONFIG.retries,
};

const client = new BackendClient(state.config);

// Command history
const history = [];
let historyIndex = -1;

// Readline-style input with Tab completion and multi-line support
function createInteractiveInput(onSubmit) {
  let buffer = '';
  let cursorPos = 0;
  let completionIndex = 0;
  let currentCompletions = [];

  process.stdin.setRawMode?.(true);
  process.stdin.resume?.();
  process.stdin.setEncoding?.('utf8');

  const prompt = kleur.cyan('orbitron');
  process.stdout.write('\n' + prompt + ' ');

  function redrawInput() {
    process.stdout.write('\r' + ' '.repeat(80) + '\r' + prompt + ' ' + buffer + '\x1b[' + (buffer.length - cursorPos + prompt.length + 2) + 'D');
  }

  function printCompletions() {
    if (currentCompletions.length === 0) return;
    process.stdout.write('\n');
    for (const c of currentCompletions) {
      process.stdout.write(kleur.gray('  ' + c) + '\n');
    }
    process.stdout.write('\r' + prompt + ' ' + buffer);
  }

  const handler = (key) => {
    if (key === '\t') {
      if (currentCompletions.length === 0) {
        currentCompletions = getCompletions(buffer, state);
        completionIndex = 0;
      }
      if (currentCompletions.length > 0) {
        buffer = currentCompletions[completionIndex % currentCompletions.length];
        cursorPos = buffer.length;
        completionIndex++;
        redrawInput();
      }
      return;
    }
    if (key === '\x12') { // Ctrl+R — reverse history search
      process.stdin.pause?.();
      (async () => {
        const result = await reverseHistorySearch(history, historyIndex);
        process.stdin.resume?.();
        if (result !== null) {
          buffer = result;
          cursorPos = buffer.length;
          historyIndex = -1;
          redrawInput();
        }
      })();
      return;
    }
    if (key === '\x10') { // Ctrl+P — command palette
      process.stdin.pause?.();
      (async () => {
        const chosen = await promptCommandPalette(SLASH_COMMANDS);
        process.stdin.resume?.();
        if (chosen) {
          buffer = chosen;
          cursorPos = buffer.length;
          currentCompletions = [];
          completionIndex = 0;
          redrawInput();
          onSubmit(chosen);
          process.stdout.write(prompt + ' ');
        } else {
          redrawInput();
        }
      })();
      return;
    }
    if (key === '[' || key === '\x1b') {
      // Arrow key prefix - read more
      return;
    }
    if (key === '\x1b[A') { // Up
      if (history.length > 0) {
        if (historyIndex === -1) historyIndex = history.length - 1;
        else if (historyIndex > 0) historyIndex--;
        buffer = history[historyIndex] ?? '';
        cursorPos = buffer.length;
        redrawInput();
      } else if (!state.input) {
        state.selectedFileIndex = Math.max(0, state.selectedFileIndex - 1);
        redraw();
      }
      return;
    }
    if (key === '\x1b[B') { // Down
      if (historyIndex !== -1) {
        historyIndex++;
        if (historyIndex >= history.length) {
          historyIndex = -1;
          buffer = '';
        } else {
          buffer = history[historyIndex] ?? '';
        }
        cursorPos = buffer.length;
        redrawInput();
      } else if (!state.input) {
        state.selectedFileIndex = Math.min(state.files.length - 1, state.selectedFileIndex + 1);
        redraw();
      }
      return;
    }
    if (key === '\x0c') { // Ctrl+L - clear screen
      console.clear();
      printIntro();
      redrawInput();
      return;
    }
    if (key === '\x0a') { // Ctrl+J — run code block from last AI reply when input is empty
      if (!buffer.trim() && typeof handleSlashCommand === 'function') {
        process.stdin.pause?.();
        (async () => {
          await handleSlashCommand(state, 'runcodeblock', [], redrawScreen);
          process.stdin.resume?.();
          redrawInput();
        })();
        return;
      }
      // If input has content, treat as newline (normal Enter behavior)
      process.stdout.write('\n');
      const line = buffer;
      currentCompletions = [];
      completionIndex = 0;
      if (line.trim()) {
        history.push(line);
        if (history.length > 100) history.shift();
      }
      historyIndex = -1;
      buffer = '';
      cursorPos = 0;
      onSubmit(line);
      process.stdout.write(prompt + ' ');
      return;
    }
    if (key === '\x01') { // Ctrl+A - move to start of line
      cursorPos = 0;
      redrawInput();
      return;
    }
    if (key === '\x05') { // Ctrl+E - move to end of line
      cursorPos = buffer.length;
      redrawInput();
      return;
    }
    if (key === '\x15') { // Ctrl+U - clear from cursor to start
      if (cursorPos > 0) {
        buffer = buffer.slice(cursorPos);
        cursorPos = 0;
        redrawInput();
      }
      return;
    }
    if (key === '\x17') { // Ctrl+W - delete previous word
      if (cursorPos > 0) {
        const before = buffer.slice(0, cursorPos);
        const after = buffer.slice(cursorPos);
        const trimmed = before.replace(/\s+$/, '');
        const boundary = trimmed.lastIndexOf(' ');
        const nextBefore = boundary === -1 ? '' : before.slice(0, boundary + 1);
        buffer = nextBefore + after;
        cursorPos = nextBefore.length;
        redrawInput();
      }
      return;
    }
    if (key === '\x0b') { // Ctrl+K - delete from cursor to end of line
      if (cursorPos < buffer.length) {
        buffer = buffer.slice(0, cursorPos);
        redrawInput();
      }
      return;
    }
    if (key === '\x03') { // Ctrl+C
      process.stdout.write('\n' + kleur.yellow('^C\n'));
      buffer = '';
      cursorPos = 0;
      currentCompletions = [];
      process.stdout.write(prompt + ' ');
      return;
    }
    if (key === '\r' || key === '\n') { // Enter
      process.stdout.write('\n');
      const line = buffer;
      currentCompletions = [];
      completionIndex = 0;

      // ── Inline code block trigger ────────────────────────────────
      // If the line looks like a fenced code block opener (e.g. "```js" or "```"),
      // automatically enter multi-line mode without requiring a blank line.
      const trimmed = line.trim();
      const isCodeFence = /^```/.test(trimmed) || /^``````/.test(trimmed);
      if (isCodeFence) {
        buffer = line + '\n';
        cursorPos = buffer.length;
        redrawInput();
        // Set a flag so the next Enter on an empty line submits even if it's not a blank-only line
        state._codeBlockMode = true;
        return;
      }

      // Inside a code block, empty line submits (unless it's just a closing fence)
      if (state._codeBlockMode && trimmed === '') {
        state._codeBlockMode = false;
        const codeBlock = buffer;
        buffer = '';
        cursorPos = 0;
        onSubmit(codeBlock);
        process.stdout.write(prompt + ' ');
        return;
      }
      // ───────────────────────────────────────────────────────────

      if (line.trim()) {
        history.push(line);
        if (history.length > 100) history.shift();
      }
      historyIndex = -1;
      buffer = '';
      cursorPos = 0;
      onSubmit(line);
      process.stdout.write(prompt + ' ');
      return;
    }
    if (key === '\x7f') { // Backspace
      if (cursorPos > 0) {
        buffer = buffer.slice(0, cursorPos - 1) + buffer.slice(cursorPos);
        cursorPos--;
        redrawInput();
      }
      return;
    }
    if (key === '\x1b[3~') { // Delete
      if (cursorPos < buffer.length) {
        buffer = buffer.slice(0, cursorPos) + buffer.slice(cursorPos + 1);
        redrawInput();
      }
      return;
    }
    if (key === '\x1b[D') { // Left arrow
      if (cursorPos > 0) {
        cursorPos--;
        redrawInput();
      }
      return;
    }
    if (key === '\x1b[C') { // Right arrow
      if (cursorPos < buffer.length) {
        cursorPos++;
        redrawInput();
      }
      return;
    }
    if (key >= ' ' && key.length === 1) {
      buffer = buffer.slice(0, cursorPos) + key + buffer.slice(cursorPos);
      cursorPos++;
      redrawInput();
    }
  };

  return {
    handler,
    cleanup() {
      process.stdin.setRawMode?.(false);
    },
  };
}

/**
 * Reverse history search (Ctrl+R) — incrementally searches backwards through
 * history as the user types, displaying the first match and updating on each keystroke.
 * Returns the matched history entry, or null if cancelled.
 */
async function reverseHistorySearch(history, initialIndex) {
  process.stdout.write('\x1b[?25l'); // hide cursor
  let query = '';
  let matchIdx = -1;

  function draw() {
    const match = matchIdx >= 0 ? history[matchIdx] : null;
    const hint = query ? `reverse-i-search \`${query}\`: ` : 'reverse-i-search: ';
    const line = match ? hint + kleur.cyan(match) : hint + kleur.gray('(no match)');
    process.stdout.write('\r' + ' '.repeat(80) + '\r' + kleur.gray('(search) ') + line + '\x1b[K');
  }

  draw();

  return new Promise((resolve) => {
    let escapeBuffer = '';
    const handler = (chunk) => {
      const str = chunk.toString('utf8');

      if (str === '\u0003') {
        // Ctrl+C — cancel
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
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
          // Up — search previous match
          const start = matchIdx >= 0 ? matchIdx : history.length - 1;
          for (let i = start - 1; i >= 0; i--) {
            if (history[i] && history[i].toLowerCase().includes(query.toLowerCase())) {
              matchIdx = i;
              break;
            }
          }
          draw();
          return;
        }
        if (str === '[B') {
          // Down — search next match
          if (matchIdx < 0) { matchIdx = -1; draw(); return; }
          for (let i = matchIdx + 1; i < history.length; i++) {
            if (history[i] && history[i].toLowerCase().includes(query.toLowerCase())) {
              matchIdx = i;
              break;
            }
          }
          draw();
          return;
        }
        if (str === '\x1b') {
          // Escape — confirm current match and return
          process.stdout.write('\r' + ' '.repeat(80) + '\r');
          process.stdout.write('\x1b[?25h');
          process.off('data', handler);
          resolve(matchIdx >= 0 ? history[matchIdx] : null);
          return;
        }
        escapeBuffer = '';
        return;
      }
      if (str === '\r' || str === '\n') {
        // Enter — confirm and return current match
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
        process.stdout.write('\x1b[?25h');
        process.off('data', handler);
        resolve(matchIdx >= 0 ? history[matchIdx] : null);
        return;
      }
      if (str === '\x7f') {
        // Backspace — delete from query, re-search
        query = query.slice(0, -1);
        matchIdx = -1;
        if (query) {
          for (let i = history.length - 1; i >= 0; i--) {
            if (history[i] && history[i].toLowerCase().includes(query.toLowerCase())) {
              matchIdx = i;
              break;
            }
          }
        }
        draw();
        return;
      }
      if (str.length === 1 && str >= ' ') {
        query += str;
        matchIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i] && history[i].toLowerCase().includes(query.toLowerCase())) {
            matchIdx = i;
            break;
          }
        }
        draw();
        return;
      }
    };

    process.stdin.on('data', handler);
  });
}

// Simple line-by-line with Tab completion (fallback for non-TTY)
async function readInputWithCompletion(state) {
  return new Promise((resolve) => {
    let buffer = '';
    const prompt = kleur.cyan('orbitron');
    process.stdout.write('\n' + prompt + ' ');

    const onData = (chunk) => {
      const data = chunk.toString();
      for (const char of data) {
        if (char === '\t') {
          const completions = getCompletions(buffer, state);
          if (completions.length > 0) {
            buffer = completions[0];
            process.stdout.write('\r' + prompt + ' ' + buffer + '\x1b[K');
          }
        } else if (char === '\r' || char === '\n') {
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          resolve(buffer);
          break;
        } else if (char === '\x03') { // Ctrl+C
          process.stdout.write('\n' + kleur.yellow('^C\n' + prompt + ' '));
          buffer = '';
        } else if (char >= ' ') {
          buffer += char;
          process.stdout.write(char);
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

// Multi-line input: accumulates lines until blank line, then submits.
// Returns null on Ctrl+C, string on submit.
// Checks for Ctrl+J (0x0a with empty buffer) before blocking on prompts.
async function readMultilineInput(state) {
  const lines = [];
  const prompt = kleur.cyan('orbitron');
  let firstLine = true;

  while (true) {
    // Check if stdin has data waiting before we block on prompts.
    // This lets us detect Ctrl+J (line-feed) before the prompts library
    // consumes it as Enter, enabling code-block execution with empty input.
    const ready = await checkStdinReady();
    if (ready) {
      const ch = await readStdinChar();
      if (ch === '\x0a') {
        // Ctrl+J with empty buffer — run the last code block and return empty
        // so the loop knows to skip sendMessage but still redraws.
        if (lines.length === 0 && typeof handleSlashCommand === 'function') {
          return null; // sentinel: "run code block, do not send"
        }
        // Non-empty buffer or non-empty lines: treat as submit
      } else if (ch) {
        // Non-empty typed char — prepend to first line and fall through to prompts
        lines.unshift(ch);
        firstLine = false;
      }
    }

    const linePrompt = firstLine ? kleur.cyan('orbitron') : kleur.gray('...');
    const { value } = await prompts(
      {
        type: 'text',
        name: 'value',
        message: linePrompt,
      },
      { onCancel: () => ({ value: null }) },
    );

    if (value === null) {
      return null; // Ctrl+C
    }

    if (!value.trim()) {
      // Blank line ends input
      break;
    }

    if (firstLine && value.startsWith('/')) {
      // Single-line command - execute immediately
      return value;
    }

    lines.push(value);
    firstLine = false;
  }

  return lines.join('\n');
}

/**
 * Check if stdin has bytes available to read without blocking.
 * Uses select() on Unix; returns false on any error (safe fallback).
 */
async function checkStdinReady() {
  try {
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin });
    rl.close();
    // Fast non-blocking check using 'data' event + setTimeout fallback
    return new Promise((resolve) => {
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; resolve(false); }, 0);
      process.stdin.once('data', () => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve(true);
      });
    });
  } catch {
    return false;
  }
}

/**
 * Read a single character from stdin (blocking).
 * Only call this after confirming stdin has data ready.
 */
function readStdinChar() {
  return new Promise((resolve) => {
    process.stdin.once('data', (chunk) => {
      resolve(chunk.toString()[0] ?? null);
    });
  });
}

function printBlock(title, content) {
  console.log('\n' + kleur.bold(title));
  console.log(content);
}

function printIntro() {
  console.clear();
  console.log(banner(state));
  console.log(kleur.gray(`Backend: ${state.config.baseUrl}`));
  console.log(kleur.gray(`Model: ${state.config.model} · temp ${state.config.temperature} · max ${state.config.maxTokens}`));
  console.log(kleur.gray(`Pinned backend · direct access`));
  console.log(kleur.gray(`Config file: ${state.config.configPath ?? 'workspace default'}`));
  console.log('');
}

function getViewport() {
  return {
    width: process.stdout.columns || 100,
    height: process.stdout.rows || 32,
  };
}

function redrawScreen() {
  const { width, height } = getViewport();
  console.clear();
  console.log(renderScreen(state, width, Math.max(20, height - 1), getTheme(state.config.theme)));
}

function refreshClient() {
  client.updateConfig(state.config);
}

async function runAutoUpdateCheck() {
  state.update.checking = true;
  state.update.lastError = '';
  try {
    const info = await checkForUpdate();
    state.update.currentVersion = info.current;
    state.update.latestVersion = info.latest;
    state.update.available = info.available;
    state.update.lastCheckedAt = Date.now();

    if (!info.available) return;
    if (!isGlobalInstall()) return;

    state.update.autoUpdating = true;
    state.status = `Auto-updating to ${info.latest}`;
    console.log(kleur.gray(`\nAuto-update found: ${info.current} -> ${info.latest}`));
    const updateResult = runForegroundUpdate();
    if (!updateResult.ok) {
      state.update.lastError = updateResult.reason ?? 'auto-update failed';
      return;
    }
    const afterVersion = getInstalledVersion();
    if (afterVersion === info.current) {
      state.update.lastError = `update finished but version stayed at ${info.current}`;
      return;
    }
    console.log(kleur.green('Auto-update complete. Restarting Orbitron...'));
    restartCurrentProcess();
    process.exit(0);
  } catch (error) {
    state.update.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    state.update.checking = false;
  }
}

async function chooseSetting() {
  const response = await prompts(
    {
      type: 'select',
      name: 'field',
      message: 'Which setting do you want to edit?',
      choices: [
        { title: 'Model', value: 'model' },
        { title: 'Temperature', value: 'temperature' },
        { title: 'Max tokens', value: 'maxTokens' },
        { title: 'Retries', value: 'retries' },
        { title: 'System prompt', value: 'systemPrompt' },
        { title: 'Autosave', value: 'autosave' },
        { title: 'Theme', value: 'theme' },
      ],
    },
    { onCancel: () => ({ field: null }) },
  );

  if (!response.field) return;

  const current = state.config[response.field];

  if (response.field === 'theme') {
    const { value: newTheme } = await prompts(
      {
        type: 'select',
        name: 'value',
        message: 'Select a theme',
        choices: [
          { title: 'Cyan — classic cyan-on-dark palette', value: 'default' },
          { title: 'Forest — muted greens on dark', value: 'forest' },
          { title: 'Solarized — Solarized dark palette', value: 'solarized' },
          { title: 'Mono — white on black, minimal', value: 'mono' },
        ],
        initial: [DEFAULT_CONFIG.theme, 'default', 'forest', 'solarized', 'mono'].indexOf(state.config.theme),
      },
      { onCancel: () => ({ value: undefined }) },
    );
    if (newTheme === undefined) return;
    state.config.theme = newTheme;
    refreshClient();
    console.log(kleur.green(`Theme set to ${newTheme}.`));
    return;
  }

  const editor = await prompts(
    {
      type: response.field === 'autosave' ? 'toggle' : 'text',
      name: 'value',
      message: `New value for ${response.field}`,
      initial: String(current),
      active: 'on',
      inactive: 'off',
    },
    { onCancel: () => ({ value: undefined }) },
  );

  if (editor.value === undefined) return;

  state.config[response.field] = parseConfigValue(response.field, editor.value);
  refreshClient();
  console.log(kleur.green(`Updated ${response.field}.`));
}

async function sendMessage(text) {
  state.messages.push({ role: 'user', content: text });
  state.status = 'discover: mapping relevant context';
  state.busy = true;
  state.orchestrator = {
    active: true,
    currentRole: 'discover',
    currentDetail: 'mapping relevant context',
    completedRoles: [],
    roles: ['discover', 'think', 'review'],
  };
  refreshClient();

  const controller = new AbortController();
  const replyTokens = [];

  let cursorChar = '█';
  let cursorVisible = true;
  let cursorInterval;

  const showCursor = () => {
    process.stdout.write(cursorVisible ? kleur.green(cursorChar) : ' ');
    cursorVisible = !cursorVisible;
  };

  const started = Date.now();
  let tokenCount = 0;
  let lastUpdate = started;
  state.streamingStartTime = started;
  state.streamingTokenCount = 0;
  state.streamingTokMin = null;
  state.streamingPartial = '';

  const updateThroughput = () => {
    const elapsed = (Date.now() - started) / 1000;
    const mins = elapsed / 60;
    const tpm = mins > 0 ? Math.round(tokenCount / mins) : tokenCount;
    state.streamingTokMin = tpm;
    const line = `\b\b  \b\b${kleur.green(tokenCount + ' tok')} ${kleur.gray(`· ${elapsed.toFixed(1)}s · ${tpm} tok/min`)}`;
    process.stdout.write(line + '\x1b[K');
  };

  const md = new MarkdownStream((text) => {
    process.stdout.write(text);
    state.streamingPartial += text;
  });

  const logStage = (stage) => {
    const line = `${stage.currentRole}: ${stage.currentDetail}`;
    console.log(kleur.gray(`\n▸ ${line}`));
  };

  const abortHandler = () => {
    if (cursorInterval) clearInterval(cursorInterval);
    controller.abort();
    const partial = replyTokens.join('');
    if (partial) state.messages.push({ role: 'assistant', content: partial + ' *(aborted)*' });
    state.status = 'Aborted';
    state.busy = false;
    state.orchestrator.active = false;
    console.log(kleur.yellow('\n[aborted]'));
  };
  process.on('SIGINT', abortHandler, { once: true });

  try {
    const orchestration = await runOrchestratedReply({
      state,
      client,
      signal: controller.signal,
      redraw: redrawScreen,
      onStage: logStage,
    });

    process.stdout.write(kleur.green('\nAssistant: '));
    state.status = orchestration.reviewStatus;
    redrawScreen();

    for await (const token of client.streamChat(orchestration.reviewMessages, {
      temperature: state.config.temperature,
      maxTokens: state.config.maxTokens,
      retries: state.config.retries,
    }, controller.signal)) {
      if (cursorInterval) clearInterval(cursorInterval);
      process.stdout.write('\b\b');
      md.accept(token);
      replyTokens.push(token);
      tokenCount++;
      state.streamingTokenCount = tokenCount;
      const now = Date.now();
      if (now - lastUpdate > 600) {
        updateThroughput();
        lastUpdate = now;
      }
      cursorInterval = setInterval(showCursor, 400);
    }

    if (cursorInterval) clearInterval(cursorInterval);
    process.stdout.write('\b\b');
    md.flush();
    const reply = replyTokens.join('');
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const speed = replyTokens.length ? Math.round((replyTokens.length / (Date.now() - started)) * 60000) : 0;
    state.messages.push({ role: 'assistant', content: reply });
    state.backend.lastLatencyMs = Math.round(Date.now() - started);
    state.status = 'Reply received';
    state.lastError = '';
    state.lastOutputTokens = replyTokens.length;
    state.lastReplyDurationMs = Date.now() - started;
    state.lastReplyTpm = speed;
    const { estimateCost: ec, estimateTokens: et } = await import('./render.js');
    const { readPreview } = await import('./files.js');
    try {
      const ctxFiles = [...state.contextPaths].sort();
      let ctxTok = 0;
      for (const relPath of ctxFiles) {
        ctxTok += et(readPreview(state.cwd, relPath, 6000));
      }
      const histTok = state.messages.slice(-12).reduce((sum, m) => sum + et(m.content.slice(0, 300)), 0);
      const replyCost = ec(ctxTok + histTok, replyTokens.length, state.config.model);
      state.lastReplyCost = replyCost.totalCost;
    } catch { state.lastReplyCost = 0; }

    // Extract thinking blocks and diff/ result content for /expand /collapse
    const diffResult = parseThinkingAndExtractDiffs(reply);
    if (diffResult) {
      state.lastResponseDiff = diffResult.diffContent || null;
      state.diffExpanded = false;
      state.lastResponseThink = diffResult.thinkContent || null;
      state.thinkExpanded = false;
    } else {
      state.lastResponseDiff = null;
      state.diffExpanded = false;
      state.lastResponseThink = null;
      state.thinkExpanded = false;
    }

    console.log('\n' + kleur.green('\u2713 ' + replyTokens.length + ' tokens in ' + elapsed + 's') + kleur.gray(' (~' + speed + ' tok/min)'));
    autoSaveSession();
  } catch (error) {
    if (cursorInterval) clearInterval(cursorInterval);
    const message = error instanceof Error ? error.message : String(error);
    state.lastError = message;
    state.status = 'Request failed';
    console.log('\b\b\n' + kleur.red('\u2717 ' + message));
  } finally {
    process.off('SIGINT', abortHandler);
    state.busy = false;
    state.orchestrator.active = false;
    state.orchestrator.currentRole = '';
    state.orchestrator.currentDetail = '';
    state.streamingStartTime = null;
    state.streamingTokenCount = 0;
    state.streamingTokMin = null;
    state.streamingPartial = '';
  }
}

async function refreshModels() {
  state.status = 'Fetching models';
  state.busy = true;
  const spinner = ora('Discovering models at backend…').start();
  refreshClient();
  try {
    const models = await client.listModels();
    spinner.succeed(`Discovered ${models.length} models from ${state.config.baseUrl}`);
    state.modelList = models;
    state.status = `Loaded ${models.length} models`;
    state.lastError = '';
    state.backend.lastLatencyMs = state.backend.lastLatencyMs ?? null;
    state.backend.health = 'ok';
    // Warm up connection health for the Status card
    const { checkConnectionHealth } = await import('./commands.js');
    await checkConnectionHealth(state);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    spinner.fail(`Model discovery failed: ${message.slice(0, 80)}`);
    state.lastError = message;
    state.status = 'Model fetch failed';
    state.backend.health = 'error';
  } finally {
    state.busy = false;
  }
}

async function handleCommand(input) {
  if (input === '/quit' || input === '/exit') return 'quit';
  if (input === '/help') {
    printBlock('Help', renderHelp());
    return null;
  }
  if (input === '/status') {
    printBlock('Status', renderStatus(state));
    return null;
  }
  if (input === '/settings') {
    await chooseSetting();
    printBlock('Settings', renderSettings(state.config));
    return null;
  }
  if (input === '/models') {
    await refreshModels();
    return null;
  }
  if (input === '/clear') {
    state.messages = [{ role: 'assistant', content: 'Transcript cleared. Ready for the next prompt.' }];
    printBlock('Transcript', renderTranscript(state.messages));
    return null;
  }
  if (input.startsWith('/set ')) {
    const [, field, ...rest] = input.split(' ');
    const value = rest.join(' ');
    if (!field || !value) {
      console.log(kleur.yellow('Usage: /set <field> <value>'));
      return null;
    }
    if (!(field in state.config)) {
      console.log(kleur.yellow(`Unknown field: ${field}`));
      return null;
    }
    state.config[field] = parseConfigValue(field, value);
    refreshClient();
    console.log(kleur.green(`Updated ${field}.`));
    return null;
  }
  if (input.startsWith('/model ')) {
    const model = input.slice(7).trim();
    if (!model) {
      console.log(kleur.yellow('Usage: /model <name>'));
      return null;
    }
    state.config.model = parseConfigValue('model', model);
    refreshClient();
    console.log(kleur.green(`Model set to: ${state.config.model}`));
    return null;
  }
  return null;
}

async function interactiveLoop() {
  state.status = 'Backend ready · direct access';

  redrawScreen();
  startFileWatcher(state.cwd, redrawScreen);
  await refreshModels();

  while (true) {
    redrawScreen();
    const input = await readMultilineInput(state);

    if (input === null) {
      // Sentinel from readMultilineInput: Ctrl+J was pressed with empty buffer —
      // run the last code block instead of sending a message.
      await handleSlashCommand(state, 'runcodeblock', [], redrawScreen);
      continue;
    }
    if (!input.trim()) continue;

    // Handle commands immediately (single-line commands already stripped of multi-line)
    const cmdResult = await handleCommand(input);
    if (cmdResult === 'quit') break;
    if (cmdResult === null && input.startsWith('/')) continue;

    await sendMessage(input);
    redrawScreen();
  }
}

async function oneShot() {
  printIntro();
  if (!opts.message) {
    console.log(kleur.yellow('No message provided.'));
    return;
  }
  await sendMessage(opts.message);
}

async function main() {
  await runAutoUpdateCheck();
  if (opts.message) {
    await oneShot();
    return;
  }

  await interactiveLoop();
  stopFileWatcher();
  if (state.config.autosave) saveConfig(state.config);
  console.log(kleur.gray('Goodbye.'));
}

main().catch((error) => {
  console.error(kleur.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  stopFileWatcher();
  process.exitCode = 1;
});
