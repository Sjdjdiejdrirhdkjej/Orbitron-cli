"use strict";
/**
 * Token counter that mirrors Codebuff's approach:
 * - gpt-tokenizer for GPT token counts
 * - 1.35× Anthropic fudge factor for Claude messages
 * - LRU cache to avoid recounting the same strings
 * - Caches counted as "message content" → "token count"
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTargetTokens = getTargetTokens;
exports.setLimit = setLimit;
exports.countMessageTokens = countMessageTokens;
exports.countMessageArrayTokens = countMessageArrayTokens;
const gpt_tokenizer_1 = require("gpt-tokenizer");
const CACHE_MAX_SIZE = 256;
// Adjustable token limit — override via setLimit()
let tokenLimit = 190_000;
/** Target after trimming: ceiling × 0.50 */
function getTargetTokens() {
    return Math.floor((tokenLimit * 50) / 100);
}
/** Update the token ceiling (e.g. per-model from model metadata). */
function setLimit(limit) {
    tokenLimit = limit;
}
const cache = new Map();
let cacheKeys = [];
function memoCount(text, rawCount) {
    cache.set(text, rawCount);
    cacheKeys.push(text);
    if (cacheKeys.length > CACHE_MAX_SIZE) {
        const evicted = cacheKeys.shift();
        cache.delete(evicted);
    }
    return rawCount;
}
/**
 * Count tokens in a single message, applying 1.35× fudge factor for
 * Claude (Anthropic) messages and standard GPT tokenization for others.
 */
function countMessageTokens(msg) {
    const raw = cache.get(msg.content);
    if (raw !== undefined)
        return raw;
    const base = (0, gpt_tokenizer_1.encode)(msg.content).length;
    const counted = msg.role === "assistant" ? Math.ceil(base * 1.35) : base;
    return memoCount(msg.content, counted);
}
/**
 * Count tokens across a full message array (system + conversations).
 * Uses per-message caching, so repeated messages are O(1).
 */
function countMessageArrayTokens(messages) {
    return messages.reduce((sum, m) => sum + countMessageTokens(m), 0);
}
