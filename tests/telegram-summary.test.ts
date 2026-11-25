import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { summarizeForTelegram } from "../extensions/relay/adapters/telegram/summary.js";

it("uses the active registry for summaries without requiring a separate API key", async () => {
  const model = createFauxCore({}).getModel();
  const complete = vi.fn().mockResolvedValue(fauxAssistantMessage("Short summary"));
  const ctx = { model, modelRegistry: { complete } };
  expect(await summarizeForTelegram("Original result", "llm", ctx)).toBe("Short summary");
  expect(complete).toHaveBeenCalledWith(model, expect.objectContaining({
    messages: [expect.objectContaining({ role: "user", content: [{ type: "text", text: "Original result" }] })],
  }));
  complete.mockResolvedValue(fauxAssistantMessage("Partial summary", { stopReason: "error" }));
  expect(await summarizeForTelegram("Original result", "llm", ctx)).toBe("Original result");
});
