"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRequestTranscript = buildRequestTranscript;
exports.runMessagePipeline = runMessagePipeline;
const gpt_tokenizer_1 = require("gpt-tokenizer");
const chat_1 = require("../api/chat");
function buildRequestTranscript(messages) {
    return messages
        .filter((message) => Boolean(message && typeof message.role === "string" && typeof message.content === "string"))
        .filter((message) => message.role !== "system")
        .map((message) => ({
        role: message.role,
        content: message.content,
    }));
}
function cloneSnapshot(snapshot) {
    return {
        messages: snapshot.messages.map((message) => ({
            role: message.role,
            content: message.content,
        })),
        config: { ...snapshot.config },
    };
}
function emit(onEvent, event) {
    try {
        onEvent?.(event);
    }
    catch {
        // Ignore observer failures so transport execution stays isolated.
    }
}
async function runMessagePipeline(snapshot, options = {}) {
    const snap = cloneSnapshot(snapshot);
    const requestMessages = buildRequestTranscript(snap.messages);
    emit(options.onEvent, { type: "queued", snapshot: snap });
    emit(options.onEvent, { type: "started", requestMessages });
    const startedAt = Date.now();
    let content = "";
    let tokenCount = 0;
    try {
        for await (const chunk of (0, chat_1.streamChat)({
            baseUrl: snap.config.baseUrl,
            apiKey: snap.config.apiKey,
            model: snap.config.model,
            messages: requestMessages,
            temperature: snap.config.temperature,
            maxTokens: snap.config.maxTokens,
            signal: options.signal,
        })) {
            if (options.signal?.aborted)
                break;
            content += chunk;
            tokenCount += (0, gpt_tokenizer_1.encode)(chunk).length;
            emit(options.onEvent, { type: "delta", chunk, content, tokenCount });
        }
        const durationMs = Date.now() - startedAt;
        if (options.signal?.aborted) {
            emit(options.onEvent, { type: "cancelled", content, tokenCount, durationMs });
            return { content, tokenCount, cancelled: true, durationMs, requestMessages };
        }
        emit(options.onEvent, { type: "final", content, tokenCount, durationMs });
        return { content, tokenCount, cancelled: false, durationMs, requestMessages };
    }
    catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        if (err.name === "AbortError" || options.signal?.aborted) {
            const durationMs = Date.now() - startedAt;
            emit(options.onEvent, { type: "cancelled", content, tokenCount, durationMs });
            return { content, tokenCount, cancelled: true, durationMs, requestMessages };
        }
        emit(options.onEvent, { type: "error", error: err });
        throw err;
    }
}
