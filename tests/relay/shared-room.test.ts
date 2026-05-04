import { describe, expect, it } from "vitest";
import {
  classifySharedRoomEvent,
  machineSelectorAliases,
  normalizeMachineSelector,
  parseSharedRoomSessionsArgs,
  parseSharedRoomToArgs,
  parseSharedRoomUseArgs,
  resolveSharedRoomMachineTarget,
  sharedRoomMachineIdentity,
} from "../../extensions/relay/core/shared-room.js";

const local = sharedRoomMachineIdentity({ machineId: "laptop-1", displayName: "Laptop", aliases: ["lap", "dev box"] });
const desktop = sharedRoomMachineIdentity({ machineId: "desktop", displayName: "Desktop", aliases: ["desk"] });

describe("shared-room helpers", () => {
  it("normalizes machine selector aliases", () => {
    expect(normalizeMachineSelector("@Dev Box!")).toBe("dev-box");
    expect(machineSelectorAliases(local)).toEqual(["laptop-1", "laptop", "lap", "dev-box"]);
  });

  it("resolves local, remote, unknown, and ambiguous machine targets", () => {
    expect(resolveSharedRoomMachineTarget({ selector: "lap", localMachine: local, knownRemoteMachines: [desktop] })).toMatchObject({ kind: "local" });
    expect(resolveSharedRoomMachineTarget({ selector: "desk", localMachine: local, knownRemoteMachines: [desktop] })).toMatchObject({ kind: "remote", machineId: "desktop" });
    expect(resolveSharedRoomMachineTarget({ selector: "server", localMachine: local, knownRemoteMachines: [desktop] })).toMatchObject({ kind: "unknown" });
    expect(resolveSharedRoomMachineTarget({ selector: "d", localMachine: local, knownRemoteMachines: [desktop] })).toMatchObject({ kind: "ambiguous", matches: ["laptop-1", "desktop"] });
  });

  it("parses machine-aware command arguments", () => {
    expect(parseSharedRoomUseArgs("laptop docs session")).toEqual({ machineSelector: "laptop", sessionSelector: "docs session" });
    expect(parseSharedRoomUseArgs("laptop")).toBeUndefined();
    expect(parseSharedRoomToArgs("desktop api run tests")).toEqual({ machineSelector: "desktop", sessionAndPrompt: "api run tests" });
    expect(parseSharedRoomSessionsArgs("all")).toEqual({ kind: "all" });
    expect(parseSharedRoomSessionsArgs("desktop")).toEqual({ kind: "machine", machineSelector: "desktop" });
    expect(parseSharedRoomSessionsArgs("")).toEqual({ kind: "local" });
  });

  it("classifies explicit and active shared-room routing", () => {
    expect(classifySharedRoomEvent({ localMachine: local, explicitAddressing: { kind: "local" } })).toEqual({ kind: "explicit-local" });
    expect(classifySharedRoomEvent({ localMachine: local, explicitAddressing: { kind: "remote", machineId: "desktop" } })).toEqual({ kind: "explicit-remote", machineId: "desktop" });
    expect(classifySharedRoomEvent({ localMachine: local, explicitAddressing: { kind: "ambiguous", reason: "d" } })).toEqual({ kind: "explicit-ambiguous", reason: "d" });
    expect(classifySharedRoomEvent({ localMachine: local, activeSelection: { machineId: "laptop-1", sessionKey: "s1" } })).toEqual({ kind: "active-local", sessionKey: "s1" });
    expect(classifySharedRoomEvent({ localMachine: local, activeSelection: { machineId: "desktop", sessionKey: "s2" } })).toEqual({ kind: "active-remote", machineId: "desktop", sessionKey: "s2" });
    expect(classifySharedRoomEvent({ localMachine: local })).toEqual({ kind: "no-target" });
  });
});
