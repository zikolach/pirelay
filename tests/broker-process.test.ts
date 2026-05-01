import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    const brokerPath = fileURLToPath(new URL("../extensions/telegram-tunnel/broker.js", import.meta.url));
    const child = spawn(process.execPath, [brokerPath], {
      env: {
        ...process.env,
        TELEGRAM_TUNNEL_BROKER_SOCKET_PATH: socketPath,
        TELEGRAM_TUNNEL_BROKER_CONFIG_JSON: JSON.stringify({
          botToken: "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456",
          stateDir,
          pollingTimeoutSeconds: 0.001,
        }),
      },
    });
    children.push(child);

    await expect(waitForSocket(socketPath, child)).resolves.toBeUndefined();
  });
});

function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 1_000);
    timer.unref?.();
    child.once("exit", finish);
    child.kill("SIGTERM");
  });
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
