import type { ChannelAdapterKind } from "./channel-adapter.js";
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

export function statusSnapshotForRoute(route: SessionRoute, options: { online: boolean; busy: boolean }): SessionStatusSnapshot {
  const model = route.actions.getModel();
  return {
    sessionKey: route.sessionKey,
    sessionLabel: route.sessionLabel,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    online: options.online,
    busy: options.busy,
    modelId: formatModelId(model),
    lastActivityAt: route.lastActivityAt,
    binding: route.binding,
    notification: route.notification,
  };
}

export function relayRouteStateForRoute(route: SessionRoute, options: { channel: ChannelAdapterKind; busy: boolean }): RelayRouteState {
  const model = route.actions.getModel();
  return {
    channel: options.channel,
    sessionKey: route.sessionKey,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    sessionLabel: route.sessionLabel,
    binding: route.binding,
    busy: options.busy,
    modelId: formatModelId(model),
    imageInputSupported: Boolean(model?.input?.includes("image")),
    lastActivityAt: route.lastActivityAt,
    notification: route.notification,
  };
}
