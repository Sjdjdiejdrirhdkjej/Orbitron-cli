"use strict";
/**
 * Message trimmer mirroring Codebuff's trimMessagesToFitLimit algorithm.
 * Key differences from the old autoPrune:
 * - Binary search for the optimal batch size (fast, O(log n))
 * - Always preserves system message + last 5 exchanges
 * - Drops oldest user/assistant pairs first
 * - targetTokens = ceiling × 0.50 (50% headroom)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.trimMessagesToFitLimit = trimMessagesToFitLimit;
const token_counter_js_1 = require("./token-counter.js");
/**
 * Prune messages to fit within the target token budget.
 * Returns the trimmed array and how many messages were dropped.
 */
function trimMessagesToFitLimit(messages, systemMessage) {
    const target = (0, token_counter_js_1.getTargetTokens)();
    // 1. Always include system message + last 5 exchanges (user + assistant)
    const pinnedCount = 5;
    const systemTokens = systemMessage ? (0, token_counter_js_1.countMessageTokens)(systemMessage) : 0;
    // Separate oldest-to-newest conversation pairs (user + assistant)
    const convMessages = messages.filter((m) => m.role !== "system");
    const pinnedMessages = convMessages.slice(-pinnedCount * 2);
    const droppableMessages = convMessages.slice(0, -pinnedCount * 2);
    const pinnedTokens = (0, token_counter_js_1.countMessageArrayTokens)(pinnedMessages);
    const budget = target - pinnedTokens - systemTokens;
    if (budget <= 0) {
        return {
            messages: systemMessage ? [systemMessage, ...pinnedMessages] : [...pinnedMessages],
            droppedCount: convMessages.length,
        };
    }
    if (droppableMessages.length === 0) {
        return {
            messages: systemMessage
                ? [systemMessage, ...pinnedMessages]
                : [...pinnedMessages],
            droppedCount: 0,
        };
    }
    // 2. Binary search: find how many of droppableMessages fit in budget
    let lo = 0;
    let hi = droppableMessages.length;
    let bestFit = 0;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const candidate = droppableMessages.slice(-mid);
        const tokens = (0, token_counter_js_1.countMessageArrayTokens)(candidate);
        if (tokens <= budget) {
            bestFit = mid;
            lo = mid + 1;
        }
        else {
            hi = mid - 1;
        }
    }
    const keptMessages = droppableMessages.slice(-bestFit);
    const droppedCount = droppableMessages.length - bestFit;
    const result = [
        ...(systemMessage ? [systemMessage] : []),
        ...keptMessages,
        ...pinnedMessages,
    ];
    return { messages: result, droppedCount };
}
