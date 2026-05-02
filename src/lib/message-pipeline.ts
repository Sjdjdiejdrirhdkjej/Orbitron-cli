import { encode as encodeTokens } from "gpt-tokenizer";
import { streamChat, type ChatMessage } from "../api/chat";

export interface MessagePipelineConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface MessagePipelineSnapshot {
  messages: ChatMessage[];
  config: MessagePipelineConfig;
}

export type MessagePipelineEvent =
  | { type: "queued"; snapshot: MessagePipelineSnapshot }
  | { type: "started"; requestMessages: ChatMessage[] }
  | { type: "delta"; chunk: string; content: string; tokenCount: number }
  | { type: "final"; content: string; tokenCount: number; durationMs: number }
  | { type: "cancelled"; content: string; tokenCount: number; durationMs: number }
  | { type: "error"; error: Error };

export interface MessagePipelineResult {
  content: string;
  tokenCount: number;
  cancelled: boolean;
  durationMs: number;
  requestMessages: ChatMessage[];
}

export interface MessagePipelineOptions {
  signal?: AbortSignal;
  onEvent?: (event: MessagePipelineEvent) => void;
}

export function buildRequestTranscript(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message): message is ChatMessage => Boolean(message && typeof message.role === "string" && typeof message.content === "string"))
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

function cloneSnapshot(snapshot: MessagePipelineSnapshot): MessagePipelineSnapshot {
  return {
    messages: snapshot.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    config: { ...snapshot.config },
  };
}

function emit(onEvent: MessagePipelineOptions["onEvent"], event: MessagePipelineEvent): void {
  try {
    onEvent?.(event);
  } catch {
    // Ignore observer failures so transport execution stays isolated.
  }
}

export async function runMessagePipeline(snapshot: MessagePipelineSnapshot, options: MessagePipelineOptions = {}): Promise<MessagePipelineResult> {
  const snap = cloneSnapshot(snapshot);
  const requestMessages = buildRequestTranscript(snap.messages);
  emit(options.onEvent, { type: "queued", snapshot: snap });
  emit(options.onEvent, { type: "started", requestMessages });

  const startedAt = Date.now();
  let content = "";
  let tokenCount = 0;

  try {
    for await (const chunk of streamChat({
      baseUrl: snap.config.baseUrl,
      apiKey: snap.config.apiKey,
      model: snap.config.model,
      messages: requestMessages,
      temperature: snap.config.temperature,
      maxTokens: snap.config.maxTokens,
      signal: options.signal,
    })) {
      if (options.signal?.aborted) break;
      content += chunk;
      tokenCount += encodeTokens(chunk).length;
      emit(options.onEvent, { type: "delta", chunk, content, tokenCount });
    }

    const durationMs = Date.now() - startedAt;
    if (options.signal?.aborted) {
      emit(options.onEvent, { type: "cancelled", content, tokenCount, durationMs });
      return { content, tokenCount, cancelled: true, durationMs, requestMessages };
    }

    emit(options.onEvent, { type: "final", content, tokenCount, durationMs });
    return { content, tokenCount, cancelled: false, durationMs, requestMessages };
  } catch (error) {
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
