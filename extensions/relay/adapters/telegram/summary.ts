import { complete, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SummaryMode } from "../../core/types.js";
import { isStaleExtensionReferenceError } from "../../core/route-actions.js";
import { summarizeTextDeterministically } from "../../core/utils.js";

const SUMMARY_PROMPT = [
  "You summarize Pi coding-agent task results for Telegram notifications.",
  "Be concise, factual, and safe.",
  "Return plain text in 2-4 short bullet points or one short paragraph.",
  "Do not invent unstated success or failure details.",
].join("\n");

export async function summarizeForTelegram(
  text: string,
  mode: SummaryMode,
  ctx: ExtensionContext | undefined,
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
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      return summarizeTextDeterministically(text);
    }
    const userMessage: UserMessage = {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    const response = await complete(
      model,
      {
        systemPrompt: SUMMARY_PROMPT,
        messages: [userMessage],
      },
      { apiKey: auth.apiKey, headers: auth.headers },
    );
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
