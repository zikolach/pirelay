export interface StructuredChoiceOption {
  id: string;
  label: string;
  answer: string;
}

export interface StructuredAnswerMetadata {
  kind: "choice" | "questions";
  prompt: string;
  options?: StructuredChoiceOption[];
  questions?: string[];
  tailExcerpt: string;
}

export interface GuidedAnswerFlowState {
  step: number;
  answers: string[];
}

export interface GuidedAnswerResult {
  cancelled?: boolean;
  done?: boolean;
  nextState?: GuidedAnswerFlowState;
  responseText: string;
  injectionText?: string;
}

const NUMBERED_OPTION = /^\s*(\d+)[.)]\s+(.+)$/;
const BULLET_OPTION = /^\s*[-*]\s+(.+)$/;
const MAX_TAIL_EXCERPT = 1400;

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function normalizePrompt(prompt: string | undefined, fallback: string): string {
  const trimmed = prompt?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function excerptFromLines(lines: string[], startIndex: number): string {
  const excerpt = lines.slice(Math.max(0, startIndex)).join("\n").trim();
  if (excerpt.length <= MAX_TAIL_EXCERPT) return excerpt;
  return `…\n${excerpt.slice(excerpt.length - MAX_TAIL_EXCERPT).trimStart()}`;
}

function findChoiceMetadata(lines: string[]): StructuredAnswerMetadata | undefined {
  for (let end = lines.length - 1; end >= 0; end -= 1) {
    const candidate: StructuredChoiceOption[] = [];
    let start = end;

    while (start >= 0) {
      const line = lines[start] ?? "";
      const numbered = line.match(NUMBERED_OPTION);
      const bullet = line.match(BULLET_OPTION);
      if (numbered) {
        candidate.unshift({
          id: numbered[1]!,
          label: numbered[2]!.trim(),
          answer: line.trim(),
        });
        start -= 1;
        continue;
      }
      if (bullet) {
        candidate.unshift({
          id: String(candidate.length + 1),
          label: bullet[1]!.trim(),
          answer: line.trim(),
        });
        start -= 1;
        continue;
      }
      break;
    }

    if (candidate.length < 2) {
      continue;
    }

    let promptIndex = start;
    while (promptIndex >= 0 && !(lines[promptIndex] ?? "").trim()) {
      promptIndex -= 1;
    }
    const prompt = normalizePrompt(lines[promptIndex], "Please choose one of the following options.");
    const tailStart = promptIndex >= 0 ? promptIndex : start + 1;
    return {
      kind: "choice",
      prompt,
      options: candidate,
      tailExcerpt: excerptFromLines(lines, tailStart),
    };
  }

  return undefined;
}

function findQuestionMetadata(lines: string[]): StructuredAnswerMetadata | undefined {
  const questions: string[] = [];
  let startIndex = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (!line) {
      if (questions.length > 0) break;
      continue;
    }
    if (line.endsWith("?")) {
      questions.unshift(line);
      startIndex = index;
      continue;
    }
    if (questions.length > 0) break;
  }

  if (questions.length === 0) return undefined;
  if (questions.length === 1 && questions[0]!.length < 12) return undefined;

  let promptIndex = startIndex - 1;
  while (promptIndex >= 0 && !(lines[promptIndex] ?? "").trim()) {
    promptIndex -= 1;
  }

  return {
    kind: "questions",
    prompt: normalizePrompt(lines[promptIndex], "Please answer the following questions."),
    questions,
    tailExcerpt: excerptFromLines(lines, Math.max(0, startIndex)),
  };
}

export function extractStructuredAnswerMetadata(text: string): StructuredAnswerMetadata | undefined {
  if (!text.trim()) return undefined;
  const lines = splitLines(text);
  return findChoiceMetadata(lines) ?? findQuestionMetadata(lines);
}

