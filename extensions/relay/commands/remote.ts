export interface RemoteCommandDefinition {
  command: string;
  usage: string;
  description: string;
  allowedWhilePaused?: boolean;
  brokerOnly?: boolean;
  aliasOf?: string;
}

export const CANONICAL_REMOTE_COMMANDS = [
  { command: "help", usage: "/help", description: "show commands", allowedWhilePaused: true },
  { command: "status", usage: "/status", description: "session and relay dashboard", allowedWhilePaused: true },
  { command: "sessions", usage: "/sessions", description: "list paired sessions", allowedWhilePaused: true },
  { command: "progress", usage: "/progress <quiet|normal|verbose|completion-only>", description: "set progress notifications", allowedWhilePaused: true },
  { command: "notify", usage: "/notify <quiet|normal|verbose|completion-only>", description: "alias for /progress", allowedWhilePaused: true, aliasOf: "progress" },
  { command: "alias", usage: "/alias <name|clear>", description: "set a session alias", allowedWhilePaused: true },
  { command: "recent", usage: "/recent", description: "show recent safe activity", allowedWhilePaused: true },
  { command: "activity", usage: "/activity", description: "alias for /recent", allowedWhilePaused: true, aliasOf: "recent" },
  { command: "use", usage: "/use <session>", description: "select an active session", allowedWhilePaused: true },
  { command: "forget", usage: "/forget <session>", description: "remove an offline session from the list", allowedWhilePaused: true },
  { command: "to", usage: "/to <session> <prompt>", description: "send one prompt without switching sessions" },
  { command: "summary", usage: "/summary", description: "latest summary/excerpt" },
  { command: "full", usage: "/full", description: "latest full assistant output" },
  { command: "images", usage: "/images", description: "download latest image outputs or generated image files" },
  { command: "send-image", usage: "/send-image <path>", description: "send a validated workspace image file" },
  { command: "steer", usage: "/steer <text>", description: "steer the active run" },
  { command: "followup", usage: "/followup <text>", description: "queue a follow-up" },
  { command: "abort", usage: "/abort", description: "abort the active run" },
  { command: "compact", usage: "/compact", description: "trigger Pi compaction" },
  { command: "pause", usage: "/pause", description: "pause remote delivery" },
  { command: "resume", usage: "/resume", description: "resume remote delivery", allowedWhilePaused: true },
  { command: "disconnect", usage: "/disconnect", description: "revoke this chat binding", allowedWhilePaused: true },
] as const satisfies readonly RemoteCommandDefinition[];

export type RemoteCommandName = typeof CANONICAL_REMOTE_COMMANDS[number]["command"];

export const CANONICAL_REMOTE_COMMAND_NAMES = CANONICAL_REMOTE_COMMANDS.map((definition) => definition.command);

// Backwards-compatible export for modules that still import the old name while
// this change finishes moving command semantics out of Telegram-specific code.
export const TELEGRAM_COMMANDS = CANONICAL_REMOTE_COMMANDS;
export type TelegramCommandDefinition = RemoteCommandDefinition;

export interface ParsedRemoteCommand {
  command: string;
  args: string;
}

export function parseRemoteCommand(text: string): ParsedRemoteCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.slice(1).split("@")[0]?.toLowerCase();
  if (!command) return undefined;
  return { command, args: rest.join(" ").trim() };
}

export function parsePrefixedRemoteCommand(text: string, options: { prefixes?: string[] } = {}): ParsedRemoteCommand | undefined {
  const prefixes = options.prefixes ?? ["relay"];
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return undefined;
  const [rawPrefix, rawCommand, ...rest] = trimmed.split(/\s+/);
  const prefix = rawPrefix?.toLowerCase();
  if (!prefix || !prefixes.map((value) => value.toLowerCase()).includes(prefix)) return undefined;
  const command = (rawCommand ?? "help").replace(/^\/+/, "").toLowerCase();
  return { command: command || "help", args: rest.join(" ").trim() };
}

function usageForDefinition(definition: RemoteCommandDefinition, commandPrefix: string | undefined): string {
  if (!commandPrefix) return definition.usage;
  return definition.usage.startsWith("/") ? `${commandPrefix} ${definition.usage.slice(1)}` : `${commandPrefix} ${definition.usage}`;
}

export function buildHelpText(options: { includeBrokerOnly?: boolean; title?: string; commandPrefix?: string; footerLines?: string[] } = {}): string {
  return [
    options.title ?? "PiRelay commands:",
    ...CANONICAL_REMOTE_COMMANDS
      .filter((definition) => !("aliasOf" in definition))
      .filter((definition) => options.includeBrokerOnly || !("brokerOnly" in definition && definition.brokerOnly))
      .map((definition) => `${usageForDefinition(definition, options.commandPrefix)} - ${definition.description}`),
    "answer - start a guided answer flow when the latest output contains choices/questions",
    ...(options.footerLines ?? []),
  ].join("\n");
}

export const HELP_TEXT = buildHelpText();
export const BROKER_HELP_TEXT = buildHelpText({ includeBrokerOnly: true });

export function commandAllowsWhilePaused(command: string): boolean {
  return CANONICAL_REMOTE_COMMANDS.some((definition) => definition.command === command && "allowedWhilePaused" in definition && definition.allowedWhilePaused === true);
}

export function normalizeAliasArg(args: string): string | undefined {
  const alias = args.trim();
  const normalized = alias.toLowerCase();
  return alias && normalized !== "clear" && normalized !== "reset" ? alias.slice(0, 64) : undefined;
}
