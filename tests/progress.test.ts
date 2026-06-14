import { describe, expect, it } from "vitest";
import {
  appendRecentActivity,
  coalesceLiveProgressEntries,
  createProgressActivity,
  displayProgressMode,
  formatProgressUpdate,
  formatRecentActivity,
  normalizeProgressMode,
  progressIntervalMsFor,
  progressModeFor,
  progressSemanticKey,
  shouldSendCompactionProgress,
  shouldSendNonTerminalProgress,
  shouldSendProgressActivity,
} from "../extensions/relay/notifications/progress.js";
import type { SessionNotificationState, TelegramBindingMetadata, TelegramTunnelConfig } from "../extensions/relay/core/types.js";

const config: Pick<TelegramTunnelConfig, "redactionPatterns" | "maxProgressMessageChars" | "progressIntervalMs" | "verboseProgressIntervalMs" | "progressMode"> = {
  redactionPatterns: ["SECRET_[A-Z]+"],
  maxProgressMessageChars: 120,
  progressIntervalMs: 30_000,
  verboseProgressIntervalMs: 5_000,
  progressMode: "normal",
};

describe("progress helpers", () => {
  it("normalizes and displays progress modes", () => {
    expect(normalizeProgressMode("completion-only")).toBe("completionOnly");
    expect(normalizeProgressMode("verbose")).toBe("verbose");
    expect(normalizeProgressMode("bad")).toBeUndefined();
    expect(displayProgressMode("completionOnly")).toBe("completion-only");
  });

  it("resolves per-binding progress preferences and intervals", () => {
    const binding = { progressMode: "verbose" } as TelegramBindingMetadata;
    const mode = progressModeFor(binding, config);
    expect(mode).toBe("verbose");
    expect(shouldSendNonTerminalProgress(mode)).toBe(true);
    expect(shouldSendNonTerminalProgress("quiet")).toBe(false);
    expect(progressIntervalMsFor(mode, config)).toBe(5_000);
  });

  it("sends compaction progress in every mode except quiet", () => {
    expect(shouldSendCompactionProgress("quiet")).toBe(false);
    expect(shouldSendCompactionProgress("normal")).toBe(true);
    expect(shouldSendCompactionProgress("verbose")).toBe(true);
    expect(shouldSendCompactionProgress("completionOnly")).toBe(true);
    expect(shouldSendProgressActivity("completionOnly", { kind: "compaction" })).toBe(true);
    expect(shouldSendProgressActivity("completionOnly", { kind: "tool" })).toBe(false);
  });

  it("keeps assistant heartbeat progress verbose-only", () => {
    expect(shouldSendProgressActivity("quiet", { kind: "assistant" })).toBe(false);
    expect(shouldSendProgressActivity("normal", { kind: "assistant" })).toBe(false);
    expect(shouldSendProgressActivity("completionOnly", { kind: "assistant" })).toBe(false);
    expect(shouldSendProgressActivity("verbose", { kind: "assistant" })).toBe(true);
    expect(shouldSendProgressActivity("normal", { kind: "tool" })).toBe(true);
    expect(shouldSendProgressActivity("normal", { kind: "tool", text: "Processed tool result" })).toBe(false);
  });

  it("redacts and bounds progress text", () => {
    const entry = createProgressActivity({ id: "p1", kind: "tool", text: "Running SECRET_TOKEN in tool" }, config);
    expect(entry?.text).toContain("[redacted]");
    expect(entry?.text).not.toContain("SECRET_TOKEN");
  });

  it("coalesces repeated updates into bounded Telegram text", () => {
    const first = createProgressActivity({ id: "p1", kind: "tool", text: "Running tests", at: 1 }, config)!;
    const second = createProgressActivity({ id: "p2", kind: "tool", text: "Running tests", at: 2 }, config)!;
    const update = formatProgressUpdate([first, second], config);
    expect(update).toContain("Pi progress");
    expect(update).toContain("Running tests (2×)");
  });

  it("formats compact progress without the repeated header", () => {
    const entry = createProgressActivity({ id: "p1", kind: "tool", text: "Running tests", at: 1 }, config)!;
    const update = formatProgressUpdate([entry], config, { header: false });
    expect(update).toBe("● Running tests");
  });

  it("deduplicates milestones semantically and keeps latest volatile status", () => {
    const first = createProgressActivity({ id: "a", kind: "assistant", text: "Model update", detail: "Draft A", at: 1, delivery: "volatile", semanticKey: "assistant" }, config)!;
    const second = createProgressActivity({ id: "b", kind: "assistant", text: "Model update", detail: "Draft B", at: 2, delivery: "volatile", semanticKey: "assistant" }, config)!;
    const toolA = createProgressActivity({ id: "c", kind: "tool", text: "Tool completed", detail: "bash", at: 3, semanticKey: "tool:1" }, config)!;
    const toolB = createProgressActivity({ id: "d", kind: "tool", text: "Tool completed", detail: "bash", at: 4, semanticKey: "tool:1" }, config)!;
    const coalesced = coalesceLiveProgressEntries([first, second, toolA, toolB]);
    expect(coalesced.map((entry) => entry.detail)).toContain("Draft B");
    expect(coalesced.map((entry) => entry.detail)).not.toContain("Draft A");
    expect(coalesced.find((entry) => entry.text.startsWith("Tool completed"))?.text).toBe("Tool completed (2×)");
    expect(progressSemanticKey(toolA)).toBe(progressSemanticKey(toolB));
  });

  it("keeps the newest volatile progress even when entries are out of order", () => {
    const newer = createProgressActivity({ id: "newer", kind: "assistant", text: "Model update", detail: "new draft", at: 20, delivery: "volatile" }, config)!;
    const older = createProgressActivity({ id: "older", kind: "assistant", text: "Model update", detail: "old draft", at: 10, delivery: "volatile" }, config)!;
    const coalesced = coalesceLiveProgressEntries([newer, older]);

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.detail).toBe("new draft");
  });

  it("sanitizes live progress before coalescing or formatting", () => {
    const entry = createProgressActivity({ id: "secret", kind: "assistant", text: "Model update", detail: "SECRET_TOKEN chat 12345", semanticKey: "assistant:SECRET_TOKEN chat 12345", delivery: "volatile" }, config)!;
    const update = formatProgressUpdate([entry], config, { header: false });
    expect(update).toContain("[redacted]");
    expect(update).not.toContain("SECRET_TOKEN");
    expect(entry.semanticKey).toContain("[redacted]");
    expect(entry.semanticKey).not.toContain("secret_token");
  });

  it("stores bounded recent activity", () => {
    const notification: SessionNotificationState = {};
    const first = createProgressActivity({ id: "p1", kind: "lifecycle", text: "Started", at: 1 }, config)!;
    const second = createProgressActivity({ id: "p2", kind: "lifecycle", text: "Completed", at: 2 }, config)!;
    appendRecentActivity(notification, first, 1);
    appendRecentActivity(notification, second, 1);
    expect(notification.recentActivity).toEqual([second]);
    expect(formatRecentActivity(notification.recentActivity, { now: 2_000 })).toContain("Completed");
    expect(formatRecentActivity(undefined)).toContain("No recent activity");
  });
});
