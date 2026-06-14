import { unlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import net from 'node:net';
import lockfile from 'proper-lockfile';
import { createJiti } from '@mariozechner/jiti';
import { Api, GrammyError, HttpError, InputFile } from 'grammy';
import { appendTestTelegramOutbox, testTelegramOutboxPathFromEnv } from './test-telegram-outbox.js';

const jiti = createJiti(import.meta.url);
const [
  answerWorkflowModule,
  telegramActionsModule,
  telegramFormatModule,
  utilsModule,
  mediaModule,
  finalOutputModule,
  sessionMultiplexingModule,
  relayTelegramMiddlewareModule,
  relayMiddlewareModule,
  progressModule,
  commandsModule,
  commandSurfacesModule,
  requesterFileDeliveryModule,
  bindingAuthorityModule,
  telegramRouteBindingModule,
  approvalGatesModule,
  communicationDiagnosticsModule,
  skillInvocationModule,
] = await Promise.all([
  jiti.import('../core/guided-answer.ts'),
  jiti.import('../adapters/telegram/actions.ts'),
  jiti.import('../adapters/telegram/formatting.ts'),
  jiti.import('../core/utils.ts'),
  jiti.import('../media/index.ts'),
  jiti.import('../core/final-output.ts'),
  jiti.import('../core/session-selection.ts'),
  jiti.import('../adapters/telegram/middleware.ts'),
  jiti.import('../middleware/pipeline.ts'),
  jiti.import('../notifications/progress.ts'),
  jiti.import('../commands/remote.ts'),
  jiti.import('../commands/surfaces.ts'),
  jiti.import('../core/requester-file-delivery.ts'),
  jiti.import('../core/binding-authority.ts'),
  jiti.import('./telegram-route-binding.ts'),
  jiti.import('../core/approval-gates.ts'),
  jiti.import('../diagnostics/communication.ts'),
  jiti.import('../core/skill-invocation.ts'),
]);

function requiredFunction(module, modulePath, exportName) {
  const value = module?.[exportName];
  if (typeof value !== 'function') {
    throw new Error(`Broker startup failed: ${modulePath} missing function export ${exportName}.`);
  }
  return value;
}

function requiredNumber(module, modulePath, exportName) {
  const value = module?.[exportName];
  if (typeof value !== 'number') {
    throw new Error(`Broker startup failed: ${modulePath} missing number export ${exportName}.`);
  }
  return value;
}

function requiredString(module, modulePath, exportName) {
  const value = module?.[exportName];
  if (typeof value !== 'string') {
    throw new Error(`Broker startup failed: ${modulePath} missing string export ${exportName}.`);
  }
  return value;
}

const advanceGuidedAnswerFlow = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'advanceGuidedAnswerFlow');
const buildChoiceInjection = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'buildChoiceInjection');
const buildFreeTextChoiceInjection = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'buildFreeTextChoiceInjection');
const classifyAnswerIntent = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'classifyAnswerIntent');
const isGuidedAnswerStart = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'isGuidedAnswerStart');
const isGuidedAnswerCancel = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'isGuidedAnswerCancel');
const matchChoiceOption = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'matchChoiceOption');
const renderGuidedAnswerPrompt = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'renderGuidedAnswerPrompt');
const startGuidedAnswerFlow = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'startGuidedAnswerFlow');
const summarizeTailForTelegram = requiredFunction(answerWorkflowModule, './answer-workflow.ts', 'summarizeTailForTelegram');
const buildAnswerAmbiguityKeyboard = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'buildAnswerAmbiguityKeyboard');
const buildAnswerActionKeyboard = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'buildAnswerActionKeyboard');
const buildFullOutputKeyboard = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'buildFullOutputKeyboard');
const buildLatestImagesKeyboard = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'buildLatestImagesKeyboard');
const buildSessionDashboardKeyboard = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'buildSessionDashboardKeyboard');
const buildSessionListDashboardKeyboard = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'buildSessionListDashboardKeyboard');
const isIndexedSessionDashboardRef = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'isIndexedSessionDashboardRef');
const parseTelegramActionCallbackData = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'parseTelegramActionCallbackData');
const sessionDashboardRef = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'sessionDashboardRef');
const shouldOfferFullOutputActions = requiredFunction(telegramActionsModule, './telegram-actions.ts', 'shouldOfferFullOutputActions');
const containsMarkdownTable = requiredFunction(telegramFormatModule, './telegram-format.ts', 'containsMarkdownTable');
const formatTelegramChatText = requiredFunction(telegramFormatModule, './telegram-format.ts', 'formatTelegramChatText');
const formatTelegramChatMessageText = requiredFunction(telegramFormatModule, './telegram-format.ts', 'formatTelegramChatMessageText');
const DEFAULT_FINAL_OUTPUT_MAX_MESSAGE_CHUNKS = requiredNumber(finalOutputModule, './final-output.ts', 'DEFAULT_FINAL_OUTPUT_MAX_MESSAGE_CHUNKS');
const planFinalOutputDelivery = requiredFunction(finalOutputModule, './final-output.ts', 'planFinalOutputDelivery');
const base64ByteLength = requiredFunction(utilsModule, './utils.ts', 'base64ByteLength');
const acceptedInboundImageFormatsText = requiredFunction(mediaModule, './media/index.ts', 'acceptedInboundImageFormatsText');
const buildImagePromptContent = requiredFunction(utilsModule, './utils.ts', 'buildImagePromptContent');
const isAcceptedInboundImageMimeType = requiredFunction(mediaModule, './media/index.ts', 'isAcceptedInboundImageMimeType');
const isAllowedImageMimeType = requiredFunction(utilsModule, './utils.ts', 'isAllowedImageMimeType');
const prepareInboundImagePromptContent = requiredFunction(mediaModule, './media/index.ts', 'prepareInboundImagePromptContent');
const normalizeImageMimeType = requiredFunction(utilsModule, './utils.ts', 'normalizeImageMimeType');
const safeTelegramImageFilename = requiredFunction(utilsModule, './utils.ts', 'safeTelegramImageFilename');
const formatSessionList = requiredFunction(sessionMultiplexingModule, './session-multiplexing.ts', 'formatSessionList');
const resolveSessionSelector = requiredFunction(sessionMultiplexingModule, './session-multiplexing.ts', 'resolveSessionSelector');
const resolveSessionTargetArgs = requiredFunction(sessionMultiplexingModule, './session-multiplexing.ts', 'resolveSessionTargetArgs');
const sessionSourcePrefixForRoute = requiredFunction(sessionMultiplexingModule, './session-multiplexing.ts', 'sessionSourcePrefixForRoute');
const commandIntentFromPipeline = requiredFunction(relayTelegramMiddlewareModule, './relay-telegram-middleware.ts', 'commandIntentFromPipeline');
const runTelegramIngressPipeline = requiredFunction(relayTelegramMiddlewareModule, './relay-telegram-middleware.ts', 'runTelegramIngressPipeline');
const telegramActionFromPipelineResult = requiredFunction(relayTelegramMiddlewareModule, './relay-telegram-middleware.ts', 'telegramActionFromPipelineResult');
const relayPipelineProtocolVersion = requiredNumber(relayMiddlewareModule, './relay-middleware.ts', 'relayPipelineProtocolVersion');
const appendRecentActivity = requiredFunction(progressModule, './progress.ts', 'appendRecentActivity');
const displayProgressMode = requiredFunction(progressModule, './progress.ts', 'displayProgressMode');
const formatProgressUpdate = requiredFunction(progressModule, './progress.ts', 'formatProgressUpdate');
const formatRecentActivity = requiredFunction(progressModule, './progress.ts', 'formatRecentActivity');
const normalizeProgressMode = requiredFunction(progressModule, './progress.ts', 'normalizeProgressMode');
const progressIntervalMsFor = requiredFunction(progressModule, './progress.ts', 'progressIntervalMsFor');
const progressModeFor = requiredFunction(progressModule, './progress.ts', 'progressModeFor');
const recentActivityLimit = requiredFunction(progressModule, './progress.ts', 'recentActivityLimit');
const shouldSendProgressActivity = requiredFunction(progressModule, './progress.ts', 'shouldSendProgressActivity');
const HELP_TEXT = requiredString(commandsModule, './commands.ts', 'BROKER_HELP_TEXT');
const commandAllowsWhilePaused = requiredFunction(commandsModule, './commands.ts', 'commandAllowsWhilePaused');
const normalizeAliasArg = requiredFunction(commandsModule, './commands.ts', 'normalizeAliasArg');
const telegramBotCommands = requiredFunction(commandSurfacesModule, './surfaces.ts', 'telegramBotCommands');
const parseRemoteSendFileArgs = requiredFunction(requesterFileDeliveryModule, './requester-file-delivery.ts', 'parseRemoteSendFileArgs');
const authorityOutcomeAllowsDelivery = requiredFunction(bindingAuthorityModule, './binding-authority.ts', 'authorityOutcomeAllowsDelivery');
const bindingAuthorityStateFromData = requiredFunction(bindingAuthorityModule, './binding-authority.ts', 'bindingAuthorityStateFromData');
const resolveTelegramBindingAuthority = requiredFunction(bindingAuthorityModule, './binding-authority.ts', 'resolveTelegramBindingAuthority');
const stateUnavailableBindingAuthority = requiredFunction(bindingAuthorityModule, './binding-authority.ts', 'stateUnavailableBindingAuthority');
const telegramDestinationKey = requiredFunction(bindingAuthorityModule, './binding-authority.ts', 'telegramDestinationKey');
const routeWithPersistedTelegramBinding = requiredFunction(telegramRouteBindingModule, './telegram-route-binding.ts', 'routeWithPersistedTelegramBinding');
const parseApprovalActionData = requiredFunction(approvalGatesModule, './approval-gates.ts', 'parseApprovalActionData');
const parseApprovalTextCommand = requiredFunction(approvalGatesModule, './approval-gates.ts', 'parseApprovalTextCommand');
const createCommunicationDiagnosticsLogger = requiredFunction(communicationDiagnosticsModule, './communication-diagnostics.ts', 'createCommunicationDiagnosticsLogger');
const buildSkillInvocationPrompt = requiredFunction(skillInvocationModule, './skill-invocation.ts', 'buildSkillInvocationPrompt');
const filterRemoteSkills = requiredFunction(skillInvocationModule, './skill-invocation.ts', 'filterRemoteSkills');
const formatSkillList = requiredFunction(skillInvocationModule, './skill-invocation.ts', 'formatSkillList');
const isPendingSkillInputExpired = requiredFunction(skillInvocationModule, './skill-invocation.ts', 'isPendingSkillInputExpired');
const pendingSkillInputKey = requiredFunction(skillInvocationModule, './skill-invocation.ts', 'pendingSkillInputKey');
const resolveRemoteSkill = requiredFunction(skillInvocationModule, './skill-invocation.ts', 'resolveRemoteSkill');
const skillConfigForRelay = requiredFunction(skillInvocationModule, './skill-invocation.ts', 'skillConfigForRelay');

