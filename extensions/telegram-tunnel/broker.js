import { unlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import { Api, GrammyError, HttpError, InputFile } from 'grammy';
import {
  advanceGuidedAnswerFlow,
  buildChoiceInjection,
  buildFreeTextChoiceInjection,
  isGuidedAnswerStart,
  isGuidedAnswerCancel,
  matchChoiceOption,
  renderGuidedAnswerPrompt,
  startGuidedAnswerFlow,
  summarizeTailForTelegram,
} from './answer-workflow.ts';
import {
  buildAnswerActionKeyboard,
  buildFullOutputKeyboard,
  buildLatestImagesKeyboard,
  parseTelegramActionCallbackData,
  shouldOfferFullOutputActions,
} from './telegram-actions.ts';
import { formatTelegramChatText } from './telegram-format.ts';
import {
  base64ByteLength,
  buildImagePromptContent,
  isAllowedImageMimeType,
  normalizeImageMimeType,
  safeTelegramImageFilename,
} from './utils.ts';

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
const pendingCustomAnswers = new Map();
const activityIndicators = new Map();
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
  '/images - download latest image outputs or generated image files',
  '/send-image <path> - send a validated workspace image file',
  '/steer <text> - steer the active run',
  '/followup <text> - queue a follow-up',
  '/abort - abort the active run',
  '/compact - trigger Pi compaction',
  '/pause - pause remote delivery',
  '/resume - resume remote delivery',
  '/disconnect - revoke this chat binding',
  "answer - start a guided answer flow when the latest output contains choices/questions",
].join('\n');

const TELEGRAM_ACTIVITY_ACTION = 'typing';
const TELEGRAM_ACTIVITY_INITIAL_REFRESH_MS = 1200;
const TELEGRAM_ACTIVITY_REFRESH_MS = 4000;
const CUSTOM_ANSWER_EXPIRY_MS = 10 * 60 * 1000;
const DEFAULT_ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function allowedImageMimeTypes() {
  return Array.isArray(config.allowedImageMimeTypes) && config.allowedImageMimeTypes.length > 0
    ? config.allowedImageMimeTypes
    : DEFAULT_ALLOWED_IMAGE_MIME_TYPES;
}

function maxInboundImageBytes() {
  return Number(config.maxInboundImageBytes) > 0 ? Number(config.maxInboundImageBytes) : 10 * 1024 * 1024;
}

function maxOutboundImageBytes() {
  return Number(config.maxOutboundImageBytes) > 0 ? Number(config.maxOutboundImageBytes) : 10 * 1024 * 1024;
}

function unrefTimer(timer) {
  if (timer && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
}

function isTerminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'aborted';
}

function isEffectivelyBusy(route) {
  if (!route) return false;
  if (isTerminalStatus(route.notification?.lastStatus)) return false;
  return Boolean(route.busy || route.notification?.lastStatus === 'running');
}

function hasAnswerableLatestOutput(route) {
  return route?.notification?.lastStatus === 'completed'
    && Boolean(route.notification?.lastAssistantText)
    && Boolean(route.notification?.structuredAnswer);
}

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
  const safe = formatTelegramChatText(redact(String(text || ''))).replace(/\r\n/g, '\n');
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

function toReplyMarkup(keyboard) {
  return {
    inline_keyboard: keyboard.map((row) => row.map((button) => ({
      text: button.text,
      callback_data: button.callbackData,
    }))),
  };
}

async function withRetry(operation) {
  let lastError;
  const retries = Math.max(1, config.sendRetryCount || 1);
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetriable(error)) break;
      await sleep(retryDelay(error, attempt));
    }
  }
  throw lastError;
}

async function sendPlainText(chatId, text, keyboard) {
  const chunks = chunkText(text);
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const replyMarkup = keyboard && index === chunks.length - 1 ? { reply_markup: toReplyMarkup(keyboard) } : undefined;
    await withRetry(() => api.sendMessage(chatId, chunk, replyMarkup));
  }
}

