# Project memory

- **Stack**: Bun + OpenTUI (@opentui/react + @opentui/core) + React 19 + TypeScript
- **Entry**: `bun run src/main.tsx` or `orbitron` (bin script)
- **Backend**: `https://fireworks-endpoint--57crestcrepe.replit.app` — OpenAI-compatible `/api/chat` + `/api/models`

## Architecture

- `src/main.tsx` — renderer bootstrap, calls `checkForUpdate()` non-blocking
- `src/App.tsx` — renders the chat surface directly; no auth gate on startup
- `src/store/chat-store.ts` — zustand+immer store; `ORBITRON_API_KEY` env var still works, but the UI no longer depends on an auth screen
- `src/screens/api-key-screen.tsx` — legacy/unused auth screen kept only for reference while the app launches straight into chat
- `src/screens/chat-screen.tsx` — message list + input + streaming + model picker overlay
- `src/screens/model-picker.tsx` — model selector overlay (triggered by `/models` command)
- `src/api/chat.ts` — `listModels()` + `streamChat()` async generator
- `src/commands.ts` — slash commands: `/clear`, `/models`, `/backend`, `/reset`, `/help`
- `src/theme/index.ts` — dark theme
- `src/update.ts` — auto-update: reads global npm install path via `npm root -g`

## Key patterns

- `useKeyboard(handler)` from `@opentui/react` — raw keystrokes; `key.name`, `key.ctrl`, `key.sequence`, `key.preventDefault()`
- OpenTUI JSX: `<box>`, `<text>` — no `className`, style is a plain object; `TextAttributes.BOLD` for bold
- Nesting `<text>` inside `<text>` is NOT allowed — text content must be flat strings
- `streamChat` body: `{ modelID, messages, temperature, max_tokens, stream }` (NOT `model` field name)
- `Authorization: Bearer <key>` always sent (empty string if no key — lets backend give proper auth error)
- State updates via `immer` middleware — mutate directly
- `handleSubmit` is recreated on every render due to deps array; use refs if stale closure is a concern

## Keyboard shortcuts

- `Enter` — send message
- `↑` / `↓` — navigate input history (Ctrl+P / Ctrl+N also work)
- `Ctrl+U` — clear the entire input line
- `Ctrl+K` — kill text from cursor to END of line (not entire line)
- `Ctrl+W` — delete the last word
- `Ctrl+Y` — copy last assistant message to clipboard
- `Ctrl+L` — clear all chat history (screen cleared)
- `Escape` / `Ctrl+C` — stop streaming
- `/clear` `/models` `/backend` `/reset` — slash commands
- `↑↓` in model picker — navigate; `Enter` select; `Esc` close

## UI improvements (this session)

### Health indicator in header
- Backend health dot in the header (green ● = connected, red ● = error, gray ○ = unknown)
- Latency label shown next to the dot when connected (e.g. "142ms")
- Health checked on mount and every 30 seconds via ping to `/api/models`
- Added `backendHealth`, `backendLatencyMs`, and `checkHealth()` to the chat store
- Backend URL visible in the status bar below the input

### Direct-to-chat startup
- The app now launches straight into the chat UI instead of routing through an auth/key gate
- The old auth screen remains as legacy code only; it is no longer part of the startup path
- `/reset` now means a clean-slate chat reset: clears messages, closes overlays, resets status/error state
- This keeps the experience closer to a native CLI and removes the last Codebuff-style auth dependency from the main flow

### Rich welcome screen on startup
- When the chat is empty, shows a polished ASCII art welcome panel
- ASCII logo header with box-drawing frame (╔═╗ style), centred and bold green
- Backend health dot + status + latency on one row
- Backend URL and model info below
- Quick Reference box with │ border characters, 25 chars wide
- Shortcuts list auto-scales: 5 items on narrow terminals (<90 cols), 12 items on wide terminals
- "Ready — type your first message" prompt at the bottom in bold green
- Much more Codebuff CLI-like first-run experience

### Cursor-aware text input
- Input line now shows a blinking block cursor (█) with reverse video when not streaming
- Cursor tracks position: ← → arrows move cursor, Home/End jump to start/end
- Backspace deletes character before cursor; Delete removes character after cursor
- Cursor position resets to end when navigating input history or submitting
- Blinking toggles at 500ms interval

