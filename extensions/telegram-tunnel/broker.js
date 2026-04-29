import { unlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import { Api, GrammyError, HttpError } from 'grammy';
import {
  advanceGuidedAnswerFlow,
  buildChoiceInjection,
  isGuidedAnswerStart,
  matchChoiceOption,
  renderGuidedAnswerPrompt,
  startGuidedAnswerFlow,
  summarizeTailForTelegram,
} from './answer-workflow.ts';

const socketPath = process.env.TELEGRAM_TUNNEL_BROKER_SOCKET_PATH;
const config = JSON.parse(process.env.TELEGRAM_TUNNEL_BROKER_CONFIG_JSON || '{}');
if (!socketPath || !config?.botToken || !config?.stateDir) {
  throw new Error('Missing TELEGRAM_TUNNEL_BROKER_SOCKET_PATH or TELEGRAM_TUNNEL_BROKER_CONFIG_JSON');
}

const api = new Api(config.botToken);
const clients = new Map();
const routes = new Map();
const pendingClientRequests = new Map();
const activeSessionByChatId = new Map();
const answerFlows = new Map();
const statePath = `${config.stateDir}/state.json`;
let updateOffset;
let shuttingDown = false;

const HELP_TEXT = [
  'Telegram tunnel commands:',
  '/help - show commands',
  '/status - session and tunnel status',
  '/sessions - list available paired sessions',
  '/use <session> - select an active session',
  '/summary - latest summary/excerpt',
  '/full - latest full assistant output',
  '/steer <text> - steer the active run',
  '/followup <text> - queue a follow-up',
  '/abort - abort the active run',
  '/compact - trigger Pi compaction',
  '/pause - pause remote delivery',
  '/resume - resume remote delivery',
  '/disconnect - revoke this chat binding',
  "answer - start a guided answer flow when the latest output contains choices/questions",
].join('\n');

function nowIso() {
  return new Date().toISOString();
}

function parseCommand(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('/')) return undefined;
  const [raw, ...rest] = trimmed.split(/\s+/);
  const command = raw.slice(1).split('@')[0]?.toLowerCase();
  if (!command) return undefined;
  return { command, args: rest.join(' ').trim() };
}

function getUserLabel(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (user.username) return `@${user.username}${name ? ` (${name})` : ''}`;
  if (name) return `${name} (${user.id})`;
  return `Telegram user ${user.id}`;
}

function redact(text) {
  let output = String(text || '');
  for (const pattern of config.redactionPatterns || []) {
    try {
      output = output.replace(new RegExp(pattern, 'gm'), '[redacted]');
    } catch {}
  }
  return output;
}

function chunkText(text) {
  const maxChars = config.maxTelegramMessageChars || 3900;
  const safe = redact(String(text || '')).replace(/\r\n/g, '\n');
  if (safe.length <= maxChars) return [safe];
  const chunks = [];
  let remaining = safe;
  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n', maxChars);
    if (splitAt < maxChars * 0.5) splitAt = remaining.lastIndexOf(' ', maxChars);
    if (splitAt < maxChars * 0.5) splitAt = maxChars;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.map((chunk, index) => `[${index + 1}/${chunks.length}]\n${chunk}`);
}

function isRetriable(error) {
  if (error instanceof HttpError) return true;
  if (error instanceof GrammyError) return error.error_code === 429 || error.error_code >= 500;
  return false;
}

function retryDelay(error, attempt) {
  if (error instanceof GrammyError && error.parameters?.retry_after) {
    return error.parameters.retry_after * 1000;
  }
  return (config.sendRetryBaseMs || 800) * attempt;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendPlainText(chatId, text) {
  const chunks = chunkText(text);
  for (const chunk of chunks) {
    let lastError;
    const retries = Math.max(1, config.sendRetryCount || 1);
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await api.sendMessage(chatId, chunk);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= retries || !isRetriable(error)) break;
        await sleep(retryDelay(error, attempt));
      }
    }
    if (lastError) throw lastError;
  }
}

async function loadState() {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  try {
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      setup: parsed.setup,
      pendingPairings: parsed.pendingPairings || {},
      bindings: parsed.bindings || {},
    };
  } catch {
    return { pendingPairings: {}, bindings: {} };
  }
}

