"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDisplayName = getDisplayName;
// Pretty-print model IDs into readable names
const ALIASES = {
    "gpt-4.1": "GPT-4.1",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4": "GPT-4",
    "gpt-3.5-turbo": "GPT-3.5 Turbo",
    "o1": "o1",
    "o1-mini": "o1 Mini",
    "o1-pro": "o1 Pro",
    "o3": "o3",
    "o3-mini": "o3 Mini",
    "o4-mini": "o4 Mini",
    "claude-sonnet-4-20250514": "Claude Sonnet 4",
    "claude-3-5-sonnet-latest": "Claude 3.5 Sonnet",
    "claude-3-opus-latest": "Claude 3 Opus",
    "claude-3-haiku-latest": "Claude 3 Haiku",
    "claude-3.5-haiku-latest": "Claude 3.5 Haiku",
    "gemini-2.5-pro-preview-06-05": "Gemini 2.5 Pro",
    "gemini-2.0-flash": "Gemini 2.0 Flash",
    "gemini-1.5-flash": "Gemini 1.5 Flash",
    "gemini-1.5-pro": "Gemini 1.5 Pro",
    "gemini-1.5-flash-8b": "Gemini 1.5 Flash 8B",
    "llama-4-scout-17b-16e-instruct": "Llama 4 Scout",
    "llama-4-maverick-17b-16e-instruct": "Llama 4 Maverick",
    "llama-4-lean-17b-16e-instruct": "Llama 4 Lean",
    "llama-3.3-70b-instruct": "Llama 3.3 70B",
    "llama-3.2-11b-vision-instruct": "Llama 3.2 11B Vision",
    "llama-3.2-1b-instruct": "Llama 3.2 1B",
    "llama-3.2-90b-vision-instruct": "Llama 3.2 90B Vision",
    "llama-3.1-8b-instruct": "Llama 3.1 8B",
    "llama-3.1-70b-instruct": "Llama 3.1 70B",
    "llama-3.1-405b-instruct": "Llama 3.1 405B",
    "mistral-nemo-12b-instruct": "Mistral Nemo 12B",
    "mistral-7b-instruct": "Mistral 7B",
    "mixtral-8x7b-instruct": "Mixtral 8x7B",
    "codellama-7b-instruct": "Code Llama 7B",
    "codellama-13b-instruct": "Code Llama 13B",
    "codellama-34b-instruct": "Code Llama 34B",
    "deepseek-chat": "DeepSeek Chat",
    "deepseek-coder": "DeepSeek Coder",
    "qwen-72b-chat": "Qwen 72B",
    "qwen-14b-chat": "Qwen 14B",
    "qwen-7b-chat": "Qwen 7B",
    "qwen-1.5-72b-chat": "Qwen 1.5 72B",
    "yi-34b-chat": "Yi 34B",
    "yi-6b-chat": "Yi 6B",
    "gemma-2-27b-it": "Gemma 2 27B",
    "gemma-2-9b-it": "Gemma 2 9B",
    "gemma-2-2b-it": "Gemma 2 2B",
    "gemma-3-27b-it": "Gemma 3 27B",
    "gemma-3-12b-it": "Gemma 3 12B",
    "gemma-3-4b-it": "Gemma 3 4B",
    "gemma-3-1b-it": "Gemma 3 1B",
    "gemma-4-27b-it": "Gemma 4 27B",
    "gemma-4-12b-it": "Gemma 4 12B",
    "gemma-4-7b-it": "Gemma 4 7B",
    "gemma-4-2b-it": "Gemma 4 2B",
    "gemma-4-1b-it": "Gemma 4 1B",
    "gemma-sent-7b-it": "Gemma Sent 7B",
    "gemma-sent-1b-it": "Gemma Sent 1B",
};
// Extract a short base name from a model ID string
function baseName(id) {
    // Strip version suffixes like -20250514, -latest, etc.
    return id.replace(/-(latest|\d{8}|\d{4}-\d{2}-\d{2}(-\d{2}-\d{2})?|-beta|-preview|-instruct|-chat|-dev|-fp8|-int4|-int8)$/gi, "");
}
function getDisplayName(modelId) {
    if (!modelId)
        return modelId;
    const lower = modelId.toLowerCase();
    if (ALIASES[lower])
        return ALIASES[lower];
    if (ALIASES[modelId])
        return ALIASES[modelId];
    // Try matching the base name
    const base = baseName(modelId);
    for (const [key, val] of Object.entries(ALIASES)) {
        if (baseName(key) === base)
            return val;
    }
    // Fallback: title-case hyphens
    return modelId
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/Gpt/i, "GPT")
        .replace(/Llama/i, "Llama")
        .replace(/Gemma/i, "Gemma")
        .replace(/Claude/i, "Claude")
        .replace(/Gemini/i, "Gemini")
        .replace(/Mistral/i, "Mistral")
        .replace(/Qwen/i, "Qwen")
        .replace(/Yi/i, "Yi")
        .replace(/Deepseek/i, "DeepSeek")
        .replace(/Codellama/i, "Code Llama");
}