export function summarizeTailForTelegram(metadata: StructuredAnswerMetadata): string {
  if (metadata.kind === "choice") {
    return [
      metadata.prompt,
      ...(metadata.options ?? []).map((option) => `${option.id}. ${option.label}`),
      "",
      "Reply with a number to answer immediately, or send 'answer' for a guided flow.",
      "Use /full for the full output.",
    ].join("\n");
  }

  return [
    metadata.prompt,
    ...(metadata.questions ?? []).map((question, index) => `${index + 1}. ${question}`),
    "",
    "Send 'answer' to reply question-by-question, or /full for the full output.",
  ].join("\n");
}

export function isGuidedAnswerStart(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "answer" || normalized === "answers" || normalized === "start answer";
}

export function isGuidedAnswerCancel(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "cancel" || normalized === "stop" || normalized === "never mind";
}

export function matchChoiceOption(metadata: StructuredAnswerMetadata, text: string): StructuredChoiceOption | undefined {
  if (metadata.kind !== "choice") return undefined;
  const normalized = text.trim().toLowerCase();
  return (metadata.options ?? []).find((option) => option.id === normalized || option.label.toLowerCase() === normalized);
}

export function startGuidedAnswerFlow(): GuidedAnswerFlowState {
  return { step: 0, answers: [] };
}

export function buildChoiceInjection(metadata: StructuredAnswerMetadata, option: StructuredChoiceOption): string {
  return [
    `Answer to: ${metadata.prompt}`,
    `Selected option ${option.id}: ${option.label}`,
  ].join("\n");
}

export function buildFreeTextChoiceInjection(metadata: StructuredAnswerMetadata, text: string): string {
  return [
    `Answer to: ${metadata.prompt}`,
    text.trim(),
  ].join("\n");
}

export function buildQuestionnaireInjection(metadata: StructuredAnswerMetadata, answers: string[]): string {
  const lines = [metadata.prompt];
  (metadata.questions ?? []).forEach((question, index) => {
    lines.push(`Q${index + 1}: ${question}`);
    lines.push(`A${index + 1}: ${answers[index] ?? ""}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

export function renderGuidedAnswerPrompt(metadata: StructuredAnswerMetadata, state: GuidedAnswerFlowState): string {
  if (metadata.kind === "choice") {
    return [
      metadata.prompt,
      ...(metadata.options ?? []).map((option) => `${option.id}. ${option.label}`),
      "",
      "Reply with the option number or your own answer text.",
      "Send 'cancel' to exit this answer flow.",
    ].join("\n");
  }

  const question = metadata.questions?.[state.step] ?? "No question available.";
  return [
    `${metadata.prompt}`,
    `Question ${state.step + 1}/${metadata.questions?.length ?? 1}:`,
    question,
    "",
    "Reply with your answer, or send 'cancel' to exit this answer flow.",
  ].join("\n");
}

export function advanceGuidedAnswerFlow(
  metadata: StructuredAnswerMetadata,
  state: GuidedAnswerFlowState,
  text: string,
): GuidedAnswerResult {
  const trimmed = text.trim();
  if (isGuidedAnswerCancel(trimmed)) {
    return { cancelled: true, responseText: "Guided answer flow cancelled." };
  }

  if (metadata.kind === "choice") {
    const option = matchChoiceOption(metadata, trimmed);
    if (option) {
      return {
        done: true,
        responseText: `Selected option ${option.id}: ${option.label}`,
        injectionText: buildChoiceInjection(metadata, option),
      };
    }
    return {
      done: true,
      responseText: "Sent your custom answer to Pi.",
      injectionText: buildFreeTextChoiceInjection(metadata, trimmed),
    };
  }

  const nextAnswers = [...state.answers, trimmed];
  const nextStep = state.step + 1;
  const total = metadata.questions?.length ?? 0;
  if (nextStep >= total) {
    return {
      done: true,
      responseText: "Sent your answers to Pi.",
      injectionText: buildQuestionnaireInjection(metadata, nextAnswers),
    };
  }

  const nextState: GuidedAnswerFlowState = { step: nextStep, answers: nextAnswers };
  return {
    nextState,
    responseText: renderGuidedAnswerPrompt(metadata, nextState),
  };
}
