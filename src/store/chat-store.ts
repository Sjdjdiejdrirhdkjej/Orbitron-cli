import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { trimMessagesToFitLimit } from "./message-trimmer.js";
import { encode as encodeTokens } from "gpt-tokenizer";
import fs from "node:fs";
import path from "node:path";

export const ORBITRON_BACKEND_URL = "https://orbitron--pastelsjuice8t.replit.app";

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  thinking?: string;
  failed?: boolean;
}

export interface ModelMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
  context_window?: number;
  pricing?: {
    input_per_million?: number;
    output_per_million?: number;
  };
}

export interface Config {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  contextWindow?: number;
  conversationTitle?: string;
  conversationCreatedAt?: number;
}

export type AppScreen = "apikey" | "chat";

interface ChatState {
  // Config
  config: Config;
  setConfig: (partial: Partial<Config>) => void;
  setConversationInfo: (title: string, createdAt: number) => void;

  // Theme
  currentTheme: string;
  setTheme: (name: string) => void;
  showThemePicker: boolean;
  setShowThemePicker: (v: boolean) => void;

  // Screen
  screen: AppScreen;
  setScreen: (screen: AppScreen) => void;

  // Messages
  messages: Message[];
  addMessage: (msg: Omit<Message, "id" | "timestamp">) => string;
  updateMessage: (id: string, partial: Partial<Message>) => void;
  clearMessages: () => void;

  // Streaming
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  streamingContent: string;
  setStreamingContent: (v: string) => void;
  appendStreamingContent: (chunk: string) => void;

  // Error
  lastError: string;
  setLastError: (msg: string) => void;

  // Status
  status: string;
  setStatus: (msg: string) => void;

  // Model picker
  showModelPicker: boolean;
  setShowModelPicker: (v: boolean) => void;
  availableModels: ModelInfo[];
  setAvailableModels: (models: ModelInfo[]) => void;

  // Backend health
  backendHealth: "unknown" | "ok" | "error";
  backendLatencyMs: number | null;
  checkHealth: () => void;

  // Input history
  inputHistory: string[];
  addToInputHistory: (text: string) => void;
  inputHistoryIndex: number;
  setInputHistoryIndex: (idx: number) => void;

  // Retry
  retryMessage: (id: string) => void;
  regenerateLast: () => { userId: string; userContent: string } | null;

  // Session persistence
  saveSession: (title: string) => void;
  loadSession: (sessionId: string) => void;
  listSessions: () => SessionSummary[];
  deleteSession: (sessionId: string) => void;
  currentSessionId: string | null;

  // Context window tracking
  contextTokens: number;
  contextWarning: boolean;
  updateContextTokens: (tokens: number) => void;
  pruneContext: () => void;

  // Search
  searchHistory: (query: string) => string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  messageCount: number;
  model: string;
}

function charsToTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function resolveConfigPath(): string {
  const explicit = process.env.ORBITRON_CONFIG_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(process.cwd(), "orbitron.config.json");
}

function persistConfig(config: Config): void {
  try {
    const target = resolveConfigPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      `${JSON.stringify(
        {
          baseUrl: ORBITRON_BACKEND_URL,
          apiKey: config.apiKey,
          model: config.model,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          contextWindow: config.contextWindow,
          conversationTitle: config.conversationTitle,
          conversationCreatedAt: config.conversationCreatedAt,
        },
        null,
        2,
      )}\n`,
    );
  } catch {
    // ignore persistence failures
  }
}

const DEFAULT_CONFIG: Config = {
  baseUrl: ORBITRON_BACKEND_URL,
  apiKey: process.env.ORBITRON_API_KEY?.trim() || "",
  model: process.env.ORBITRON_MODEL?.trim() || "gpt-4.1",
  temperature: Number(process.env.ORBITRON_TEMPERATURE ?? 0.2),
  maxTokens: Number(process.env.ORBITRON_MAX_TOKENS ?? 2048),
};

