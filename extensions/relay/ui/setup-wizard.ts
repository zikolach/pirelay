import { matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { RelaySetupWizardActionId, RelaySetupWizardModel, RelaySetupWizardPanel } from "../config/setup-wizard.js";
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

export interface RelaySetupWizardScreenOptions {
  onCopyEnvSnippet?: () => void | Promise<void>;
  onCopySlackManifest?: () => void | Promise<void>;
}

export class RelaySetupWizardScreen {
  private selectedPanel = 0;

  constructor(
    private readonly model: RelaySetupWizardModel,
    private readonly theme: SetupWizardTheme,
    private readonly done: (action?: RelaySetupWizardActionId) => void,
    private readonly options: RelaySetupWizardScreenOptions = {},
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.done();
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "up") || data === "h" || data === "H" || data === "k" || data === "K") {
      this.selectedPanel = Math.max(0, this.selectedPanel - 1);
      return;
    }
    if (matchesKey(data, "right") || matchesKey(data, "down") || matchesKey(data, "tab") || data === "l" || data === "L" || data === "j" || data === "J") {
      this.selectedPanel = Math.min(this.model.panels.length - 1, this.selectedPanel + 1);
      return;
    }
    if (data === "c" || data === "C") {
      if (this.options.onCopyEnvSnippet) {
        this.safeFireAndForget(this.options.onCopyEnvSnippet);
        return;
      }
      this.done("copy-env-snippet");
      return;
    }
    if ((data === "m" || data === "M") && this.hasAction("copy-slack-manifest")) {
      if (this.options.onCopySlackManifest) {
        this.safeFireAndForget(this.options.onCopySlackManifest);
        return;
      }
      this.done("copy-slack-manifest");
      return;
    }
    if (data === "w" || data === "W") {
      this.done("write-config-from-env");
      return;
    }
    if (matchesKey(data, "enter")) {
      // Panels are selected eagerly as the cursor moves. Enter is accepted as a no-op so users can press it naturally.
      return;
    }
  }

  invalidate(): void {}

  private safeFireAndForget(callback: () => void | Promise<void>): void {
    void Promise.resolve().then(callback).catch(() => undefined);
  }

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
    lines.push(row(this.renderTabs(innerWidth)));
    lines.push(row());
    const panel = this.model.panels[this.selectedPanel] ?? this.model.panels[0];
    if (panel) lines.push(...this.renderPanelRows(panel, innerWidth, row));
    lines.push(row());
    lines.push(row(this.theme.fg("dim", this.footerText())));
    lines.push(bottom);
    return lines.map((line) => visibleWidth(line) > width ? truncateVisible(line, width) : line);
  }

  private hasAction(action: RelaySetupWizardActionId): boolean {
    return this.model.actions.some((candidate) => candidate.id === action);
  }

  private footerText(): string {
    const actions = ["←/→ tabs", "c copy env to clipboard"];
    if (this.hasAction("copy-slack-manifest")) actions.push("m copy manifest");
    actions.push("w write config", "q/Esc close");
    return actions.join(" · ");
  }

  private renderTabs(innerWidth: number): string {
    const tabs = this.model.panels.map((panel, index) => {
      const label = ` ${panel.label} `;
      return index === this.selectedPanel ? this.theme.fg("accent", `[${label}]`) : this.theme.fg("dim", ` ${label} `);
    }).join(" ");
    return truncateVisible(tabs, innerWidth);
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
