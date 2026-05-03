import { describe, expect, it } from "vitest";
import { botTokenFingerprint, findDuplicateBotInstances, resolveMessengerIngressOwnership } from "../../extensions/relay/broker/index.js";

const telegram = { kind: "telegram", instanceId: "default" };

describe("messenger ingress ownership", () => {
  it("uses a stable secret-safe bot fingerprint", () => {
    expect(botTokenFingerprint("telegram", "token-a")).toBe(botTokenFingerprint("telegram", "token-a"));
    expect(botTokenFingerprint("telegram", "token-a")).not.toContain("token-a");
  });

  it("treats the configured owner machine as ingress owner", () => {
    expect(resolveMessengerIngressOwnership({
      messenger: telegram,
      localMachineId: "laptop",
      token: "token-a",
      policy: { kind: "owner", machineId: "laptop" },
    })).toMatchObject({ kind: "owner", ownerMachineId: "laptop" });
  });

  it("keeps non-owner machines from starting ingress", () => {
    expect(resolveMessengerIngressOwnership({
      messenger: telegram,
      localMachineId: "cloud",
      token: "token-a",
      policy: { kind: "owner", machineId: "laptop" },
    })).toMatchObject({ kind: "non-owner", ownerMachineId: "laptop" });
  });

  it("blocks ambiguous auto ownership inside a broker group", () => {
    expect(resolveMessengerIngressOwnership({
      messenger: telegram,
      localMachineId: "cloud",
      token: "token-a",
      policy: { kind: "auto" },
      brokerGroup: "personal",
    })).toMatchObject({ kind: "ambiguous" });
  });

  it("detects duplicate bot instances by fingerprint without exposing tokens", () => {
    const duplicates = findDuplicateBotInstances([
      { ref: { kind: "telegram", instanceId: "personal" }, token: "same-token" },
      { ref: { kind: "telegram", instanceId: "work" }, token: "same-token" },
      { ref: { kind: "discord", instanceId: "default" }, token: "other-token" },
    ]);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.refs.map((ref) => ref.instanceId).sort()).toEqual(["personal", "work"]);
    expect(duplicates[0]?.fingerprint).not.toContain("same-token");
  });
});
