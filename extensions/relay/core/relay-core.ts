import type { ChannelAdapterKind } from "./channel-adapter.js";
import { probeRouteAvailability } from "./route-actions.js";
import type { SessionRoute, SessionStatusSnapshot } from "./types.js";
import { formatModelId } from "./utils.js";

export interface RelayRouteState {
  channel: ChannelAdapterKind;
  sessionKey: string;
  sessionId: string;
  sessionFile?: string;
  sessionLabel: string;
  binding?: SessionRoute["binding"];
  busy: boolean;
  modelId?: string;
  imageInputSupported?: boolean;
  lastActivityAt?: number;
  notification: SessionRoute["notification"];
}

export function statusSnapshotForRoute(route: SessionRoute, options: { online: boolean; busy?: boolean }): SessionStatusSnapshot {
  const probe = probeRouteAvailability(route, { includeModel: true });
  const online = options.online && probe.kind === "available";
  const model = probe.kind === "available" ? probe.model : undefined;
  return {
    sessionKey: route.sessionKey,
    sessionLabel: route.sessionLabel,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    online,
    busy: online ? options.busy ?? probe.busy : false,
    modelId: online ? formatModelId(model) : undefined,
    lastActivityAt: route.lastActivityAt,
    binding: route.binding,
    notification: route.notification,
  };
}

export function relayRouteStateForRoute(route: SessionRoute, options: { channel: ChannelAdapterKind; busy?: boolean }): RelayRouteState {
  const probe = probeRouteAvailability(route, { includeModel: true });
  const available = probe.kind === "available";
  const model = available ? probe.model : undefined;
  return {
    channel: options.channel,
    sessionKey: route.sessionKey,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    sessionLabel: route.sessionLabel,
    binding: route.binding,
    busy: available ? options.busy ?? probe.busy : false,
    modelId: available ? formatModelId(model) : undefined,
    imageInputSupported: available ? Boolean(model?.input?.includes("image")) : false,
    lastActivityAt: route.lastActivityAt,
    notification: route.notification,
  };
}
