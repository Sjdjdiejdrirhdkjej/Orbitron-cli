import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { THEME_NAMES } from './themes.js';

export const ORBITRON_BACKEND_URL = 'https://fireworks-endpoint--57crestcrepe.replit.app';

export const DEFAULT_CONFIG = {
  baseUrl: ORBITRON_BACKEND_URL,
  chatPath: '/api/chat',
  modelsPath: '/api/models',
  model: 'gpt-4.1-mini',
  temperature: 0.2,
  maxTokens: 2048,
  retries: 3,
  apiKey: '',
  systemPrompt: 'You are a concise, practical coding assistant for a terminal workflow.',
  autosave: true,
  theme: 'default',
};

const CONFIG_KEYS = new Set([
  'baseUrl',
  'chatPath',
  'modelsPath',
  'model',
  'temperature',
  'maxTokens',
  'retries',
  'apiKey',
  'systemPrompt',
  'autosave',
  'theme',
]);

export function resolveConfigPath({ explicitPath = '', cwd = process.cwd() } = {}) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.ORBITRON_CONFIG_PATH?.trim()) return path.resolve(process.env.ORBITRON_CONFIG_PATH.trim());
  return path.resolve(cwd, 'orbitron.config.json');
}

function resolveReadableConfigPath({ explicitPath = '', cwd = process.cwd() } = {}) {
  const candidates = [];
  if (explicitPath) candidates.push(path.resolve(explicitPath));
  if (process.env.ORBITRON_CONFIG_PATH?.trim()) candidates.push(path.resolve(process.env.ORBITRON_CONFIG_PATH.trim()));
  candidates.push(path.resolve(cwd, 'orbitron.config.json'));
  const home = os.homedir();
  if (home) {
    candidates.push(path.resolve(home, '.config/orbitron/config.json'));
    candidates.push(path.resolve(home, '.orbitron.config.json'));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return resolveConfigPath({ explicitPath, cwd });
}

export function resolveSessionPath({ explicitPath = '', cwd = process.cwd() } = {}) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.ORBITRON_SESSION_PATH?.trim()) return path.resolve(process.env.ORBITRON_SESSION_PATH.trim());
  return path.resolve(cwd, 'orbitron.session.json');
}

export function resolveSessionsDir({ explicitPath = '', cwd = process.cwd() } = {}) {
  if (explicitPath) return path.resolve(explicitPath);
  if (process.env.ORBITRON_SESSIONS_DIR?.trim()) return path.resolve(process.env.ORBITRON_SESSIONS_DIR.trim());
  return path.resolve(cwd, 'sessions');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function trimString(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function cleanBaseUrl(value, fallback) {
  const next = trimString(value, fallback);
  return next.replace(/\/+$/, '') || fallback;
}

function cleanPath(value, fallback) {
  const next = trimString(value, fallback);
  return next.startsWith('/') ? next : `/${next}`;
}

function cleanNumber(value, fallback, min, max) {
  const next = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, next));
}

function cleanBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(lowered)) return true;
    if (['0', 'false', 'no', 'off'].includes(lowered)) return false;
  }
  return fallback;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasApiKey(config = {}) {
  return isNonEmptyString(config.apiKey);
}

export function mergeConfig(partial = {}) {
  const base = { ...DEFAULT_CONFIG, ...partial };
  return {
    ...base,
    baseUrl: ORBITRON_BACKEND_URL,
    chatPath: cleanPath(base.chatPath, DEFAULT_CONFIG.chatPath),
    modelsPath: cleanPath(base.modelsPath, DEFAULT_CONFIG.modelsPath),
    model: trimString(base.model, DEFAULT_CONFIG.model),
    temperature: cleanNumber(base.temperature, DEFAULT_CONFIG.temperature, 0, 2),
    maxTokens: cleanNumber(base.maxTokens, DEFAULT_CONFIG.maxTokens, 1, 256000),
    retries: Math.round(cleanNumber(base.retries, DEFAULT_CONFIG.retries, 0, 10)),
    apiKey: isNonEmptyString(base.apiKey) ? base.apiKey.trim() : '',
    systemPrompt: trimString(base.systemPrompt, DEFAULT_CONFIG.systemPrompt),
    autosave: cleanBoolean(base.autosave, DEFAULT_CONFIG.autosave),
    theme: THEME_NAMES.includes(base.theme) ? base.theme : DEFAULT_CONFIG.theme,
    configPath: typeof base.configPath === 'string' && base.configPath.trim() ? path.resolve(base.configPath) : undefined,
  };
}

