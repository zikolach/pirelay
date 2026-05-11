import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";

export interface ClipboardCopyResult {
  ok: boolean;
  command?: string;
  error?: string;
}

interface ClipboardCommand {
  command: string;
  args: string[];
}

export function clipboardCommandCandidates(platform = process.platform, env: NodeJS.ProcessEnv = process.env): ClipboardCommand[] {
  if (env.PI_RELAY_CLIPBOARD_COMMAND) return [{ command: env.PI_RELAY_CLIPBOARD_COMMAND, args: [] }];
  if (platform === "darwin") return [{ command: "pbcopy", args: [] }];
  if (platform === "win32") return [{ command: "clip.exe", args: [] }];
  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
}

export async function copyTextToClipboard(text: string, options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<ClipboardCopyResult> {
  const candidates = clipboardCommandCandidates(options.platform, options.env);
  const errors: string[] = [];
  for (const candidate of candidates) {
    if (!await commandAvailable(candidate.command, options.env)) {
      errors.push(`${candidate.command}: unavailable`);
      continue;
    }
    const result = await runClipboardCommand(candidate, text, options.timeoutMs ?? 1_500, options.env);
    if (result.ok) return { ok: true, command: candidate.command };
    errors.push(`${candidate.command}: ${result.error ?? "failed"}`);
  }
  return { ok: false, error: errors.join("; ") || "no clipboard command available" };
}

async function commandAvailable(command: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (command.includes("/")) {
    try {
      await access(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  const pathValue = env.PATH ?? process.env.PATH ?? "";
  const platform = process.platform;
  const extensions = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathValue.split(platform === "win32" ? ";" : ":").filter(Boolean)) {
    for (const ext of extensions) {
      try {
        await access(`${dir}/${command}${ext}`, constants.X_OK);
        return true;
      } catch {
        // try next candidate
      }
    }
  }
  return false;
}

function runClipboardCommand(candidate: ClipboardCommand, text: string, timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<ClipboardCopyResult> {
  return new Promise((resolve) => {
    const child = spawn(candidate.command, candidate.args, { stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, ...env } });
    let stderr = "";
    let settled = false;
    const finish = (result: ClipboardCopyResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, error: "timed out" });
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish({ ok: false, error: error.message }));
    child.on("close", (code) => finish(code === 0 ? { ok: true } : { ok: false, error: stderr.trim() || `exit ${code ?? "unknown"}` }));
    child.stdin.end(text);
  });
}
