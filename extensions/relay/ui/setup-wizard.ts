import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { RelaySetupWizardModel, RelaySetupWizardPanel } from "../config/setup-wizard.js";
import { renderQrLines } from "./qr.js";

export interface SetupWizardTheme {
  fg(name: string, text: string): string;
}

function truncateVisible(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) return text;
  let output = "";
  for (const char of text) {
    if (visibleWidth(`${output}${char}…`) > maxWidth) break;
    output += char;
  }
  return `${output}…`;
}

function wrapPlainText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [""];
  const lines: string[] = [];
  for (const sourceLine of text.split("\n")) {
    if (/^\s+\S/.test(sourceLine)) {
      if (visibleWidth(sourceLine) <= maxWidth) {
        lines.push(sourceLine);
        continue;
      }
      let remaining = sourceLine;
      while (visibleWidth(remaining) > maxWidth) {
        lines.push(remaining.slice(0, maxWidth));
        remaining = remaining.slice(maxWidth);
      }
      lines.push(remaining);
      continue;
    }
    const words = sourceLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (visibleWidth(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (visibleWidth(word) <= maxWidth) {
        line = word;
      } else {
        let remaining = word;
        while (visibleWidth(remaining) > maxWidth) {
          lines.push(remaining.slice(0, maxWidth));
          remaining = remaining.slice(maxWidth);
        }
        line = remaining;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export class RelaySetupWizardScreen {
  private selectedPanel = 0;

  constructor(
    private readonly model: RelaySetupWizardModel,
    private readonly theme: SetupWizardTheme,
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.done();
      return;
    }
    if (matchesKey(data, "up") || data === "k" || data === "K") {
      this.selectedPanel = Math.max(0, this.selectedPanel - 1);
      return;
    }
    if (matchesKey(data, "down") || data === "j" || data === "J") {
      this.selectedPanel = Math.min(this.model.panels.length - 1, this.selectedPanel + 1);
      return;
    }
    if (matchesKey(data, "enter")) {
      // Panels are selected eagerly as the cursor moves. Enter is accepted as a no-op so users can press it naturally.
      return;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const outerWidth = Math.max(32, Math.min(Math.max(32, width - 2), 100));
    const innerWidth = outerWidth - 2;
    const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const bottom = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
    const row = (text = ""): string => {
      const truncated = truncateVisible(text, innerWidth);
      return `${this.theme.fg("border", "│")}${truncated}${" ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)))}${this.theme.fg("border", "│")}`;
    };

    const lines: string[] = [border];
    lines.push(row(this.theme.fg("accent", `${this.model.title} — ${this.model.statusLabel}`)));
    lines.push(row(`Messenger: ${this.model.channel}`));
    lines.push(row());
    lines.push(row(this.theme.fg("accent", "Panels")));
    this.model.panels.forEach((panel, index) => {
      const cursor = index === this.selectedPanel ? "›" : " ";
      lines.push(row(`${cursor} ${panel.label}`));
    });
    lines.push(row());
    const panel = this.model.panels[this.selectedPanel] ?? this.model.panels[0];
    lines.push(row(this.theme.fg("accent", panel?.label ?? "Details")));
    if (panel) lines.push(...this.renderPanelRows(panel, innerWidth, row));
    lines.push(row());
    lines.push(row(this.theme.fg("accent", "Next steps")));
    for (const step of this.model.nextSteps) {
      for (const wrapped of wrapPlainText(step, innerWidth - 2)) lines.push(row(`• ${wrapped}`));
    }
    lines.push(row());
    lines.push(row(this.theme.fg("dim", "↑/↓ or j/k select · Enter view · q/Esc close · no secrets are written")));
    lines.push(bottom);
    return lines.map((line) => visibleWidth(line) > width ? truncateVisible(line, width) : line);
  }

  private renderPanelRows(panel: RelaySetupWizardPanel, innerWidth: number, row: (text?: string) => string): string[] {
    const rows: string[] = [];
    if (panel.qrUrl) {
      for (const qrLine of renderQrLines(panel.qrUrl)) rows.push(row(qrLine));
      rows.push(row());
    }
    for (const line of panel.lines) {
      for (const wrapped of wrapPlainText(line, innerWidth)) rows.push(row(wrapped));
    }
    return rows;
  }
}