async function saveState(state) {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function updateState(mutator) {
  const state = await loadState();
  await mutator(state);
  await saveState(state);
  return state;
}

async function cleanupExpiredPairings() {
  await updateState((state) => {
    const now = Date.now();
    for (const [key, pairing] of Object.entries(state.pendingPairings)) {
      if (pairing.consumedAt || Date.parse(pairing.expiresAt) <= now) delete state.pendingPairings[key];
    }
  });
}

async function ensureSetup() {
  const state = await loadState();
  if (state.setup) return state.setup;
  const me = await api.getMe();
  const setup = {
    botId: me.id,
    botUsername: me.username || `bot-${me.id}`,
    botDisplayName: me.first_name,
    validatedAt: nowIso(),
  };
  await updateState((draft) => {
    draft.setup = setup;
  });
  return setup;
}

function routeStatusLine(route, online) {
  const binding = route.binding;
  if (!binding) return `${route.sessionLabel} (${online ? 'online' : 'offline'}) - not paired`;
  const paused = binding.paused ? ', paused' : '';
  return `${route.sessionLabel} (${online ? 'online' : 'offline'}, ${route.busy ? 'busy' : 'idle'}${paused})`;
}

function getLiveRoutesForChat(chatId, userId) {
  return Array.from(routes.values()).filter((route) => route.binding?.chatId === chatId && route.binding?.userId === userId);
}

async function getPersistedBindingsForChat(chatId, userId) {
  const state = await loadState();
  return Object.values(state.bindings)
    .filter((binding) => binding.chatId === chatId && binding.userId === userId && binding.status !== 'revoked');
}

async function resolveRouteForChat(chatId, userId) {
  const live = getLiveRoutesForChat(chatId, userId);
  const active = activeSessionByChatId.get(String(chatId));
  if (active) {
    const selected = live.find((route) => route.sessionKey === active);
    if (selected) return { route: selected, live, ambiguous: false };
  }
  if (live.length === 1) {
    activeSessionByChatId.set(String(chatId), live[0].sessionKey);
    return { route: live[0], live, ambiguous: false };
  }
  if (live.length > 1) return { route: undefined, live, ambiguous: true };
  return { route: undefined, live, ambiguous: false };
}

async function chooseRouteForUse(chatId, userId, selector) {
  const live = getLiveRoutesForChat(chatId, userId);
  if (live.length === 0) return undefined;
  const trimmed = selector.trim();
  if (!trimmed) return undefined;
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= live.length) {
    return live[asNumber - 1];
  }
  const lowered = trimmed.toLowerCase();
  return live.find((route) =>
    route.sessionLabel.toLowerCase().includes(lowered) || route.sessionId.toLowerCase().startsWith(lowered),
  );
}

function routeIsAuthorized(route, user) {
  if (!route.binding) return false;
  if (route.binding.userId !== user.id) return false;
  if ((config.allowUserIds || []).length > 0 && !(config.allowUserIds || []).includes(user.id)) return false;
  return true;
}

function write(socket, payload) {
  socket.write(`${JSON.stringify(payload)}\n`);
}

function requestClient(route, action, payload = {}) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingClientRequests.delete(requestId);
      reject(new Error(`Timed out waiting for client action ${action}`));
    }, 30000);
    pendingClientRequests.set(requestId, {
      socket: route.socket,
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    write(route.socket, { type: 'request', requestId, action, sessionKey: route.sessionKey, ...payload });
  });
}

function getAnswerFlowKey(route) {
  return `${route.sessionKey}:${route.binding?.chatId ?? 'unbound'}`;
}

async function deliverAnswerInjection(route, message, text) {
  const deliverAs = route.busy ? config.busyDeliveryMode : undefined;
  await requestClient(route, 'deliverPrompt', {
    text,
    deliverAs,
    auditMessage: `Telegram ${getUserLabel(message.user)} answered a guided Telegram question flow.`,
  });
}

function clearAnswerFlow(route) {
  answerFlows.delete(getAnswerFlowKey(route));
}

function getAnswerFlow(route) {
  return answerFlows.get(getAnswerFlowKey(route));
}

function setAnswerFlow(route, state) {
  answerFlows.set(getAnswerFlowKey(route), state);
}

async function consumePendingPairing(nonce) {
  const { createHash } = await import('node:crypto');
  const nonceHash = createHash('sha256').update(nonce).digest('hex');
  let found;
  await updateState((state) => {
    const pairing = state.pendingPairings[nonceHash];
    if (!pairing) return;
    if (pairing.consumedAt || Date.parse(pairing.expiresAt) <= Date.now()) {
      delete state.pendingPairings[nonceHash];
      return;
    }
    found = { ...pairing, consumedAt: nowIso() };
    delete state.pendingPairings[nonceHash];
  });
  return found;
}

