import type { ChannelAdapterKind } from "./channel-adapter.js";
import { routeIdleState, routeModelState } from "./route-actions.js";
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
  const modelState = routeModelState(route);
  const idle = modelState.available && options.busy === undefined ? routeIdleState(route) : undefined;
  const online = modelState.available && !(options.busy === undefined && idle === undefined) ? options.online : false;
  return {
    sessionKey: route.sessionKey,
    sessionLabel: route.sessionLabel,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    online,
    busy: online ? options.busy ?? (idle === false) : false,
    modelId: modelState.available ? formatModelId(modelState.model) : undefined,
    lastActivityAt: route.lastActivityAt,
    binding: route.binding,
    notification: route.notification,
  };
}

export function relayRouteStateForRoute(route: SessionRoute, options: { channel: ChannelAdapterKind; busy?: boolean }): RelayRouteState {
  const modelState = routeModelState(route);
  const idle = modelState.available && options.busy === undefined ? routeIdleState(route) : undefined;
  const available = modelState.available && !(options.busy === undefined && idle === undefined);
  const model = modelState.available ? modelState.model : undefined;
  return {
    channel: options.channel,
    sessionKey: route.sessionKey,
    sessionId: route.sessionId,
    sessionFile: route.sessionFile,
    sessionLabel: route.sessionLabel,
    binding: route.binding,
    busy: available ? options.busy ?? (idle === false) : false,
    modelId: available ? formatModelId(model) : undefined,
    imageInputSupported: available ? Boolean(model?.input?.includes("image")) : false,
    lastActivityAt: route.lastActivityAt,
    notification: route.notification,
  };
}