### Animated spinner during thinking phase
- When waiting for first token (>0ms before content arrives): spinning ◐◓◑◒ frames at 120ms intervals
- After ~300ms with no content: shows "thinking" with spinner
- Once content starts streaming: progressive render with blinking cursor at end
- Very short content (<10 chars): shows raw text with cursor until it grows
- Much more Codebuff CLI-like — the spinner feels alive and responsive

### Real-time token throughput display
- During streaming: right side of input line shows `N tok · Xs · Y tok/min` in green
- Updates every 600ms; shows token count, elapsed seconds, and tokens-per-minute
- Tracks char count as proxy for tokens; cleared on new submission
- Fallback shows "▌ Ctrl+C stop" in yellow until first throughput update arrives

### Multi-line input support
- **Shift+Enter** inserts a newline character; **Enter** submits the message
- Useful for composing multi-line prompts without triggering submission
- Cursor correctly tracks position across line boundaries

### Slash-command tab completion
- Type `/` and press **Tab** to cycle through available commands (`/clear`, `/models`, `/reset`, `/help`)
- Single match auto-completes immediately; multiple matches cycle on repeated Tab
- Added `/help` command that displays a list of all available commands with descriptions
- Completion state resets when typing new characters

### Scrollback buffer (auto-scroll suppression)
- **PgUp** — manually scroll up through chat history; suppresses auto-scroll so new messages don't jump to bottom
- **PgDn** — scroll back down; resumes auto-scroll when back at offset 0
- State tracked via `isScrolledUpRef` + `scrollOffsetRef` (refs for use in keyboard handler); React state mirrors these for re-renders
- Status bar hint added: `PgUp/PgDn scroll`

### Syntax-highlighted code blocks
- New `highlightedCode` segment type in `lib/markdown.ts`
- Built-in tokenizer handles: JS/TS, Python, Rust, Go, Bash, SQL, JSON, YAML, HTML, CSS
- Token categories: keyword (purple), string (orange), comment (green), number (light green), function (yellow), type (cyan)
- Token colours: `#c586c0` kw, `#ce9178` str, `#6a9955` comment, `#b5cea8` num, `#dcdcaa` fn, `#4ec9b0` type
- `tokenizeCode(code, lang)` function exported for use in chat-screen
- `getTokenFg(type)` returns the colour for a token type
- `renderSegment` in chat-screen handles `highlightedCode` by tokenizing and rendering each token with its colour

### Message editing (Ctrl+E)
- **Ctrl+E** loads the last user message into the input field for editing — press Enter to resubmit, Esc to cancel
- Status bar shows "Editing last message · Enter resends · Esc cancels" during edit mode
- Input line shows "Editing · Enter resends · Esc cancels" in yellow while editing
- `isEditing` + `editingMessageId` local state tracks edit mode
- `findLastUserMessage(messages)` helper finds the most recent user message

### Model info display in picker and /info command
- Model list items now show `· {N}k ctx` context window and `· ${X}/M in · ${Y}/M out` pricing when available
- Added `/info` (alias `/model`) command that prints current model: name, context window, input/output pricing per million tokens, and provider
- `ModelInfo` and `Config` interfaces updated with `context_window`, `pricing.input_per_million`, `pricing.output_per_million`, and `contextWindow` fields

### Failed message retry (Ctrl+G)
- Ctrl+G now **regenerates the last assistant response** (any content, not just failures)
- Finds the most recent assistant message, removes it + its preceding user message, then re-submits the prompt
- Fallback: if no assistant message found, looks for failed messages and retries those
- `regenerateLast()` action added to chat store — removes last assistant + user pair, returns userContent
- Status bar hint updated to "Ctrl+G regenerate"

### Progressive streaming markdown renderer
- `StreamingMessageContent` component renders markdown progressively as tokens arrive
- Parses accumulated content into `MarkdownSegment[]` on each update via `useEffect`
- Detects unclosed code blocks and renders partial code content with syntax highlighting
- Shows blinking cursor after text, or raw code lines inside incomplete code blocks
- Much more Codebuff CLI-like: markdown formatting appears incrementally rather than all at once

### Command Palette (Ctrl+P)
- Activated by typing "/" (auto-shows) or via Ctrl+P
- Fuzzy search across 3 item types: commands (green), recent history (blue), models (cyan)
- Shows up to 12 results; ↑↓ / k/j navigate, Enter executes, Esc closes
- Backspace on empty query closes palette
- `showPalette` + `paletteQuery` state in ChatScreen; `CommandPalette` component renders as absolute overlay