async function upsertBinding(binding) {
  await updateState((state) => {
    state.bindings[binding.sessionKey] = { ...binding, status: binding.revokedAt ? 'revoked' : 'active' };
  });
}

async function revokeBinding(sessionKey) {
  let revoked;
  await updateState((state) => {
    const existing = state.bindings[sessionKey];
    if (!existing) return;
    revoked = { ...existing, revokedAt: nowIso(), lastSeenAt: nowIso(), status: 'revoked' };
    state.bindings[sessionKey] = revoked;
  });
  return revoked;
}

async function handlePairStart(message, nonce) {
  if (!nonce) {
    await sendPlainText(message.chat.id, 'Missing pairing payload. Re-run /telegram-tunnel connect in Pi and scan the new QR code.');
    return;
  }
  if (message.chat.type !== 'private') {
    await sendPlainText(message.chat.id, 'Pairing only works from a private Telegram chat with the bot.');
    return;
  }
  const pairing = await consumePendingPairing(nonce);
  if (!pairing) {
    await sendPlainText(message.chat.id, 'This pairing link is invalid or expired. Run /telegram-tunnel connect again in Pi.');
    return;
  }
  const route = routes.get(pairing.sessionKey);
  if (!route) {
    await sendPlainText(message.chat.id, `The target Pi session (${pairing.sessionLabel}) is not online anymore. Re-run /telegram-tunnel connect locally.`);
    return;
  }
  const allowedByList = (config.allowUserIds || []).length > 0 && (config.allowUserIds || []).includes(message.user.id);
  const approved = allowedByList || (await requestClient(route, 'confirmPairing', { identity: message.user }));
  if (!approved) {
    await sendPlainText(message.chat.id, 'Pairing was declined locally. Ask the Pi user to retry the connection flow.');
    return;
  }

  const binding = {
    sessionKey: route.sessionKey,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    sessionLabel: route.sessionLabel,
    chatId: message.chat.id,
    userId: message.user.id,
    username: message.user.username,
    firstName: message.user.firstName,
    lastName: message.user.lastName,
    boundAt: nowIso(),
    lastSeenAt: nowIso(),
    paused: false,
  };
  route.binding = binding;
  await upsertBinding(binding);
  activeSessionByChatId.set(String(message.chat.id), route.sessionKey);
  await requestClient(route, 'persistBinding', { binding, revoked: false });
  await requestClient(route, 'appendAudit', { message: `Telegram tunnel paired with ${getUserLabel(message.user)}.` });
  await sendPlainText(message.chat.id, `Connected to Pi session ${route.sessionLabel}. Send text prompts directly, or use /help for tunnel commands.`);
}

async function handleSessionsCommand(message) {
  const live = getLiveRoutesForChat(message.chat.id, message.user.id);
  const persisted = await getPersistedBindingsForChat(message.chat.id, message.user.id);
  const seen = new Set();
  const lines = ['Paired sessions:'];
  let index = 1;
  for (const route of live) {
    seen.add(route.sessionKey);
    const active = activeSessionByChatId.get(String(message.chat.id)) === route.sessionKey ? ' *active*' : '';
    lines.push(`${index}. ${routeStatusLine(route, true)}${active}`);
    index += 1;
  }
  for (const binding of persisted) {
    if (seen.has(binding.sessionKey)) continue;
    const active = activeSessionByChatId.get(String(message.chat.id)) === binding.sessionKey ? ' *active*' : '';
    lines.push(`${index}. ${binding.sessionLabel} (offline)${active}`);
    index += 1;
  }
  if (index === 1) {
    lines.push('No paired sessions found for this chat.');
  } else {
    lines.push('', 'Use /use <number|name> to switch the active session.');
  }
  await sendPlainText(message.chat.id, lines.join('\n'));
}

async function handleUseCommand(message, args) {
  const route = await chooseRouteForUse(message.chat.id, message.user.id, args);
  if (!route) {
    await sendPlainText(message.chat.id, 'No matching online session. Use /sessions to list available routes.');
    return;
  }
  activeSessionByChatId.set(String(message.chat.id), route.sessionKey);
  await sendPlainText(message.chat.id, `Active session set to ${route.sessionLabel}.`);
}

