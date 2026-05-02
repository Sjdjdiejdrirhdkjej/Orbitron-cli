export const ORCHESTRATOR_ROLES = ['discover', 'think', 'review'];

const DISCOVER_INSTRUCTIONS = [
  'You are the discover subagent.',
  'Inspect the recent conversation and the current request.',
  'Return concise bullets covering the important constraints, likely files or concepts involved, and anything the next step should watch for.',
  'Do not answer the user yet.',
].join(' ');

const THINK_INSTRUCTIONS = [
  'You are the think subagent.',
  'Use the request and the discover notes to sketch the best implementation or response approach.',
  'Keep it brief and practical.',
  'Do not write the final user-facing answer.',
].join(' ');

const REVIEW_INSTRUCTIONS = [
  'You are the review subagent.',
  'Review the discover and think notes, then write the final answer to the user.',
  'Keep the answer concise, practical, and directly actionable.',
  'Do not mention the internal role names.',
].join(' ');

function recentConversation(messages, limit = 12) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message && message.role !== 'system')
    .slice(-limit)
    .map((message) => ({
      role: message.role,
      content: String(message.content ?? ''),
    }));
}

function buildStageMessages(messages, instructions, extra = []) {
  return [
    { role: 'system', content: instructions },
    ...extra,
    ...recentConversation(messages),
  ];
}

function toText(client, result) {
  if (typeof client?.extractAssistantText === 'function') {
    return String(client.extractAssistantText(result) ?? '').trim();
  }
  if (typeof result === 'string') return result.trim();
  return String(result?.output ?? result?.raw ?? '').trim();
}

function updateStage(state, role, detail, completedRoles) {
  state.orchestrator = {
    active: true,
    currentRole: role,
    currentDetail: detail,
    completedRoles: [...completedRoles],
    roles: [...ORCHESTRATOR_ROLES],
  };
  state.status = `${role}: ${detail}`;
}

export function formatStageStatus(role, detail) {
  return `${role}: ${detail}`;
}

export async function runOrchestratedReply({
  state,
  client,
  signal,
  redraw,
  onStage,
} = {}) {
  if (!state || !client) {
    throw new Error('runOrchestratedReply requires both state and client');
  }

  const model = state.config?.model;
  const temperature = state.config?.temperature;
  const maxTokens = state.config?.maxTokens;
  const retries = state.config?.retries;
  const completedRoles = [];

  const announce = (role, detail) => {
    updateStage(state, role, detail, completedRoles);
    onStage?.(state.orchestrator);
    redraw?.();
  };

  announce('discover', 'mapping relevant context');
  state.typingIndicator = true;
  state.typingDots = 0;
  const discoverResult = await client.sendChat(
    buildStageMessages(state.messages, DISCOVER_INSTRUCTIONS),
    { model, temperature: 0.1, maxTokens: 256, retries },
    signal,
  );
  const discoverText = toText(client, discoverResult);
  completedRoles.push('discover');
  state.orchestrator.completedRoles = [...completedRoles];

  announce('think', 'sketching an approach');
  const thinkResult = await client.sendChat(
    buildStageMessages(state.messages, THINK_INSTRUCTIONS, [
      { role: 'system', content: `Discover notes:\n${discoverText || '(none)'}` },
    ]),
    { model, temperature: 0.2, maxTokens: 384, retries },
    signal,
  );
  const thinkText = toText(client, thinkResult);
  completedRoles.push('think');
  state.orchestrator.completedRoles = [...completedRoles];

  announce('review', 'streaming the answer');
  state.typingIndicator = false;
  state.typingDots = 0;
  const reviewMessages = buildStageMessages(state.messages, REVIEW_INSTRUCTIONS, [
    { role: 'system', content: `Discover notes:\n${discoverText || '(none)'}` },
    { role: 'system', content: `Think notes:\n${thinkText || '(none)'}` },
  ]);

  return {
    discoverText,
    thinkText,
    reviewMessages,
    completedRoles: [...completedRoles],
    reviewStatus: formatStageStatus('review', 'streaming the answer'),
    reviewModel: model,
  };
}
