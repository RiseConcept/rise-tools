import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { documentDir, join } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { errorText, toolClient } from "../../core/tools";
import { useHints, useToast } from "../../ui/feedback";
import { IconAlert, IconArrowRight, IconCheck, IconFolder, IconRename, IconReveal, IconUndo, IconUpload, Spinner } from "../../ui/icons";
import { Editorial, Tabs, type TabItem } from "../../ui/layout";

const call = toolClient("asset-renamer");

type Mode = "replace" | "prefix" | "suffix";
const MODES: TabItem<Mode>[] = [
  { id: "replace", label: "Substituir" },
  { id: "prefix", label: "Prefixo" },
  { id: "suffix", label: "Sufixo" },
];
const TEXT_LABEL: Record<Mode, string> = { replace: "Trocar por", prefix: "Prefixo", suffix: "Sufixo" };
const TEXT_HINT: Record<Mode, string> = { replace: "moto", prefix: "loja_", suffix: "_v2" };

type Section = "files" | "content" | "names" | "warnings";

interface NameChange { from: string; to: string; fromHash: string; toHash: string }
interface FileRename { from: string; to: string; conflict: string | null }
interface Sample { line: number; before: string; after: string }
interface FileEdit { path: string; kind: "text" | "hash"; count: number; samples: Sample[]; names: string[] }
interface Skipped { path: string; reason: string }
interface Plan {
  root: string; totalFiles: number; names: NameChange[]; renames: FileRename[]; edits: FileEdit[]; skipped: Skipped[]; conflicts: number;
}
interface Applied { renamed: number; edited: number; backupDir: string }

