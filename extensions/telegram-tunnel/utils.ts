import { createHash, randomBytes } from "node:crypto";
import { basename } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model, TextContent } from "@mariozechner/pi-ai";
import type { DeliveryMode, ParsedTelegramCommand, TelegramBindingMetadata, TelegramOutboundChunk, TelegramUserSummary } from "./types.js";

const DEFAULT_REDACTION_PATTERNS = [
  String.raw`\b\d{8,}:[A-Za-z0-9_-]{20,}\b`,
  String.raw`\b(?:sk|rk|pk)_[A-Za-z0-9]{16,}\b`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{16,}\b`,
  String.raw`(?:API[_-]?KEY|Api[_-]?Key|api[_-]?key|TOKEN|Token|token|SECRET|Secret|secret|PASSWORD|Password|password)\s*[:=]\s*[^\s]+`,
];

export function getDefaultRedactionPatterns(): string[] {
  return [...DEFAULT_REDACTION_PATTERNS];
}

export function sessionKeyOf(sessionId: string, sessionFile?: string): string {
  return `${sessionId}:${sessionFile ?? "memory"}`;
}

export function sessionLabelOf(sessionId: string, sessionFile?: string, sessionName?: string | null): string {
  if (sessionName?.trim()) return sessionName.trim();
  if (sessionFile) return basename(sessionFile);
  return `session-${sessionId.slice(0, 8)}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPairingNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function redactSecret(value: string, patterns: string[], replacement = "[redacted]"): string {
  let output = value;
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "gm");
      output = output.replace(regex, replacement);
    } catch {
      // Ignore invalid user-supplied patterns.
    }
  }
  return output;
}

export function maskNonce(nonce: string): string {
  if (nonce.length <= 10) return "••••";
  return `${nonce.slice(0, 4)}…${nonce.slice(-4)}`;
}

export function getTelegramUserLabel(user: TelegramUserSummary): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (user.username) return `@${user.username}${name ? ` (${name})` : ""}`;
  if (name) return `${name} (${user.id})`;
  return `Telegram user ${user.id}`;
}

export function parseTelegramCommand(text: string): ParsedTelegramCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const [rawCommand, ...rest] = trimmed.split(/\s+/);
  const command = rawCommand.slice(1).split("@")[0]?.toLowerCase();
  if (!command) return undefined;
  return { command, args: rest.join(" ").trim() };
}

export function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

export function extractTextContent(content: AssistantMessage["content"] | string | (TextContent | { type: string })[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && "text" in block && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts.join("\n").trim();
}

export function extractFinalAssistantText(messages: AgentMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (isAssistantMessage(message)) {
      const text = extractTextContent(message.content);
      if (text) return text;
    }
  }
  return undefined;
}

export function summarizeTextDeterministically(text: string, maxLength = 320): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function statusLineForBinding(binding?: TelegramBindingMetadata): string {
  if (!binding) return "not paired";
  const paused = binding.paused ? ", paused" : "";
  return `${binding.sessionLabel} ↔ ${binding.chatId}/${binding.userId}${paused}`;
}

export function resolveBusyDeliveryMode(mode: DeliveryMode | undefined, busy: boolean): DeliveryMode | undefined {
  if (!busy) return undefined;
  return mode ?? "followUp";
}

export function chunkTelegramText(text: string, maxChars: number): TelegramOutboundChunk[] {
  const safe = text.replace(/\r\n/g, "\n");
  if (safe.length <= maxChars) {
    return [{ text: safe, index: 1, total: 1 }];
  }

  const chunks: string[] = [];
  let remaining = safe;

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf("\n", maxChars);
    if (splitAt < maxChars * 0.5) {
      splitAt = remaining.lastIndexOf(" ", maxChars);
    }
    if (splitAt < maxChars * 0.5) {
      splitAt = maxChars;
    }
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);

  return chunks.map((chunk, index) => ({
    text: chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n${chunk}` : chunk,
    index: index + 1,
    total: chunks.length,
  }));
}

export function formatModelId(model: Model<any> | undefined): string | undefined {
  if (!model) return undefined;
  return `${model.provider}/${model.id}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toIsoNow(): string {
  return new Date().toISOString();
}
