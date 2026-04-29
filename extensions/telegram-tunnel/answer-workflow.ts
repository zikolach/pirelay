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
const ANSWER_TEMPLATE_LINE = /^A(\d+):\s*(.*)$/i;
const MAX_TAIL_EXCERPT = 1400;
const CHOICE_PROMPT_HINT = /\b(choose|choice|select|pick|option|answer|decide|decision|reply with|which one|which option)\b/i;
const QUESTION_PROMPT_HINT = /\b(answer|question|questions|reply|respond|clarify|let me know|tell me)\b/i;

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

function findInlineLetteredChoiceMetadata(text: string): StructuredAnswerMetadata | undefined {
  const matches = Array.from(text.matchAll(/(^|\s)([A-Z])\)\s+/gm));
  if (matches.length < 2) return undefined;

  const first = matches[0];
  if (!first || first.index == null) return undefined;
  const optionStart = first.index + first[1]!.length;
  const prompt = text.slice(0, optionStart).replace(/[\s\n]+$/, "").trim();
  if (!CHOICE_PROMPT_HINT.test(prompt) && !prompt.endsWith(":") && !prompt.endsWith("?")) {
    return undefined;
  }

  const options: StructuredChoiceOption[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]!;
    const next = matches[index + 1];
    const currentStart = current.index! + current[1]!.length;
    const labelStart = currentStart + current[2]!.length + 1;
    const labelEnd = next?.index != null ? next.index : text.length;
    const label = text.slice(labelStart, labelEnd).trim().replace(/\s+/g, " ");
    if (!label) continue;
    options.push({
      id: current[2]!,
      label,
      answer: `${current[2]}) ${label}`,
    });
  }

  if (options.length < 2) return undefined;

  const tailExcerpt = text.slice(optionStart).trim();
  return {
    kind: "choice",
    prompt: normalizePrompt(prompt, "Please choose one of the following options."),
    options,
    tailExcerpt: tailExcerpt.length <= MAX_TAIL_EXCERPT ? tailExcerpt : `…\n${tailExcerpt.slice(-MAX_TAIL_EXCERPT).trimStart()}`,
  };
}

