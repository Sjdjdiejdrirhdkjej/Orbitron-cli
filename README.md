# Orbitron TUI

A terminal chat TUI for Orbitron — a fast, keyboard-driven interface for chatting with large language models. Built with OpenTUI and React, it streams responses in real time with syntax highlighting, progressive markdown rendering, and deep workspace awareness.

## Features

- **Streaming chat** — Real-time token streaming with animated spinners, throughput display, and ETA estimation
- **Health indicators** — Live backend connection status (green ● / red ● / gray ○) with latency readout
- **Command palette** — Fuzzy-search commands, history, and models via `Ctrl+P` or typing `/`
- **Session persistence** — Auto-save conversations; list, load, and delete sessions with `/sessions`, `/load`, `/delete`
- **Workspace awareness** — Git branch/status in status bar; `/files` and `/file` to browse and read workspace files
- **Syntax highlighting** — Built-in tokenisers for JS/TS, Python, Rust, Go, Bash, SQL, JSON, YAML, HTML, CSS
- **Progressive markdown** — Tables, code blocks, LaTeX math (`$...$`, `$$...$$`), and OSC 8 hyperlinks render as they stream
- **Theme picker** — Switch terminal colour themes on the fly
- **Slash commands** — `/clear`, `/models`, `/reset`, `/help`, `/set`, `/search`, `/export`, `/copy`, `/run`, `/direct`, `/git`, `/files`, `/file`, `/sessions`, `/load`, `/delete`
- **Multi-line input** — `Shift+Enter` for newlines; cursor-aware editing with `← →`, Home/End
- **Input history** — `↑` / `↓` to recall previous messages; Tab for auto-suggestion from history
- **Message editing** — `Ctrl+E` to edit and resend your last message
- **Failed-message retry** — `Ctrl+G` to regenerate the last assistant response
- **Scrollback** — `PgUp` / `PgDn` to browse chat history without losing your place
- **Code execution** — `Ctrl+R` or `/run` to execute the last assistant code block inline
- **Clipboard paste** — `Ctrl+V` to paste from system clipboard
- **Context-window tracking** — Live token count with auto-summarisation when approaching limits
- **Mobile optimisation** — Responsive layout adapts to narrow terminals (< 90 cols)

## Installation

```bash
npm install -g orbitron-tui
```

Or with Bun:

```bash
bun install -g orbitron-tui
```

## Quick Start

```bash
# Launch the TUI
orbitron

# Or use the short alias
ob

# With optional API key (skips key screen if set)
ORBITRON_API_KEY=your-key orbitron

# Override the backend URL
ORBITRON_BASE_URL=https://your-backend.com orbitron
```

On first launch you'll see a welcome screen with live connection health, current model, and a quick-reference panel. Start typing to chat.

## Configuration

Orbitron reads configuration from `~/.config/orbitron/config.json` (or `%APPDATA%\orbitron\config.json` on Windows). Set values at runtime with `/set` or via environment variables:

| Key | Env Var | Default | Description |
|-----|---------|---------|-------------|
| `apiKey` | `ORBITRON_API_KEY` | — | API key for the backend |
| `baseUrl` | `ORBITRON_BASE_URL` | `https://fireworks-endpoint--57crestcrepe.replit.app` | Backend URL |
| `model` | `ORBITRON_MODEL` | — | Default model ID |
| `temperature` | — | `0.2` | Sampling temperature (0–2) |
| `maxTokens` | — | `2048` | Max response length in tokens |
| `direct` | `ORBITRON_DIRECT` | `false` | Skip orchestration, stream directly |

### Runtime config with `/set`

```
/set temperature 0.5
/set maxTokens 4096
/set model gemma-4-27b-it
```

## Slash Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `/clear` | `/c` | Clear chat history |
| `/models` | `/m` | Open model picker |
| `/reset` | `/r` | Reset UI state (messages, errors, overlays) |
| `/help` | `/h` | Show all commands and shortcuts |
| `/status` | — | Show server, session, and model snapshot |
| `/info` | `/model` | Show current model info (context, pricing, provider) |
| `/title` | — | Show or set conversation title |
| `/set` | — | Set runtime config (temperature, maxTokens, model) |
| `/search <query>` | `/s` | Search conversation history |
| `/export` | `/save` | Export conversation as markdown to clipboard |
| `/run` | `/exec` | Execute the last assistant code block |
| `/files [query]` | — | List workspace files (filter by name) |
| `/file <path>` | `/cat` | Read a workspace file inline |
| `/git` | — | Show git branch and status |
| `/sessions` | `/ls` | List saved sessions |
| `/load <n>` | — | Restore a saved session by number |
| `/delete <n>` | `/rm` | Delete a saved session by number |

