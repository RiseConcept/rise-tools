import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { errorText } from "../../core/tools";
import { useHints, useToast } from "../../ui/feedback";
import { IconCopy, IconTrash } from "../../ui/icons";
import { Editorial, Tabs, type TabItem } from "../../ui/layout";
import { luaPrint, render, type Run } from "./format";

/* As cores abaixo são as do console do FiveM (conteúdo, não tema). */
type Swatch = { code: number | string; name: string; color: string; dark?: boolean };

const FIVEM: Swatch[] = [
  { code: 0, name: "Padrão", color: "#f1f1f1", dark: true }, { code: 1, name: "Vermelho", color: "#f21f34" },
  { code: 2, name: "Verde", color: "#28d34f", dark: true }, { code: 3, name: "Amarelo", color: "#f5cf16", dark: true },
  { code: 4, name: "Azul", color: "#1769ff" }, { code: 5, name: "Azul claro", color: "#18bce8", dark: true },
  { code: 6, name: "Roxo / rosa", color: "#d11bd7" }, { code: 7, name: "Branco", color: "#f1f1f1", dark: true },
  { code: 8, name: "Vermelho escuro", color: "#aa1729" }, { code: 9, name: "Azul variação", color: "#1d78e8" },
];
const ANSI_FG: Swatch[] = [
  { code: 30, name: "Preto", color: "#15181b" }, { code: 31, name: "Vermelho", color: "#e92336" },
  { code: 32, name: "Verde", color: "#21c846" }, { code: 33, name: "Amarelo", color: "#d7b616", dark: true },
  { code: 34, name: "Azul", color: "#1767e8" }, { code: 35, name: "Magenta", color: "#c817c8" },
  { code: 36, name: "Ciano", color: "#1cb5d4" }, { code: 37, name: "Branco / cinza", color: "#d6d6d6", dark: true },
  { code: 90, name: "Cinza escuro", color: "#727272" }, { code: 91, name: "Vermelho claro", color: "#ff4053" },
  { code: 92, name: "Verde claro", color: "#3ae568", dark: true }, { code: 93, name: "Amarelo claro", color: "#ffe452", dark: true },
  { code: 94, name: "Azul claro", color: "#4590ff" }, { code: 95, name: "Magenta claro", color: "#f238e8" },
  { code: 96, name: "Ciano claro", color: "#55e4f5", dark: true }, { code: 97, name: "Branco brilhante", color: "#ffffff", dark: true },
];
const ANSI_BG: Swatch[] = ANSI_FG.map((s) => ({ ...s, code: (s.code as number) + 10 }));
const STYLES = [
  { code: 1, label: "B", name: "Negrito", cls: "font-bold" }, { code: 2, label: "D", name: "Fraco", cls: "opacity-60" },
  { code: 3, label: "I", name: "Itálico", cls: "italic" }, { code: 4, label: "U", name: "Sublinhado", cls: "underline" },
  { code: 5, label: "BL", name: "Piscando", cls: "" }, { code: 7, label: "↔", name: "Invertido", cls: "" },
  { code: 9, label: "S", name: "Tachado", cls: "line-through" },
];
const PRESETS = [
  { id: "ok", label: "Sucesso", dot: "bg-ok", text: "\\27[92m[+]\\27[0m \\27[32mOperação concluída com sucesso.\\27[0m" },
  { id: "err", label: "Erro", dot: "bg-err", text: "\\27[91m[-]\\27[0m \\27[31mNão foi possível concluir a operação.\\27[0m" },
  { id: "warn", label: "Aviso", dot: "bg-warn", text: "\\27[93m[!]\\27[0m \\27[33mAtenção: verifique as configurações.\\27[0m" },
  { id: "info", label: "Informação", dot: "bg-info", text: "\\27[96m[~]\\27[0m \\27[36mResource carregada e pronta para uso.\\27[0m" },
];

type Mode = "fivem" | "ansi";
const MODES: TabItem<Mode>[] = [
  { id: "fivem", label: "FiveM ^" },
  { id: "ansi", label: "ANSI" },
];
const STORE = "console-formatter:text";
const SAMPLE = "^2[+] ^7Resource iniciada com ^2sucesso^7.";

