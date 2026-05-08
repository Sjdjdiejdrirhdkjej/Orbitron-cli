import React, { useState, useEffect, useCallback, useRef } from "react";
import { TextAttributes } from "@opentui/core";
import { getTheme } from "../theme/index";
import { SLASH_COMMANDS, findSlashCommands, type SlashCommand } from "../lib/commands";
import { Button } from "./button";

interface SlashSuggestionsProps {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export function SlashSuggestions({ query, onSelect, onClose }: SlashSuggestionsProps) {
  const theme = getTheme("dark");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [items, setItems] = useState<SlashCommand[]>([]);
  const containerRef = useRef<any>(null);

  useEffect(() => {
    const filtered = findSlashCommands(query);
    setItems(filtered);
    setSelectedIdx(0);
  }, [query]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (items.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "return") {
        e.preventDefault();
        e.stopPropagation();
        if (items[selectedIdx]) {
          onSelect(items[selectedIdx]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
    };

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [items, selectedIdx, onSelect, onClose]);

  const handleClick = useCallback((cmd: SlashCommand) => {
    onSelect(cmd);
  }, [onSelect]);

  if (items.length === 0) return null;

  const maxVisible = Math.min(items.length, 8);

  return (
    <box
      ref={containerRef}
      style={{
        position: "absolute",
        bottom: 3,
        left: 2,
        width: 50,
        flexDirection: "column",
        borderStyle: "single",
        borderColor: theme.border,
        backgroundColor: theme.surface,
        zIndex: 10,
      }}
    >
      <box
        style={{
          padding: 1,
          borderStyle: "single",
          borderColor: theme.border,
          border: ["bottom"],
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>/</text>
        <text style={{ fg: theme.muted, marginLeft: 1 }}>commands</text>
        <text style={{ fg: theme.muted, marginLeft: 2 }}>({items.length})</text>
      </box>

      <box style={{ flexDirection: "column", maxHeight: maxVisible + 2 }}>
        {items.map((cmd, idx) => (
          <Button
            key={cmd.name}
            onClick={() => handleClick(cmd)}
          >
            <box
              style={{
                padding: 1,
                borderStyle: "single",
                borderColor: idx === selectedIdx ? theme.primary : "transparent",
                border: idx === selectedIdx ? ["left"] : [],
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <text
                style={{
                  fg: idx === selectedIdx ? theme.primary : theme.muted,
                  marginRight: 1,
                  width: 2,
                }}
              >
                {idx === selectedIdx ? "▸" : " "}
              </text>
              <text
                style={{
                  fg: theme.primary,
                  attributes: idx === selectedIdx ? TextAttributes.BOLD : undefined,
                  width: 14,
                }}
              >
                {cmd.aliases[0]}
              </text>
              <text
                style={{
                  fg: theme.muted,
                  marginLeft: 1,
                  wrapMode: "word",
                }}
              >
                {cmd.description}
              </text>
            </box>
          </Button>
        ))}
      </box>

      <box
        style={{
          padding: 1,
          borderStyle: "single",
          borderColor: theme.border,
          border: ["top"],
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <text style={{ fg: theme.muted }}>↑↓ nav · ↵ select · Esc close</text>
      </box>
    </box>
  );
}
