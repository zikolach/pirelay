import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  analyzeFinalAssistantExtraction,
  boundedDiagnosticPreview,
  createCommunicationDiagnosticsLogger,
  redactDiagnosticText,
  resolveCommunicationDiagnosticsConfig,
} from "../extensions/relay/diagnostics/communication.js";
import type { AgentMessage } from "@mariozechner/pi-agent-core";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pirelay-diagnostics-"));
}

describe("communication diagnostics", () => {
  it("is disabled by default and resolves a state-dir log path", async () => {
    const dir = await tempDir();
    const config = resolveCommunicationDiagnosticsConfig({ stateDir: dir, env: {} });
    expect(config.enabled).toBe(false);
    expect(config.logPath).toBe(join(dir, "logs", "communication.jsonl"));
    const logger = createCommunicationDiagnosticsLogger(config);
    await logger.record({ component: "runtime", event: "agent_start", details: { token: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" } });
    await expect(stat(config.logPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes redacted bounded jsonl records and rotates logs", async () => {
    const dir = await tempDir();
    const logPath = join(dir, "communication.jsonl");
    const config = resolveCommunicationDiagnosticsConfig({
      stateDir: dir,
      env: { PI_RELAY_COMMUNICATION_DIAGNOSTICS: "1", PI_RELAY_DIAGNOSTICS_LOG_PATH: logPath, PI_RELAY_DIAGNOSTICS_MAX_BYTES: "1200", PI_RELAY_DIAGNOSTICS_MAX_FILES: "2" },
      redactionPatterns: ["custom-secret-[a-z]+"],
    });
    const logger = createCommunicationDiagnosticsLogger(config);
    await logger.record({ component: "broker", event: "route.register", sessionKey: "session", details: { value: "xoxb-123-secret custom-secret-alpha", large: "a".repeat(2000) } });
    const first = await readFile(logPath, "utf8");
    expect(first).toContain("route.register");
    expect(first).not.toContain("xoxb-123-secret");
    expect(first).not.toContain("custom-secret-alpha");
    expect(first).toContain("[redacted]");
    const mode = (await stat(logPath)).mode & 0o777;
    expect(mode).toBe(0o600);

    await logger.record({ component: "broker", event: "big", details: { large: "b".repeat(3000) } });
    const rotated = await readFile(`${logPath}.1`, "utf8");
    expect(rotated).toContain("route.register");
  });

  it("bounds optional content previews", () => {
    const withoutPreview = boundedDiagnosticPreview("secret token=abcd1234efgh5678", { includeContentPreview: false, previewChars: 80, redactionPatterns: [] });
    expect(withoutPreview).toBeUndefined();
    const preview = boundedDiagnosticPreview("hello token=abcd1234efgh5678 world ".repeat(20), { includeContentPreview: true, previewChars: 60, redactionPatterns: [] });
    expect(preview).toContain("[redacted]");
    expect(preview!.length).toBeLessThanOrEqual(60);
  });

  it("analyzes missing final assistant text without transcript content", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "raw prompt should not appear" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call-1" }, { type: "text", text: "   " }] },
      { role: "toolResult", content: [{ type: "text", text: "raw tool result should not appear" }] },
    ] as unknown as AgentMessage[];
    const result = analyzeFinalAssistantExtraction(messages, { includeContentPreview: false, previewChars: 80, redactionPatterns: [] });
    expect(result.finalText).toBeUndefined();
    expect(result.diagnostics).toMatchObject({
      messageCount: 3,
      assistantMessageCount: 1,
      finalTextFound: false,
      missingReason: "no-non-empty-assistant-text",
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain("raw prompt");
    expect(JSON.stringify(result.diagnostics)).not.toContain("raw tool result");
  });

  it("can include a redacted final-text preview only when enabled", () => {
    const result = analyzeFinalAssistantExtraction([
      { role: "assistant", content: [{ type: "text", text: "Final with 123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456" }] },
    ] as unknown as AgentMessage[], { includeContentPreview: true, previewChars: 120, redactionPatterns: [] });
    expect(result.finalText).toContain("Final with");
    expect(result.diagnostics.contentPreview).toBe("Final with [redacted]");
  });
});
