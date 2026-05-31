const TABLE_ROW_MIN_CELLS = 2;

export type TelegramChatParseMode = "HTML";

export interface TelegramChatMessageText {
  text: string;
  parseMode?: TelegramChatParseMode;
}

function isFenceLine(line: string): boolean {
  return /^\s*```/.test(line);
}

function looksLikeTableRow(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitTableRow(line);
  return cells.length >= TABLE_ROW_MIN_CELLS;
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (!trimmed.includes("|")) return [];
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparatorRow(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length < TABLE_ROW_MIN_CELLS) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function padRight(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - value.length));
}

function normalizeRows(rows: string[][]): string[][] {
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
}

function renderTableBlock(rows: string[][]): string[] {
  const normalized = normalizeRows(rows);
  const columnWidths = normalized[0]!.map((_, columnIndex) => {
    return Math.max(...normalized.map((row) => row[columnIndex]!.length));
  });

  const renderRow = (row: string[]) => row
    .map((cell, index) => padRight(cell, columnWidths[index]!))
    .join(" | ")
    .trimEnd();

  const separator = columnWidths.map((width) => "-".repeat(Math.max(3, width))).join("-+-");
  const output = ["```", renderRow(normalized[0]!), separator];
  for (const row of normalized.slice(1)) {
    output.push(renderRow(row));
  }
  output.push("```");
  return output;
}

function readTableBlock(lines: string[], startIndex: number): { rows: string[][]; endIndex: number } | undefined {
  if (!looksLikeTableRow(lines[startIndex] ?? "") || !isTableSeparatorRow(lines[startIndex + 1] ?? "")) {
    return undefined;
  }

  const rows: string[][] = [splitTableRow(lines[startIndex]!)];
  let index = startIndex + 2;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim() || isFenceLine(line) || !looksLikeTableRow(line) || isTableSeparatorRow(line)) break;
    rows.push(splitTableRow(line));
    index += 1;
  }

  return rows.length > 0 ? { rows, endIndex: index } : undefined;
}

export function formatTelegramChatText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let inFence = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (isFenceLine(line)) {
      inFence = !inFence;
      output.push(line);
      index += 1;
      continue;
    }

    if (!inFence) {
      const table = readTableBlock(lines, index);
      if (table) {
        output.push(...renderTableBlock(table.rows));
        index = table.endIndex;
        continue;
      }
    }

    output.push(line);
    index += 1;
  }

  return output.join("\n");
}

export function containsMarkdownTable(text: string): boolean {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && readTableBlock(lines, index)) return true;
  }

  return false;
}

export function formatTelegramChatMessageText(text: string): TelegramChatMessageText {
  const formatted = formatTelegramChatText(text);
  const rendered = renderTelegramMarkdownAsHtml(formatted);
  return rendered ?? { text: formatted };
}

function renderTelegramMarkdownAsHtml(text: string): TelegramChatMessageText | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let inFence = false;
  let fenceLines: string[] = [];
  let usedFormatting = false;

  const flushFence = () => {
    output.push(`<pre><code>${escapeTelegramHtml(fenceLines.join("\n"))}</code></pre>`);
    fenceLines = [];
    usedFormatting = true;
  };

  for (const line of lines) {
    if (isFenceLine(line)) {
      if (inFence) {
        flushFence();
        inFence = false;
      } else {
        inFence = true;
        fenceLines = [];
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      output.push(`<b>${renderTelegramInlineMarkdown(heading[2]!).html}</b>`);
      usedFormatting = true;
      continue;
    }

    const inline = renderTelegramInlineMarkdown(line);
    if (inline.usedFormatting) usedFormatting = true;
    output.push(inline.html);
  }

  if (inFence) flushFence();

  return usedFormatting ? { text: output.join("\n"), parseMode: "HTML" } : undefined;
}

function renderTelegramInlineMarkdown(text: string): { html: string; usedFormatting: boolean } {
  let index = 0;
  let html = "";
  let usedFormatting = false;

  const appendPlain = (value: string) => {
    html += escapeTelegramHtml(value);
  };

  while (index < text.length) {
    const rest = text.slice(index);

    const code = /^`([^`\n]+)`/.exec(rest);
    if (code) {
      html += `<code>${escapeTelegramHtml(code[1]!)}</code>`;
      index += code[0].length;
      usedFormatting = true;
      continue;
    }

    const link = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest);
    if (link) {
      html += `<a href="${escapeTelegramHtmlAttribute(link[2]!)}">${escapeTelegramHtml(link[1]!)}</a>`;
      index += link[0].length;
      usedFormatting = true;
      continue;
    }

    const strong = /^\*\*([^*\n][\s\S]*?[^*\n])\*\*/.exec(rest) ?? /^__([^_\n][\s\S]*?[^_\n])__/.exec(rest);
    if (strong) {
      html += `<b>${renderTelegramInlineMarkdown(strong[1]!).html}</b>`;
      index += strong[0].length;
      usedFormatting = true;
      continue;
    }

    const strike = /^~~([^~\n][\s\S]*?[^~\n])~~/.exec(rest);
    if (strike) {
      html += `<s>${renderTelegramInlineMarkdown(strike[1]!).html}</s>`;
      index += strike[0].length;
      usedFormatting = true;
      continue;
    }

    const emphasis = /^\*([^*\s][^*\n]*?[^*\s])\*/.exec(rest);
    if (emphasis) {
      html += `<i>${renderTelegramInlineMarkdown(emphasis[1]!).html}</i>`;
      index += emphasis[0].length;
      usedFormatting = true;
      continue;
    }

    appendPlain(text[index]!);
    index += 1;
  }

  return { html, usedFormatting };
}

function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeTelegramHtmlAttribute(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, "&quot;");
}
