import type { ChannelAdapterKind, ChannelCapabilities, ChannelInboundEvent } from "./channel-adapter.js";
import type { DeliveryMode } from "./types.js";

export const relayPipelineProtocolVersion = 1;

export type RelayMiddlewarePhase = "inbound" | "intent" | "delivery" | "outbound";
export const RELAY_MIDDLEWARE_PHASES: RelayMiddlewarePhase[] = ["inbound", "intent", "delivery", "outbound"];

export type RelaySafetyClassification =
  | "safe"
  | "redacted"
  | "secret-sensitive"
  | "unsafe-for-channel"
  | "safe-for-speech"
  | "requires-confirmation"
  | "media-download"
  | "transcription"
  | "extraction";

export interface RelayAdapterMetadata {
  channel: ChannelAdapterKind;
  capabilities: Partial<ChannelCapabilities>;
  metadata?: Record<string, unknown>;
}

export interface RelayRouteMetadata {
  sessionKey: string;
  sessionLabel: string;
  online: boolean;
  busy: boolean;
  paused?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RelayMediaReference {
  id: string;
  kind: "image" | "document" | "audio" | "video" | "other";
  mimeType?: string;
  byteSize?: number;
  safety: RelaySafetyClassification;
  metadata?: Record<string, unknown>;
}

export interface RelayPipelineEvent {
  id: string;
  channel: ChannelAdapterKind;
  phase: "inbound" | "outbound";
  inbound?: ChannelInboundEvent;
  outbound?: RelayOutboundEvent;
  identity?: { userId: string; username?: string; displayName?: string };
  route?: RelayRouteMetadata;
  adapter: RelayAdapterMetadata;
  media?: RelayMediaReference[];
  authorized: boolean;
  metadata?: Record<string, unknown>;
}

export interface RelayIntent {
  type: "prompt" | "command" | "guided-answer" | "approval" | "media" | "repeat-last" | "unknown";
  text?: string;
  command?: string;
  args?: string;
  safety: RelaySafetyClassification;
  metadata?: Record<string, unknown>;
}

export interface RelayPrompt {
  content: string;
  deliverAs?: DeliveryMode;
  media?: RelayMediaReference[];
  safety: RelaySafetyClassification;
  metadata?: Record<string, unknown>;
}

export interface RelayAction {
  type: "abort" | "compact" | "pause" | "resume" | "repeat-last" | "read-last" | "spoken-output" | "approval" | "custom";
  safety: RelaySafetyClassification;
  requiresConfirmation?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RelayOutboundEvent {
  kind: "text" | "document" | "image" | "activity" | "spoken-output" | "progress" | "error";
  text?: string;
  safety: RelaySafetyClassification;
  metadata?: Record<string, unknown>;
}

export type RelayPipelineResult =
  | { kind: "continue"; event?: RelayPipelineEvent; intent?: RelayIntent }
  | { kind: "prompt"; prompt: RelayPrompt; event?: RelayPipelineEvent }
  | { kind: "channel-response"; response: RelayOutboundEvent; event?: RelayPipelineEvent }
  | { kind: "internal-action"; action: RelayAction; event?: RelayPipelineEvent }
  | { kind: "blocked"; reason: string; safety: RelaySafetyClassification; event?: RelayPipelineEvent }
  | { kind: "error"; middlewareId: string; message: string; recoverable: boolean; event?: RelayPipelineEvent };

export interface RelayTraceEntry {
  middlewareId: string;
  phase: RelayMiddlewarePhase;
  outcome: "continue" | "handled" | "blocked" | "error" | "skipped";
  message?: string;
}

export interface RelayPipelineContext {
  trace: RelayTraceEntry[];
  emitTrace(entry: RelayTraceEntry): void;
}

export type BooleanChannelCapabilityKey = {
  [Key in keyof ChannelCapabilities]-?: NonNullable<ChannelCapabilities[Key]> extends boolean ? Key : never;
}[keyof ChannelCapabilities];

export interface RelayMiddlewareCapabilityDeclaration {
  produces?: string[];
  requires?: string[];
  adapter?: BooleanChannelCapabilityKey[];
}

export interface RelayMiddlewareOrdering {
  before?: string[];
  after?: string[];
}

export interface RelayMiddleware {
  id: string;
  phases: RelayMiddlewarePhase[];
  order?: number;
  capabilities?: RelayMiddlewareCapabilityDeclaration;
  ordering?: RelayMiddlewareOrdering;
  failure?: "fatal" | "recoverable";
  safety?: RelaySafetyClassification;
  requiresAuthorization?: boolean;
  run(event: RelayPipelineEvent, context: RelayPipelineContext): Promise<RelayPipelineResult>;
}

export interface RelayPipeline {
  readonly middleware: RelayMiddleware[];
  run(event: RelayPipelineEvent, context?: RelayPipelineContext): Promise<RelayPipelineResult>;
}

export function createRelayPipeline(middleware: RelayMiddleware[]): RelayPipeline {
  const ordered = orderMiddleware(middleware);
  return {
    middleware: ordered,
    async run(initialEvent: RelayPipelineEvent, context = createRelayPipelineContext()): Promise<RelayPipelineResult> {
      let currentEvent = initialEvent;
      let currentIntent: RelayIntent | undefined;
      const produced = new Set<string>();

      for (const phase of RELAY_MIDDLEWARE_PHASES) {
        for (const item of ordered.filter((candidate) => candidate.phases.includes(phase))) {
          const unavailable = missingRequirements(item, produced, currentEvent.adapter.capabilities);
          if (unavailable) {
            const result: RelayPipelineResult = item.failure === "fatal"
              ? { kind: "blocked", reason: unavailable, safety: "safe", event: currentEvent }
              : { kind: "continue", event: currentEvent };
            context.emitTrace({ middlewareId: item.id, phase, outcome: result.kind === "blocked" ? "blocked" : "skipped", message: unavailable });
            if (result.kind === "blocked") return result;
            continue;
          }

          if (requiresAuthorizationBeforeWork(item) && !currentEvent.authorized) {
            context.emitTrace({ middlewareId: item.id, phase, outcome: "blocked", message: "authorization-required" });
            return { kind: "blocked", reason: "authorization-required", safety: "safe", event: currentEvent };
          }

          try {
            const result = await item.run(currentEvent, context);
            for (const capability of item.capabilities?.produces ?? []) produced.add(capability);
            const nextEvent = result.event ?? currentEvent;
            if (result.kind === "continue") {
              currentEvent = nextEvent;
              currentIntent = result.intent ?? currentIntent;
              context.emitTrace({ middlewareId: item.id, phase, outcome: "continue" });
              continue;
            }
            context.emitTrace({ middlewareId: item.id, phase, outcome: result.kind === "blocked" ? "blocked" : "handled" });
            return result;
          } catch (error) {
            const message = redactForTrace(error instanceof Error ? error.message : String(error));
            context.emitTrace({ middlewareId: item.id, phase, outcome: "error", message });
            if (item.failure === "recoverable") continue;
            return { kind: "error", middlewareId: item.id, message, recoverable: false, event: currentEvent };
          }
        }
      }

      return { kind: "continue", event: currentEvent, intent: currentIntent };
    },
  };
}

export function createRelayPipelineContext(): RelayPipelineContext {
  return {
    trace: [],
    emitTrace(entry) {
      this.trace.push({ ...entry, message: entry.message ? redactForTrace(entry.message) : undefined });
    },
  };
}

export function orderMiddleware(middleware: RelayMiddleware[]): RelayMiddleware[] {
  const byId = new Map<string, RelayMiddleware>();
  for (const item of middleware) {
    if (byId.has(item.id)) throw new Error(`Duplicate middleware id: ${item.id}`);
    byId.set(item.id, item);
  }
  const dependencies = new Map<string, Set<string>>();
  for (const item of middleware) {
    const itemDependencies = dependencies.get(item.id) ?? new Set<string>();
    for (const dependency of item.ordering?.after ?? []) {
      if (!byId.has(dependency)) throw new Error(`Unknown middleware ordering reference: ${item.id} after ${dependency}`);
      itemDependencies.add(dependency);
    }
    dependencies.set(item.id, itemDependencies);
    for (const target of item.ordering?.before ?? []) {
      if (!byId.has(target)) throw new Error(`Unknown middleware ordering reference: ${item.id} before ${target}`);
      const targetDependencies = dependencies.get(target) ?? new Set<string>();
      targetDependencies.add(item.id);
      dependencies.set(target, targetDependencies);
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: RelayMiddleware[] = [];
  const baseSorted = [...middleware].sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));

  const visit = (item: RelayMiddleware) => {
    if (visited.has(item.id)) return;
    if (visiting.has(item.id)) throw new Error(`Middleware ordering cycle at ${item.id}.`);
    visiting.add(item.id);
    for (const dependency of dependencies.get(item.id) ?? []) {
      const dependencyItem = byId.get(dependency);
      if (dependencyItem) visit(dependencyItem);
    }
    visiting.delete(item.id);
    visited.add(item.id);
    result.push(item);
  };

  for (const item of baseSorted) visit(item);
  return result;
}

function missingRequirements(middleware: RelayMiddleware, produced: Set<string>, capabilities: Partial<ChannelCapabilities>): string | undefined {
  for (const required of middleware.capabilities?.requires ?? []) {
    if (!produced.has(required)) return `missing-capability:${required}`;
  }
  for (const adapterCapability of middleware.capabilities?.adapter ?? []) {
    if (capabilities[adapterCapability] !== true) return `missing-adapter-capability:${String(adapterCapability)}`;
  }
  return undefined;
}

function requiresAuthorizationBeforeWork(middleware: RelayMiddleware): boolean {
  return Boolean(middleware.requiresAuthorization)
    || middleware.safety === "media-download"
    || middleware.safety === "transcription"
    || middleware.safety === "extraction";
}

export function transcriptPrompt(transcript: string, metadata: Record<string, unknown> = {}): RelayPrompt {
  return {
    content: transcript,
    safety: "redacted",
    metadata: { accessibility: "transcript", ...metadata },
  };
}

export function spokenOutputEvent(text: string, metadata: Record<string, unknown> = {}): RelayOutboundEvent {
  return {
    kind: "spoken-output",
    text,
    safety: "safe-for-speech",
    metadata: { accessibility: "spoken-output", ...metadata },
  };
}

export function readLastAction(metadata: Record<string, unknown> = {}): RelayAction {
  return {
    type: "read-last",
    safety: "safe",
    metadata: { accessibility: "read-last", ...metadata },
  };
}

export function confirmationRequiredAction(action: Omit<RelayAction, "requiresConfirmation">): RelayAction {
  return {
    ...action,
    safety: "requires-confirmation",
    requiresConfirmation: true,
  };
}

export function redactForTrace(value: string): string {
  return value
    .replace(/token\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/secret\s*[:=]\s*\S+/gi, "[redacted]");
}
