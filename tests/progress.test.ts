import { describe, expect, it } from "vitest";
import {
  appendRecentActivity,
  createProgressActivity,
  displayProgressMode,
  formatProgressUpdate,
  formatRecentActivity,
  normalizeProgressMode,
  progressIntervalMsFor,
  progressModeFor,
  shouldSendNonTerminalProgress,
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