async function startAnswerFlow(message, route) {
  const metadata = route?.notification?.structuredAnswer;
  if (!route || !route.binding || !metadata) {
    await sendPlainText(message.chat.id, 'There is nothing to answer yet. Use /full or send a normal text reply instead.');
    return true;
  }

  const state = startGuidedAnswerFlow();
  setAnswerFlow(route, state);
  await sendPlainText(message.chat.id, renderGuidedAnswerPrompt(metadata, state));
  return true;
}

async function handleAnswerFlowReply(message, route) {
  const metadata = route?.notification?.structuredAnswer;
  const state = route ? getAnswerFlow(route) : undefined;
  if (!route || !route.binding || !metadata || !state) {
    return false;
  }

  const result = advanceGuidedAnswerFlow(metadata, state, message.text);
  if (result.cancelled) {
    clearAnswerFlow(route);
    await sendPlainText(message.chat.id, result.responseText);
    return true;
  }

  if (result.done && result.injectionText) {
    clearAnswerFlow(route);
    await deliverAnswerInjection(route, message, result.injectionText);
    await sendPlainText(message.chat.id, result.responseText);
    return true;
  }

  if (result.nextState) {
    setAnswerFlow(route, result.nextState);
    await sendPlainText(message.chat.id, result.responseText);
    return true;
  }

  return false;
}

async function handleDirectStructuredAnswer(message, route) {
  const metadata = route?.notification?.structuredAnswer;
  if (!route || !route.binding || !metadata || metadata.kind !== 'choice') {
    return false;
  }

  const matchedOption = matchChoiceOption(metadata, message.text);
  const injectionText = matchedOption
    ? buildChoiceInjection(metadata, matchedOption)
    : undefined;

  if (!injectionText) {
    return false;
  }

  clearAnswerFlow(route);
  await deliverAnswerInjection(route, message, injectionText);
  await sendPlainText(message.chat.id, `Selected option ${matchedOption.id}: ${matchedOption.label}`);
  return true;
}

async function handleAuthorizedCommand(message, route, command, args) {
  const binding = route?.binding;
  if (command === 'help') {
    await sendPlainText(message.chat.id, HELP_TEXT);
    return;
  }
  if (command === 'sessions') {
    await handleSessionsCommand(message);
    return;
  }
  if (command === 'use') {
    await handleUseCommand(message, args);
    return;
  }
  if (!route || !binding) {
    const persisted = await getPersistedBindingsForChat(message.chat.id, message.user.id);
    if (persisted.length > 0) {
      await sendPlainText(message.chat.id, 'The selected Pi session is currently offline. Resume it locally, then try again.');
    } else {
      await sendPlainText(message.chat.id, 'This chat is not paired to an active Pi session. Run /telegram-tunnel connect locally first.');
    }
    return;
  }
  if (binding.paused && !['resume', 'status', 'help', 'disconnect', 'sessions', 'use'].includes(command)) {
    await sendPlainText(message.chat.id, 'The tunnel is currently paused. Use /resume or disconnect locally.');
    return;
  }

  switch (command) {
    case 'status': {
      const lines = [
        `Session: ${route.sessionLabel}`,
        `Online: yes`,
        `Busy: ${route.busy ? 'yes' : 'no'}`,
        `Model: ${route.modelId || 'unknown'}`,
        `Last activity: ${route.lastActivityAt ? new Date(route.lastActivityAt).toLocaleString() : 'unknown'}`,
        `Paused: ${binding.paused ? 'yes' : 'no'}`,
      ];
      await sendPlainText(message.chat.id, lines.join('\n'));
      return;
    }
    case 'summary': {
      const text = route.notification?.lastSummary || route.notification?.lastFailure || route.notification?.lastAssistantText;
      await sendPlainText(message.chat.id, text || 'No summary is available yet for this session.');
      return;
    }
    case 'full': {
      await sendPlainText(message.chat.id, route.notification?.lastAssistantText || 'No completed assistant output is available yet for this session.');
      return;
    }
    case 'steer': {
      if (!args) {
        await sendPlainText(message.chat.id, 'Usage: /steer <text>');
        return;
      }
      await requestClient(route, 'deliverPrompt', {
        text: args,
        deliverAs: route.busy ? 'steer' : undefined,
        auditMessage: `Telegram ${getUserLabel(message.user)} sent a steering instruction.`,
      });
      await sendPlainText(message.chat.id, route.busy ? 'Steering queued.' : 'Sent as a prompt.');
      return;
    }
    case 'followup': {
      if (!args) {
        await sendPlainText(message.chat.id, 'Usage: /followup <text>');
        return;
      }
      await requestClient(route, 'deliverPrompt', {
        text: args,
        deliverAs: route.busy ? 'followUp' : undefined,
        auditMessage: `Telegram ${getUserLabel(message.user)} queued a follow-up.`,
      });
      await sendPlainText(message.chat.id, route.busy ? 'Follow-up queued.' : 'Sent as a prompt.');
      return;
    }
    case 'abort': {
      if (!route.busy) {
        await sendPlainText(message.chat.id, 'The Pi session is already idle.');
        return;
      }
      route.notification = { ...(route.notification || {}), abortRequested: true };
      await requestClient(route, 'abort', { auditMessage: `Telegram ${getUserLabel(message.user)} requested abort.` });
      await sendPlainText(message.chat.id, 'Abort requested.');
      return;
    }
    case 'compact': {
      await requestClient(route, 'compact', { auditMessage: `Telegram ${getUserLabel(message.user)} requested compaction.` });
      await sendPlainText(message.chat.id, 'Compaction requested.');
      return;
    }
    case 'pause': {
      route.binding = { ...binding, paused: true, lastSeenAt: nowIso() };
      await upsertBinding(route.binding);
      await requestClient(route, 'persistBinding', { binding: route.binding, revoked: false });
      await sendPlainText(message.chat.id, 'Tunnel paused. Remote prompts and notifications are suspended until /resume.');
      return;
    }
    case 'resume': {
      route.binding = { ...binding, paused: false, lastSeenAt: nowIso() };
      await upsertBinding(route.binding);
      await requestClient(route, 'persistBinding', { binding: route.binding, revoked: false });
      await sendPlainText(message.chat.id, 'Tunnel resumed.');
      return;
    }
    case 'disconnect': {
      clearAnswerFlow(route);
      route.binding = undefined;
      await revokeBinding(route.sessionKey);
      await requestClient(route, 'persistBinding', { binding: null, revoked: true });
      await requestClient(route, 'appendAudit', { message: `Telegram ${getUserLabel(message.user)} disconnected the tunnel.` });
      if (activeSessionByChatId.get(String(message.chat.id)) === route.sessionKey) activeSessionByChatId.delete(String(message.chat.id));
      await sendPlainText(message.chat.id, 'Disconnected. Future messages from this chat will be ignored until a new pairing is created.');
      return;
    }
    default:
      await sendPlainText(message.chat.id, `Unknown command: /${command}. Use /help.`);
  }
}