/** Summarize a message array to keep context under limit */
function summarizeMessages(messages: Message[]): Message[] {
  if (messages.length < 4) return messages;
  const system = messages.find((m) => m.role === "system");
  const withoutSystem = messages.filter((m) => m.role !== "system");
  const keep = withoutSystem.slice(-12);
  return system ? [system, ...keep] : keep;
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    config: { ...DEFAULT_CONFIG },
    screen: "chat",
    setConfig: (partial) =>
      set((s) => {
        const { baseUrl: _ignoredBaseUrl, ...rest } = partial;
        Object.assign(s.config, rest);
        s.config.baseUrl = ORBITRON_BACKEND_URL;
        persistConfig(s.config);
      }),

    setConversationInfo: (title, createdAt) =>
      set((s) => {
        s.config.conversationTitle = title;
        s.config.conversationCreatedAt = createdAt;
        persistConfig(s.config);
      }),

    setScreen: (screen) =>
      set((s) => {
        s.screen = screen;
      }),

    currentTheme: "dark",
    setTheme: (name) =>
      set((s) => {
        s.currentTheme = name;
      }),
    showThemePicker: false,
    setShowThemePicker: (v) =>
      set((s) => {
        s.showThemePicker = v;
      }),

    messages: [],
    addMessage: (msg) => {
      const id = crypto.randomUUID();
      set((s) => {
        s.messages.push({
          ...msg,
          id,
          timestamp: Date.now(),
        });
        const totalChars = s.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
        const contextWindow = s.config.contextWindow ?? 128000;
        if (charsToTokens(totalChars) > contextWindow * 0.8 && s.messages.length > 4) {
          s.messages = summarizeMessages(s.messages);
        }
      });
      if (msg.role !== "system") {
        get().saveSession(get().config.conversationTitle || "New Chat");
      }
      return id;
    },
    updateMessage: (id, partial) =>
      set((s) => {
        const idx = s.messages.findIndex((m) => m.id === id);
        if (idx !== -1) Object.assign(s.messages[idx], partial);
      }),
    clearMessages: () =>
      set((s) => {
        s.messages = [];
        s.contextTokens = 0;
        s.contextWarning = false;
        s.currentSessionId = null;
        s.config.conversationTitle = undefined;
        s.config.conversationCreatedAt = undefined;
        persistConfig(s.config);
      }),

    isStreaming: false,
    setIsStreaming: (v) =>
      set((s) => {
        s.isStreaming = v;
      }),
    streamingContent: "",
    setStreamingContent: (v) =>
      set((s) => {
        s.streamingContent = v;
      }),
    appendStreamingContent: (chunk) =>
      set((s) => {
        s.streamingContent += chunk;
      }),

    lastError: "",
    setLastError: (msg) =>
      set((s) => {
        s.lastError = msg;
      }),

    status: "Ready",
    setStatus: (msg) =>
      set((s) => {
        s.status = msg;
      }),

    showModelPicker: false,
    setShowModelPicker: (v) =>
      set((s) => {
        s.showModelPicker = v;
      }),
    availableModels: [],
    setAvailableModels: (models) =>
      set((s) => {
        s.availableModels = models;
      }),

    backendHealth: "unknown",
    backendLatencyMs: null,
    checkHealth: () => {
      const { baseUrl } = get().config;
      const start = Date.now();
      fetch(baseUrl + "/v1/models", {
        signal: AbortSignal.timeout(5000),
        headers: { accept: "application/json" },
      })
        .then((r) => {
          set((s) => {
            s.backendLatencyMs = Date.now() - start;
            s.backendHealth = r.ok ? "ok" : "error";
          });
        })
        .catch(() => {
          set((s) => {
            s.backendHealth = "error";
          });
        });
    },

    inputHistory: [],
    addToInputHistory: (text) =>
      set((s) => {
        if (text && s.inputHistory[0] !== text) {
          s.inputHistory = [text, ...s.inputHistory].slice(0, 50);
        }
        s.inputHistoryIndex = -1;
      }),
    inputHistoryIndex: -1,
    setInputHistoryIndex: (idx) =>
      set((s) => {
        s.inputHistoryIndex = idx;
      }),

    retryMessage: (id) =>
      set((s) => {
        const idx = s.messages.findIndex((m) => m.id === id);
        if (idx !== -1) {
          s.messages.splice(idx, 1);
        }
      }),

    currentSessionId: null,

    saveSession: (title) =>
      set((s) => {
        if (s.messages.length === 0) return;
        const sessions = getSessions();
        const sessionId = s.currentSessionId || crypto.randomUUID();
        const session: StoredSession = {
          id: sessionId,
          title: title || s.config.conversationTitle || "New Chat",
          createdAt: s.config.conversationCreatedAt || Date.now(),
          model: s.config.model,
          messages: s.messages,
          config: { ...s.config },
        };
        sessions[sessionId] = session;
        saveSessions(sessions);
        s.currentSessionId = sessionId;
      }),

    loadSession: (sessionId) =>
      set((s) => {
        const sessions = getSessions();
        const session = sessions[sessionId];
        if (!session) return;
        s.messages = session.messages;
        s.config = { ...session.config, baseUrl: ORBITRON_BACKEND_URL };
        s.currentSessionId = sessionId;
        persistConfig(s.config);
      }),

    listSessions: () => {
      const sessions = getSessions();
      return Object.values(sessions)
        .map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          messageCount: s.messages.length,
          model: s.model,
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    deleteSession: (sessionId) =>
      set((s) => {
        const sessions = getSessions();
        delete sessions[sessionId];
        saveSessions(sessions);
        if (s.currentSessionId === sessionId) {
          s.currentSessionId = null;
        }
      }),

    regenerateLast: () => {
      let userId = "";
      let userContent = "";
      set((s) => {
        for (let i = s.messages.length - 1; i >= 0; i--) {
          if (s.messages[i].role === "assistant") {
            s.messages.splice(i, 1);
            for (let j = i - 1; j >= 0; j--) {
              if (s.messages[j].role === "user") {
                userId = s.messages[j].id;
                userContent = s.messages[j].content;
                s.messages.splice(j, 1);
                break;
              }
            }
            break;
          }
        }
      });
      return userId ? { userId, userContent } : null;
    },

    contextTokens: 0,
    contextWarning: false,
    updateContextTokens: (tokens: number) =>
      set((s) => {
        s.contextTokens = tokens;
        const contextWindow = s.config.contextWindow ?? 128000;
        s.contextWarning = s.contextTokens > contextWindow * 0.75;
      }),
    pruneContext: () =>
      set((s) => {
        const systemMessage = s.messages.find((m) => m.role === "system");
        const result = trimMessagesToFitLimit(s.messages, systemMessage);
        s.messages = (result.messages as Message[]).map((m) => ({
          ...m,
          id: crypto.randomUUID(),
          timestamp: Date.now(),
        }));
        s.contextWarning = false;
      }),

    searchHistory: (query: string) => {
      const { messages } = get();
      if (!query.trim()) {
        return "Usage: /search <query>\nSearches all messages for the given text (case-insensitive).\nResults show the role, timestamp, and a snippet with the match highlighted.";
      }
      const q = query.toLowerCase();
      const results = messages
        .map((m, i) => ({ ...m, index: i }))
        .filter((m) => m.content.toLowerCase().includes(q));
      if (results.length === 0) {
        return `No messages found matching "${query}".`;
      }
      const lines = results.slice(-20).reverse().map((m) => {
        const idx = m.content.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 25);
        const end = Math.min(m.content.length, idx + query.length + 35);
        let snippet = m.content.slice(start, end);
        if (start > 0) snippet = "…" + snippet;
        if (end < m.content.length) snippet = snippet + "…";
        const ts = new Date(m.timestamp).toLocaleString();
        return `  [${ts}]\n  ${m.role}: ${snippet}`;
      });
      return `Found ${results.length} match${results.length !== 1 ? "es" : ""} for "${query}":\n\n${lines.join("\n\n")}`;
    },
  }))
);

const SESSIONS_KEY = "orbitron-sessions";

interface StoredSession {
  id: string;
  title: string;
  createdAt: number;
  model: string;
  messages: Message[];
  config: Config;
}

function getSessions(): Record<string, StoredSession> {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveSessions(sessions: Record<string, StoredSession>) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // storage full or unavailable
  }
}