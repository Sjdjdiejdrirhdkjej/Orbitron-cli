import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { TextAttributes } from "@opentui/core";
import { useChatStore } from "../store/chat-store";
import type { ModelInfo } from "../store/chat-store";
import { getTheme } from "../theme/index";
import { listModels } from "../api/chat";
import { getDisplayName } from "../lib/model-names";

interface Props {}

function getTerminalColumns(): number {
  try {
    return typeof process !== "undefined" && process.stdout && process.stdout.columns
      ? (process.stdout.columns as number)
      : Infinity;
  } catch {
    return Infinity;
  }
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function getContextLabel(model: ModelInfo): string | null {
  if (!model.context_window) return null;
  return model.context_window >= 1000
    ? `${(model.context_window / 1000).toFixed(0)}k ctx`
    : `${model.context_window} ctx`;
}

function getPriceLabel(model: ModelInfo): string | null {
  const inputPrice = model.pricing?.input_per_million;
  const outputPrice = model.pricing?.output_per_million;
  if (!inputPrice && !outputPrice) return null;
  return `$${inputPrice ?? "?"}/M in · $${outputPrice ?? "?"}/M out`;
}

function matchesModel(query: string, model: ModelInfo): boolean {
  if (!query) return true;
  const haystack = [model.id, model.name, model.provider, getDisplayName(model.id)].filter(Boolean).join(" ");
  return fuzzyMatch(query, haystack);
}

export function ModelPicker(_props: Props) {
  const theme = getTheme("dark");
  const showModelPicker = useChatStore((s) => s.showModelPicker);
  const setShowModelPicker = useChatStore((s) => s.setShowModelPicker);
  const availableModels = useChatStore((s) => s.availableModels);
  const setAvailableModels = useChatStore((s) => s.setAvailableModels);
  const config = useChatStore((s) => s.config);
  const setConfig = useChatStore((s) => s.setConfig);

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const filteredModels = useMemo(() => {
    const query = search.trim();
    const models = query
      ? availableModels.filter((m) => matchesModel(query, m))
      : availableModels;

    return [...models].sort((a, b) => {
      const aCurrent = a.id === config.model;
      const bCurrent = b.id === config.model;
      if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
      return getDisplayName(a.id).localeCompare(getDisplayName(b.id));
    });
  }, [availableModels, config.model, search]);

  const selectedModel = filteredModels[selectedIdx] ?? filteredModels[0] ?? null;

  useEffect(() => {
    if (!showModelPicker) return;
    setSearch("");
    setError("");
    const currentIdx = availableModels.findIndex((m) => m.id === config.model);
    setSelectedIdx(currentIdx >= 0 ? currentIdx : 0);
    if (availableModels.length > 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    listModels(config.baseUrl)
      .then((models) => {
        setAvailableModels(models);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [showModelPicker, availableModels, config.baseUrl, config.model, setAvailableModels]);

  useEffect(() => {
    if (!showModelPicker) return;
    setSelectedIdx((prev) => {
      if (filteredModels.length === 0) return 0;
      return Math.min(prev, filteredModels.length - 1);
    });
  }, [showModelPicker, filteredModels.length]);

  const handleSelect = useCallback(
    (modelId: string) => {
      setConfig({ model: modelId });
      setShowModelPicker(false);
      setSearch("");
    },
    [setConfig, setShowModelPicker],
  );

  const handleClose = useCallback(() => {
    setShowModelPicker(false);
    setSearch("");
  }, [setShowModelPicker]);

  useKeyboard(
    useCallback(
      (key: { name: string; ctrl: boolean; meta: boolean; shift: boolean; sequence: string; preventDefault?: () => void }) => {
        if (!showModelPicker) return;

        const seq = key.sequence || key.name;
        const isPrintable = seq && seq.length === 1 && !key.ctrl && !key.meta;

        if (key.name === "escape" || (key.ctrl && key.name === "c")) {
          key.preventDefault?.();
          if (search) {
            setSearch("");
          } else {
            handleClose();
          }
          return;
        }

        if (key.name === "home") {
          key.preventDefault?.();
          setSelectedIdx(0);
          return;
        }

        if (key.name === "end") {
          key.preventDefault?.();
          setSelectedIdx(Math.max(0, filteredModels.length - 1));
          return;
        }

        if (key.name === "up" || key.name === "k") {
          key.preventDefault?.();
          setSelectedIdx((prev) => Math.max(0, prev - 1));
          return;
        }

        if (key.name === "down" || key.name === "j") {
          key.preventDefault?.();
          setSelectedIdx((prev) => Math.min(filteredModels.length - 1, prev + 1));
          return;
        }

        if (key.name === "pageup" || key.name === "PageUp") {
          key.preventDefault?.();
          setSelectedIdx((prev) => Math.max(0, prev - 6));
          return;
        }

        if (key.name === "pagedown" || key.name === "PageDown") {
          key.preventDefault?.();
          setSelectedIdx((prev) => Math.min(filteredModels.length - 1, prev + 6));
          return;
        }

        if (key.name === "return" || key.name === "enter") {
          key.preventDefault?.();
          if (filteredModels[selectedIdx]) {
            handleSelect(filteredModels[selectedIdx].id);
          }
          return;
        }

        if (key.name === "backspace") {
          key.preventDefault?.();
          if (search.length > 0) {
            setSearch((s) => s.slice(0, -1));
            setSelectedIdx(0);
          } else {
            handleClose();
          }
          return;
        }

        if (isPrintable && /[a-zA-Z0-9 _\-.]/.test(seq)) {
          key.preventDefault?.();
          setSearch((s) => s + seq);
          setSelectedIdx(0);
          return;
        }
      },
      [showModelPicker, filteredModels, selectedIdx, handleSelect, handleClose, search],
    ),
  );

  if (!showModelPicker) return null;

  const cols = getTerminalColumns();
  const isMobile = cols < 90;
  const modalWidth = isMobile
    ? Math.min(44, Math.max(34, availableModels.length > 0 ? 38 : 34))
    : Math.min(58, Math.max(36, availableModels.length > 0 ? 44 : 36));

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
      }}
    >
      <box
        style={{
          width: modalWidth,
          flexDirection: "column",
          borderStyle: "double",
          borderColor: theme.primary,
          backgroundColor: theme.surface,
        }}
      >
        <box
          style={{
            flexDirection: "row",
            padding: 1,
            borderStyle: "single",
            borderColor: theme.border,
            border: ["bottom"],
          }}
        >
          <text style={{ fg: theme.primary, attributes: TextAttributes.BOLD }}>◈ Models</text>
          <text style={{ fg: theme.muted, marginLeft: 2 }}>
            {loading ? "loading…" : `${availableModels.length} total`}
          </text>
          {search && (
            <text style={{ fg: theme.info, marginLeft: 2 }}>· {filteredModels.length} match{filteredModels.length === 1 ? "" : "es"}</text>
          )}
        </box>

        <box
          style={{
            padding: 1,
            borderStyle: "single",
            borderColor: search ? theme.primary : theme.border,
            border: ["bottom"],
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <text style={{ fg: theme.muted }}>filter:</text>
          <text style={{ fg: theme.foreground, marginLeft: 1 }}>{search || "type to filter by name, id, or provider"}</text>
        </box>

        {error && (
          <box style={{ padding: 1 }}>
            <text style={{ fg: theme.error }}>✗ {error}</text>
          </box>
        )}

        <box
          style={{
            flexDirection: "column",
            maxHeight: 14,
            padding: 0,
          }}
        >
          {loading ? (
            <box style={{ padding: 1 }}>
              <text style={{ fg: theme.muted }}>Fetching models…</text>
            </box>
          ) : filteredModels.length === 0 ? (
            <box style={{ padding: 1 }}>
              <text style={{ fg: theme.muted }}>No models match "{search}"</text>
            </box>
          ) : (
            filteredModels.map((model, idx) => {
              const isSelected = idx === selectedIdx;
              const isCurrent = model.id === config.model;
              const contextLabel = getContextLabel(model);
              const priceLabel = getPriceLabel(model);

              return (
                <box
                  key={model.id}
                  style={{
                    padding: 1,
                    borderStyle: "single",
                    borderColor: isSelected ? theme.primary : "transparent",
                    border: isSelected ? ["left"] : [],
                  }}
                >
                  <text style={{ fg: isSelected ? theme.primary : theme.foreground }}>{isSelected ? "▸" : " "}</text>
                  <text
                    style={{
                      fg: isCurrent ? theme.success : isSelected ? theme.primary : theme.foreground,
                      marginLeft: 1,
                    }}
                  >
                    {getDisplayName(model.id)}
                  </text>
                  {contextLabel && <text style={{ fg: theme.muted, marginLeft: 2 }}>· {contextLabel}</text>}
                  {priceLabel && <text style={{ fg: theme.muted, marginLeft: 2 }}>· {priceLabel}</text>}
                  {isCurrent && <text style={{ fg: theme.success, marginLeft: 2 }}>✓ current</text>}
                </box>
              );
            })
          )}
        </box>

        {selectedModel && !loading && (
          <box
            style={{
              padding: 1,
              borderStyle: "single",
              borderColor: theme.border,
              border: ["top"],
              flexDirection: "column",
            }}
          >
            <box style={{ flexDirection: "row", alignItems: "center" }}>
              <text style={{ fg: theme.foreground, attributes: TextAttributes.BOLD }}>{getDisplayName(selectedModel.id)}</text>
              {selectedModel.id === config.model && <text style={{ fg: theme.success, marginLeft: 1 }}>current</text>}
            </box>
            <text style={{ fg: theme.muted }}>ID: {selectedModel.id}</text>
            {selectedModel.provider && <text style={{ fg: theme.muted }}>Provider: {selectedModel.provider}</text>}
            <text style={{ fg: theme.muted }}>Context: {getContextLabel(selectedModel) ?? "unknown"}</text>
            <text style={{ fg: theme.muted }}>Pricing: {getPriceLabel(selectedModel) ?? "not listed"}</text>
          </box>
        )}

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
          <text style={{ fg: theme.muted }}>
            {isMobile ? "↑↓ nav · ↵ select · Esc close" : "↑↓ nav · Home/End jump · type to filter · ↵ select · Esc close"}
          </text>
          <text style={{ fg: theme.muted }}>
            current: {getDisplayName(config.model)}
          </text>
        </box>
      </box>
    </box>
  );
}
