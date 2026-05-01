import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import { loadTelegramTunnelConfig, ConfigError } from "./config.js";
import { renderQrLines } from "./qr.js";
import { getOrCreateTunnelRuntime, sendSessionNotification } from "./runtime.js";
import { TunnelStateStore } from "./state-store.js";
import type { BindingEntryData, ImageFileLoadResult, LatestTurnImage, LatestTurnImageFileCandidate, SessionRoute, TelegramBindingMetadata, TelegramTunnelConfig, TunnelRuntime } from "./types.js";
import { extractStructuredAnswerMetadata } from "./answer-workflow.js";
import { createTurnId, deriveSessionLabel, extractFinalAssistantText, extractImageContent, extractTextContent, getTelegramUserLabel, isAllowedImageMimeType, latestImageFileCandidatesFromText, latestImageFromContent, loadWorkspaceImageFile, sessionKeyOf, summarizeTextDeterministically, toIsoNow } from "./utils.js";

const BINDING_ENTRY_TYPE = "telegram-tunnel-binding";
const AUDIT_MESSAGE_TYPE = "telegram-tunnel-audit";
const CONNECT_WIDGET_KEY = "telegram-tunnel-connect";

function shortenMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
}

function wrapPlainText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];
  const lines: string[] = [];
  for (const sourceLine of text.split("\n")) {
    if (!sourceLine) {
      lines.push("");
      continue;
    }
    let remaining = sourceLine;
    while (visibleWidth(remaining) > maxWidth) {
      lines.push(remaining.slice(0, maxWidth));
      remaining = remaining.slice(maxWidth);
    }
    lines.push(remaining);
  }
  return lines;
}

class PairingQrScreen {
  constructor(
    private readonly theme: Theme,
    private readonly sessionLabel: string,
    private readonly qrLines: string[],
    private readonly deepLink: string,
    private readonly expiryMinutes: number,
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c")) {
      this.done();
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const outerWidth = Math.max(40, Math.min(width - 2, 88));
    const innerWidth = outerWidth - 2;
    const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const bottomBorder = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
    const pad = (text: string): string => {
      const visible = visibleWidth(text);
      return text + " ".repeat(Math.max(0, innerWidth - visible));
    };
    const row = (text = ""): string => `${this.theme.fg("border", "│")}${pad(text)}${this.theme.fg("border", "│")}`;
    const lines: string[] = [border];
    lines.push(row(this.theme.fg("accent", "Telegram tunnel pairing")));
    lines.push(row(`Session: ${shortenMiddle(this.sessionLabel, Math.max(16, innerWidth - 9))}`));
    lines.push(row(`Expires in about ${this.expiryMinutes} minute(s).`));
    lines.push(row());

    for (const qrLine of this.qrLines) {
      lines.push(row(qrLine));
    }

    lines.push(row());
    lines.push(row("Fallback link:"));
    for (const wrapped of wrapPlainText(this.deepLink, innerWidth)) {
      lines.push(row(wrapped));
    }
    lines.push(row());
    lines.push(row(this.theme.fg("dim", "Scan the QR code or open the link in Telegram, then press Start.")));
    lines.push(row(this.theme.fg("dim", "Press Esc or Enter when done. Re-run /telegram-tunnel connect to show this again.")));
    lines.push(bottomBorder);
    return lines;
  }
}

function getCommandHelp(commandName = "telegram-tunnel"): string {
  return [
    `Usage: /${commandName} <subcommand>`,
    "",
    "Subcommands:",
    "  setup       Validate the bot token and cache the bot username",
    "  connect [name]  Generate a QR pairing link with an optional session label",
    "  disconnect  Revoke the active Telegram binding",
    "  status      Show current local tunnel state",
  ].join("\n");
}

