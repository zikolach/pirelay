import type { ProgressActivityEntry } from "../core/types.js";

export interface LiveProgressDeliveryState<Ref extends string = string> {
  lastEventId?: string;
  pending: ProgressActivityEntry[];
  timer?: ReturnType<typeof setTimeout>;
  lastSentAt?: number;
  lastText?: string;
  liveMessageRef?: Ref;
}

export interface LiveProgressDeliveryActions<Ref extends string = string> {
  sendLiveProgress?: (text: string) => Promise<Ref | undefined>;
  updateLiveProgress?: (ref: Ref, text: string) => Promise<void>;
  sendProgressSnapshot: (text: string) => Promise<void>;
}

export async function deliverLiveProgress<Ref extends string>(
  state: LiveProgressDeliveryState<Ref>,
  text: string,
  actions: LiveProgressDeliveryActions<Ref>,
): Promise<void> {
  if (state.lastText === text) return;

  if (state.liveMessageRef && actions.updateLiveProgress) {
    try {
      await actions.updateLiveProgress(state.liveMessageRef, text);
      state.lastText = text;
      return;
    } catch {
      state.liveMessageRef = undefined;
    }
  }

  if (actions.sendLiveProgress) {
    try {
      const ref = await actions.sendLiveProgress(text);
      state.liveMessageRef = typeof ref === "string" && ref.length > 0 ? ref : undefined;
      state.lastText = text;
      return;
    } catch {
      state.liveMessageRef = undefined;
    }
  }

  try {
    await actions.sendProgressSnapshot(text);
    state.lastText = text;
  } catch {
    state.liveMessageRef = undefined;
  }
}
