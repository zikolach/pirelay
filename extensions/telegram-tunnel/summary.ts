import { complete, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SummaryMode } from "./types.js";
import { summarizeTextDeterministically } from "./utils.js";

const SUMMARY_PROMPT = [
  "You summarize Pi coding-agent task results for Telegram notifications.",
  "Be concise, factual, and safe.",
  "Return plain text in 2-4 short bullet points or one short paragraph.",
  "Do not invent unstated success or failure details.",
].join("\n");

export async function summarizeForTelegram(
  text: string,
  mode: SummaryMode,
  ctx: ExtensionContext,
): Promise<string> {
  if (mode !== "llm" || !ctx.model) {
    return summarizeTextDeterministically(text);
  }

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) {
      return summarizeTextDeterministically(text);
    }
    const userMessage: UserMessage = {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    };
    const response = await complete(
      ctx.model,
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
  } catch {
    return summarizeTextDeterministically(text);
  }
}
