/**
 * Message trimmer — trimMessagesToFitLimit algorithm.
 * Key differences from the old autoPrune:
 * - Binary search for the optimal batch size (fast, O(log n))
 * - Always preserves system message + last 5 exchanges
 * - Drops oldest user/assistant pairs first
 * - targetTokens = ceiling × 0.50 (50% headroom)
 */

import {
  countMessageTokens,
  countMessageArrayTokens,
  getTargetTokens,
} from "./token-counter.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TrimResult {
  messages: Message[];
  droppedCount: number;
}

/**
 * Prune messages to fit within the target token budget.
 * Returns the trimmed array and how many messages were dropped.
 */
export function trimMessagesToFitLimit(
  messages: Message[],
  systemMessage?: Message
): TrimResult {
  const target = getTargetTokens();

  // 1. Always include system message + last 5 exchanges (user + assistant)
  const pinnedCount = 5;
  const systemTokens = systemMessage ? countMessageTokens(systemMessage) : 0;

  // Separate oldest-to-newest conversation pairs (user + assistant)
  const convMessages = messages.filter((m) => m.role !== "system");
  const pinnedMessages = convMessages.slice(-pinnedCount * 2);
  const droppableMessages = convMessages.slice(0, -pinnedCount * 2);

  const pinnedTokens = countMessageArrayTokens(pinnedMessages);
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
    const tokens = countMessageArrayTokens(candidate);

    if (tokens <= budget) {
      bestFit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const keptMessages = droppableMessages.slice(-bestFit);
  const droppedCount = droppableMessages.length - bestFit;

  const result: Message[] = [
    ...(systemMessage ? [systemMessage] : []),
    ...keptMessages,
    ...pinnedMessages,
  ];

  return { messages: result, droppedCount };
}