async function handleAuthorizedText(message, route) {
  if (!route?.binding) {
    await sendPlainText(message.chat.id, 'This chat is not paired to an active Pi session. Run /telegram-tunnel connect locally first.');
    return;
  }
  if (route.binding.paused) {
    await sendPlainText(message.chat.id, 'The tunnel is paused. Use /resume first.');
    return;
  }
  if (await handleAnswerFlowReply(message, route)) {
    return;
  }
  if (isGuidedAnswerStart(message.text)) {
    await startAnswerFlow(message, route);
    return;
  }
  if (await handleDirectStructuredAnswer(message, route)) {
    return;
  }
  const deliverAs = route.busy ? config.busyDeliveryMode : undefined;
  await requestClient(route, 'deliverPrompt', {
    text: message.text,
    deliverAs,
    auditMessage: route.busy
      ? `Telegram ${getUserLabel(message.user)} queued a ${deliverAs} message.`
      : `Telegram ${getUserLabel(message.user)} sent a prompt.`,
  });
  await sendPlainText(message.chat.id, route.busy ? `Pi is busy; your message was queued as ${deliverAs}.` : 'Prompt delivered to Pi.');
}

async function processInbound(message) {
  const command = parseCommand(message.text);
  if (command?.command === 'start') {
    await handlePairStart(message, command.args);
    return;
  }

  const { route, ambiguous } = await resolveRouteForChat(message.chat.id, message.user.id);
  if (route && !routeIsAuthorized(route, message.user)) {
    await sendPlainText(message.chat.id, 'Unauthorized Telegram identity for this Pi session.');
    return;
  }
  if (ambiguous && command?.command !== 'sessions' && command?.command !== 'use') {
    await sendPlainText(message.chat.id, 'Multiple Pi sessions are paired to this chat. Use /sessions then /use <session> first.');
    return;
  }
  if (route?.binding) {
    route.binding.lastSeenAt = nowIso();
    await upsertBinding(route.binding);
  }

  if (command) {
    await handleAuthorizedCommand(message, route, command.command, command.args);
    return;
  }

  await handleAuthorizedText(message, route);
}

