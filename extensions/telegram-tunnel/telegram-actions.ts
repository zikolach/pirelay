import type { StructuredAnswerMetadata } from "./answer-workflow.js";
import type { TelegramInlineKeyboard } from "./types.js";

export type DashboardAction = "use" | "status" | "full" | "images" | "pause" | "resume" | "abort" | "compact" | "recent";

export type TelegramActionCallback =
  | { kind: "answer-option"; turnId: string; optionId: string }
  | { kind: "answer-custom"; turnId: string }
  | { kind: "answer-ambiguity"; turnId: string; token: string; resolution: "prompt" | "answer" | "cancel" }
  | { kind: "full-chat"; turnId: string }
  | { kind: "full-markdown"; turnId: string }
  | { kind: "latest-images"; turnId: string }
  | { kind: "dashboard"; sessionRef: string; action: DashboardAction };

const MAX_BUTTON_LABEL = 56;
const FULL_OUTPUT_ACTION_MIN_CHARS = 320;

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function truncateButtonText(text: string, maxLength = MAX_BUTTON_LABEL): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildAnswerOptionCallbackData(turnId: string, optionId: string): string {
  return `ans:${encodePart(turnId)}:opt:${encodePart(optionId)}`;
}

export function buildAnswerCustomCallbackData(turnId: string): string {
  return `ans:${encodePart(turnId)}:custom`;
}

export function buildAnswerAmbiguityCallbackData(turnId: string, token: string, resolution: "prompt" | "answer" | "cancel"): string {
  return `ans:${encodePart(turnId)}:amb:${encodePart(token)}:${resolution}`;
}

export function buildFullChatCallbackData(turnId: string): string {
  return `full:${encodePart(turnId)}:chat`;
}

export function buildFullMarkdownCallbackData(turnId: string): string {
  return `full:${encodePart(turnId)}:md`;
}

export function buildLatestImagesCallbackData(turnId: string): string {
  return `imgs:${encodePart(turnId)}`;
}

export function buildDashboardCallbackData(sessionRef: string, action: DashboardAction): string {
  return `dash:${encodePart(sessionRef)}:${action}`;
}

export function parseTelegramActionCallbackData(data: string): TelegramActionCallback | undefined {
  const parts = data.split(":");
  if (parts[0] === "dash" && parts.length === 3) {
    const sessionRef = decodePart(parts[1]);
    const action = parts[2] as DashboardAction;
    if (!sessionRef || !["use", "status", "full", "images", "pause", "resume", "abort", "compact", "recent"].includes(action)) return undefined;
    return { kind: "dashboard", sessionRef, action };
  }

  if (parts[0] === "ans" && parts.length >= 3) {
    const turnId = decodePart(parts[1]);
    if (!turnId) return undefined;
    if (parts[2] === "custom" && parts.length === 3) return { kind: "answer-custom", turnId };
    if (parts[2] === "amb" && parts.length === 5) {
      const token = decodePart(parts[3]);
      const resolution = parts[4];
      if (!token || (resolution !== "prompt" && resolution !== "answer" && resolution !== "cancel")) return undefined;
      return { kind: "answer-ambiguity", turnId, token, resolution };
    }
    if (parts[2] === "opt" && parts.length === 4) {
      const optionId = decodePart(parts[3]);
      if (!optionId) return undefined;
      return { kind: "answer-option", turnId, optionId };
    }
    return undefined;
  }

  if (parts[0] === "full" && parts.length === 3) {
    const turnId = decodePart(parts[1]);
    if (!turnId) return undefined;
    if (parts[2] === "chat") return { kind: "full-chat", turnId };
    if (parts[2] === "md") return { kind: "full-markdown", turnId };
  }

  if (parts[0] === "imgs" && parts.length === 2) {
    const turnId = decodePart(parts[1]);
    if (!turnId) return undefined;
    return { kind: "latest-images", turnId };
  }

  return undefined;
}