async function sendMarkdownDocument(chatId, filename, text, caption) {
  const redacted = redact(text);
  await withRetry(() => api.sendDocument(chatId, new InputFile(Buffer.from(redacted, 'utf8'), filename), caption ? { caption } : undefined));
}

async function sendImageDocument(chatId, image, caption) {
  const bytes = Buffer.from(image.data, 'base64');
  await withRetry(() => api.sendDocument(
    chatId,
    new InputFile(bytes, safeTelegramImageFilename(image.fileName, image.mimeType)),
    caption ? { caption: redact(caption) } : undefined,
  ));
}

function selectBestPhotoSize(photoSizes) {
  const sorted = [...(photoSizes || [])]
    .filter((photo) => typeof photo.file_id === 'string')
    .sort((left, right) => Number(right.width || 0) * Number(right.height || 0) - Number(left.width || 0) * Number(left.height || 0));
  return sorted.find((photo) => typeof photo.file_size !== 'number' || photo.file_size <= maxInboundImageBytes()) || sorted[0];
}

function extractImageReferences(message) {
  const references = [];
  const photo = Array.isArray(message.photo) ? selectBestPhotoSize(message.photo) : undefined;
  if (photo?.file_id) {
    references.push({
      kind: 'photo',
      fileId: photo.file_id,
      fileUniqueId: photo.file_unique_id,
      mimeType: 'image/jpeg',
      fileSize: typeof photo.file_size === 'number' ? photo.file_size : undefined,
      width: typeof photo.width === 'number' ? photo.width : undefined,
      height: typeof photo.height === 'number' ? photo.height : undefined,
      supported: true,
    });
  }
  const document = message.document;
  if (document?.file_id) {
    const mimeType = normalizeImageMimeType(document.mime_type) || 'application/octet-stream';
    const supported = isAllowedImageMimeType(mimeType, allowedImageMimeTypes());
    references.push({
      kind: 'document',
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id,
      fileName: typeof document.file_name === 'string' ? document.file_name : undefined,
      mimeType,
      fileSize: typeof document.file_size === 'number' ? document.file_size : undefined,
      supported,
      unsupportedReason: supported ? undefined : `Unsupported image document type: ${mimeType}.`,
    });
  }
  return references;
}

async function downloadImage(reference) {
  if (!reference.supported) throw new Error(reference.unsupportedReason || 'Unsupported image attachment.');
  if (reference.fileSize && reference.fileSize > maxInboundImageBytes()) {
    throw new Error(`Image is too large (${reference.fileSize} bytes). Limit: ${maxInboundImageBytes()} bytes.`);
  }
  const telegramFile = await withRetry(() => api.getFile(reference.fileId));
  const remoteSize = telegramFile.file_size || reference.fileSize;
  if (remoteSize && remoteSize > maxInboundImageBytes()) {
    throw new Error(`Image is too large (${remoteSize} bytes). Limit: ${maxInboundImageBytes()} bytes.`);
  }
  if (!telegramFile.file_path) throw new Error('Telegram did not return a downloadable file path for this image.');
  const response = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${telegramFile.file_path}`);
  if (!response.ok) throw new Error(`Telegram file download failed with HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxInboundImageBytes()) {
    throw new Error(`Image is too large (${buffer.byteLength} bytes). Limit: ${maxInboundImageBytes()} bytes.`);
  }
  const mimeType = normalizeImageMimeType(reference.mimeType) || reference.mimeType;
  if (!isAllowedImageMimeType(mimeType, allowedImageMimeTypes())) throw new Error(`Unsupported image type: ${mimeType}.`);
  return {
    image: { type: 'image', data: buffer.toString('base64'), mimeType },
    fileName: safeTelegramImageFilename(reference.fileName, mimeType, reference.kind === 'photo' ? 'telegram-photo' : 'telegram-image'),
    fileSize: buffer.byteLength,
    source: reference,
  };
}

async function answerCallbackQuery(callbackQueryId, text) {
  await withRetry(() => api.answerCallbackQuery(callbackQueryId, text ? { text } : undefined));
}