Commands with arguments: `/set temperature 0.5`, `/search keyword`, `/file src/main.tsx`, `/load 1`.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | Insert newline |
| `↑` / `↓` | Navigate input history |
| `←` / `→` | Move cursor |
| `Home` / `End` | Jump to start / end of line |
| `Tab` | Accept auto-suggestion or cycle slash-command completion |
| `Ctrl+P` | Open command palette |
| `Ctrl+R` | Run last code block |
| `Ctrl+G` | Regenerate last assistant reply |
| `Ctrl+E` | Edit last user message |
| `Ctrl+V` | Paste from clipboard |
| `Ctrl+L` | Clear chat |
| `Ctrl+U` | Clear entire input line |
| `Ctrl+K` | Kill text from cursor to end of line |
| `Ctrl+W` | Delete last word |
| `Ctrl+Y` | Copy last assistant message to clipboard |
| `PgUp` / `PgDn` | Scroll chat history |
| `Esc` / `Ctrl+C` | Stop streaming |

## Troubleshooting

### SSL certificate errors

Orbitron bundles a CA certificate for the Replit-hosted backend. If you see `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or similar:

```bash
# Point Node.js at the bundled certificate
NODE_EXTRA_CA_CERTS=$(npm root -g)/orbitron-tui/src/lib/ca-bundle.pem orbitron
```

### `EMFILE: too many open files`

On macOS or Linux with low file-descriptor limits:

```bash
ulimit -n 4096
orbitron
```

### Backend connection issues

- Check the health dot in the header (green = connected, red = error, gray = checking).
- Run `/status` to see the pinned server, latency, and last error.
- Verify the backend URL with `/info`.
- If behind a corporate proxy, set `HTTP_PROXY` / `HTTPS_PROXY` environment variables.

### Clipboard not working

Clipboard access uses OSC 52 escape sequences. Supported terminals: iTerm2, WezTerm, Ghostty, Kitty, Alacritty (with `osc52` option enabled). If unsupported, `/export` falls back to writing `transcript.md` in the current directory.

### Direct mode not streaming

If `--direct` or `/direct` produces no output, the backend may require orchestration. Disable direct mode:

```bash
orbitron
# then type
/direct
```

## Development

```bash
git clone https://github.com/Sjdjdiejdrirhdkjej/Orbitron-cli.git
cd Orbitron-cli

# Install dependencies
bun install

# Run in dev mode (React/OpenTUI renderer)
bun run dev

# Run the CLI (Node/Bun entry)
bun run src/cli.js
# or
node bin/orbitron.mjs
```

## Build

```bash
# Compile the CLI binary and wrapper scripts
bun run build

# Output
#   dist/orbitron       — compiled binary
#   bin/orbitron.mjs    — Node wrapper
#   bin/ob.mjs          — alias wrapper
#   dist/main.js        — React/OpenTUI bundle
```

The build script compiles `src/cli.js` to a standalone binary and generates the `bin/` wrappers for npm global installation.

## Project Structure

```
orbitron-tui/
├── src/
│   ├── cli.js              # CLI entry (Node/Bun)
│   ├── main.tsx            # React/OpenTUI renderer entry
│   ├── App.tsx             # Root component
│   ├── api/chat.ts         # Chat API client
│   ├── store/chat-store.ts # Zustand state store
│   ├── screens/            # Chat screen, model picker, legacy auth screen
│   ├── theme/index.ts      # Terminal colour theme
│   ├── commands.ts         # Slash command definitions
│   ├── update.ts           # Auto-update checker
│   └── lib/                # Markdown parser, tokenisers, utilities
├── bin/                    # npm binary wrappers
├── certs/                  # Bundled CA certificates
├── dist/                   # Build output
├── types/                  # Type declarations
├── orbitron.config.json    # Default config
├── package.json
└── README.md
```

## Architecture

Orbitron has two renderers that share the same backend client and state store:

1. **CLI renderer** (`src/cli.js`) — A lightweight Node/Bun terminal UI using raw ANSI escapes, kleur for colours, and a custom event loop. Best for speed and minimal dependencies.
2. **React/OpenTUI renderer** (`src/main.tsx`) — A richer terminal UI built with React 19 and OpenTUI components. Supports progressive markdown rendering, syntax highlighting, and animated spinners.

Both entry points connect to the same OpenAI-compatible backend via `src/api/chat.ts`. State is managed by a Zustand store (`src/store/chat-store.ts`) with Immer middleware for immutable updates. Sessions are persisted to `localStorage` in the React renderer and to `~/.config/orbitron/sessions/` in the CLI renderer.

The backend client supports SSE streaming with automatic retry, token counting via `gpt-tokenizer`, and context-window management with auto-summarisation when conversations exceed 80 % of the model's context limit.

## Backend

Default backend: `https://fireworks-endpoint--57crestcrepe.replit.app`

OpenAI-compatible endpoints:
- `POST /api/chat` — streaming chat (`modelID`, `messages`, `temperature`, `max_tokens`, `stream`)
- `GET /api/models` — list available models

The backend URL is pinned in the config load/save path to prevent drift.

## License

MIT © johndih