export default function ConsoleFormatter() {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("fivem");
  const [text, setText] = useState(() => localStorage.getItem(STORE) ?? SAMPLE);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);

  useEffect(() => localStorage.setItem(STORE, text), [text]);

  const runs = useMemo(() => render(text), [text]);
  const lua = useMemo(() => luaPrint(text), [text]);
  const lines = text.split("\n").length;

  useHints([
    { keys: ["Tab"], label: "Indentar" },
    { keys: ["Ctrl", "Shift", "C"], label: "Copiar Lua" },
  ]);

  /** Insere pelo execCommand para o Ctrl+Z continuar funcionando; cai no setRangeText se não der. */
  const insert = (value: string, start: number, end: number, select = false) => {
    const el = area.current!;
    el.focus();
    el.setSelectionRange(start, end);
    if (!document.execCommand("insertText", false, value)) {
      el.setRangeText(value, start, end, "end");
      setText(el.value);
    }
    if (select) el.setSelectionRange(start, start + value.length);
  };

  const apply = (kind: Mode, code: number | string) => {
    const el = area.current!;
    const { selectionStart: s, selectionEnd: e } = el;
    const open = kind === "fivem" ? `^${code}` : `\\27[${code}m`;
    const close = kind === "fivem" ? "^7" : "\\27[0m";
    insert(s === e ? open : open + el.value.slice(s, e) + close, s, e);
  };

  const onKey = (ev: KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key !== "Tab") return;
    ev.preventDefault();
    const el = ev.currentTarget;
    const { selectionStart: s, selectionEnd: e, value } = el;
    if (s === e && !ev.shiftKey) return insert("    ", s, e);
    const from = value.lastIndexOf("\n", s - 1) + 1;
    const block = value.slice(from, e);
    const next = ev.shiftKey ? block.replace(/^ {1,4}/gm, "") : block.replace(/^/gm, "    ");
    if (next !== block) insert(next, from, e, true);
  };

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ type: "info", title: "Copiado", message: what, time: 2000 });
    } catch (e) {
      toast({ type: "err", title: "Não foi possível copiar", message: errorText(e) });
    }
  };

  const copyRef = useRef(copy);
  copyRef.current = copy;
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copyRef.current(luaPrint((area.current?.value) ?? ""), "print() pronto para colar no script");
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const preset = (value: string) => {
    setMode("ansi");
    const el = area.current!;
    insert(value, 0, el.value.length);
  };

  return (
    <div className="h-full overflow-y-auto flex flex-col px-6 xl:px-10 pt-8 xl:pt-10 pb-24 relative">
      <Editorial title="Console Formatter" subtitle="Cores e estilos para o console do FiveM"
                 text="Selecione um trecho e escolha uma cor. O preview mostra como fica no console, e o print() sai pronto para colar." />

      {/* Duas colunas com a mesma linha de topo: abas à esquerda, título do preview à direita. */}
      <div className="anim-rise mt-6 flex-1 min-h-[30rem] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-x-5 xl:gap-x-8 gap-y-4"
           style={{ "--i": 1 } as CSSProperties}>
        <div className="min-w-0 flex flex-wrap items-center gap-x-4 gap-y-2 min-h-7">
          <Tabs items={MODES} active={mode} onChange={setMode} />
          <p className="min-w-0 text-xs text-paper/50">
            {mode === "fivem" ? "Códigos ^0–^9: console do servidor e chat." : "Sequências \\27[…m: mais cores, fundo e estilos."}
          </p>
        </div>

        <div className="min-w-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 min-h-7">
          <h2 className="section-title">Preview do console</h2>
          <div className="flex gap-1.5">
            <button className="btn btn-outline btn-sm" onClick={() => copy(text, "texto com os códigos de cor")} disabled={!text}>
              <IconCopy className="size-3.5" />Copiar texto
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => copy(lua, "print() pronto para colar no script")} disabled={!text}
                    title={lua}>
              <IconCopy className="size-3.5" />Copiar Lua
            </button>
          </div>
        </div>

        {/* ---------- Editor ---------- */}
        <section className="min-w-0 min-h-0 flex flex-col gap-4">
          <div className="shrink-0 bg-glass/82 p-3 flex flex-col gap-3">
            {mode === "fivem" ? (
              <Group label="Cores FiveM">{FIVEM.map((s) => <Chip key={s.code} s={s} text={`^${s.code}`} onClick={() => apply("fivem", s.code)} />)}</Group>
            ) : (
              <>
                <Group label="Cor do texto">{ANSI_FG.map((s) => <Chip key={s.code} s={s} text={String(s.code)} onClick={() => apply("ansi", s.code)} />)}</Group>
                <Group label="Fundo">{ANSI_BG.map((s) => <Chip key={s.code} s={s} text={String(s.code)} onClick={() => apply("ansi", s.code)} />)}</Group>
                <Group label="Estilo">
                  {STYLES.map((st) => (
                    <button key={st.code} type="button" title={`${st.name} (ANSI ${st.code})`} onClick={() => apply("ansi", st.code)}
                            className={`h-7 min-w-7 px-1.5 border border-line text-paper text-xs cursor-pointer hover:bg-paper/10 transition-colors duration-1 ${st.cls}`}>
                      {st.label}
                    </button>
                  ))}
                </Group>
              </>
            )}
            <Group label="Modelos prontos">
              {PRESETS.map((p) => (
                <button key={p.id} className="btn btn-secondary btn-sm h-7" onClick={() => preset(p.text)}>
                  <i className={`size-2 ${p.dot}`} />{p.label}
                </button>
              ))}
            </Group>
          </div>

          <div className="flex-1 min-h-[7rem] flex flex-col">
            <div className="flex items-center justify-between mb-2 min-h-7 gap-4">
              <h2 className="section-title">Mensagem</h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-paper/40 tabular-nums">{text.length} {text.length === 1 ? "caractere" : "caracteres"}</span>
                <button className="btn btn-outline btn-sm" onClick={() => insert("", 0, area.current!.value.length)} disabled={!text}>
                  <IconTrash className="size-3.5" />Limpar
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 flex bg-glass/82 border border-line focus-within:border-main transition-colors duration-1">
              <div ref={gutter} aria-hidden className="shrink-0 w-10 overflow-hidden py-3 pr-2 text-right font-mono text-sm leading-6 text-paper/30 select-none whitespace-pre">
                {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
              </div>
              <textarea ref={area} value={text} spellCheck={false} wrap="off"
                        onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
                        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
                        className="flex-1 min-w-0 resize-none bg-transparent py-3 pr-3 font-mono text-sm leading-6 text-paper outline-none" />
            </div>
          </div>
        </section>

        {/* ---------- Preview: ocupa a coluna toda ---------- */}
        <div aria-live="polite"
             className="min-w-0 min-h-0 overflow-auto bg-[#080909] border border-line p-5 font-mono text-[0.9375rem] leading-7 whitespace-pre">
          {text ? runs.map((r, i) => <RunSpan key={i} r={r} />) : <span className="text-paper/30">A mensagem aparece aqui.</span>}
        </div>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.6875rem] font-display font-bold uppercase text-paper/45">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({ s, text, onClick }: { s: Swatch; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${s.name} (${text.startsWith("^") ? text : "ANSI " + text})`}
            className="h-7 min-w-9 px-1.5 font-mono text-xs font-semibold cursor-pointer outline-offset-2 hover:outline hover:outline-1 hover:outline-paper/60 active:scale-95 transition-transform duration-1"
            style={{ background: s.color, color: s.dark ? "#0a0b0d" : "#ffffff" }}>
      {text}
    </button>
  );
}

function RunSpan({ r }: { r: Run }) {
  const fg = r.invert ? (r.bg ?? "#080909") : r.color;
  const bg = r.invert ? r.color : r.bg;
  const deco = [r.underline && "underline", r.strike && "line-through"].filter(Boolean).join(" ");
  return (
    <span className={r.blink ? "console-blink" : undefined}
          style={{ color: fg, background: bg, fontWeight: r.bold ? 700 : undefined, opacity: r.dim ? 0.6 : undefined,
                   fontStyle: r.italic ? "italic" : undefined, textDecorationLine: deco || undefined }}>
      {r.text}
    </span>
  );
}
