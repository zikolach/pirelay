import { describe, expect, it, vi } from "vitest";
import {
  confirmationRequiredAction,
  createRelayPipeline,
  readLastAction,
  redactForTrace,
  spokenOutputEvent,
  transcriptPrompt,
  relayPipelineProtocolVersion,
  type RelayMiddleware,
  type RelayPipelineContext,
  type RelayPipelineEvent,
} from "../extensions/telegram-tunnel/relay-middleware.js";

function event(overrides: Partial<RelayPipelineEvent> = {}): RelayPipelineEvent {
  return {
    id: "event-1",
    channel: "telegram",
    phase: "inbound",
    inbound: {
      kind: "message",
      channel: "telegram",
      updateId: "1",
      messageId: "2",
      text: "hello",
      attachments: [],
      conversation: { channel: "telegram", id: "10", kind: "private" },
      sender: { channel: "telegram", userId: "20" },
    },
    authorized: true,
    adapter: { channel: "telegram", capabilities: { inlineButtons: true } },
    ...overrides,
  };
}

function context(): RelayPipelineContext {
  return {
    trace: [],
    emitTrace(entry) {
      this.trace.push(entry);
    },
  };
}

const invalidAdapterRequirement: RelayMiddleware = {
  id: "invalid-adapter-requirement",
  phases: ["inbound"],
  capabilities: {
    // @ts-expect-error adapter requirements are limited to boolean channel capabilities.
    adapter: ["maxTextChars"],
  },
  run: async () => ({ kind: "continue" }),
};
void invalidAdapterRequirement;

