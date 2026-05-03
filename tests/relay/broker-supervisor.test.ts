import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { brokerControlPaths, cleanupStaleBrokerControlFiles, ensureLocalBroker, readBrokerPid } from "../../extensions/relay/broker/index.js";

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
});
