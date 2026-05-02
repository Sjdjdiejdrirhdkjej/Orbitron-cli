import React, { useCallback, useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { useChatStore } from "../store/chat-store";
import { getTheme } from "../theme/index";

interface Props {}

export function ApiKeyScreen(_props: Props) {
  const theme = getTheme("dark");
  const envApiKey = process.env.ORBITRON_API_KEY?.trim() || "";
  const baseUrl = useChatStore((s) => s.config.baseUrl);
  const backendHealth = useChatStore((s) => s.backendHealth);
  const backendLatencyMs = useChatStore((s) => s.backendLatencyMs);
  const checkHealth = useChatStore((s) => s.checkHealth);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const setConfig = useChatStore((s) => s.setConfig);
  const setScreen = useChatStore((s) => s.setScreen);

  useEffect(() => {
    if (!envApiKey) {
      checkHealth();
    }
  }, [checkHealth, envApiKey]);

  useEffect(() => {
    if (!envApiKey) return;
    setConfig({ apiKey: envApiKey });
    setScreen("chat");
  }, [envApiKey, setConfig, setScreen]);

  const handleSubmit = useCallback(
    (valueOrEvent: unknown) => {
      const rawValue =
        typeof valueOrEvent === "string"
          ? valueOrEvent
          : typeof valueOrEvent === "object" && valueOrEvent !== null && "value" in valueOrEvent && typeof (valueOrEvent as { value?: unknown }).value === "string"
            ? (valueOrEvent as { value: string }).value
            : input;
      const key = String(rawValue ?? "").trim();
      setError("");
      setConfig({ apiKey: key });
      setScreen("chat");
    },
    [input, setConfig, setScreen],
  );

  if (envApiKey) return null;

  const cleanBaseUrl = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const healthDot = backendHealth === "ok" ? "●" : backendHealth === "error" ? "●" : "○";
  const healthColour = backendHealth === "ok" ? theme.success : backendHealth === "error" ? theme.error : theme.muted;
  const healthLabel = backendHealth === "ok" ? (backendLatencyMs != null ? `${backendLatencyMs}ms` : "connected") : backendHealth === "error" ? "backend unavailable" : "checking…";

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: theme.surface,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 1,
      }}
    >
      <box
        style={{
          width: 64,
          flexDirection: "column",
          borderStyle: "double",
          borderColor: theme.primary,
          backgroundColor: theme.background,
        }}
      >
        <box
          style={{
            flexDirection: "column",
            alignItems: "center",
            paddingTop: 1,
            paddingBottom: 1,
            borderStyle: "single",
            borderColor: theme.border,
            border: ["bottom"],
          }}
        >
          <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>╔═ Orbitron ═╗</text>
          <text style={{ fg: theme.muted }}>Orbitron starts straight in chat</text>
          <box style={{ flexDirection: "row", alignItems: "center" }}>
            <text style={{ fg: healthColour }}>{healthDot}</text>
            <text style={{ fg: healthColour, marginLeft: 1 }}>{healthLabel}</text>
          </box>
          <text style={{ fg: theme.muted }}>Pinned backend: {cleanBaseUrl}</text>
        </box>

        <box
          style={{
            flexDirection: "column",
            padding: 2,
          }}
        >
          <text style={{ fg: theme.foreground, attributes: TextAttributes.BOLD }}>
            Optional access token
          </text>
          <text style={{ fg: theme.muted, marginTop: 1 }}>
            Leave this blank to continue against the pinned Orbitron backend. If you need an override token, enter it here.
          </text>

          <box
            style={{
              marginTop: 2,
              padding: 1,
              flexDirection: "column",
              borderStyle: "single",
              borderColor: error ? theme.error : theme.border,
            }}
          >
            <text style={{ fg: theme.muted }}>Access token</text>
            <input
              focused={true}
              value={input}
              placeholder="Press Enter to continue"
              onChange={(value) => setInput(value)}
              onSubmit={handleSubmit}
            />
          </box>

          {error && (
            <text style={{ fg: theme.error, marginTop: 1 }}>
              ✗ {error}
            </text>
          )}

          <box
            style={{
              marginTop: 2,
              padding: 1,
              flexDirection: "column",
              borderStyle: "single",
              borderColor: theme.border,
            }}
          >
            <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>What happens next</text>
            <text style={{ fg: theme.foreground, marginTop: 1 }}>1. Press Enter to continue, with or without a token.</text>
            <text style={{ fg: theme.foreground }}>2. The chat screen opens against {cleanBaseUrl}.</text>
            <text style={{ fg: theme.foreground }}>3. Use /models, /status, or /set inside chat to adjust the session.</text>
          </box>

          <box
            style={{
              marginTop: 2,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <text style={{ fg: theme.muted }}>Enter continues · blank is fine</text>
            <text style={{ fg: theme.muted }}>Pinned backend first</text>
          </box>
        </box>
      </box>
    </box>
  );
}
