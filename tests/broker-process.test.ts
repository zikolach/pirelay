import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { extractStructuredAnswerMetadata } from "../extensions/relay/core/guided-answer.js";

const tempDirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => stopChild(child)));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("telegram broker process", () => {
  it("boots under plain node and opens its unix socket", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    await writeFile(join(stateDir, "state.json"), JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: {},
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
      },
    });
    children.push(child);

    await expect(waitForSocket(socketPath, child)).resolves.toBeUndefined();
  });

  it("does not resurrect a revoked Telegram binding from stale route registration", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const statePath = join(stateDir, "state.json");
    const revokedBinding = {
      sessionKey: "revoked-session:memory",
      sessionId: "revoked-session",
      sessionLabel: "Revoked Docs",
      chatId: 123,
      userId: 456,
      boundAt: new Date(0).toISOString(),
      lastSeenAt: new Date(1).toISOString(),
      revokedAt: new Date(2).toISOString(),
      status: "revoked",
    };
    await writeFile(statePath, JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: { "revoked-session:memory": revokedBinding },
      channelBindings: {},
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
      },
    });
    children.push(child);

    await waitForSocket(socketPath, child);
    await sendBrokerRequest(socketPath, {
      type: "request",
      requestId: "stale-revoked-route",
      action: "registerRoute",
      clientId: "test-client",
      route: {
        sessionKey: "revoked-session:memory",
        sessionId: "revoked-session",
        sessionLabel: "Revoked Docs",
        online: true,
        busy: false,
        notification: {},
        binding: {
          sessionKey: "revoked-session:memory",
          sessionId: "revoked-session",
          sessionLabel: "Revoked Docs",
          chatId: 123,
          userId: 456,
          boundAt: new Date(0).toISOString(),
          lastSeenAt: new Date(3).toISOString(),
        },
      },
    });

    const updated = JSON.parse(await readFile(statePath, "utf8")) as { bindings?: Record<string, { status?: string; revokedAt?: string; lastSeenAt?: string }> };
    expect(updated.bindings?.["revoked-session:memory"]).toMatchObject({ status: "revoked", revokedAt: revokedBinding.revokedAt, lastSeenAt: revokedBinding.lastSeenAt });
  });

  it("does not authorize stale route bindings when broker state is corrupt", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const statePath = join(stateDir, "state.json");
    await writeFile(statePath, "{not-json", "utf8");

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
      },
    });
    children.push(child);

    await waitForSocket(socketPath, child);
    await sendBrokerRequest(socketPath, {
      type: "request",
      requestId: "corrupt-state-route",
      action: "registerRoute",
      clientId: "test-client",
      route: {
        sessionKey: "corrupt-session:memory",
        sessionId: "corrupt-session",
        sessionLabel: "Corrupt Docs",
        online: true,
        busy: false,
        notification: {},
        binding: {
          sessionKey: "corrupt-session:memory",
          sessionId: "corrupt-session",
          sessionLabel: "Corrupt Docs",
          chatId: 123,
          userId: 456,
          boundAt: new Date(0).toISOString(),
          lastSeenAt: new Date(3).toISOString(),
        },
      },
    });

    expect(await readFile(statePath, "utf8")).toBe("{not-json");
  });

  it("hydrates registered routes with persisted Telegram bindings when the client route is stale", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const statePath = join(stateDir, "state.json");
    const persistedBinding = {
      sessionKey: "hydrated-session:memory",
      sessionId: "hydrated-session",
      sessionLabel: "Hydrated Docs",
      chatId: 123,
      userId: 456,
      boundAt: new Date(0).toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      status: "active",
    };
    await writeFile(statePath, JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: { "hydrated-session:memory": persistedBinding },
      channelBindings: {},
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
      },
    });
    children.push(child);

    await waitForSocket(socketPath, child);
    await sendBrokerRequest(socketPath, {
      type: "request",
      requestId: "hydrate-route-binding",
      action: "registerRoute",
      clientId: "test-client",
      route: {
        sessionKey: "hydrated-session:memory",
        sessionId: "hydrated-session",
        sessionLabel: "Hydrated Docs",
        online: true,
        busy: false,
        notification: {},
      },
    });

    const updated = JSON.parse(await readFile(statePath, "utf8")) as { bindings?: Record<string, { status?: string; chatId?: number; userId?: number }> };
    expect(updated.bindings?.["hydrated-session:memory"]).toMatchObject({ status: "active", chatId: 123, userId: 456 });
  });

  it("preserves non-Telegram channel bindings when updating broker state", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const statePath = join(stateDir, "state.json");
    const discordBinding = {
      channel: "discord",
      conversationId: "dm1",
      userId: "du1",
      sessionKey: "discord-session:memory",
      sessionId: "discord-session",
      sessionLabel: "Discord Docs",
      boundAt: new Date(0).toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      status: "active",
    };
    await writeFile(statePath, JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: {},
      channelBindings: { "discord:discord-session:memory": discordBinding },
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
      },
    });
    children.push(child);

    await waitForSocket(socketPath, child);
    await sendBrokerRequest(socketPath, {
      type: "request",
      requestId: "preserve-channel-bindings",
      action: "registerRoute",
      clientId: "test-client",
      route: {
        sessionKey: "telegram-session:memory",
        sessionId: "telegram-session",
        sessionLabel: "Telegram Docs",
        online: true,
        busy: false,
        notification: {},
        binding: {
          sessionKey: "telegram-session:memory",
          sessionId: "telegram-session",
          sessionLabel: "Telegram Docs",
          chatId: 123,
          userId: 123,
          boundAt: new Date(0).toISOString(),
          lastSeenAt: new Date(0).toISOString(),
        },
      },
    });

    const updated = JSON.parse(await readFile(statePath, "utf8")) as { channelBindings?: Record<string, unknown> };
    expect(updated.channelBindings?.["discord:discord-session:memory"]).toEqual(discordBinding);
  });

  it("reports paired broker-owned chats as offline instead of unpaired when no live route is registered", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-offline-text-"));
    tempDirs.push(stateDir);
    const outboxPath = join(stateDir, "telegram-outbox.jsonl");
    const testIngressSecret = "offline-text-secret";
    const binding = {
      sessionKey: "broker-offline-text:memory",
      sessionId: "broker-offline-text",
      sessionLabel: "Broker Offline Text",
      chatId: 123,
      userId: 456,
      boundAt: new Date(0).toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      status: "active",
    };
    await writeFile(join(stateDir, "state.json"), JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: { [binding.sessionKey]: binding },
      channelBindings: {},
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
        PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH: outboxPath,
        PI_RELAY_BROKER_TEST_INGRESS_SECRET: testIngressSecret,
      },
    });
    children.push(child);

    await waitForSocket(socketPath, child);
    const client = await openBrokerClient(socketPath);
    try {
      await client.request({
        type: "request",
        action: "testProcessInbound",
        testIngressSecret,
        message: telegramMessage("hello while route is reconnecting", binding),
      });
    } finally {
      client.close();
    }

    const texts = parseOutbox(await readFile(outboxPath, "utf8"))
      .filter((entry): entry is TestOutboxMessage => entry.method === "sendMessage")
      .map((entry) => entry.text);
    expect(texts).toEqual(["The selected Pi session is currently offline. Resume it locally, then try again."]);
  });

  it("delivers broker-owned full-output chunks before structured answer actions", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const outboxPath = join(stateDir, "telegram-outbox.jsonl");
    const binding = {
      sessionKey: "broker-structured:memory",
      sessionId: "broker-structured",
      sessionLabel: "Broker Structured",
      chatId: 123,
      userId: 456,
      boundAt: new Date(0).toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      status: "active",
    };
    await writeFile(join(stateDir, "state.json"), JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: { [binding.sessionKey]: binding },
      channelBindings: {},
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
          maxTelegramMessageChars: 60,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
        PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH: outboxPath,
      },
    });
    children.push(child);

    const finalOutput = [
      "Choose:",
      "1. sync changes",
      "2. skip changes",
      "",
      "Notes:",
      "  keep indentation",
    ].join("\n");
    const structuredAnswer = extractStructuredAnswerMetadata(finalOutput);
    expect(structuredAnswer).toBeDefined();

    await waitForSocket(socketPath, child);
    const client = await openBrokerClient(socketPath);
    try {
      await client.request({
        type: "request",
        requestId: "register-structured-output",
        action: "registerRoute",
        clientId: "test-client",
        route: {
          sessionKey: binding.sessionKey,
          sessionId: binding.sessionId,
          sessionLabel: binding.sessionLabel,
          online: true,
          busy: false,
          notification: {
            lastStatus: "completed",
            lastTurnId: "turn-structured",
            lastAssistantText: finalOutput,
            structuredAnswer,
          },
          binding,
        },
      });
      await client.request({
        type: "request",
        requestId: "send-structured-output",
        action: "sendToBoundChat",
        sessionKey: binding.sessionKey,
        text: "compact fallback",
        terminalStatus: "completed",
      });
    } finally {
      client.close();
    }

    const outbox = parseOutbox(await readFile(outboxPath, "utf8"));
    const texts = outbox.filter((entry): entry is TestOutboxMessage => entry.method === "sendMessage").map((entry) => entry.text);
    expect(texts.some((text) => text.includes("Final output:"))).toBe(true);
    expect(texts.join("\n")).toContain("Choose:\n1. sync changes");
    expect(texts.some((text) => text.includes("Tap an option button"))).toBe(true);
    expect(texts.some((text) => text.startsWith("[1/1]"))).toBe(false);
  });

  it("renders broker-owned Telegram Markdown output with HTML parse mode", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const outboxPath = join(stateDir, "telegram-outbox.jsonl");
    const binding = {
      sessionKey: "broker-markdown:memory",
      sessionId: "broker-markdown",
      sessionLabel: "Broker Markdown",
      chatId: 123,
      userId: 456,
      boundAt: new Date(0).toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      status: "active",
    };
    await writeFile(join(stateDir, "state.json"), JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: { [binding.sessionKey]: binding },
      channelBindings: {},
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
          maxTelegramMessageChars: 3900,
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
        PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH: outboxPath,
      },
    });
    children.push(child);

    await waitForSocket(socketPath, child);
    const client = await openBrokerClient(socketPath);
    try {
      await client.request({
        type: "request",
        requestId: "register-markdown-output",
        action: "registerRoute",
        clientId: "test-client",
        route: {
          sessionKey: binding.sessionKey,
          sessionId: binding.sessionId,
          sessionLabel: binding.sessionLabel,
          online: true,
          busy: false,
          notification: {
            lastStatus: "completed",
            lastTurnId: "turn-markdown",
            lastAssistantText: [
              "**Summary**",
              "- Ran `npm test`",
              "",
              "| Check | Result |",
              "| --- | --- |",
              "| tests | passed |",
            ].join("\n"),
          },
          binding,
        },
      });
      await client.request({
        type: "request",
        requestId: "send-markdown-output",
        action: "sendToBoundChat",
        sessionKey: binding.sessionKey,
        text: "compact fallback",
        terminalStatus: "completed",
      });
    } finally {
      client.close();
    }

    const outbox = parseOutbox(await readFile(outboxPath, "utf8"));
    const output = outbox.find((entry): entry is TestOutboxMessage => entry.method === "sendMessage" && entry.text.includes("<b>Summary</b>"));
    expect(output?.text).toContain("- Ran <code>npm test</code>");
    expect(output?.text).toContain("<pre><code>Check | Result");
    expect(output?.options).toMatchObject({
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[
        { text: "📄 Show in chat", callback_data: "full:turn-markdown:chat" },
        { text: "⬇️ Download .md", callback_data: "full:turn-markdown:md" },
      ]] },
    });
  });

  it("redacts broker-owned Markdown document fallback output", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const outboxPath = join(stateDir, "telegram-outbox.jsonl");
    const binding = {
      sessionKey: "broker-document:memory",
      sessionId: "broker-document",
      sessionLabel: "Broker Document",
      chatId: 123,
      userId: 456,
      boundAt: new Date(0).toISOString(),
      lastSeenAt: new Date(0).toISOString(),
      status: "active",
    };
    await writeFile(join(stateDir, "state.json"), JSON.stringify({
      setup: {
        botId: 1,
        botUsername: "dummy_bot",
        botDisplayName: "Dummy",
        validatedAt: new Date(0).toISOString(),
      },
      pendingPairings: {},
      bindings: { [binding.sessionKey]: binding },
      channelBindings: {},
    }));

    const socketPath = join(stateDir, "broker.sock");
    const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 1,
          maxTelegramMessageChars: 10,
          redactionPatterns: ["shhh-secret"],
        }),
        TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
        PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH: outboxPath,
      },
    });
    children.push(child);

    const finalOutput = [
      "paragraph one shhh-secret",
      "",
      "paragraph two",
      "",
      "paragraph three",
      "",
      "paragraph four",
      "",
      "paragraph five",
      "",
      "paragraph six",
    ].join("\n");

    await waitForSocket(socketPath, child);
    const client = await openBrokerClient(socketPath);
    try {
      await client.request({
        type: "request",
        requestId: "register-document-output",
        action: "registerRoute",
        clientId: "test-client",
        route: {
          sessionKey: binding.sessionKey,
          sessionId: binding.sessionId,
          sessionLabel: binding.sessionLabel,
          online: true,
          busy: false,
          notification: {
            lastStatus: "completed",
            lastTurnId: "turn-document",
            lastAssistantText: finalOutput,
          },
          binding,
        },
      });
      await client.request({
        type: "request",
        requestId: "send-document-output",
        action: "sendToBoundChat",
        sessionKey: binding.sessionKey,
        text: "compact fallback",
        terminalStatus: "completed",
      });
    } finally {
      client.close();
    }

    const outbox = parseOutbox(await readFile(outboxPath, "utf8"));
    const document = outbox.find((entry): entry is TestOutboxDocument => entry.method === "sendDocument");
    expect(document?.document.fileName).toBe("pi-output-broker-document-turn-document.md");
    expect(document?.document.text).toContain("[redacted]");
    expect(document?.document.text).not.toContain("shhh-secret");
  });

  it("delivers broker-owned idle Telegram /skill without queued-mode acknowledgement", async () => {
    const harness = await startBrokerSkillHarness("followUp", false);
    try {
      await harness.client.request({
        type: "request",
        action: "testProcessInbound",
        testIngressSecret: harness.testIngressSecret,
        message: telegramMessage("/skill github inspect repo", harness.binding),
      });
    } finally {
      harness.client.close();
    }

    expect(harness.deliveries).toHaveLength(1);
    expect(harness.deliveries[0]).toMatchObject({
      text: "Use the local Pi skill /skill:github with this input:\n\ninspect repo",
    });
    const texts = parseOutbox(await readFile(harness.outboxPath, "utf8"))
      .filter((entry): entry is TestOutboxMessage => entry.method === "sendMessage")
      .map((entry) => entry.text);
    expect(texts.at(-1)).toContain("invocation accepted.");
    expect(texts.at(-1)).not.toContain("(followUp)");
    expect(texts.at(-1)).not.toContain("(steer)");
  });

  it("queues broker-owned busy Telegram /skill delivery with the configured mode", async () => {
    const harness = await startBrokerSkillHarness("steer", true);
    try {
      await harness.client.request({
        type: "request",
        action: "testProcessInbound",
        testIngressSecret: harness.testIngressSecret,
        message: telegramMessage("/skill github inspect repo", harness.binding),
      });
    } finally {
      harness.client.close();
    }

    expect(harness.deliveries).toHaveLength(1);
    expect(harness.deliveries[0]).toMatchObject({
      text: "Use the local Pi skill /skill:github with this input:\n\ninspect repo",
      deliverAs: "steer",
    });
    const texts = parseOutbox(await readFile(harness.outboxPath, "utf8"))
      .filter((entry): entry is TestOutboxMessage => entry.method === "sendMessage")
      .map((entry) => entry.text);
    expect(texts.at(-1)).toContain("invocation accepted (steer)");
  });

  it("queues broker-owned busy Telegram pending skill input with the configured mode", async () => {
    const harness = await startBrokerSkillHarness("followUp", true);
    try {
      await harness.client.request({
        type: "request",
        action: "testProcessInbound",
        testIngressSecret: harness.testIngressSecret,
        message: telegramMessage("/skill github", harness.binding, 1),
      });
      await harness.client.request({
        type: "request",
        action: "testProcessInbound",
        testIngressSecret: harness.testIngressSecret,
        message: telegramMessage("inspect later", harness.binding, 2),
      });
    } finally {
      harness.client.close();
    }

    expect(harness.deliveries).toHaveLength(1);
    expect(harness.deliveries[0]).toMatchObject({
      text: "Use the local Pi skill /skill:github with this input:\n\ninspect later",
      deliverAs: "followUp",
    });
    const texts = parseOutbox(await readFile(harness.outboxPath, "utf8"))
      .filter((entry): entry is TestOutboxMessage => entry.method === "sendMessage")
      .map((entry) => entry.text);
    expect(texts).toContain("Send input for skill github as your next message, or send /skill cancel.");
    expect(texts.at(-1)).toContain("invocation accepted (followUp)");
  });

  it("does not fetch broker skill metadata while remote skills are disabled", async () => {
    const harness = await startBrokerSkillHarness("followUp", false, { enabled: false });
    try {
      await harness.client.request({
        type: "request",
        action: "testProcessInbound",
        testIngressSecret: harness.testIngressSecret,
        message: telegramMessage("/skill github inspect repo", harness.binding, 1),
      });
      await harness.client.request({
        type: "request",
        action: "testProcessInbound",
        testIngressSecret: harness.testIngressSecret,
        message: telegramMessage("/skill github", harness.binding, 2),
      });
    } finally {
      harness.client.close();
    }

    expect(harness.counters.skillMetadataRequests).toBe(0);
    expect(harness.deliveries).toHaveLength(0);
    const texts = parseOutbox(await readFile(harness.outboxPath, "utf8"))
      .filter((entry): entry is TestOutboxMessage => entry.method === "sendMessage")
      .map((entry) => entry.text);
    expect(texts).toEqual(["Remote skill invocation is disabled.", "Remote skill invocation is disabled."]);
  });

  it("rejects pending broker client requests when the socket closes cleanly", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-process-"));
    tempDirs.push(stateDir);
    const socketPath = join(stateDir, "test-broker.sock");
    const server = net.createServer((socket) => {
      socket.once("data", () => socket.end());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      const client = await openBrokerClient(socketPath);
      await expect(client.request({ type: "request", action: "never-responds" })).rejects.toThrow("Broker client socket closed before pending requests completed.");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

async function startBrokerSkillHarness(busyDeliveryMode: "followUp" | "steer", busy: boolean, skills: { enabled: boolean; allow?: string[] } = { enabled: true, allow: ["github"] }) {
  const stateDir = await mkdtemp(join(tmpdir(), "pirelay-broker-skill-"));
  tempDirs.push(stateDir);
  const outboxPath = join(stateDir, "telegram-outbox.jsonl");
  const testIngressSecret = `test-secret-${busyDeliveryMode}-${busy ? "busy" : "idle"}`;
  const binding = {
    sessionKey: `broker-skill-${busyDeliveryMode}-${busy ? "busy" : "idle"}:memory`,
    sessionId: `broker-skill-${busyDeliveryMode}-${busy ? "busy" : "idle"}`,
    sessionLabel: `Broker Skill ${busyDeliveryMode} ${busy ? "busy" : "idle"}`,
    chatId: 123,
    userId: 456,
    boundAt: new Date(0).toISOString(),
    lastSeenAt: new Date(0).toISOString(),
    status: "active",
  };
  await writeFile(join(stateDir, "state.json"), JSON.stringify({
    setup: {
      botId: 1,
      botUsername: "dummy_bot",
      botDisplayName: "Dummy",
      validatedAt: new Date(0).toISOString(),
    },
    pendingPairings: {},
    bindings: { [binding.sessionKey]: binding },
    channelBindings: {},
  }));

  const socketPath = join(stateDir, "broker.sock");
  const brokerPath = fileURLToPath(new URL("../extensions/relay/broker/entry.js", import.meta.url));
  const child = spawn(process.execPath, [brokerPath], {
    env: {
      ...process.env,
      TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
      TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
        botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
        stateDir,
        pollingTimeoutSeconds: 1,
        busyDeliveryMode,
        skills,
      }),
      TELEGRAM_TUNNEL_BROKER_SKIP_POLLING: "1",
      PI_RELAY_BROKER_TEST_TELEGRAM_OUTBOX_PATH: outboxPath,
      PI_RELAY_BROKER_TEST_INGRESS_SECRET: testIngressSecret,
    },
  });
  children.push(child);
  await waitForSocket(socketPath, child);

  const deliveries: Record<string, unknown>[] = [];
  const counters = { skillMetadataRequests: 0 };
  const client = await openBrokerClient(socketPath, (payload) => {
    switch (payload.action) {
      case "getSkillCommands":
        counters.skillMetadataRequests += 1;
        return [{ name: "github", sourceInfo: { scope: "user" } }];
      case "deliverPrompt":
        deliveries.push(payload);
        return busy ? { deliverAs: payload.deliverAs } : {};
      case "appendAudit":
        return true;
      default:
        throw new Error(`Unexpected broker request: ${String(payload.action)}`);
    }
  });
  await client.request({
    type: "request",
    action: "registerRoute",
    clientId: "test-client",
    route: {
      sessionKey: binding.sessionKey,
      sessionId: binding.sessionId,
      sessionLabel: binding.sessionLabel,
      online: true,
      busy,
      notification: { lastStatus: busy ? "running" : "idle" },
      binding,
    },
  });
  return { binding, client, deliveries, outboxPath, testIngressSecret, counters };
}

function telegramMessage(text: string, binding: { chatId: number; userId: number }, updateId = 1) {
  return {
    updateId,
    messageId: updateId,
    text,
    chat: { id: binding.chatId, type: "private" },
    user: { id: binding.userId, username: "owner" },
  };
}

interface TestOutboxMessage {
  method: "sendMessage";
  chatId: number;
  text: string;
  options?: unknown;
}

interface TestOutboxDocument {
  method: "sendDocument";
  chatId: number;
  document: { fileName: string; text?: string; byteSize?: number; caption?: string };
  options?: unknown;
}

type TestOutboxEntry = TestOutboxMessage | TestOutboxDocument;

function parseOutbox(raw: string): TestOutboxEntry[] {
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as TestOutboxEntry);
}

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const handleKillError = (error: unknown) => {
      if (isAlreadyExitedError(error)) finish();
      else fail(error);
    };

    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (error) {
        handleKillError(error);
      }
    }, 1_000);
    timer.unref?.();
    child.once("exit", finish);
    if (child.exitCode !== null || child.signalCode) {
      finish();
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch (error) {
      handleKillError(error);
    }
  });
}

