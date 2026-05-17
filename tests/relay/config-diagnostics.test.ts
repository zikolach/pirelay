import { describe, expect, it } from "vitest";
import { collectRelayDiagnostics, renderRelayDiagnostics } from "../../extensions/relay/config/index.js";
import type { ResolvedRelayConfig } from "../../extensions/relay/config/index.js";

function baseConfig(): ResolvedRelayConfig {
  return {
    configPath: "/tmp/config.json",
    relay: { machineId: "laptop", stateDir: "/tmp/state", aliases: [], brokerGroup: "personal", brokerPeers: [] },
    defaults: {
      pairingExpiryMs: 300000,
      busyDeliveryMode: "followUp",
      maxTextChars: 3900,
      maxInboundImageBytes: 1,
      maxOutboundImageBytes: 1,
      allowedImageMimeTypes: ["image/png"],
    },
    warnings: [],
    messengers: [],
  };
}

describe("relay diagnostics", () => {
  it("reports ownership, missing credentials, and unsupported messengers", () => {
    const config = baseConfig();
    config.messengers = [
      {
        ref: { kind: "telegram", instanceId: "default" },
        enabled: true,
        displayName: "telegram",
        token: "telegram-token",
        allowUserIds: [],
        allowGuildIds: [],
        sharedRoom: {},
        ingressPolicy: { kind: "owner", machineId: "laptop" },
        limits: { maxTextChars: 3900, maxFileBytes: 1, allowedImageMimeTypes: ["image/png"] },
        unsupported: false,
      },
      {
        ref: { kind: "discord", instanceId: "default" },
        enabled: true,
        displayName: "discord",
        allowUserIds: [],
        allowGuildIds: [],
        sharedRoom: {},
        ingressPolicy: { kind: "auto" },
        limits: { maxTextChars: 2000, maxFileBytes: 1, allowedImageMimeTypes: ["image/png"] },
        unsupported: false,
      },
      {
        ref: { kind: "matrix", instanceId: "default" },
        enabled: true,
        displayName: "matrix",
        token: "matrix-token",
        allowUserIds: [],
        allowGuildIds: [],
        sharedRoom: {},
        ingressPolicy: { kind: "auto" },
        limits: { maxTextChars: 2000, maxFileBytes: 1, allowedImageMimeTypes: ["image/png"] },
        unsupported: true,
      },
    ];

    const diagnostics = collectRelayDiagnostics(config);
    expect(diagnostics.some((item) => item.level === "ok" && item.message.includes("telegram: ingress owner"))).toBe(true);
    expect(diagnostics.some((item) => item.level === "error" && item.message.includes("discord: enabled but missing bot token"))).toBe(true);
    expect(diagnostics.some((item) => item.level === "warning" && item.message.includes("matrix: configured but adapter is not installed"))).toBe(true);
  });

  it("reports shared-room machine identity and platform caveats", () => {
    const config = baseConfig();
    config.relay.displayName = "Laptop";
    config.relay.aliases = ["lap"];
    config.messengers = [{
      ref: { kind: "telegram", instanceId: "default" },
      enabled: true,
      displayName: "telegram",
      token: "telegram-token",
      allowUserIds: [],
      allowGuildIds: [],
      sharedRoom: { enabled: true },
      ingressPolicy: { kind: "owner", machineId: "laptop" },
      limits: { maxTextChars: 3900, maxFileBytes: 1, allowedImageMimeTypes: ["image/png"] },
      unsupported: false,
    }];

    const rendered = renderRelayDiagnostics(config);
    expect(rendered).toContain("Machine: laptop (Laptop)");
    expect(rendered).toContain("Machine aliases: lap");
    expect(rendered).toContain("shared-room machine bot identity Laptop");
    expect(rendered).toContain("Telegram shared-room plain text requires");
    expect(rendered).not.toContain("telegram-token");
  });

  it("reports duplicate bot fingerprints without printing token values", () => {
    const config = baseConfig();
    config.messengers = ["personal", "work"].map((instanceId) => ({
      ref: { kind: "telegram", instanceId },
      enabled: true,
      displayName: instanceId,
      token: "same-token",
      allowUserIds: [],
      allowGuildIds: [],
      sharedRoom: {},
      ingressPolicy: { kind: "auto" as const },
      limits: { maxTextChars: 3900, maxFileBytes: 1, allowedImageMimeTypes: ["image/png"] },
      unsupported: false,
    }));

    const rendered = renderRelayDiagnostics(config);
    expect(rendered).toContain("Duplicate bot/account fingerprint");
    expect(rendered).not.toContain("same-token");
  });

  it("reports delegation readiness and unsafe settings without printing secrets", () => {
    const config = baseConfig();
    config.messengers = [{
      ref: { kind: "discord", instanceId: "default" },
      enabled: true,
      displayName: "discord",
      token: "discord-token",
      applicationId: "app-1",
      allowUserIds: [],
      allowGuildIds: [],
      sharedRoom: { enabled: true },
      delegation: {
        enabled: true,
        autonomy: "auto-claim-targeted",
        trustedPeers: [{ peerId: "bot-a", displayName: "Bot A", allowCreate: true }],
        localCapabilities: ["linux-tests"],
        taskExpiryMs: 60000,
        runningTimeoutMs: 60000,
        maxDepth: 1,
        maxVisibleSummaryChars: 320,
        maxHistory: 20,
        requireHumanApproval: false,
      },
      ingressPolicy: { kind: "owner", machineId: "laptop" },
      limits: { maxTextChars: 3900, maxFileBytes: 1, allowedImageMimeTypes: ["image/png"] },
      unsupported: false,
    }];

    const rendered = renderRelayDiagnostics(config);
    expect(rendered).toContain("discord: delegation auto-claim-targeted; trusted peers: 1; capabilities: linux-tests");
    expect(rendered).toContain("delegation can auto-claim");
    expect(rendered).not.toContain("discord-token");
  });
});
