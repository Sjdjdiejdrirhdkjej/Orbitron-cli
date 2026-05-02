"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelPicker = ModelPicker;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const react_2 = require("@opentui/react");
const core_1 = require("@opentui/core");
const chat_store_1 = require("../store/chat-store");
const index_1 = require("../theme/index");
const chat_1 = require("../api/chat");
const model_names_1 = require("../lib/model-names");
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
function fuzzyMatch(query, text) {
    if (!query)
        return true;
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    if (t.includes(q))
        return true;
    let qi = 0;
    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi])
            qi++;
    }
    return qi === q.length;
}
function getContextLabel(model) {
    if (!model.context_window)
        return null;
    return model.context_window >= 1000
        ? `${(model.context_window / 1000).toFixed(0)}k ctx`
        : `${model.context_window} ctx`;
}
function getPriceLabel(model) {
    const inputPrice = model.pricing?.input_per_million;
    const outputPrice = model.pricing?.output_per_million;
    if (!inputPrice && !outputPrice)
        return null;
    return `$${inputPrice ?? "?"}/M in · $${outputPrice ?? "?"}/M out`;
}
function matchesModel(query, model) {
    if (!query)
        return true;
    const haystack = [model.id, model.name, model.provider, (0, model_names_1.getDisplayName)(model.id)].filter(Boolean).join(" ");
    return fuzzyMatch(query, haystack);
}
function ModelPicker(_props) {
    const theme = (0, index_1.getTheme)("dark");
    const showModelPicker = (0, chat_store_1.useChatStore)((s) => s.showModelPicker);
    const setShowModelPicker = (0, chat_store_1.useChatStore)((s) => s.setShowModelPicker);
    const availableModels = (0, chat_store_1.useChatStore)((s) => s.availableModels);
    const setAvailableModels = (0, chat_store_1.useChatStore)((s) => s.setAvailableModels);
    const config = (0, chat_store_1.useChatStore)((s) => s.config);
    const setConfig = (0, chat_store_1.useChatStore)((s) => s.setConfig);
    const [selectedIdx, setSelectedIdx] = (0, react_1.useState)(0);
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)("");
    const [search, setSearch] = (0, react_1.useState)("");
    const filteredModels = (0, react_1.useMemo)(() => {
        const query = search.trim();
        const models = query
            ? availableModels.filter((m) => matchesModel(query, m))
            : availableModels;
        return [...models].sort((a, b) => {
            const aCurrent = a.id === config.model;
            const bCurrent = b.id === config.model;
            if (aCurrent !== bCurrent)
                return aCurrent ? -1 : 1;
            return (0, model_names_1.getDisplayName)(a.id).localeCompare((0, model_names_1.getDisplayName)(b.id));
        });
    }, [availableModels, config.model, search]);
    const selectedModel = filteredModels[selectedIdx] ?? filteredModels[0] ?? null;
    (0, react_1.useEffect)(() => {
        if (!showModelPicker)
            return;
        setSearch("");
        setError("");
        const currentIdx = availableModels.findIndex((m) => m.id === config.model);
        setSelectedIdx(currentIdx >= 0 ? currentIdx : 0);
        if (availableModels.length > 0) {
            setLoading(false);
            return;
        }
        setLoading(true);
        (0, chat_1.listModels)(config.baseUrl)
            .then((models) => {
            setAvailableModels(models);
        })
            .catch((err) => setError(err.message))
            .finally(() => setLoading(false));
    }, [showModelPicker, availableModels, config.baseUrl, config.model, setAvailableModels]);
    (0, react_1.useEffect)(() => {
        if (!showModelPicker)
            return;
        setSelectedIdx((prev) => {
            if (filteredModels.length === 0)
                return 0;
            return Math.min(prev, filteredModels.length - 1);
        });
    }, [showModelPicker, filteredModels.length]);
    const handleSelect = (0, react_1.useCallback)((modelId) => {
        setConfig({ model: modelId });
        setShowModelPicker(false);
        setSearch("");
    }, [setConfig, setShowModelPicker]);
    const handleClose = (0, react_1.useCallback)(() => {
        setShowModelPicker(false);
        setSearch("");
    }, [setShowModelPicker]);
    (0, react_2.useKeyboard)((0, react_1.useCallback)((key) => {
        if (!showModelPicker)
            return;
        const seq = key.sequence || key.name;
        const isPrintable = seq && seq.length === 1 && !key.ctrl && !key.meta;
        if (key.name === "escape" || (key.ctrl && key.name === "c")) {
            key.preventDefault?.();
            if (search) {
                setSearch("");
            }
            else {
                handleClose();
            }
            return;
        }
        if (key.name === "home") {
            key.preventDefault?.();
            setSelectedIdx(0);
            return;
        }
        if (key.name === "end") {
            key.preventDefault?.();
            setSelectedIdx(Math.max(0, filteredModels.length - 1));
            return;
        }
        if (key.name === "up" || key.name === "k") {
            key.preventDefault?.();
            setSelectedIdx((prev) => Math.max(0, prev - 1));
            return;
        }
        if (key.name === "down" || key.name === "j") {
            key.preventDefault?.();
            setSelectedIdx((prev) => Math.min(filteredModels.length - 1, prev + 1));
            return;
        }
        if (key.name === "pageup" || key.name === "PageUp") {
            key.preventDefault?.();
            setSelectedIdx((prev) => Math.max(0, prev - 6));
            return;
        }
        if (key.name === "pagedown" || key.name === "PageDown") {
            key.preventDefault?.();
            setSelectedIdx((prev) => Math.min(filteredModels.length - 1, prev + 6));
            return;
        }
        if (key.name === "return" || key.name === "enter") {
            key.preventDefault?.();
            if (filteredModels[selectedIdx]) {
                handleSelect(filteredModels[selectedIdx].id);
            }
            return;
        }
        if (key.name === "backspace") {
            key.preventDefault?.();
            if (search.length > 0) {
                setSearch((s) => s.slice(0, -1));
                setSelectedIdx(0);
            }
            else {
                handleClose();
            }
            return;
        }
        if (isPrintable && /[a-zA-Z0-9 _\-.]/.test(seq)) {
            key.preventDefault?.();
            setSearch((s) => s + seq);
            setSelectedIdx(0);
            return;
        }
    }, [showModelPicker, filteredModels, selectedIdx, handleSelect, handleClose, search]));
    if (!showModelPicker)
        return null;
    const cols = getTerminalColumns();
    const isMobile = cols < 90;
    const modalWidth = isMobile
        ? Math.min(44, Math.max(34, availableModels.length > 0 ? 38 : 34))
        : Math.min(58, Math.max(36, availableModels.length > 0 ? 44 : 36));
    return ((0, jsx_runtime_1.jsx)("box", { style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.6)",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
        }, children: (0, jsx_runtime_1.jsxs)("box", { style: {
                width: modalWidth,
                flexDirection: "column",
                borderStyle: "double",
                borderColor: theme.primary,
                backgroundColor: theme.surface,
            }, children: [(0, jsx_runtime_1.jsxs)("box", { style: {
                        flexDirection: "row",
                        padding: 1,
                        borderStyle: "single",
                        borderColor: theme.border,
                        border: ["bottom"],
                    }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.primary, attributes: core_1.TextAttributes.BOLD }, children: "\u25C8 Models" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted, marginLeft: 2 }, children: loading ? "loading…" : `${availableModels.length} total` }), search && ((0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.info, marginLeft: 2 }, children: ["\u00B7 ", filteredModels.length, " match", filteredModels.length === 1 ? "" : "es"] }))] }), (0, jsx_runtime_1.jsxs)("box", { style: {
                        padding: 1,
                        borderStyle: "single",
                        borderColor: search ? theme.primary : theme.border,
                        border: ["bottom"],
                        flexDirection: "row",
                        alignItems: "center",
                    }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "filter:" }), (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground, marginLeft: 1 }, children: search || "type to filter by name, id, or provider" })] }), error && ((0, jsx_runtime_1.jsx)("box", { style: { padding: 1 }, children: (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.error }, children: ["\u2717 ", error] }) })), (0, jsx_runtime_1.jsx)("box", { style: {
                        flexDirection: "column",
                        maxHeight: 14,
                        padding: 0,
                    }, children: loading ? ((0, jsx_runtime_1.jsx)("box", { style: { padding: 1 }, children: (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: "Fetching models\u2026" }) })) : filteredModels.length === 0 ? ((0, jsx_runtime_1.jsx)("box", { style: { padding: 1 }, children: (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["No models match \"", search, "\""] }) })) : (filteredModels.map((model, idx) => {
                        const isSelected = idx === selectedIdx;
                        const isCurrent = model.id === config.model;
                        const contextLabel = getContextLabel(model);
                        const priceLabel = getPriceLabel(model);
                        return ((0, jsx_runtime_1.jsxs)("box", { style: {
                                padding: 1,
                                borderStyle: "single",
                                borderColor: isSelected ? theme.primary : "transparent",
                                border: isSelected ? ["left"] : [],
                            }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: isSelected ? theme.primary : theme.foreground }, children: isSelected ? "▸" : " " }), (0, jsx_runtime_1.jsx)("text", { style: {
                                        fg: isCurrent ? theme.success : isSelected ? theme.primary : theme.foreground,
                                        marginLeft: 1,
                                    }, children: (0, model_names_1.getDisplayName)(model.id) }), contextLabel && (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted, marginLeft: 2 }, children: ["\u00B7 ", contextLabel] }), priceLabel && (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted, marginLeft: 2 }, children: ["\u00B7 ", priceLabel] }), isCurrent && (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.success, marginLeft: 2 }, children: "\u2713 current" })] }, model.id));
                    })) }), selectedModel && !loading && ((0, jsx_runtime_1.jsxs)("box", { style: {
                        padding: 1,
                        borderStyle: "single",
                        borderColor: theme.border,
                        border: ["top"],
                        flexDirection: "column",
                    }, children: [(0, jsx_runtime_1.jsxs)("box", { style: { flexDirection: "row", alignItems: "center" }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.foreground, attributes: core_1.TextAttributes.BOLD }, children: (0, model_names_1.getDisplayName)(selectedModel.id) }), selectedModel.id === config.model && (0, jsx_runtime_1.jsx)("text", { style: { fg: theme.success, marginLeft: 1 }, children: "current" })] }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["ID: ", selectedModel.id] }), selectedModel.provider && (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["Provider: ", selectedModel.provider] }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["Context: ", getContextLabel(selectedModel) ?? "unknown"] }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["Pricing: ", getPriceLabel(selectedModel) ?? "not listed"] })] })), (0, jsx_runtime_1.jsxs)("box", { style: {
                        padding: 1,
                        borderStyle: "single",
                        borderColor: theme.border,
                        border: ["top"],
                        flexDirection: "row",
                        justifyContent: "space-between",
                    }, children: [(0, jsx_runtime_1.jsx)("text", { style: { fg: theme.muted }, children: isMobile ? "↑↓ nav · ↵ select · Esc close" : "↑↓ nav · Home/End jump · type to filter · ↵ select · Esc close" }), (0, jsx_runtime_1.jsxs)("text", { style: { fg: theme.muted }, children: ["current: ", (0, model_names_1.getDisplayName)(config.model)] })] })] }) }));
}