describe("relay middleware pipeline", () => {
  it("exports a protocol version for broker envelopes", () => {
    expect(relayPipelineProtocolVersion).toBe(1);
  });

  it("runs middleware in deterministic phase order", async () => {
    const calls: string[] = [];
    const middleware: RelayMiddleware[] = [
      { id: "late", phases: ["intent"], order: 20, run: async () => { calls.push("late"); return { kind: "continue" }; } },
      { id: "early", phases: ["inbound"], order: 10, run: async () => { calls.push("early"); return { kind: "continue" }; } },
      { id: "middle", phases: ["intent"], order: 10, run: async () => { calls.push("middle"); return { kind: "continue" }; } },
    ];

    const result = await createRelayPipeline(middleware).run(event(), context());
    expect(result.kind).toBe("continue");
    expect(calls).toEqual(["early", "middle", "late"]);
  });

  it("rejects duplicate middleware ids", () => {
    expect(() => createRelayPipeline([
      { id: "duplicate", phases: ["inbound"], run: async () => ({ kind: "continue" }) },
      { id: "duplicate", phases: ["intent"], run: async () => ({ kind: "continue" }) },
    ])).toThrow("Duplicate middleware id: duplicate");
  });

  it("rejects unknown middleware ordering references", () => {
    expect(() => createRelayPipeline([
      { id: "source", phases: ["inbound"], ordering: { after: ["missing"] }, run: async () => ({ kind: "continue" }) },
    ])).toThrow("Unknown middleware ordering reference: source after missing");
    expect(() => createRelayPipeline([
      { id: "source", phases: ["inbound"], ordering: { before: ["missing"] }, run: async () => ({ kind: "continue" }) },
    ])).toThrow("Unknown middleware ordering reference: source before missing");
  });

  it("honors before ordering constraints regardless of input order", async () => {
    const calls: string[] = [];
    const middleware: RelayMiddleware[] = [
      { id: "target", phases: ["intent"], order: 1, run: async () => { calls.push("target"); return { kind: "continue" }; } },
      { id: "source", phases: ["intent"], order: 99, ordering: { before: ["target"] }, run: async () => { calls.push("source"); return { kind: "continue" }; } },
    ];

    await createRelayPipeline(middleware).run(event(), context());
    expect(calls).toEqual(["source", "target"]);
  });

  it("returns prompt, channel response, internal action, and blocked results", async () => {
    await expect(createRelayPipeline([{ id: "prompt", phases: ["delivery"], run: async () => ({ kind: "prompt", prompt: { content: "hi", safety: "safe" } }) }]).run(event(), context()))
      .resolves.toMatchObject({ kind: "prompt", prompt: { content: "hi" } });
    await expect(createRelayPipeline([{ id: "response", phases: ["outbound"], run: async () => ({ kind: "channel-response", response: { kind: "text", text: "ok", safety: "safe" } }) }]).run(event(), context()))
      .resolves.toMatchObject({ kind: "channel-response", response: { text: "ok" } });
    await expect(createRelayPipeline([{ id: "action", phases: ["intent"], run: async () => ({ kind: "internal-action", action: { type: "repeat-last", safety: "safe" } }) }]).run(event(), context()))
      .resolves.toMatchObject({ kind: "internal-action", action: { type: "repeat-last" } });
    await expect(createRelayPipeline([{ id: "blocked", phases: ["inbound"], run: async () => ({ kind: "blocked", reason: "nope", safety: "safe" }) }]).run(event(), context()))
      .resolves.toMatchObject({ kind: "blocked", reason: "nope" });
  });

  it("blocks unsafe pre-authorization media middleware", async () => {
    const mediaMiddleware: RelayMiddleware = {
      id: "media-download",
      phases: ["inbound"],
      safety: "media-download",
      requiresAuthorization: true,
      run: vi.fn(async () => ({ kind: "continue" as const })),
    };

    const result = await createRelayPipeline([mediaMiddleware]).run(event({ authorized: false }), context());
    expect(result).toMatchObject({ kind: "blocked", reason: "authorization-required" });
    expect(mediaMiddleware.run).not.toHaveBeenCalled();
  });

  it("traces fatal missing capabilities as blocked", async () => {
    const ctx = context();
    const result = await createRelayPipeline([{
      id: "needs-buttons",
      phases: ["outbound"],
      capabilities: { adapter: ["callbacks"] },
      failure: "fatal",
      run: async () => ({ kind: "continue" }),
    }]).run(event({ adapter: { channel: "telegram", capabilities: { callbacks: false } } }), ctx);

    expect(result).toMatchObject({ kind: "blocked", reason: "missing-adapter-capability:callbacks" });
    expect(ctx.trace).toContainEqual(expect.objectContaining({ middlewareId: "needs-buttons", outcome: "blocked" }));
  });

  it("continues after recoverable failures and stops on fatal failures", async () => {
    const recoverable = createRelayPipeline([
      { id: "recoverable", phases: ["inbound"], failure: "recoverable", run: async () => { throw new Error("secret token"); } },
      { id: "next", phases: ["intent"], run: async () => ({ kind: "channel-response", response: { kind: "text", text: "ok", safety: "safe" } }) },
    ]);
    await expect(recoverable.run(event(), context())).resolves.toMatchObject({ kind: "channel-response" });

    const fatal = createRelayPipeline([
      { id: "fatal", phases: ["inbound"], failure: "fatal", run: async () => { throw new Error("boom"); } },
      { id: "never", phases: ["intent"], run: async () => ({ kind: "continue" }) },
    ]);
    await expect(fatal.run(event(), context())).resolves.toMatchObject({ kind: "error", middlewareId: "fatal" });
  });

  it("provides future audio accessibility extension point helpers", () => {
    expect(transcriptPrompt("please summarize", { mediaId: "voice-1" })).toMatchObject({
      content: "please summarize",
      safety: "redacted",
      metadata: { accessibility: "transcript", mediaId: "voice-1" },
    });
    expect(spokenOutputEvent("safe answer")).toMatchObject({ kind: "spoken-output", text: "safe answer", safety: "safe-for-speech" });
    expect(readLastAction()).toMatchObject({ type: "read-last", safety: "safe", metadata: { accessibility: "read-last" } });
    expect(confirmationRequiredAction({ type: "abort", safety: "requires-confirmation" })).toMatchObject({
      type: "abort",
      requiresConfirmation: true,
      safety: "requires-confirmation",
    });
  });

  it("redacts trace data", () => {
    expect(redactForTrace("bot token=abc123 should hide")).toBe("bot [redacted] should hide");
  });
});