function findChoiceMetadata(lines: string[]): StructuredAnswerMetadata | undefined {
  for (let end = lines.length - 1; end >= 0; end -= 1) {
    const candidate: StructuredChoiceOption[] = [];
    let start = end;
    let sawBulletOption = false;

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
        sawBulletOption = true;
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

    if (sawBulletOption) {
      candidate.forEach((option, index) => {
        option.id = String(index + 1);
      });
    }

    let promptIndex = start;
    while (promptIndex >= 0 && !(lines[promptIndex] ?? "").trim()) {
      promptIndex -= 1;
    }
    const promptLine = (lines[promptIndex] ?? "").trim();
    const hasPromptHint = CHOICE_PROMPT_HINT.test(promptLine);
    const hasStructuralLeadIn = promptLine.endsWith(":") || promptLine.endsWith("?");
    const choiceLooksIntentional = sawBulletOption ? hasPromptHint : (hasPromptHint || hasStructuralLeadIn);
    if (!choiceLooksIntentional) {
      continue;
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
  const promptLine = (lines[promptIndex] ?? "").trim();
  if (!QUESTION_PROMPT_HINT.test(promptLine)) {
    return undefined;
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
  const inlineLettered = findInlineLetteredChoiceMetadata(text);
  if (inlineLettered) return inlineLettered;
  const lines = splitLines(text);
  return findChoiceMetadata(lines) ?? findQuestionMetadata(lines);
}

export function summarizeTailForTelegram(metadata: StructuredAnswerMetadata): string {
  if (metadata.kind === "choice") {
    return [
      metadata.prompt,
      ...(metadata.options ?? []).map((option) => `${option.id}. ${option.label}`),
      "",
      "Reply with an option directly, or send 'answer' to open an answer draft.",
      "Use /full for the full output.",
    ].join("\n");
  }

  return [
    metadata.prompt,
    ...(metadata.questions ?? []).map((question, index) => `${index + 1}. ${question}`),
    "",
    "Send 'answer' to open an answer draft, or /full for the full output.",
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
  if (!normalized) return undefined;
  const options = metadata.options ?? [];
  const directMatch = options.find((option) => {
    return option.id.toLowerCase() === normalized
      || option.label.toLowerCase() === normalized
      || option.answer.toLowerCase() === normalized;
  });
  if (directMatch) return directMatch;

  const ordinal = Number(normalized);
  if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= options.length) {
    return options[ordinal - 1];
  }

  return undefined;
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

function parseQuestionnaireDraftReply(metadata: StructuredAnswerMetadata, text: string): {
  answers: string[];
  missingIndexes: number[];
} | undefined {
  if (metadata.kind !== "questions") return undefined;
  const total = metadata.questions?.length ?? 0;
  if (total === 0) return undefined;

  const lines = splitLines(text);
  const answers = new Array<string>(total).fill("");
  let currentIndex = -1;
  let sawTemplateLine = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const match = line.match(ANSWER_TEMPLATE_LINE);
    if (match) {
      const answerIndex = Number(match[1]) - 1;
      if (answerIndex >= 0 && answerIndex < total) {
        answers[answerIndex] = match[2]?.trim() ?? "";
        currentIndex = answerIndex;
        sawTemplateLine = true;
        continue;
      }
    }

    if (currentIndex >= 0 && line.trim()) {
      answers[currentIndex] = [answers[currentIndex], line.trim()].filter(Boolean).join("\n");
    }
  }

  if (!sawTemplateLine) return undefined;

  const missingIndexes = answers
    .map((answer, index) => ({ answer: answer.trim(), index }))
    .filter((entry) => !entry.answer)
    .map((entry) => entry.index);

  return {
    answers: answers.map((answer) => answer.trim()),
    missingIndexes,
  };
}

export function renderGuidedAnswerPrompt(metadata: StructuredAnswerMetadata, state: GuidedAnswerFlowState): string {
  if (metadata.kind === "choice") {
    return [
      "Answering the latest completed assistant output:",
      "",
      metadata.prompt,
      ...(metadata.options ?? []).map((option) => `${option.id}. ${option.label}`),
      "",
      "Reply with the option id, number, full option text, or your own answer text.",
      "Send 'cancel' to exit this answer flow.",
    ].join("\n");
  }

  const lines = [
    "Answering the latest completed assistant output:",
    "",
    metadata.prompt,
    "",
  ];

  (metadata.questions ?? []).forEach((question, index) => {
    lines.push(`Q${index + 1}: ${question}`);
    lines.push(`A${index + 1}: ${state.answers[index] ?? ""}`);
    lines.push("");
  });

  const nextQuestion = metadata.questions?.[state.step];
  if (nextQuestion) {
    lines.push(`Next question: Q${state.step + 1}`);
    lines.push(nextQuestion);
    lines.push("");
  }

  lines.push("Reply with the filled A1/A2 template above, or answer the next question directly to continue step-by-step.");
  lines.push("Send 'cancel' to exit this answer flow.");
  return lines.join("\n");
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

  const draftedReply = parseQuestionnaireDraftReply(metadata, trimmed);
  if (draftedReply) {
    if (draftedReply.missingIndexes.length === 0) {
      return {
        done: true,
        responseText: "Sent your answers to Pi.",
        injectionText: buildQuestionnaireInjection(metadata, draftedReply.answers),
      };
    }

    const nextState: GuidedAnswerFlowState = {
      step: draftedReply.missingIndexes[0] ?? 0,
      answers: draftedReply.answers,
    };
    return {
      nextState,
      responseText: [
        `I still need answers for: ${draftedReply.missingIndexes.map((index) => `A${index + 1}`).join(", ")}.`,
        "",
        renderGuidedAnswerPrompt(metadata, nextState),
      ].join("\n"),
    };
  }

  const nextAnswers = [...state.answers];
  nextAnswers[state.step] = trimmed;
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
