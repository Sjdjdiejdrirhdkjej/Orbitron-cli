"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeBackendClient = initializeBackendClient;
exports.sendMessageToBackend = sendMessageToBackend;
const chat_1 = require("./api/chat");
const chat_store_1 = require("./store/chat-store");
async function initializeBackendClient() {
    const store = chat_store_1.useChatStore.getState();
    // Set up backend health check
    store.checkHealth();
    // Load models
    try {
        const models = await (0, chat_1.listModels)(store.config.baseUrl);
        store.setAvailableModels(models);
        // Set default model if not already set
        if (!store.config.model && models.length > 0) {
            store.setConfig({ model: models[0].id });
        }
    }
    catch (error) {
        store.setLastError(`Failed to load models: ${error instanceof Error ? error.message : String(error)}`);
    }
}
async function sendMessageToBackend(content) {
    const store = chat_store_1.useChatStore.getState();
    const { baseUrl, apiKey, model, temperature, maxTokens } = store.config;
    if (!model) {
        throw new Error("No model selected");
    }
    const messages = store.messages.map(msg => ({
        role: msg.role,
        content: msg.content
    }));
    const abortController = new AbortController();
    try {
        const stream = (0, chat_1.streamChat)({
            baseUrl,
            apiKey,
            model,
            messages,
            temperature,
            maxTokens,
            signal: abortController.signal
        });
        for await (const chunk of stream) {
            store.appendStreamingContent(chunk);
        }
        // Add the assistant message to the store
        const assistantMessage = {
            role: "assistant",
            content: store.streamingContent
        };
        store.addMessage(assistantMessage);
        store.setStreamingContent("");
    }
    catch (error) {
        store.setLastError(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
        store.addMessage({
            role: "assistant",
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            failed: true
        });
        throw error;
    }
}
