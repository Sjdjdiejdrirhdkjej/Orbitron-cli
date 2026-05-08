import React, { useState, useEffect, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useChatStore } from "../store/chat-store";
import { getTheme } from "../theme/index";
import { listModels } from "../api/chat";
import { runMessagePipeline } from "../lib/message-pipeline";
import { matchCommand, isCommandInput, getCommands, matchCommandWithArgs, deriveTitle } from "../commands";
import {
  parseMarkdown,
  getSegmentFg,
  getSegmentAttrs,
  getLangColor,
  tokenizeCode,
  getTokenFg,
  renderLatex,
  getLatexTokenFg,
  type MarkdownSegment,
} from "../lib/markdown";
import type { Message } from "../store/chat-store";
import { getDisplayName } from "../lib/model-names";
import { encode as encodeTokens } from "gpt-tokenizer";
import { handleRunCode } from "../lib/execute";

function getTerminalColumns(): number {
  try {
    return typeof process !== "undefined" && process.stdout && process.stdout.columns
      ? (process.stdout.columns as number)
      : Infinity;
  } catch {
    return Infinity;
  }
}

// ─── Timestamp helper ─────────────────────────────────────────────────────────
function relativeTime(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 5) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Command Palette ──────────────────────────────────────────────────────────

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  type: "command" | "history" | "model";
  execute: () => void;
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 80 - t.indexOf(q);
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 60 - qi : 0;
}

function getCommandHint(input: string): { alias: string; description: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const head = trimmed.split(/\s+/)[0].toLowerCase();
  const matches = getCommands()
    .flatMap((command) => command.aliases.map((alias) => ({ command, alias })))
    .filter(({ alias }) => alias.toLowerCase().startsWith(head))
    .sort((a, b) => a.alias.length - b.alias.length);
  const best = matches[0];
  return best ? { alias: best.alias, description: best.command.description } : null;
}