const socketPath = process.env.TELEGRAM_TUNNEL_BROKER_SOCKET_PATH;
const pidPath = process.env.TELEGRAM_TUNNEL_BROKER_PID_PATH;
const config = JSON.parse(process.env.TELEGRAM_TUNNEL_BROKER_CONFIG_JSON || '{}');
const diagnosticsConfig = JSON.parse(process.env.PI_RELAY_COMMUNICATION_DIAGNOSTICS_CONFIG_JSON || JSON.stringify(config.communicationDiagnostics || { enabled: false }));
const skipPolling = process.env.TELEGRAM_TUNNEL_BROKER_SKIP_POLLING === '1';
const testTelegramOutboxPath = testTelegramOutboxPathFromEnv(process.env);
const testIngressSecret = process.env.PI_RELAY_BROKER_TEST_INGRESS_SECRET;
let testFailNextEditableProgressSend = process.env.PI_RELAY_BROKER_TEST_FAIL_EDITABLE_PROGRESS_SEND_ONCE === '1';
const diagnosticsLogger = createCommunicationDiagnosticsLogger(diagnosticsConfig);
function recordDiagnostic(event) {
  if (!diagnosticsLogger.config?.enabled) return;
  void diagnosticsLogger.record(event);
}
function routeDiagnosticFields(route) {
  return route ? { sessionKey: route.sessionKey, sessionId: route.sessionId, sessionLabel: route.sessionLabel } : {};
}
if (!socketPath || !config?.botToken || !config?.stateDir) {
  throw new Error('Missing TELEGRAM_TUNNEL_BROKER_SOCKET_PATH or TELEGRAM_TUNNEL_BROKER_CONFIG_JSON');
}

const BROKER_PROTOCOL_VERSION = 1;

let hasRegisteredTelegramCommands = false;
let hasAttemptedTelegramBotCommandRegistration = false;
const api = new Api(config.botToken);
const clients = new Map();
const routes = new Map();
const pendingClientRequests = new Map();
const activeSessionByChatId = new Map();
const answerFlows = new Map();
const pendingCustomAnswers = new Map();
const pendingSkillInputs = new Map();
const pendingAnswerAmbiguities = new Map();
const activityIndicators = new Map();
const progressStates = new Map();
const statePath = `${config.stateDir}/state.json`;
let updateOffset;
let shuttingDown = false;

