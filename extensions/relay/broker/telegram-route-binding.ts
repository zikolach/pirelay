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

export function routeWithPersistedTelegramBinding<T extends BrokerTelegramRouteLike>(route: T, state: BrokerTelegramRouteBindingState): T {
  if (route.binding) return route;
  const binding = persistedTelegramBindingForRoute(route, state);
  return binding ? { ...route, binding } : route;
}