function CommandPalette({ onClose, initialQuery, onLoadHistory }: { onClose: () => void; initialQuery: string; onLoadHistory: (value: string) => void }) {
  const theme = getTheme("dark");
  const config = useChatStore((s) => s.config);
  const messages = useChatStore((s) => s.messages);
  const inputHistory = useChatStore((s) => s.inputHistory);
  const availableModels = useChatStore((s) => s.availableModels);
  const addMessage = useChatStore((s) => s.addMessage);
  const setConfig = useChatStore((s) => s.setConfig);

  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [items, setItems] = useState<PaletteItem[]>([]);
  const allItemsRef = useRef<PaletteItem[]>([]);

  useEffect(() => {
    setQuery(initialQuery);
    setSelectedIdx(0);
  }, [initialQuery]);

  const resetQuery = useCallback(() => {
    setQuery("");
    setSelectedIdx(0);
  }, []);

  useEffect(() => {
    const cmds = getCommands();
    const cmdItems: PaletteItem[] = cmds.map((c) => ({
      id: c.name,
      label: c.aliases[0],
      description: c.description,
      type: "command",
      execute: c.execute,
    }));

    const historyItems: PaletteItem[] = inputHistory.slice(0, 10).map((h, i) => ({
      id: `history-${i}`,
      label: h.slice(0, 60),
      description: `Recent prompt · ${h.length} chars`,
      type: "history",
      execute: () => {
        onLoadHistory(h);
        onClose();
      },
    }));

    const modelItems: PaletteItem[] = availableModels.slice(0, 20).map((m) => ({
      id: `model-${m.id}`,
      label: m.name || m.id,
      description: m.context_window
        ? `${(m.context_window / 1000).toFixed(0)}k ctx`
        : "model",
      type: "model",
      execute: () => {
        setConfig({ model: m.id });
        onClose();
      },
    }));

    allItemsRef.current = [...cmdItems, ...historyItems, ...modelItems];
    setItems(allItemsRef.current);
    setSelectedIdx(0);
  }, [inputHistory, availableModels]);

  useEffect(() => {
    if (!query) {
      setItems(allItemsRef.current);
    } else {
      const scored = allItemsRef.current
        .map((item) => ({ item, score: Math.max(fuzzyScore(query, item.label), fuzzyScore(query, item.description)) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item);
      setItems(scored);
    }
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      e.stopPropagation();

      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (printable) {
        setQuery((q) => q + e.key);
        e.preventDefault();
        return;
      }

      if (e.key === "Spacebar" || e.key === " ") {
        setQuery((q) => q + " ");
        e.preventDefault();
        return;
      }

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(items.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (items[selectedIdx]) {
          items[selectedIdx].execute();
          onClose();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (query) {
          resetQuery();
        } else {
          onClose();
        }
      } else if (e.key === "Backspace") {
        e.preventDefault();
        if (query) {
          setQuery((q) => q.slice(0, -1));
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [items, selectedIdx, query, onClose, resetQuery]);

  const typeColor = (type: PaletteItem["type"]) => {
    switch (type) {
      case "command": return theme.primary;
      case "history": return theme.info;
      case "model": return theme.success;
    }
  };

  return (
    <box
      style={{
        position: "absolute",
        top: 0, left: 0, width: "100%", height: "100%",
        backgroundColor: "rgba(0,0,0,0.7)",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        paddingTop: 4,
      }}
    >
      <box
        style={{
          width: 56,
          flexDirection: "column",
          borderStyle: "double",
          borderColor: theme.primary,
          backgroundColor: theme.surface,
        }}
      >
        {/* Search input */}
        <box
          style={{
            padding: 1,
            borderStyle: "single",
            borderColor: theme.border,
            border: ["bottom"],
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>›</text>
          <text style={{ fg: theme.muted, marginLeft: 1 }}>cmd:</text>
          <text style={{ fg: theme.foreground, marginLeft: 1 }}>{query || "_"}█</text>
        </box>

        {/* Results */}
        <box style={{ flexDirection: "column", maxHeight: 12, padding: 0 }}>
          {items.length === 0 && (
            <box style={{ padding: 1 }}>
              <text style={{ fg: theme.muted }}>No results</text>
            </box>
          )}
          {items.slice(0, 12).map((item, idx) => (
            <box
              key={item.id}
              style={{
                padding: 1,
                borderStyle: "single",
                borderColor: idx === selectedIdx ? theme.primary : "transparent",
                border: idx === selectedIdx ? ["left"] : [],
              }}
            >
              <text style={{ fg: idx === selectedIdx ? theme.primary : theme.muted, marginRight: 1 }}>
                {idx === selectedIdx ? "▸" : " "}
              </text>
              <text style={{ fg: typeColor(item.type), attributes: idx === selectedIdx ? TextAttributes.BOLD : undefined }}>
                {item.label.slice(0, 28)}
              </text>
              <text style={{ fg: theme.muted, marginLeft: 2 }}>
                {item.description.slice(0, 28)}
              </text>
            </box>
          ))}
        </box>

        {/* Footer */}
        <box
          style={{
            padding: 1,
            borderStyle: "single",
            borderColor: theme.border,
            border: ["top"],
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <text style={{ fg: theme.muted }}>↑↓ nav · ↵ select · Esc close</text>
          <text style={{ fg: theme.muted }}>{items.length} results</text>
        </box>
      </box>
    </box>
  );
}

// Spinner frames for the thinking indicator
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const SPIN_INTERVAL = 120;

// Streaming markdown renderer — renders segments as they become available
// progressiveSegments: segments that have been fully parsed so far
// streamingContent: the raw content still being accumulated
function StreamingMessageContent({ content, theme, cursorBlink }: { content: string; theme: ReturnType<typeof getTheme>; cursorBlink: boolean }) {
  const [progressiveSegments, setProgressiveSegments] = useState<MarkdownSegment[]>([]);
  const [incompleteCode, setIncompleteCode] = useState<string>("");
  const [codeBlockMode, setCodeBlockMode] = useState(false);

  useEffect(() => {
    const segs = parseMarkdown(content);
    setProgressiveSegments(segs);

    const lines = content.split("\n");
    let inCode = false;
    let lastCodeStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^```/.test(lines[i]) && !inCode) {
        inCode = true;
        lastCodeStart = i;
      } else if (/^```/.test(lines[i]) && inCode) {
        inCode = false;
        lastCodeStart = -1;
      }
    }
    if (inCode && lastCodeStart >= 0) {
      const codeContent = lines.slice(lastCodeStart + 1).join("\n");
      setIncompleteCode(codeContent);
      setCodeBlockMode(true);
    } else {
      setIncompleteCode("");
      setCodeBlockMode(false);
    }
  }, [content]);
  const segs = progressiveSegments;

  return (
    <>
      {segs.map((seg) => renderSegment(seg, theme))}
      {codeBlockMode && incompleteCode && (
        <box style={{ flexDirection: "column" }}>
          {incompleteCode.split("\n").map((line, i) => (
            <text key={i} style={{ fg: theme.muted }}>
              {line}
            </text>
          ))}
        </box>
      )}
      {!codeBlockMode && (
        <text style={{ fg: theme.muted }}>{cursorBlink ? "█" : " "}</text>
      )}
    </>
  );
}

// Strip ANSI codes for width measurement
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function pad(text: string, width: number, align: "left" | "center" | "right" | null): string {
  const clean = stripAnsi(text);
  const padded = clean.length >= width ? clean.slice(0, width) : clean + " ".repeat(width - clean.length);
  if (align === "right") return " ".repeat(width - clean.length) + clean;
  if (align === "center") {
    const left = Math.floor((width - clean.length) / 2);
    return " ".repeat(left) + clean + " ".repeat(width - clean.length - left);
  }
  return padded;
}

function renderTable(headers: string[], rows: string[][], alignments: Array<"left" | "center" | "right" | null>, theme: ReturnType<typeof getTheme>): React.ReactNode {
  const cols = headers.length;
  const colWidths = headers.map((h) => stripAnsi(h).length);
  for (const row of rows) {
    for (let c = 0; c < cols; c++) {
      const cell = stripAnsi(row[c] ?? "").length;
      if (cell > colWidths[c]) colWidths[c] = cell;
    }
  }
  const totalWidth = colWidths.reduce((a, b) => a + b, 0) + cols + 1;
  const border = "─".repeat(totalWidth);

  const lines: React.ReactNode[] = [];

  // Top border
  lines.push(<text key={`tb-top`} style={{ fg: theme.border }}>{`┌${colWidths.map((w, i) => `─`.repeat(w) + (i < cols - 1 ? "┬" : "")).join("")}┐\n`}</text>);

  // Header row
  lines.push(
    <text key={`tb-header`} style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>
      {"|" + headers.map((h, i) => ` ${pad(h, colWidths[i], alignments[i])} |`).join("") + "\n"}
    </text>
  );

  // Separator
  lines.push(<text key={`tb-sep`} style={{ fg: theme.border }}>{`├${colWidths.map((w, i) => `─`.repeat(w) + (i < cols - 1 ? "┼" : "")).join("")}┤\n`}</text>);

  // Data rows
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    lines.push(
      <text key={`tb-row-${r}`} style={{ fg: theme.foreground }}>
        {"|" + row.map((cell, i) => ` ${pad(cell ?? "", colWidths[i], alignments[i])} |`).join("") + "\n"}
      </text>
    );
  }

  // Bottom border
  lines.push(<text key={`tb-bot`} style={{ fg: theme.border }}>{`└${colWidths.map((w, i) => `─`.repeat(w) + (i < cols - 1 ? "┴" : "")).join("")}┘\n`}</text>);

  return <>{lines}</>;
}

function renderSegment(seg: MarkdownSegment, theme: ReturnType<typeof getTheme>): React.ReactNode {
  const fg = getSegmentFg(seg, theme, false);
  const attrs = getSegmentAttrs(seg);
  if (seg.type === "codeBlock") {
    return (
      <text key={seg.content.slice(0, 20)} style={{ fg: getLangColor(seg.lang, theme), attributes: attrs }}>
        {`\n${seg.content}`}
      </text>
    );
  }
  if (seg.type === "highlightedCode" && seg.lang) {
    const tokens = tokenizeCode(seg.content, seg.lang);
    return (
      <box key={seg.content.slice(0, 20)} style={{ flexDirection: "row" }}>
        <text style={{ fg: theme.foreground }}>{`\n`}</text>
        {tokens.map((tok, i) => (
          <text key={i} style={{ fg: getTokenFg(tok.type) }}>
            {tok.value}
          </text>
        ))}
      </box>
    );
  }
  if (seg.type === "latex" || seg.type === "latexBlock") {
    const isBlock = seg.type === "latexBlock";
    const { tokens } = renderLatex(seg.content, isBlock);
    return (
      <box key={seg.content.slice(0, 20)} style={{ flexDirection: "row" }}>
        {isBlock ? <text style={{ fg: "#4ec9b0" }}>{`\n`}</text> : null}
        {tokens.map((tok, i) => (
          <text key={i} style={{ fg: getLatexTokenFg(tok.type) }}>
            {tok.value}
          </text>
        ))}
      </box>
    );
  }
  if (seg.type === "table" && seg.headers && seg.rows) {
    return renderTable(seg.headers, seg.rows, seg.alignments ?? [], theme);
  }
  if (seg.type === "link") {
    const url = seg.content;
    const osc8 = `\x1b]8;id=0;${url}\x1b\\`;
    const text = osc8 + seg.content + `\x1b]8;;\x1b\\`;
    return (
      <text key={seg.content.slice(0, 20)} style={{ fg: theme.info }}>
        {text}
      </text>
    );
  }
  if (seg.type === "h1") return <text key={seg.content.slice(0, 20)} style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>{`\n${seg.content}\n`}</text>;
  if (seg.type === "h2") return <text key={seg.content.slice(0, 20)} style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>{`\n${seg.content}\n`}</text>;
  if (seg.type === "h3") return <text key={seg.content.slice(0, 20)} style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>{`${seg.content}\n`}</text>;
  if (seg.type === "bold") return <text key={seg.content.slice(0, 20)} style={{ fg, attributes: attrs }}>{seg.content}</text>;
  if (seg.type === "italic") return <text key={seg.content.slice(0, 20)} style={{ fg, attributes: attrs }}>{seg.content}</text>;
  if (seg.type === "code") return <text key={seg.content.slice(0, 20)} style={{ fg: theme.warning, attributes: TextAttributes.BOLD }}>{` ${seg.content} `}</text>;
  if (seg.type === "list") return <text key={seg.content.slice(0, 20)} style={{ fg }}>{`${seg.content}\n`}</text>;
  if (seg.type === "blockquote") return <text key={seg.content.slice(0, 20)} style={{ fg: theme.muted, attributes: TextAttributes.BOLD }}>{`▌ ${seg.content}\n`}</text>;
  if (seg.type === "hr") return <text key={seg.content.slice(0, 20)} style={{ fg: theme.border }}>{`${seg.content}\n`}</text>;
  return <text key={seg.content.slice(0, 20)} style={{ fg, wrapMode: "word" }}>{seg.content}</text>;
}

// Render a completed message's content — parses markdown and renders segments
function renderMessageContent(content: string, theme: ReturnType<typeof getTheme>): React.ReactNode[] {
  const segments = parseMarkdown(content);
  return segments.map((seg, i) => (
    <React.Fragment key={i}>{renderSegment(seg, theme)}</React.Fragment>
  ));
}

// Detect consecutive same-role messages to group them visually
function getGroupKey(msg: { role: string; timestamp: number }, prev: { role: string; timestamp: number } | null): string {
  if (!prev) return `${msg.role}-${msg.timestamp}`;
  if (prev.role !== msg.role) return `${msg.role}-${msg.timestamp}`;
  if (msg.timestamp - prev.timestamp > 30000) return `${msg.role}-${msg.timestamp}`;
  return "same";
}

// Find the last user message in the conversation
function findLastUserMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

// ─── Inline code execution (see src/lib/execute.ts) ──────────────────────────

interface Props {}

export function ChatScreen(_props: Props) {
  const theme = getTheme("dark");
  const config = useChatStore((s) => s.config);
  const messages = useChatStore((s) => s.messages);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setIsStreaming = useChatStore((s) => s.setIsStreaming);
  const streamingContent = useChatStore((s) => s.streamingContent);
  const setStreamingContent = useChatStore((s) => s.setStreamingContent);
  const lastError = useChatStore((s) => s.lastError);
  const setLastError = useChatStore((s) => s.setLastError);
  const setStatus = useChatStore((s) => s.setStatus);
  const setScreen = useChatStore((s) => s.setScreen);
  const setConversationInfo = useChatStore((s) => s.setConversationInfo);
  const addToInputHistory = useChatStore((s) => s.addToInputHistory);
  const inputHistory = useChatStore((s) => s.inputHistory);
  const inputHistoryIndex = useChatStore((s) => s.inputHistoryIndex);
  const setInputHistoryIndex = useChatStore((s) => s.setInputHistoryIndex);
  const availableModels = useChatStore((s) => s.availableModels);
  const backendHealth = useChatStore((s) => s.backendHealth);
  const backendLatencyMs = useChatStore((s) => s.backendLatencyMs);
  const checkHealth = useChatStore((s) => s.checkHealth);
  const [cursorBlink, setCursorBlink] = useState(true);
  const [cursorPos, setCursorPos] = useState(0);
  const [input, setInput] = useState("");
  const [modelCount, setModelCount] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [thinkingFrame, setThinkingFrame] = useState(0);
  const [thinkingElapsed, setThinkingElapsed] = useState(0);
  const [tabCompletionIdx, setTabCompletionIdx] = useState(-1);
  const [isEditing, setIsEditing] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const streamingStartRef = useRef<number | null>(null);
  const tokenCountRef = useRef<number>(0);
  const throughputIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [throughput, setThroughput] = useState<{ tokens: number; elapsed: number; tpm: number } | null>(null);
  // Scrollback buffer: auto-scroll-to-bottom behaviour
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const [msgCountVisible, setMsgCountVisible] = useState(false);
  const isScrolledUpRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const [retryState, setRetryState] = useState<{ userId: string; userContent: string } | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [autoSuggestion, setAutoSuggestion] = useState("");
  const contextTokens = useChatStore((s) => s.contextTokens);
  const contextWarning = useChatStore((s) => s.contextWarning);
  const updateContextTokens = useChatStore((s) => s.updateContextTokens);
  const apiKeyMissing = false;
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const commandHint = getCommandHint(input);

  const startNormalChat = useCallback(async (snapshotMessages: Message[]) => {
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsStreaming(true);
    setStreamingContent("");
    setStatus("Thinking...");
    streamingStartRef.current = Date.now();
    tokenCountRef.current = 0;
    setThroughput(null);
    if (throughputIntervalRef.current) clearInterval(throughputIntervalRef.current);
    throughputIntervalRef.current = setInterval(() => {
      if (streamingStartRef.current) {
        const elapsed = (Date.now() - streamingStartRef.current) / 1000;
        const mins = elapsed / 60;
        const tpm = mins > 0 ? Math.round(tokenCountRef.current / mins) : tokenCountRef.current;
        setThroughput({ tokens: tokenCountRef.current, elapsed, tpm });
      }
    }, 600);

    try {
      const result = await runMessagePipeline(
        {
          messages: snapshotMessages.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
          config: {
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            model: config.model,
            temperature: config.temperature,
            maxTokens: config.maxTokens,
          },
        },
        {
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === "delta") {
              if (streamingStartRef.current && Date.now() - streamingStartRef.current > 300) {
                setStatus("Streaming...");
              }
              setStreamingContent(event.content);
              tokenCountRef.current = event.tokenCount;
            }
          },
        },
      );

      if (result.cancelled) {
        setStatus("Cancelled");
        if (result.content) {
          addMessage({ role: "assistant", content: `${result.content} [cancelled]`, failed: false });
        } else {
          addMessage({ role: "assistant", content: "[empty response]", failed: true });
        }
      } else {
        addMessage({ role: "assistant", content: result.content });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastError(msg);
      addMessage({ role: "assistant", content: `[Error] ${msg}`, failed: true });
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamingContent("");
      streamingStartRef.current = null;
      if (throughputIntervalRef.current) clearInterval(throughputIntervalRef.current);
      if (!abortController.signal.aborted) setStatus("Ready");
    }
  }, [config.apiKey, config.baseUrl, config.maxTokens, config.model, config.temperature, addMessage, setIsStreaming, setLastError, setStatus, setStreamingContent, setThroughput]);

  const lastAssistantId = messages.length > 0 && messages[messages.length - 1].role === "assistant"
    ? messages[messages.length - 1].id
    : messages.length > 0 && messages[messages.length - 1].role === "user"
    ? (messages.length >= 2 && messages[messages.length - 2].role === "assistant" ? messages[messages.length - 2].id : null)
    : null;
  const lastAssistantContent = messages.length > 0 && messages[messages.length - 1].role === "assistant"
    ? messages[messages.length - 1].content
    : messages.length > 0 && messages[messages.length - 1].role === "user"
    ? (messages.length >= 2 && messages[messages.length - 2].role === "assistant" ? messages[messages.length - 2].content : "")
    : "";

  // Check backend health on mount and every 30 seconds
  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const healthDot = backendHealth === "ok"
    ? "●"
    : backendHealth === "error"
    ? "●"
    : "○";
  const healthColor = backendHealth === "ok"
    ? theme.success
    : backendHealth === "error"
    ? theme.error
    : theme.muted;
  const healthLabel = backendHealth === "ok"
    ? backendLatencyMs != null ? `${backendLatencyMs}ms` : "ok"
    : backendHealth === "error"
    ? "err"
    : "";

  const backendLabel = config.baseUrl.replace("https://", "").replace("http://", "").replace(/\/$/, "");
  const currentModel = availableModels.find((m) => m.id === config.model);
  const modelContextWindow = config.contextWindow ?? currentModel?.context_window ?? null;
  const modelContextLabel = modelContextWindow != null
    ? modelContextWindow >= 1000
      ? `${Math.round(modelContextWindow / 1000)}k ctx`
      : `${modelContextWindow} ctx`
    : null;
  const modelPriceLabel = currentModel?.pricing
    ? `$${currentModel.pricing.input_per_million ?? "?"}/M in · $${currentModel.pricing.output_per_million ?? "?"}/M out`
    : null;
  const modelLabel = getDisplayName(config.model);

  const estimatedTokens = encodeTokens(input).length;

  // Cursor blink while not streaming
  useEffect(() => {
    if (isStreaming) return;
    const id = setInterval(() => setCursorBlink((p) => !p), 500);
    return () => clearInterval(id);
  }, [isStreaming]);

  // Auto-show palette when input starts with /
  useEffect(() => {
    if (input.startsWith("/") && input.length > 1 && !showPalette) {
      setShowPalette(true);
    }
  }, [input, showPalette]);

  // Spinner animation for thinking state
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setThinkingFrame((f) => (f + 1) % SPINNER_FRAMES.length), SPIN_INTERVAL);
    const elapsedId = setInterval(() => {
      if (streamingStartRef.current) {
        setThinkingElapsed((Date.now() - streamingStartRef.current) / 1000);
      }
    }, 100);
    return () => { clearInterval(id); clearInterval(elapsedId); };
  }, [isStreaming]);

  // Cleanup throughput interval on unmount or streaming end
  useEffect(() => {
    return () => {
      if (throughputIntervalRef.current) clearInterval(throughputIntervalRef.current);
    };
  }, []);

  // Auto-scroll: only scroll to bottom when not manually scrolled up
  useEffect(() => {
    if (isScrolledUpRef.current) return;
    if (scrollAnchorRef.current) {
      try { scrollAnchorRef.current.scrollIntoView({ block: "end" }); } catch {}
    }
  }, [streamingContent, messages.length]);

  // Track new message count while scrolled up
  const prevMsgCountRef = useRef(messages.length);
  useEffect(() => {
    if (isScrolledUpRef.current && messages.length > prevMsgCountRef.current) {
      const delta = messages.length - prevMsgCountRef.current;
      setNewMsgCount((n) => n + delta);
      setMsgCountVisible(true);
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  const cancelStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setStreamingContent("");
    setThinkingElapsed(0);
    setStatus("Ready");
  }, [setIsStreaming, setStreamingContent, setStatus]);

  const copyMessage = useCallback((id: string, content: string) => {
    try {
      process.stdout.write(`\x1b]52;c;${Buffer.from(content).toString("base64")}\x1b\\`);
    } catch {}
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1200);
  }, []);

  useEffect(() => {
    if (inputHistoryIndex >= 0 && inputHistory[inputHistoryIndex] !== undefined) {
      setInput(inputHistory[inputHistoryIndex]);
    }
  }, [inputHistoryIndex, inputHistory]);

  // Handle retry state — when Ctrl+G removes a failed message and triggers resubmit
  useEffect(() => {
    if (!retryState) return;
    const { userContent } = retryState;
    setRetryState(null);
    setStatus("Retrying...");
    setTimeout(() => {
      const text = userContent;
      const currentMessages = useChatStore.getState().messages;
      const currentUserMessage = addMessage({ role: "user", content: text });
      addToInputHistory(text);
      setInput("");
      setInputHistoryIndex(-1);
      setCursorPos(0);
      void startNormalChat([
        ...currentMessages,
        { id: currentUserMessage, role: "user" as const, content: text, timestamp: Date.now() },
      ]);
    }, 50);
  }, [retryState, addMessage, addToInputHistory, setStatus, setInputHistoryIndex, startNormalChat]);

  useEffect(() => {
    setStatus("Discovering models...");
    listModels(config.baseUrl)
      .then((m) => setModelCount(m.length))
      .catch((err: Error) => setLastError(err.message))
      .finally(() => setStatus("Ready"));
  }, [config.baseUrl, setLastError, setStatus]);

  // Auto-suggestion: find input history entries matching what the user has typed
  useEffect(() => {
    if (!input || isEditing) {
      setAutoSuggestion("");
      return;
    }
    // Find the best matching history entry
    const lower = input.toLowerCase();
    const match = inputHistory.find((h) => h.toLowerCase().startsWith(lower) && h !== input);
    setAutoSuggestion(match || "");
  }, [input, inputHistory, isEditing]);

  // Handle PgDn: jump to latest when newMsgCount is clicked
  const handleJumpToLatest = useCallback(() => {
    setScrollOffset(0);
    setIsScrolledUp(false);
    isScrolledUpRef.current = false;
    setNewMsgCount(0);
    setMsgCountVisible(false);
  }, [setScrollOffset, setIsScrolledUp]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    if (isCommandInput(text)) {
      const withArgs = matchCommandWithArgs(text);
      if (withArgs) {
        setInput("");
        const { command, arg } = withArgs;
        if (command.name === "load" && arg) {
          const num = parseInt(arg, 10);
          if (isNaN(num)) {
            addMessage({ role: "assistant", content: "Invalid session number. Use /sessions to list sessions." });
            return;
          }
          const sessions = useChatStore.getState().listSessions();
          if (num < 1 || num > sessions.length) {
            addMessage({ role: "assistant", content: `Session number out of range. /sessions lists ${sessions.length} session(s).` });
            return;
          }
          useChatStore.getState().loadSession(sessions[num - 1].id);
          addMessage({ role: "assistant", content: `Loaded session: "${sessions[num - 1].title}"` });
          return;
        }
        if (command.name === "delete" && arg) {
          const num = parseInt(arg, 10);
          if (isNaN(num)) {
            addMessage({ role: "assistant", content: "Invalid session number. Use /sessions to list sessions." });
            return;
          }
          const sessions = useChatStore.getState().listSessions();
          if (num < 1 || num > sessions.length) {
            addMessage({ role: "assistant", content: `Session number out of range. /sessions lists ${sessions.length} session(s).` });
            return;
          }
          useChatStore.getState().deleteSession(sessions[num - 1].id);
          addMessage({ role: "assistant", content: `Deleted session: "${sessions[num - 1].title}"` });
          return;
        }
        if (command.name === "set" && arg) {
          const parts = arg.trim().split(/\s+/);
          const key = parts[0]?.toLowerCase();
          const value = parts.slice(1).join(" ");
          if (!key || !value) {
            addMessage({
              role: "assistant",
              content: `Usage: /set <key> <value>\nKeys: temperature, maxTokens, model`,
            });
            return;
          }
          if (key === "temperature") {
            const n = parseFloat(value);
            if (isNaN(n) || n < 0 || n > 2) {
              addMessage({ role: "assistant", content: "temperature must be between 0 and 2" });
              return;
            }
            useChatStore.getState().setConfig({ temperature: n });
            addMessage({ role: "assistant", content: `temperature set to ${n}` });
            return;
          }
          if (key === "maxtokens") {
            const n = parseInt(value, 10);
            if (isNaN(n) || n < 1) {
              addMessage({ role: "assistant", content: "maxTokens must be a positive integer" });
              return;
            }
            useChatStore.getState().setConfig({ maxTokens: n });
            addMessage({ role: "assistant", content: `maxTokens set to ${n}` });
            return;
          }
          if (key === "model") {
            if (!value.trim()) {
              addMessage({ role: "assistant", content: "Model ID cannot be empty. Use /models to see available models." });
              return;
            }
            useChatStore.getState().setConfig({ model: value.trim() });
            addMessage({ role: "assistant", content: `Model set to ${value.trim()}` });
            return;
          }
          addMessage({ role: "assistant", content: `Unknown key "${key}". Valid keys: temperature, maxTokens, model` });
          return;
        }
        if (command.name === "search" && arg) {
          const result = useChatStore.getState().searchHistory(arg);
          addMessage({ role: "assistant", content: result });
          setInput("");
          return;
        }
        command.execute();
        return;
      }
      const cmd = matchCommand(text);
      if (cmd) { setInput(""); cmd.execute(); return; }
      setInput("");
      addMessage({ role: "user", content: text });
      addMessage({ role: "assistant", content: `Unknown command. Available: /clear, /models, /info, /reset, /help, /sessions, /search` });
      return;
    }

    if (messages.length === 0) {
      setConversationInfo(deriveTitle(text), Date.now());
    }
    const currentUserMessage = addMessage({ role: "user", content: text });
    addToInputHistory(text);
    setInput("");
    setInputHistoryIndex(-1);
    setCursorPos(0);

    const snapshotMessages = [
      ...messages,
      { id: currentUserMessage, role: "user" as const, content: text, timestamp: Date.now() },
    ];
    void startNormalChat(snapshotMessages);
  }, [input, isStreaming, messages, addMessage, addToInputHistory, setInputHistoryIndex, setConversationInfo, setIsStreaming, setStreamingContent, setLastError, setStatus, startNormalChat]);

  useKeyboard(
    useCallback(
      (key: { name: string; ctrl: boolean; meta: boolean; shift: boolean; sequence: string; preventDefault?: () => void }) => {
        if ((key.name === "return" || key.name === "enter") && !key.ctrl && !key.meta && !key.shift && !isStreaming && input.trim()) {
          key.preventDefault?.();
          void handleSubmit();
          return;
        }
        // Shift+Enter inserts a newline (multi-line input)
        if ((key.name === "return" || key.name === "enter") && key.shift && !isStreaming) {
          key.preventDefault?.();
          setInputHistoryIndex(-1);
          setInput((prev) => prev.slice(0, cursorPos) + "\n" + prev.slice(cursorPos));
          setCursorPos((p) => p + 1);
          return;
        }
        if (key.ctrl && key.name === "c") {
          key.preventDefault?.();
          if (isStreaming) { cancelStreaming(); }
          else { process.exit(0); }
          return;
        }
        if (key.name === "escape" && isStreaming) {
          key.preventDefault?.();
          cancelStreaming();
          return;
        }
        if (key.ctrl && key.name === "y") {
          key.preventDefault?.();
          if (lastAssistantId && lastAssistantContent) {
            copyMessage(lastAssistantId, lastAssistantContent);
          }
          return;
        }
        // Ctrl+R — run last code block
        if (key.ctrl && key.name === "r") {
          key.preventDefault?.();
          // Find the last assistant message with a code block
          const msgs = useChatStore.getState().messages;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i];
            if (msg.role !== "assistant") continue;
            const match = msg.content.match(/```(\w*)\n([\s\S]*?)```/);
            if (match) {
              const lang = match[1] || "plain";
              const code = match[2];
              const addMsg = useChatStore.getState().addMessage;
              handleRunCode(code, lang, addMsg);
              return;
            }
          }
          return;
        }
        // Ctrl+L — clear the screen (chat history)
        if (key.ctrl && key.name === "l") {
          key.preventDefault?.();
          useChatStore.getState().clearMessages();
          useChatStore.getState().setStatus("Screen cleared");
          return;
        }
        // Vi-style input editing keys
        if (key.ctrl && key.name === "u") {
          key.preventDefault?.();
          setInput("");
          setCursorPos(0);
          return;
        }
        if (key.ctrl && key.name === "k") {
          key.preventDefault?.();
          setInput(input.slice(0, cursorPos));
          return;
        }
        if (key.ctrl && key.name === "w") {
          key.preventDefault?.();
          setInput((prev) => prev.replace(/\s*\S+$/, ""));
          return;
        }
        if (key.name === "left") {
          key.preventDefault?.();
          setCursorPos((p) => Math.max(0, p - 1));
          return;
        }
        if (key.name === "right") {
          key.preventDefault?.();
          setCursorPos((p) => Math.min(input.length, p + 1));
          return;
        }
        if (key.name === "home") {
          key.preventDefault?.();
          setCursorPos(0);
          return;
        }
        if (key.name === "end") {
          key.preventDefault?.();
          setCursorPos(input.length);
          return;
        }
        if (key.name === "backspace") {
          key.preventDefault?.();
          if (cursorPos === 0) return;
          const before = input.slice(0, cursorPos - 1);
          const after = input.slice(cursorPos);
          setInput(before + after);
          setCursorPos((p) => p - 1);
          return;
        }
        if (key.name === "delete") {
          key.preventDefault?.();
          if (cursorPos >= input.length) return;
          const before = input.slice(0, cursorPos);
          const after = input.slice(cursorPos + 1);
          setInput(before + after);
          return;
        }
        if (key.name === "up" || (key.ctrl && key.name === "p")) {
          key.preventDefault?.();
          if (inputHistory.length === 0) return;
          const newIdx = inputHistoryIndex < inputHistory.length - 1 ? inputHistoryIndex + 1 : inputHistoryIndex;
          if (newIdx !== inputHistoryIndex) { setInputHistoryIndex(newIdx); setInput(inputHistory[newIdx] ?? ""); setCursorPos((inputHistory[newIdx] ?? "").length); }
          return;
        }
        if (key.name === "down" || (key.ctrl && key.name === "n")) {
          key.preventDefault?.();
          if (inputHistoryIndex <= 0) { setInputHistoryIndex(-1); setInput(""); setCursorPos(0); return; }
          const newIdx = inputHistoryIndex - 1;
          setInputHistoryIndex(newIdx);
          setInput(inputHistory[newIdx] ?? "");
          setCursorPos((inputHistory[newIdx] ?? "").length);
          return;
        }
        // Ctrl+E — edit last user message
        if (key.ctrl && key.name === "e") {
          key.preventDefault?.();
          if (isStreaming) return;
          const lastUser = findLastUserMessage(messages);
          if (!lastUser) return;
          // Remove the last user message and its following assistant response
          setIsEditing(true);
          setEditingMessageId(lastUser.id);
          setInput(lastUser.content);
          setCursorPos(lastUser.content.length);
          setStatus("Editing last message · Enter resends · Esc cancels");
          return;
        }
        // Escape — cancel edit mode
        if (key.name === "escape" && isEditing) {
          key.preventDefault?.();
          setIsEditing(false);
          setEditingMessageId(null);
          setInput("");
          setCursorPos(0);
          setStatus("Edit cancelled");
          return;
        }
        // Tab — accept auto-suggestion or slash-command completion
        if (key.name === "tab" && !key.ctrl && !key.shift) {
          key.preventDefault?.();
          // Accept input history auto-suggestion
          if (autoSuggestion && !showPalette) {
            setInput(autoSuggestion);
            setCursorPos(autoSuggestion.length);
            setAutoSuggestion("");
            return;
          }
          // Existing slash-command tab completion
          if (input.startsWith("/")) {
            const partial = input.trim().toLowerCase();
            const matches = getCommands().filter((c) =>
              c.aliases.some((a) => a.toLowerCase().startsWith(partial))
            );
            if (matches.length === 1) {
              setInput(matches[0].aliases[0] + " ");
              setCursorPos(matches[0].aliases[0].length + 1);
              setTabCompletionIdx(-1);
              return;
            }
            const nextIdx = (tabCompletionIdx + 1) % matches.length;
            setTabCompletionIdx(nextIdx);
            setInput(matches[nextIdx].aliases[0] + " ");
            setCursorPos(matches[nextIdx].aliases[0].length + 1);
            return;
          }
        }
        // PageUp/PageDown: scrollback buffer without disturbing input
        if (key.name === "pageup" || key.name === "PageUp") {
          key.preventDefault?.();
          const newOffset = scrollOffsetRef.current + 10;
          setScrollOffset(newOffset);
          scrollOffsetRef.current = newOffset;
          setIsScrolledUp(true);
          isScrolledUpRef.current = true;
          return;
        }
        if (key.name === "pagedown" || key.name === "PageDown") {
          key.preventDefault?.();
          const newOffset = Math.max(0, scrollOffsetRef.current - 10);
          setScrollOffset(newOffset);
          scrollOffsetRef.current = newOffset;
          if (newOffset === 0) { setIsScrolledUp(false); isScrolledUpRef.current = false; }
          return;
        }
        // Ctrl+G — regenerate last assistant response (any content) or retry failed
        if (key.ctrl && key.name === "g") {
          key.preventDefault?.();
          if (isStreaming) return;
          // First: try to regenerate the last assistant response (any content)
          const last = useChatStore.getState().regenerateLast();
          if (last) {
            setRetryState({ userId: last.userId, userContent: last.userContent });
            return;
          }
          // Fallback: retry a failed message
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "assistant" && messages[i].failed) {
              let userMsg: Message | null = null;
              for (let j = i - 1; j >= 0; j--) {
                if (messages[j].role === "user") { userMsg = messages[j]; break; }
              }
              if (userMsg) {
                retryMessage(messages[i].id);
                retryMessage(messages[i - 1].id);
                setRetryState({ userId: userMsg.id, userContent: userMsg.content });
              }
              return;
            }
          }
          return;
        }
        // Ctrl+V — paste from clipboard
        if (key.ctrl && (key.name === "v" || key.sequence === "\x16")) {
          key.preventDefault?.();
          if (isStreaming) return;
          navigator.clipboard.readText().then((text) => {
            if (!text) return;
            setInputHistoryIndex(-1);
            setInput((prev) => prev.slice(0, cursorPos) + text + prev.slice(cursorPos));
            setCursorPos((p) => p + text.length);
          }).catch(() => {});
          return;
        }
        if (key.ctrl && key.name === "p") {
          key.preventDefault?.();
          if (isStreaming) return;
          if (showPalette) {
            setShowPalette(false);
            setPaletteQuery("");
          } else {
            setPaletteQuery(input.startsWith("/") ? input.slice(1) : "");
            setShowPalette(true);
          }
          return;
        }
        const seq = key.sequence || key.name;
        if (seq && seq.length === 1 && !key.ctrl && !key.meta) {
          setInputHistoryIndex(-1);
          setInput((prev) => prev.slice(0, cursorPos) + seq + prev.slice(cursorPos));
          setCursorPos((p) => p + 1);
        }
      },
      [input, isStreaming, handleSubmit, cancelStreaming, setIsStreaming, setStreamingContent, inputHistory, inputHistoryIndex, setInputHistoryIndex, lastAssistantId, lastAssistantContent, cursorPos, retryMessage, messages, autoSuggestion, setAutoSuggestion]
    )
  );

  return (
    <box style={{ width: "100%", height: "100%", backgroundColor: theme.surface, flexDirection: "column" }}>
      {/* Header */}
      <box style={{ flexDirection: "row", justifyContent: "space-between", padding: 1, borderStyle: "single", borderColor: theme.border, border: ["bottom"], flexShrink: 0 }}>
        <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>◈ Orbitron</text>
        <box style={{ flexDirection: "row", gap: 1, flexGrow: 1, justifyContent: "center" }}>
          {messages.length > 0 && config.conversationTitle && (
            <text style={{ fg: theme.foreground, attributes: TextAttributes.BOLD }}>{config.conversationTitle}</text>
          )}
        </box>
        <box style={{ flexDirection: "row", gap: 1 }}>
          <text style={{ fg: healthColor }}>{healthDot}</text>
          {healthLabel ? <text style={{ fg: healthColor }}>{healthLabel}</text> : null}
          <text style={{ fg: theme.muted }}>·</text>
          <text style={{ fg: theme.foreground }}>{modelLabel}</text>
          {modelCount > 0 && (
            <text style={{ fg: theme.muted }}>· {modelCount} models</text>
          )}
          {modelContextLabel ? <text style={{ fg: theme.muted }}>· {modelContextLabel}</text> : null}
          {modelPriceLabel ? <text style={{ fg: theme.muted }}>· {modelPriceLabel}</text> : null}
        </box>
      </box>

      {/* Message area */}
      <box style={{ flexGrow: 1, flexDirection: "column", padding: 1, overflow: "hidden" }}>
        {messages.length === 0 ? (
          <box style={{ flexDirection: "column", flexGrow: 1, justifyContent: "center", alignItems: "center" }}>
            <box
              style={{
                width: getTerminalColumns() < 90 ? 42 : 58,
                flexDirection: "column",
                alignItems: "center",
                borderStyle: "double",
                borderColor: theme.primary,
                backgroundColor: theme.surface,
                padding: 1,
              }}
            >
              <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>╔═══════════════════════════╗</text>
              <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>║   ◈  O R B I T R O N  ║</text>
              <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>╚═══════════════════════════╝</text>
              <text style={{ fg: theme.muted }}> </text>
              <text style={{ fg: theme.foreground, attributes: TextAttributes.BOLD }}>Pinned to the Orbitron server</text>
              <text style={{ fg: healthColor }}>
                {healthDot} {backendHealth === "ok" ? "connected" : backendHealth === "error" ? "server error" : "checking"}
                {healthLabel ? ` · ${healthLabel}` : ""}
              </text>
              <text style={{ fg: theme.muted }}>
                {backendLabel} · {modelLabel}{modelContextLabel ? ` · ${modelContextLabel}` : ""}{modelPriceLabel ? ` · ${modelPriceLabel}` : ""}
              </text>
              <text style={{ fg: theme.muted }}> </text>
              <text style={{ fg: theme.foreground }}>Type a prompt, or jump in with a command:</text>
              <text style={{ fg: theme.primary }}>/models · /sessions · /status · /search · /info</text>
              <text style={{ fg: theme.muted }}> </text>
              <text style={{ fg: theme.border }}>┌─────────────────────────────┐</text>
              <text style={{ fg: theme.border }}>│      Quick Reference       │</text>
              <text style={{ fg: theme.border }}>├─────────────────────────────┤</text>
              {(() => {
                const cols = getTerminalColumns();
                const isMobile = cols < 90;
                const shortcuts = isMobile ? [
                  "Enter          send",
                  "Shift+Enter    newline",
                  "/models        switch model",
                  "/status        snapshot",
                  "/search        search history",
                ] : [
                  "Enter            send message",
                  "Shift+Enter      newline",
                  "↑↓               input history",
                  "Tab              accept suggestion",
                  "/models          switch model",
                  "/sessions        restore work",
                  "/status          server snapshot",
                  "/search          find older prompts",
                  "/info            model details",
                  "Ctrl+P           command palette",
                  "Ctrl+R           run code",
                  "Ctrl+G           regenerate",
                  "Ctrl+V           paste",
                  "Ctrl+L           clear all",
                ];
                return shortcuts.map((line) => (
                  <text key={line} style={{ fg: theme.muted }}>│  {line.padEnd(24)} │</text>
                ));
              })()}
              <text style={{ fg: theme.border }}>└─────────────────────────────┘</text>
              <text style={{ fg: theme.muted }}> </text>
              <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>Ready — type your first message</text>
            </box>
          </box>
        ) : null}

        {messages.map((msg, idx) => {
          const prev = idx > 0 ? messages[idx - 1] : null;
          const groupKey = getGroupKey(msg, prev);
          const isFirstInGroup = prev ? getGroupKey(msg, prev) !== getGroupKey(messages[idx - 1], idx > 1 ? messages[idx - 2] : null) : true;
          const isUser = msg.role === "user";
          const isAssistant = msg.role === "assistant";
          const isFailed = msg.failed;
          const contentFg = isUser ? theme.foreground : isAssistant ? (isFailed ? theme.error : theme.muted) : theme.muted;

          // Separator between role groups
          const showSeparator = prev && prev.role !== msg.role;

          return (
            <React.Fragment key={msg.id}>
              {showSeparator && (
                <box style={{ borderStyle: "single", borderColor: theme.border, border: ["top"] }} />
              )}
              <box style={{}}>
                {/* Role badge — only on first of group */}
                {isFirstInGroup && (
                  <box style={{ flexDirection: "row", gap: 1 }}>
                    <text style={isUser ? { fg: theme.secondary } : { fg: theme.primary, attributes: TextAttributes.BOLD }}>
                      {isUser ? " you  " : isFailed ? "!ai   " : " ai   "}
                    </text>
                    <text style={{ fg: theme.muted }}>{relativeTime(msg.timestamp)}</text>
                  </box>
                )}
                {/* Message content */}
                {isAssistant
                  ? <>{renderMessageContent(msg.content, theme)}</>
                  : <text style={{ fg: contentFg, wrapMode: "word" }}>{msg.content}</text>
                }
                {/* Copy indicator */}
                {copiedId === msg.id && <text style={{ fg: theme.success }}> ✓ copied</text>}
                {/* Failed retry hint */}
                {isFailed && <text style={{ fg: theme.warning }}> · ↻ Ctrl+G to retry</text>}
              </box>
            </React.Fragment>
          );
        })}

        {isStreaming && (
          <box>
            <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}> ai   </text>
            {streamingContent
              ? <StreamingMessageContent content={streamingContent} theme={theme} cursorBlink={cursorBlink} />
              : <>
                <text style={{ fg: theme.primary }}>{SPINNER_FRAMES[thinkingFrame]}</text>
                <text style={{ fg: theme.muted }}> thinking{thinkingElapsed > 0 ? ` (${thinkingElapsed.toFixed(1)}s)` : ""}</text>
              </>
            }
          </box>
        )}

        <box ref={scrollAnchorRef as any} />
      </box>

      {/* Context window usage bar — shown when context is above 50% */}
      {(contextTokens > 0 || contextWarning) && (
        <box
          style={{
            paddingLeft: 1,
            paddingRight: 1,
            paddingTop: 0,
            paddingBottom: 0,
            flexShrink: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 1,
            borderStyle: "single",
            borderColor: contextWarning ? theme.warning : theme.border,
            border: ["top"],
          }}
        >
          <text style={{ fg: contextWarning ? theme.warning : theme.muted }}>
            {contextWarning ? "⚠ context" : "ctx"}
          </text>
          <text style={{ fg: contextWarning ? theme.warning : theme.muted }}>
            {Math.round(contextTokens / 1024)}k / {Math.round((config.contextWindow ?? 128000) / 1024)}k tok
          </text>
          {contextWarning && (
            <text style={{ fg: theme.warning }}>
              · long conv · older msgs may be dropped
            </text>
          )}
        </box>
      )}

      {/* New messages banner — appears when scrolled up and new messages arrive */}
      {msgCountVisible && newMsgCount > 0 && (
        <box
          style={{
            padding: 1,
            flexShrink: 0,
            borderStyle: "single",
            borderColor: theme.primary,
            border: ["top", "bottom"],
            backgroundColor: theme.primary,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <text
            style={{ fg: theme.surface, attributes: TextAttributes.BOLD }}
            
          >
            ▼ {newMsgCount} new message{newMsgCount !== 1 ? "s" : ""} · press PgDn to jump to latest
          </text>
        </box>
      )}

      {/* Error bar */}
      {lastError && (
        <box style={{ padding: 1, flexShrink: 0 }}>
          <text style={{ fg: theme.error }}>✗ {lastError}</text>
        </box>
      )}

      {/* Input line */}
      <box style={{ flexDirection: "row", padding: 1, borderStyle: "single", borderColor: theme.border, border: ["top"], flexShrink: 0, alignItems: "center" }}>
        <text style={{ fg: theme.primary }}>›</text>
        <box style={{ flexDirection: "row", flexGrow: 1, marginLeft: 1, alignItems: "center" }}>
          <text style={{ fg: theme.foreground }}>
            {input.slice(0, cursorPos)}
            {cursorBlink && !isStreaming ? "█" : (input[cursorPos] || " ")}
            {input.slice(cursorPos + 1)}
          </text>
          {autoSuggestion ? (
            <text style={{ fg: theme.muted }}>{autoSuggestion.slice(input.length)}</text>
          ) : null}
        </box>
        {isStreaming ? (
          <box style={{ flexDirection: "row", alignItems: "center" }}>
            {throughput
              ? <text style={{ fg: theme.success }}>{throughput.tokens} tok · {throughput.elapsed.toFixed(1)}s · {throughput.tpm} tok/min{streamingStartRef.current ? ` · ETA ${Math.max(1, Math.round(((tokenCountRef.current / Math.max(throughput.tpm, 1)) * 60) - throughput.elapsed))}s` : ""}</text>
              : <text style={{ fg: theme.warning }}>▌ Ctrl+C stop</text>
            }
          </box>
        ) : isEditing ? (
          <text style={{ fg: theme.warning }}>Editing · Enter resends · Esc cancels</text>
        ) : (
          <text style={{ fg: theme.muted }}>
            {estimatedTokens} tok{autoSuggestion ? " · Tab ⇥ accept" : ""}
          </text>
        )}
      </box>

      {/* Status bar */}
      <box style={{ flexDirection: "row", padding: 0, flexShrink: 0, alignItems: "center" }}>
        <text style={{ fg: healthColor }}>{healthDot}</text>
        {healthLabel ? <text style={{ fg: healthColor, marginLeft: 1 }}>{healthLabel}</text> : null}
        <text style={{ fg: theme.muted, flexGrow: 1 }} />
        <text style={{ fg: theme.muted }}>
          {commandHint
            ? `${commandHint.alias} · ${commandHint.description}`
            : (() => {
                const cols = getTerminalColumns();
                const isMobile = cols < 90;
                return isMobile
                  ? "↑↓ hist · /sessions · /status · Ctrl+P palette"
                  : "↑↓ hist · Tab suggestion · Ctrl+P palette · /sessions · /status · /search · PgUp/PgDn scroll · Ctrl+G regenerate · Ctrl+R run · Ctrl+V paste";
              })()}
        </text>
      </box>

      {/* Command Palette overlay */}
      {showPalette && (
        <CommandPalette
          initialQuery={paletteQuery}
          onLoadHistory={(value) => {
            setInput(value);
            setCursorPos(value.length);
            setInputHistoryIndex(-1);
            setAutoSuggestion("");
          }}
          onClose={() => {
            setShowPalette(false);
            setPaletteQuery("");
          }}
        />
      )}
    </box>
  );
}

export function encodeInput(text: string): number {
  return encodeTokens(text).length;
}

export function countStreamingTokens(text: string): number {
  return encodeTokens(text).length;
}