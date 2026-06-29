import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";

export interface LocalBrokerControlPaths {
  stateDir: string;
  namespace?: string;
  socketPath: string;
  pidPath: string;
  lockPath: string;
}

export interface LocalBrokerStartResult {
  pid: number;
}

export interface EnsureLocalBrokerOptions {
  stateDir: string;
  namespace?: string;
  startBroker: () => Promise<LocalBrokerStartResult>;
  isAlive?: (pid: number) => boolean;
}

export interface BrokerScopeOptions {
  stateDir: string;
  tokenHash: string;
  namespace?: string;
}

export interface EnsureScopedBrokerOptions extends BrokerScopeOptions {
  startBroker: (paths: LocalBrokerControlPaths) => Promise<LocalBrokerStartResult>;
  probeSocket: (paths: LocalBrokerControlPaths) => Promise<boolean>;
  waitForSocketReady: (paths: LocalBrokerControlPaths) => Promise<void>;
  isAlive?: (pid: number) => boolean;
}

export type EnsureLocalBrokerResult =
  | { status: "existing"; paths: LocalBrokerControlPaths; pid: number }
  | { status: "started"; paths: LocalBrokerControlPaths; pid: number };

export function normalizeBrokerNamespace(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return normalized || undefined;
}

function controlPathsForBasename(stateDir: string, basename: string, namespace?: string): LocalBrokerControlPaths {
  return {
    stateDir,
    namespace,
    socketPath: join(stateDir, `${basename}.sock`),
    pidPath: join(stateDir, `${basename}.pid`),
    lockPath: join(stateDir, `${basename}.lock`),
  };
}

export function brokerControlPaths(stateDir: string, namespace?: string): LocalBrokerControlPaths {
  const normalizedNamespace = normalizeBrokerNamespace(namespace);
  const basename = normalizedNamespace ? `relay-broker-${normalizedNamespace}` : "relay-broker";
  return controlPathsForBasename(stateDir, basename, normalizedNamespace);
}

export function brokerScopeControlPaths(options: BrokerScopeOptions): LocalBrokerControlPaths {
  const normalizedNamespace = normalizeBrokerNamespace(options.namespace);
  const safeTokenHash = options.tokenHash.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 80);
  const basename = normalizedNamespace ? `broker-${normalizedNamespace}-${safeTokenHash}` : `broker-${safeTokenHash}`;
  return controlPathsForBasename(options.stateDir, basename, normalizedNamespace);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function readBrokerPid(pidPath: string): Promise<number | undefined> {
  try {
    await access(pidPath, constants.R_OK);
  } catch {
    return undefined;
  }
  const raw = (await readFile(pidPath, "utf8")).trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export async function cleanupStaleBrokerControlFiles(paths: LocalBrokerControlPaths, isAlive: (pid: number) => boolean = isProcessAlive): Promise<boolean> {
  const pid = await readBrokerPid(paths.pidPath);
  if (pid && isAlive(pid)) return false;
  await Promise.all([
    rm(paths.pidPath, { force: true }),
    rm(paths.socketPath, { force: true }),
    rm(paths.lockPath, { force: true }),
  ]);
  return true;
}

export async function ensureLocalBroker(options: EnsureLocalBrokerOptions): Promise<EnsureLocalBrokerResult> {
  const paths = brokerControlPaths(options.stateDir, options.namespace);
  const isAlive = options.isAlive ?? isProcessAlive;
  await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
  const existingPid = await readBrokerPid(paths.pidPath);
  if (existingPid && isAlive(existingPid)) return { status: "existing", paths, pid: existingPid };
  await cleanupStaleBrokerControlFiles(paths, isAlive);
  const started = await options.startBroker();
  await writeFile(paths.pidPath, `${started.pid}\n`, { mode: 0o600 });
  return { status: "started", paths, pid: started.pid };
}

export async function ensureScopedBroker(options: EnsureScopedBrokerOptions): Promise<EnsureLocalBrokerResult> {
  const paths = brokerScopeControlPaths(options);
  const isAlive = options.isAlive ?? isProcessAlive;
  await mkdir(options.stateDir, { recursive: true, mode: 0o700 });

  if (await options.probeSocket(paths)) {
    const pid = await readBrokerPid(paths.pidPath);
    return { status: "existing", paths, pid: pid ?? 0 };
  }

  await writeFile(paths.lockPath, "", { flag: "a", mode: 0o600 });
  const release = await lockfile.lock(paths.lockPath, {
    realpath: false,
    stale: 60_000,
    retries: { retries: 50, minTimeout: 20, maxTimeout: 200 },
  });
  try {
    if (await options.probeSocket(paths)) {
      const pid = await readBrokerPid(paths.pidPath);
      return { status: "existing", paths, pid: pid ?? 0 };
    }

    const existingPid = await readBrokerPid(paths.pidPath);
    if (existingPid && isAlive(existingPid)) {
      await options.waitForSocketReady(paths);
      if (!await options.probeSocket(paths)) throw new Error("PiRelay broker socket did not become ready for the live broker process.");
      return { status: "existing", paths, pid: existingPid };
    }

    await Promise.all([
      rm(paths.pidPath, { force: true }),
      rm(paths.socketPath, { force: true }),
    ]);
    const started = await options.startBroker(paths);
    await writeFile(paths.pidPath, `${started.pid}\n`, { mode: 0o600 });
    await options.waitForSocketReady(paths);
    return { status: "started", paths, pid: started.pid };
  } finally {
    await release();
  }
}
