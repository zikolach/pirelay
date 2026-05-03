export type MessengerKind = "telegram" | "discord" | "slack" | "signal" | "matrix" | (string & {});
export type MessengerInstanceId = string;

export interface MessengerRef {
  kind: MessengerKind;
  instanceId: MessengerInstanceId;
}

export const DEFAULT_MESSENGER_INSTANCE_ID = "default";

const messengerKindPattern = /^[a-z][a-z0-9-]*$/;
const messengerInstancePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function isValidMessengerKind(value: string): boolean {
  return messengerKindPattern.test(value);
}

export function isValidMessengerInstanceId(value: string): boolean {
  return messengerInstancePattern.test(value);
}

export function parseMessengerRef(value: string, defaultInstanceId = DEFAULT_MESSENGER_INSTANCE_ID): MessengerRef | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const [kind, instanceId = defaultInstanceId, extra] = trimmed.split(":");
  if (extra !== undefined) return undefined;
  if (!isValidMessengerKind(kind) || !isValidMessengerInstanceId(instanceId)) return undefined;
  return { kind, instanceId };
}

export function formatMessengerRef(ref: MessengerRef): string {
  return ref.instanceId === DEFAULT_MESSENGER_INSTANCE_ID ? ref.kind : `${ref.kind}:${ref.instanceId}`;
}

export function messengerRefsEqual(left: MessengerRef, right: MessengerRef): boolean {
  return left.kind === right.kind && left.instanceId === right.instanceId;
}

export function messengerBindingScope(ref: MessengerRef, sessionKey: string): string {
  return `${ref.kind}:${ref.instanceId}:${sessionKey}`;
}