export default function telegramTunnelExtension(pi: ExtensionAPI): void {
  let configCache: TelegramTunnelConfig | undefined;
  let runtime: TunnelRuntime | undefined;
  let currentRoute: SessionRoute | undefined;
  let latestContext: ExtensionContext | undefined;
  let closeConnectQrScreen: (() => void) | undefined;
  let activeTurnImages: ImageContent[] = [];
  let activeTurnImagePathTexts: string[] = [];
  let latestTurnImages: LatestTurnImage[] = [];
  let latestTurnImageFileCandidates: LatestTurnImageFileCandidate[] = [];

  async function ensureConfig(ctx?: ExtensionContext, interactiveNotice = false): Promise<TelegramTunnelConfig> {
    if (configCache) return configCache;
    const { config, warnings } = await loadTelegramTunnelConfig();
    configCache = config;
    if (ctx && interactiveNotice) {
      for (const warning of warnings) ctx.ui.notify(warning, "warning");
    }
    return config;
  }

  async function ensureRuntime(ctx?: ExtensionContext, interactiveNotice = false): Promise<TunnelRuntime> {
    if (runtime) return runtime;
    const config = await ensureConfig(ctx, interactiveNotice);
    runtime = getOrCreateTunnelRuntime(config);
    return runtime;
  }

  function appendAudit(message: string): void {
    const safe = summarizeTextDeterministically(message, 280);
    pi.sendMessage({ customType: AUDIT_MESSAGE_TYPE, content: safe, display: true });
  }

  async function loadImagePathForTelegram(ctx: ExtensionContext, relativePath: string, turnId: string, index: number): Promise<ImageFileLoadResult> {
    const config = await ensureConfig();
    return loadWorkspaceImageFile(relativePath, {
      workspaceRoot: ctx.cwd,
      turnId,
      index,
      maxBytes: config.maxOutboundImageBytes,
      allowedMimeTypes: config.allowedImageMimeTypes,
    });
  }

  async function getLatestImagesForTelegram(): Promise<LatestTurnImage[]> {
    const ctx = latestContext;
    const images = [...latestTurnImages];
    if (!ctx) return images;
    const config = await ensureConfig();
    for (const candidate of latestTurnImageFileCandidates) {
      if (images.length >= config.maxLatestImages) break;
      const loaded = await loadImagePathForTelegram(ctx, candidate.path, candidate.turnId, images.length);
      if (loaded.ok) images.push(loaded.image);
    }
    return images;
  }

  function persistBinding(binding: TelegramBindingMetadata | null, revoked = false): void {
    const data: BindingEntryData = {
      version: 1,
      binding: binding ?? undefined,
      revoked,
      revokedAt: revoked ? toIsoNow() : undefined,
    };
    pi.appendEntry<BindingEntryData>(BINDING_ENTRY_TYPE, data);
  }

  function buildRoute(ctx: ExtensionContext, binding?: TelegramBindingMetadata, explicitLabel?: string): SessionRoute {
    const sessionId = ctx.sessionManager.getSessionId();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionLabel = binding?.sessionLabel ?? deriveSessionLabel({
      explicitLabel,
      sessionName: ctx.sessionManager.getSessionName(),
      cwd: ctx.cwd,
      sessionFile,
      sessionId,
    });
    return {
      sessionKey: sessionKeyOf(sessionId, sessionFile),
      sessionId,
      sessionFile,
      sessionLabel,
      binding,
      lastActivityAt: Date.now(),
      notification: { lastStatus: "idle" },
      actions: {
        context: ctx,
        getModel: () => latestContext?.model,
        sendUserMessage: (text, options) => pi.sendUserMessage(text, options),
        getLatestImages: getLatestImagesForTelegram,
        getImageByPath: async (relativePath) => {
          const turnId = currentRoute?.notification.lastTurnId ?? createTurnId();
          return loadImagePathForTelegram(latestContext ?? ctx, relativePath, turnId, 0);
        },
        appendAudit,
        persistBinding,
        promptLocalConfirmation: async (identity) => {
          closeConnectQrScreen?.();
          closeConnectQrScreen = undefined;
          if (!latestContext?.hasUI) return false;
          return latestContext.ui.confirm(
            "Telegram Pairing Request",
            `Allow ${getTelegramUserLabel(identity)} to control ${currentRoute?.sessionLabel ?? sessionLabel}?`,
          );
        },
        abort: () => latestContext?.abort(),
        compact: () =>
          new Promise<void>((resolve, reject) => {
            if (!latestContext) {
              reject(new Error("No active Pi context available."));
              return;
            }
            latestContext.compact({
              onComplete: () => resolve(),
              onError: reject,
            });
          }),
      },
    };
  }

  async function publishRouteState(): Promise<void> {
    if (!runtime || !currentRoute) return;
    await runtime.registerRoute(currentRoute);
  }

  function publishRouteStateSoon(): void {
    void publishRouteState().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      latestContext?.ui.setStatus("telegram-tunnel-sync", `telegram sync error: ${message}`);
    });
  }

  async function restoreBinding(ctx: ExtensionContext, config: TelegramTunnelConfig): Promise<TelegramBindingMetadata | undefined> {
    let latest: BindingEntryData | undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === BINDING_ENTRY_TYPE) {
        latest = entry.data as BindingEntryData;
      }
    }
    if (latest?.revoked) return undefined;
    if (latest?.binding) return latest.binding;

    const store = new TunnelStateStore(config.stateDir);
    const sessionKey = sessionKeyOf(ctx.sessionManager.getSessionId(), ctx.sessionManager.getSessionFile());
    const localBinding = await store.getBindingBySessionKey(sessionKey);
    if (!localBinding || localBinding.status === "revoked") return undefined;
    return localBinding;
  }

  async function syncRoute(ctx: ExtensionContext): Promise<void> {
    latestContext = ctx;
    let config: TelegramTunnelConfig;
    try {
      config = await ensureConfig();
    } catch {
      currentRoute = undefined;
      return;
    }

    const restoredBinding = await restoreBinding(ctx, config);
    currentRoute = buildRoute(ctx, restoredBinding);
    runtime = await ensureRuntime();
    await runtime.registerRoute(currentRoute);
    if (restoredBinding) {
      ctx.ui.setStatus("telegram-tunnel", `telegram: connected to ${restoredBinding.chatId}`);
    } else {
      ctx.ui.setStatus("telegram-tunnel", "telegram: ready");
    }
  }

  async function handleSetup(ctx: ExtensionContext): Promise<void> {
    const tunnelRuntime = await ensureRuntime(ctx, true);
    const setup = await tunnelRuntime.ensureSetup();
    await tunnelRuntime.start();
    ctx.ui.notify(`Telegram bot ready: @${setup.botUsername} (${setup.botDisplayName})`, "info");
  }

  async function handleConnect(ctx: ExtensionContext, explicitLabel?: string): Promise<void> {
    const config = await ensureConfig(ctx, true);
    const tunnelRuntime = await ensureRuntime(ctx);
    const setup = await tunnelRuntime.ensureSetup();
    if (!currentRoute) {
      await syncRoute(ctx);
    }
    if (!currentRoute) {
      throw new Error("Failed to initialize the current Pi session route.");
    }
    if (explicitLabel?.trim()) {
      const sessionLabel = deriveSessionLabel({
        explicitLabel,
        sessionName: ctx.sessionManager.getSessionName(),
        cwd: ctx.cwd,
        sessionFile: currentRoute.sessionFile,
        sessionId: currentRoute.sessionId,
      });
      currentRoute.sessionLabel = sessionLabel;
      if (currentRoute.binding) currentRoute.binding = { ...currentRoute.binding, sessionLabel };
    }
    await tunnelRuntime.registerRoute(currentRoute);

    const store = new TunnelStateStore(config.stateDir);
    const { nonce, pairing } = await store.createPendingPairing({
      sessionId: currentRoute.sessionId,
      sessionFile: currentRoute.sessionFile,
      sessionLabel: currentRoute.sessionLabel,
      expiryMs: config.pairingExpiryMs,
    });

    const deepLink = `https://t.me/${setup.botUsername}?start=${nonce}`;
    const qrLines = renderQrLines(deepLink);
    const expiryMinutes = Math.round((Date.parse(pairing.expiresAt) - Date.now()) / 60_000);

    if (ctx.hasUI) {
      ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
      try {
        await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
          closeConnectQrScreen = () => done(undefined);
          return new PairingQrScreen(theme, currentRoute!.sessionLabel, qrLines, deepLink, expiryMinutes, () => done(undefined));
        });
      } finally {
        closeConnectQrScreen = undefined;
      }
      ctx.ui.notify(`Pairing link ready for @${setup.botUsername}. Expires in about ${expiryMinutes} minute(s).`, "info");
      return;
    }

    ctx.ui.notify(`Open this Telegram pairing link: ${deepLink}`, "info");
  }

  async function handleDisconnect(ctx: ExtensionContext): Promise<void> {
    const config = await ensureConfig(ctx, true);
    const store = new TunnelStateStore(config.stateDir);
    if (!currentRoute) await syncRoute(ctx);
    if (!currentRoute) return;
    const disconnectedRoute = currentRoute;
    currentRoute.binding = undefined;
    await store.revokeBinding(currentRoute.sessionKey);
    persistBinding(null, true);
    if (runtime) {
      await runtime.unregisterRoute(disconnectedRoute.sessionKey);
    }
    currentRoute = undefined;
    ctx.ui.setStatus("telegram-tunnel", "telegram: disconnected");
    ctx.ui.setWidget(CONNECT_WIDGET_KEY, undefined);
    appendAudit("Telegram tunnel disconnected locally.");
    ctx.ui.notify("Telegram tunnel disconnected for this session.", "info");
  }

  async function handleStatus(ctx: ExtensionContext): Promise<void> {
    if (!currentRoute) await syncRoute(ctx);
    if (!currentRoute) {
      ctx.ui.notify("Telegram tunnel is not configured. Run /telegram-tunnel setup after setting TELEGRAM_BOT_TOKEN.", "warning");
      return;
    }
    const busy = !ctx.isIdle();
    const binding = currentRoute.binding;
    const lines = [
      `Session: ${currentRoute.sessionLabel}`,
      `Session key: ${currentRoute.sessionKey}`,
      `Busy: ${busy ? "yes" : "no"}`,
      `Binding: ${binding ? `${binding.chatId}/${binding.userId}` : "not paired"}`,
      `Paused: ${binding?.paused ? "yes" : "no"}`,
      `Last status: ${currentRoute.notification.lastStatus ?? "unknown"}`,
    ];
    ctx.ui.notify(lines.join("\n"), "info");
  }

  type LocalRelayCommand = Parameters<ExtensionAPI["registerCommand"]>[1];

  function createLocalRelayCommand(commandName: "telegram-tunnel" | "relay", description: string): LocalRelayCommand {
    return {
      description,
      getArgumentCompletions: (prefix) => {
        const options = ["setup", "connect", "disconnect", "status"];
        const filtered = options.filter((option) => option.startsWith(prefix));
        return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
      },
      handler: async (args, ctx) => {
        latestContext = ctx;
        const trimmedArgs = args.trim();
        const [subcommand, ...rest] = trimmedArgs.split(/\s+/);
        const subcommandArgs = rest.join(" ").trim();
        try {
          switch ((subcommand || "").toLowerCase()) {
            case "setup":
              await handleSetup(ctx);
              return;
            case "connect":
              await handleConnect(ctx, subcommandArgs);
              return;
            case "disconnect":
              await handleDisconnect(ctx);
              return;
            case "status":
              await handleStatus(ctx);
              return;
            default:
              ctx.ui.notify(getCommandHelp(commandName), "info");
          }
        } catch (error) {
          const message = error instanceof ConfigError || error instanceof Error ? error.message : String(error);
          ctx.ui.notify(message, "error");
        }
      },
    };
  }

  pi.registerCommand("telegram-tunnel", createLocalRelayCommand("telegram-tunnel", "Manage Telegram pairing and remote control for the current Pi session"));
  pi.registerCommand("relay", createLocalRelayCommand("relay", "Manage relay pairing and remote control for the current Pi session"));

  pi.registerMessageRenderer(AUDIT_MESSAGE_TYPE, (message, _options, theme) => ({
    render(width: number) {
      const text = typeof message.content === "string" ? message.content : "Telegram action";
      const rendered = theme.fg("accent", `Telegram › ${text}`);
      return [rendered.length > width ? rendered.slice(0, width) : rendered];
    },
    invalidate() {},
  }));

  pi.on("session_start", async (_event, ctx) => {
    try {
      await syncRoute(ctx);
    } catch {
      // Ignore unconfigured state until the user runs setup.
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    latestContext = ctx;
    closeConnectQrScreen = undefined;
    if (runtime && currentRoute) {
      await runtime.unregisterRoute(currentRoute.sessionKey);
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    latestContext = ctx;
    if (currentRoute) {
      currentRoute.actions.context = ctx;
      publishRouteStateSoon();
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    latestContext = ctx;
    if (currentRoute) {
      currentRoute.actions.context = ctx;
      publishRouteStateSoon();
    }
  });

  pi.on("agent_start", async (_event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    activeTurnImages = [];
    activeTurnImagePathTexts = [];
    latestTurnImages = [];
    latestTurnImageFileCandidates = [];
    currentRoute.actions.context = ctx;
    currentRoute.notification.startedAt = Date.now();
    currentRoute.notification.lastTurnId = undefined;
    currentRoute.notification.lastAssistantText = undefined;
    currentRoute.notification.lastFailure = undefined;
    currentRoute.notification.lastStatus = "running";
    currentRoute.notification.abortRequested = false;
    currentRoute.notification.structuredAnswer = undefined;
    currentRoute.notification.latestImages = undefined;
    currentRoute.lastActivityAt = Date.now();
    publishRouteStateSoon();
  });

  pi.on("message_update", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.message.role === "assistant") {
      currentRoute.notification.lastAssistantText = extractTextContent(event.message.content);
      currentRoute.lastActivityAt = Date.now();
    }
  });

  pi.on("message_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.message.role === "assistant") {
      currentRoute.notification.lastAssistantText = extractTextContent(event.message.content);
      currentRoute.lastActivityAt = Date.now();
      publishRouteStateSoon();
    }
    if (event.message.role === "toolResult") {
      activeTurnImages.push(...extractImageContent(event.message.content));
      const toolText = extractTextContent(event.message.content as never);
      if (toolText) activeTurnImagePathTexts.push(toolText);
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute) return;
    currentRoute.actions.context = ctx;
    if (event.isError) {
      currentRoute.notification.lastFailure = `Tool ${event.toolName} failed.`;
      publishRouteStateSoon();
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    latestContext = ctx;
    if (!currentRoute || !runtime) return;
    currentRoute.actions.context = ctx;
    currentRoute.lastActivityAt = Date.now();

    const finalText = extractFinalAssistantText(event.messages as AgentMessage[]);
    const turnId = createTurnId();
    currentRoute.notification.lastTurnId = turnId;
    const config = configCache;
    latestTurnImages = [];
    latestTurnImageFileCandidates = [];
    let skippedImages = 0;
    if (config && activeTurnImages.length > 0) {
      for (const image of activeTurnImages) {
        const latestImage = latestImageFromContent(image, { turnId, index: latestTurnImages.length });
        if (
          latestTurnImages.length >= config.maxLatestImages
          || !isAllowedImageMimeType(latestImage.mimeType, config.allowedImageMimeTypes)
          || latestImage.byteSize > config.maxOutboundImageBytes
        ) {
          skippedImages += 1;
          continue;
        }
        latestTurnImages.push(latestImage);
      }
    }
    if (config) {
      const imagePathTexts = finalText ? [...activeTurnImagePathTexts, finalText] : activeTurnImagePathTexts;
      const remaining = Math.max(0, config.maxLatestImages - latestTurnImages.length);
      const fileCandidates = latestImageFileCandidatesFromText(imagePathTexts, { turnId, maxCount: remaining });
      const verifiedFileCandidates: LatestTurnImageFileCandidate[] = [];
      for (const candidate of fileCandidates) {
        const loaded = await loadImagePathForTelegram(ctx, candidate.path, candidate.turnId, latestTurnImages.length + verifiedFileCandidates.length);
        if (loaded.ok) verifiedFileCandidates.push(candidate);
      }
      latestTurnImageFileCandidates = verifiedFileCandidates;
    }
    const latestImageCount = latestTurnImages.length + latestTurnImageFileCandidates.length;
    currentRoute.notification.latestImages = latestImageCount > 0
      ? {
        turnId,
        count: latestImageCount,
        skipped: skippedImages,
        contentCount: latestTurnImages.length,
        fileCount: latestTurnImageFileCandidates.length,
      }
      : undefined;
    if (finalText) {
      currentRoute.notification.lastAssistantText = finalText;
      currentRoute.notification.structuredAnswer = extractStructuredAnswerMetadata(finalText, { turnId });
    } else {
      currentRoute.notification.structuredAnswer = undefined;
    }

    const status = currentRoute.notification.abortRequested
      ? "aborted"
      : currentRoute.notification.lastAssistantText
        ? "completed"
        : "failed";

    currentRoute.notification.lastStatus = status;
    if (status === "failed" && !currentRoute.notification.lastFailure) {
      currentRoute.notification.lastFailure = "The agent finished without a final assistant response.";
    }

    publishRouteStateSoon();
    await sendSessionNotification(runtime, currentRoute, status);
  });
}
