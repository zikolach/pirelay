import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { brokerControlPaths, brokerScopeControlPaths, cleanupStaleBrokerControlFiles, ensureLocalBroker, ensureScopedBroker, normalizeBrokerNamespace, readBrokerPid } from "../../extensions/relay/broker/index.js";

describe("local broker supervisor", () => {
  it("starts a broker when no live pid exists", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    let starts = 0;
    const result = await ensureLocalBroker({
      stateDir,
      isAlive: () => false,
      startBroker: async () => {
        starts += 1;
        return { pid: 4242 };
      },
    });

    expect(result).toMatchObject({ status: "started", pid: 4242 });
    expect(starts).toBe(1);
    expect(await readBrokerPid(brokerControlPaths(stateDir).pidPath)).toBe(4242);
  });

  it("reuses an existing live broker pid", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    const paths = brokerControlPaths(stateDir);
    await writeFile(paths.pidPath, "1111\n", { mode: 0o600 });
    let starts = 0;

    const result = await ensureLocalBroker({
      stateDir,
      isAlive: (pid) => pid === 1111,
      startBroker: async () => {
        starts += 1;
        return { pid: 2222 };
      },
    });

    expect(result).toMatchObject({ status: "existing", pid: 1111 });
    expect(starts).toBe(0);
  });

  it("removes stale pid and socket files", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    const paths = brokerControlPaths(stateDir);
    await writeFile(paths.pidPath, "9999\n", { mode: 0o600 });
    await writeFile(paths.socketPath, "stale", { mode: 0o600 });

    expect(await cleanupStaleBrokerControlFiles(paths, () => false)).toBe(true);
    await expect(readFile(paths.pidPath, "utf8")).rejects.toThrow();
    await expect(readFile(paths.socketPath, "utf8")).rejects.toThrow();
  });

  it("scopes broker control paths by optional namespace", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));

    expect(brokerControlPaths(stateDir)).toMatchObject({
      socketPath: join(stateDir, "relay-broker.sock"),
      pidPath: join(stateDir, "relay-broker.pid"),
      lockPath: join(stateDir, "relay-broker.lock"),
    });
    expect(brokerControlPaths(stateDir, "Slack Live A")).toMatchObject({
      namespace: "Slack-Live-A",
      socketPath: join(stateDir, "relay-broker-Slack-Live-A.sock"),
      pidPath: join(stateDir, "relay-broker-Slack-Live-A.pid"),
      lockPath: join(stateDir, "relay-broker-Slack-Live-A.lock"),
    });
    expect(normalizeBrokerNamespace(" ../../secret ")).toBe("..-..-secret");
  });

  it("serializes scoped startup so concurrent clients spawn one broker", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    let socketReady = false;
    let starts = 0;
    const options = {
      stateDir,
      tokenHash: "abc123",
      startBroker: async () => {
        starts += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        socketReady = true;
        return { pid: 4444 };
      },
      probeSocket: async () => socketReady,
      waitForSocketReady: async () => {
        socketReady = true;
      },
      isAlive: (pid: number) => pid === 4444,
    };

    await Promise.all([
      ensureScopedBroker(options),
      ensureScopedBroker(options),
    ]);

    const paths = brokerScopeControlPaths({ stateDir, tokenHash: "abc123" });
    expect(starts).toBe(1);
    expect(await readBrokerPid(paths.pidPath)).toBe(4444);
    await expect(stat(`${paths.lockPath}.lock`)).rejects.toThrow();
  });

  it("does not return pid zero when a socket is ready before its pid file", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    let starts = 0;
    const result = await ensureScopedBroker({
      stateDir,
      tokenHash: "abc123",
      startBroker: async () => {
        starts += 1;
        return { pid: 7777 };
      },
      probeSocket: async () => true,
      waitForSocketReady: async () => undefined,
      isAlive: () => false,
    });

    expect(result).toMatchObject({ status: "started", pid: 7777 });
    expect(starts).toBe(1);
  });

  it("reuses a socket-ready scoped broker only when its pid file is available", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    const paths = brokerScopeControlPaths({ stateDir, tokenHash: "abc123" });
    await writeFile(paths.pidPath, "8888\n", { mode: 0o600 });
    let starts = 0;
    const result = await ensureScopedBroker({
      stateDir,
      tokenHash: "abc123",
      startBroker: async () => {
        starts += 1;
        return { pid: 9999 };
      },
      probeSocket: async () => true,
      waitForSocketReady: async () => undefined,
      isAlive: () => true,
    });

    expect(result).toMatchObject({ status: "existing", pid: 8888 });
    expect(starts).toBe(0);
  });

  it("waits for a live scoped broker pid instead of spawning a competitor", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    const paths = brokerScopeControlPaths({ stateDir, tokenHash: "abc123" });
    await writeFile(paths.pidPath, "5555\n", { mode: 0o600 });
    let socketReady = false;
    let starts = 0;
    const result = await ensureScopedBroker({
      stateDir,
      tokenHash: "abc123",
      startBroker: async () => {
        starts += 1;
        return { pid: 6666 };
      },
      probeSocket: async () => socketReady,
      waitForSocketReady: async () => {
        socketReady = true;
      },
      isAlive: (pid) => pid === 5555,
    });

    expect(result).toMatchObject({ status: "existing", pid: 5555 });
    expect(starts).toBe(0);
  });

  it("reuses and cleans up only the selected namespace", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "pirelay-supervisor-"));
    const alpha = brokerControlPaths(stateDir, "alpha");
    const beta = brokerControlPaths(stateDir, "beta");
    await writeFile(alpha.pidPath, "1111\n", { mode: 0o600 });
    await writeFile(beta.pidPath, "2222\n", { mode: 0o600 });
    await writeFile(beta.socketPath, "stale", { mode: 0o600 });

    const result = await ensureLocalBroker({
      stateDir,
      namespace: "beta",
      isAlive: (pid) => pid === 1111,
      startBroker: async () => ({ pid: 3333 }),
    });

    expect(result).toMatchObject({ status: "started", pid: 3333, paths: { namespace: "beta" } });
    expect(await readBrokerPid(alpha.pidPath)).toBe(1111);
    expect(await readBrokerPid(beta.pidPath)).toBe(3333);
  });
});
