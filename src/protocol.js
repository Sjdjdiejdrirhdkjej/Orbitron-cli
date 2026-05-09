import kleur from 'kleur';

export const DEFAULT_API_BASE = 'https://orbitron--pastelsjuice8t.replit.app';
export const DEFAULT_MODEL = 'gpt-4.1-mini';

export function normaliseBaseUrl(value) {
  const trimmed = String(value || DEFAULT_API_BASE).trim().replace(/\/+$/, '');
  return trimmed || DEFAULT_API_BASE;
}

export function resolveApiUrl(baseUrl, pathname) {
  return new URL(pathname, `${normaliseBaseUrl(baseUrl)}/`).toString();
}

export function normaliseMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message.role === 'string' && typeof message.content === 'string')
    .map((message) => ({
      role: message.role.trim() || 'user',
      content: String(message.content ?? ''),
    }))
    .filter((message) => message.content.length > 0 || message.role === 'user');
}

export async function fetchModels(baseUrl, signal) {
  const res = await fetch(resolveApiUrl(baseUrl, '/v1/models'), {
    signal,
    headers: { accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Model discovery failed (${res.status}): ${text.slice(0, 200)}`);
  }

  try {
    const data = JSON.parse(text);
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.models)) return data.models;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  } catch {
    return [];
  }
}

function isRetryableError(status, message) {
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (!status && message.includes('fetch')) return true;
  if (!status && message.includes('network')) return true;
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export async function* streamChatCompletion({ baseUrl, apiKey, modelID, messages, temperature = 0.2, maxTokens = 2048, retries = 3, signal }) {
  const model = String(modelID ?? '').trim();
  const filtered = normaliseMessages(messages);
  if (!model) throw new Error('model is required');
  if (filtered.length === 0) throw new Error('messages is required');

  const maxAttempts = Math.max(1, retries) + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    let throwAborted = false;

    const linkedAbort = () => {
      if (signal?.aborted) {
        controller.abort();
        throwAborted = true;
      }
    };
    if (signal) signal.addEventListener('abort', linkedAbort);

    try {
      const res = await fetch(resolveApiUrl(baseUrl, '/v1/chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: filtered,
          temperature,
          max_tokens: maxTokens,
          stream: true,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        const errMsg = `Chat request failed (${res.status}): ${text.slice(0, 400)}`;
        if (isRetryableError(res.status, errMsg) && attempt < maxAttempts) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          process.stdout.write(`\n${kleur.yellow(`  retrying in ${delay / 1000}s…`)}`);
          await sleep(delay);
          continue;
        }
        throw new Error(errMsg);
      }

      if (!res.body) throw new Error('Response body is not available');

      const decoder = new TextDecoder();
      const reader = res.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (throwAborted) throw new AbortError();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data);
              const text = parsed.choices?.[0]?.delta?.content
                ?? parsed.choices?.[0]?.text
                ?? parsed.text
                ?? parsed.output
                ?? '';
              if (text) yield text;
            } catch {
              // skip malformed lines
            }
          }
        }
      } finally {
        reader.cancel();
      }

      return;
    } catch (err) {
      if (err.name === 'AbortError' || throwAborted) {
        throw err;
      }
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        process.stdout.write(`\n${kleur.yellow(`  retry ${attempt}/${maxAttempts - 1} failed: ${err.message?.slice(0, 120) || err}. retrying in ${delay / 1000}s…`)}`);
        await sleep(delay);
      } else {
        throw err;
      }
    } finally {
      if (signal) signal.removeEventListener('abort', linkedAbort);
    }
  }
}

export async function createChatCompletion({ baseUrl, apiKey, modelID, messages, temperature = 0.2, maxTokens = 2048, retries = 3, signal }) {
  const model = String(modelID ?? '').trim();
  const filtered = normaliseMessages(messages);
  if (!model) throw new Error('model is required');
  if (filtered.length === 0) throw new Error('messages is required');

  const maxAttempts = Math.max(1, retries) + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    let throwAborted = false;

    const linkedAbort = () => {
      if (signal?.aborted) {
        controller.abort();
        throwAborted = true;
      }
    };
    if (signal) signal.addEventListener('abort', linkedAbort);

    try {
      const res = await fetch(resolveApiUrl(baseUrl, '/v1/chat/completions'), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: filtered,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        const errMsg = `Chat request failed (${res.status}): ${text.slice(0, 400)}`;
        if (isRetryableError(res.status, errMsg) && attempt < maxAttempts) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          process.stdout.write(`\n${kleur.yellow(`  retrying in ${delay / 1000}s…`)}`);
          await sleep(delay);
          continue;
        }
        throw new Error(errMsg);
      }

      return res;
    } catch (err) {
      if (err.name === 'AbortError' || throwAborted) {
        throw err;
      }
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 1000;
        process.stdout.write(`\n${kleur.yellow(`  retry ${attempt}/${maxAttempts - 1} failed: ${err.message?.slice(0, 120) || err}. retrying in ${delay / 1000}s…`)}`);
        await sleep(delay);
      } else {
        throw err;
      }
    } finally {
      if (signal) signal.removeEventListener('abort', linkedAbort);
    }
  }
}
