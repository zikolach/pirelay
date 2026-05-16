import type { TelegramBindingMetadata } from "../core/types.js";

export interface BrokerTelegramRouteBindingState {
  bindings?: Record<string, (TelegramBindingMetadata & { status?: string; revokedAt?: string }) | undefined>;
}

export interface BrokerTelegramRouteLike {
  sessionKey: string;
  binding?: TelegramBindingMetadata;
}

export function persistedTelegramBindingForRoute(route: Pick<BrokerTelegramRouteLike, "sessionKey">, state: BrokerTelegramRouteBindingState): TelegramBindingMetadata | undefined {
  const binding = state.bindings?.[route.sessionKey];
  if (!binding || binding.status === "revoked" || binding.revokedAt) return undefined;
  return binding;
}

export type BrokerTelegramRouteWithOptionalBinding<T extends Pick<BrokerTelegramRouteLike, "sessionKey">> = T & { binding?: TelegramBindingMetadata };

export function routeWithPersistedTelegramBinding<T extends BrokerTelegramRouteLike & { binding: TelegramBindingMetadata }>(route: T, state: BrokerTelegramRouteBindingState): T;
export function routeWithPersistedTelegramBinding<T extends Pick<BrokerTelegramRouteLike, "sessionKey">>(route: T, state: BrokerTelegramRouteBindingState): BrokerTelegramRouteWithOptionalBinding<T>;
export function routeWithPersistedTelegramBinding<T extends Pick<BrokerTelegramRouteLike, "sessionKey">>(route: T, state: BrokerTelegramRouteBindingState): BrokerTelegramRouteWithOptionalBinding<T> {
  if ("binding" in route && route.binding) return route as BrokerTelegramRouteWithOptionalBinding<T>;
  const binding = persistedTelegramBindingForRoute(route, state);
  return binding ? { ...route, binding } : route;
}