const TELEGRAM_ACTIVITY_ACTION = 'typing';
const TELEGRAM_ACTIVITY_INITIAL_REFRESH_MS = 1200;
const TELEGRAM_ACTIVITY_REFRESH_MS = 4000;
const CUSTOM_ANSWER_EXPIRY_MS = 10 * 60 * 1000;
const ANSWER_AMBIGUITY_EXPIRY_MS = 5 * 60 * 1000;
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
  const safe = prepareTelegramChatText(text);
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
  return chunks.map((chunk, index) => chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n${chunk}` : chunk);
}

function prepareTelegramChatText(text) {
  return formatTelegramChatText(redact(String(text || ''))).replace(/\r\n/g, '\n');
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

async function appendBrokerTestTelegramOutbox(event) {
  return appendTestTelegramOutbox(event, { outboxPath: testTelegramOutboxPath, recordDiagnostic });
}

let brokerTestTelegramMessageId = 10_000;

async function sendTelegramMessage(chatId, text, options) {
  if (await appendBrokerTestTelegramOutbox({ method: 'sendMessage', chatId, text, options })) return { message_id: brokerTestTelegramMessageId++ };
  return api.sendMessage(chatId, text, options);
}

async function editTelegramMessage(chatId, messageId, text, options) {
  if (await appendBrokerTestTelegramOutbox({ method: 'editMessageText', chatId, messageId, text, options })) return;
  return api.editMessageText(chatId, messageId, text, options);
}

async function sendTelegramDocument(chatId, document, options, testDocument) {
  if (await appendBrokerTestTelegramOutbox({ method: 'sendDocument', chatId, document: testDocument, options })) return;
  await api.sendDocument(chatId, document, options);
}

async function sendPreparedPlainText(chatId, text, keyboard) {
  const prepared = prepareTelegramChunkForSend(String(text || ''));
  const replyMarkup = keyboard ? { reply_markup: toReplyMarkup(keyboard) } : undefined;
  const options = { ...(replyMarkup || {}), ...(prepared.parseMode ? { parse_mode: prepared.parseMode } : {}) };
  recordDiagnostic({ component: 'broker', event: 'notification.send', messenger: 'telegram', outcome: 'attempt', conversationId: String(chatId), details: { kind: 'prepared-text', chunks: 1, hasKeyboard: Boolean(keyboard), textLength: String(text || '').length } });
  try {
    await withRetry(() => sendTelegramMessage(chatId, prepared.text, Object.keys(options).length > 0 ? options : undefined));
    recordDiagnostic({ component: 'broker', event: 'notification.send', messenger: 'telegram', outcome: 'sent', conversationId: String(chatId), details: { kind: 'prepared-text', chunks: 1 } });
  } catch (error) {
    recordDiagnostic({ component: 'broker', event: 'notification.send', messenger: 'telegram', outcome: 'error', severity: 'warning', conversationId: String(chatId), details: { kind: 'prepared-text', error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

async function sendEditablePlainText(chatId, text) {
  if (testFailNextEditableProgressSend) {
    testFailNextEditableProgressSend = false;
    throw new Error('Simulated editable progress send failure.');
  }
  const chunk = chunkText(text)[0] || '';
  const prepared = prepareTelegramChunkForSend(chunk);
  const options = prepared.parseMode ? { parse_mode: prepared.parseMode } : undefined;
  const message = await withRetry(() => sendTelegramMessage(chatId, prepared.text, options));
  return typeof message?.message_id === 'number' ? message.message_id : undefined;
}

async function editPlainText(chatId, messageId, text) {
  const chunk = chunkText(text)[0] || '';
  const prepared = prepareTelegramChunkForSend(chunk);
  const options = prepared.parseMode ? { parse_mode: prepared.parseMode } : undefined;
  await withRetry(() => editTelegramMessage(chatId, messageId, prepared.text, options));
}

async function sendPlainText(chatId, text, keyboard) {
  const chunks = chunkText(text);
  recordDiagnostic({ component: 'broker', event: 'notification.send', messenger: 'telegram', outcome: 'attempt', conversationId: String(chatId), details: { kind: 'text', chunks: chunks.length, hasKeyboard: Boolean(keyboard), textLength: String(text || '').length } });
  try {
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const prepared = prepareTelegramChunkForSend(chunk);
      const replyMarkup = keyboard && index === chunks.length - 1 ? { reply_markup: toReplyMarkup(keyboard) } : undefined;
      const options = { ...(replyMarkup || {}), ...(prepared.parseMode ? { parse_mode: prepared.parseMode } : {}) };
      await withRetry(() => sendTelegramMessage(chatId, prepared.text, Object.keys(options).length > 0 ? options : undefined));
    }
    recordDiagnostic({ component: 'broker', event: 'notification.send', messenger: 'telegram', outcome: 'sent', conversationId: String(chatId), details: { kind: 'text', chunks: chunks.length } });
  } catch (error) {
    recordDiagnostic({ component: 'broker', event: 'notification.send', messenger: 'telegram', outcome: 'error', severity: 'warning', conversationId: String(chatId), details: { kind: 'text', error: error instanceof Error ? error.message : String(error) } });
    throw error;
  }
}

function prepareTelegramChunkForSend(text) {
  const original = String(text || '');
  const rendered = formatTelegramChatMessageText(original);
  const maxChars = config.maxTelegramMessageChars || 3900;
  return rendered.text.length <= maxChars ? { text: rendered.text, parseMode: rendered.parseMode } : { text: original };
}

async function sendMarkdownDocument(chatId, filename, text, caption) {
  const redacted = redact(text);
  const redactedCaption = caption ? redact(caption) : undefined;
  await withRetry(() => sendTelegramDocument(
    chatId,
    new InputFile(Buffer.from(redacted, 'utf8'), filename),
    redactedCaption ? { caption: redactedCaption } : undefined,
    { fileName: filename, text: redacted, caption: redactedCaption },
  ));
}

function finalOutputDeliveryTarget() {
  return {
    displayName: 'Telegram',
    capabilities: {
      maxTextChars: config.maxTelegramMessageChars || 3900,
      documents: true,
    },
  };
}

async function sendCompletedFullOutput(route, binding, sourcePrefix, imageHint) {
  const text = route?.notification?.lastAssistantText;
  if (!text) return false;
  const durationMs = route.notification?.startedAt ? Date.now() - route.notification.startedAt : undefined;
  const durationLabel = durationMs ? `${Math.round(durationMs / 1000)}s` : 'unknown time';
  const plan = planFinalOutputDelivery(finalOutputDeliveryTarget(), route, text, {
    maxMessageChunks: DEFAULT_FINAL_OUTPUT_MAX_MESSAGE_CHUNKS,
    prepareText: prepareTelegramChatText,
  });
  if (plan.kind === 'messages') {
    await sendPlainText(binding.chatId, `${sourcePrefix}✅ Pi task completed in ${durationLabel}. Final output:`);
    const outputKeyboard = !route?.notification?.structuredAnswer ? fullOutputKeyboardForRoute(route) : undefined;
    for (let index = 0; index < plan.chunks.length; index += 1) {
      const keyboard = index === plan.chunks.length - 1 ? outputKeyboard : undefined;
      await sendPreparedPlainText(binding.chatId, plan.chunks[index], keyboard);
    }
    if (imageHint) await sendPlainText(binding.chatId, imageHint.trim(), latestImagesKeyboardForRoute(route));
    return true;
  }
  if (plan.kind === 'document') {
    await sendPlainText(binding.chatId, `${sourcePrefix}✅ Pi task completed in ${durationLabel}. Full output is attached as Markdown.${imageHint}`, latestImagesKeyboardForRoute(route));
    await sendMarkdownDocument(binding.chatId, plan.fileName, text, 'Latest assistant output');
    return true;
  }
  await sendPlainText(binding.chatId, `${sourcePrefix}✅ Pi task completed in ${durationLabel}. ${plan.message}${imageHint}`, latestImagesKeyboardForRoute(route));
  return true;
}

async function sendImageDocument(chatId, image, caption) {
  const bytes = Buffer.from(image.data, 'base64');
  const fileName = safeTelegramImageFilename(image.fileName, image.mimeType);
  await withRetry(() => sendTelegramDocument(
    chatId,
    new InputFile(bytes, fileName),
    caption ? { caption: redact(caption) } : undefined,
    { fileName, byteSize: bytes.byteLength, caption: caption ? redact(caption) : undefined },
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
    const supported = isAcceptedInboundImageMimeType(mimeType, allowedImageMimeTypes());
    references.push({
      kind: 'document',
      fileId: document.file_id,
      fileUniqueId: document.file_unique_id,
      fileName: typeof document.file_name === 'string' ? document.file_name : undefined,
      mimeType,
      fileSize: typeof document.file_size === 'number' ? document.file_size : undefined,
      supported,
      unsupportedReason: supported ? undefined : `Unsupported image document type: ${mimeType}. Accepted image formats: ${acceptedInboundImageFormatsText(allowedImageMimeTypes())}.`,
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
  const prepared = prepareInboundImagePromptContent(buffer, {
    mimeType: reference.mimeType,
    allowedMimeTypes: allowedImageMimeTypes(),
    maxBytes: maxInboundImageBytes(),
    fileName: reference.fileName,
    fallbackBase: reference.kind === 'photo' ? 'telegram-photo' : 'telegram-image',
  });
  return {
    image: prepared.image,
    fileName: prepared.fileName,
    fileSize: prepared.fileSize,
    source: reference,
  };
}

async function answerCallbackQuery(callbackQueryId, text) {
  await withRetry(() => api.answerCallbackQuery(callbackQueryId, text ? { text } : undefined));
}

async function sendChatAction(chatId, action = TELEGRAM_ACTIVITY_ACTION) {
  await withRetry(() => api.sendChatAction(chatId, action));
}

async function loadStateSnapshot() {
  try {
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return bindingAuthorityStateFromData({
      setup: parsed.setup,
      pendingPairings: parsed.pendingPairings || {},
      bindings: parsed.bindings || {},
      channelBindings: parsed.channelBindings || {},
      activeChannelSelections: parsed.activeChannelSelections || {},
      trustedRelayUsers: parsed.trustedRelayUsers || {},
      lifecycleNotifications: parsed.lifecycleNotifications || {},
      delegationTasks: parsed.delegationTasks || {},
      delegationAudit: parsed.delegationAudit || [],
      delegationHandledEvents: parsed.delegationHandledEvents || [],
      approvalRequests: parsed.approvalRequests || {},
      approvalGrants: parsed.approvalGrants || {},
      approvalAudit: parsed.approvalAudit || [],
    });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return bindingAuthorityStateFromData({ pendingPairings: {}, bindings: {}, channelBindings: {}, activeChannelSelections: {}, trustedRelayUsers: {}, lifecycleNotifications: {}, delegationTasks: {}, delegationAudit: [], delegationHandledEvents: [], approvalRequests: {}, approvalGrants: {}, approvalAudit: [] }, { missing: true });
    }
    return stateUnavailableBindingAuthority(error);
  }
}

async function loadState() {
  const snapshot = await loadStateSnapshot();
  return snapshot.kind === 'loaded' ? snapshot.data : { pendingPairings: {}, bindings: {}, channelBindings: {}, activeChannelSelections: {}, trustedRelayUsers: {}, lifecycleNotifications: {}, delegationTasks: {}, delegationAudit: [], delegationHandledEvents: [], approvalRequests: {}, approvalGrants: {}, approvalAudit: [] };
}

async function loadApprovalRequest(approvalId) {
  try {
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    const raw = await readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.approvalRequests?.[approvalId];
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function saveState(state) {
  await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
}

let stateUpdateQueue = Promise.resolve();

async function updateState(mutator) {
  const previous = stateUpdateQueue;
  let releaseQueue;
  const current = new Promise((resolve) => { releaseQueue = resolve; });
  stateUpdateQueue = current;
  await previous.catch(() => undefined);

  try {
    await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    const releaseLock = await lockfile.lock(config.stateDir, { realpath: false, stale: 60_000, retries: { retries: 10, minTimeout: 10, maxTimeout: 100 } });
    try {
      const state = await loadState();
      await mutator(state);
      await saveState(state);
      return state;
    } finally {
      await releaseLock();
    }
  } finally {
    releaseQueue();
    if (stateUpdateQueue === current) stateUpdateQueue = Promise.resolve();
  }
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
  if (state.setup) {
    if (!hasRegisteredTelegramCommands) void registerTelegramBotCommandMenu();
    return state.setup;
  }
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
  void registerTelegramBotCommandMenu();
  return setup;
}

async function registerTelegramBotCommandMenu() {
  if (hasRegisteredTelegramCommands || hasAttemptedTelegramBotCommandRegistration) return;
  hasAttemptedTelegramBotCommandRegistration = true;
  try {
    await api.setMyCommands(telegramBotCommands());
    hasRegisteredTelegramCommands = true;
  } catch (error) {
    console.warn(`Telegram command menu registration failed: ${redact(error instanceof Error ? error.message : String(error))}`);
  }
}

function routeToSessionEntry(route) {
  return {
    sessionKey: route.sessionKey,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    sessionLabel: route.sessionLabel,
    alias: route.binding?.alias,
    online: true,
    busy: isEffectivelyBusy(route),
    paused: Boolean(route.binding?.paused),
    modelId: route.modelId,
    lastActivityAt: route.lastActivityAt,
  };
}

function bindingToSessionEntry(binding) {
  return {
    sessionKey: binding.sessionKey,
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    sessionLabel: binding.sessionLabel,
    alias: binding.alias,
    online: false,
    busy: false,
    paused: Boolean(binding.paused),
  };
}

function getLiveRoutesForChat(chatId, userId) {
  return Array.from(routes.values()).filter((route) => route.binding?.chatId === chatId && route.binding?.userId === userId);
}

async function getActiveLiveRoutesForChat(chatId, userId, state = undefined) {
  const active = [];
  const snapshot = state ? bindingAuthorityStateFromData(state) : await loadStateSnapshot();
  if (snapshot.kind === 'state-unavailable') {
    for (const route of routes.values()) {
      if (route.binding?.chatId === chatId && route.binding?.userId === userId) active.push(route);
    }
    return active;
  }
  state = snapshot.data;
  for (const route of routes.values()) {
    const binding = await activeBindingForRoute(route, { includePaused: true, state });
    if (!binding) {
      if (route.binding?.chatId === chatId && route.binding?.userId === userId) route.binding = undefined;
      continue;
    }
    route.binding = binding;
    if (binding.chatId === chatId && binding.userId === userId) active.push(route);
  }
  return active;
}

async function getPersistedBindingsForChat(chatId, userId, state = undefined) {
  if (!state) {
    const snapshot = await loadStateSnapshot();
    if (snapshot.kind === 'state-unavailable') return undefined;
    state = snapshot.data;
  }
  return Object.values(state.bindings)
    .filter((binding) => binding.chatId === chatId && binding.userId === userId && binding.status !== 'revoked');
}

async function activeBindingForRoute(route, options = {}) {
  const binding = route?.binding;
  if (!binding) return undefined;
  const snapshot = options.snapshot ?? (options.state ? bindingAuthorityStateFromData(options.state) : await loadStateSnapshot());
  const outcome = resolveTelegramBindingAuthority(
    snapshot,
    { sessionKey: route.sessionKey, chatId: binding.chatId, userId: binding.userId, includePaused: options.includePaused, allowVolatileFallback: Boolean(options.allowVolatileFallback) },
    binding,
  );
  return authorityOutcomeAllowsDelivery(outcome) ? outcome.binding : undefined;
}

async function stripRevokedBindingFromRoute(route) {
  if (!route?.binding) return route;
  const snapshot = await loadStateSnapshot();
  const outcome = resolveTelegramBindingAuthority(
    snapshot,
    { sessionKey: route.sessionKey, chatId: route.binding.chatId, userId: route.binding.userId, includePaused: true, allowVolatileFallback: true },
    route.binding,
  );
  return authorityOutcomeAllowsDelivery(outcome) ? { ...route, binding: outcome.binding } : { ...route, binding: undefined };
}

async function getSessionEntriesForChat(chatId, userId) {
  const state = await loadState();
  const live = await getActiveLiveRoutesForChat(chatId, userId, state);
  const persisted = await getPersistedBindingsForChat(chatId, userId, state) ?? [];
  const seen = new Set(live.map((route) => route.sessionKey));
  return [
    ...live.map(routeToSessionEntry),
    ...persisted.filter((binding) => !seen.has(binding.sessionKey)).map(bindingToSessionEntry),
  ];
}

function sourcePrefixForRoute(route) {
  return route ? sessionSourcePrefixForRoute(route, routes.values()) : '';
}

async function resolveRouteForChat(chatId, userId) {
  const live = await getActiveLiveRoutesForChat(chatId, userId);
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

async function resolveApprovalRouteForTelegram(approvalId, chatId, userId) {
  const request = await loadApprovalRequest(approvalId);
  if (!request || request.requester?.channel !== 'telegram') return undefined;
  const route = routes.get(request.sessionKey);
  if (!route) return undefined;
  const state = await loadState();
  const persisted = state.bindings?.[request.sessionKey];
  if (persisted?.status !== 'revoked' && persisted.chatId === chatId && persisted.userId === userId) {
    route.binding = persisted;
  }
  return route;
}

async function resolveRouteSelectorForChat(chatId, userId, selector) {
  const entries = await getSessionEntriesForChat(chatId, userId);
  const result = resolveSessionSelector(entries, selector);
  const route = result.kind === 'matched' ? routes.get(result.entry.sessionKey) : undefined;
  return { result, route };
}

async function resolveToCommandTarget(chatId, userId, args) {
  const entries = await getSessionEntriesForChat(chatId, userId);
  const target = resolveSessionTargetArgs(entries, String(args || ''));
  const route = target.result.kind === 'matched' ? routes.get(target.result.entry.sessionKey) : undefined;
  return { ...target, route };
}

async function routeIsAuthorized(route, user) {
  const binding = await activeBindingForRoute(route, { includePaused: true });
  if (!binding) return false;
  if (binding.userId !== user.id) return false;
  if ((config.allowUserIds || []).length > 0 && !(config.allowUserIds || []).includes(user.id)) return false;
  route.binding = binding;
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
    const channel = route.channel || 'telegram';
    write(route.socket, {
      ...payload,
      type: 'request',
      requestId,
      protocolVersion: BROKER_PROTOCOL_VERSION,
      channel,
      action,
      sessionKey: route.sessionKey,
      pipeline: { protocolVersion: relayPipelineProtocolVersion, channel, action },
    });
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
  if (route?.notification?.structuredAnswer) return undefined;
  return combineKeyboards(
    fullOutputKeyboardForRoute(route),
    latestImagesKeyboardForRoute(route),
  );
}

function shouldOfferFullOutputActionsForRoute(route) {
  const text = route?.notification?.lastAssistantText;
  return shouldOfferFullOutputActions(text) || (text ? containsMarkdownTable(text) : false);
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

function getAmbiguityKey(route, userId, token) {
  return `${route.sessionKey}:${route.binding?.chatId ?? 'unbound'}:${userId}:${token}`;
}

function clearCustomAnswersForRoute(route) {
  for (const [key, pending] of pendingCustomAnswers.entries()) {
    if (pending.sessionKey === route.sessionKey) pendingCustomAnswers.delete(key);
  }
}

function clearAmbiguitiesForRoute(route) {
  for (const [key, pending] of pendingAnswerAmbiguities.entries()) {
    if (pending.sessionKey === route.sessionKey) pendingAnswerAmbiguities.delete(key);
  }
}

function clearAnswerStateForRoute(route) {
  clearAnswerFlow(route);
  clearCustomAnswersForRoute(route);
  clearAmbiguitiesForRoute(route);
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

function getPendingSkillKey(route, chatId, userId) {
  return pendingSkillInputKey({ channel: 'telegram', conversationId: String(chatId), userId: String(userId), sessionKey: route.sessionKey });
}

function setPendingSkillInput(route, chatId, userId, skillName) {
  pendingSkillInputs.set(getPendingSkillKey(route, chatId, userId), {
    channel: 'telegram',
    conversationId: String(chatId),
    userId: String(userId),
    sessionKey: route.sessionKey,
    skillName,
    expiresAt: Date.now() + skillConfigForRelay(config).pendingInputExpiryMs,
  });
}

function takePendingSkillInput(route, chatId, userId) {
  const key = getPendingSkillKey(route, chatId, userId);
  const pending = pendingSkillInputs.get(key);
  if (!pending) return undefined;
  pendingSkillInputs.delete(key);
  return pending;
}

async function skillCommandsForRoute(route) {
  const response = await requestClient(route, 'getSkillCommands');
  return Array.isArray(response) ? response : [];
}

async function sendSkillList(route, chatId) {
  const skillConfig = skillConfigForRelay(config);
  if (!skillConfig.enabled) {
    await sendPlainText(chatId, 'Remote skill invocation is disabled.');
    return;
  }
  let commands;
  try {
    commands = await skillCommandsForRoute(route);
  } catch {
    await sendPlainText(chatId, 'Could not load remote skill metadata for this session. The session may be offline or unavailable.');
    return;
  }
  const skills = filterRemoteSkills(commands, skillConfig);
  if (skills.length === 0) {
    await sendPlainText(chatId, 'No remote-invokable skills are available for this session.');
    return;
  }
  await sendPlainText(chatId, formatSkillList(skills));
}

async function invokeSkillForTelegram(route, message, skillName, input) {
  const skillConfig = skillConfigForRelay(config);
  if (!skillConfig.enabled) {
    await sendPlainText(message.chat.id, 'Remote skill invocation is disabled.');
    return;
  }
  let commands;
  try {
    commands = await skillCommandsForRoute(route);
  } catch {
    await sendPlainText(message.chat.id, 'Could not load remote skill metadata for this session. The session may be offline or unavailable.');
    return;
  }
  const resolved = resolveRemoteSkill(skillName, commands, skillConfig);
  if (resolved.kind !== 'ok') {
    await sendPlainText(message.chat.id, resolved.message);
    return;
  }
  let deliveryResult;
  try {
    deliveryResult = await requestClient(route, 'deliverPrompt', { text: buildSkillInvocationPrompt(resolved.skill.name, input), deliverAs: config.busyDeliveryMode, requester: requesterForMessage(route, message) });
  } catch {
    await sendPlainText(message.chat.id, 'Could not deliver the skill invocation to Pi. The session may be offline or unavailable.');
    return;
  }
  const deliveredAs = deliveryResult && typeof deliveryResult === 'object' && (deliveryResult.deliverAs === 'steer' || deliveryResult.deliverAs === 'followUp')
    ? deliveryResult.deliverAs
    : undefined;
  await requestClient(route, 'appendAudit', { message: `Telegram invoked remote skill ${resolved.skill.name}.` }).catch(() => undefined);
  await sendPlainText(message.chat.id, `Skill \`${resolved.skill.name}\` invocation accepted${deliveredAs ? ` (${deliveredAs})` : ''}.`);
}

