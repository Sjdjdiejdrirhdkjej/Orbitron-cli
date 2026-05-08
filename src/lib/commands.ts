import { useChatStore } from "../store/chat-store";
import { getDisplayName } from "./model-names";

export interface SlashCommand {
  name: string;
  description: string;
  aliases: string[];
  handler: () => void;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "theme",
    description: "Open the theme picker",
    aliases: ["/theme", "/t"],
    handler: () => {
      useChatStore.getState().setShowThemePicker(true);
    },
  },
  {
    name: "help",
    description: "Show available commands and shortcuts",
    aliases: ["/help", "/h", "/?"],
    handler: () => {
      const store = useChatStore.getState();
      const lines = [
        "Available commands",
        ...SLASH_COMMANDS
          .filter((c) => c.name !== "help")
          .map((c) => `  ${c.aliases.join(" · ").padEnd(20)} ${c.description}`),
        "",
        "Keyboard shortcuts",
        "  Enter            send message",
        "  Shift+Enter      newline",
        "  ↑ / ↓            input history",
        "  Tab              accept suggestion",
        "  Ctrl+P           command palette",
        "  Ctrl+R           run last code block",
        "  Ctrl+G           regenerate last reply",
        "  Ctrl+V           paste",
        "  Ctrl+L           clear chat",
        "  Esc / Ctrl+C     stop streaming",
      ];
      store.addMessage({ role: "assistant", content: lines.join("\n") });
    },
  },
  {
    name: "new",
    description: "Start a new chat",
    aliases: ["/new", "/n"],
    handler: () => {
      const store = useChatStore.getState();
      store.clearMessages();
      store.setLastError("");
      store.setStatus("New chat started");
      store.setShowModelPicker(false);
      store.setInputHistoryIndex(-1);
    },
  },
  {
    name: "clear",
    description: "Clear chat history",
    aliases: ["/clear", "/c"],
    handler: () => {
      useChatStore.getState().clearMessages();
    },
  },
  {
    name: "model",
    description: "Open the model picker",
    aliases: ["/model", "/m", "/models"],
    handler: () => {
      useChatStore.getState().setShowModelPicker(true);
    },
  },
  {
    name: "exit",
    description: "Quit Orbitron",
    aliases: ["/exit", "/quit", "/q"],
    handler: () => {
      process.exit(0);
    },
  },
];

export function findSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter((cmd) =>
    cmd.aliases.some((a) => a.toLowerCase().includes(q)) ||
    cmd.name.toLowerCase().includes(q) ||
    cmd.description.toLowerCase().includes(q)
  );
}

export function matchSlashCommand(input: string): SlashCommand | null {
  const trimmed = input.trim().toLowerCase();
  for (const cmd of SLASH_COMMANDS) {
    for (const alias of cmd.aliases) {
      if (trimmed === alias.toLowerCase()) return cmd;
      const rest = trimmed.slice(alias.toLowerCase().length).trim();
      if (trimmed.startsWith(alias.toLowerCase() + " ") || trimmed.startsWith(alias.toLowerCase() + "\t")) {
        return cmd;
      }
    }
  }
  return null;
}

export function getSlashCommandHint(input: string): { alias: string; description: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const head = trimmed.split(/\s+/)[0].toLowerCase();
  const matches = SLASH_COMMANDS.flatMap((cmd) =>
    cmd.aliases.map((alias) => ({ cmd, alias }))
  )
    .filter(({ alias }) => alias.toLowerCase().startsWith(head))
    .sort((a, b) => a.alias.length - b.alias.length);
  const best = matches[0];
  return best ? { alias: best.alias, description: best.cmd.description } : null;
}
