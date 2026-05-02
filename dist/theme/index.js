"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTheme = getTheme;
exports.useTheme = useTheme;
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
function getTheme(name) {
    return name === "light" ? LIGHT : DARK;
}
function useTheme(themeName = "dark") {
    return getTheme(themeName);
}
