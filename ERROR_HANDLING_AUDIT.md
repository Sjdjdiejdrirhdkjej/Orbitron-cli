# Orbitron TUI Error Handling Audit

**Date:** 2026-05-09
**Auditor:** Emma (Zo Computer)
**Scope:** `src/store/chat-store.ts`, `src/api/chat.ts`, `src/protocol.js`, `src/cli.js`, `src/main.tsx`, `src/lib/fetch-agent.js`, `src/lib/message-pipeline.ts`, `src/screens/chat-screen.tsx`

---

## 1. Backend Connection Failure Handling

### Current Behaviour

#### `src/store/chat-store.ts` — `checkHealth()`
```typescript
checkHealth: async () => {
  const { baseUrl } = get().config;
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(baseUrl + "/v1/models", {
      method: "HEAD",
      signal: controller.signal,
      headers: { accept: "application/json" },
      dispatcher: fetchAgent,
    });
    await res.text();
    set((s) => {
      s.backendLatencyMs = Date.now() - start;
      s.backendHealth = res.ok ? "ok" : "error";
    });
  } catch {
    set((s) => {
      s.backendHealth = "error";
    });
  } finally {
    clearTimeout(timeout);
  }
},
```

**Issues:**
- `catch` block is **empty** — no error message is captured or displayed to the user. The health dot turns red, but the user has no idea *why* (DNS failure? timeout? 500 error?).
- `res.text()` is called but not checked — if the body is empty or unreadable, it silently swallows the error.
- No retry logic for transient failures.
- `HEAD` request to `/v1/models` may not be supported by all backends; a `GET` with early abort is more robust.

#### `src/api/chat.ts` — `listModels()`
```typescript
export async function listModels(baseUrl: string): Promise<ModelInfo[]> {
  const res = await fetch(resolveApiUrl(baseUrl, "/v1/models"), {
    headers: { accept: "application/json" },
    dispatcher: fetchAgent,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Model fetch failed (${res.status})`);
  }
  // ...
}
```

**Issues:**
- Error message only includes status code, not the response body or the *actual* URL that failed.
- No timeout — this can hang indefinitely.
- No retry for 502/503/504 from a Replit-hosted backend.

#### `src/protocol.js` — `streamChatCompletion()`
```javascript
if (!res.ok) {
  const text = await res.text();
  const errMsg = `Chat request failed (${res.status}): ${text.slice(0, 400)}`;
  if (isRetryableError(res.status, errMsg) && attempt < maxAttempts) {
    // ... retry with exponential backoff
  }
  throw new Error(errMsg);
}
```

**Good:** Has retry logic with exponential backoff (1s, 2s, 4s).  
**Bad:** Retries are only for HTTP-level errors. Network-level failures (DNS, TCP timeout, SSL) are caught in the outer `catch` but the retry loop there is less robust.

---

## 2. SSL Certificate Error Handling

### Current Behaviour

#### `src/lib/fetch-agent.js`
```javascript
export const fetchAgent = new Agent({
  connections: 10,
  keepAliveTimeout: 3000,
  maxRequestsPerClient: 100,
  connect: {
    checkServerIdentity: () => undefined,  // <-- DISABLES CERT VALIDATION
    ca: caBundle,
  },
});

setGlobalDispatcher(fetchAgent);
```

**Critical Issue:** `checkServerIdentity: () => undefined` **completely disables hostname verification**. This is a security risk. It was added to handle Replit's self-signed/CA certificates, but it removes *all* protection against MITM attacks.

The CA bundle loading is also fragile:
```javascript
function loadCaBundle() {
  const candidates = [
    path.join(__dirname, 'ca-bundle.pem'),
    path.join(__dirname, '..', 'lib', 'ca-bundle.pem'),
    path.join(process.cwd(), 'src', 'lib', 'ca-bundle.pem'),
    path.join(__dirname, '..', '..', 'certs', 'replit-ca.pem'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p);
      }
    } catch {}
  }
  return undefined;
}
```

**Issues:**
- If no CA bundle is found, it falls back to `undefined` — which means the system default CAs are used. Combined with disabled hostname check, this is inconsistent.
- The `certs/replit-ca.pem` file exists but the path resolution is fragile (depends on `__dirname` which varies between source and compiled).
- No logging when CA bundle fails to load — the user has no idea SSL verification is disabled.

**Codex CLI Pattern:** Codex CLI uses `NODE_EXTRA_CA_CERTS` or explicitly trusts a pinned cert per-backend, but never disables `checkServerIdentity`. It also prints a warning when operating in "insecure" mode.

---

## 3. Exit Codes on Failure

### Current Behaviour

#### `src/main.tsx`
```typescript
main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

