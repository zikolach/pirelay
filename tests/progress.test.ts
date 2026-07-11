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
import { deliverLiveProgress } from "../extensions/relay/notifications/progress-delivery.js";
import type { LiveProgressDeliveryState } from "../extensions/relay/notifications/progress-delivery.js";
import { createToolProgressAccumulator, formatToolProgressCard, summarizeToolProgress, toolProgressRows } from "../extensions/relay/notifications/tool-progress.js";
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

  it("coalesces repeated tool-progress cards to the latest bounded card", () => {
    const first = createProgressActivity({ id: "tool-card-1", kind: "tool", text: "Tool progress", detail: "▶ bash: npm test", semanticKey: "tool-progress", at: 1 }, config)!;
    const second = createProgressActivity({ id: "tool-card-2", kind: "tool", text: "Tool progress", detail: "✓ bash: npm test · ▶ edit: tests/progress.test.ts", semanticKey: "tool-progress", at: 2 }, config)!;
    const coalesced = coalesceLiveProgressEntries([first, second]);

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.text).toBe("Tool progress");
    expect(coalesced[0]?.detail).toContain("edit: tests/progress.test.ts");
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

describe("tool progress helpers", () => {
  it("summarizes allowlisted tool intent without leaking unallowlisted payloads", () => {
    const safeConfig = { ...config, redactionPatterns: ["SECRET_[A-Z]+", "123456789"] };

    expect(summarizeToolProgress("bash", { command: "npm test\necho SECRET_TOKEN", output: "do not show" }, safeConfig)?.label).toBe("bash: npm test");
    expect(summarizeToolProgress("read", { path: "extensions/relay/runtime/extension-runtime.ts", content: "SECRET_FILE" }, safeConfig)?.label).toContain("read: extensions/relay/runtime/extension");
    expect(summarizeToolProgress("edit", { path: "tests/integration.test.ts", oldText: "SECRET_OLD", newText: "SECRET_NEW" }, safeConfig)?.label).toBe("edit: tests/integration.test.ts");
    expect(summarizeToolProgress("write", { path: "README.md", content: "SECRET_CONTENT" }, safeConfig)?.label).toBe("write: README.md");
    expect(summarizeToolProgress("rg", { pattern: "botToken=SECRET_VALUE", path: "extensions" }, safeConfig)?.label).toBe("rg: botToken=[redacted] in extensions");
    expect(summarizeToolProgress("find", { path: "123456789", transcript: "raw transcript" }, safeConfig)?.label).toBe("find: [redacted]");
    expect(summarizeToolProgress("ls", { dir: "src", chatId: "123456789" }, safeConfig)?.label).toBe("ls: src");
    expect(summarizeToolProgress("bash", { command: "npm test" }, safeConfig)?.semanticKey).toBe("bash:-npm-test");
  });

  it("keeps unknown tools conservative", () => {
    const label = summarizeToolProgress("custom_secret_tool", { prompt: "SECRET_PROMPT", chatId: "123456789", args: ["raw"] }, { ...config, redactionPatterns: ["SECRET_[A-Z]+", "123456789"] });

    expect(label).toMatchObject({ toolName: "custom_secret_tool", label: "custom_secret_tool" });
    expect(JSON.stringify(label)).not.toContain("SECRET_PROMPT");
    expect(JSON.stringify(label)).not.toContain("123456789");
    expect(JSON.stringify(label)).not.toContain("raw");
  });

  it("redacts aggregate tool names", () => {
    const accumulator = createToolProgressAccumulator();
    const safeConfig = { ...config, redactionPatterns: ["SECRET_[A-Z]+"] };

    accumulator.start({ toolName: "SECRET_TOKEN", toolCallId: "secret-1", at: 1 }, safeConfig);
    accumulator.start({ toolName: "SECRET_TOKEN", toolCallId: "secret-2", at: 2 }, safeConfig);

    const snapshot = accumulator.snapshot();
    const rows = toolProgressRows(snapshot);
    const rendered = rows.map((row) => row.text).join("\n");
    expect(snapshot.aggregates).toEqual([{ toolName: "redacted", count: 2 }]);
    expect(rendered).toContain("redacted×2");
    expect(rendered).not.toContain("SECRET_TOKEN");
    expect(rendered).not.toContain("secret_token");
  });

  it("aggregates active, completed, failed, repeated, and truncated tool progress", () => {
    const accumulator = createToolProgressAccumulator();
    const safeConfig = { ...config, maxProgressMessageChars: 160 };

    accumulator.start({ toolName: "bash", toolCallId: "bash-1", input: { command: "npm test" }, at: 1 }, safeConfig);
    accumulator.finish({ toolName: "bash", toolCallId: "bash-1", failed: false, at: 2 }, safeConfig);
    accumulator.start({ toolName: "bash", toolCallId: "bash-2", input: { command: "npm run typecheck" }, at: 3 }, safeConfig);
    accumulator.start({ toolName: "read", toolCallId: "read-1", input: { path: "extensions/relay/notifications/progress.ts" }, at: 4 }, safeConfig);
    accumulator.finish({ toolName: "read", toolCallId: "read-1", failed: true, at: 5 }, safeConfig);

    const snapshot = accumulator.snapshot();
    const rows = toolProgressRows(snapshot);
    const card = formatToolProgressCard(snapshot, safeConfig);
    const activity = accumulator.activity({ id: "tools", at: 6 }, safeConfig);

    expect(rows.map((row) => row.text).join("\n")).toContain("▶ bash: npm run typecheck");
    expect(rows.map((row) => row.text).join("\n")).toContain("✕ read: extensions/relay/notifications/progress.ts");
    expect(rows.at(-1)?.text).toContain("bash×2");
    expect(card).toContain("bash");
    expect(card!.length).toBeLessThanOrEqual(160);
    expect(activity).toMatchObject({ kind: "tool", text: "Tool progress", delivery: "milestone" });
  });

  it("marks a bounded card when rows are omitted", () => {
    const accumulator = createToolProgressAccumulator();
    const safeConfig = { ...config, maxProgressMessageChars: 120 };
    for (let index = 0; index < 4; index += 1) {
      accumulator.start({ toolName: "read", toolCallId: `read-${index}`, input: { path: `extensions/relay/very-long-progress-file-name-${index}.ts` }, at: index }, safeConfig);
    }

    const card = formatToolProgressCard(accumulator.snapshot(), safeConfig);
    expect(card).toMatch(/…$/u);
    expect(card!.length).toBeLessThanOrEqual(120);
  });

  it("keeps completed rows when active rows are capped", () => {
    const accumulator = createToolProgressAccumulator();
    const safeConfig = { ...config, maxProgressMessageChars: 200 };

    accumulator.start({ toolName: "bash", toolCallId: "bash-1", input: { command: "one" }, at: 1 }, safeConfig);
    accumulator.start({ toolName: "read", toolCallId: "read-1", input: { path: "alpha" }, at: 2 }, safeConfig);
    accumulator.start({ toolName: "edit", toolCallId: "edit-1", input: { path: "beta" }, at: 3 }, safeConfig);
    accumulator.start({ toolName: "find", toolCallId: "find-1", input: { path: "gamma" }, at: 4 }, safeConfig);
    accumulator.finish({ toolName: "ls", toolCallId: "ls-1", at: 5 }, safeConfig);

    const rows = toolProgressRows(accumulator.snapshot());
    expect(rows.some((row) => row.text.startsWith("✓ ls:") || row.text.startsWith("✓ ls"))).toBe(true);
  });

  it("reuses missing tool-call identity by safe semantic label", () => {
    const accumulator = createToolProgressAccumulator();
    accumulator.start({ toolName: "read", input: { path: "README.md" }, at: 1 }, config);
    accumulator.finish({ toolName: "read", input: { path: "README.md" }, failed: false, at: 2 }, config);

    expect(accumulator.snapshot().records).toHaveLength(1);
    expect(formatToolProgressCard(accumulator.snapshot(), config)).toContain("✓ read: README.md");
  });

  it("enriches and completes one missing-id record across lifecycle labels", () => {
    const accumulator = createToolProgressAccumulator();
    accumulator.start({ toolName: "bash", at: 1 }, config);
    accumulator.start({ toolName: "bash", input: { command: "npm test" }, at: 2 }, config);
    accumulator.finish({ toolName: "bash", failed: false, at: 3 }, config);

    expect(accumulator.snapshot().records).toEqual([
      expect.objectContaining({ toolCallId: "missing-1", state: "completed", label: "bash: npm test" }),
    ]);
    expect(accumulator.consumeResultMatch({ toolName: "bash" }, config)).toBe(true);
    expect(accumulator.consumeResultMatch({ toolName: "bash" }, config)).toBe(false);
    expect(accumulator.consumeResultMatch({ toolName: "read" }, config)).toBe(false);
    expect(formatToolProgressCard(accumulator.snapshot(), config)).toContain("✓ bash: npm test");
  });

  it("discards staged progress by explicit or missing tool-call identity", () => {
    const accumulator = createToolProgressAccumulator();
    accumulator.start({ toolName: "bash", toolCallId: "blocked-1", at: 1 }, config);
    accumulator.discard("blocked-1");
    accumulator.start({ toolName: "read", at: 2 }, config);
    accumulator.discardMatching({ toolName: "read", input: { path: "README.md" } }, config);

    expect(accumulator.snapshot().records).toEqual([]);
    expect(accumulator.activity({ id: "empty" }, config)).toBeUndefined();
  });

  it("bounds retained current-turn tool records", () => {
    const accumulator = createToolProgressAccumulator();
    for (let index = 0; index < 55; index += 1) {
      accumulator.start({ toolName: "read", toolCallId: `read-${index}`, input: { path: `file-${index}.ts` }, at: index }, config);
    }

    const snapshot = accumulator.snapshot();
    expect(snapshot.records).toHaveLength(50);
    expect(snapshot.records[0]?.label).toContain("file-5.ts");
    expect(snapshot.records.at(-1)?.label).toContain("file-54.ts");
  });
});

describe("deliverLiveProgress helper", () => {
  it("suppresses unchanged progress snapshots", async () => {
    const updates: string[] = [];
    const edits: string[] = [];
    const snapshots: string[] = [];
    const state: LiveProgressDeliveryState = { pending: [] };
    state.lastText = "Already sent";

    await deliverLiveProgress(state, "Already sent", {
      sendLiveProgress: async (text) => {
        updates.push(text);
        return "x";
      },
      updateLiveProgress: async (ref, text) => {
        edits.push(`${ref}:${text}`);
      },
      sendProgressSnapshot: async (text) => {
        snapshots.push(text);
      },
    });

    expect(updates).toHaveLength(0);
    expect(edits).toHaveLength(0);
    expect(snapshots).toHaveLength(0);
  });

  it("updates a live message when supported", async () => {
    const updates: string[] = [];
    const state: LiveProgressDeliveryState = { pending: [], liveMessageRef: "msg-1", lastText: undefined };

    await deliverLiveProgress(state, "Running tests", {
      sendLiveProgress: async (text) => {
        updates.push(`send:${text}`);
        return "msg-2";
      },
      updateLiveProgress: async (ref, text) => {
        updates.push(`update:${ref}:${text}`);
      },
      sendProgressSnapshot: async (text) => {
        updates.push(`snapshot:${text}`);
      },
    });

    expect(updates).toEqual(["update:msg-1:Running tests"]);
    expect(state.liveMessageRef).toBe("msg-1");
    expect(state.lastText).toBe("Running tests");
  });

  it("falls back to new live progress when live edit fails", async () => {
    const updates: string[] = [];
    const state: LiveProgressDeliveryState = { pending: [], liveMessageRef: "msg-1", lastText: undefined };

    await deliverLiveProgress(state, "Still running", {
      sendLiveProgress: async (text) => {
        updates.push(`send:${text}`);
        return "msg-2";
      },
      updateLiveProgress: async () => {
        updates.push("update-failed");
        throw new Error("edit failed");
      },
      sendProgressSnapshot: async (text) => {
        updates.push(`snapshot:${text}`);
      },
    });

    expect(updates[0]).toBe("update-failed");
    expect(updates[1]).toBe("send:Still running");
    expect(state.liveMessageRef).toBe("msg-2");
    expect(state.lastText).toBe("Still running");
    expect(updates).toHaveLength(2);
  });

  it("falls back to plain snapshot when live path fails", async () => {
    const updates: string[] = [];
    const state: LiveProgressDeliveryState = { pending: [] };

    await deliverLiveProgress(state, "Fallback snapshot", {
      sendLiveProgress: async () => {
        updates.push("send-live");
        throw new Error("live blocked");
      },
      sendProgressSnapshot: async (text) => {
        updates.push(`snapshot:${text}`);
      },
    });

    expect(updates).toEqual(["send-live", "snapshot:Fallback snapshot"]);
    expect(state.lastText).toBe("Fallback snapshot");
    expect(state.liveMessageRef).toBeUndefined();
  });

  it("clears stale live refs and swallows snapshot failures", async () => {
    const updates: string[] = [];
    const state: LiveProgressDeliveryState = { pending: [], liveMessageRef: "stale", lastText: "old" };

    await deliverLiveProgress(state, "Still running", {
      updateLiveProgress: async () => {
        updates.push("update");
        throw new Error("stale update");
      },
      sendLiveProgress: async () => {
        updates.push("send-live");
        throw new Error("send blocked");
      },
      sendProgressSnapshot: async (text) => {
        updates.push(`snapshot:${text}`);
        throw new Error("snapshot blocked");
      },
    });

    expect(updates).toEqual(["update", "send-live", "snapshot:Still running"]);
    expect(state.liveMessageRef).toBeUndefined();
    expect(state.lastText).toBe("old");
  });
});
