import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, loadConfig, mergeConfig, parseConfigValue, saveConfig } from '../src/config.js';
import { createState } from '../src/state.js';
import { renderScreen, renderStatusCard } from '../src/render.js';
import { walkWorkspace } from '../src/files.js';
import { getTheme } from '../src/themes.js';
import { ORCHESTRATOR_ROLES, runOrchestratedReply } from '../src/orchestrator.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbitron-smoke-'));
const configPath = path.join(tmp, 'orbitron.config.json');
process.env.ORBITRON_CONFIG_PATH = configPath;

const config = loadConfig({ cwd: tmp });
assert.equal(config.baseUrl, DEFAULT_CONFIG.baseUrl);
assert.equal(config.chatPath, '/api/chat');
assert.equal(parseConfigValue('autosave', 'true'), true);
assert.equal(parseConfigValue('temperature', '0.7'), 0.7);
assert.equal(parseConfigValue('baseUrl', 'https://example.com/'), 'https://orbitron--pastelsjuice8t.replit.app');
assert.equal(parseConfigValue('modelsPath', 'models'), '/models');

const savedPath = saveConfig({ ...config, model: 'test-model', configPath });
assert.equal(savedPath, configPath);
assert.ok(fs.existsSync(configPath));

const state = createState({ cwd: tmp, config: { configPath, baseUrl: config.baseUrl, apiKey: 'test-key' } });
state.files = walkWorkspace(tmp);
const theme = getTheme('default');
assert.equal(typeof theme.prompt, 'function');
assert.equal(typeof theme.assistant, 'function');
const screen = renderScreen(state, 120, 40, theme);
assert.match(screen, /Orbitron/i);
assert.match(screen, /Directory/);
assert.match(screen, /\/mode to switch/);
assert.match(screen, /\/help \/models \/theme \/sessions/);

const staleAuthState = createState({ cwd: tmp, config: { configPath, baseUrl: config.baseUrl, apiKey: '' } });
staleAuthState.authPromptActive = true;
staleAuthState.config.apiKey = 'test-key';
const staleAuthScreen = renderScreen(staleAuthState, 120, 30, theme);
assert.match(staleAuthScreen, /Orbitron/i);
assert.match(staleAuthScreen, /\/help \/models \/theme \/sessions/);
assert.doesNotMatch(staleAuthScreen, /api key required/i);
assert.doesNotMatch(staleAuthScreen, /Unlock chat/i);

const narrowScreen = renderScreen(state, 80, 28, theme);
assert.match(narrowScreen, /Orbitron · test-model · Default · .*\/help/);
assert.match(narrowScreen, /\/help \/mode \/models/);
assert.doesNotMatch(narrowScreen, /version/i);

const lockedState = createState({ cwd: tmp, config: { configPath, baseUrl: config.baseUrl, apiKey: '' } });
const lockedScreen = renderScreen(lockedState, 120, 30, theme);
assert.match(lockedScreen, /Orbitron/i);
assert.match(lockedScreen, /\/help \/models \/theme \/sessions/);
assert.doesNotMatch(lockedScreen, /api key required/i);
assert.doesNotMatch(lockedScreen, /Unlock chat/i);

const orchestratorState = createState({ cwd: tmp, config: { configPath, baseUrl: config.baseUrl, apiKey: 'test-key' } });
const stageCalls = [];
const fakeClient = {
  extractAssistantText(result) {
    return String(result?.output ?? result?.raw ?? '');
  },
  async sendChat(messages, overrides) {
    stageCalls.push({ messages, overrides });
    if (stageCalls.length === 1) return { output: 'discover notes' };
    if (stageCalls.length === 2) return { output: 'think notes' };
    throw new Error('unexpected extra orchestration call');
  },
};

const stageUpdates = [];
const orchestration = await runOrchestratedReply({
  state: orchestratorState,
  client: fakeClient,
  redraw: () => {},
  onStage: (stage) => stageUpdates.push(`${stage.currentRole}: ${stage.currentDetail}`),
});

assert.deepEqual(ORCHESTRATOR_ROLES, ['discover', 'think', 'review']);
assert.equal(orchestratorState.orchestrator.active, true);
assert.equal(orchestratorState.orchestrator.currentRole, 'review');
assert.equal(orchestratorState.status, 'review: streaming the answer');
assert.deepEqual(stageUpdates, [
  'discover: mapping relevant context',
  'think: sketching an approach',
  'review: streaming the answer',
]);
const statusText = renderStatusCard(orchestratorState, 120).join('\n');
assert.match(statusText, /subagents:/i);
assert.match(statusText, /discover/);
assert.match(statusText, /think/);
assert.match(statusText, /review/);
assert.equal(orchestration.discoverText, 'discover notes');
assert.equal(orchestration.thinkText, 'think notes');
assert.ok(orchestration.reviewMessages.some((message) => String(message.content).includes('Discover notes:')));
assert.ok(orchestration.reviewMessages.some((message) => String(message.content).includes('Think notes:')));
assert.equal(stageCalls.length, 2);
assert.equal(stageCalls[0].overrides.temperature, 0.1);
assert.equal(stageCalls[1].overrides.temperature, 0.2);

const merged = mergeConfig({ baseUrl: 'https://orbitron--pastelsjuice8t.replit.app///', modelsPath: 'api/models' });
assert.equal(merged.baseUrl, 'https://orbitron--pastelsjuice8t.replit.app');
assert.equal(merged.modelsPath, '/api/models');

// Verify: empty env vars do not override a saved API key
const savedWithKey = saveConfig({ ...merged, apiKey: 'saved-key-value', configPath });
const afterEmptyEnv = loadConfig({ cwd: tmp });
assert.equal(afterEmptyEnv.apiKey, 'saved-key-value', 'empty ORBITRON_API_KEY must not wipe saved key');
process.env.ORBITRON_API_KEY = '';
const afterEmptyEnv2 = loadConfig({ cwd: tmp });
assert.equal(afterEmptyEnv2.apiKey, 'saved-key-value', 'empty string env var must not wipe saved key');

console.log('smoke ok');
