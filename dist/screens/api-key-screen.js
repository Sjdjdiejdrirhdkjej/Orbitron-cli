"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyScreen = ApiKeyScreen;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const core_1 = require("@opentui/core");
const chat_store_1 = require("../store/chat-store");
const index_1 = require("../theme/index");
function ApiKeyScreen(_props) {
    const theme = (0, index_1.getTheme)("dark");
    const envApiKey = process.env.ORBITRON_API_KEY?.trim() || "";
    const baseUrl = (0, chat_store_1.useChatStore)((s) => s.config.baseUrl);
    const backendHealth = (0, chat_store_1.useChatStore)((s) => s.backendHealth);
    const backendLatencyMs = (0, chat_store_1.useChatStore)((s) => s.backendLatencyMs);
    const checkHealth = (0, chat_store_1.useChatStore)((s) => s.checkHealth);
    const [input, setInput] = (0, react_1.useState)("");
    const [error, setError] = (0, react_1.useState)("");
    const setConfig = (0, chat_store_1.useChatStore)((s) => s.setConfig);
    const setScreen = (0, chat_store_1.useChatStore)((s) => s.setScreen);
    (0, react_1.useEffect)(() => {
        if (!envApiKey) {
            checkHealth();
        }
    }, [checkHealth, envApiKey]);
    (0, react_1.useEffect)(() => {
        if (!envApiKey)
            return;
        setConfig({ apiKey: envApiKey });
        setScreen("chat");
    }, [envApiKey, setConfig, setScreen]);
    const handleSubmit = (0, react_1.useCallback)((valueOrEvent) => {
        const rawValue = typeof valueOrEvent === "string"
            ? valueOrEvent
            : typeof valueOrEvent === "object" && valueOrEvent !== null && "value" in valueOrEvent && typeof valueOrEvent.value === "string"
                ? valueOrEvent.value
                : input;
        const key = String(rawValue ?? "").trim();
        setError("");
        setConfig({ apiKey: key });
        setScreen("chat");
    }, [input, setConfig, setScreen]);
    if (envApiKey)
        return null;
    const cleanBaseUrl = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const healthDot = backendHealth === "ok" ? "●" : backendHealth === "error" ? "●" : "○";
    const healthColour = backendHealth === "ok" ? theme.success : backendHealth === "error" ? theme.error : theme.muted;
    const healthLabel = backendHealth === "ok" ? (backendLatencyMs != null ? `${backendLatencyMs}ms` : "connected") : backendHealth === "error" ? "backend unavailable" : "checking…";
    return ((0, jsx_runtime_1.jsx)("box", { style: {
            width: "100%",
            height: "100%",
            backgroundColor: theme.surface,
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 1,
        }, children: (0, jsx_runtime_1.jsxs)("box", { style: {
                width: 64,
                flexDirection: "column",
                borderStyle: "double",
                borderColor: theme.primary,
                backgroundColor: theme.background,
            }, children: [(0, jsx_runtime_1.jsxs)("box", { style: {
                        flexDirection: "column",
                        alignItems: "center",
                        paddingTop: 1,
                        paddingBottom: 1,
                        borderStyle: "single",
                        borderColor: theme.border,
                        border: ["bottom"],
                    }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "\u2554\u2550 Orbitron \u2550\u2557" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "Orbitron starts straight in chat" }), (0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: healthColour }, children: healthDot }), (0, jsx_runtime_1.jsx)("text", { style: { fg: healthColour, marginLeft: 1 }, children: healthLabel })] }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["Pinned backend: ", cleanBaseUrl] })] }), (0, jsx_runtime_1.jsxs)("box", { style: {
                        flexDirection: "column",
                        padding: 2,
                    }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground, attributes: core_1.TextAttributes.BOLD }, children: "Optional access token" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted, marginTop: 1 }, children: "Leave this blank to continue against the pinned Orbitron backend. If you need an override token, enter it here." }), (0, jsx_runtime_1.jsxs)("box", { style: {
                                marginTop: 2,
                                padding: 1,
                                flexDirection: "column",
                                borderStyle: "single",
                                borderColor: error ? theme.error : theme.border,
                            }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "Access token" }), (0, jsx_runtime_1.jsx)("input", { focused: true, value: input, placeholder: "Press Enter to continue", onChange: (value) => setInput(value), onSubmit: handleSubmit })] }), error && ((0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.error, marginTop: 1 }, children: ["\u2717 ", error] })), (0, jsx_runtime_1.jsxs)("box", { style: {
                                marginTop: 2,
                                padding: 1,
                                flexDirection: "column",
                                borderStyle: "single",
                                borderColor: theme.border,
                            }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "What happens next" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground, marginTop: 1 }, children: "1. Press Enter to continue, with or without a token." }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.foreground }, children: ["2. The chat screen opens against ", cleanBaseUrl, "."] }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground }, children: "3. Use /models, /status, or /set inside chat to adjust the session." })] }), (0, jsx_runtime_1.jsxs)("box", { style: {
                                marginTop: 2,
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                            }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "Enter continues \u00B7 blank is fine" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "Pinned backend first" })] })] })] }) }));
}