function createAmbiguityToken() {
  return Math.random().toString(36).slice(2, 10);
}

function setPendingAmbiguity(route, user, turnId, text) {
  if (!route?.binding) return undefined;
  const token = createAmbiguityToken();
  pendingAnswerAmbiguities.set(getAmbiguityKey(route, user.id, token), {
    sessionKey: route.sessionKey,
    chatId: route.binding.chatId,
    userId: user.id,
    turnId,
    text,
    expiresAt: Date.now() + ANSWER_AMBIGUITY_EXPIRY_MS,
  });
  return token;
}

function takePendingAmbiguity(route, user, token) {
  if (!route?.binding) return undefined;
  const key = getAmbiguityKey(route, user.id, token);
  const pending = pendingAnswerAmbiguities.get(key);
  if (!pending) return undefined;
  pendingAnswerAmbiguities.delete(key);
  return pending;
}

function findPendingAmbiguity(route, user) {
  if (!route?.binding) return undefined;
  const prefix = `${route.sessionKey}:${route.binding.chatId}:${user.id}:`;
  for (const [key, pending] of pendingAnswerAmbiguities.entries()) {
    if (key.startsWith(prefix)) return [key.slice(prefix.length), pending];
  }
  return undefined;
}

async function deliverAnswerInjection(route, message, text) {
  const deliverAs = isEffectivelyBusy(route) ? config.busyDeliveryMode : undefined;
  await startActivityIndicator(route);
  await requestClient(route, 'deliverPrompt', {
    text,
    deliverAs,
    auditMessage: `Telegram ${getUserLabel(message.user)} answered a guided Telegram question flow.`,
    requester: requesterForMessage(route, message),
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
  return route?.binding ? telegramDestinationKey({ sessionKey: route.sessionKey, chatId: route.binding.chatId, userId: route.binding.userId }) : undefined;
}

function clearActivityIndicatorsForSession(sessionKey) {
  const prefix = `telegram:default:${sessionKey}:`;
  for (const key of activityIndicators.keys()) {
    if (key.startsWith(prefix)) clearActivityIndicatorByKey(key);
  }
}

function clearAllActivityIndicators() {
  for (const timer of activityIndicators.values()) {
    clearTimeout(timer);
  }
  activityIndicators.clear();
}

function clearActivityIndicator(route) {
  const key = getActivityKey(route);
  if (!key) {
    if (route?.sessionKey) clearActivityIndicatorsForSession(route.sessionKey);
    return;
  }
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
  const binding = await activeBindingForRoute(route, { includePaused: true });
  if (!key || !binding || binding.paused) return false;
  route.binding = binding;
  if (activityIndicators.has(key)) return true;

  const sent = await trySendActivityIndicator(binding.chatId);
  if (!sent) return false;
  scheduleActivityRefresh(route.sessionKey, binding.chatId, binding.userId, key, TELEGRAM_ACTIVITY_INITIAL_REFRESH_MS);
  return true;
}

function scheduleActivityRefresh(sessionKey, chatId, userId, key, delayMs = TELEGRAM_ACTIVITY_REFRESH_MS) {
  const timer = setTimeout(() => {
    void refreshActivityIndicator(sessionKey, chatId, userId, key);
  }, delayMs);
  unrefTimer(timer);
  activityIndicators.set(key, timer);
}

async function refreshActivityIndicator(sessionKey, chatId, userId, key) {
  const route = routes.get(sessionKey);
  const binding = await activeBindingForRoute(route, { includePaused: true });
  if (!route || !binding || binding.chatId !== chatId || (userId !== undefined && binding.userId !== userId) || binding.paused || !shouldContinueActivityIndicator(route)) {
    clearActivityIndicatorByKey(key);
    return;
  }
  route.binding = binding;

  const sent = await trySendActivityIndicator(chatId);
  if (!sent) {
    clearActivityIndicatorByKey(key);
    return;
  }
  if (!activityIndicators.has(key)) return;
  scheduleActivityRefresh(sessionKey, chatId, userId, key);
}

async function trySendActivityIndicator(chatId) {
  try {
    await sendChatAction(chatId, TELEGRAM_ACTIVITY_ACTION);
    return true;
  } catch {
    return false;
  }
}

function getProgressKey(route) {
  return route?.binding ? telegramDestinationKey({ sessionKey: route.sessionKey, chatId: route.binding.chatId, userId: route.binding.userId }) : undefined;
}

function clearProgressStatesForSession(sessionKey) {
  const prefix = `telegram:default:${sessionKey}:`;
  for (const [key] of progressStates) {
    if (key.startsWith(prefix)) clearProgressStateByKey(key);
  }
}

function clearAllProgressStates() {
  for (const state of progressStates.values()) {
    if (state.timer) clearTimeout(state.timer);
  }
  progressStates.clear();
}

function clearProgressStateByKey(key) {
  const state = progressStates.get(key);
  if (state?.timer) clearTimeout(state.timer);
  progressStates.delete(key);
}

function clearProgressState(route) {
  const key = getProgressKey(route);
  if (!key) {
    if (route?.sessionKey) clearProgressStatesForSession(route.sessionKey);
    return;
  }
  clearProgressStateByKey(key);
}

function syncProgressDelivery(route) {
  const event = route?.notification?.progressEvent;
  const key = getProgressKey(route);
  const deliverableEvent = event && (route?.notification?.lastStatus === 'running' || event.kind === 'compaction');
  if (!key || !event || !deliverableEvent || !route?.binding || route.binding.paused) {
    if (route?.notification?.lastStatus && isTerminalStatus(route.notification.lastStatus)) clearProgressState(route);
    return;
  }
  const mode = progressModeFor(route.binding, config);
  if (!shouldSendProgressActivity(mode, event)) return;
  let state = progressStates.get(key);
  if (!state) {
    state = { pending: [] };
    progressStates.set(key, state);
  }
  if (state.lastEventId === event.id) return;
  state.lastEventId = event.id;
  appendRecentActivity(route.notification, event, recentActivityLimit(config));
  state.pending.push(event);
  if (state.timer) return;
  const interval = progressIntervalMsFor(mode, config);
  const elapsed = state.lastSentAt ? Date.now() - state.lastSentAt : interval;
  const delay = Math.max(0, interval - elapsed);
  state.timer = setTimeout(() => {
    void flushProgress(route.sessionKey, route.binding.chatId, route.binding.userId, key);
  }, delay);
  unrefTimer(state.timer);
}

async function flushProgress(sessionKey, chatId, userId, key) {
  const state = progressStates.get(key);
  if (!state) return;
  state.timer = undefined;
  state.lastSentAt = Date.now();
  const route = routes.get(sessionKey);
  const binding = await activeBindingForRoute(route, { includePaused: true });
  if (!route || !binding || binding.chatId !== chatId || (userId !== undefined && binding.userId !== userId) || binding.paused) {
    clearProgressStateByKey(key);
    return;
  }
  route.binding = binding;
  const mode = progressModeFor(binding, config);
  const pending = state.pending.splice(0).filter((entry) => (route.notification?.lastStatus === 'running' || entry.kind === 'compaction') && shouldSendProgressActivity(mode, entry));
  if (pending.length === 0) {
    clearProgressStateByKey(key);
    return;
  }
  const text = formatProgressUpdate(pending, config, { header: false });
  if (!text) {
    clearProgressStateByKey(key);
    return;
  }
  state.lastSentAt = Date.now();
  const messageText = `${sourcePrefixForRoute(route)}${text}`;
  if (state.lastText === messageText) return;
  if (state.liveMessageId) {
    try {
      await editPlainText(chatId, state.liveMessageId, messageText);
      state.lastText = messageText;
      return;
    } catch {
      state.liveMessageId = undefined;
    }
  }
  try {
    state.liveMessageId = await sendEditablePlainText(chatId, messageText);
    state.lastText = messageText;
    return;
  } catch {
    state.liveMessageId = undefined;
  }
  try {
    await sendPlainText(chatId, messageText);
    state.lastText = messageText;
  } catch {
    state.liveMessageId = undefined;
  }
}

async function pairingHashForCode(nonce) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(nonce).digest('hex');
}

async function inspectPendingPairing(nonce, expectedChannel = 'telegram') {
  const nonceHash = await pairingHashForCode(nonce);
  const state = await loadState();
  const pairing = state.pendingPairings[nonceHash];
  if (!pairing) return { status: 'missing' };
  if (expectedChannel && pairing.channel && pairing.channel !== expectedChannel) return { status: 'wrong-channel', pairing };
  if (pairing.consumedAt) return { status: 'consumed', pairing };
  if (Date.parse(pairing.expiresAt) <= Date.now()) return { status: 'expired', pairing };
  return { status: 'active', pairing };
}

async function consumePendingPairing(nonce, expectedChannel = 'telegram') {
  const nonceHash = await pairingHashForCode(nonce);
  let found;
  await updateState((state) => {
    const pairing = state.pendingPairings[nonceHash];
    if (!pairing) return;
    if (expectedChannel && pairing.channel && pairing.channel !== expectedChannel) return;
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

async function revokeBindingForChat(sessionKey, chatId, userId) {
  let revoked;
  await updateState((state) => {
    const existing = state.bindings[sessionKey];
    if (!existing || existing.chatId !== chatId || existing.userId !== userId || existing.status === 'revoked') return;
    revoked = { ...existing, revokedAt: nowIso(), lastSeenAt: nowIso(), status: 'revoked' };
    state.bindings[sessionKey] = revoked;
  });
  return revoked;
}

async function handlePairStart(message, nonce) {
  if (!nonce) {
    await sendPlainText(message.chat.id, 'Missing pairing payload. Re-run /relay connect telegram in Pi and scan the new QR code.');
    return;
  }
  if (message.chat.type !== 'private') {
    await sendPlainText(message.chat.id, 'Pairing only works from a private Telegram chat with the bot.');
    return;
  }
  const inspected = await inspectPendingPairing(nonce, 'telegram');
  if (inspected.status !== 'active') {
    const text = inspected.status === 'wrong-channel'
      ? 'This pairing link belongs to a different messenger. Re-run /relay connect telegram in Pi.'
      : 'This pairing link is invalid or expired. Run /relay connect telegram again in Pi.';
    await sendPlainText(message.chat.id, text);
    return;
  }
  const pairing = inspected.pairing;
  const route = routes.get(pairing.sessionKey);
  if (!route) {
    await sendPlainText(message.chat.id, `The target Pi session (${pairing.sessionLabel}) is not online right now. Keep Pi running and retry this pairing link before it expires, or run /relay connect telegram locally again.`);
    return;
  }
  const allowedByList = (config.allowUserIds || []).length > 0 && (config.allowUserIds || []).includes(message.user.id);
  let approved = allowedByList;
  if (!approved) {
    try {
      approved = Boolean(await requestClient(route, 'confirmPairing', { identity: message.user }));
    } catch (error) {
      console.warn(`Telegram pairing approval failed for ${route.sessionLabel}: ${redact(error instanceof Error ? error.message : String(error))}`);
      await sendPlainText(message.chat.id, 'Pi did not respond to the pairing approval request. Keep Pi running and retry this pairing link before it expires, or run /relay connect telegram locally again.');
      return;
    }
  }
  if (!approved) {
    await consumePendingPairing(nonce, 'telegram');
    await sendPlainText(message.chat.id, 'Pairing was declined locally. Ask the Pi user to retry the connection flow.');
    return;
  }
  const consumed = await consumePendingPairing(nonce, 'telegram');
  if (!consumed) {
    await sendPlainText(message.chat.id, 'This pairing link was already used or expired. Run /relay connect telegram again in Pi.');
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
  await requestClient(route, 'persistBinding', { binding, revoked: false }).catch((error) => {
    console.warn(`Telegram pairing persisted in broker state but client persist failed for ${route.sessionLabel}: ${redact(error instanceof Error ? error.message : String(error))}`);
  });
  await requestClient(route, 'appendAudit', { message: `Telegram relay paired with ${getUserLabel(message.user)}.` }).catch((error) => {
    console.warn(`Telegram pairing audit failed for ${route.sessionLabel}: ${redact(error instanceof Error ? error.message : String(error))}`);
  });
  await sendPlainText(message.chat.id, `Connected to Pi session ${route.sessionLabel}. Send text prompts directly, or use /help for tunnel commands.`);
}

async function handleSessionsCommand(message) {
  const entries = await getSessionEntriesForChat(message.chat.id, message.user.id);
  await sendPlainText(message.chat.id, formatSessionList(entries, activeSessionByChatId.get(String(message.chat.id))), buildSessionListDashboardKeyboard(entries));
}

async function sendSelectorResolutionError(message, result, usageText, noMatchText = 'No matching session found. Use /sessions to list available sessions.') {
  switch (result.kind) {
    case 'empty':
      await sendPlainText(message.chat.id, 'No paired sessions found for this chat. Run /relay connect telegram [name] locally first.');
      return true;
    case 'missing':
      await sendPlainText(message.chat.id, usageText);
      return true;
    case 'no-match':
      await sendPlainText(message.chat.id, noMatchText);
      return true;
    case 'ambiguous':
      await sendPlainText(message.chat.id, 'That session label is ambiguous. Use /sessions and choose by number.');
      return true;
    case 'offline':
      await sendPlainText(message.chat.id, `Pi session ${result.entry.sessionLabel} is offline. Resume it locally, then try again.`);
      return true;
    default:
      return false;
  }
}

async function handleUseCommand(message, args) {
  const usageText = 'Usage: /use <number|label>. Use /sessions to list available sessions.';
  const selector = String(args || '').trim();
  if (!selector) {
    await sendPlainText(message.chat.id, usageText);
    return;
  }

  const { result, route } = await resolveRouteSelectorForChat(message.chat.id, message.user.id, selector);
  if (await sendSelectorResolutionError(message, result, usageText)) return;
  if (!route) {
    await sendPlainText(message.chat.id, 'No matching online session. Use /sessions to list available sessions.');
    return;
  }

  activeSessionByChatId.set(String(message.chat.id), route.sessionKey);
  await sendPlainText(message.chat.id, `Active session set to ${route.sessionLabel}.`);
}

async function handleForgetCommand(message, args) {
  const usageText = 'Usage: /forget <number|label>. Use /sessions to list available sessions.';
  const selector = String(args || '').trim();
  if (!selector) {
    await sendPlainText(message.chat.id, usageText);
    return;
  }

  const entries = await getSessionEntriesForChat(message.chat.id, message.user.id);
  const result = resolveSessionSelector(entries, selector);
  switch (result.kind) {
    case 'empty':
      await sendPlainText(message.chat.id, 'No paired sessions found for this chat. Run /relay connect telegram [name] locally first.');
      return;
    case 'missing':
      await sendPlainText(message.chat.id, usageText);
      return;
    case 'no-match':
      await sendPlainText(message.chat.id, 'No matching session found. Use /sessions to list available sessions.');
      return;
    case 'ambiguous':
      await sendPlainText(message.chat.id, 'That session label is ambiguous. Use /sessions and choose by number.');
      return;
    case 'matched':
      await sendPlainText(message.chat.id, `Pi session ${result.entry.sessionLabel} is online. Use /use ${result.index + 1} then /disconnect to revoke an active session.`);
      return;
    case 'offline': {
      const revoked = await revokeBindingForChat(result.entry.sessionKey, message.chat.id, message.user.id);
      if (!revoked) {
        await sendPlainText(message.chat.id, 'No matching offline session found. Use /sessions to list available sessions.');
        return;
      }
      if (activeSessionByChatId.get(String(message.chat.id)) === result.entry.sessionKey) activeSessionByChatId.delete(String(message.chat.id));
      await sendPlainText(message.chat.id, `Forgot offline Pi session ${result.entry.sessionLabel}.`);
      return;
    }
    default:
      await sendPlainText(message.chat.id, 'No matching session found. Use /sessions to list available sessions.');
  }
}

async function handleToCommand(message, args) {
  const usageText = 'Usage: /to <session> <prompt>. Use /sessions to list available sessions. Quote labels that contain spaces, for example /to "docs team" run tests.';
  const { selector, prompt, result, route } = await resolveToCommandTarget(message.chat.id, message.user.id, args);
  if (!selector || (!prompt && !hasImageAttachments(message))) {
    await sendPlainText(message.chat.id, usageText);
    return;
  }

  if (await sendSelectorResolutionError(message, result, usageText, 'No matching online session. Use /sessions to list available sessions.')) return;
  if (!route || !route.binding) {
    await sendPlainText(message.chat.id, 'No matching online session. Use /sessions to list available sessions.');
    return;
  }
  if (!(await routeIsAuthorized(route, message.user))) {
    await sendPlainText(message.chat.id, 'Unauthorized Telegram identity for this Pi session.');
    return;
  }
  if (route.binding.paused) {
    await sendPlainText(message.chat.id, `Pi session ${route.sessionLabel} is paused. Use /use ${result.index + 1} then /resume first.`);
    return;
  }

  clearAnswerStateForRoute(route);
  const busy = isEffectivelyBusy(route);
  const deliverAs = busy ? config.busyDeliveryMode : undefined;
  await deliverAuthorizedPrompt(message, route, prompt || promptTextForMessage({ ...message, text: '' }), {
    deliverAs,
    auditMessage: busy
      ? `Telegram ${getUserLabel(message.user)} sent a one-shot ${deliverAs} prompt to ${route.sessionLabel}.`
      : `Telegram ${getUserLabel(message.user)} sent a one-shot prompt to ${route.sessionLabel}.`,
    busyAck: busy ? `Pi session ${route.sessionLabel} is busy; your message was queued as ${deliverAs}.` : undefined,
    idleAck: busy ? undefined : `Prompt delivered to ${route.sessionLabel}.`,
  });
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

function requesterForMessage(route, message) {
  return {
    channel: 'telegram',
    instanceId: 'default',
    conversationId: String(message.chat.id),
    userId: String(message.user.id),
    sessionKey: route.sessionKey,
    safeLabel: `Telegram ${getUserLabel(message.user)}`,
    messageId: String(message.messageId || ''),
    conversationKind: message.chat.type,
    createdAt: Date.now(),
  };
}

function promptTextForMessage(message, fallback) {
  const text = String(message.text || '').trim();
  if (text) return text;
  if (fallback) return fallback;
  return messageImages(message).length > 1 ? 'Please inspect the attached images.' : 'Please inspect the attached image.';
}

async function downloadAuthorizedImages(message, route) {
  const references = messageImages(message);
  if (references.length === 0) return [];
  const unsupported = references.filter((reference) => !reference.supported);
  if (unsupported.length > 0) {
    await sendPlainText(message.chat.id, `Unsupported image attachment. Accepted image formats: ${acceptedInboundImageFormatsText(allowedImageMimeTypes())}.`);
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
    ? buildImagePromptContent(text || promptTextForMessage(message), downloadedImages.map((image) => image.image))
    : text;
  const activityStarted = await startActivityIndicator(route);
  const payload = Array.isArray(content) ? { content } : { text: content };
  await requestClient(route, 'deliverPrompt', {
    ...payload,
    deliverAs,
    auditMessage,
    requester: requesterForMessage(route, message),
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

async function deliverPlainPrompt(message, route, text) {
  clearAnswerStateForRoute(route);
  const busy = isEffectivelyBusy(route);
  const deliverAs = busy ? config.busyDeliveryMode : undefined;
  await deliverAuthorizedPrompt(message, route, text, {
    deliverAs,
    auditMessage: busy
      ? `Telegram ${getUserLabel(message.user)} queued a ${deliverAs} message.`
      : `Telegram ${getUserLabel(message.user)} sent a prompt.`,
    busyAck: busy ? `Pi is busy; your message was queued as ${deliverAs}.` : undefined,
  });
}

function ambiguityTextChoice(text) {
  const normalized = String(text || '').trim().toLowerCase();
  if (['send as prompt', 'as prompt', 'prompt'].includes(normalized)) return 'prompt';
  if (['answer previous', 'as answer', 'answer'].includes(normalized)) return 'answer';
  if (isGuidedAnswerCancel(normalized)) return 'cancel';
  return undefined;
}

async function resolveAmbiguity(message, route, pending, resolution) {
  const currentTurnId = getCurrentTurnId(route);
  const metadata = hasAnswerableLatestOutput(route) ? route?.notification?.structuredAnswer : undefined;
  if (resolution === 'cancel') {
    await sendPlainText(message.chat.id, 'Cancelled.');
    return;
  }
  if (pending.expiresAt <= Date.now() || pending.turnId !== currentTurnId) {
    await sendPlainText(message.chat.id, 'That answer confirmation is no longer current. Send your message again if needed.');
    return;
  }
  if (resolution === 'prompt') {
    await deliverPlainPrompt(message, route, pending.text);
    return;
  }
  if (!metadata) {
    await sendPlainText(message.chat.id, 'There is no current answerable output. Send your message again as a normal prompt.');
    return;
  }
  const result = advanceGuidedAnswerFlow(metadata, startGuidedAnswerFlow(), pending.text);
  if (!result.done || !result.injectionText) {
    await sendPlainText(message.chat.id, "I could not use that text as a complete answer. Send 'answer' to open the guided answer flow.");
    return;
  }
  clearAnswerStateForRoute(route);
  await deliverAnswerInjection(route, message, result.injectionText);
  await sendPlainText(message.chat.id, result.responseText);
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

function statusTextForRoute(route) {
  return [
    `Session: ${route.binding?.alias || route.sessionLabel}`,
    route.binding?.alias ? `Label: ${route.sessionLabel}` : undefined,
    'Online: yes',
    `Busy: ${isEffectivelyBusy(route) ? 'yes' : 'no'}`,
    `Model: ${route.modelId || 'unknown'}`,
    `Progress mode: ${displayProgressMode(route.binding?.progressMode || config.progressMode)}`,
    `Last activity: ${route.lastActivityAt ? new Date(route.lastActivityAt).toLocaleString() : 'unknown'}`,
    `Paused: ${route.binding?.paused ? 'yes' : 'no'}`,
  ].filter(Boolean).join('\n');
}

function dashboardKeyboardForRoute(route) {
  return buildSessionDashboardKeyboard('current', {
    paused: Boolean(route.binding?.paused),
    busy: isEffectivelyBusy(route),
    hasOutput: Boolean(route.notification?.lastAssistantText),
    hasImages: Boolean(route.notification?.latestImages?.count),
  });
}

async function sendRecentActivity(message, route) {
  await sendPlainText(message.chat.id, formatRecentActivity(route?.notification?.recentActivity, { limit: recentActivityLimit(config) }));
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
  const approvalCommand = parseApprovalTextCommand(command, args || '');
  if (approvalCommand) {
    const approvalRoute = await resolveApprovalRouteForTelegram(approvalCommand.approvalId, message.chat.id, message.user.id);
    if (!approvalRoute || !(await routeIsAuthorized(approvalRoute, message.user))) {
      await sendPlainText(message.chat.id, approvalRoute ? 'Unauthorized.' : 'Approval request is stale.');
      return;
    }
    try {
      const result = await requestClient(approvalRoute, 'resolveApprovalDecision', {
        decision: {
          approvalId: approvalCommand.approvalId,
          decision: approvalCommand.decision,
          channel: 'telegram',
          instanceId: 'default',
          conversationId: String(message.chat.id),
          userId: String(message.user.id),
        },
      });
      await sendPlainText(message.chat.id, result?.message || 'Approval decision handled.');
    } catch (error) {
      await sendPlainText(message.chat.id, `Approval request is stale or unavailable: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
    return;
  }
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
  if (command === 'forget') {
    await handleForgetCommand(message, args);
    return;
  }
  if (command === 'to') {
    await handleToCommand(message, args);
    return;
  }
  if (!route || !binding) {
    const persisted = await getPersistedBindingsForChat(message.chat.id, message.user.id);
    if (!persisted) {
      await sendPlainText(message.chat.id, 'Relay state is temporarily unavailable; retry shortly.');
    } else if (persisted.length > 0) {
      await sendPlainText(message.chat.id, 'The selected Pi session is currently offline. Resume it locally, then try again.');
    } else {
      await sendPlainText(message.chat.id, 'This chat is not paired to an active Pi session. Run /relay connect telegram locally first.');
    }
    return;
  }
  if (binding.paused && !commandAllowsWhilePaused(command)) {
    await sendPlainText(message.chat.id, 'The tunnel is currently paused. Use /resume or disconnect locally.');
    return;
  }

  switch (command) {
    case 'status': {
      await sendPlainText(message.chat.id, statusTextForRoute(route), dashboardKeyboardForRoute(route));
      return;
    }
    case 'progress':
    case 'notify': {
      const mode = normalizeProgressMode(args);
      if (!mode) {
        await sendPlainText(message.chat.id, `Progress mode: ${displayProgressMode(binding.progressMode || config.progressMode)}\nUsage: /progress <quiet|normal|verbose|completion-only>`);
        return;
      }
      route.binding = { ...binding, progressMode: mode, lastSeenAt: nowIso() };
      await upsertBinding(route.binding);
      await requestClient(route, 'persistBinding', { binding: route.binding, revoked: false });
      await sendPlainText(message.chat.id, `Progress notifications set to ${displayProgressMode(mode)}.`);
      return;
    }
    case 'alias': {
      route.binding = {
        ...binding,
        alias: normalizeAliasArg(String(args || '')),
        lastSeenAt: nowIso(),
      };
      await upsertBinding(route.binding);
      await requestClient(route, 'persistBinding', { binding: route.binding, revoked: false });
      await sendPlainText(message.chat.id, route.binding.alias ? `Session alias set to ${route.binding.alias}.` : 'Session alias cleared.');
      return;
    }
    case 'recent':
    case 'activity': {
      await sendRecentActivity(message, route);
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
    case 'cancel': {
      takePendingSkillInput(route, message.chat.id, message.user.id);
      await sendPlainText(message.chat.id, 'Skill input cancelled.');
      return;
    }
    case 'skills': {
      await sendSkillList(route, message.chat.id);
      return;
    }
    case 'skill': {
      const [rawName, ...rest] = String(args || '').trim().split(/\s+/);
      if (!rawName) {
        await sendPlainText(message.chat.id, 'Usage: /skill <name> [input]. Use /skills to list available skills.');
        return;
      }
      if (rawName.toLowerCase() === 'cancel') {
        takePendingSkillInput(route, message.chat.id, message.user.id);
        await sendPlainText(message.chat.id, 'Skill input cancelled.');
        return;
      }
      const input = rest.join(' ').trim();
      const skillConfig = skillConfigForRelay(config);
      if (!skillConfig.enabled) {
        await sendPlainText(message.chat.id, 'Remote skill invocation is disabled.');
        return;
      }
      if (!input) {
        let commands;
        try {
          commands = await skillCommandsForRoute(route);
        } catch {
          await sendPlainText(message.chat.id, 'Could not load remote skill metadata for this session. The session may be offline or unavailable.');
          return;
        }
        const resolved = resolveRemoteSkill(rawName, commands, skillConfig);
        if (resolved.kind !== 'ok') {
          await sendPlainText(message.chat.id, resolved.message);
          return;
        }
        setPendingSkillInput(route, message.chat.id, message.user.id, resolved.skill.name);
        await sendPlainText(message.chat.id, `Send input for skill ${resolved.skill.name} as your next message, or send /skill cancel.`);
        return;
      }
      await invokeSkillForTelegram(route, message, rawName, input);
      return;
    }
    case 'images': {
      await sendLatestImages(message, route);
      return;
    }
    case 'send-file':
    case 'sendfile': {
      const request = parseRemoteSendFileArgs(args || '');
      if (!request) {
        await sendPlainText(message.chat.id, 'Usage: /send-file <relative-path> [caption]');
        return;
      }
      const result = await requestClient(route, 'sendRequesterFile', {
        requester: requesterForMessage(route, message),
        relativePath: request.relativePath,
        caption: request.caption,
      });
      if (typeof result === 'string' && !result.startsWith('Delivered ')) await sendPlainText(message.chat.id, result);
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
      clearProgressState(route);
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
      clearAnswerStateForRoute(route);
      clearActivityIndicator(route);
      clearProgressState(route);
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
    const persisted = await getPersistedBindingsForChat(message.chat.id, message.user.id);
    if (!persisted) {
      await sendPlainText(message.chat.id, 'Relay state is temporarily unavailable; retry shortly.');
    } else if (persisted.length > 0) {
      await sendPlainText(message.chat.id, 'The selected Pi session is currently offline. Resume it locally, then try again.');
    } else {
      await sendPlainText(message.chat.id, 'This chat is not paired to an active Pi session. Run /relay connect telegram locally first.');
    }
    return;
  }
  if (route.binding.paused) {
    await sendPlainText(message.chat.id, 'The tunnel is paused. Use /resume first.');
    return;
  }

  const pendingSkill = takePendingSkillInput(route, message.chat.id, message.user.id);
  if (pendingSkill) {
    if (isPendingSkillInputExpired(pendingSkill)) {
      await sendPlainText(message.chat.id, 'That skill input request expired. Use /skill <name> again.');
      return;
    }
    await invokeSkillForTelegram(route, message, pendingSkill.skillName, message.text);
    return;
  }

  if (hasImageAttachments(message)) {
    clearAnswerStateForRoute(route);
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

  const pendingAmbiguity = findPendingAmbiguity(route, message.user);
  const ambiguityResolution = pendingAmbiguity ? ambiguityTextChoice(message.text) : undefined;
  if (pendingAmbiguity && ambiguityResolution) {
    pendingAnswerAmbiguities.delete(getAmbiguityKey(route, message.user.id, pendingAmbiguity[0]));
    await resolveAmbiguity(message, route, pendingAmbiguity[1], ambiguityResolution);
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

  const metadata = hasAnswerableLatestOutput(route) ? route?.notification?.structuredAnswer : undefined;
  const intent = classifyAnswerIntent(metadata, message.text);
  if (intent.kind === 'start-flow') {
    await startAnswerFlow(message, route);
    return;
  }
  if (metadata && (intent.kind === 'bare-option' || (intent.kind === 'explicit-answer' && intent.option))) {
    const option = intent.kind === 'bare-option' ? intent.option : intent.option;
    clearAnswerStateForRoute(route);
    await deliverAnswerInjection(route, message, buildChoiceInjection(metadata, option));
    await sendPlainText(message.chat.id, `Selected option ${option.id}: ${option.label}`);
    return;
  }
  if (metadata && intent.kind === 'explicit-answer') {
    const result = advanceGuidedAnswerFlow(metadata, startGuidedAnswerFlow(), message.text);
    if (result.done && result.injectionText) {
      clearAnswerStateForRoute(route);
      await deliverAnswerInjection(route, message, result.injectionText);
      await sendPlainText(message.chat.id, result.responseText);
      return;
    }
  }
  if (metadata && intent.kind === 'ambiguous') {
    const turnId = getCurrentTurnId(route);
    const token = turnId ? setPendingAmbiguity(route, message.user, turnId, message.text) : undefined;
    if (turnId && token) {
      await sendPlainText(
        message.chat.id,
        "This could be an answer to the previous Pi question or a new prompt. What should I do?\n\nYou can also reply: 'send as prompt', 'answer previous', or 'cancel'.",
        buildAnswerAmbiguityKeyboard(turnId, token),
      );
      return;
    }
  }
  await deliverPlainPrompt(message, route, message.text);
}

async function processInbound(message) {
  recordDiagnostic({ component: 'telegram', event: 'ingress.message', outcome: 'received', messenger: 'telegram', instanceId: 'default', conversationId: String(message.chat.id), userId: String(message.user.id), updateId: message.updateId, details: { chatType: message.chat.type, hasText: Boolean(message.text), imageCount: message.images?.length ?? 0 } });
  const initialPipeline = await runTelegramIngressPipeline(message, { authorized: false, config });
  const command = commandIntentFromPipeline(initialPipeline.result) || parseCommand(message.text);
  if (command?.command === 'start') {
    await handlePairStart(message, command.args);
    return;
  }

  const { route, ambiguous } = await resolveRouteForChat(message.chat.id, message.user.id);
  if (route && !(await routeIsAuthorized(route, message.user))) {
    recordDiagnostic({ component: 'telegram', event: 'ingress.message', outcome: 'unauthorized', messenger: 'telegram', instanceId: 'default', conversationId: String(message.chat.id), userId: String(message.user.id), updateId: message.updateId, ...routeDiagnosticFields(route) });
    await sendPlainText(message.chat.id, 'Unauthorized Telegram identity for this Pi session.');
    return;
  }
  const approvalCommand = command ? parseApprovalTextCommand(command.command, command.args || '') : undefined;
  if (ambiguous && !approvalCommand && command?.command !== 'sessions' && command?.command !== 'use' && command?.command !== 'forget' && command?.command !== 'to') {
    recordDiagnostic({ component: 'telegram', event: 'ingress.message', outcome: 'ambiguous-route', messenger: 'telegram', instanceId: 'default', conversationId: String(message.chat.id), userId: String(message.user.id), updateId: message.updateId, command: command?.command });
    await sendPlainText(message.chat.id, 'Multiple Pi sessions are paired to this chat. Use /sessions then /use <session> first.');
    return;
  }
  if (route?.binding) {
    route.binding.lastSeenAt = nowIso();
    await upsertBinding(route.binding);
  }

  const authorizedPipeline = route ? await runTelegramIngressPipeline(message, {
    authorized: Boolean(route.binding),
    config,
    route: {
      sessionKey: route.sessionKey,
      sessionLabel: route.sessionLabel,
      online: true,
      busy: isEffectivelyBusy(route),
      paused: Boolean(route.binding?.paused),
    },
  }) : undefined;
  const authorizedCommand = (authorizedPipeline && commandIntentFromPipeline(authorizedPipeline.result)) || command;

  if (authorizedCommand) {
    recordDiagnostic({ component: 'telegram', event: 'command', outcome: 'dispatch', messenger: 'telegram', instanceId: 'default', conversationId: String(message.chat.id), userId: String(message.user.id), updateId: message.updateId, command: authorizedCommand.command, ...routeDiagnosticFields(route) });
    await handleAuthorizedCommand(message, route, authorizedCommand.command, authorizedCommand.args);
    return;
  }

  recordDiagnostic({ component: 'telegram', event: 'ingress.message', outcome: route ? 'text-dispatch' : 'no-route', messenger: 'telegram', instanceId: 'default', conversationId: String(message.chat.id), userId: String(message.user.id), updateId: message.updateId, ...routeDiagnosticFields(route) });
  await handleAuthorizedText(message, route);
}

async function handleDashboardAction(callback, route, action) {
  if (!route?.binding) {
    await answerCallbackQuery(callback.callbackQueryId, 'This session is not paired.');
    return;
  }
  switch (action) {
    case 'use':
      activeSessionByChatId.set(String(callback.chat.id), route.sessionKey);
      await answerCallbackQuery(callback.callbackQueryId, 'Active session selected.');
      await sendPlainText(callback.chat.id, `Active session set to ${route.binding.alias || route.sessionLabel}.`);
      return;
    case 'status':
      await answerCallbackQuery(callback.callbackQueryId, 'Showing status.');
      await sendPlainText(callback.chat.id, statusTextForRoute(route), dashboardKeyboardForRoute(route));
      return;
    case 'recent':
      await answerCallbackQuery(callback.callbackQueryId, 'Showing recent activity.');
      await sendRecentActivity(callback, route);
      return;
    case 'full':
      await answerCallbackQuery(callback.callbackQueryId, route.notification?.lastAssistantText ? 'Sending full output.' : 'No output available.');
      await sendPlainText(callback.chat.id, route.notification?.lastAssistantText || 'No completed assistant output is available yet for this session.');
      return;
    case 'images':
      await answerCallbackQuery(callback.callbackQueryId, 'Sending image outputs.');
      await sendLatestImages(callback, route);
      return;
    case 'pause':
      route.binding = { ...route.binding, paused: true, lastSeenAt: nowIso() };
      clearActivityIndicator(route);
      clearProgressState(route);
      await upsertBinding(route.binding);
      await requestClient(route, 'persistBinding', { binding: route.binding, revoked: false });
      await answerCallbackQuery(callback.callbackQueryId, 'Tunnel paused.');
      await sendPlainText(callback.chat.id, 'Tunnel paused. Remote prompts and notifications are suspended until /resume.');
      return;
    case 'resume':
      route.binding = { ...route.binding, paused: false, lastSeenAt: nowIso() };
      await upsertBinding(route.binding);
      await requestClient(route, 'persistBinding', { binding: route.binding, revoked: false });
      await answerCallbackQuery(callback.callbackQueryId, 'Tunnel resumed.');
      await sendPlainText(callback.chat.id, 'Tunnel resumed.');
      return;
    case 'abort':
      if (!isEffectivelyBusy(route)) {
        await answerCallbackQuery(callback.callbackQueryId, 'Session is idle.');
        await sendPlainText(callback.chat.id, 'The Pi session is already idle.');
        return;
      }
      route.notification = { ...(route.notification || {}), abortRequested: true };
      await requestClient(route, 'abort', { auditMessage: `Telegram ${getUserLabel(callback.user)} requested abort from dashboard.` });
      await answerCallbackQuery(callback.callbackQueryId, 'Abort requested.');
      await sendPlainText(callback.chat.id, 'Abort requested.');
      return;
    case 'compact':
      await requestClient(route, 'compact', { auditMessage: `Telegram ${getUserLabel(callback.user)} requested compaction from dashboard.` });
      await answerCallbackQuery(callback.callbackQueryId, 'Compaction requested.');
      await sendPlainText(callback.chat.id, 'Compaction requested.');
      return;
    default:
      await answerCallbackQuery(callback.callbackQueryId, 'Unknown dashboard action.');
  }
}

async function processCallback(callback) {
  recordDiagnostic({ component: 'telegram', event: 'ingress.callback', outcome: 'received', messenger: 'telegram', instanceId: 'default', conversationId: String(callback.chat.id), userId: String(callback.user.id), updateId: callback.updateId, details: { hasData: Boolean(callback.data) } });
  const approvalAction = parseApprovalActionData(callback.data || '');
  if (approvalAction) {
    const route = await resolveApprovalRouteForTelegram(approvalAction.approvalId, callback.chat.id, callback.user.id);
    if (!route || !(await routeIsAuthorized(route, callback.user))) {
      await answerCallbackQuery(callback.callbackQueryId, route ? 'Unauthorized.' : 'Approval request is stale.');
      return;
    }
    try {
      const result = await requestClient(route, 'resolveApprovalDecision', {
        decision: {
          approvalId: approvalAction.approvalId,
          decision: approvalAction.decision,
          channel: 'telegram',
          instanceId: 'default',
          conversationId: String(callback.chat.id),
          userId: String(callback.user.id),
        },
      });
      await answerCallbackQuery(callback.callbackQueryId, result?.message || 'Approval decision handled.');
    } catch (error) {
      await answerCallbackQuery(callback.callbackQueryId, `Approval request is stale or unavailable: ${redact(error instanceof Error ? error.message : String(error))}`);
    }
    return;
  }

  const initialPipeline = await runTelegramIngressPipeline(callback, { authorized: false, config });
  const action = telegramActionFromPipelineResult(initialPipeline.result) || parseTelegramActionCallbackData(callback.data);
  if (!action) {
    await answerCallbackQuery(callback.callbackQueryId, 'Unknown action.');
    return;
  }

  const live = await getActiveLiveRoutesForChat(callback.chat.id, callback.user.id);
  let route;
  if (action.kind === 'dashboard' && action.sessionRef !== 'current') {
    const entries = await getSessionEntriesForChat(callback.chat.id, callback.user.id);
    const entry = isIndexedSessionDashboardRef(action.sessionRef)
      ? entries[Number(action.sessionRef.slice(1)) - 1]
      : entries.find((candidate) => sessionDashboardRef(candidate.sessionKey) === action.sessionRef);
    if (!entry) {
      await answerCallbackQuery(callback.callbackQueryId, 'This dashboard is stale.');
      await sendPlainText(callback.chat.id, 'That session dashboard is stale. Use /sessions for the latest list.');
      return;
    }
    route = entry.online ? routes.get(entry.sessionKey) : undefined;
    if (!route) {
      await answerCallbackQuery(callback.callbackQueryId, 'Pi session is offline.');
      await sendPlainText(callback.chat.id, `Pi session ${entry.alias || entry.sessionLabel} is offline. Resume it locally, then try again.`);
      return;
    }
  } else {
    route = action.kind !== 'dashboard'
      ? live.find((candidate) => getCurrentTurnId(candidate) === action.turnId)
      : undefined;
    route = route || live.find((candidate) => candidate.sessionKey === activeSessionByChatId.get(String(callback.chat.id)));
  }

  if (!route) {
    const persisted = await getPersistedBindingsForChat(callback.chat.id, callback.user.id);
    if (!persisted) {
      await answerCallbackQuery(callback.callbackQueryId, 'Relay state unavailable.');
      return;
    }
    await answerCallbackQuery(callback.callbackQueryId, persisted.length > 0 ? 'Pi session is offline.' : 'This chat is not paired.');
    if (persisted.length > 0) {
      await sendPlainText(callback.chat.id, 'The selected Pi session is currently offline. Resume it locally, then try again.');
    }
    return;
  }

  if (!(await routeIsAuthorized(route, callback.user))) {
    await answerCallbackQuery(callback.callbackQueryId, 'Unauthorized.');
    return;
  }

  if (action.kind === 'dashboard') {
    await handleDashboardAction(callback, route, action.action);
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
    case 'answer-ambiguity': {
      const pending = takePendingAmbiguity(route, callback.user, action.token);
      if (!pending || pending.expiresAt <= Date.now() || pending.turnId !== currentTurnId) {
        await answerCallbackQuery(callback.callbackQueryId, 'This confirmation is no longer current.');
        await sendPlainText(callback.chat.id, 'That answer confirmation is no longer current. Send your message again if needed.');
        return;
      }
      await answerCallbackQuery(callback.callbackQueryId, action.resolution === 'prompt' ? 'Sending as prompt.' : action.resolution === 'answer' ? 'Answering previous.' : 'Cancelled.');
      await resolveAmbiguity({ ...callback, text: pending.text }, route, pending, action.resolution);
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

function mergeInboundAlbumMessage(albums, inbound, message, mediaGroupId) {
  if (!mediaGroupId || !message.images || message.images.length === 0) {
    inbound.push(message);
    return;
  }

  const groupKey = `${message.chat.id}:${message.user.id}:${mediaGroupId}`;
  const existing = albums.get(groupKey);
  if (!existing) {
    albums.set(groupKey, message);
    return;
  }

  existing.updateId = Math.max(existing.updateId, message.updateId);
  existing.images = [...(existing.images || []), ...(message.images || [])];
  if (!existing.text && message.text) {
    existing.text = message.text;
  } else if (existing.text && message.text && existing.text !== message.text) {
    existing.text = `${existing.text}\n${message.text}`;
  }
}

function normalizeTelegramUpdates(updates) {
  const inbound = [];
  const albums = new Map();

  for (const update of updates) {
    const message = update.message;
    const callback = update.callback_query;
    if (message && message.from && message.chat) {
      const text = message.text || message.caption || '';
      const images = extractImageReferences(message);
      if (!text && images.length === 0) continue;
      mergeInboundAlbumMessage(albums, inbound, {
        kind: 'message',
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
      }, typeof message.media_group_id === 'string' ? message.media_group_id : undefined);
      continue;
    }

    const callbackMessage = callback?.message;
    const callbackChat = callbackMessage?.chat;
    if (callback?.data && callback.from && callbackChat) {
      inbound.push({
        kind: 'callback',
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

  return [...inbound, ...albums.values()].sort((left, right) => left.updateId - right.updateId);
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
      if (updates.length > 0) {
        updateOffset = Math.max(...updates.map((update) => update.update_id)) + 1;
      }
      for (const update of normalizeTelegramUpdates(updates)) {
        if (update.kind === 'callback') await processCallback(update);
        else await processInbound(update);
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
      clearAnswerStateForRoute(existing);
      clearActivityIndicator(existing);
      clearProgressState(existing);
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
  recordDiagnostic({ component: 'broker', event: 'client.request', outcome: 'received', action: message.action, details: { requestId: message.requestId, clientId: message.clientId } });
  const respond = (ok, result, error) => write(socket, { type: 'response', requestId: message.requestId, ok, result, error });
  try {
    switch (message.action) {
      case 'ensureSetup': {
        const setup = await ensureSetup();
        respond(true, setup);
        return;
      }
      case 'registerRoute': {
        const state = await loadState();
        const route = await stripRevokedBindingFromRoute(routeWithPersistedTelegramBinding(message.route, state));
        if (!clients.has(socket)) clients.set(socket, { clientId: message.clientId, routes: new Set() });
        const client = clients.get(socket);
        client.clientId = message.clientId;
        client.routes.add(route.sessionKey);
        const previousRoute = routes.get(route.sessionKey);
        const nextRoute = { ...route, socket };
        if (previousRoute?.binding?.chatId !== nextRoute.binding?.chatId && previousRoute?.binding) {
          clearActivityIndicator(previousRoute);
          clearProgressState(previousRoute);
        }
        routes.set(route.sessionKey, nextRoute);
        if (previousRoute && getCurrentTurnId(previousRoute) !== getCurrentTurnId(nextRoute)) {
          clearAnswerStateForRoute(previousRoute);
        } else if (!route.notification?.structuredAnswer && previousRoute) {
          clearAnswerFlow(previousRoute);
        }
        clearStaleCustomAnswers(nextRoute);
        syncActivityIndicator(nextRoute);
        syncProgressDelivery(nextRoute);
        if (nextRoute.binding) {
          await upsertBinding(nextRoute.binding);
          if (!activeSessionByChatId.has(String(nextRoute.binding.chatId))) activeSessionByChatId.set(String(nextRoute.binding.chatId), nextRoute.sessionKey);
        }
        recordDiagnostic({ component: 'broker', event: 'route.register', outcome: 'ok', ...routeDiagnosticFields(nextRoute), details: { bound: Boolean(nextRoute.binding), busy: isEffectivelyBusy(nextRoute), hasAssistantText: Boolean(nextRoute.notification?.lastAssistantText), lastStatus: nextRoute.notification?.lastStatus } });
        respond(true, true);
        return;
      }
      case 'unregisterRoute': {
        const client = clients.get(socket);
        client?.routes.delete(message.sessionKey);
        const existing = routes.get(message.sessionKey);
        if (existing) {
          clearAnswerStateForRoute(existing);
          clearActivityIndicator(existing);
          clearProgressState(existing);
        }
        routes.delete(message.sessionKey);
        recordDiagnostic({ component: 'broker', event: 'route.unregister', outcome: existing ? 'removed' : 'missing', sessionKey: message.sessionKey });
        respond(true, true);
        return;
      }
      case 'sendToBoundChat': {
        const route = routes.get(message.sessionKey);
        const binding = await activeBindingForRoute(route, { includePaused: true });
        if (!route || !binding || binding.paused) {
          recordDiagnostic({ component: 'broker', event: 'send_to_bound_chat', outcome: 'suppressed', sessionKey: message.sessionKey, details: { hasRoute: Boolean(route), hasBinding: Boolean(binding), paused: Boolean(binding?.paused) } });
          respond(true, false);
          return;
        }
        route.binding = binding;
        syncActivityIndicator(route);
        const sourcePrefix = sourcePrefixForRoute(route);
        const imageHint = message.terminalStatus === 'completed' && !route.notification?.structuredAnswer && route.notification?.latestImages?.count
          ? `\n\n🖼 ${route.notification.latestImages.count} image output/file(s) available. Use /images to download.`
          : '';
        const sentCompletedFullOutput = message.terminalStatus === 'completed' && await sendCompletedFullOutput(route, binding, sourcePrefix, imageHint);
        if (!sentCompletedFullOutput) {
          await sendPlainText(binding.chatId, `${sourcePrefix}${message.text}`, completionActionKeyboardForRoute(route));
        }
        if (route.notification?.lastStatus === 'completed' && route.notification?.structuredAnswer) {
          await sendPlainText(
            binding.chatId,
            `${sourcePrefix}${summarizeTailForTelegram(route.notification.structuredAnswer, {
              includeFullOutputActions: shouldOfferFullOutputActionsForRoute(route),
            })}`,
            answerActionKeyboardForRoute(route),
          );
        }
        recordDiagnostic({ component: 'broker', event: 'send_to_bound_chat', outcome: 'sent', ...routeDiagnosticFields(route), details: { textLength: String((sentCompletedFullOutput ? route.notification?.lastAssistantText : message.text) || '').length, terminalStatus: message.terminalStatus } });
        respond(true, true);
        return;
      }
      case 'testProcessInbound': {
        if (!skipPolling || !testIngressSecret || message.testIngressSecret !== testIngressSecret) {
          respond(false, undefined, 'Test inbound processing is unavailable.');
          return;
        }
        await processInbound(message.message);
        respond(true, true);
        return;
      }
      default:
        respond(false, undefined, `Unknown client action: ${message.action}`);
    }
  } catch (error) {
    recordDiagnostic({ component: 'broker', event: 'client.request', outcome: 'error', severity: 'warning', action: message.action, details: { error: error instanceof Error ? error.message : String(error) } });
    respond(false, undefined, error instanceof Error ? error.message : String(error));
  }
}

await mkdir(config.stateDir, { recursive: true, mode: 0o700 });
try { await unlink(socketPath); } catch {}
if (pidPath) await writeFile(pidPath, `${process.pid}\n`, { mode: 0o600 }).catch(() => undefined);

const server = net.createServer((socket) => {
  recordDiagnostic({ component: 'broker', event: 'socket.connect', outcome: 'accepted', details: { clients: clients.size + 1 } });
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
  socket.on('close', () => { recordDiagnostic({ component: 'broker', event: 'socket.close', outcome: 'closed' }); removeClient(socket); });
  socket.on('error', (error) => { recordDiagnostic({ component: 'broker', event: 'socket.error', outcome: 'error', severity: 'warning', details: { error: error instanceof Error ? error.message : String(error) } }); removeClient(socket); });
});

server.listen(socketPath, async () => {
  await ensureSetup().catch(() => undefined);
  if (!skipPolling) void pollLoop();
});

const shutdown = async () => {
  shuttingDown = true;
  clearAllActivityIndicators();
  clearAllProgressStates();
  server.close();
  try { await unlink(socketPath); } catch {}
  if (pidPath) { try { await unlink(pidPath); } catch {} }
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