**Good:** Exits with code 1 on fatal error.  
**Bad:** Only catches the renderer bootstrap. If the React app crashes *after* mount, there's no global handler.

#### `src/cli.js`
```javascript
main().catch((error) => {
  console.error(kleur.red(error instanceof Error ? error.stack ?? error.message : String(error)));
  stopFileWatcher();
  process.exitCode = 1;
});
```

**Issues:**
- Uses `process.exitCode = 1` instead of `process.exit(1)`. This is actually *better* (allows event loop to drain), but it's inconsistent with `main.tsx` which uses `process.exit(1)`.
- The `sendMessage()` function catches errors internally and prints them, but **never exits** — the CLI continues running even after a fatal backend error. This is appropriate for interactive mode but not for `--message` one-shot mode.
- No distinction between:
  - `1` — general error
  - `2` — bad CLI arguments
  - `3` — backend unreachable
  - `4` — authentication failure
  - `130` — SIGINT (user cancelled)

#### `src/update.ts`
```typescript
export async function performUpdate(): Promise<boolean> {
  try {
    spawn("npm", ["install", "-g", "orbitron-tui"], {
      detached: true,
      stdio: "inherit",
    });
    process.exit(0);  // Hard exit after spawning update
    return true;
  } catch {
    return false;
  }
}

export function restartWithUpdate() {
  // ...
  process.exit(0);  // Another hard exit
}
```

**Issues:**
- `performUpdate()` exits with `0` even though the npm install is still running in the background. If the install fails, the user is never told.
- No way for the caller to know if the update succeeded.

---

## 4. Unhandled Promise Rejections & Silent Failures

### Current Behaviour

#### `src/main.tsx` — update check
```typescript
checkForUpdate().then(({ current, latest, outdated }) => {
  if (outdated) {
    console.log(`\n⚠ Update available...`);
  }
}).catch(() => {
  // silently ignore update check failures
});
```

**Issue:** Update check failures are completely silent. If npm registry is unreachable, the user never knows.

#### `src/update.ts` — `checkForUpdate()`
```typescript
try {
  // ... fetch from npm registry
} catch {
  // Network/SSL error — silently skip update check
  return { current, latest: current, outdated: false };
}
```

**Issue:** Comment admits it's "silently skip[ping]" — no log, no status indicator.

#### `src/screens/chat-screen.tsx` — model list load
```typescript
useEffect(() => {
  setStatus("Discovering models...");
  listModels(config.baseUrl)
    .then((m) => setModelCount(m.length))
    .catch((err: Error) => setLastError(err.message))
    .finally(() => setStatus("Ready"));
}, [config.baseUrl, setLastError, setStatus]);
```

**Good:** At least errors are shown via `setLastError`.  
**Bad:** The error is a single string that may be overwritten by subsequent operations. No persistent error log.

#### `src/store/chat-store.ts` — session persistence
```typescript
function saveSessions(sessions: Record<string, StoredSession>) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // storage full or unavailable
  }
}
```

**Issue:** `localStorage` quota exceeded is silently ignored. User may think sessions are saved when they aren't.

#### `src/screens/chat-screen.tsx` — scroll anchor
```typescript
try { scrollAnchorRef.current.scrollIntoView({ block: "end" }); } catch {}
```

**Issue:** Empty catch — if scroll fails, no fallback. (Minor, but pattern is pervasive.)

#### `src/protocol.js` — SSE parse errors
```javascript
try {
  const parsed = JSON.parse(data);
  // ...
} catch {
  // skip malformed lines
}
```

**Issue:** Malformed SSE lines are silently skipped. If the backend starts sending non-JSON data (e.g., an HTML error page), the user sees an empty stream with no explanation.

---

## 5. Streaming Response Network Interruptions

### Current Behaviour

#### `src/api/chat.ts` — `streamChat()`
```typescript
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";

try {
  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // ... parse lines
  }
} finally {
  try { await reader.cancel(); } catch {}
}
```

**Issues:**
- If `reader.read()` throws (network drop), the error propagates out and terminates the generator. The `finally` runs, but:
  - No partial content is returned to the user — it's lost.
  - No retry or resume capability.
- `reader.cancel()` in `finally` may throw if the connection is already dead — caught but ignored.