async function pollLoop() {
  while (!shuttingDown) {
    try {
      await cleanupExpiredPairings();
      const updates = await api.getUpdates({
        offset: updateOffset,
        timeout: config.pollingTimeoutSeconds || 20,
        allowed_updates: ['message'],
      });
      for (const update of updates) {
        const message = update.message;
        updateOffset = update.update_id + 1;
        if (!message?.text || !message.from || !message.chat) continue;
        await processInbound({
          updateId: update.update_id,
          messageId: message.message_id,
          text: message.text,
          chat: {
            id: message.chat.id,
            type: message.chat.type,
            title: 'title' in message.chat ? message.chat.title : undefined,
          },
          user: {
            id: message.from.id,
            username: message.from.username,
            firstName: message.from.first_name,
            lastName: message.from.last_name,
          },
        });
      }
    } catch {
      await sleep(1500);
    }
  }
}

function removeClient(socket) {
  const client = clients.get(socket);
  if (!client) return;
  for (const sessionKey of client.routes) {
    const existing = routes.get(sessionKey);
    if (existing) clearAnswerFlow(existing);
    routes.delete(sessionKey);
  }
  clients.delete(socket);
  for (const [requestId, pending] of pendingClientRequests.entries()) {
    if (pending.socket === socket) {
      pending.reject(new Error('Client disconnected.'));
      pendingClientRequests.delete(requestId);
    }
  }
}

async function handleClientRequest(socket, message) {
  const respond = (ok, result, error) => write(socket, { type: 'response', requestId: message.requestId, ok, result, error });
  try {
    switch (message.action) {
      case 'ensureSetup': {
        const setup = await ensureSetup();
        respond(true, setup);
        return;
      }
      case 'registerRoute': {
        const route = message.route;
        if (!clients.has(socket)) clients.set(socket, { clientId: message.clientId, routes: new Set() });
        const client = clients.get(socket);
        client.clientId = message.clientId;
        client.routes.add(route.sessionKey);
        const previousRoute = routes.get(route.sessionKey);
        routes.set(route.sessionKey, { ...route, socket });
        if (!route.notification?.structuredAnswer && previousRoute) {
          clearAnswerFlow(previousRoute);
        }
        if (route.binding) {
          await upsertBinding(route.binding);
          if (!activeSessionByChatId.has(String(route.binding.chatId))) activeSessionByChatId.set(String(route.binding.chatId), route.sessionKey);
        }
        respond(true, true);
        return;
      }
      case 'unregisterRoute': {
        const client = clients.get(socket);
        client?.routes.delete(message.sessionKey);
        const existing = routes.get(message.sessionKey);
        if (existing) clearAnswerFlow(existing);
        routes.delete(message.sessionKey);
        respond(true, true);
        return;
      }
      case 'sendToBoundChat': {
        const route = routes.get(message.sessionKey);
        if (!route?.binding || route.binding.paused) {
          respond(true, false);
          return;
        }
        await sendPlainText(route.binding.chatId, message.text);
        if (route.notification?.lastStatus === 'completed' && route.notification?.structuredAnswer) {
          await sendPlainText(route.binding.chatId, summarizeTailForTelegram(route.notification.structuredAnswer));
        }
        respond(true, true);
        return;
      }
      default:
        respond(false, undefined, `Unknown client action: ${message.action}`);
    }
  } catch (error) {
    respond(false, undefined, error instanceof Error ? error.message : String(error));
  }
}

await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
try { await unlink(socketPath); } catch {}

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const message = JSON.parse(line);
        if (message.type === 'response') {
          const pending = pendingClientRequests.get(message.requestId);
          if (pending) {
            pendingClientRequests.delete(message.requestId);
            if (message.ok) pending.resolve(message.result);
            else pending.reject(new Error(message.error || 'Client request failed.'));
          }
        } else if (message.type === 'request') {
          void handleClientRequest(socket, message);
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });
  socket.on('close', () => removeClient(socket));
  socket.on('error', () => removeClient(socket));
});

server.listen(socketPath, async () => {
  await ensureSetup().catch(() => undefined);
  void pollLoop();
});

const shutdown = async () => {
  shuttingDown = true;
  server.close();
  try { await unlink(socketPath); } catch {}
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
