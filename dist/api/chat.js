"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveApiUrl = resolveApiUrl;
exports.listModels = listModels;
exports.streamChat = streamChat;
const BASE = "https://orbitron--pastelsjuice8t.replit.app";
function resolveApiUrl(baseUrl, pathname) {
    const base = baseUrl.replace(/\/$/, "");
    return new URL(pathname, `${base}/`).toString();
}
function normaliseMessages(messages) {
    return (messages ?? [])
        .filter((message) => Boolean(message && typeof message.role === "string" && typeof message.content === "string"))
        .map((message) => ({
        role: message.role.trim() || "user",
        content: String(message.content ?? ""),
    }))
        .filter((message) => message.content.length > 0 || message.role === "user");
}
async function listModels(baseUrl) {
    const res = await fetch(resolveApiUrl(baseUrl, "/api/models"), {
        headers: { accept: "application/json" },
    });
    if (!res.ok)
        throw new Error(`Model fetch failed (${res.status})`);
    const text = await res.text();
    try {
        const data = JSON.parse(text);
        if (Array.isArray(data?.data))
            return data.data;
        if (Array.isArray(data?.models))
            return data.models;
        if (Array.isArray(data?.items))
            return data.items;
        return [];
    }
    catch {
        return [];
    }
}
async function* streamChat({ baseUrl, apiKey, model, messages, temperature = 0.2, maxTokens = 2048, signal, }) {
    if (!model)
        throw new Error("model is required");
    if (!messages || messages.length === 0)
        throw new Error("messages are required");
    const filtered = normaliseMessages(messages);
    if (filtered.length === 0) {
        throw new Error("messages are required");
    }
    const res = await fetch(resolveApiUrl(baseUrl, "/api/chat"), {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json",
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
            modelID: model,
            messages: filtered,
            temperature,
            max_tokens: maxTokens,
            stream: true,
        }),
        signal,
    });
    if (!res.ok) {
        const text = await res.text();
        let msg = text;
        try {
            const json = JSON.parse(text);
            msg = json?.error?.message ?? json?.message ?? text;
        }
        catch {
            // use raw text
        }
        throw new Error(`Chat failed (${res.status}): ${String(msg).slice(0, 300)}`);
    }
    if (!res.body)
        throw new Error("Response body is not available");
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            if (signal?.aborted)
                break;
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
                buffer = buffer.slice(newlineIndex + 1);
                if (!line.startsWith("data: "))
                    continue;
                const data = line.slice(6).trim();
                if (data === "[DONE]")
                    return;
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.choices?.[0]?.delta?.content ??
                        parsed.choices?.[0]?.text ??
                        parsed.text ??
                        parsed.output ??
                        "";
                    if (text)
                        yield text;
                }
                catch {
                    // skip
                }
            }
        }
    }
    finally {
        if (!signal?.aborted) {
            reader.cancel().catch(() => { });
        }
    }
}
