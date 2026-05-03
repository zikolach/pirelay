const TABLE_ROW_MIN_CELLS = 2;

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