const stamp = (d = new Date()) => {
  const n = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())}_${n(d.getHours())}-${n(d.getMinutes())}-${n(d.getSeconds())}`;
};
const backupsRoot = async () => join(await documentDir(), "RISE Tools", "backups");
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

export default function AssetRenamer() {
  const toast = useToast();
  const [root, setRoot] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [mode, setMode] = useState<Mode>("replace");
  const [text, setText] = useState("");
  const [scripts, setScripts] = useState(false);
  const [partial, setPartial] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<Applied | null>(null);
  const [dragging, setDragging] = useState(false);
  const [version, setVersion] = useState(0); // força nova prévia depois de gravar/desfazer

  const pickFolder = useCallback(async () => {
    const r = await openDialog({ directory: true, multiple: false, title: "Pasta do resource" });
    if (typeof r === "string") {
      setRoot(r);
      setDone(null);
    }
  }, []);

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
          if (p.paths[0]) {
            setRoot(p.paths[0]);
            setDone(null);
          }
        }
      })
      .then((fn) => (dead ? fn() : (off = fn)));
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  // prévia: recalculada a cada mudança, sem tocar em nada
  useEffect(() => {
    setError(null);
    if (!root || !find.trim() || !text.trim()) {
      setPlan(null);
      setPlanning(false);
      return;
    }
    let live = true;
    setPlanning(true);
    const t = setTimeout(() => {
      call<Plan>("plan", { root, find, mode, text, partial, scripts })
        .then((p) => live && setPlan(p))
        .catch((e) => {
          if (!live) return;
          setPlan(null);
          setError(errorText(e));
        })
        .finally(() => live && setPlanning(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [root, find, mode, text, partial, scripts, version]);

  // arquivos distintos tocados (um arquivo pode ser renomeado e editado ao mesmo tempo)
  const total = plan ? new Set([...plan.renames.map((r) => r.from), ...plan.edits.map((e) => e.path)]).size : 0;
  const canApply = !!plan && total > 0 && plan.conflicts === 0 && !planning && !applying;

  const apply = useCallback(async () => {
    if (!canApply || !root) return;
    setApplying(true);
    try {
      const backupDir = await join(await backupsRoot(), `renamer_${stamp()}`);
      const r = await call<Applied>("apply", { root, find, mode, text, partial, scripts, backupDir });
      setDone(r);
      toast({
        type: "ok",
        title: "Renomeado",
        message: `${plural(r.renamed, "arquivo renomeado", "arquivos renomeados")}, ${plural(r.edited, "editado", "editados")}.`,
        action: { label: "Mostrar backup", run: () => revealItemInDir(r.backupDir) },
      });
    } catch (e) {
      toast({ type: "err", title: "Não renomeei", message: errorText(e) });
    } finally {
      setApplying(false);
      setVersion((v) => v + 1);
    }
  }, [canApply, root, find, mode, text, partial, scripts, toast]);

  const restore = async (backupDir: string) => {
    try {
      const r = await call<{ restored: number }>("restore", { backupDir });
      toast({ type: "ok", title: "Desfeito", message: `${plural(r.restored, "arquivo voltou", "arquivos voltaram")} ao original.` });
      setDone(null);
    } catch (e) {
      toast({ type: "err", title: "Não consegui desfazer", message: errorText(e) });
    } finally {
      setVersion((v) => v + 1);
    }
  };

  const pickBackup = async () => {
    const r = await openDialog({ directory: true, defaultPath: await backupsRoot().catch(() => undefined), title: "Pasta do backup (renamer_…)" });
    if (typeof r === "string") restore(r);
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "o") {
        e.preventDefault();
        pickFolder();
      } else if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [pickFolder, apply]);

  useHints([
    { keys: ["Ctrl", "O"], label: "Escolher pasta" },
    ...(canApply ? [{ keys: ["Ctrl", "Enter"], label: "Renomear" }] : []),
  ]);

  const example = plan?.names[0];

  return (
    <div className="h-full flex flex-col px-6 xl:px-10 pt-8 xl:pt-10 pb-24 relative">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <Editorial title="Asset Renamer" />
        <div className="anim-rise flex flex-wrap gap-1.5" style={{ "--i": 0 } as CSSProperties}>
          <button className="btn btn-primary" onClick={pickFolder}><IconFolder className="size-4" />{root ? "Trocar pasta" : "Escolher pasta"}</button>
        </div>
      </div>

      {!root ? (
        <DropZone onPick={pickFolder} />
      ) : (
        <div className="anim-rise mt-6 flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)] grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)] gap-5 xl:gap-8"
             style={{ "--i": 1 } as CSSProperties}>
          {/* ---------- Regra ---------- */}
          <aside className="min-h-0 scroll flex flex-col gap-5">
            <Field label="Pasta">
              <p className="text-xs text-paper/70 break-all" title={root}>{root}</p>
            </Field>
            <Field label="Procurar">
              <input className={`input h-9 text-sm ${error?.startsWith("texto a procurar") ? "is-error" : ""}`} value={find} placeholder="carro"
                     onChange={(e) => setFind(e.target.value)} spellCheck={false} autoFocus disabled={applying} />
            </Field>
            <Field label="Modo">
              <Tabs items={MODES} active={mode} onChange={(m) => !applying && setMode(m)} />
            </Field>
            <Field label={TEXT_LABEL[mode]}>
              <input className={`input h-9 text-sm ${error?.startsWith("texto novo") ? "is-error" : ""}`} value={text} placeholder={TEXT_HINT[mode]}
                     onChange={(e) => setText(e.target.value)} spellCheck={false} disabled={applying} />
            </Field>
            {error ? (
              <p className="-mt-2 flex items-start gap-2 text-xs text-err"><IconAlert className="size-4 shrink-0" />{error}</p>
            ) : example ? (
              <p className="-mt-2 text-xs text-paper/60 break-all">
                Ex.: <span className="text-paper/80">{example.from}</span> <IconArrowRight className="inline size-3 text-mainLight" />{" "}
                <span className="text-paper font-semibold">{example.to}</span>
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Toggle checked={scripts} onChange={setScripts} disabled={applying} label="Atualizar scripts (.lua, .js)"
                      hint="Desligado, os scripts só aparecem nos avisos. O fxmanifest é sempre atualizado." />
              <Toggle checked={partial} onChange={setPartial} disabled={applying} label="Também dentro de palavras"
                      hint={`Ligado, "${find || "car"}" também acha "s${find || "car"}s". Use com cuidado.`} />
            </div>
            <p className="text-xs text-paper/45 leading-relaxed">
              Sem diferenciar maiúsculas. Por padrão o texto só é achado como parte separada do nome
              (entre _, -, +, ., / ou nas pontas). A pasta cache é ignorada.
            </p>
            <button className="mt-auto text-left text-xs text-paper/50 hover:text-paper transition-colors duration-1 cursor-pointer" onClick={pickBackup}>
              Desfazer uma renomeação antiga…
            </button>
          </aside>

          {/* ---------- Prévia / resultado ---------- */}
          <section className="min-h-0 min-w-0 flex flex-col">
            {done ? (
              <Done r={done} onUndo={() => restore(done.backupDir)} onBack={() => setDone(null)} />
            ) : !plan ? (
              <Empty>
                {planning ? (
                  <span className="flex items-center gap-3"><Spinner className="size-5" />Montando a prévia</span>
                ) : !find.trim() ? (
                  "Digite o texto a procurar para ver tudo o que muda. Nada é alterado até você confirmar."
                ) : !text.trim() ? (
                  `Digite ${mode === "replace" ? "o texto novo" : mode === "prefix" ? "o prefixo" : "o sufixo"}.`
                ) : (
                  "Corrija o campo destacado."
                )}
              </Empty>
            ) : (
              <Preview plan={plan} planning={planning} />
            )}
            {!done && (
              <div className="shrink-0 mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 bg-glass/82 py-3 pl-4 pr-3">
                <p className="min-w-0 grow basis-[16rem] text-xs text-paper/50">
                  {plan && plan.conflicts > 0
                    ? <span className="text-err">{plural(plan.conflicts, "conflito", "conflitos")} de nome. Resolva antes de renomear.</span>
                    : <>Tudo o que muda vai antes para <span className="text-paper/80">Documentos\RISE Tools\backups</span>. Se algo falhar no meio, é desfeito sozinho.</>}
                </p>
                <button className="btn btn-focus ml-auto" disabled={!canApply} onClick={apply}>
                  {applying ? <Spinner className="size-5" /> : <IconRename className="size-4" />}
                  Renomear{total ? ` ${plural(total, "arquivo", "arquivos")}` : ""}
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {dragging && (
        <div className="absolute inset-6 z-50 pointer-events-none grid place-items-center bg-glass/90 outline outline-2 outline-main -outline-offset-2 anim-toast"
             style={{ boxShadow: "inset 0 0 2.5rem rgb(var(--main) / .18)" }}>
          <div className="text-center">
            <IconUpload className="size-10 mx-auto text-mainLight" />
            <p className="mt-4 font-display font-extrabold text-2xl uppercase">Solte a pasta do resource</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Preview({ plan, planning }: { plan: Plan; planning: boolean }) {
  const [section, setSection] = useState<Section>("files");
  const items: TabItem<Section>[] = [
    { id: "files", label: `Arquivos ${plan.renames.length}` },
    { id: "content", label: `Conteúdo ${plan.edits.length}` },
    { id: "names", label: `Nomes ${plan.names.length}` },
    { id: "warnings", label: `Avisos ${plan.skipped.length}` },
  ];
  const nothing = plan.renames.length + plan.edits.length === 0;

  return (
    <>
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3 min-h-7">
        <Tabs items={items} active={section} onChange={setSection} />
        <span className="text-xs text-paper/50 tabular-nums flex items-center gap-2">
          {planning && <Spinner className="size-4" />}
          {plural(plan.totalFiles, "arquivo lido", "arquivos lidos")}
        </span>
      </div>
      {nothing ? (
        <Empty>Nenhum arquivo ou referência com esse nome nessa pasta.</Empty>
      ) : (
        <div className="flex-1 min-h-0 scroll flex flex-col gap-[0.1875rem]">
          {section === "files" && (plan.renames.length ? [...plan.renames].sort((a, b) => Number(!!b.conflict) - Number(!!a.conflict)).map((r) => (
            <Row key={r.from} tone={r.conflict ? "err" : undefined}>
              <p className="text-xs text-paper/55 truncate" title={r.from}>{r.from}</p>
              <p className="text-sm font-semibold truncate flex items-center gap-1.5" title={r.to}>
                <IconArrowRight className="size-3.5 shrink-0 text-mainLight" />{r.to}
              </p>
              {r.conflict && <p className="text-xs text-err mt-0.5">{r.conflict}</p>}
            </Row>
          )) : <Note>Nenhum nome de arquivo muda; só o conteúdo.</Note>)}

          {section === "content" && (plan.edits.length ? plan.edits.map((e) => (
            <Row key={e.path}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold truncate" title={e.path}>{e.path}</p>
                <span className="tag border border-paper/20 text-paper/70 shrink-0">{e.kind === "hash" ? "hash" : "texto"} · {e.count}</span>
              </div>
              {e.kind === "hash" ? (
                <p className="text-xs text-paper/55 mt-1 break-all">{e.names.join(", ")}</p>
              ) : (
                <div className="mt-1.5 flex flex-col gap-1 font-mono text-[0.75rem] leading-5">
                  {e.samples.map((s) => (
                    <div key={s.line} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-2">
                      <span className="text-paper/30 text-right">{s.line}</span>
                      <span className="truncate text-err/80" title={s.before}>− {s.before}</span>
                      <span />
                      <span className="truncate text-ok" title={s.after}>+ {s.after}</span>
                    </div>
                  ))}
                  {e.count > e.samples.length && <span className="text-paper/40 pl-12">… e mais {e.count - e.samples.length}</span>}
                </div>
              )}
            </Row>
          )) : <Note>Nenhum conteúdo de arquivo muda.</Note>)}

          {section === "names" && plan.names.map((n) => (
            <Row key={n.from}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-sm">
                <span className="truncate" title={n.from}>{n.from}</span>
                <IconArrowRight className="size-3.5 text-mainLight" />
                <span className="truncate font-semibold" title={n.to}>{n.to}</span>
              </div>
              <p className="text-[0.6875rem] text-paper/35 font-mono">{n.fromHash} → {n.toHash}</p>
            </Row>
          ))}

          {section === "warnings" && (plan.skipped.length ? plan.skipped.map((s) => (
            <Row key={s.path} tone="warn">
              <p className="text-sm font-semibold truncate" title={s.path}>{s.path}</p>
              <p className="text-xs text-paper/60">{s.reason}</p>
            </Row>
          )) : <Note>Nenhum aviso.</Note>)}
        </div>
      )}
    </>
  );
}

function Done({ r, onUndo, onBack }: { r: Applied; onUndo: () => void; onBack: () => void }) {
  return (
    <>
      <div className="flex-1 min-h-0 grid place-items-center bg-glass/60 px-6">
        <div className="text-center max-w-md">
          <div className="icon-sq size-14 mx-auto"><IconCheck className="size-7 text-ok" /></div>
          <p className="mt-5 font-display font-extrabold text-2xl uppercase">Renomeado</p>
          <p className="mt-1.5 text-sm text-paper/60">
            {plural(r.renamed, "arquivo renomeado", "arquivos renomeados")} e {plural(r.edited, "editado", "editados")}.
            Reinicie o resource (ou o servidor) para o FiveM carregar os nomes novos.
          </p>
        </div>
      </div>
      <div className="shrink-0 mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 bg-glass/82 py-3 pl-4 pr-3">
        <button className="text-xs text-paper/50 hover:text-paper transition-colors duration-1 cursor-pointer inline-flex items-center gap-1.5"
                onClick={() => revealItemInDir(r.backupDir)}>
          <IconReveal className="size-3.5" />Pasta do backup
        </button>
        <div className="ml-auto flex gap-1.5">
          <button className="btn btn-secondary" onClick={onUndo}><IconUndo className="size-4" />Desfazer</button>
          <button className="btn btn-primary" onClick={onBack}>Voltar</button>
        </div>
      </div>
    </>
  );
}

function DropZone({ onPick }: { onPick: () => void }) {
  return (
    <div className="anim-rise mt-6 flex-1 min-h-0 max-h-[30rem] grid place-items-center bg-glass/82 overflow-hidden" style={{ "--i": 2 } as CSSProperties}>
      <div className="flex flex-col items-center text-center px-6">
        <div className="icon-sq size-16"><IconRename className="size-8" /></div>
        <p className="mt-6 font-display font-extrabold text-2xl uppercase">Arraste a pasta do resource</p>
        <p className="mt-1.5 text-sm text-paper/60 max-w-lg">
          Troca um nome nos arquivos, no fxmanifest, nos .meta e dentro dos .ytyp e .ymap, tudo junto para não quebrar as referências.
          Você vê a prévia completa antes de confirmar.
        </p>
        <button className="btn btn-primary mt-6" onClick={onPick}><IconFolder className="size-4" />Escolher pasta</button>
      </div>
    </div>
  );
}

const TONES = { err: "border-l-2 border-err", warn: "border-l-2 border-warn" } as const;

function Row({ children, tone }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <div className={`shrink-0 min-w-0 bg-glass/82 py-2 px-3 ${tone ? TONES[tone] : ""}`}>{children}</div>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-paper/50">{children}</p>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex-1 min-h-[6rem] grid place-items-center bg-glass/60 text-sm text-paper/55 text-center px-6">{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[0.6875rem] font-display font-bold uppercase text-paper/45">{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean;
}) {
  return (
    <button role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
            className="flex items-start gap-3 text-left bg-glass/82 py-2.5 px-3 cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
      <span className={`mt-0.5 shrink-0 relative w-8 h-4 transition-colors duration-1 ${checked ? "bg-main" : "bg-paper/15"}`}>
        <span className={`absolute top-0.5 left-0.5 size-3 transition-transform duration-1 ${checked ? "translate-x-4 bg-ink" : "bg-paper/70"}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-paper/50 mt-0.5">{hint}</span>
      </span>
    </button>
  );
}
