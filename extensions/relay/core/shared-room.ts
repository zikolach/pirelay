import type { ChannelInboundEvent } from "./channel-adapter.js";

export interface SharedRoomMachineIdentity {
  machineId: string;
  displayName?: string;
  aliases: string[];
}

export type SharedRoomMachineTarget =
  | { kind: "local"; selector: string; machine: SharedRoomMachineIdentity }
  | { kind: "remote"; selector: string; machineId?: string }
  | { kind: "ambiguous"; selector: string; matches: string[] }
  | { kind: "unknown"; selector: string };

export interface SharedRoomActiveSelectionInfo {
  sessionKey: string;
  machineId?: string;
  machineDisplayName?: string;
  selectedAt?: string;
}

export type SharedRoomAddressing =
  | { kind: "none" }
  | { kind: "local"; selector?: string }
  | { kind: "remote"; selector?: string; machineId?: string }
  | { kind: "ambiguous"; selector?: string; reason?: string };

export type SharedRoomEventClassification =
  | { kind: "explicit-local" }
  | { kind: "explicit-remote"; machineId?: string }
  | { kind: "explicit-ambiguous"; reason?: string }
  | { kind: "active-local"; sessionKey: string }
  | { kind: "active-remote"; sessionKey?: string; machineId?: string }
  | { kind: "no-target" };

export interface ParsedSharedRoomUseArgs {
  machineSelector: string;
  sessionSelector: string;
}

export interface ParsedSharedRoomToArgs {
  machineSelector: string;
  sessionAndPrompt: string;
}

export interface ParsedSharedRoomSessionsArgs {
  kind: "all" | "machine" | "local";
  machineSelector?: string;
}

const allMachineSelectors = new Set(["all", "*"]);
const localMachineSelectors = new Set(["local", "this", "me"]);

export function normalizeMachineSelector(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "").replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function sharedRoomMachineIdentity(input: { machineId: string; displayName?: string; aliases?: readonly string[] }): SharedRoomMachineIdentity {
  return {
    machineId: input.machineId,
    displayName: input.displayName,
    aliases: [...new Set((input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean))],
  };
}

export function machineSelectorAliases(machine: SharedRoomMachineIdentity): string[] {
  return [...new Set([
    machine.machineId,
    machine.displayName,
    ...machine.aliases,
  ].filter((value): value is string => Boolean(value?.trim())).map(normalizeMachineSelector).filter(Boolean))];
}

export function selectorMatchesMachine(selector: string, machine: SharedRoomMachineIdentity): boolean {
  const normalized = normalizeMachineSelector(selector);
  if (!normalized) return false;
  return machineSelectorAliases(machine).some((alias) => alias === normalized || alias.startsWith(normalized));
}

export function resolveSharedRoomMachineTarget(input: {
  selector: string;
  localMachine: SharedRoomMachineIdentity;
  knownRemoteMachines?: readonly SharedRoomMachineIdentity[];
}): SharedRoomMachineTarget {
  const selector = input.selector.trim();
  const normalized = normalizeMachineSelector(selector);
  if (!normalized) return { kind: "unknown", selector };
  const localMatches = selectorMatchesMachine(normalized, input.localMachine);
  const remoteMatches = (input.knownRemoteMachines ?? []).filter((machine) => selectorMatchesMachine(normalized, machine));
  const matches = [localMatches ? input.localMachine.machineId : undefined, ...remoteMatches.map((machine) => machine.machineId)].filter((value): value is string => Boolean(value));
  if (matches.length > 1) return { kind: "ambiguous", selector, matches };
  if (localMatches) return { kind: "local", selector, machine: input.localMachine };
  const remote = remoteMatches[0];
  if (remote) return { kind: "remote", selector, machineId: remote.machineId };
  return { kind: "unknown", selector };
}

export function parseSharedRoomUseArgs(args: string): ParsedSharedRoomUseArgs | undefined {
  const parsed = splitFirstToken(args);
  if (!parsed || !parsed.rest) return undefined;
  return { machineSelector: parsed.first, sessionSelector: parsed.rest };
}

export function parseSharedRoomToArgs(args: string): ParsedSharedRoomToArgs | undefined {
  const parsed = splitFirstToken(args);
  if (!parsed || !parsed.rest) return undefined;
  return { machineSelector: parsed.first, sessionAndPrompt: parsed.rest };
}

export function parseSharedRoomSessionsArgs(args: string): ParsedSharedRoomSessionsArgs {
  const selector = args.trim();
  if (!selector) return { kind: "local" };
  if (allMachineSelectors.has(selector.toLowerCase())) return { kind: "all" };
  const normalized = normalizeMachineSelector(selector);
  if (allMachineSelectors.has(normalized)) return { kind: "all" };
  if (localMachineSelectors.has(normalized)) return { kind: "local" };
  return { kind: "machine", machineSelector: selector };
}

export function classifySharedRoomEvent(input: {
  explicitAddressing?: SharedRoomAddressing;
  activeSelection?: SharedRoomActiveSelectionInfo;
  localMachine: SharedRoomMachineIdentity;
}): SharedRoomEventClassification {
  const explicit = input.explicitAddressing ?? { kind: "none" as const };
  if (explicit.kind === "local") return { kind: "explicit-local" };
  if (explicit.kind === "remote") return { kind: "explicit-remote", machineId: explicit.machineId };
  if (explicit.kind === "ambiguous") return { kind: "explicit-ambiguous", reason: explicit.reason };

  const active = input.activeSelection;
  if (!active) return { kind: "no-target" };
  if (!active.machineId || active.machineId === input.localMachine.machineId) return { kind: "active-local", sessionKey: active.sessionKey };
  return { kind: "active-remote", sessionKey: active.sessionKey, machineId: active.machineId };
}

export function sharedRoomAddressingFromEvent(event: ChannelInboundEvent): SharedRoomAddressing | undefined {
  const raw = event.metadata?.sharedRoomAddressing;
  if (isSharedRoomAddressing(raw)) return raw;
  return undefined;
}

export function withSharedRoomAddressing<T extends ChannelInboundEvent>(event: T, addressing: SharedRoomAddressing): T {
  return { ...event, metadata: { ...event.metadata, sharedRoomAddressing: addressing } };
}

function splitFirstToken(args: string): { first: string; rest: string } | undefined {
  const trimmed = args.trim();
  if (!trimmed) return undefined;
  const [first = "", ...rest] = trimmed.split(/\s+/);
  if (!first) return undefined;
  return { first, rest: rest.join(" ").trim() };
}

function isSharedRoomAddressing(value: unknown): value is SharedRoomAddressing {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "none" || candidate.kind === "local") return true;
  if (candidate.kind === "remote") return candidate.machineId === undefined || typeof candidate.machineId === "string";
  if (candidate.kind === "ambiguous") return candidate.reason === undefined || typeof candidate.reason === "string";
  return false;
}