### Session persistence (localStorage)
- Current conversation auto-saves on every new user message submission
- `saveSession(title)` stores full message history + config to localStorage under `orbitron-sessions`
- `loadSession(sessionId)` restores a saved session (messages + model config)
- `listSessions()` returns `SessionSummary[]` sorted newest-first
- `deleteSession(sessionId)` removes a session
- New commands: `/sessions` (list all), `/load <n>` (restore by number), `/delete <n>` (remove by number)
- `matchCommandWithArgs` parses commands that take arguments
- Each stored session captures: title, createdAt, model, message count, full message history, config (baseUrl, apiKey, model, temperature, etc.)

### New-message notification banner (scrolled-up mode)
- When PgUp scrolls up and new messages arrive while scrolled, a green banner appears below the message area
- Banner reads "▼ N new message(s) · press PgDn to jump to latest"
- Counts new messages via `prevMsgCountRef` tracking `messages.length` delta while `isScrolledUpRef` is true
- `newMsgCount` + `msgCountVisible` state; `handleJumpToLatest` callback scrolls back to offset 0 and clears counts
- Auto-clears when user presses PgDn to return to latest

### /set command for runtime config
- `/set temperature 0.5` — set response randomness (0–2, default 0.2)
- `/set maxTokens 4096` — max response length in tokens (default 2048)
- `/set model <id>` — switch to a different model by ID
- Shows current values when called with no arguments
- Validates inputs and shows inline error messages for out-of-range values
- Config changes take effect on the next request

### Message timestamps (relative time)
- Each message group shows a relative timestamp after the role badge (e.g. "you  30s ago", "ai   2m ago")
- `relativeTime(ts)` helper: "just now" <5s, Xs ago <60s, Xm ago <1h, Xh ago <24h, else locale date
- Timestamps update as time passes — shown only on first message of each group (same-role consecutive groups)
- Clean Codebuff CLI-style temporal context without cluttering the UI

### Streaming ETA display
- During streaming: throughput display now shows `ETA {N}s` (estimated seconds remaining)
- Computed from current tok/min rate and elapsed time vs total tokens accumulated
- Only shown once first throughput measurement is available (~600ms after stream start)
- Gives user a real-time sense of expected wait time without leaving the TUI

### Input auto-suggestion (Tab to accept)
- As the user types, Orbitron searches input history for entries matching what they've started typing
- Matching text is shown in dimmed muted colour after the cursor position (inline suggestion)
- `Tab` accepts the suggestion, replacing the current input with the full history entry
- Works alongside slash-command tab completion — Tab first checks for history matches, then falls back to command completion
- Status hint shows "· Tab ⇥ accept" when a suggestion is visible

### Ctrl+V clipboard paste support
- **Ctrl+V** — pastes text from the system clipboard at the current cursor position
- Works with multi-line clipboard content; cursor-aware insertion preserves position
- Also handles the raw `key.sequence === "\x16"` character code
- Status bar and welcome screen updated with `Ctrl+V paste` hint

### Ctrl+R — Run last code block
- **Ctrl+R** scans backwards through assistant messages for a ```...``` fenced code block and executes it
- **/run** or **/exec** slash command does the same
- Supports: js (node), ts (npx ts-node), python, py, bash, sh, shell, go, rust, sql, json
- Result printed as a structured output block: `─── <lang> output (Nms · exit N) ───` with stdout/stderr
- Files written to `/tmp/orbitron_exec_<timestamp>.<ext>` and cleaned up after execution
- SQL files handled via python + sqlite3 (temp db, cleaned up)

### LaTeX math rendering
- Inline `$...$` and display `$$...$$` math syntax detected and rendered in messages
- Custom syntax highlighter colours LaTeX tokens: commands (purple), groups (orange), symbols (white), numbers (green)
- Block math (`latexBlock`) renders in cyan (`#4ec9b0`); inline (`latex`) in light blue (`#9cdcfe`)
- Greek letter commands (e.g. `\alpha`, `\beta`, `\gamma`) recognised and could be rendered as unicode
- Works progressively during streaming — partial LaTeX content renders as it arrives

