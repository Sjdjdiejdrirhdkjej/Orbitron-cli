import { loadConfig, mergeConfig } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { readPreview } from './files.js';
import { estimateTokens } from './render.js';

export const MODE_NAMES = ['default', 'max', 'plan', 'lite'];

export function normalizeMode(value) {
  const next = String(value ?? '').trim().toLowerCase();
  return MODE_NAMES.includes(next) ? next : MODE_NAMES[0];
}

export function cycleMode(value, step = 1) {
  const current = normalizeMode(value);
  const index = MODE_NAMES.indexOf(current);
  return MODE_NAMES[(index + step + MODE_NAMES.length) % MODE_NAMES.length];
}

export function formatModeName(value) {
  const mode = normalizeMode(value);
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function createState(overrides = {}) {
  const config = mergeConfig({ ...loadConfig(), ...overrides.config });
  const initialMode = normalizeMode(overrides.mode ?? config.mode);
  return {
    config,
    mode: initialMode,
    messages: [
      {
        role: 'assistant',
        content:
          'Ready when you are. Ask for a change, inspect the repo, run a command, or pull files into context from the explorer.',
      },
    ],
    status: 'Ready',
    busy: false,
    lastError: '',
    modelList: [],
    input: '',
    runningCommand: null,
    contextPaths: new Set(),
    files: [],
    selectedFileIndex: 0,
    cwd: overrides.cwd ?? process.cwd(),
    backend: {
      health: 'unknown',
      lastLatencyMs: null,
      lastRequest: '',
    },
    update: {
      currentVersion: '',
      latestVersion: '',
      available: false,
      checking: false,
      autoUpdating: false,
      lastCheckedAt: null,
      lastError: '',
    },
    appVersion: overrides.appVersion ?? 'dev',
    gitBranch: null,
    gitStatus: null,
    streamingStartTime: null,
    streamingTokMin: null,
    streamingTokenCount: 0,
    lastOutputTokens: 0,
    lastReplyDurationMs: 0,
    lastReplyTpm: 0,
    lastReplyCost: 0,
    lastReplyTimestamp: null,
    inputCursor: 0,
    previewFile: false,
    previewScroll: 0,
    streamingPartial: '',
    typingIndicator: false,
    typingDots: 0,
    fileSearchQuery: '',
    fileSearchActive: false,
    messageTimestamps: [],
    conversationStartedAt: Date.now(),
    conversationDurationSecs: 0,
    conversationScroll: 0,
    multilineEditPath: null,
    multilineEditMode: null,
    multilineEditContent: '',
    compactMode: false,
    pendingPromptAfterAuth: null,
    contextTokens: 0,
    contextBudget: 8192,
    retryMessage: null,
    retryContext: null,
    thinkMode: false,
    lastResponseDiff: null,
    diffExpanded: false,
    lastResponseThink: null,
    thinkExpanded: false,
    orchestrator: {
      active: false,
      currentRole: '',
      currentDetail: '',
      completedRoles: [],
      roles: [],
    },
  };
}

/**
 * Serialize state fields that should survive a session restart.
 * Returns a plain object suitable for JSON.stringify.
 * Omits runtime-only fields (busy, input, streamingPartial, previewFile, etc.).
 */
export function serializeSession(state) {
  return {
    version: 2,
    config: state.config,
    mode: state.mode,
    messages: state.messages,
    messageTimestamps: state.messageTimestamps,
    conversationStartedAt: state.conversationStartedAt,
    contextPaths: [...state.contextPaths],
    cwd: state.cwd,
    savedAt: Date.now(),
  };
}

/**
 * Restore a session from a serialized plain object produced by serializeSession.
 * Validates required fields and fills in sensible defaults for missing data.
 */
export function restoreSession(data) {
  if (!data || typeof data.version !== 'number') return null;
  try {
    return {
      mode: normalizeMode(data.mode),
      messages: Array.isArray(data.messages) ? data.messages : [],
      messageTimestamps: Array.isArray(data.messageTimestamps) ? data.messageTimestamps : [],
      conversationStartedAt: typeof data.conversationStartedAt === 'number' ? data.conversationStartedAt : Date.now(),
      contextPaths: new Set(Array.isArray(data.contextPaths) ? data.contextPaths : []),
      cwd: typeof data.cwd === 'string' ? data.cwd : process.cwd(),
      savedAt: typeof data.savedAt === 'number' ? data.savedAt : null,
    };
  } catch {
    return null;
  }
}

export function updateStateConfig(state, partial) {
  state.config = mergeConfig({ ...state.config, ...partial });
  return state.config;
}

export function pushMessage(state, role, content) {
  state.messages.push({ role, content: String(content) });
}

/**
 * List all saved sessions in the sessions/ directory.
 * Returns [{name, path, savedAt, messageCount, preview}] sorted newest-first.
 */
export function listSessions(sessionsDir) {
  if (!fs.existsSync(sessionsDir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const sessions = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(sessionsDir, entry);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (typeof data.version !== 'number') continue;
      const savedAt = data.savedAt ? new Date(data.savedAt) : null;
      const msgCount = Array.isArray(data.messages) ? data.messages.length : 0;
      const lastMsg = msgCount > 0 ? data.messages[msgCount - 1]?.content?.slice(0, 80) ?? '' : '';
      sessions.push({
        name: entry,
        path: filePath,
        savedAt,
        messageCount: msgCount,
        preview: lastMsg,
      });
    } catch {
      // skip corrupt session files
    }
  }
  return sessions.sort((a, b) => {
    if (!a.savedAt && !b.savedAt) return 0;
    if (!a.savedAt) return 1;
    if (!b.savedAt) return -1;
    return b.savedAt.getTime() - a.savedAt.getTime();
  });
}

/**
 * Recompute context token count from the current contextPaths set.
 * Writes state.contextTokens and returns the total.
 */
export function recomputeContextTokens(state) {
  const files = [...state.contextPaths].sort();
  let total = 0;
  for (const relPath of files) {
    const content = readPreview(state.cwd, relPath, 6000);
    total += estimateTokens(content);
  }
  state.contextTokens = total;
  return total;
}

/**
 * Parse thinking blocks from model output and extract content that follows them.
 * Detects:  thinking content  [/axo_result] final answer
 * Returns { thinkContent, diffContent } after stripping all XML-style markers.
 * Returns null if no  block is found.
 */
export function parseThinkingAndExtractDiffs(text) {
  if (!text || typeof text !== 'string') return null;
  const openTag = '<think>';
  const closeTag = '</think>';
  const openIdx = text.lastIndexOf(openTag);
  const closeIdx = text.lastIndexOf(closeTag);
  if (openIdx < 0 || closeIdx < 0 || closeIdx < openIdx) return null;
  const thinkContent = text.slice(openIdx + openTag.length, closeIdx).trim() || null;
  const diffContent = text.slice(closeIdx + closeTag.length).trim() || null;
  if (!thinkContent && !diffContent) return null;
  return { thinkContent, diffContent };
}
