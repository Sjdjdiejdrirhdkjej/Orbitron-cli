import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

import { BackendClient } from './backend-client.js';
import { ORBITRON_BACKEND_URL, loadConfig, saveConfig } from './config.js';

const h = React.createElement;

function modelId(model) {
  if (typeof model === 'string') return model;
  if (!model || typeof model !== 'object') return '';
  return String(model.id ?? model.name ?? model.model ?? '').trim();
}

function modelLabel(model) {
  const id = modelId(model);
  if (typeof model === 'string') return model;
  if (!model || typeof model !== 'object') return id || 'unknown model';
  const provider = String(model.provider ?? '').trim();
  return provider ? `${id || 'model'} · ${provider}` : (id || 'unknown model');
}

function normaliseModelList(rawModels) {
  if (!Array.isArray(rawModels)) return [];
  return rawModels
    .map((model) => {
      if (typeof model === 'string') return { id: model, name: model };
      if (!model || typeof model !== 'object') return null;
      const id = modelId(model);
      if (!id) return null;
      return { ...model, id, name: String(model.name ?? id) };
    })
    .filter(Boolean);
}

function resolveSelectedModel(models, preferred) {
  const ids = models.map((model) => model.id);
  if (preferred && ids.includes(preferred)) return preferred;
  return ids[0] ?? preferred ?? '';
}

function errorMessage(error) {
  if (!error) return 'Unknown error';
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|unauthor/i.test(message)) return 'Orbitron backend rejected the request.';
  if (/fetch|network|timeout/i.test(message)) return 'Could not reach the Orbitron backend.';
  return message.slice(0, 200);
}

function isAuthFailure(error) {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /401|403|unauthor/i.test(message);
}

function KeyValueLine({ label, value }) {
  return h('text', { fg: '#94a3b8', wrapMode: 'word' }, `${label} ${value}`);
}

function ChatMessage({ message }) {
  const colour =
    message.role === 'user'
      ? '#7dd3fc'
      : message.role === 'assistant'
        ? '#86efac'
        : '#fbbf24';
  const label =
    message.role === 'user'
      ? 'you'
      : message.role === 'assistant'
        ? 'Orbitron'
        : 'system';

  return h(
    'box',
    {
      style: {
        flexDirection: 'column',
        gap: 0,
        marginBottom: 1,
      },
    },
    h('text', { fg: colour }, label),
    h('text', { fg: '#e2e8f0', wrapMode: 'word' }, message.content || ' '),
  );
}

function ChatScreen({
  baseUrl,
  model,
  modelCount,
  status,
  messages,
  draft,
  setDraft,
  inputKey,
  submitDraft,
  sending,
  chatError,
  clearChat,
  refreshModels,
}) {
  const messageNodes = useMemo(
    () => messages.map((message, index) => h(ChatMessage, { key: index, message })),
    [messages],
  );

  return h(
    'box',
    {
      style: {
        width: '100%',
        height: '100%',
        padding: 1,
        flexDirection: 'column',
        backgroundColor: '#0b1020',
      },
    },
    h(
      'box',
      {
        border: true,
        title: 'Orbitron',
        style: {
          width: '100%',
          flexDirection: 'column',
          paddingLeft: 1,
          paddingRight: 1,
          paddingTop: 0,
          paddingBottom: 0,
          flexShrink: 0,
        },
      },
      h(KeyValueLine, { label: 'Model:', value: model || 'unset' }),
      h(KeyValueLine, { label: 'Models:', value: String(modelCount) }),
      h(KeyValueLine, { label: 'Backend:', value: baseUrl }),
      h(KeyValueLine, { label: 'Status:', value: sending ? 'streaming…' : status }),
      h(
        'box',
        {
          style: {
            flexDirection: 'row',
            gap: 2,
            marginTop: 1,
            flexWrap: 'wrap',
          },
        },
        h('text', { fg: '#67e8f9' }, '/clear'),
        h('text', { fg: '#67e8f9' }, '/models'),
        h('text', { fg: '#67e8f9' }, '/model <name>'),
        h('text', { fg: '#67e8f9' }, 'Enter to send'),
        h('text', { fg: '#67e8f9' }, 'Ctrl+C to exit'),
      ),
    ),
    chatError
      ? h(
          'box',
          {
            border: true,
            style: {
              width: '100%',
              marginTop: 1,
              paddingLeft: 1,
              paddingRight: 1,
              flexShrink: 0,
            },
          },
          h('text', { fg: '#fb7185', wrapMode: 'word' }, chatError),
        )
      : null,
    h(
      'scrollbox',
      {
        focused: false,
        style: {
          width: '100%',
          flexGrow: 1,
          marginTop: 1,
          marginBottom: 1,
        },
      },
      ...messageNodes,
    ),
    h(
      'box',
      {
        style: {
          width: '100%',
          flexDirection: 'column',
          flexShrink: 0,
        },
      },
      h('input', {
        key: inputKey,
        focused: true,
        placeholder: 'Ask Orbitron anything…',
        onInput: setDraft,
        onSubmit: submitDraft,
      }),
    ),
    h(
      'box',
      {
        style: {
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 1,
          flexShrink: 0,
        },
      },
      h('text', { fg: '#64748b' }, 'Powered by OpenTUI'),
      h('text', { fg: '#64748b' }, draft ? `${draft.length} chars` : ' '),
    ),
  );
}