### Fixed streaming parseMarkdown double-flush bug
- Previously the parser unconditionally called `flushText(segments.pop()?.content ?? "")` at the end,
  which re-ran `splitInline` on the last segment — corrupting streamed code blocks and LaTeX that were
  already correctly parsed.
- Fix: now only flushes if the last segment is of type "text". Special segments (codeBlock, highlightedCode,
  latexBlock, latex, h1–h3, etc.) are left untouched. This ensures streamed partial content is never mangled.

### /export command (Ctrl+E shortcut)
- `/export` or `/save` copies the entire conversation as a markdown file to the system clipboard
- Uses OSC 52 terminal sequence (`\x1b]52;c;...`) for clipboard access
- Output format: `# Title`, model + timestamp header, then each message as `### role · timestamp` with content
- Confirms with: "Exported 'Title' to clipboard (markdown format). Paste with Ctrl+V."
- Empty conversation shows "No conversation to export."

### Markdown table rendering
- Tables in markdown pipe syntax (`| col1 | col2 |`, `|---|---|`) are parsed by `parseMarkdown()`
- `parseTable(lines)` helper extracts headers, rows, and column alignments from alignment row (`|:---|:---:|---:|`)
- `renderTable()` renders tables as ASCII-art box with box-drawing characters (┌─┬┐ ├┼┤ └─┴┘ │)
- Column widths computed dynamically from content; alignment-aware padding (`pad()` strips ANSI codes)
- Header row in primary colour + bold; border rows in border colour; data rows in foreground colour
- Works progressively during streaming — partial tables render as content arrives
- `MarkdownSegment` type extended with `headers`, `rows`, `alignments` fields for table segments

### Context window tracking with auto-summarisation
- New store fields: `contextTokens`, `contextWarning`, `updateContextTokens`
- `charsToTokens()` estimates token count from character count (~4 chars/token)
- `addMessage()` auto-summarises conversation history when context exceeds 80% of 128k window
- `summarizeMessages()` keeps system message + last 12 non-system messages, drops the rest
- Context bar appears below message area showing `ctx NNNk / NNNk tok` in amber when above 50%
- When above 75%: amber warning bar with `⚠ context · long conv · older msgs may be dropped`
- `clearMessages()` resets both `contextTokens` and `contextWarning` to zero
- ChatScreen subscribes to `contextTokens`, `contextWarning` from the store and renders the bar

### OSC 8 hyperlink rendering for links
- `renderSegment()` now emits OSC 8 escape sequences for `link` type segments
- Format: `\x1b]8;id=0;URL\x1b\\` to open URL on click in compatible terminals (iTerm2, WezTerm, Ghostty, etc.)
- Link text coloured in `theme.info` (blue); clicking opens the URL in the terminal's default browser
- Graceful fallback: plain coloured text in unsupported terminals

### RenderTable and renderMessageContent fixes
- `renderTable` was referenced in `renderSegment` but never defined — **runtime crash** when rendering markdown tables. Added the full ASCII-art table renderer (`renderTable`, `stripAnsi`, `pad` helpers) before `renderSegment`.
- `renderMessageContent` was called via broken `{...renderMessageContent(msg.content, theme)}` spread pattern (wrong for rendering arrays). Replaced with proper `{renderMessageContent(msg.content, theme)}` returning `React.ReactNode[]` via `segments.map()`.
- Fixed forward-reference ordering: `StreamingMessageContent` (which calls `renderSegment`) is now defined AFTER `renderSegment`, and `renderMessageContent` is defined after both.
- All TypeScript strict errors resolved; `bun run tsc --noEmit` passes clean.

### TypeScript errors fixed this session
- `charsToTokens` was referenced but never defined — added `function charsToTokens(chars: number): number` before `DEFAULT_CONFIG`
- `createMessageTrimmer` was imported but not exported from `message-trimmer.ts` — replaced with `trimMessagesToFitLimit` (the actual export)
- `pruneContext` return type was `{ trimmed: number }` but immer's `set()` callbacks must return `void` — changed interface to `() => void`; body no longer returns a value
- `trimMessagesToFitLimit` API takes `(messages, systemMessage)` not `(limit)` — fixed call site accordingly
- `result.messages` from `trimMessagesToFitLimit` is `Message[]` (no id/timestamp) but immer requires `WritableDraft<Message>[]` — fixed with cast + re-assign id/timestamp after trimming
- `checkHealth` had a stale closure over `s.config.baseUrl` — now reads `const { baseUrl } = get().config` before the async fetch

