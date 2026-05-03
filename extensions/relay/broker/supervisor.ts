import { constants } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface LocalBrokerControlPaths {
  stateDir: string;
  socketPath: string;
  pidPath: string;
}

export interface LocalBrokerStartResult {
  pid: number;
}

export interface EnsureLocalBrokerOptions {
  stateDir: string;
  startBroker: () => Promise<LocalBrokerStartResult>;
  isAlive?: (pid: number) => boolean;
}

export type EnsureLocalBrokerResult =
  | { status: "existing"; paths: LocalBrokerControlPaths; pid: number }
  | { status: "started"; paths: LocalBrokerControlPaths; pid: number };

export function brokerControlPaths(stateDir: string): LocalBrokerControlPaths {
  return {
    stateDir,
    socketPath: join(stateDir, "relay-broker.sock"),
    pidPath: join(stateDir, "relay-broker.pid"),
  };
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
  ]);
  return true;
}

export async function ensureLocalBroker(options: EnsureLocalBrokerOptions): Promise<EnsureLocalBrokerResult> {
  const paths = brokerControlPaths(options.stateDir);
  const isAlive = options.isAlive ?? isProcessAlive;
  await mkdir(options.stateDir, { recursive: true, mode: 0o700 });
  const existingPid = await readBrokerPid(paths.pidPath);
  if (existingPid && isAlive(existingPid)) return { status: "existing", paths, pid: existingPid };
  await cleanupStaleBrokerControlFiles(paths, isAlive);
  const started = await options.startBroker();
  await writeFile(paths.pidPath, `${started.pid}\n`, { mode: 0o600 });
  return { status: "started", paths, pid: started.pid };
}
