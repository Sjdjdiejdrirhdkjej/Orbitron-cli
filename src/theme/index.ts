const DARK = {
  background: "#0f0f0f",
  surface: "#1a1a1a",
  foreground: "#e0e0e0",
  muted: "#666666",
  primary: "#00cc00",
  secondary: "#888888",
  error: "#ff4444",
  success: "#00cc00",
  warning: "#ffaa00",
  info: "#4488ff",
  border: "#333333",
};

const LIGHT = {
  background: "#f8f8f8",
  surface: "#ffffff",
  foreground: "#111111",
  muted: "#999999",
  primary: "#007700",
  secondary: "#666666",
  error: "#cc0000",
  success: "#007700",
  warning: "#cc6600",
  info: "#0044cc",
  border: "#dddddd",
};

const OCEAN = {
  background: "#0a1628",
  surface: "#0f1d33",
  foreground: "#c8d4e0",
  muted: "#5a6a7a",
  primary: "#4ec9b0",
  secondary: "#6a8aaa",
  error: "#ff6b6b",
  success: "#4ec9b0",
  warning: "#ffd166",
  info: "#5e81ac",
  border: "#1a2d4a",
};

const FOREST = {
  background: "#0d1f0d",
  surface: "#122a12",
  foreground: "#c8dcc8",
  muted: "#5a7a5a",
  primary: "#7cb342",
  secondary: "#6a8a6a",
  error: "#ef5350",
  success: "#7cb342",
  warning: "#ffa726",
  info: "#42a5f5",
  border: "#1a3a1a",
};

const SUNSET = {
  background: "#1a0f0a",
  surface: "#261810",
  foreground: "#e8d8c8",
  muted: "#8a7a6a",
  primary: "#ff8c42",
  secondary: "#aa8877",
  error: "#ff5252",
  success: "#69f0ae",
  warning: "#ffd740",
  info: "#82b1ff",
  border: "#3a2a1a",
};

const MIDNIGHT = {
  background: "#0a0a1a",
  surface: "#101028",
  foreground: "#d0d0e0",
  muted: "#5a5a7a",
  primary: "#7c4dff",
  secondary: "#7a6aaa",
  error: "#ff4081",
  success: "#69f0ae",
  warning: "#ffd740",
  info: "#448aff",
  border: "#1a1a3a",
};

export type Theme = typeof DARK;

const THEMES: Record<string, Theme> = {
  dark: DARK,
  light: LIGHT,
  ocean: OCEAN,
  forest: FOREST,
  sunset: SUNSET,
  midnight: MIDNIGHT,
};

export const THEME_NAMES = Object.keys(THEMES);

export function getTheme(name: string): Theme {
  return THEMES[name] || DARK;
}

export function useTheme(themeName = "dark"): Theme {
  return getTheme(themeName);
}