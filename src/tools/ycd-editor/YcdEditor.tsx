import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { errorText, toolClient } from "../../core/tools";
import { useHints, useToast } from "../../ui/feedback";
import {
  IconAlert, IconArrowRight, IconClip, IconCopy, IconEdit, IconEye, IconFolder, IconSearch, IconUndo, IconUpload, IconX, Spinner,
} from "../../ui/icons";
import { Editorial, Tabs, useSlidingIndicator, type TabItem } from "../../ui/layout";

interface YcdFile {
  path: string;
  name: string;
  dict: string;
  anims: string[];
  error: string | null;
}

/** Arquivo carregado + o que o usuário digitou. */
interface Entry {
  file: YcdFile;
  dict: string;
  names: string[]; // novo nome por anim, na mesma ordem de file.anims
}

const call = toolClient("ycd-editor");

type Mode = "view" | "edit";
const MODES: TabItem<Mode>[] = [
  { id: "view", label: "Visualizar", icon: IconEye },
  { id: "edit", label: "Editar", icon: IconEdit },
];
const fresh = (file: YcdFile): Entry => ({ file, dict: file.dict, names: [...file.anims] });
const BAD = /[\s/\\:*?"<>|]|[^\x20-\x7e]/;

function invalid(name: string) {
  if (!name.trim()) return "não pode ficar vazio";
  const m = name.match(BAD);
  if (m) return `caractere inválido: "${m[0] === " " ? "espaço" : m[0]}"`;
  return null;
}

function analyze(e: Entry) {
  const dictError = invalid(e.dict.trim());
  const animErrors = e.names.map((n, i) => {
    const bad = invalid(n);
    if (bad) return bad;
    if (n === e.file.anims[i]) return null;
    if (e.names.some((o, j) => j !== i && o === n)) return "nome repetido";
    if (e.file.anims.some((o, j) => j !== i && o === n)) return "já é o nome de outra anim";
    return null;
  });
  const changedAnims = e.names.filter((n, i) => n !== e.file.anims[i]).length;
  const changed = changedAnims > 0 || e.dict.trim() !== e.file.dict;
  const valid = !dictError && animErrors.every((x) => !x);
  const dict = e.dict.trim();
  const output = dict === e.file.dict ? `${dict}_novo.ycd` : `${dict}.ycd`;
  return { dictError, animErrors, changed, changedAnims, valid, output };
}

export default function YcdEditor() {
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState<Mode>("view");

  const load = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return;
      setLoading(true);
      try {
        const { files } = await call<{ files: YcdFile[] }>("open", { paths });
        if (!files.length) {
          toast({ type: "warn", title: "Nenhum .ycd encontrado", message: "Os itens soltos não contêm arquivos .ycd." });
          return;
        }
        setEntries((prev) => {
          const map = new Map(prev.map((e) => [e.file.path, e]));
          files.forEach((f) => map.set(f.path, fresh(f)));
          return [...map.values()];
        });
        setSelected(files[0].path);
        const bad = files.filter((f) => f.error).length;
        if (bad) toast({ type: "warn", title: "Alguns arquivos não abriram", message: `${bad} de ${files.length} com erro de leitura.` });
      } catch (e) {
        toast({ type: "err", title: "Erro ao abrir", message: errorText(e) });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  const pickFiles = useCallback(async () => {
    const r = await openDialog({ multiple: true, filters: [{ name: "Clip dictionary", extensions: ["ycd"] }] });
    if (r) load(Array.isArray(r) ? r : [r]);
  }, [load]);

  const pickFolder = useCallback(async () => {
    const r = await openDialog({ directory: true, multiple: true });
    if (r) load(Array.isArray(r) ? r : [r]);
  }, [load]);

  // arrastar e soltar arquivos/pastas do Explorer
  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "enter" || p.type === "over") setDragging(true);
        else if (p.type === "leave") setDragging(false);
        else if (p.type === "drop") {
          setDragging(false);
          load(p.paths);
        }
      })
      .then((fn) => (dead ? fn() : (off = fn)));
    return () => {
      dead = true;
      off?.();
    };
  }, [load]);

  const entry = entries.find((e) => e.file.path === selected) ?? null;
  const info = entry && !entry.file.error ? analyze(entry) : null;
  const canSave = !!info && info.changed && info.valid && !saving;

  const update = (fn: (e: Entry) => Entry) =>
    setEntries((list) => list.map((e) => (e.file.path === selected ? fn(e) : e)));

  const save = useCallback(async () => {
    if (mode !== "edit" || !entry || !canSave) return;
    setSaving(true);
    try {
      const renames = entry.file.anims
        .map((from, i) => ({ from, to: entry.names[i] }))
        .filter((r) => r.from !== r.to);
      const { file } = await call<{ file: YcdFile }>("save", { path: entry.file.path, dict: entry.dict.trim(), renames });
      setEntries((list) => [...list.map((e) => (e.file.path === entry.file.path ? fresh(e.file) : e)), fresh(file)]);
      setSelected(file.path);
      toast({
        type: "ok",
        title: "Arquivo salvo",
        message: `${file.name} conferido: ${file.anims.length} ${file.anims.length === 1 ? "anim" : "anims"}. O original não foi alterado.`,
        action: { label: "Mostrar na pasta", run: () => revealItemInDir(file.path) },
        time: 7000,
      });
    } catch (e) {
      toast({ type: "err", title: "Não foi possível salvar", message: errorText(e) });
    } finally {
      setSaving(false);
    }
  }, [mode, entry, canSave, toast]);

  // atalhos
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "o") { e.preventDefault(); (e.shiftKey ? pickFolder : pickFiles)(); }
      if (k === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [pickFiles, pickFolder, save]);

  useHints([
    { keys: ["Ctrl", "O"], label: "Abrir" },
    ...(mode === "edit" && entries.length ? [{ keys: ["Ctrl", "S"], label: "Salvar" }] : []),
  ]);

  const remove = (path: string) => {
    const next = entries.filter((e) => e.file.path !== path);
    setEntries(next);
    if (path === selected) setSelected(next[0]?.file.path ?? null);
  };

  return (
    <div className="h-full flex flex-col px-6 xl:px-10 pt-8 xl:pt-10 pb-24 relative">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <Editorial title="YCD Editor" />
        <div className="anim-rise flex flex-wrap gap-1.5" style={{ "--i": 0 } as CSSProperties}>
          <button className="btn btn-secondary" onClick={pickFolder}><IconFolder className="size-4" />Abrir pasta</button>
          <button className="btn btn-primary" onClick={pickFiles}><IconUpload className="size-4" />Abrir arquivos</button>
        </div>
      </div>

      <div className="anim-rise shrink-0 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ "--i": 1 } as CSSProperties}>
        <Tabs items={MODES} active={mode} onChange={setMode} />
        <p className="text-xs text-paper/50">
          {mode === "view" ? "Consulte o dict e as anims e copie os nomes para o seu script." : "Renomeie o dict e as anims e salve uma cópia nova do arquivo."}
        </p>
      </div>

      {entries.length === 0 ? (
        <DropZone loading={loading} mode={mode} onPick={pickFiles} />
      ) : (
        /* grid-rows-[minmax(0,1fr)]: sem isso a linha cresce com o conteúdo e corta o rodapé */
        <div className="mt-6 flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)] grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)] gap-5 xl:gap-8">
          <FileList entries={entries} selected={selected} onSelect={setSelected} onRemove={remove}
                    onClear={() => { setEntries([]); setSelected(null); }} />
          {entry && (
            <section key={`${mode}:${entry.file.path}`} className="anim-rise min-h-0 min-w-0 flex flex-col" style={{ "--i": 1 } as CSSProperties}>
              {entry.file.error ? (
                <BrokenFile entry={entry} />
              ) : mode === "view" ? (
                <Viewer entry={entry} onEdit={() => setMode("edit")} />
              ) : (
                <Editor entry={entry} info={info!} saving={saving} canSave={canSave} onSave={save}
                        onDict={(dict) => update((e) => ({ ...e, dict }))}
                        onName={(i, v) => update((e) => ({ ...e, names: e.names.map((n, j) => (j === i ? v : n)) }))}
                        onReset={() => update((e) => fresh(e.file))} />
              )}
            </section>
          )}
        </div>
      )}

      {dragging && (
        <div className="absolute inset-6 z-50 pointer-events-none grid place-items-center bg-glass/90 outline outline-2 outline-main -outline-offset-2 anim-toast"
             style={{ boxShadow: "inset 0 0 2.5rem rgb(var(--main) / .18)" }}>
          <div className="text-center">
            <IconUpload className="size-10 mx-auto text-mainLight" />
            <p className="mt-4 font-display font-extrabold text-2xl uppercase">Solte para abrir</p>
            <p className="mt-1 text-sm text-paper/60">Arquivos .ycd ou pastas (busca nas subpastas)</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({ loading, mode, onPick }: { loading: boolean; mode: Mode; onPick: () => void }) {
  return (
    <div className="anim-rise mt-6 flex-1 min-h-0 max-h-[30rem] grid place-items-center bg-glass/82 overflow-hidden" style={{ "--i": 2 } as CSSProperties}>
      {loading ? (
        <div className="flex flex-col items-center text-paper/50">
          <Spinner />
          <p className="font-display uppercase text-sm mt-4">Lendo arquivos…</p>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center px-6">
          <div className="icon-sq size-16">{mode === "view" ? <IconEye className="size-8" /> : <IconClip className="size-8" />}</div>
          <p className="mt-6 font-display font-extrabold text-2xl uppercase">
            {mode === "view" ? "Arraste um .ycd para visualizar" : "Arraste um .ycd para editar"}
          </p>
          <p className="mt-1.5 text-sm text-paper/60 max-w-md">
            {mode === "view"
              ? "Veja o dict e todas as animações do arquivo e copie os nomes prontos para usar no script."
              : "Renomeie o dict e as animações. O arquivo original fica intacto; uma cópia nova é salva na mesma pasta."}
            {" "}Pode soltar pastas inteiras.
          </p>
          <button className="btn btn-outline mt-6" onClick={onPick}>Procurar no computador</button>
        </div>
      )}
    </div>
  );
}

function FileList({ entries, selected, onSelect, onRemove, onClear }: {
  entries: Entry[]; selected: string | null;
  onSelect: (p: string) => void; onRemove: (p: string) => void; onClear: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const active = entries.findIndex((e) => e.file.path === selected);
  const indicator = useSlidingIndicator(list, active, [entries.length]);

  return (
    <section className="anim-rise min-h-0 flex flex-col" style={{ "--i": 0 } as CSSProperties}>
      <div className="flex items-center justify-between mb-3 h-7">
        <h2 className="section-title">Arquivos <span className="text-paper/40 tabular-nums">{entries.length}</span></h2>
        <button className="text-xs text-paper/50 hover:text-paper transition-colors duration-1 cursor-pointer" onClick={onClear}>Limpar lista</button>
      </div>
      <div ref={list} className="relative flex-1 min-h-0 scroll flex flex-col gap-[0.1875rem]">
        <div className="slide-indicator absolute left-0 top-0 bg-paper" style={indicator} />
        {entries.map((e, i) => {
          const sel = e.file.path === selected;
          const info = e.file.error ? null : analyze(e);
          return (
            <div key={e.file.path} data-slide-item onClick={() => onSelect(e.file.path)} title={e.file.path}
                 style={{ "--i": i } as CSSProperties}
                 className={`anim-item group relative z-10 shrink-0 flex items-center gap-3 py-2.5 px-3 cursor-pointer transition-colors duration-1
                             ${sel ? "text-ink" : "bg-glass/82 text-paper hover:brightness-110"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{e.file.name}</p>
                <p className={`text-xs truncate ${e.file.error ? "text-err" : sel ? "text-ink/60" : "text-paper/50"}`}>
                  {e.file.error ? "Erro de leitura" : `${e.file.anims.length} ${e.file.anims.length === 1 ? "anim" : "anims"}`}
                </p>
              </div>
              {info?.changed && (
                <span className={`tag border ${sel ? "border-ink/40 text-ink" : "border-main text-mainLight"}`}>Editado</span>
              )}
              <button onClick={(ev) => { ev.stopPropagation(); onRemove(e.file.path); }} aria-label="Tirar da lista"
                      className={`opacity-0 group-hover:opacity-100 transition-opacity duration-1 cursor-pointer ${sel ? "text-ink/60" : "text-paper/50"}`}>
                <IconX className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BrokenFile({ entry }: { entry: Entry }) {
  return (
    <div className="bg-glass/88 border border-paper/10 border-l-4 py-4 pl-5 pr-4 max-w-2xl"
         style={{ borderLeftColor: "rgb(var(--err))", backgroundImage: "linear-gradient(90deg, rgb(var(--err)/.12), transparent 55%)" }}>
      <div className="flex items-center gap-3">
        <IconAlert className="size-5 text-err" />
        <p className="font-display font-extrabold uppercase text-err">Não deu para ler este arquivo</p>
      </div>
      <p className="mt-2 text-sm text-paper/80">{entry.file.error}</p>
      <p className="mt-1 text-xs text-paper/50 break-all">{entry.file.path}</p>
    </div>
  );
}

function Editor({ entry, info, saving, canSave, onSave, onDict, onName, onReset }: {
  entry: Entry; info: ReturnType<typeof analyze>; saving: boolean; canSave: boolean;
  onSave: () => void; onDict: (v: string) => void; onName: (i: number, v: string) => void; onReset: () => void;
}) {
  const [query, setQuery, rows] = useAnimFilter(entry);
  const folder = entry.file.path.slice(0, entry.file.path.length - entry.file.name.length);

  return (
    <div className="min-h-0 flex-1 flex flex-col gap-5">
      {/* Dict */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3 min-h-7">
          <h2 className="section-title">Dicionário</h2>
          <span className="text-xs text-paper/50">Vira o nome do arquivo e o <b className="text-paper/80 font-semibold">dict</b> usado no script</span>
        </div>
        <input className={`input font-medium ${info.dictError ? "is-error" : ""}`} value={entry.dict} spellCheck={false}
               onChange={(e) => onDict(e.target.value)} placeholder={entry.file.dict} />
        {info.dictError && <p className="mt-1.5 text-xs text-err">O dict {info.dictError}</p>}
      </div>

      {/* Anims */}
      <div className="min-h-[7rem] flex-1 flex flex-col">
        <AnimHeader count={entry.file.anims.length} query={query} setQuery={setQuery} />
        <div className="flex-1 min-h-0 scroll flex flex-col gap-[0.1875rem]">
          {rows.map(({ orig, i }, k) => {
            const err = info.animErrors[i];
            const edited = entry.names[i] !== orig;
            return (
              <div key={orig} style={{ "--i": k } as CSSProperties}
                   className="anim-item shrink-0 grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-center gap-3 bg-glass/82 py-2 px-3">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-sm text-paper/70 truncate" title={orig}>{orig}</span>
                  {edited && <span className="tag border border-main text-mainLight shrink-0">Editado</span>}
                </div>
                <IconArrowRight className={`size-4 ${edited ? "text-paper" : "text-paper/25"}`} />
                <div>
                  <input className={`input h-8 bg-surface-1/80 ${err ? "is-error" : ""}`} value={entry.names[i]} placeholder={orig}
                         spellCheck={false} onChange={(e) => onName(i, e.target.value)} />
                  {err && <p className="mt-1 text-xs text-err">{err}</p>}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <p className="py-8 text-center font-display uppercase text-sm text-paper/50">Nenhuma anim com esse nome</p>}
        </div>
      </div>

      {/* Saída */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-6 gap-y-3 bg-glass/82 py-3 pl-4 pr-3">
        <div className="min-w-0 grow basis-[14rem]">
          <p className="text-xs text-paper/50">
            Será salvo como
            <span className="tabular-nums"> · {info.changed ? `${info.changedAnims} ${info.changedAnims === 1 ? "anim alterada" : "anims alteradas"}` : "sem alterações"}</span>
          </p>
          <p className="text-sm font-semibold truncate" title={folder + info.output}>{info.output}</p>
          <p className="text-xs text-paper/40 truncate" title={folder}>{folder}</p>
        </div>
        <div className="ml-auto flex gap-1.5">
        <button className="btn btn-outline" disabled={!info.changed || saving} onClick={onReset}>
          <IconUndo className="size-4" />Desfazer
        </button>
        <button className={`btn btn-primary min-w-[8.5rem] ${saving ? "pointer-events-none" : ""}`} disabled={!canSave} onClick={onSave}>
          {saving ? <Spinner className="size-5" /> : "Salvar cópia"}
        </button>
        </div>
      </div>
    </div>
  );
}

function useAnimFilter(entry: Entry) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entry.file.anims
      .map((orig, i) => ({ orig, i }))
      .filter((r) => !q || r.orig.toLowerCase().includes(q) || entry.names[r.i].toLowerCase().includes(q));
  }, [entry, query]);
  return [query, setQuery, rows] as const;
}

function AnimHeader({ count, query, setQuery, extra }: {
  count: number; query: string; setQuery: (v: string) => void; extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3 min-h-7">
      <h2 className="section-title">Animações <span className="text-paper/40 tabular-nums">{count}</span></h2>
      <div className="flex items-center gap-1.5 min-w-0">
        {count > 6 && (
          <label className="relative w-56 max-w-full">
            <IconSearch className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-paper/45" />
            <input className="input h-7 pl-9 text-xs" placeholder="Buscar anim" value={query}
                   onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
          </label>
        )}
        {extra}
      </div>
    </div>
  );
}

const lua = (dict: string, anim: string) => `"${dict}", "${anim}"`;

/** Modo Visualizar: só leitura, com cópia rápida dos nomes para o script. */
function Viewer({ entry, onEdit }: { entry: Entry; onEdit: () => void }) {
  const toast = useToast();
  const [query, setQuery, rows] = useAnimFilter(entry);
  const { dict, anims, path } = entry.file;
  const pad = String(anims.length).length;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ type: "info", title: "Copiado", message: what, time: 2000 });
    } catch (e) {
      toast({ type: "err", title: "Não foi possível copiar", message: errorText(e) });
    }
  };

  const copyBtn = (text: string, what: string, label: string) => (
    <button className="btn btn-outline btn-sm" onClick={() => copy(text, what)} title={text}>
      <IconCopy className="size-3.5" />{label}
    </button>
  );

  return (
    <div className="min-h-0 flex-1 flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3 min-h-7">
          <h2 className="section-title">Dicionário</h2>
          <span className="text-xs text-paper/40 truncate max-w-full" title={path}>{path}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-glass/82 py-2.5 pl-4 pr-3">
          <p className="min-w-0 grow basis-[10rem] text-lg font-semibold truncate" title={dict}>{dict}</p>
          {copyBtn(dict, `dict "${dict}"`, "Copiar dict")}
        </div>
      </div>

      <div className="min-h-[7rem] flex-1 flex flex-col">
        <AnimHeader count={anims.length} query={query} setQuery={setQuery}
                    extra={copyBtn(anims.map((a) => `{ ${lua(dict, a)} },`).join("\n"), `${anims.length} anims como tabela Lua`, "Copiar todas")} />
        <div className="flex-1 min-h-0 scroll flex flex-col gap-[0.1875rem]">
          {rows.map(({ orig, i }, k) => {
            const num = String(i + 1).padStart(Math.max(2, pad), "0");
            const lead = num.match(/^0*/)![0];
            return (
              <div key={orig} style={{ "--i": k } as CSSProperties}
                   className="anim-item shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 bg-glass/82 py-2 px-3">
                <span className="font-display font-bold text-sm tabular-nums text-paper/70 w-7 shrink-0">
                  <span className="text-paper/30">{lead}</span>{num.slice(lead.length)}
                </span>
                <span className="min-w-0 grow basis-[8rem] text-sm truncate" title={orig}>{orig}</span>
                <div className="flex gap-1.5 ml-auto">
                  {copyBtn(orig, `anim "${orig}"`, "Anim")}
                  {copyBtn(lua(dict, orig), "dict e anim, prontos para o TaskPlayAnim", "Dict + anim")}
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <p className="py-8 text-center font-display uppercase text-sm text-paper/50">Nenhuma anim com esse nome</p>}
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-x-6 gap-y-3 bg-glass/82 py-3 pl-4 pr-3">
        <p className="min-w-0 grow basis-[14rem] text-xs text-paper/50">
          Precisa trocar algum nome? No modo Editar você renomeia e salva uma cópia; o original não é alterado.
        </p>
        <button className="btn btn-primary ml-auto" onClick={onEdit}><IconEdit className="size-4" />Editar este arquivo</button>
      </div>
    </div>
  );
}
