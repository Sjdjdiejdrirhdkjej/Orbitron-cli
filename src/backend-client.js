import { createChatCompletion, fetchModels, normaliseBaseUrl, streamChatCompletion } from './protocol.js';

export class BackendClient {
  constructor(config) {
    this.config = config;
  }

  updateConfig(config) {
    this.config = config;
  }

  get baseUrl() {
    return normaliseBaseUrl(this.config.baseUrl);
  }

  async listModels(signal) {
    return await fetchModels(this.baseUrl, signal);
  }

  async sendChat(messages, overrides = {}, signal) {
    const response = await createChatCompletion(
      {
        baseUrl: this.baseUrl,
        apiKey: this.config.apiKey,
        modelID: overrides.model ?? this.config.model,
        messages,
        temperature: overrides.temperature ?? this.config.temperature,
        maxTokens: overrides.maxTokens ?? this.config.maxTokens,
      },
      signal,
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Chat request failed (${response.status}): ${text.slice(0, 400)}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  async *streamChat(messages, overrides = {}, signal) {
    yield* streamChatCompletion(
      {
        baseUrl: this.baseUrl,
        apiKey: this.config.apiKey,
        modelID: overrides.model ?? this.config.model,
        messages,
        temperature: overrides.temperature ?? this.config.temperature,
        maxTokens: overrides.maxTokens ?? this.config.maxTokens,
      },
      signal,
    );
  }

  extractAssistantText(result) {
    if (typeof result?.raw === 'string') return result.raw;
    const choice = result?.choices?.[0];
    const content = choice?.message?.content ?? choice?.delta?.content ?? result?.output;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('');
    }
    return JSON.stringify(result, null, 2);
  }
}
