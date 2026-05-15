import { CANONICAL_REMOTE_COMMANDS, canonicalRemoteCommandName, type RemoteCommandDefinition } from "./remote.js";

export interface CommandSurfaceEntry {
  readonly canonicalCommand: string;
  readonly surfaceName: string;
  readonly description: string;
  readonly usage: string;
  readonly aliases: readonly string[];
}

export interface TelegramBotCommandSurface extends CommandSurfaceEntry {
  readonly command: string;
}

export interface DiscordRelayCommandSurface {
  readonly name: "relay";
  readonly description: string;
  readonly subcommands: readonly CommandSurfaceEntry[];
  readonly textFallback: string;
}

export interface SlackRelayCommandSurface {
  readonly command: "/relay";
  readonly description: string;
  readonly usageHint: string;
  readonly subcommands: readonly CommandSurfaceEntry[];
  readonly textFallback: string;
}

export const TELEGRAM_COMMAND_NAME_MAX_LENGTH = 32;
export const TELEGRAM_COMMAND_DESCRIPTION_MAX_LENGTH = 256;
export const DISCORD_COMMAND_NAME_MAX_LENGTH = 32;
export const DISCORD_COMMAND_DESCRIPTION_MAX_LENGTH = 100;
export const SLACK_COMMAND_DESCRIPTION_MAX_LENGTH = 100;
export const SLACK_COMMAND_USAGE_HINT_MAX_LENGTH = 200;

const SECRET_PATTERN_SOURCE = String.raw`\b(?:bot\d+:[\w-]+|xox[abprs]-[\w-]+|callback[_-]?data|hidden prompt|transcript)\b`;

export function telegramCommandSurface(): readonly TelegramBotCommandSurface[] {
  const entries = visibleCommandDefinitions().map((definition) => {
    const aliases = aliasesFor(definition.command);
    const preferred = preferredTelegramName(definition, aliases);
    return {
      canonicalCommand: definition.command,
      surfaceName: preferred,
      command: preferred,
      description: platformSafeDescription(definition.description, TELEGRAM_COMMAND_DESCRIPTION_MAX_LENGTH),
      usage: telegramUsageFor(preferred, definition.usage),
      aliases,
    };
  });
  return [...assertNoSurfaceCollisions(entries, "Telegram")].sort((left, right) => left.command.localeCompare(right.command));
}

export function discordRelayCommandSurface(): DiscordRelayCommandSurface {
  const subcommands = assertNoSurfaceCollisions(visibleCommandDefinitions().map((definition) => ({
    canonicalCommand: definition.command,
    surfaceName: platformCommandName(definition.command, { allowHyphen: true, maxLength: DISCORD_COMMAND_NAME_MAX_LENGTH }),
    description: platformSafeDescription(definition.description, DISCORD_COMMAND_DESCRIPTION_MAX_LENGTH),
    usage: discordUsageFor(definition.usage),
    aliases: aliasesFor(definition.command),
  })), "Discord");
  return {
    name: "relay",
    description: "Control and monitor PiRelay sessions.",
    subcommands,
    textFallback: "relay <command>",
  };
}

export function slackRelayCommandSurface(): SlackRelayCommandSurface {
  const subcommands = assertNoSurfaceCollisions(visibleCommandDefinitions().map((definition) => ({
    canonicalCommand: definition.command,
    surfaceName: definition.command,
    description: platformSafeDescription(definition.description, SLACK_COMMAND_DESCRIPTION_MAX_LENGTH),
    usage: slackUsageFor(definition.usage),
    aliases: aliasesFor(definition.command),
  })), "Slack");
  return {
    command: "/relay",
    description: platformSafeDescription("Control and monitor PiRelay sessions.", SLACK_COMMAND_DESCRIPTION_MAX_LENGTH),
    usageHint: platformSafeDescription("/relay <status|sessions|full|images|send-file|abort|compact|pause|resume|disconnect>", SLACK_COMMAND_USAGE_HINT_MAX_LENGTH),
    subcommands,
    textFallback: "relay <command>",
  };
}

export function telegramBotCommands(): Array<{ command: string; description: string }> {
  return telegramCommandSurface().map((entry) => ({ command: entry.command, description: entry.description }));
}

export function telegramMenuCommandToCanonical(command: string): string {
  const normalized = command.trim().toLowerCase().replace(/_/g, "-");
  const entry = telegramCommandSurface().find((candidate) => candidate.command === command.trim().toLowerCase());
  return entry?.canonicalCommand ?? canonicalRemoteCommandName(normalized);
}

export function assertNoSurfaceCollisions<T extends Pick<CommandSurfaceEntry, "surfaceName" | "canonicalCommand">>(entries: readonly T[], platform: string): readonly T[] {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const previous = seen.get(entry.surfaceName);
    if (previous && previous !== entry.canonicalCommand) {
      throw new Error(`${platform} command surface collision: ${entry.surfaceName} maps to ${previous} and ${entry.canonicalCommand}.`);
    }
    seen.set(entry.surfaceName, entry.canonicalCommand);
  }
  return entries;
}

export function platformSafeDescription(description: string, maxLength: number): string {
  const cleaned = description.replace(new RegExp(SECRET_PATTERN_SOURCE, "gi"), "[redacted]").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
}

function visibleCommandDefinitions(): RemoteCommandDefinition[] {
  return CANONICAL_REMOTE_COMMANDS.filter((definition) => !("aliasOf" in definition));
}

function aliasesFor(command: string): string[] {
  return CANONICAL_REMOTE_COMMANDS
    .filter((definition) => "aliasOf" in definition && definition.aliasOf === command)
    .map((definition) => definition.command);
}

function preferredTelegramName(definition: RemoteCommandDefinition, aliases: readonly string[]): string {
  const exactAlias = aliases.find((alias) => /^[a-z][a-z0-9_]{0,31}$/.test(alias));
  if (/^[a-z][a-z0-9_]{0,31}$/.test(definition.command)) return definition.command;
  if (exactAlias) return exactAlias;
  return platformCommandName(definition.command, { allowHyphen: false, maxLength: TELEGRAM_COMMAND_NAME_MAX_LENGTH });
}

function platformCommandName(command: string, options: { allowHyphen: boolean; maxLength: number }): string {
  const invalid = options.allowHyphen ? /[^a-z0-9_-]+/g : /[^a-z0-9_]+/g;
  const hyphenReplacement = options.allowHyphen ? "-" : "_";
  const normalized = command.toLowerCase().replace(/-/g, hyphenReplacement).replace(invalid, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const safe = /^[a-z]/.test(normalized) ? normalized : `cmd_${normalized}`;
  return safe.slice(0, options.maxLength);
}

function telegramUsageFor(command: string, usage: string): string {
  const [, ...rest] = usage.split(/\s+/);
  return `/${command}${rest.length ? ` ${rest.join(" ")}` : ""}`;
}

function discordUsageFor(usage: string): string {
  return usage.startsWith("/") ? `relay ${usage.slice(1)}` : `relay ${usage}`;
}

function slackUsageFor(usage: string): string {
  return usage.startsWith("/") ? `relay ${usage.slice(1)}` : `relay ${usage}`;
}