#### `src/protocol.js` — `streamChatCompletion()`
```javascript
try {
  while (true) {
    const { done, value } = await reader.read();
    if (throwAborted) throw new AbortError();
    if (done) break;
    // ...
  }
} finally {
  await reader.cancel().catch(() => {});
  if (res.body) {
    try { await res.body.cancel(); } catch {}
  }
}
```

**Good:** Has `throwAborted` guard to distinguish user cancellation from network errors.  
**Bad:** If the network drops mid-stream, the outer `catch` retries the *entire* request, not just the stream resumption. For a long-running generation, this means starting over.

#### `src/lib/message-pipeline.ts` — `runMessagePipeline()`
```typescript
try {
  for await (const chunk of streamChat({ ... })) {
    if (options.signal?.aborted) break;
    content += chunk;
    tokenCount += encodeTokens(chunk).length;
    emit(options.onEvent, { type: "delta", chunk, content, tokenCount });
  }
  // ...
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  if (err.name === "AbortError" || options.signal?.aborted) {
    // ... return cancelled result
  }
  emit(options.onEvent, { type: "error", error: err });
  throw err;
}
```

**Good:** Distinguishes abort from error, emits error event.  
**Bad:** The `throw err` at the end means the caller must catch it. In `chat-screen.tsx`, the catch block adds a failed message — but the partial `content` accumulated before the error is lost because the function throws before returning it.

---

## Summary Table

| Area | Severity | Issue |
|------|----------|-------|
| SSL | **High** | `checkServerIdentity` disabled entirely — MITM vulnerability |
| Exit codes | Medium | No semantic exit codes; inconsistent `process.exit` vs `process.exitCode` |
| Silent failures | Medium | Update check, session save, scroll anchor, SSE parse errors all silently swallowed |
| Backend health | Medium | `checkHealth()` gives no error detail; no retry |
| Streaming | Medium | Network drop loses partial content; no resume |
| Health check | Low | Uses `HEAD` which may not be supported; no timeout on `listModels()` |

---

## Recommendations (Codex CLI Style)

### A. Fix SSL Handling
1. **Remove** `checkServerIdentity: () => undefined`.
2. Load the Replit CA bundle properly at build time and embed it.
3. If the backend uses a self-signed cert, add an explicit `--insecure` CLI flag that prints a **yellow warning** on startup:
   ```
   ⚠  SSL certificate verification disabled. Use --insecure only for development.
   ```
4. Fall back to system CAs if no custom CA is found — do not disable verification.

### B. Implement Semantic Exit Codes
```typescript
const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  BAD_ARGUMENTS: 2,
  BACKEND_UNREACHABLE: 3,
  AUTH_FAILURE: 4,
  SIGINT: 130,
} as const;
```

For one-shot mode (`--message`), exit with the appropriate code so scripts can handle failures.

### C. Eliminate Silent Failures
1. **Update check:** Print a single line on failure:
   ```
   ⚠  Update check failed (network unreachable)
   ```
2. **Session save:** If `localStorage.setItem` throws, print:
   ```
   ⚠  Session save failed (storage quota exceeded)
   ```
3. **SSE parse errors:** If 3+ consecutive lines fail to parse, print:
   ```
   ⚠  Backend sent unexpected response format. The server may be down.
   ```
4. **Health check:** Capture and display the actual error:
   ```typescript
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set((s) => {
      s.backendHealth = "error";
      s.backendError = msg;  // new field
    });
  }
  ```

### D. Improve Streaming Resilience
1. **Return partial content on error:** Change `runMessagePipeline()` to return `{ content, tokenCount, cancelled: false, error: err }` instead of throwing, so the UI can show what was received before the failure.
2. **Add a `--resume` flag** (future) that sends the conversation so far and asks the backend to continue.
3. **Detect stalled streams:** If no token arrives for 60s, show:
   ```
   ⚠  Stream stalled — no tokens for 60s. Press Ctrl+C to cancel.
   ```

### E. Add Global Error Handlers
```typescript
// At top of main.tsx and cli.js
process.on("unhandledRejection", (reason) => {
  console.error(kleur.red("\n✗ Unhandled rejection:"), reason);
  process.exitCode = 1;
});

process.on("uncaughtException", (err) => {
  console.error(kleur.red("\n✗ Uncaught exception:"), err.stack ?? err.message);
  process.exit(1);
});
```

### F. Non-Interactive Friendly Output
For CI/scripting use (`--message` or piped input):
- Print errors to **stderr**, not stdout.
- Use plain text (no ANSI colours) when `process.stdout.isTTY === false`.
- Prefix all error lines with `error:` so they are grep-able.
- Return JSON output with `--json` flag for programmatic use.

---

*End of audit.*
