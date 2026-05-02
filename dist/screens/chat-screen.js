"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatScreen = ChatScreen;
exports.encodeInput = encodeInput;
exports.countStreamingTokens = countStreamingTokens;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = __importStar(require("react"));
const react_2 = require("@opentui/react");
const core_1 = require("@opentui/core");
const chat_store_1 = require("../store/chat-store");
const index_1 = require("../theme/index");
const chat_1 = require("../api/chat");
const message_pipeline_1 = require("../lib/message-pipeline");
const commands_1 = require("../commands");
const markdown_1 = require("../lib/markdown");
const model_names_1 = require("../lib/model-names");
const gpt_tokenizer_1 = require("gpt-tokenizer");
const execute_1 = require("../lib/execute");
function getTerminalColumns() {
    try {
        return typeof process !== "undefined" && process.stdout && process.stdout.columns
            ? process.stdout.columns
            : Infinity;
    }
    catch {
        return Infinity;
    }
}
// ─── Timestamp helper ─────────────────────────────────────────────────────────
function relativeTime(ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 5)
        return "just now";
    if (diff < 60)
        return `${Math.floor(diff)}s ago`;
    if (diff < 3600)
        return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)
        return `${Math.floor(diff / 3600)}h ago`;
    return new Date(ts).toLocaleDateString();
}
function fuzzyScore(query, text) {
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t === q)
        return 100;
    if (t.startsWith(q))
        return 90;
    if (t.includes(q))
        return 80 - t.indexOf(q);
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi])
            qi++;
    }
    return qi === q.length ? 60 - qi : 0;
}
function getCommandHint(input) {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/"))
        return null;
    const head = trimmed.split(/\s+/)[0].toLowerCase();
    const matches = (0, commands_1.getCommands)()
        .flatMap((command) => command.aliases.map((alias) => ({ command, alias })))
        .filter(({ alias }) => alias.toLowerCase().startsWith(head))
        .sort((a, b) => a.alias.length - b.alias.length);
    const best = matches[0];
    return best ? { alias: best.alias, description: best.command.description } : null;
}
function CommandPalette({ onClose, initialQuery, onLoadHistory }) {
    const theme = (0, index_1.getTheme)("dark");
    const config = (0, chat_store_1.useChatStore)((s) => s.config);
    const messages = (0, chat_store_1.useChatStore)((s) => s.messages);
    const inputHistory = (0, chat_store_1.useChatStore)((s) => s.inputHistory);
    const availableModels = (0, chat_store_1.useChatStore)((s) => s.availableModels);
    const addMessage = (0, chat_store_1.useChatStore)((s) => s.addMessage);
    const setConfig = (0, chat_store_1.useChatStore)((s) => s.setConfig);
    const [query, setQuery] = (0, react_1.useState)("");
    const [selectedIdx, setSelectedIdx] = (0, react_1.useState)(0);
    const [items, setItems] = (0, react_1.useState)([]);
    const allItemsRef = (0, react_1.useRef)([]);
    (0, react_1.useEffect)(() => {
        setQuery(initialQuery);
        setSelectedIdx(0);
    }, [initialQuery]);
    const resetQuery = (0, react_1.useCallback)(() => {
        setQuery("");
        setSelectedIdx(0);
    }, []);
    (0, react_1.useEffect)(() => {
        const cmds = (0, commands_1.getCommands)();
        const cmdItems = cmds.map((c) => ({
            id: c.name,
            label: c.aliases[0],
            description: c.description,
            type: "command",
            execute: c.execute,
        }));
        const historyItems = inputHistory.slice(0, 10).map((h, i) => ({
            id: `history-${i}`,
            label: h.slice(0, 60),
            description: `Recent prompt · ${h.length} chars`,
            type: "history",
            execute: () => {
                onLoadHistory(h);
                onClose();
            },
        }));
        const modelItems = availableModels.slice(0, 20).map((m) => ({
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
    (0, react_1.useEffect)(() => {
        if (!query) {
            setItems(allItemsRef.current);
        }
        else {
            const scored = allItemsRef.current
                .map((item) => ({ item, score: Math.max(fuzzyScore(query, item.label), fuzzyScore(query, item.description)) }))
                .filter((x) => x.score > 0)
                .sort((a, b) => b.score - a.score)
                .map((x) => x.item);
            setItems(scored);
        }
        setSelectedIdx(0);
    }, [query]);
    (0, react_1.useEffect)(() => {
        const handleKey = (e) => {
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
            }
            else if (e.key === "ArrowUp" || e.key === "k") {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
            }
            else if (e.key === "Enter") {
                e.preventDefault();
                if (items[selectedIdx]) {
                    items[selectedIdx].execute();
                    onClose();
                }
            }
            else if (e.key === "Escape") {
                e.preventDefault();
                if (query) {
                    resetQuery();
                }
                else {
                    onClose();
                }
            }
            else if (e.key === "Backspace") {
                e.preventDefault();
                if (query) {
                    setQuery((q) => q.slice(0, -1));
                }
                else {
                    onClose();
                }
            }
        };
        window.addEventListener("keydown", handleKey);
        return () => window.removeEventListener("keydown", handleKey);
    }, [items, selectedIdx, query, onClose, resetQuery]);
    const typeColor = (type) => {
        switch (type) {
            case "command": return theme.primary;
            case "history": return theme.info;
            case "model": return theme.success;
        }
    };
    return ((0, jsx_runtime_1.jsx)("box", { style: {
            position: "absolute",
            top: 0, left: 0, width: "100%", height: "100%",
            backgroundColor: "rgba(0,0,0,0.7)",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            paddingTop: 4,
        }, children: (0, jsx_runtime_1.jsxs)("box", { style: {
                width: 56,
                flexDirection: "column",
                borderStyle: "double",
                borderColor: theme.primary,
                backgroundColor: theme.surface,
            }, children: [(0, jsx_runtime_1.jsxs)("box", { style: {
                        padding: 1,
                        borderStyle: "single",
                        borderColor: theme.border,
                        border: ["bottom"],
                        flexDirection: "row",
                        alignItems: "center",
                    }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "\u203A" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted, marginLeft: 1 }, children: "cmd:" }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.foreground, marginLeft: 1 }, children: [query || "_", "\u2588"] })] }), (0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "column", maxHeight: 12, padding: 0 }, children: [items.length === 0 && ((0, jsx_runtime_1.jsx)("box", { style: { padding: 1 }, children: (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "No results" }) })), items.slice(0, 12).map((item, idx) => ((0, jsx_runtime_1.jsxs)("box", { style: {
                                padding: 1,
                                borderStyle: "single",
                                borderColor: idx === selectedIdx ? theme.primary : "transparent",
                                border: idx === selectedIdx ? ["left"] : [],
                            }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: idx === selectedIdx ? theme.primary : theme.muted, marginRight: 1 }, children: idx === selectedIdx ? "▸" : " " }), (0, jsx_runtime_1.jsx)("text", { style: { fg: typeColor(item.type), attributes: idx === selectedIdx ? core_1.TextAttributes.BOLD : undefined }, children: item.label.slice(0, 28) }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted, marginLeft: 2 }, children: item.description.slice(0, 28) })] }, item.id)))] }), (0, jsx_runtime_1.jsxs)("box", { style: {
                        padding: 1,
                        borderStyle: "single",
                        borderColor: theme.border,
                        border: ["top"],
                        flexDirection: "row",
                        justifyContent: "space-between",
                    }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "\u2191\u2193 nav \u00B7 \u21B5 select \u00B7 Esc close" }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: [items.length, " results"] })] })] }) }));
}
// Spinner frames for the thinking indicator
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"];
const SPIN_INTERVAL = 120;
// Streaming markdown renderer — renders segments as they become available
// progressiveSegments: segments that have been fully parsed so far
// streamingContent: the raw content still being accumulated
function StreamingMessageContent({ content, theme, cursorBlink }) {
    const [progressiveSegments, setProgressiveSegments] = (0, react_1.useState)([]);
    const [incompleteCode, setIncompleteCode] = (0, react_1.useState)("");
    const [codeBlockMode, setCodeBlockMode] = (0, react_1.useState)(false);
    (0, react_1.useEffect)(() => {
        const segs = (0, markdown_1.parseMarkdown)(content);
        setProgressiveSegments(segs);
        const lines = content.split("\n");
        let inCode = false;
        let lastCodeStart = -1;
        for (let i = 0; i < lines.length; i++) {
            if (/^```/.test(lines[i]) && !inCode) {
                inCode = true;
                lastCodeStart = i;
            }
            else if (/^```/.test(lines[i]) && inCode) {
                inCode = false;
                lastCodeStart = -1;
            }
        }
        if (inCode && lastCodeStart >= 0) {
            const codeContent = lines.slice(lastCodeStart + 1).join("\n");
            setIncompleteCode(codeContent);
            setCodeBlockMode(true);
        }
        else {
            setIncompleteCode("");
            setCodeBlockMode(false);
        }
    }, [content]);
    const segs = progressiveSegments;
    return ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [segs.map((seg) => renderSegment(seg, theme)), codeBlockMode && incompleteCode && ((0, jsx_runtime_1.jsx)("box", { style: { flexDirection: "column" }, children: incompleteCode.split("\n").map((line, i) => ((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: line }, i))) })), !codeBlockMode && ((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: cursorBlink ? "█" : " " }))] }));
}
// Strip ANSI codes for width measurement
function stripAnsi(text) {
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
function pad(text, width, align) {
    const clean = stripAnsi(text);
    const padded = clean.length >= width ? clean.slice(0, width) : clean + " ".repeat(width - clean.length);
    if (align === "right")
        return " ".repeat(width - clean.length) + clean;
    if (align === "center") {
        const left = Math.floor((width - clean.length) / 2);
        return " ".repeat(left) + clean + " ".repeat(width - clean.length - left);
    }
    return padded;
}
function renderTable(headers, rows, alignments, theme) {
    const cols = headers.length;
    const colWidths = headers.map((h) => stripAnsi(h).length);
    for (const row of rows) {
        for (let c = 0; c < cols; c++) {
            const cell = stripAnsi(row[c] ?? "").length;
            if (cell > colWidths[c])
                colWidths[c] = cell;
        }
    }
    const totalWidth = colWidths.reduce((a, b) => a + b, 0) + cols + 1;
    const border = "─".repeat(totalWidth);
    const lines = [];
    // Top border
    lines.push((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: `┌${colWidths.map((w, i) => `─`.repeat(w) + (i < cols - 1 ? "┬" : "")).join("")}┐\n` }, `tb-top`));
    // Header row
    lines.push((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "|" + headers.map((h, i) => ` ${pad(h, colWidths[i], alignments[i])} |`).join("") + "\n" }, `tb-header`));
    // Separator
    lines.push((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: `├${colWidths.map((w, i) => `─`.repeat(w) + (i < cols - 1 ? "┼" : "")).join("")}┤\n` }, `tb-sep`));
    // Data rows
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        lines.push((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground }, children: "|" + row.map((cell, i) => ` ${pad(cell ?? "", colWidths[i], alignments[i])} |`).join("") + "\n" }, `tb-row-${r}`));
    }
    // Bottom border
    lines.push((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: `└${colWidths.map((w, i) => `─`.repeat(w) + (i < cols - 1 ? "┴" : "")).join("")}┘\n` }, `tb-bot`));
    return (0, jsx_runtime_1.jsx)(jsx_runtime_1.Fragment, { children: lines });
}
function renderSegment(seg, theme) {
    const fg = (0, markdown_1.getSegmentFg)(seg, theme, false);
    const attrs = (0, markdown_1.getSegmentAttrs)(seg);
    if (seg.type === "codeBlock") {
        return ((0, jsx_runtime_1.jsx)("text", { style: { fg: (0, markdown_1.getLangColor)(seg.lang, theme), attributes: attrs }, children: `\n${seg.content}` }, seg.content.slice(0, 20)));
    }
    if (seg.type === "highlightedCode" && seg.lang) {
        const tokens = (0, markdown_1.tokenizeCode)(seg.content, seg.lang);
        return ((0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row" }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground }, children: `\n` }), tokens.map((tok, i) => ((0, jsx_runtime_1.jsx)("text", { style: { fg: (0, markdown_1.getTokenFg)(tok.type) }, children: tok.value }, i)))] }, seg.content.slice(0, 20)));
    }
    if (seg.type === "latex" || seg.type === "latexBlock") {
        const isBlock = seg.type === "latexBlock";
        const { tokens } = (0, markdown_1.renderLatex)(seg.content, isBlock);
        return ((0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row" }, children: [isBlock ? (0, jsx_runtime_1.jsx)("text", { style: { fg: "#4ec9b0" }, children: `\n` }) : null, tokens.map((tok, i) => ((0, jsx_runtime_1.jsx)("text", { style: { fg: (0, markdown_1.getLatexTokenFg)(tok.type) }, children: tok.value }, i)))] }, seg.content.slice(0, 20)));
    }
    if (seg.type === "table" && seg.headers && seg.rows) {
        return renderTable(seg.headers, seg.rows, seg.alignments ?? [], theme);
    }
    if (seg.type === "link") {
        const url = seg.content;
        const osc8 = `\x1b]8;id=0;${url}\x1b\\`;
        const text = osc8 + seg.content + `\x1b]8;;\x1b\\`;
        return ((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.info }, children: text }, seg.content.slice(0, 20)));
    }
    if (seg.type === "h1")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: `\n${seg.content}\n` }, seg.content.slice(0, 20));
    if (seg.type === "h2")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: `\n${seg.content}\n` }, seg.content.slice(0, 20));
    if (seg.type === "h3")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: `${seg.content}\n` }, seg.content.slice(0, 20));
    if (seg.type === "bold")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg, attributes: attrs }, children: seg.content }, seg.content.slice(0, 20));
    if (seg.type === "italic")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg, attributes: attrs }, children: seg.content }, seg.content.slice(0, 20));
    if (seg.type === "code")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.warning, attributes: core_1.TextAttributes.BOLD }, children: ` ${seg.content} ` }, seg.content.slice(0, 20));
    if (seg.type === "list")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg }, children: `${seg.content}\n` }, seg.content.slice(0, 20));
    if (seg.type === "blockquote")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted, attributes: core_1.TextAttributes.BOLD }, children: `▌ ${seg.content}\n` }, seg.content.slice(0, 20));
    if (seg.type === "hr")
        return (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: `${seg.content}\n` }, seg.content.slice(0, 20));
    return (0, jsx_runtime_1.jsx)("text", { style: { fg, wrapMode: "word" }, children: seg.content }, seg.content.slice(0, 20));
}
// Render a completed message's content — parses markdown and renders segments
function renderMessageContent(content, theme) {
    const segments = (0, markdown_1.parseMarkdown)(content);
    return segments.map((seg, i) => ((0, jsx_runtime_1.jsx)(react_1.default.Fragment, { children: renderSegment(seg, theme) }, i)));
}
// Detect consecutive same-role messages to group them visually
function getGroupKey(msg, prev) {
    if (!prev)
        return `${msg.role}-${msg.timestamp}`;
    if (prev.role !== msg.role)
        return `${msg.role}-${msg.timestamp}`;
    if (msg.timestamp - prev.timestamp > 30000)
        return `${msg.role}-${msg.timestamp}`;
    return "same";
}
// Find the last user message in the conversation
function findLastUserMessage(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user")
            return messages[i];
    }
    return null;
}
function ChatScreen(_props) {
    const theme = (0, index_1.getTheme)("dark");
    const config = (0, chat_store_1.useChatStore)((s) => s.config);
    const messages = (0, chat_store_1.useChatStore)((s) => s.messages);
    const addMessage = (0, chat_store_1.useChatStore)((s) => s.addMessage);
    const updateMessage = (0, chat_store_1.useChatStore)((s) => s.updateMessage);
    const isStreaming = (0, chat_store_1.useChatStore)((s) => s.isStreaming);
    const setIsStreaming = (0, chat_store_1.useChatStore)((s) => s.setIsStreaming);
    const streamingContent = (0, chat_store_1.useChatStore)((s) => s.streamingContent);
    const setStreamingContent = (0, chat_store_1.useChatStore)((s) => s.setStreamingContent);
    const lastError = (0, chat_store_1.useChatStore)((s) => s.lastError);
    const setLastError = (0, chat_store_1.useChatStore)((s) => s.setLastError);
    const setStatus = (0, chat_store_1.useChatStore)((s) => s.setStatus);
    const setScreen = (0, chat_store_1.useChatStore)((s) => s.setScreen);
    const setConversationInfo = (0, chat_store_1.useChatStore)((s) => s.setConversationInfo);
    const addToInputHistory = (0, chat_store_1.useChatStore)((s) => s.addToInputHistory);
    const inputHistory = (0, chat_store_1.useChatStore)((s) => s.inputHistory);
    const inputHistoryIndex = (0, chat_store_1.useChatStore)((s) => s.inputHistoryIndex);
    const setInputHistoryIndex = (0, chat_store_1.useChatStore)((s) => s.setInputHistoryIndex);
    const availableModels = (0, chat_store_1.useChatStore)((s) => s.availableModels);
    const backendHealth = (0, chat_store_1.useChatStore)((s) => s.backendHealth);
    const backendLatencyMs = (0, chat_store_1.useChatStore)((s) => s.backendLatencyMs);
    const checkHealth = (0, chat_store_1.useChatStore)((s) => s.checkHealth);
    const [cursorBlink, setCursorBlink] = (0, react_1.useState)(true);
    const [cursorPos, setCursorPos] = (0, react_1.useState)(0);
    const [input, setInput] = (0, react_1.useState)("");
    const [modelCount, setModelCount] = (0, react_1.useState)(0);
    const [copiedId, setCopiedId] = (0, react_1.useState)(null);
    const [thinkingFrame, setThinkingFrame] = (0, react_1.useState)(0);
    const [tabCompletionIdx, setTabCompletionIdx] = (0, react_1.useState)(-1);
    const [isEditing, setIsEditing] = (0, react_1.useState)(false);
    const [editingMessageId, setEditingMessageId] = (0, react_1.useState)(null);
    const abortControllerRef = (0, react_1.useRef)(null);
    const scrollAnchorRef = (0, react_1.useRef)(null);
    const streamingStartRef = (0, react_1.useRef)(null);
    const tokenCountRef = (0, react_1.useRef)(0);
    const throughputIntervalRef = (0, react_1.useRef)(null);
    const [throughput, setThroughput] = (0, react_1.useState)(null);
    // Scrollback buffer: auto-scroll-to-bottom behaviour
    const [isScrolledUp, setIsScrolledUp] = (0, react_1.useState)(false);
    const [scrollOffset, setScrollOffset] = (0, react_1.useState)(0);
    const [newMsgCount, setNewMsgCount] = (0, react_1.useState)(0);
    const [msgCountVisible, setMsgCountVisible] = (0, react_1.useState)(false);
    const isScrolledUpRef = (0, react_1.useRef)(false);
    const scrollOffsetRef = (0, react_1.useRef)(0);
    const retryMessage = (0, chat_store_1.useChatStore)((s) => s.retryMessage);
    const [retryState, setRetryState] = (0, react_1.useState)(null);
    const [showPalette, setShowPalette] = (0, react_1.useState)(false);
    const [paletteQuery, setPaletteQuery] = (0, react_1.useState)("");
    const [autoSuggestion, setAutoSuggestion] = (0, react_1.useState)("");
    const contextTokens = (0, chat_store_1.useChatStore)((s) => s.contextTokens);
    const contextWarning = (0, chat_store_1.useChatStore)((s) => s.contextWarning);
    const updateContextTokens = (0, chat_store_1.useChatStore)((s) => s.updateContextTokens);
    const apiKeyMissing = false;
    const commandHint = getCommandHint(input);
    const startNormalChat = (0, react_1.useCallback)(async (snapshotMessages) => {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        setIsStreaming(true);
        setStreamingContent("");
        setStatus("Thinking...");
        streamingStartRef.current = Date.now();
        tokenCountRef.current = 0;
        setThroughput(null);
        if (throughputIntervalRef.current)
            clearInterval(throughputIntervalRef.current);
        throughputIntervalRef.current = setInterval(() => {
            if (streamingStartRef.current) {
                const elapsed = (Date.now() - streamingStartRef.current) / 1000;
                const mins = elapsed / 60;
                const tpm = mins > 0 ? Math.round(tokenCountRef.current / mins) : tokenCountRef.current;
                setThroughput({ tokens: tokenCountRef.current, elapsed, tpm });
            }
        }, 600);
        try {
            const result = await (0, message_pipeline_1.runMessagePipeline)({
                messages: snapshotMessages.map((m) => ({ role: m.role, content: String(m.content ?? "") })),
                config: {
                    baseUrl: config.baseUrl,
                    apiKey: config.apiKey,
                    model: config.model,
                    temperature: config.temperature,
                    maxTokens: config.maxTokens,
                },
            }, {
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
            });
            if (result.cancelled) {
                setStatus("Cancelled");
                if (result.content) {
                    addMessage({ role: "assistant", content: `${result.content} [cancelled]`, failed: false });
                }
                else {
                    addMessage({ role: "assistant", content: "[empty response]", failed: true });
                }
            }
            else {
                addMessage({ role: "assistant", content: result.content });
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setLastError(msg);
            addMessage({ role: "assistant", content: `[Error] ${msg}`, failed: true });
        }
        finally {
            abortControllerRef.current = null;
            setIsStreaming(false);
            setStreamingContent("");
            streamingStartRef.current = null;
            if (throughputIntervalRef.current)
                clearInterval(throughputIntervalRef.current);
            if (!abortController.signal.aborted)
                setStatus("Ready");
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
    (0, react_1.useEffect)(() => {
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
    const modelLabel = (0, model_names_1.getDisplayName)(config.model);
    const estimatedTokens = (0, gpt_tokenizer_1.encode)(input).length;
    // Cursor blink while not streaming
    (0, react_1.useEffect)(() => {
        if (isStreaming)
            return;
        const id = setInterval(() => setCursorBlink((p) => !p), 500);
        return () => clearInterval(id);
    }, [isStreaming]);
    // Auto-show palette when input starts with /
    (0, react_1.useEffect)(() => {
        if (input.startsWith("/") && input.length > 1 && !showPalette) {
            setShowPalette(true);
        }
    }, [input, showPalette]);
    // Spinner animation for thinking state
    (0, react_1.useEffect)(() => {
        if (!isStreaming)
            return;
        const id = setInterval(() => setThinkingFrame((f) => (f + 1) % SPINNER_FRAMES.length), SPIN_INTERVAL);
        return () => clearInterval(id);
    }, [isStreaming]);
    // Cleanup throughput interval on unmount or streaming end
    (0, react_1.useEffect)(() => {
        return () => {
            if (throughputIntervalRef.current)
                clearInterval(throughputIntervalRef.current);
        };
    }, []);
    // Auto-scroll: only scroll to bottom when not manually scrolled up
    (0, react_1.useEffect)(() => {
        if (isScrolledUpRef.current)
            return;
        if (scrollAnchorRef.current) {
            try {
                scrollAnchorRef.current.scrollIntoView({ block: "end" });
            }
            catch { }
        }
    }, [streamingContent, messages.length]);
    // Track new message count while scrolled up
    const prevMsgCountRef = (0, react_1.useRef)(messages.length);
    (0, react_1.useEffect)(() => {
        if (isScrolledUpRef.current && messages.length > prevMsgCountRef.current) {
            const delta = messages.length - prevMsgCountRef.current;
            setNewMsgCount((n) => n + delta);
            setMsgCountVisible(true);
        }
        prevMsgCountRef.current = messages.length;
    }, [messages.length]);
    const cancelStreaming = (0, react_1.useCallback)(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsStreaming(false);
        setStreamingContent("");
        setStatus("Ready");
    }, [setIsStreaming, setStreamingContent, setStatus]);
    const copyMessage = (0, react_1.useCallback)((id, content) => {
        try {
            process.stdout.write(`\x1b]52;c;${Buffer.from(content).toString("base64")}\x1b\\`);
        }
        catch { }
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1200);
    }, []);
    (0, react_1.useEffect)(() => {
        if (inputHistoryIndex >= 0 && inputHistory[inputHistoryIndex] !== undefined) {
            setInput(inputHistory[inputHistoryIndex]);
        }
    }, [inputHistoryIndex, inputHistory]);
    // Handle retry state — when Ctrl+G removes a failed message and triggers resubmit
    (0, react_1.useEffect)(() => {
        if (!retryState)
            return;
        const { userContent } = retryState;
        setRetryState(null);
        setStatus("Retrying...");
        setTimeout(() => {
            const text = userContent;
            const currentMessages = chat_store_1.useChatStore.getState().messages;
            const currentUserMessage = addMessage({ role: "user", content: text });
            addToInputHistory(text);
            setInput("");
            setInputHistoryIndex(-1);
            setCursorPos(0);
            void startNormalChat([
                ...currentMessages,
                { id: currentUserMessage, role: "user", content: text, timestamp: Date.now() },
            ]);
        }, 50);
    }, [retryState, addMessage, addToInputHistory, setStatus, setInputHistoryIndex, startNormalChat]);
    (0, react_1.useEffect)(() => {
        setStatus("Discovering models...");
        (0, chat_1.listModels)(config.baseUrl)
            .then((m) => setModelCount(m.length))
            .catch((err) => setLastError(err.message))
            .finally(() => setStatus("Ready"));
    }, [config.baseUrl, setLastError, setStatus]);
    // Auto-suggestion: find input history entries matching what the user has typed
    (0, react_1.useEffect)(() => {
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
    const handleJumpToLatest = (0, react_1.useCallback)(() => {
        setScrollOffset(0);
        setIsScrolledUp(false);
        isScrolledUpRef.current = false;
        setNewMsgCount(0);
        setMsgCountVisible(false);
    }, [setScrollOffset, setIsScrolledUp]);
    const handleSubmit = (0, react_1.useCallback)(async () => {
        const text = input.trim();
        if (!text || isStreaming)
            return;
        if ((0, commands_1.isCommandInput)(text)) {
            const withArgs = (0, commands_1.matchCommandWithArgs)(text);
            if (withArgs) {
                setInput("");
                const { command, arg } = withArgs;
                if (command.name === "load" && arg) {
                    const num = parseInt(arg, 10);
                    if (isNaN(num)) {
                        addMessage({ role: "assistant", content: "Invalid session number. Use /sessions to list sessions." });
                        return;
                    }
                    const sessions = chat_store_1.useChatStore.getState().listSessions();
                    if (num < 1 || num > sessions.length) {
                        addMessage({ role: "assistant", content: `Session number out of range. /sessions lists ${sessions.length} session(s).` });
                        return;
                    }
                    chat_store_1.useChatStore.getState().loadSession(sessions[num - 1].id);
                    addMessage({ role: "assistant", content: `Loaded session: "${sessions[num - 1].title}"` });
                    return;
                }
                if (command.name === "delete" && arg) {
                    const num = parseInt(arg, 10);
                    if (isNaN(num)) {
                        addMessage({ role: "assistant", content: "Invalid session number. Use /sessions to list sessions." });
                        return;
                    }
                    const sessions = chat_store_1.useChatStore.getState().listSessions();
                    if (num < 1 || num > sessions.length) {
                        addMessage({ role: "assistant", content: `Session number out of range. /sessions lists ${sessions.length} session(s).` });
                        return;
                    }
                    chat_store_1.useChatStore.getState().deleteSession(sessions[num - 1].id);
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
                        chat_store_1.useChatStore.getState().setConfig({ temperature: n });
                        addMessage({ role: "assistant", content: `temperature set to ${n}` });
                        return;
                    }
                    if (key === "maxtokens") {
                        const n = parseInt(value, 10);
                        if (isNaN(n) || n < 1) {
                            addMessage({ role: "assistant", content: "maxTokens must be a positive integer" });
                            return;
                        }
                        chat_store_1.useChatStore.getState().setConfig({ maxTokens: n });
                        addMessage({ role: "assistant", content: `maxTokens set to ${n}` });
                        return;
                    }
                    if (key === "model") {
                        if (!value.trim()) {
                            addMessage({ role: "assistant", content: "Model ID cannot be empty. Use /models to see available models." });
                            return;
                        }
                        chat_store_1.useChatStore.getState().setConfig({ model: value.trim() });
                        addMessage({ role: "assistant", content: `Model set to ${value.trim()}` });
                        return;
                    }
                    addMessage({ role: "assistant", content: `Unknown key "${key}". Valid keys: temperature, maxTokens, model` });
                    return;
                }
                if (command.name === "search" && arg) {
                    const result = chat_store_1.useChatStore.getState().searchHistory(arg);
                    addMessage({ role: "assistant", content: result });
                    setInput("");
                    return;
                }
                command.execute();
                return;
            }
            const cmd = (0, commands_1.matchCommand)(text);
            if (cmd) {
                setInput("");
                cmd.execute();
                return;
            }
            setInput("");
            addMessage({ role: "user", content: text });
            addMessage({ role: "assistant", content: `Unknown command. Available: /clear, /models, /info, /reset, /help, /sessions, /search` });
            return;
        }
        if (messages.length === 0) {
            setConversationInfo((0, commands_1.deriveTitle)(text), Date.now());
        }
        const currentUserMessage = addMessage({ role: "user", content: text });
        addToInputHistory(text);
        setInput("");
        setInputHistoryIndex(-1);
        setCursorPos(0);
        const snapshotMessages = [
            ...messages,
            { id: currentUserMessage, role: "user", content: text, timestamp: Date.now() },
        ];
        void startNormalChat(snapshotMessages);
    }, [input, isStreaming, messages, addMessage, addToInputHistory, setInputHistoryIndex, setConversationInfo, setIsStreaming, setStreamingContent, setLastError, setStatus, startNormalChat]);
    (0, react_2.useKeyboard)((0, react_1.useCallback)((key) => {
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
            if (isStreaming) {
                cancelStreaming();
            }
            else {
                process.exit(0);
            }
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
            const msgs = chat_store_1.useChatStore.getState().messages;
            for (let i = msgs.length - 1; i >= 0; i--) {
                const msg = msgs[i];
                if (msg.role !== "assistant")
                    continue;
                const match = msg.content.match(/```(\w*)\n([\s\S]*?)```/);
                if (match) {
                    const lang = match[1] || "plain";
                    const code = match[2];
                    const addMsg = chat_store_1.useChatStore.getState().addMessage;
                    (0, execute_1.handleRunCode)(code, lang, addMsg);
                    return;
                }
            }
            return;
        }
        // Ctrl+L — clear the screen (chat history)
        if (key.ctrl && key.name === "l") {
            key.preventDefault?.();
            chat_store_1.useChatStore.getState().clearMessages();
            chat_store_1.useChatStore.getState().setStatus("Screen cleared");
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
            if (cursorPos === 0)
                return;
            const before = input.slice(0, cursorPos - 1);
            const after = input.slice(cursorPos);
            setInput(before + after);
            setCursorPos((p) => p - 1);
            return;
        }
        if (key.name === "delete") {
            key.preventDefault?.();
            if (cursorPos >= input.length)
                return;
            const before = input.slice(0, cursorPos);
            const after = input.slice(cursorPos + 1);
            setInput(before + after);
            return;
        }
        if (key.name === "up" || (key.ctrl && key.name === "p")) {
            key.preventDefault?.();
            if (inputHistory.length === 0)
                return;
            const newIdx = inputHistoryIndex < inputHistory.length - 1 ? inputHistoryIndex + 1 : inputHistoryIndex;
            if (newIdx !== inputHistoryIndex) {
                setInputHistoryIndex(newIdx);
                setInput(inputHistory[newIdx] ?? "");
                setCursorPos((inputHistory[newIdx] ?? "").length);
            }
            return;
        }
        if (key.name === "down" || (key.ctrl && key.name === "n")) {
            key.preventDefault?.();
            if (inputHistoryIndex <= 0) {
                setInputHistoryIndex(-1);
                setInput("");
                setCursorPos(0);
                return;
            }
            const newIdx = inputHistoryIndex - 1;
            setInputHistoryIndex(newIdx);
            setInput(inputHistory[newIdx] ?? "");
            setCursorPos((inputHistory[newIdx] ?? "").length);
            return;
        }
        // Ctrl+E — edit last user message
        if (key.ctrl && key.name === "e") {
            key.preventDefault?.();
            if (isStreaming)
                return;
            const lastUser = findLastUserMessage(messages);
            if (!lastUser)
                return;
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
                const matches = (0, commands_1.getCommands)().filter((c) => c.aliases.some((a) => a.toLowerCase().startsWith(partial)));
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
            if (newOffset === 0) {
                setIsScrolledUp(false);
                isScrolledUpRef.current = false;
            }
            return;
        }
        // Ctrl+G — regenerate last assistant response (any content) or retry failed
        if (key.ctrl && key.name === "g") {
            key.preventDefault?.();
            if (isStreaming)
                return;
            // First: try to regenerate the last assistant response (any content)
            const last = chat_store_1.useChatStore.getState().regenerateLast();
            if (last) {
                setRetryState({ userId: last.userId, userContent: last.userContent });
                return;
            }
            // Fallback: retry a failed message
            for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "assistant" && messages[i].failed) {
                    let userMsg = null;
                    for (let j = i - 1; j >= 0; j--) {
                        if (messages[j].role === "user") {
                            userMsg = messages[j];
                            break;
                        }
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
            if (isStreaming)
                return;
            navigator.clipboard.readText().then((text) => {
                if (!text)
                    return;
                setInputHistoryIndex(-1);
                setInput((prev) => prev.slice(0, cursorPos) + text + prev.slice(cursorPos));
                setCursorPos((p) => p + text.length);
            }).catch(() => { });
            return;
        }
        if (key.ctrl && key.name === "p") {
            key.preventDefault?.();
            if (isStreaming)
                return;
            if (showPalette) {
                setShowPalette(false);
                setPaletteQuery("");
            }
            else {
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
    }, [input, isStreaming, handleSubmit, cancelStreaming, setIsStreaming, setStreamingContent, inputHistory, inputHistoryIndex, setInputHistoryIndex, lastAssistantId, lastAssistantContent, cursorPos, retryMessage, messages, autoSuggestion, setAutoSuggestion]));
    return ((0, jsx_runtime_1.jsxs)("box", { style: { width: "100%", height: "100%", backgroundColor: theme.surface, flexDirection: "column" }, children: [(0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", justifyContent: "space-between", padding: 1, borderStyle: "single", borderColor: theme.border, border: ["bottom"], flexShrink: 0 }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "\u25C8 Orbitron" }), (0, jsx_runtime_1.jsx)("box", { style: { flexDirection: "row", gap: 1, flexGrow: 1, justifyContent: "center" }, children: messages.length > 0 && config.conversationTitle && ((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground, attributes: core_1.TextAttributes.BOLD }, children: config.conversationTitle })) }), (0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", gap: 1 }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: healthColor }, children: healthDot }), healthLabel ? (0, jsx_runtime_1.jsx)("text", { style: { fg: healthColor }, children: healthLabel }) : null, (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "\u00B7" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground }, children: modelLabel }), modelCount > 0 && ((0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["\u00B7 ", modelCount, " models"] })), modelContextLabel ? (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["\u00B7 ", modelContextLabel] }) : null, modelPriceLabel ? (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["\u00B7 ", modelPriceLabel] }) : null] })] }), (0, jsx_runtime_1.jsxs)("box", { style: { flexGrow: 1, flexDirection: "column", padding: 1, overflow: "hidden" }, children: [messages.length === 0 ? ((0, jsx_runtime_1.jsx)("box", { style: { flexDirection: "column", flexGrow: 1, justifyContent: "center", alignItems: "center" }, children: (0, jsx_runtime_1.jsxs)("box", { style: {
                                width: getTerminalColumns() < 90 ? 42 : 58,
                                flexDirection: "column",
                                alignItems: "center",
                                borderStyle: "double",
                                borderColor: theme.primary,
                                backgroundColor: theme.surface,
                                padding: 1,
                            }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "\u2551   \u25C8  O R B I T R O N  \u2551" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: " " }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground, attributes: core_1.TextAttributes.BOLD }, children: "Pinned to the Orbitron server" }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: healthColor }, children: [healthDot, " ", backendHealth === "ok" ? "connected" : backendHealth === "error" ? "server error" : "checking", healthLabel ? ` · ${healthLabel}` : ""] }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: [backendLabel, " \u00B7 ", modelLabel, modelContextLabel ? ` · ${modelContextLabel}` : "", modelPriceLabel ? ` · ${modelPriceLabel}` : ""] }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: " " }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground }, children: "Type a prompt, or jump in with a command:" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary }, children: "/models \u00B7 /sessions \u00B7 /status \u00B7 /search \u00B7 /info" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: " " }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: "\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: "\u2502      Quick Reference       \u2502" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: "\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524" }), (() => {
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
                                    return shortcuts.map((line) => ((0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["\u2502  ", line.padEnd(24), " \u2502"] }, line)));
                                })(), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.border }, children: "\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: " " }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "Ready \u2014 type your first message" })] }) })) : null, messages.map((msg, idx) => {
                        const prev = idx > 0 ? messages[idx - 1] : null;
                        const groupKey = getGroupKey(msg, prev);
                        const isFirstInGroup = prev ? getGroupKey(msg, prev) !== getGroupKey(messages[idx - 1], idx > 1 ? messages[idx - 2] : null) : true;
                        const isUser = msg.role === "user";
                        const isAssistant = msg.role === "assistant";
                        const isFailed = msg.failed;
                        const contentFg = isUser ? theme.foreground : isAssistant ? (isFailed ? theme.error : theme.muted) : theme.muted;
                        // Separator between role groups
                        const showSeparator = prev && prev.role !== msg.role;
                        return ((0, jsx_runtime_1.jsxs)(react_1.default.Fragment, { children: [showSeparator && ((0, jsx_runtime_1.jsx)("box", { style: { borderStyle: "single", borderColor: theme.border, border: ["top"] } })), (0, jsx_runtime_1.jsxs)("box", { style: {}, children: [isFirstInGroup && ((0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", gap: 1 }, children: [(0, jsx_runtime_1.jsx)("text", { style: isUser ? { fg: theme.secondary } : { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: isUser ? " you  " : isFailed ? "!ai   " : " ai   " }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: relativeTime(msg.timestamp) })] })), isAssistant
                                            ? (0, jsx_runtime_1.jsx)(jsx_runtime_1.Fragment, { children: renderMessageContent(msg.content, theme) })
                                            : (0, jsx_runtime_1.jsx)("text", { style: { fg: contentFg, wrapMode: "word" }, children: msg.content }), copiedId === msg.id && (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.success }, children: " \u2713 copied" }), isFailed && (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.warning }, children: " \u00B7 \u21BB Ctrl+G to retry" })] })] }, msg.id));
                    }), isStreaming && ((0, jsx_runtime_1.jsxs)("box", { children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: " ai   " }), streamingContent
                                ? (0, jsx_runtime_1.jsx)(StreamingMessageContent, { content: streamingContent, theme: theme, cursorBlink: cursorBlink })
                                : (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary }, children: SPINNER_FRAMES[thinkingFrame] }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: " thinking" })] })] })), (0, jsx_runtime_1.jsx)("box", { ref: scrollAnchorRef })] }), (contextTokens > 0 || contextWarning) && ((0, jsx_runtime_1.jsxs)("box", { style: {
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
                }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: contextWarning ? theme.warning : theme.muted }, children: contextWarning ? "⚠ context" : "ctx" }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: contextWarning ? theme.warning : theme.muted }, children: [Math.round(contextTokens / 1024), "k / ", Math.round((config.contextWindow ?? 128000) / 1024), "k tok"] }), contextWarning && ((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.warning }, children: "\u00B7 long conv \u00B7 older msgs may be dropped" }))] })), msgCountVisible && newMsgCount > 0 && ((0, jsx_runtime_1.jsx)("box", { style: {
                    padding: 1,
                    flexShrink: 0,
                    borderStyle: "single",
                    borderColor: theme.primary,
                    border: ["top", "bottom"],
                    backgroundColor: theme.primary,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                }, children: (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.surface, attributes: core_1.TextAttributes.BOLD }, children: ["\u25BC ", newMsgCount, " new message", newMsgCount !== 1 ? "s" : "", " \u00B7 press PgDn to jump to latest"] }) })), lastError && ((0, jsx_runtime_1.jsx)("box", { style: { padding: 1, flexShrink: 0 }, children: (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.error }, children: ["\u2717 ", lastError] }) })), (0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", padding: 1, borderStyle: "single", borderColor: theme.border, border: ["top"], flexShrink: 0, alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary }, children: "\u203A" }), (0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", flexGrow: 1, marginLeft: 1, alignItems: "center" }, children: [(0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.foreground }, children: [input.slice(0, cursorPos), cursorBlink && !isStreaming ? "█" : (input[cursorPos] || " "), input.slice(cursorPos + 1)] }), autoSuggestion ? ((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: autoSuggestion.slice(input.length) })) : null] }), isStreaming ? ((0, jsx_runtime_1.jsx)("box", { style: { flexDirection: "row", alignItems: "center" }, children: throughput
                            ? (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.success }, children: [throughput.tokens, " tok \u00B7 ", throughput.elapsed.toFixed(1), "s \u00B7 ", throughput.tpm, " tok/min", streamingStartRef.current ? ` · ETA ${Math.max(1, Math.round(((tokenCountRef.current / Math.max(throughput.tpm, 1)) * 60) - throughput.elapsed))}s` : ""] })
                            : (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.warning }, children: "\u258C Ctrl+C stop" }) })) : isEditing ? ((0, jsx_runtime_1.jsx)("text", { style: { fg: theme.warning }, children: "Editing \u00B7 Enter resends \u00B7 Esc cancels" })) : ((0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: [estimatedTokens, " tok", autoSuggestion ? " · Tab ⇥ accept" : ""] }))] }), (0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", padding: 0, flexShrink: 0, alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: healthColor }, children: healthDot }), healthLabel ? (0, jsx_runtime_1.jsx)("text", { style: { fg: healthColor, marginLeft: 1 }, children: healthLabel }) : null, (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted, flexGrow: 1 } }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: commandHint
                            ? `${commandHint.alias} · ${commandHint.description}`
                            : (() => {
                                const cols = getTerminalColumns();
                                const isMobile = cols < 90;
                                return isMobile
                                    ? "↑↓ hist · /sessions · /status · Ctrl+P palette"
                                    : "↑↓ hist · Tab suggestion · Ctrl+P palette · /sessions · /status · /search · PgUp/PgDn scroll · Ctrl+G regenerate · Ctrl+R run · Ctrl+V paste";
                            })() })] }), showPalette && ((0, jsx_runtime_1.jsx)(CommandPalette, { initialQuery: paletteQuery, onLoadHistory: (value) => {
                    setInput(value);
                    setCursorPos(value.length);
                    setInputHistoryIndex(-1);
                    setAutoSuggestion("");
                }, onClose: () => {
                    setShowPalette(false);
                    setPaletteQuery("");
                } }))] }));
}
function encodeInput(text) {
    return (0, gpt_tokenizer_1.encode)(text).length;
}
function countStreamingTokens(text) {
    return (0, gpt_tokenizer_1.encode)(text).length;
}
