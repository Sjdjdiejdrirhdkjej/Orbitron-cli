import React, { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { getTheme } from "../theme/index";
import { Button } from "./button";

export interface ThemeOption {
  id: string;
  name: string;
  preview: {
    bg: string;
    fg: string;
    accent: string;
  };
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "dark",
    name: "Dark",
    preview: { bg: "#0f0f0f", fg: "#e0e0e0", accent: "#00cc00" },
  },
  {
    id: "light",
    name: "Light",
    preview: { bg: "#f8f8f8", fg: "#111111", accent: "#007700" },
  },
  {
    id: "ocean",
    name: "Ocean",
    preview: { bg: "#0a1628", fg: "#c8d4e0", accent: "#4ec9b0" },
  },
  {
    id: "forest",
    name: "Forest",
    preview: { bg: "#0d1f0d", fg: "#c8dcc8", accent: "#7cb342" },
  },
  {
    id: "sunset",
    name: "Sunset",
    preview: { bg: "#1a0f0a", fg: "#e8d8c8", accent: "#ff8c42" },
  },
  {
    id: "midnight",
    name: "Midnight",
    preview: { bg: "#0a0a1a", fg: "#d0d0e0", accent: "#7c4dff" },
  },
];

interface ThemePickerProps {
  currentTheme: string;
  onSelect: (themeId: string) => void;
  onClose: () => void;
}

export function ThemePicker({ currentTheme, onSelect, onClose }: ThemePickerProps) {
  const theme = getTheme("dark");
  const [selectedIdx, setSelectedIdx] = useState(() =>
    THEME_OPTIONS.findIndex((t) => t.id === currentTheme)
  );

  useEffect(() => {
    const idx = THEME_OPTIONS.findIndex((t) => t.id === currentTheme);
    if (idx >= 0) setSelectedIdx(idx);
  }, [currentTheme]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(THEME_OPTIONS.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "return") {
        e.preventDefault();
        onSelect(THEME_OPTIONS[selectedIdx].id);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
    };

    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [selectedIdx, onSelect, onClose]);

  const handleClick = useCallback((themeId: string) => {
    onSelect(themeId);
  }, [onSelect]);

  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "rgba(0,0,0,0.6)",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
      }}
    >
      <box
        style={{
          width: 44,
          flexDirection: "column",
          borderStyle: "double",
          borderColor: theme.primary,
          backgroundColor: theme.surface,
        }}
      >
        {/* Header */}
        <box
          style={{
            padding: 1,
            borderStyle: "single",
            borderColor: theme.border,
            border: ["bottom"],
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>
            ◈ Theme
          </text>
        </box>

        {/* Theme list */}
        <box style={{ flexDirection: "column", padding: 1 }}>
          {THEME_OPTIONS.map((opt, idx) => {
            const isSelected = idx === selectedIdx;
            const isActive = opt.id === currentTheme;
            return (
              <Button
                key={opt.id}
                onClick={() => handleClick(opt.id)}
              >
                <box
                  style={{
                    padding: 1,
                    borderStyle: "single",
                    borderColor: isSelected ? theme.primary : "transparent",
                    border: isSelected ? ["left"] : [],
                    flexDirection: "row",
                    alignItems: "center",
                  }}
                >
                  <text
                    style={{
                      fg: isSelected ? theme.primary : theme.muted,
                      marginRight: 1,
                      width: 2,
                    }}
                  >
                    {isSelected ? "▸" : " "}
                  </text>

                  {/* Colour preview swatch */}
                  <box
                    style={{
                      width: 3,
                      height: 1,
                      backgroundColor: opt.preview.bg,
                      borderStyle: "single",
                      borderColor: opt.preview.accent,
                      marginRight: 1,
                    }}
                  >
                    <text style={{ fg: opt.preview.accent }}>●</text>
                  </box>

                  <text
                    style={{
                      fg: isSelected ? theme.foreground : theme.muted,
                      attributes: isSelected ? TextAttributes.BOLD : undefined,
                      width: 12,
                    }}
                  >
                    {opt.name}
                  </text>

                  {isActive && (
                    <text style={{ fg: theme.success, marginLeft: 1 }}>✓ active</text>
                  )}
                </box>
              </Button>
            );
          })}
        </box>

        {/* Footer */}
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
    </box>
  );
}