export function buildAnswerAmbiguityKeyboard(turnId: string, token: string): TelegramInlineKeyboard {
  return [[
    { text: "➡️ Send as prompt", callbackData: buildAnswerAmbiguityCallbackData(turnId, token, "prompt") },
    { text: "✅ Answer previous", callbackData: buildAnswerAmbiguityCallbackData(turnId, token, "answer") },
  ], [
    { text: "Cancel", callbackData: buildAnswerAmbiguityCallbackData(turnId, token, "cancel") },
  ]];
}

export function buildFullOutputKeyboard(turnId: string): TelegramInlineKeyboard {
  return [[
    { text: "📄 Show in chat", callbackData: buildFullChatCallbackData(turnId) },
    { text: "⬇️ Download .md", callbackData: buildFullMarkdownCallbackData(turnId) },
  ]];
}

export function buildLatestImagesKeyboard(turnId: string, count?: number): TelegramInlineKeyboard {
  const label = count && count > 1 ? `🖼 Download ${count} images` : "🖼 Download image";
  return [[{ text: label, callbackData: buildLatestImagesCallbackData(turnId) }]];
}

export function buildSessionDashboardKeyboard(sessionRef: string, options: { paused?: boolean; busy?: boolean; hasOutput?: boolean; hasImages?: boolean } = {}): TelegramInlineKeyboard {
  const rows: TelegramInlineKeyboard = [
    [
      { text: "🔄 Status", callbackData: buildDashboardCallbackData(sessionRef, "status") },
      { text: "🕘 Recent", callbackData: buildDashboardCallbackData(sessionRef, "recent") },
    ],
  ];
  const outputRow: TelegramInlineKeyboard[number] = [];
  if (options.hasOutput) outputRow.push({ text: "📄 Full", callbackData: buildDashboardCallbackData(sessionRef, "full") });
  if (options.hasImages) outputRow.push({ text: "🖼 Images", callbackData: buildDashboardCallbackData(sessionRef, "images") });
  if (outputRow.length > 0) rows.push(outputRow);
  rows.push([
    { text: options.paused ? "▶️ Resume" : "⏸ Pause", callbackData: buildDashboardCallbackData(sessionRef, options.paused ? "resume" : "pause") },
    { text: "🧹 Compact", callbackData: buildDashboardCallbackData(sessionRef, "compact") },
  ]);
  if (options.busy) rows.push([{ text: "⏹ Abort", callbackData: buildDashboardCallbackData(sessionRef, "abort") }]);
  return rows;
}

export function buildSessionListDashboardKeyboard(entries: Array<{ online: boolean; sessionKey: string }>, maxRows = 8): TelegramInlineKeyboard {
  return entries.slice(0, maxRows).map((entry, index) => {
    const sessionRef = `i${index + 1}`;
    return [
      { text: entry.online ? `Use ${index + 1}` : `Offline ${index + 1}`, callbackData: buildDashboardCallbackData(sessionRef, "use") },
      { text: `Recent ${index + 1}`, callbackData: buildDashboardCallbackData(sessionRef, "recent") },
    ];
  });
}

export function shouldOfferFullOutputActions(text: string | undefined): boolean {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > FULL_OUTPUT_ACTION_MIN_CHARS;
}

export function buildAnswerActionKeyboard(
  metadata: StructuredAnswerMetadata,
  options: { includeFullOutputActions?: boolean } = {},
): TelegramInlineKeyboard {
  const turnId = metadata.turnId;
  const rows: TelegramInlineKeyboard = [];

  if (metadata.kind === "choice") {
    for (const option of metadata.options ?? []) {
      rows.push([{
        text: `${option.id}. ${truncateButtonText(option.label)}`,
        callbackData: buildAnswerOptionCallbackData(turnId, option.id),
      }]);
    }
    rows.push([{ text: "✍️ Custom answer", callbackData: buildAnswerCustomCallbackData(turnId) }]);
  }

  if (options.includeFullOutputActions !== false) {
    rows.push(...buildFullOutputKeyboard(turnId));
  }
  return rows;
}
