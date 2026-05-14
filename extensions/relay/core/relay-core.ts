import type { ChannelAdapterKind } from "./channel-adapter.js";
import { routeIdleState } from "./route-actions.js";
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
  const model = route.actions.getModel();
  const idle = options.busy === undefined ? routeIdleState(route) : undefined;
  const online = options.busy === undefined && idle === undefined ? false : options.online;
  return {
    sessionKey: route.sessionKey,
    sessionLabel: route.sessionLabel,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    online,
    busy: options.busy ?? (idle === false),
    modelId: formatModelId(model),
    lastActivityAt: route.lastActivityAt,
    binding: route.binding,
    notification: route.notification,
  };
}

export function relayRouteStateForRoute(route: SessionRoute, options: { channel: ChannelAdapterKind; busy?: boolean }): RelayRouteState {
  const model = route.actions.getModel();
  const idle = options.busy === undefined ? routeIdleState(route) : undefined;
  return {
    channel: options.channel,
    sessionKey: route.sessionKey,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    sessionLabel: route.sessionLabel,
    binding: route.binding,
    busy: options.busy ?? (idle === false),
    modelId: formatModelId(model),
    imageInputSupported: Boolean(model?.input?.includes("image")),
    lastActivityAt: route.lastActivityAt,
    notification: route.notification,
  };
}
