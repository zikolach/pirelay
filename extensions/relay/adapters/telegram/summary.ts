import type { UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SummaryMode } from "../../core/types.js";
import { isStaleExtensionReferenceError } from "../../core/route-actions.js";
import { summarizeTextDeterministically } from "../../core/utils.js";

const SUMMARY_PROMPT = [
  "You summarize Pi coding-agent task results for Telegram notifications.",
  "Be concise, factual, and safe.",
  "Return plain text in 2-4 short bullet points or one short paragraph.",
  "Do not invent unstated success or failure details.",
].join("\n");

type SummaryContext = Pick<ExtensionContext, "model"> & {
  modelRegistry: Pick<ExtensionContext["modelRegistry"], "complete">;
};

export async function summarizeForTelegram(
  text: string,
  mode: SummaryMode,
  ctx: SummaryContext | undefined,
  onStaleContext?: () => void,
): Promise<string> {
  let model: ExtensionContext["model"] | undefined;
  try {
    model = ctx?.model;
  } catch (error) {
    if (isStaleExtensionReferenceError(error)) {
      onStaleContext?.();
      return summarizeTextDeterministically(text);
    }
    throw error;
  }
  if (mode !== "llm" || !ctx || !model) {
    return summarizeTextDeterministically(text);
  }

  try {
    const userMessage: UserMessage = {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    const response = await ctx.modelRegistry.complete(model, {
      systemPrompt: SUMMARY_PROMPT,
      messages: [userMessage],
    });
    if (response.stopReason === "error" || response.stopReason === "aborted") return summarizeTextDeterministically(text);
    const rendered = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    return rendered || summarizeTextDeterministically(text);
  } catch (error) {
    if (isStaleExtensionReferenceError(error)) onStaleContext?.();
    return summarizeTextDeterministically(text);
  }
}
