export interface TelegramCommandDefinition {
  command: string;
  usage: string;
  description: string;
  allowedWhilePaused?: boolean;
  brokerOnly?: boolean;
}

export const TELEGRAM_COMMANDS: TelegramCommandDefinition[] = [
  { command: "help", usage: "/help", description: "show commands", allowedWhilePaused: true },
  { command: "status", usage: "/status", description: "session and tunnel dashboard", allowedWhilePaused: true },
  { command: "sessions", usage: "/sessions", description: "list paired session dashboard", allowedWhilePaused: true },
  { command: "progress", usage: "/progress <quiet|normal|verbose|completion-only>", description: "set progress notifications", allowedWhilePaused: true },
  { command: "notify", usage: "/notify <quiet|normal|verbose|completion-only>", description: "alias for /progress", allowedWhilePaused: true },
  { command: "alias", usage: "/alias <name|clear>", description: "set a session alias", allowedWhilePaused: true },
  { command: "recent", usage: "/recent", description: "show recent safe activity", allowedWhilePaused: true },
  { command: "activity", usage: "/activity", description: "alias for /recent", allowedWhilePaused: true },
  { command: "use", usage: "/use <session>", description: "select an active session", allowedWhilePaused: true, brokerOnly: true },
  { command: "forget", usage: "/forget <session>", description: "remove an offline session from the list", allowedWhilePaused: true, brokerOnly: true },
  { command: "to", usage: "/to <session> <prompt>", description: "send one prompt without switching sessions", brokerOnly: true },
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
];

export function buildHelpText(options: { includeBrokerOnly?: boolean } = {}): string {
  return [
    "Telegram tunnel commands:",
    ...TELEGRAM_COMMANDS.filter((definition) => definition.command !== "notify" && definition.command !== "activity")
      .filter((definition) => options.includeBrokerOnly || !definition.brokerOnly)
      .map((definition) => `${definition.usage} - ${definition.description}`),
    "answer - start a guided answer flow when the latest output contains choices/questions",
  ].join("\n");
}

export const HELP_TEXT = buildHelpText();
export const BROKER_HELP_TEXT = buildHelpText({ includeBrokerOnly: true });

export function commandAllowsWhilePaused(command: string): boolean {
  return TELEGRAM_COMMANDS.some((definition) => definition.command === command && definition.allowedWhilePaused === true);
}

export function normalizeAliasArg(args: string): string | undefined {
  const alias = args.trim();
  const normalized = alias.toLowerCase();
  return alias && normalized !== "clear" && normalized !== "reset" ? alias.slice(0, 64) : undefined;
}