function App() {
  const [config, setConfig] = useState(() => loadConfig());
  const clientRef = useRef(new BackendClient(config));
  const [status, setStatus] = useState('Orbitron ready · pinned backend');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Ready when you are. Orbitron starts directly in chat, and the backend is pinned.',
    },
  ]);
  const [draft, setDraft] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(config.model);

  const baseUrl = ORBITRON_BACKEND_URL;

  useEffect(() => {
    clientRef.current.updateConfig({ ...config, baseUrl });
  }, [config, baseUrl]);

  const applyModelList = useCallback(
    (rawModels) => {
      const nextModels = normaliseModelList(rawModels);
      setModels(nextModels);
      setSelectedModel((current) => resolveSelectedModel(nextModels, current || config.model));
      return nextModels;
    },
    [config.model],
  );

  const refreshModels = useCallback(async () => {
    setStatus('Loading Orbitron models…');
    try {
      const rawModels = await clientRef.current.listModels();
      applyModelList(rawModels);
      setStatus(`Connected · ${rawModels.length} models`);
      setChatError('');
    } catch (error) {
      setStatus('Orbitron backend unavailable');
      setChatError(errorMessage(error));
    }
  }, [applyModelList]);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  const runCommand = useCallback(
    async (command) => {
      const text = command.trim();
      if (!text) return;

      if (text === '/clear') {
        setMessages([
          {
            role: 'assistant',
            content: 'Conversation cleared. Ready for the next prompt.',
          },
        ]);
        setStatus('Conversation cleared');
        return;
      }

      if (text === '/models') {
        await refreshModels();
        return;
      }

      if (text.startsWith('/model ')) {
        const requested = text.slice(7).trim();
        if (!requested) {
          setChatError('Usage: /model <name>');
          return;
        }
        setSelectedModel(requested);
        setStatus(`Model set to ${requested}`);
        return;
      }

      if (text === '/help') {
        setChatError('Commands: /clear, /models, /model <name>');
        return;
      }

      if (text === '/backend') {
        setChatError(`Orbitron is pinned to ${baseUrl}. Use /status for health and /models for the picker.`);
        return;
      }

      setChatError(`Unknown command: ${text}`);
    },
    [baseUrl, refreshModels],
  );

  const sendDraft = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;

    if (text.startsWith('/')) {
      setDraft('');
      setInputKey((value) => value + 1);
      await runCommand(text);
      return;
    }

    const userMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    const assistantIndex = nextMessages.length;
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setDraft('');
    setInputKey((value) => value + 1);
    setSending(true);
    setChatError('');
    setStatus(`Streaming with ${selectedModel || config.model}`);

    let assistantText = '';

    try {
      for await (const token of clientRef.current.streamChat(nextMessages, {
        model: selectedModel || config.model,
      })) {
        assistantText += token;
        setMessages((prev) => {
          const next = [...prev];
          if (next[assistantIndex]) {
            next[assistantIndex] = {
              ...next[assistantIndex],
              content: assistantText,
            };
          }
          return next;
        });
      }

      setMessages((prev) => {
        const next = [...prev];
        if (next[assistantIndex] && !next[assistantIndex].content) {
          next[assistantIndex] = {
            ...next[assistantIndex],
            content: '(no response)',
          };
        }
        return next;
      });
      setStatus('Reply received');
    } catch (error) {
      const message = errorMessage(error);
      setChatError(message);
      setStatus('Request failed');
      setMessages((prev) => {
        const next = [...prev];
        if (next[assistantIndex]) {
          next[assistantIndex] = {
            role: 'assistant',
            content: `Error: ${message}`,
          };
        }
        return next;
      });
      if (isAuthFailure(error)) {
        setChatError('Orbitron backend rejected the request. Check the pinned endpoint configuration.');
      }
    } finally {
      setSending(false);
    }
  }, [config.model, draft, messages, runCommand, selectedModel, sending]);

  const chatView = useMemo(
    () =>
      h(ChatScreen, {
        baseUrl,
        model: selectedModel || config.model,
        modelCount: models.length,
        status,
        messages,
        draft,
        setDraft,
        inputKey,
        submitDraft: sendDraft,
        sending,
        chatError,
        clearChat: () => {
          setMessages([
            {
              role: 'assistant',
              content: 'Conversation cleared. Ready for the next prompt.',
            },
          ]);
          setStatus('Conversation cleared');
        },
        refreshModels,
      }),
    [baseUrl, chatError, config.model, draft, inputKey, messages, models.length, refreshModels, selectedModel, sendDraft, sending, status],
  );

  return h(
    'box',
    {
      style: {
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: '#0b1020',
      },
    },
    chatView,
  );
}

async function main() {
  const renderer = await createCliRenderer({
    root: createRoot,
    app: h(App),
  });
  renderer.start();
}

void main();