function isAlreadyExitedError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

function waitForSocket(socketPath: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    let settled = false;

    const cleanup = () => {
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(new Error(`Broker exited before opening socket (code=${code}, signal=${signal}).${stderr ? `\n${stderr}` : ""}`));
    };
    const onError = (error: Error) => {
      fail(new Error(`Broker failed before opening socket: ${error.message}.${stderr ? `\n${stderr}` : ""}`));
    };

    child.once("exit", onExit);
    child.once("error", onError);

    const tryConnect = () => {
      if (settled) return;
      if (Date.now() >= deadline) {
        fail(new Error(`Broker socket was not ready in time.${stderr ? `\n${stderr}` : ""}`));
        return;
      }
      const socket = net.createConnection(socketPath);
      socket.once("connect", () => {
        socket.end();
        succeed();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(tryConnect, 100).unref?.();
      });
    };

    tryConnect();
  });
}

function sendBrokerRequest(socketPath: string, payload: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) return;
      const line = buffer.slice(0, newlineIndex).trim();
      socket.end();
      const response = JSON.parse(line) as { ok?: boolean; result?: unknown; error?: string };
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error ?? "Broker request failed."));
    });
    socket.once("error", reject);
  });
}

async function openBrokerClient(socketPath: string, onBrokerRequest?: (payload: Record<string, unknown>) => unknown | Promise<unknown>): Promise<{ request(payload: Record<string, unknown>): Promise<unknown>; close(): void }> {
  const socket = net.createConnection(socketPath);
  socket.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  let buffer = "";
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        const response = JSON.parse(line) as { type?: string; requestId?: string; ok?: boolean; result?: unknown; error?: string } & Record<string, unknown>;
        const requestId = response.requestId;
        if (response.type === "request" && requestId && onBrokerRequest) {
          void Promise.resolve(onBrokerRequest(response))
            .then((result) => socket.write(`${JSON.stringify({ type: "response", requestId, ok: true, result })}\n`))
            .catch((error) => socket.write(`${JSON.stringify({ type: "response", requestId, ok: false, error: error instanceof Error ? error.message : String(error) })}\n`));
          continue;
        }
        const waiter = requestId ? pending.get(requestId) : undefined;
        if (waiter) {
          pending.delete(requestId!);
          if (response.ok) waiter.resolve(response.result);
          else waiter.reject(new Error(response.error ?? "Broker request failed."));
        }
      }
      newlineIndex = buffer.indexOf("\n");
    }
  });
  const rejectPending = (error: Error): void => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };
  socket.on("error", rejectPending);
  socket.on("close", () => {
    rejectPending(new Error("Broker client socket closed before pending requests completed."));
  });

  return {
    request(payload: Record<string, unknown>): Promise<unknown> {
      const requestId = typeof payload.requestId === "string" ? payload.requestId : `${Date.now()}-${Math.random()}`;
      const request = { ...payload, requestId };
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.write(`${JSON.stringify(request)}\n`);
      });
    },
    close() {
      socket.end();
    },
  };
}
