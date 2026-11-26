/** Interpretação dos códigos de cor do console (^N do FiveM e ANSI SGR). Sem React, fácil de testar. */

const FG: Record<number, string> = {
  30: "#15181b", 31: "#e92336", 32: "#21c846", 33: "#d7b616", 34: "#1767e8", 35: "#c817c8", 36: "#1cb5d4", 37: "#d6d6d6",
  90: "#727272", 91: "#ff4053", 92: "#3ae568", 93: "#ffe452", 94: "#4590ff", 95: "#f238e8", 96: "#55e4f5", 97: "#ffffff",
};
const CARET: Record<string, string> = {
  0: "#f1f1f1", 1: "#f21f34", 2: "#28d34f", 3: "#f5cf16", 4: "#1769ff", 5: "#18bce8", 6: "#d11bd7", 7: "#f1f1f1", 8: "#aa1729", 9: "#1d78e8",
};
const DEFAULT = "#f1f1f1";

export interface Run {
  text: string;
  color: string;
  bg?: string;
  bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; blink?: boolean; invert?: boolean; strike?: boolean;
}

// \27[ , \x1b[ , \e[ escritos como texto, ou o caractere ESC de verdade
const TOKEN = /(\^[0-9]|(?:\\27|\\x1b|\\e|\u001b)\[[0-9;]*m)/g;
const SGR = /^(?:\\27|\\x1b|\\e|\u001b)\[([0-9;]*)m$/;

export function render(text: string): Run[] {
  const runs: Run[] = [];
  let st: Omit<Run, "text"> = { color: DEFAULT };
  for (const tok of text.split(TOKEN)) {
    if (!tok) continue;
    if (/^\^[0-9]$/.test(tok)) {
      st = { ...st, color: CARET[tok[1]] };
      continue;
    }
    const m = tok.match(SGR);
    if (m) {
      for (const n of (m[1] || "0").split(";").map(Number)) {
        if (n === 0) st = { color: DEFAULT };
        else if (FG[n]) st = { ...st, color: FG[n] };
        else if (FG[n - 10]) st = { ...st, bg: FG[n - 10] };
        else if (n === 39) st = { ...st, color: DEFAULT };
        else if (n === 49) st = { ...st, bg: undefined };
        else if (n === 1) st = { ...st, bold: true };
        else if (n === 2) st = { ...st, dim: true };
        else if (n === 3) st = { ...st, italic: true };
        else if (n === 4) st = { ...st, underline: true };
        else if (n === 5) st = { ...st, blink: true };
        else if (n === 7) st = { ...st, invert: true };
        else if (n === 9) st = { ...st, strike: true };
      }
      continue;
    }
    runs.push({ ...st, text: tok });
  }
  return runs;
}

/** Monta o print() em Lua. Os escapes de cor (\27, \x1b) continuam escapes; o resto vira literal. */
export function luaPrint(text: string): string {
  const body = text
    .replace(/\u001b/g, "\\27")
    .replace(/\\/g, "\\\\")
    .replace(/\\\\(27|x1b)\[/g, "\\$1[")
    .replace(/\\\\e\[/g, "\\27[")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `print("${body}")`;
}
