"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStatusReport = buildStatusReport;
exports.getCommands = getCommands;
exports.matchCommand = matchCommand;
exports.matchCommandWithArgs = matchCommandWithArgs;
exports.deriveTitle = deriveTitle;
exports.isCommandInput = isCommandInput;
const chat_store_1 = require("./store/chat-store");
const model_names_1 = require("./lib/model-names");
const execute_1 = require("./lib/execute");
function buildStatusReport() {
    const store = chat_store_1.useChatStore.getState();
    const server = (store.config.baseUrl || "https://orbitron--pastelsjuice8t.replit.app").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const health = store.backendHealth === "ok"
        ? `connected${store.backendLatencyMs != null ? ` · ${store.backendLatencyMs}ms` : ""}`
        : store.backendHealth === "error"
            ? "error"
            : "checking";
    const model = (0, model_names_1.getDisplayName)(store.config.model);
    const sessionTitle = store.config.conversationTitle || "New Chat";
    const sessionState = store.currentSessionId ? "restored" : "new";
    const messageCount = store.messages.length;
    const contextWindow = store.config.contextWindow ?? 128000;
    const contextLabel = `${Math.round(store.contextTokens / 1024)}k / ${Math.round(contextWindow / 1024)}k tok`;
    const stateLabel = store.isStreaming ? "streaming" : store.status || "Ready";
    const lines = [
        "Orbitron snapshot",
        `  Pinned server: ${server} · ${health}`,
        `  Model:         ${model}`,
        `  Session:       ${sessionTitle} · ${messageCount} msgs · ${sessionState}`,
        `  Context:       ${contextLabel}`,
        `  State:         ${stateLabel}`,
        `  Saved sessions: ${store.listSessions().length}`,
    ];
    if (store.lastError) {
        lines.push(`  Last error: ${store.lastError}`);
    }
    return lines.join("\n");
}
function buildHelpReport() {
    const commands = getCommands()
        .filter((command) => command.name !== "help")
        .map((command) => {
        const aliases = command.aliases.join(" · ");
        return `  ${aliases.padEnd(24)} ${command.description}`;
    });
    return [
        "Available commands",
        ...commands,
        "",
        "Keyboard shortcuts",
        "  Enter                  send message",
        "  Shift+Enter            newline",
        "  ↑ / ↓                  input history",
        "  Tab                    accept suggestion / complete command",
        "  Ctrl+P                 command palette",
        "  Ctrl+R                 run last code block",
        "  Ctrl+G                 regenerate last reply",
        "  Ctrl+V                 paste",
        "  Ctrl+L                 clear chat",
        "  Esc / Ctrl+C           stop streaming",
    ].join("\n");
}
function getCommands() {
    const store = chat_store_1.useChatStore.getState();
    return [
        {
            name: "clear",
            description: "Clear chat history",
            aliases: ["/clear", "/c"],
            execute: () => store.clearMessages(),
        },
        {
            name: "models",
            description: "Switch model",
            aliases: ["/models", "/m"],
            execute: () => store.setShowModelPicker(true),
        },
        {
            name: "status",
            description: "Show server, session, and model snapshot",
            aliases: ["/status"],
            execute: () => {
                store.addMessage({ role: "assistant", content: buildStatusReport() });
            },
        },
        {
            name: "reset",
            description: "Reset chat UI state",
            aliases: ["/reset", "/r"],
            execute: () => {
                store.clearMessages();
                store.setLastError("");
                store.setStatus("Ready");
                store.setShowModelPicker(false);
                store.setInputHistoryIndex(-1);
            },
        },
        {
            name: "help",
            description: "Show available commands",
            aliases: ["/help", "/h"],
            execute: () => {
                store.addMessage({ role: "assistant", content: buildHelpReport() });
            },
        },
        {
            name: "info",
            description: "Show current model info (context, pricing, server)",
            aliases: ["/info", "/model"],
            execute: () => {
                const { config, availableModels } = store;
                const model = availableModels.find((m) => m.id === config.model);
                const server = config.baseUrl || "https://orbitron--pastelsjuice8t.replit.app";
                if (!model) {
                    store.addMessage({ role: "assistant", content: `Current model: ${config.model}\nServer: ${server}` });
                    return;
                }
                const ctx = model.context_window
                    ? model.context_window >= 1000
                        ? `${(model.context_window / 1000).toFixed(0)}k`
                        : `${model.context_window}`
                    : "unknown";
                const inP = model.pricing?.input_per_million;
                const outP = model.pricing?.output_per_million;
                const price = inP || outP
                    ? `$${inP ?? "?"}/M in · $${outP ?? "?"}/M out`
                    : "no pricing data";
                const msg = [
                    `  Model:     ${(0, model_names_1.getDisplayName)(model.id)}`,
                    `  Context:   ${ctx} tokens`,
                    `  Pricing:   ${price}`,
                    model.provider ? `  Provider:  ${model.provider}` : null,
                    `  Server:    ${server}`,
                ].filter(Boolean).join("\n");
                store.addMessage({ role: "assistant", content: msg });
            },
        },
        {
            name: "title",
            description: "Rename conversation (auto-generated on first message)",
            aliases: ["/title"],
            execute: () => {
                const { messages } = store;
                if (messages.length === 0) {
                    store.addMessage({ role: "assistant", content: "No conversation to title yet." });
                    return;
                }
                store.addMessage({
                    role: "assistant",
                    content: `Conversation title: "${store.config.conversationTitle || "New Chat"}"`,
                });
            },
        },
        {
            name: "sessions",
            description: "List saved conversation sessions",
            aliases: ["/sessions", "/ls"],
            execute: () => {
                const sessions = store.listSessions();
                if (sessions.length === 0) {
                    store.addMessage({ role: "assistant", content: "No saved sessions." });
                    return;
                }
                const lines = sessions.map((s, i) => {
                    const date = new Date(s.createdAt).toLocaleDateString();
                    return `  ${i + 1}. ${s.title} · ${s.messageCount} msgs · ${s.model} · ${date}`;
                });
                store.addMessage({
                    role: "assistant",
                    content: `Saved sessions:\n${lines.join("\n")}\n\n  /load <n>  — restore a session\n  /delete <n>  — remove a session`,
                });
            },
        },
        {
            name: "load",
            description: "Restore a saved session by number (/load <n>)",
            aliases: ["/load"],
            execute: () => {
                chat_store_1.useChatStore.getState().addMessage({
                    role: "assistant",
                    content: "Use /load <n> to restore a saved session from /sessions.",
                });
            },
        },
        {
            name: "delete",
            description: "Delete a saved session by number (/delete <n>)",
            aliases: ["/delete", "/rm"],
            execute: () => {
                chat_store_1.useChatStore.getState().addMessage({
                    role: "assistant",
                    content: "Use /delete <n> to remove a session listed by /sessions.",
                });
            },
        },
        {
            name: "set",
            description: "Set runtime config — /set temperature 0.5 · /set maxTokens 4096 · /set model <id>",
            aliases: ["/set"],
            execute: () => {
                chat_store_1.useChatStore.getState().addMessage({
                    role: "assistant",
                    content: "Usage: /set <key> <value>\n  temperature <0–2>  — response randomness (default: 0.2)\n  maxTokens <n>      — max response length in tokens (default: 2048)\n  model <id>         — switch to a different model\n\nCurrent values:\n  temperature  " + store.config.temperature + "\n  maxTokens    " + store.config.maxTokens + "\n  model        " + store.config.model,
                });
            },
        },
        {
            name: "export",
            description: "Export conversation as a markdown file",
            aliases: ["/export", "/save"],
            execute: () => {
                const { messages, config } = chat_store_1.useChatStore.getState();
                if (messages.length === 0) {
                    chat_store_1.useChatStore.getState().addMessage({ role: "assistant", content: "No conversation to export." });
                    return;
                }
                const lines = [];
                const title = config.conversationTitle || "Orbitron Chat";
                lines.push(`# ${title}`);
                lines.push(`\nModel: ${config.model} · Exported: ${new Date().toLocaleString()}\n`);
                for (const msg of messages) {
                    const role = msg.role === "user" ? "**You**" : msg.role === "assistant" ? "**Orbitron**" : "**System**";
                    const ts = new Date(msg.timestamp).toLocaleString();
                    lines.push(`\n### ${role} · ${ts}\n`);
                    lines.push(msg.content || " ");
                }
                const content = lines.join("\n");
                try {
                    const base64 = Buffer.from(content).toString("base64");
                    process.stdout.write(`\x1b]52;c;${base64}\x1b\\`);
                    chat_store_1.useChatStore.getState().addMessage({ role: "assistant", content: `Exported "${title}" to clipboard (markdown format). Paste with Ctrl+V.` });
                }
                catch {
                    chat_store_1.useChatStore.getState().addMessage({ role: "assistant", content: "Export failed — could not write to clipboard." });
                }
            },
        },
        {
            name: "run",
            description: "Run the last code block from assistant messages (Ctrl+R)",
            aliases: ["/run", "/exec"],
            execute: () => {
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
                chat_store_1.useChatStore.getState().addMessage({ role: "assistant", content: "No code block found in recent messages." });
            },
        },
        {
            name: "search",
            description: "Search conversation history — /search <query>",
            aliases: ["/search", "/s"],
            execute: () => {
                chat_store_1.useChatStore.getState().addMessage({
                    role: "assistant",
                    content: "Usage: /search <query>\nSearches all messages for the given text (case-insensitive).\nResults show the role, timestamp, and a snippet with the match highlighted.",
                });
            },
        },
    ];
}
function matchCommand(input) {
    const trimmed = input.trim().toLowerCase();
    const commands = getCommands();
    for (const cmd of commands) {
        if (cmd.aliases.some((a) => a.toLowerCase() === trimmed)) {
            return cmd;
        }
    }
    return null;
}
function aliasMatchesInput(alias, trimmedInput) {
    const lowerAlias = alias.toLowerCase();
    if (trimmedInput.toLowerCase() === lowerAlias)
        return true;
    if (!trimmedInput.toLowerCase().startsWith(lowerAlias))
        return false;
    const nextChar = trimmedInput.slice(lowerAlias.length, lowerAlias.length + 1);
    return /\s/.test(nextChar);
}
function matchCommandWithArgs(input) {
    const trimmed = input.trim();
    const commands = getCommands();
    for (const cmd of commands) {
        for (const alias of cmd.aliases) {
            if (aliasMatchesInput(alias, trimmed)) {
                const aliasLower = alias.toLowerCase();
                const rest = trimmed.slice(aliasLower.length).trim();
                return { command: cmd, arg: rest };
            }
        }
    }
    return null;
}
// Derive a short conversation title from the first user message
function deriveTitle(firstUserMessage) {
    const text = firstUserMessage.trim();
    // Strip markdown formatting, code blocks, URLs
    const cleaned = text
        .replace(/```[\s\S]*?```/g, "[code]")
        .replace(/`[^`]+`/g, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[\#*_~\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (cleaned.length === 0)
        return "New Chat";
    if (cleaned.length <= 40)
        return cleaned;
    return cleaned.slice(0, 37) + "…";
}
function isCommandInput(input) {
    return input.trim().startsWith("/");
}