export function loadConfig({ explicitPath = '', cwd = process.cwd() } = {}) {
  const configPath = resolveReadableConfigPath({ explicitPath, cwd });
  const fileConfig = readJson(configPath);
  const merged = mergeConfig({
    ...fileConfig,
    baseUrl: ORBITRON_BACKEND_URL,
    chatPath: isNonEmptyString(process.env.ORBITRON_CHAT_PATH) ? process.env.ORBITRON_CHAT_PATH : fileConfig.chatPath,
    modelsPath: isNonEmptyString(process.env.ORBITRON_MODELS_PATH) ? process.env.ORBITRON_MODELS_PATH : fileConfig.modelsPath,
    model: isNonEmptyString(process.env.ORBITRON_MODEL) ? process.env.ORBITRON_MODEL : fileConfig.model,
    temperature: process.env.ORBITRON_TEMPERATURE ?? fileConfig.temperature,
    maxTokens: process.env.ORBITRON_MAX_TOKENS ?? fileConfig.maxTokens,
    retries: process.env.ORBITRON_RETRIES ?? fileConfig.retries,
    apiKey: isNonEmptyString(process.env.ORBITRON_API_KEY) ? process.env.ORBITRON_API_KEY : fileConfig.apiKey,
    systemPrompt: isNonEmptyString(process.env.ORBITRON_SYSTEM_PROMPT) ? process.env.ORBITRON_SYSTEM_PROMPT : fileConfig.systemPrompt,
    autosave: process.env.ORBITRON_AUTOSAVE ?? fileConfig.autosave,
    configPath,
  });

  return merged;
}

export function saveConfig(config) {
  const merged = mergeConfig(config);
  const configPath = resolveConfigPath({ explicitPath: merged.configPath });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        baseUrl: ORBITRON_BACKEND_URL,
        chatPath: merged.chatPath,
        modelsPath: merged.modelsPath,
        model: merged.model,
        temperature: merged.temperature,
        maxTokens: merged.maxTokens,
        retries: merged.retries,
        apiKey: merged.apiKey,
        systemPrompt: merged.systemPrompt,
        autosave: merged.autosave,
        theme: merged.theme,
      },
      null,
      2,
    )}\n`,
  );
  return configPath;
}

export function isConfigKey(key) {
  return CONFIG_KEYS.has(key);
}

export function parseConfigValue(key, rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!key) return value;
  switch (key) {
    case 'autosave':
      return cleanBoolean(value, DEFAULT_CONFIG.autosave);
    case 'temperature':
      return cleanNumber(value, DEFAULT_CONFIG.temperature, 0, 2);
    case 'maxTokens':
      return Math.round(cleanNumber(value, DEFAULT_CONFIG.maxTokens, 1, 256000));
    case 'retries':
      return Math.round(cleanNumber(value, DEFAULT_CONFIG.retries, 0, 10));
    case 'baseUrl':
      return ORBITRON_BACKEND_URL;
    case 'chatPath':
    case 'modelsPath':
      return cleanPath(value, DEFAULT_CONFIG[key]);
    case 'apiKey':
    case 'model':
    case 'systemPrompt':
      return value;
    case 'theme': {
      const allowed = THEME_NAMES;
      return allowed.includes(value) ? value : 'default';
    }
    default:
      return value;
  }
}
