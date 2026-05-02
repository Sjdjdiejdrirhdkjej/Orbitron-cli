export { renderHeader, renderStatusCard, renderSettingsCard, renderModelsCard, renderFilesPane, renderChatPane, renderOverview as renderScreen, renderBudgetMeter } from './screens/overview.js';
export { wrapText, truncate, pad, repeat } from './components/text.js';

/**
 * Estimate token count from plain text using a fast word-based approximation.
 * Based on the common ~4 chars/token average for English text.
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  // Split on whitespace for word-based estimate, then apply average ratio
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chars = text.length;
  // Mixed estimate: 0.25 words/char is ~4 chars per token
  const wordBased = Math.ceil(words.length / 0.75);
  const charBased = Math.ceil(chars / 4);
  // Take the higher of the two (more conservative)
  return Math.max(wordBased, charBased);
}

/**
 * Estimate cost in USD for a message given input + output token counts.
 * Uses rough per-1M pricing for common models.
 */
export function estimateCost(inputTokens, outputTokens = 0, model = 'gpt-4.1-mini') {
  // Approximate pricing per 1M tokens
  const pricing = {
    'gpt-4.1-mini': { input: 0.15, output: 0.6 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
    'claude-3-sonnet': { input: 3, output: 15 },
    'claude-3.5-sonnet': { input: 3, output: 15 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
    'gemini-1.5-pro': { input: 1.25, output: 5 },
  };
  const p = pricing[model.toLowerCase()] ?? { input: 1, output: 3 };
  const inputCost = (inputTokens / 1_000_000) * p.input;
  const outputCost = (outputTokens / 1_000_000) * p.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}