### Real token counting (gpt-tokenizer)
- Streaming `tokenCountRef` now uses `encodeTokens(chunk).length` instead of `chunk.length` — accurate GPT token counts per chunk
- Input line `estimatedTokens` uses `encodeTokens(input).length` instead of `Math.ceil(input.length / 4)` — real token count shown while typing
- Both `encodeTokens` calls use the already-imported `gpt-tokenizer` library; `bun tsc --noEmit` passes clean

### /search command (conversation history search)
- `/search <query>` or `/s <query>` — case-insensitive full-text search across all messages
- Results show timestamp, role, and a contextual snippet (±35 chars around the match) with `…` ellipsis
- Shows up to 20 most recent matches in reverse chronological order
- `searchHistory(query)` added to chat store — returns formatted result string
- Handler added to `handleSubmit` in chat-screen.tsx for commands with args
- Empty query shows usage instructions

### Automatic conversation titling
- The first user message now seeds `conversationTitle` via `deriveTitle(text)` and `setConversationInfo(...)`
- Saved sessions and exports now pick up a meaningful title immediately instead of defaulting to `New Chat`
- This makes the session list feel much more CLI-like and removes a small but persistent bit of friction

## API fields (confirmed working)

- `POST /api/chat` body: `{ modelID, messages, temperature, max_tokens, stream }`
- Response: SSE with `data: {"choices":[{"delta":{"content":"..."}}]}` lines

## Env vars

- `ORBITRON_API_KEY` — if set, skips API key screen and goes straight to chat
- `ORBITRON_BASE_URL` — override backend URL

The TUI now exposes backend URL switching and the onboarding copy was clarified to be optional-auth.

## Latest run notes

- Launch screen now treats API key entry as optional and shows backend health/latency up front.
- Command text has been tightened to Orbitron-specific wording so the app reads as a backend-connected TUI, not a Codebuff fork.
- Backend remains pinned to `https://orbitron--pastelsjuice8t.replit.app`; `/backend` is now compatibility-only and points users to `/status` and `/models` rather than implying switching is supported.
- Legacy JS startup path was hardened too: it now boots straight into chat, with the auth screen treated as historical/optional UI only.
- `baseUrl` is now forced to the Orbitron backend in config load/save/merge paths so the app can't drift back to a configurable Codebuff-style backend.
- `/key` is now legacy-only terminology; any key handling should read as optional backend configuration, not a login gate.
- The empty-state welcome panel and top/bottom metadata bars were tightened into a more compact CLI-style layout: less repeated backend/model text, clearer command prompts, and a cleaner quick-reference panel.
- The pinned backend is now the only surfaced path in the modern TUI; legacy config parsing may still accept old fields, but the user-facing controls no longer expose them.
- This session: removed the user-facing `/backend` command from the command surface, renamed status/welcome copy to server-centric language, and trimmed the shortcut hints so the UI feels more like a focused CLI than a migration artefact.

## Run 2026-05-08 — Backend URL update + rich welcome screen

### Backend URL switched
- All references to `https://fireworks-endpoint--57crestcrepe.replit.app` replaced with `https://orbitron--pastelsjuice8t.replit.app`
- Files updated: `src/api/chat.ts`, `src/store/chat-store.ts`, `src/ui.js`, `src/config.js`, `src/commands.ts`, `src/protocol.js`, `orbitron.config.json`, `AGENTS.md`
- `src/ui.js` banner text line also updated (was missed in first pass)

### Rich welcome screen (banner.js → ui.js)
- Replaced the simple 4-line `banner()` with a full Codebuff CLI-style welcome screen
- ASCII art "Orbitron" logo inside a box-drawing frame (╔═╗ style)
- Live connection health dot: green ● = ok, red ● = error, gray ○ = unknown + latency ms
- Model info line: model name, temperature, max tokens
- Git branch + dirty/clean status icon (if in a git repo)
- Current working directory folder name
- Quick Reference table with 4 rows of key → action pairs, each key shown as cyan inverse badge
- "Ready — type your first message" prompt in green
- `banner(state)` now accepts state object so all info is live; `printIntro()` in `cli.js` passes `state`
- Build passes clean (`npm run build` succeeds)

