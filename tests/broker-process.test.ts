import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

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
});

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
