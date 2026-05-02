# OpenTUI

A terminal chat TUI powered by OpenTUI and React.

## Install

```bash
npm install
```

## Run

```bash
bun run dev
# or
node bin/opentron
```

## Build

The app uses OpenTUI (`@opentui/core` + `@opentui/react`) with React for the UI layer.

- `src/main.tsx` — entry point, creates the OpenTUI renderer and mounts the React app
- `src/App.tsx` — root component, routes between screens
- `src/screens/` — chat screen, model picker, and legacy API key screen kept for reference
- `src/store/chat-store.ts` — Zustand store for app state
- `src/theme/index.ts` — terminal colour theme
- `src/api/chat.ts` — chat API client (streaming, model discovery)