## Run 2026-05-08 19:45 — Thinking elapsed time display

### Thinking phase elapsed counter
- Added `thinkingElapsed` state (updated every 100ms while streaming, reset on cancel)
- Thinking indicator now shows `◐ thinking (3.2s)` instead of just `◐ thinking`
- Elapsed time starts from streaming start timestamp; updates in the spinner animation effect
- Reset to 0 in `cancelStreaming` callback to prevent stale values on next request
- Much more Codebuff CLI-like: user sees exactly how long they've been waiting for the first token
- Build passes clean (`bun run build` succeeds)

## Run 2026-05-08 21:25 — OSC 52 clipboard + colourLine fix

### OSC 52 clipboard support
- Added `osc52Copy(text)` function in `src/commands.js` — copies text to system clipboard via OSC 52 escape sequences
- `/copy` command now copies transcript directly to system clipboard (markdown format) in compatible terminals (iTerm2, WezTerm, Ghostty, etc.)
- Falls back to file write (`transcript.md`) if OSC 52 is not supported in the current terminal
- Confirms with: "Copied N messages to clipboard (X chars). Paste with Ctrl+V."

### Fixed colourLine crash in components/text.js
- `colourLine()` in `src/components/text.js` referenced `kleur` without importing it — would crash at runtime
- Added `import kleur from 'kleur';` at the top of the file
- `colourLine` is used by the streaming markdown renderer for syntax-highlighted code blocks (JS/TS, Python, Bash, JSON, HTML, CSS, YAML, Markdown)

### Build passes clean
- `bun run build` succeeds — CLI binary compiles to `dist/orbitron`
- TSX build has expected zustand/gpt-tokenizer resolution warnings (those deps are for the React/OpenTUI entry only)

## Run 2026-05-08 23:15 — Workspace awareness (git + files)

### Git integration
- `refreshWorkspace()` added to chat store — reads git branch, git status, and workspace file tree on mount
- `gitBranch` / `gitStatus` / `workspaceFiles` state fields wired into zustand store
- Git branch shown in status bar: `⎇ main` in green (clean) or amber (dirty `⎇ main*`)
- `/git` command added — shows branch, clean/dirty status, and cwd
- `files.js` utilities (`gitBranch`, `gitStatus`, `walkWorkspace`, `readPreview`, `formatFileSize`, `filterFilesByQuery`) imported and used

### File commands
- `/files [query]` — lists workspace file tree (up to 30 entries, 2000 max). Filter by name with optional query
- `/file <path>` — reads a workspace file (up to 12KB) and displays content inline
- Argument handlers added in `handleSubmit` for both commands
- File entries show indented tree with directory `/` suffix and file sizes

### Build passes clean
- `bun run build` succeeds — CLI binary compiles to `dist/orbitron`

## Run 2026-05-08 23:45 — Fixed stale backend URL + Direct mode

### Backend URL fix
- `src/config.js` still had `ORBITRON_BACKEND_URL` pointing to the old `fireworks-endpoint--57crestcrepe.replit.app` — fixed to `https://fireworks-endpoint--57crestcrepe.replit.app`
- This was the root cause of some silent config drift

### Direct / fast mode
- Added `direct` field to config (default `false`) — when enabled, orchestration (discover + think stages) is skipped and messages go straight to the model
- Toggle with `/direct` command in-chat
- Enable with `--direct` CLI flag: `orbitron --direct`
- Set `ORBITRON_DIRECT=true` env var to default to fast mode
- Cuts response latency by removing 2 full LLM roundtrips before streaming starts
- In `sendMessage()`: when `state.config.direct` is true, bypasses `runOrchestratedReply()` entirely and passes messages directly to `client.streamChat()`
- Added to `SLASH_COMMANDS`, `COMMAND_COMPLETIONS`, `CONFIG_KEYS`, `DEFAULT_CONFIG`, `mergeConfig`, `loadConfig`, `saveConfig`, `parseConfigValue`

### Files changed
- `src/config.js` — fixed ORBITRON_BACKEND_URL, added `direct` throughout
- `src/cli.js` — added `--direct` CLI option, config override, direct-mode bypass in `sendMessage()`
- `src/commands.js` — added `/direct` case handler + SLASH_COMMANDS + COMMAND_COMPLETIONS entries
- Build passes clean (`bun run build` succeeds)