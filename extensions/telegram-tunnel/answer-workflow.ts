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
  turnId: string;
  confidence: number;
  diagnostics: string[];
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

interface ExtractOptions {
  turnId?: string;
}

interface ParsedOptionLine {
  id: string;
  label: string;
  answer: string;
  kind: "number" | "letter" | "parenthesized" | "option-label" | "bullet";
}

interface ChoiceCandidate {
  prompt: string;
  options: StructuredChoiceOption[];
  tailStart: number;
  sawBullet: boolean;
  optionKinds: Set<ParsedOptionLine["kind"]>;
  score: number;
  diagnostics: string[];
}

const NUMBERED_OPTION = /^\s*(\d+)[.)]\s+(.+)$/;
const LETTERED_OPTION = /^\s*([A-Za-z])[.)]\s+(.+)$/;
const PARENTHESIZED_OPTION = /^\s*\(([A-Za-z0-9]+)\)\s+(.+)$/;
const OPTION_LABEL = /^\s*Option\s+([A-Za-z0-9]+)\s*[:.)-]\s+(.+)$/i;
const BULLET_OPTION = /^\s*[-*]\s+(.+)$/;
const ANSWER_TEMPLATE_LINE = /^A(\d+):\s*(.*)$/i;
const MAX_TAIL_EXCERPT = 1400;
const MIN_CHOICE_CONFIDENCE = 65;
const MIN_QUESTION_CONFIDENCE = 65;
const CHOICE_PROMPT_HINT = /\b(choose|choice|select|pick|option|answer|decide|decision|reply with|which one|which option|next options?|what next)\b/i;
const QUESTION_PROMPT_HINT = /\b(answer|question|questions|reply|respond|clarify|let me know|tell me)\b/i;
const NON_CHOICE_PROMPT_HINT = /\b(implemented|completed|changed|summary|tasks?|todos?|done|fixed|files?|tests?|steps taken|notes?)\b/i;
const CODE_LIKE_LINE = /^\s*(```|import\s|export\s|const\s|let\s|var\s|function\s|class\s|if\s*\(|for\s*\(|while\s*\(|return\b|[{};]\s*$)/;

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function normalizePrompt(prompt: string | undefined, fallback: string): string {
  const trimmed = prompt?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function normalizeInlineText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function excerptFromLines(lines: string[], startIndex: number): string {
  const excerpt = lines.slice(Math.max(0, startIndex)).join("\n").trim();
  if (excerpt.length <= MAX_TAIL_EXCERPT) return excerpt;
  return `…\n${excerpt.slice(excerpt.length - MAX_TAIL_EXCERPT).trimStart()}`;
}

function createStableTurnId(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function metadata(input: Omit<StructuredAnswerMetadata, "turnId" | "confidence" | "diagnostics">, sourceText: string, confidence: number, diagnostics: string[], options?: ExtractOptions): StructuredAnswerMetadata {
  return {
    ...input,
    turnId: options?.turnId ?? createStableTurnId(sourceText),
    confidence,
    diagnostics,
  };
}

function parseOptionLine(line: string): ParsedOptionLine | undefined {
  if (CODE_LIKE_LINE.test(line)) return undefined;

  const optionLabel = line.match(OPTION_LABEL);
  if (optionLabel?.[1] && optionLabel[2]?.trim()) {
    return {
      id: optionLabel[1].toUpperCase(),
      label: optionLabel[2].trim(),
      answer: line.trim(),
      kind: "option-label",
    };
  }

  const numbered = line.match(NUMBERED_OPTION);
  if (numbered?.[1] && numbered[2]?.trim()) {
    return {
      id: numbered[1],
      label: numbered[2].trim(),
      answer: line.trim(),
      kind: "number",
    };
  }

  const lettered = line.match(LETTERED_OPTION);
  if (lettered?.[1] && lettered[2]?.trim()) {
    return {
      id: lettered[1].toUpperCase(),
      label: lettered[2].trim(),
      answer: line.trim(),
      kind: "letter",
    };
  }

  const parenthesized = line.match(PARENTHESIZED_OPTION);
  if (parenthesized?.[1] && parenthesized[2]?.trim()) {
    return {
      id: parenthesized[1].toUpperCase(),
      label: parenthesized[2].trim(),
      answer: line.trim(),
      kind: "parenthesized",
    };
  }

  const bullet = line.match(BULLET_OPTION);
  if (bullet?.[1]?.trim()) {
    return {
      id: "",
      label: bullet[1].trim(),
      answer: line.trim(),
      kind: "bullet",
    };
  }

  return undefined;
}

function idsLookContinuous(options: StructuredChoiceOption[]): boolean {
  if (options.length < 2) return false;
  const numeric = options.map((option) => Number(option.id));
  if (numeric.every((value) => Number.isInteger(value))) {
    return numeric.every((value, index) => value === index + 1 || value === numeric[0]! + index);
  }
  const letters = options.map((option) => option.id.toUpperCase());
  if (letters.every((id) => /^[A-Z]$/.test(id))) {
    const first = letters[0]!.charCodeAt(0);
    return letters.every((id, index) => id.charCodeAt(0) === first + index);
  }
  return false;
}

function scoreChoiceCandidate(candidate: ChoiceCandidate): ChoiceCandidate {
  const prompt = candidate.prompt.trim();
  const diagnostics: string[] = [];
  let score = 20;

  score += Math.min(25, candidate.options.length * 5);
  diagnostics.push(`options:${candidate.options.length}`);

  if (CHOICE_PROMPT_HINT.test(prompt)) {
    score += 40;
    diagnostics.push("prompt-hint");
  }
  if (prompt.endsWith(":") || prompt.endsWith("?")) {
    score += 20;
    diagnostics.push("structural-leadin");
  }
  if (/\breply with\b/i.test(prompt)) {
    score += 15;
    diagnostics.push("reply-hint");
  }
  if (idsLookContinuous(candidate.options)) {
    score += 10;
    diagnostics.push("stable-continuous-ids");
  }
  if (candidate.sawBullet && !CHOICE_PROMPT_HINT.test(prompt)) {
    score -= 55;
    diagnostics.push("bullet-without-strong-prompt");
  }
  if (!CHOICE_PROMPT_HINT.test(prompt) && NON_CHOICE_PROMPT_HINT.test(prompt)) {
    score -= 45;
    diagnostics.push("ordinary-list-prompt");
  }
  if (candidate.options.some((option) => CODE_LIKE_LINE.test(option.label))) {
    score -= 30;
    diagnostics.push("code-like-option");
  }
  if (candidate.options.some((option) => option.label.length > 240)) {
    score -= 15;
    diagnostics.push("very-long-option");
  }

  return { ...candidate, score, diagnostics };
}

function createChoiceMetadata(candidate: ChoiceCandidate, lines: string[], sourceText: string, options?: ExtractOptions): StructuredAnswerMetadata | undefined {
  const scored = scoreChoiceCandidate(candidate);
  if (scored.score < MIN_CHOICE_CONFIDENCE) return undefined;
  return metadata({
    kind: "choice",
    prompt: normalizePrompt(scored.prompt, "Please choose one of the following options."),
    options: scored.options,
    tailExcerpt: excerptFromLines(lines, scored.tailStart),
  }, sourceText, scored.score, scored.diagnostics, options);
}

function findInlineChoiceMetadata(text: string, options?: ExtractOptions): StructuredAnswerMetadata | undefined {
  const marker = /(?:^|\s)(?:Option\s+([A-Z0-9]+)\s*[:.)-]|\(([A-Z0-9]+)\)|([A-Z])[.)])\s+/g;
  const matches = Array.from(text.matchAll(marker));
  if (matches.length < 2) return undefined;

  const first = matches[0];
  if (!first || first.index == null) return undefined;
  const optionStart = first.index + first[0]!.length - first[0]!.trimStart().length;
  const prompt = text.slice(0, optionStart).replace(/[\s\n]+$/, "").trim();

  const parsedOptions: StructuredChoiceOption[] = [];
  const kinds = new Set<ParsedOptionLine["kind"]>();
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index]!;
    const next = matches[index + 1];
    const id = (current[1] ?? current[2] ?? current[3] ?? "").toUpperCase();
    const labelStart = current.index! + current[0]!.length;
    const labelEnd = next?.index != null ? next.index : text.length;
    const label = normalizeInlineText(text.slice(labelStart, labelEnd));
    if (!id || !label) continue;
    parsedOptions.push({ id, label, answer: `${id}) ${label}` });
    kinds.add(current[1] ? "option-label" : current[2] ? "parenthesized" : "letter");
  }

  if (parsedOptions.length < 2) return undefined;

  const candidate = scoreChoiceCandidate({
    prompt,
    options: parsedOptions,
    tailStart: 0,
    sawBullet: false,
    optionKinds: kinds,
    score: 0,
    diagnostics: [],
  });
  if (candidate.score < MIN_CHOICE_CONFIDENCE) return undefined;

  const tailExcerpt = text.slice(optionStart).trim();
  return metadata({
    kind: "choice",
    prompt: normalizePrompt(prompt, "Please choose one of the following options."),
    options: parsedOptions,
    tailExcerpt: tailExcerpt.length <= MAX_TAIL_EXCERPT ? tailExcerpt : `…\n${tailExcerpt.slice(-MAX_TAIL_EXCERPT).trimStart()}`,
  }, text, candidate.score, ["inline-options", ...candidate.diagnostics], options);
}

function findChoiceMetadata(lines: string[], sourceText: string, options?: ExtractOptions): StructuredAnswerMetadata | undefined {
  for (let end = lines.length - 1; end >= 0; end -= 1) {
    while (end >= 0 && !(lines[end] ?? "").trim()) end -= 1;
    if (end < 0) break;

    const parsed: ParsedOptionLine[] = [];
    const kinds = new Set<ParsedOptionLine["kind"]>();
    let start = end;
    let sawBullet = false;

    while (start >= 0) {
      const line = lines[start] ?? "";
      if (!line.trim() && parsed.length > 0) {
        start -= 1;
        continue;
      }
      const option = parseOptionLine(line);
      if (!option) break;
      parsed.unshift(option);
      kinds.add(option.kind);
      sawBullet ||= option.kind === "bullet";
      start -= 1;
    }

    if (parsed.length < 2) continue;

    const candidateOptions = parsed.map((option, index) => ({
      id: option.kind === "bullet" ? String(index + 1) : option.id,
      label: option.label,
      answer: option.answer,
    }));

    let promptIndex = start;
    while (promptIndex >= 0 && !(lines[promptIndex] ?? "").trim()) {
      promptIndex -= 1;
    }
    const prompt = (lines[promptIndex] ?? "").trim();
    const tailStart = promptIndex >= 0 ? promptIndex : start + 1;
    const found = createChoiceMetadata({
      prompt,
      options: candidateOptions,
      tailStart,
      sawBullet,
      optionKinds: kinds,
      score: 0,
      diagnostics: [],
    }, lines, sourceText, options);
    if (found) return found;
  }

  return undefined;
}

function findQuestionMetadata(lines: string[], sourceText: string, options?: ExtractOptions): StructuredAnswerMetadata | undefined {
  const questions: string[] = [];
  let startIndex = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (!line) {
      if (questions.length > 0) break;
      continue;
    }
    if (line.endsWith("?") && !CODE_LIKE_LINE.test(line)) {
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

  let confidence = 55 + Math.min(20, questions.length * 5);
  const diagnostics = ["question-tail", `questions:${questions.length}`, "prompt-hint"];
  if (promptLine.endsWith(":") || promptLine.endsWith(".")) confidence += 5;
  if (confidence < MIN_QUESTION_CONFIDENCE) return undefined;

  return metadata({
    kind: "questions",
    prompt: normalizePrompt(lines[promptIndex], "Please answer the following questions."),
    questions,
    tailExcerpt: excerptFromLines(lines, Math.max(0, startIndex)),
  }, sourceText, confidence, diagnostics, options);
}

export function extractStructuredAnswerMetadata(text: string, options?: ExtractOptions): StructuredAnswerMetadata | undefined {
  if (!text.trim()) return undefined;
  const inline = findInlineChoiceMetadata(text, options);
  if (inline) return inline;
  const lines = splitLines(text);
  return findChoiceMetadata(lines, text, options) ?? findQuestionMetadata(lines, text, options);
}

export function summarizeTailForTelegram(metadata: StructuredAnswerMetadata): string {
  if (metadata.kind === "choice") {
    return [
      metadata.prompt,
      ...(metadata.options ?? []).map((option) => `${option.id}. ${option.label}`),
      "",
      "Tap an option button, reply with an option directly, or send 'answer' to open an answer draft.",
      "Use /full or the full-output buttons for the full output.",
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