async function sendChatAction(chatId, action = TELEGRAM_ACTIVITY_ACTION) {
  await withRetry(() => api.sendChatAction(chatId, action));
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
  return `${route.sessionLabel} (${online ? 'online' : 'offline'}, ${isEffectivelyBusy(route) ? 'busy' : 'idle'}${paused})`;
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

function getCurrentTurnId(route) {
  return route?.notification?.structuredAnswer?.turnId || route?.notification?.lastTurnId;
}

function fullOutputKeyboardForRoute(route) {
  if (!shouldOfferFullOutputActionsForRoute(route)) return undefined;
  const turnId = getCurrentTurnId(route);
  return route?.notification?.lastAssistantText && turnId ? buildFullOutputKeyboard(turnId) : undefined;
}

function latestImagesKeyboardForRoute(route) {
  const latestImages = route?.notification?.latestImages;
  if (!latestImages || latestImages.count <= 0) return undefined;
  return buildLatestImagesKeyboard(latestImages.turnId, latestImages.count);
}

function combineKeyboards(...keyboards) {
  const rows = keyboards.flatMap((keyboard) => keyboard || []);
  return rows.length > 0 ? rows : undefined;
}

function completionActionKeyboardForRoute(route) {
  return combineKeyboards(
    route?.notification?.structuredAnswer ? undefined : fullOutputKeyboardForRoute(route),
    latestImagesKeyboardForRoute(route),
  );
}

function shouldOfferFullOutputActionsForRoute(route) {
  return shouldOfferFullOutputActions(route?.notification?.lastAssistantText);
}

function answerActionKeyboardForRoute(route) {
  if (!route?.notification?.structuredAnswer) return undefined;
  const keyboard = buildAnswerActionKeyboard(route.notification.structuredAnswer, {
    includeFullOutputActions: shouldOfferFullOutputActionsForRoute(route),
  });
  const imageKeyboard = latestImagesKeyboardForRoute(route);
  if (imageKeyboard) keyboard.push(...imageKeyboard);
  return keyboard.length > 0 ? keyboard : undefined;
}

function safeFilename(baseName, extension) {
  const safeBase = String(baseName || 'pi-output')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'pi-output';
  const safeExtension = String(extension || 'txt').replace(/^\.+/, '') || 'txt';
  return `${safeBase}.${safeExtension}`;
}

function getCustomAnswerKey(route, userId) {
  return `${route.sessionKey}:${route.binding?.chatId ?? 'unbound'}:${userId}`;
}

function clearCustomAnswersForRoute(route) {
  for (const [key, pending] of pendingCustomAnswers.entries()) {
    if (pending.sessionKey === route.sessionKey) pendingCustomAnswers.delete(key);
  }
}

function clearStaleCustomAnswers(route) {
  const currentTurnId = getCurrentTurnId(route);
  const now = Date.now();
  for (const [key, pending] of pendingCustomAnswers.entries()) {
    if (pending.sessionKey !== route.sessionKey) continue;
    if (pending.expiresAt <= now || pending.turnId !== currentTurnId) pendingCustomAnswers.delete(key);
  }
}

function setPendingCustomAnswer(route, user, turnId) {
  if (!route?.binding) return;
  pendingCustomAnswers.set(getCustomAnswerKey(route, user.id), {
    sessionKey: route.sessionKey,
    chatId: route.binding.chatId,
    userId: user.id,
    turnId,
    expiresAt: Date.now() + CUSTOM_ANSWER_EXPIRY_MS,
  });
}

function takePendingCustomAnswer(route, user) {
  if (!route?.binding) return undefined;
  const key = getCustomAnswerKey(route, user.id);
  const pending = pendingCustomAnswers.get(key);
  if (!pending) return undefined;
  pendingCustomAnswers.delete(key);
  return pending;
}

async function deliverAnswerInjection(route, message, text) {
  const deliverAs = isEffectivelyBusy(route) ? config.busyDeliveryMode : undefined;
  await startActivityIndicator(route);
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

function getActivityKey(route) {
  return route?.binding ? `${route.sessionKey}:${route.binding.chatId}` : undefined;
}

function clearAllActivityIndicators() {
  for (const timer of activityIndicators.values()) {
    clearTimeout(timer);
  }
  activityIndicators.clear();
}

function clearActivityIndicator(route) {
  const key = getActivityKey(route);
  if (!key) return;
  clearActivityIndicatorByKey(key);
}

function clearActivityIndicatorByKey(key) {
  const timer = activityIndicators.get(key);
  if (timer) clearTimeout(timer);
  activityIndicators.delete(key);
}

function shouldContinueActivityIndicator(route) {
  if (!route?.binding || route.binding.paused) return false;
  if (isTerminalStatus(route.notification?.lastStatus)) return false;
  return isEffectivelyBusy(route);
}

function syncActivityIndicator(route) {
  if (shouldContinueActivityIndicator(route)) {
    void startActivityIndicator(route);
    return;
  }
  clearActivityIndicator(route);
}

async function startActivityIndicator(route) {
  const key = getActivityKey(route);
  if (!key || !route?.binding || route.binding.paused) return false;
  if (activityIndicators.has(key)) return true;

  const sent = await trySendActivityIndicator(route.binding.chatId);
  if (!sent) return false;
  scheduleActivityRefresh(route.sessionKey, route.binding.chatId, key, TELEGRAM_ACTIVITY_INITIAL_REFRESH_MS);
  return true;
}

function scheduleActivityRefresh(sessionKey, chatId, key, delayMs = TELEGRAM_ACTIVITY_REFRESH_MS) {
  const timer = setTimeout(() => {
    void refreshActivityIndicator(sessionKey, chatId, key);
  }, delayMs);
  unrefTimer(timer);
  activityIndicators.set(key, timer);
}

async function refreshActivityIndicator(sessionKey, chatId, key) {
  const route = routes.get(sessionKey);
  if (!route || route.binding?.chatId !== chatId || !shouldContinueActivityIndicator(route)) {
    clearActivityIndicatorByKey(key);
    return;
  }

  const sent = await trySendActivityIndicator(chatId);
  if (!sent) {
    clearActivityIndicatorByKey(key);
    return;
  }
  if (!activityIndicators.has(key)) return;
  scheduleActivityRefresh(sessionKey, chatId, key);
}

async function trySendActivityIndicator(chatId) {
  try {
    await sendChatAction(chatId, TELEGRAM_ACTIVITY_ACTION);
    return true;
  } catch {
    return false;
  }
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
  const metadata = hasAnswerableLatestOutput(route) ? route?.notification?.structuredAnswer : undefined;
  if (!route || !route.binding || !metadata) {
    await sendPlainText(
      message.chat.id,
      route?.notification?.lastStatus === 'completed' && route?.notification?.lastAssistantText
        ? 'I could not build a structured answer draft from the latest completed assistant output. Use /full or send a normal text reply instead.'
        : 'There is nothing to answer yet. Use /full or send a normal text reply instead.',
    );
    return true;
  }

  const state = startGuidedAnswerFlow();
  setAnswerFlow(route, state);
  await sendPlainText(message.chat.id, renderGuidedAnswerPrompt(metadata, state));
  return true;
}

async function handleAnswerFlowReply(message, route) {
  const metadata = hasAnswerableLatestOutput(route) ? route?.notification?.structuredAnswer : undefined;
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
  const metadata = hasAnswerableLatestOutput(route) ? route?.notification?.structuredAnswer : undefined;
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

function messageImages(message) {
  return message.images || [];
}

function hasImageAttachments(message) {
  return messageImages(message).length > 0;
}

function promptTextForMessage(message, fallback = 'Please inspect the attached image.') {
  return String(message.text || '').trim() || fallback;
}

async function downloadAuthorizedImages(message, route) {
  const references = messageImages(message);
  if (references.length === 0) return [];
  const unsupported = references.filter((reference) => !reference.supported);
  if (unsupported.length > 0) {
    await sendPlainText(message.chat.id, `Unsupported image attachment. Accepted image formats: ${allowedImageMimeTypes().join(', ')}.`);
    return undefined;
  }
  if (!route?.imageInputSupported) {
    await sendPlainText(message.chat.id, 'The current Pi model does not support image input. Switch to an image-capable model or resend text only.');
    return undefined;
  }
  const downloaded = [];
  try {
    for (const reference of references) downloaded.push(await downloadImage(reference));
  } catch (error) {
    await sendPlainText(message.chat.id, `Could not fetch the Telegram image: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  return downloaded;
}

async function deliverAuthorizedPrompt(message, route, text, { deliverAs, auditMessage, busyAck, idleAck } = {}) {
  const downloadedImages = await downloadAuthorizedImages(message, route);
  if (!downloadedImages) return;
  const content = downloadedImages.length > 0
    ? buildImagePromptContent(text || 'Please inspect the attached image.', downloadedImages.map((image) => image.image))
    : text;
  const activityStarted = await startActivityIndicator(route);
  const payload = Array.isArray(content) ? { content } : { text: content };
  await requestClient(route, 'deliverPrompt', {
    ...payload,
    deliverAs,
    auditMessage,
  });
  if (busyAck) {
    await sendPlainText(message.chat.id, busyAck);
    return;
  }
  if (idleAck) {
    await sendPlainText(message.chat.id, idleAck);
    return;
  }
  if (!activityStarted) await sendPlainText(message.chat.id, 'Prompt delivered to Pi.');
}

async function getLatestImages(route) {
  return await requestClient(route, 'getLatestImages');
}

async function getImageByPath(route, path) {
  return await requestClient(route, 'getImageByPath', { path });
}

function emptyImagesMessage(hasCandidates = false) {
  if (hasCandidates) {
    return 'The latest Pi output mentioned image-like file paths, but none could be sent. They may be missing, outside the workspace, hidden, unsupported, or too large. Try /send-image <relative-path> for a specific workspace PNG/JPEG/WebP file, or ask Pi to regenerate the image.';
  }
  return 'No image outputs are available for the latest completed Pi turn. /images can send captured image outputs or safe workspace image files mentioned in the latest Pi reply. If Pi saved an image file, use /send-image <relative-path>.';
}

async function sendImageByPath(message, route, path) {
  const loaded = await getImageByPath(route, path);
  if (!loaded?.ok) {
    await sendPlainText(message.chat.id, loaded?.error || 'Could not load that image file.');
    return;
  }
  const image = loaded.image;
  const byteSize = image.byteSize || base64ByteLength(image.data || '');
  if (!isAllowedImageMimeType(image.mimeType, allowedImageMimeTypes()) || byteSize > maxOutboundImageBytes()) {
    await sendPlainText(message.chat.id, 'Image file is too large or unsupported for Telegram delivery.');
    return;
  }
  await sendImageDocument(message.chat.id, image, 'Pi image file');
}

async function sendLatestImages(message, route) {
  const latest = route?.notification?.latestImages;
  const images = route ? await getLatestImages(route) : [];
  if (!latest || latest.count <= 0) {
    await sendPlainText(message.chat.id, emptyImagesMessage(false));
    return;
  }
  if (images.length === 0) {
    await sendPlainText(message.chat.id, emptyImagesMessage(Boolean(latest.fileCount > 0)));
    return;
  }
  let sent = 0;
  let skipped = latest.skipped || 0;
  for (const image of images) {
    const byteSize = image.byteSize || base64ByteLength(image.data || '');
    if (!isAllowedImageMimeType(image.mimeType, allowedImageMimeTypes()) || byteSize > maxOutboundImageBytes()) {
      skipped += 1;
      continue;
    }
    await sendImageDocument(
      message.chat.id,
      image,
      images.length === 1 ? 'Latest Pi image output' : `Latest Pi image output ${sent + 1}/${images.length}`,
    );
    sent += 1;
  }
  if (sent === 0) {
    await sendPlainText(message.chat.id, 'Latest image outputs are too large or unsupported for Telegram delivery.');
    return;
  }
  if (skipped > 0) await sendPlainText(message.chat.id, `Skipped ${skipped} image output(s) because they were too large or unsupported.`);
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
        `Busy: ${isEffectivelyBusy(route) ? 'yes' : 'no'}`,
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
    case 'images': {
      await sendLatestImages(message, route);
      return;
    }
    case 'send-image':
    case 'sendimage': {
      if (!args) {
        await sendPlainText(message.chat.id, 'Usage: /send-image <relative-image-path>');
        return;
      }
      await sendImageByPath(message, route, args);
      return;
    }
    case 'steer': {
      if (!args && !hasImageAttachments(message)) {
        await sendPlainText(message.chat.id, 'Usage: /steer <text>');
        return;
      }
      const busy = isEffectivelyBusy(route);
      await deliverAuthorizedPrompt(message, route, args || 'Please inspect the attached image.', {
        deliverAs: busy ? 'steer' : undefined,
        auditMessage: `Telegram ${getUserLabel(message.user)} sent a steering instruction.`,
        busyAck: busy ? 'Steering queued.' : undefined,
        idleAck: busy ? undefined : 'Sent as a prompt.',
      });
      return;
    }
    case 'followup': {
      if (!args && !hasImageAttachments(message)) {
        await sendPlainText(message.chat.id, 'Usage: /followup <text>');
        return;
      }
      const busy = isEffectivelyBusy(route);
      await deliverAuthorizedPrompt(message, route, args || 'Please inspect the attached image.', {
        deliverAs: busy ? 'followUp' : undefined,
        auditMessage: `Telegram ${getUserLabel(message.user)} queued a follow-up.`,
        busyAck: busy ? 'Follow-up queued.' : undefined,
        idleAck: busy ? undefined : 'Sent as a prompt.',
      });
      return;
    }
    case 'abort': {
      if (!isEffectivelyBusy(route)) {
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
      clearActivityIndicator(route);
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
      clearCustomAnswersForRoute(route);
      clearActivityIndicator(route);
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

  if (hasImageAttachments(message)) {
    takePendingCustomAnswer(route, message.user);
    const busy = isEffectivelyBusy(route);
    const deliverAs = busy ? config.busyDeliveryMode : undefined;
    await deliverAuthorizedPrompt(message, route, promptTextForMessage(message), {
      deliverAs,
      auditMessage: busy
        ? `Telegram ${getUserLabel(message.user)} queued an image ${deliverAs} message.`
        : `Telegram ${getUserLabel(message.user)} sent an image prompt.`,
      busyAck: busy ? `Pi is busy; your message was queued as ${deliverAs}.` : undefined,
    });
    return;
  }

  const pendingCustom = takePendingCustomAnswer(route, message.user);
  if (pendingCustom) {
    if (isGuidedAnswerCancel(message.text)) {
      await sendPlainText(message.chat.id, 'Custom answer cancelled.');
      return;
    }
    const currentTurnId = getCurrentTurnId(route);
    const metadata = hasAnswerableLatestOutput(route) ? route?.notification?.structuredAnswer : undefined;
    if (pendingCustom.expiresAt <= Date.now() || pendingCustom.turnId !== currentTurnId || !metadata || metadata.kind !== 'choice') {
      await sendPlainText(message.chat.id, 'That custom answer request is no longer current. Use the latest buttons or send a normal prompt.');
      return;
    }
    await deliverAnswerInjection(route, message, buildFreeTextChoiceInjection(metadata, message.text));
    await sendPlainText(message.chat.id, 'Sent your custom answer to Pi.');
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
  const busy = isEffectivelyBusy(route);
  const deliverAs = busy ? config.busyDeliveryMode : undefined;
  await deliverAuthorizedPrompt(message, route, message.text, {
    deliverAs,
    auditMessage: busy
      ? `Telegram ${getUserLabel(message.user)} queued a ${deliverAs} message.`
      : `Telegram ${getUserLabel(message.user)} sent a prompt.`,
    busyAck: busy ? `Pi is busy; your message was queued as ${deliverAs}.` : undefined,
  });
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

async function processCallback(callback) {
  const action = parseTelegramActionCallbackData(callback.data);
  if (!action) {
    await answerCallbackQuery(callback.callbackQueryId, 'Unknown action.');
    return;
  }

  const live = getLiveRoutesForChat(callback.chat.id, callback.user.id);
  const route = live.find((candidate) => getCurrentTurnId(candidate) === action.turnId)
    || live.find((candidate) => candidate.sessionKey === activeSessionByChatId.get(String(callback.chat.id)));

  if (!route) {
    const persisted = await getPersistedBindingsForChat(callback.chat.id, callback.user.id);
    await answerCallbackQuery(callback.callbackQueryId, persisted.length > 0 ? 'Pi session is offline.' : 'This chat is not paired.');
    if (persisted.length > 0) {
      await sendPlainText(callback.chat.id, 'The selected Pi session is currently offline. Resume it locally, then try again.');
    }
    return;
  }

  if (!routeIsAuthorized(route, callback.user)) {
    await answerCallbackQuery(callback.callbackQueryId, 'Unauthorized.');
    return;
  }

  if (route.binding?.paused) {
    await answerCallbackQuery(callback.callbackQueryId, 'Tunnel paused.');
    return;
  }

  const currentTurnId = getCurrentTurnId(route);
  if (!currentTurnId || action.turnId !== currentTurnId) {
    await answerCallbackQuery(callback.callbackQueryId, 'This action is no longer current.');
    await sendPlainText(
      callback.chat.id,
      action.kind === 'latest-images'
        ? 'That image action belongs to an older Pi output. Use the latest buttons or /images.'
        : 'That Telegram action belongs to an older Pi output. Use the latest buttons or /full.',
    );
    return;
  }

  switch (action.kind) {
    case 'answer-option': {
      const metadata = hasAnswerableLatestOutput(route) ? route.notification?.structuredAnswer : undefined;
      const option = metadata?.kind === 'choice' ? matchChoiceOption(metadata, action.optionId) : undefined;
      if (!metadata || !option) {
        await answerCallbackQuery(callback.callbackQueryId, 'No matching option.');
        return;
      }
      clearAnswerFlow(route);
      takePendingCustomAnswer(route, callback.user);
      await deliverAnswerInjection(route, callback, buildChoiceInjection(metadata, option));
      await answerCallbackQuery(callback.callbackQueryId, `Selected ${option.id}`);
      return;
    }
    case 'answer-custom': {
      const metadata = hasAnswerableLatestOutput(route) ? route.notification?.structuredAnswer : undefined;
      if (!metadata || metadata.kind !== 'choice') {
        await answerCallbackQuery(callback.callbackQueryId, 'No custom answer is available.');
        return;
      }
      setPendingCustomAnswer(route, callback.user, action.turnId);
      await answerCallbackQuery(callback.callbackQueryId, 'Send your custom answer.');
      await sendPlainText(callback.chat.id, "Send your custom answer as the next message, or send 'cancel' to stop.");
      return;
    }
    case 'full-chat': {
      const text = route.notification?.lastAssistantText;
      await answerCallbackQuery(callback.callbackQueryId, text ? 'Sending full output.' : 'No output available.');
      await sendPlainText(callback.chat.id, text || 'No completed assistant output is available yet for this session.');
      return;
    }
    case 'full-markdown': {
      const text = route.notification?.lastAssistantText;
      if (!text) {
        await answerCallbackQuery(callback.callbackQueryId, 'No output available.');
        await sendPlainText(callback.chat.id, 'No completed assistant output is available yet for this session.');
        return;
      }
      await answerCallbackQuery(callback.callbackQueryId, 'Sending Markdown file.');
      await sendMarkdownDocument(
        callback.chat.id,
        safeFilename(`pi-output-${route.sessionId}-${currentTurnId}`, 'md'),
        text,
        'Latest assistant output',
      );
      return;
    }
    case 'latest-images': {
      const latest = route.notification?.latestImages;
      if (!latest || latest.turnId !== action.turnId) {
        await answerCallbackQuery(callback.callbackQueryId, 'No current images.');
        await sendPlainText(callback.chat.id, 'That image action is no longer current. Use the latest buttons or /images.');
        return;
      }
      await answerCallbackQuery(callback.callbackQueryId, 'Sending image outputs.');
      await sendLatestImages(callback, route);
      return;
    }
  }
}

async function pollLoop() {
  while (!shuttingDown) {
    try {
      await cleanupExpiredPairings();
      const updates = await api.getUpdates({
        offset: updateOffset,
        timeout: config.pollingTimeoutSeconds || 20,
        allowed_updates: ['message', 'callback_query'],
      });
      for (const update of updates) {
        const message = update.message;
        const callback = update.callback_query;
        updateOffset = update.update_id + 1;
        if (message && message.from && message.chat) {
          const text = message.text || message.caption || '';
          const images = extractImageReferences(message);
          if (!text && images.length === 0) continue;
          await processInbound({
            updateId: update.update_id,
            messageId: message.message_id,
            text,
            images: images.length > 0 ? images : undefined,
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
          continue;
        }
        const callbackMessage = callback?.message;
        const callbackChat = callbackMessage?.chat;
        if (callback?.data && callback.from && callbackChat) {
          await processCallback({
            updateId: update.update_id,
            callbackQueryId: callback.id,
            messageId: callbackMessage.message_id,
            data: callback.data,
            chat: {
              id: callbackChat.id,
              type: callbackChat.type,
              title: 'title' in callbackChat ? callbackChat.title : undefined,
            },
            user: {
              id: callback.from.id,
              username: callback.from.username,
              firstName: callback.from.first_name,
              lastName: callback.from.last_name,
            },
          });
        }
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
    if (existing) {
      clearAnswerFlow(existing);
      clearCustomAnswersForRoute(existing);
      clearActivityIndicator(existing);
    }
    routes.delete(sessionKey);
  }
  clients.delete(socket);
  for (const [requestId, pending] of pendingClientRequests.entries()) {
    if (pending.socket === socket) {
      pending.reject(new Error('Client disconnected.'));
      pendingClientRequests.delete(requestId);
    }
  }
  if (!shuttingDown && routes.size === 0) {
    void shutdown();
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
        const nextRoute = { ...route, socket };
        if (previousRoute?.binding?.chatId !== nextRoute.binding?.chatId && previousRoute?.binding) {
          clearActivityIndicator(previousRoute);
        }
        routes.set(route.sessionKey, nextRoute);
        if (!route.notification?.structuredAnswer && previousRoute) {
          clearAnswerFlow(previousRoute);
        }
        clearStaleCustomAnswers(nextRoute);
        syncActivityIndicator(nextRoute);
        if (nextRoute.binding) {
          await upsertBinding(nextRoute.binding);
          if (!activeSessionByChatId.has(String(nextRoute.binding.chatId))) activeSessionByChatId.set(String(nextRoute.binding.chatId), nextRoute.sessionKey);
        }
        respond(true, true);
        return;
      }
      case 'unregisterRoute': {
        const client = clients.get(socket);
        client?.routes.delete(message.sessionKey);
        const existing = routes.get(message.sessionKey);
        if (existing) {
          clearAnswerFlow(existing);
          clearCustomAnswersForRoute(existing);
          clearActivityIndicator(existing);
        }
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
        syncActivityIndicator(route);
        await sendPlainText(route.binding.chatId, message.text, completionActionKeyboardForRoute(route));
        if (route.notification?.lastStatus === 'completed' && route.notification?.structuredAnswer) {
          await sendPlainText(
            route.binding.chatId,
            summarizeTailForTelegram(route.notification.structuredAnswer, {
              includeFullOutputActions: shouldOfferFullOutputActionsForRoute(route),
            }),
            answerActionKeyboardForRoute(route),
          );
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
  clearAllActivityIndicators();
  server.close();
  try { await unlink(socketPath); } catch {}
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
