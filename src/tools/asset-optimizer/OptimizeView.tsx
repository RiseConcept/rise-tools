import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { documentDir, join } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { errorText } from "../../core/tools";
import { useToast } from "../../ui/feedback";
import { IconAlert, IconArrowRight, IconCheck, IconReveal, IconUndo, IconX, Spinner } from "../../ui/icons";
import { Tabs, type TabItem } from "../../ui/layout";
import { MIB, call, fileName, percent, size, stamp, type Asset, type FilePlan, type FileResult, type Options } from "./format";

const SIZES: TabItem<string>[] = [
  { id: "512", label: "512" },
  { id: "1024", label: "1024" },
  { id: "2048", label: "2048" },
  { id: "0", label: "Livre" },
];
const MINS: TabItem<string>[] = [
  { id: "0", label: "Todos" },
  { id: "4", label: "4 MiB" },
  { id: "8", label: "8 MiB" },
  { id: "16", label: "16 MiB" },
];
/** Arquivos por chamada: o plano só lê; otimizar consome memória, então vai de poucos em poucos. */
const PLAN_CHUNK = 32;
const APPLY_CHUNK = 4;

type Run =
  | { phase: "idle" }
  | { phase: "running"; done: number; total: number; results: FileResult[]; backupDir: string }
  | { phase: "done"; results: FileResult[]; backupDir: string; canceled: boolean };

const backupsRoot = async () => join(await documentDir(), "RISE Tools", "backups");

export function OptimizeView({ root, assets, options, setOptions, onChanged }: {
  root: string; assets: Asset[]; options: Options; setOptions: (o: Options) => void; onChanged: () => void;
}) {
  const toast = useToast();
  const [minMiB, setMinMiB] = useState("0");
  const [plans, setPlans] = useState<FilePlan[] | null>(null);
  const [planning, setPlanning] = useState({ done: 0, total: 0 });
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const cancel = useRef(false);
  const busy = run.phase === "running";

  const candidates = useMemo(
    () => assets.filter((a) => a.kind === "ytd" && !a.error && a.physical >= Number(minMiB) * MIB).map((a) => a.path),
    [assets, minMiB],
  );

  // simulação: exata (mesma conta da gravação), sem tocar em nada
  useEffect(() => {
    let live = true;
    setPlans(null);
    setPlanning({ done: 0, total: candidates.length });
    const t = setTimeout(async () => {
      const out: FilePlan[] = [];
      for (let i = 0; i < candidates.length && live; i += PLAN_CHUNK) {
        try {
          const { files } = await call<{ files: FilePlan[] }>("plan", { paths: candidates.slice(i, i + PLAN_CHUNK), options });
          out.push(...files);
        } catch (e) {
          if (live) toast({ type: "err", title: "Erro na simulação", message: errorText(e) });
          return;
        }
        if (live) setPlanning({ done: Math.min(i + PLAN_CHUNK, candidates.length), total: candidates.length });
      }
      if (live) setPlans(out);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [candidates, options, toast]);

  const changed = useMemo(
    () => (plans ?? []).filter((p) => !p.error && p.physicalAfter < p.physical).sort((a, b) => b.physical - b.physicalAfter - (a.physical - a.physicalAfter)),
    [plans],
  );
  const kept = (plans ?? []).filter((p) => p.notes.some((n) => n.includes("não reconhece")) || p.error);
  const before = changed.reduce((s, p) => s + p.physical, 0);
  const after = changed.reduce((s, p) => s + p.physicalAfter, 0);

  const apply = async () => {
    const paths = changed.map((p) => p.path);
    if (!paths.length) return;
    cancel.current = false;
    let backupDir: string;
    try {
      backupDir = await join(await backupsRoot(), stamp());
    } catch (e) {
      toast({ type: "err", title: "Não achei a pasta Documentos", message: errorText(e) });
      return;
    }
    const results: FileResult[] = [];
    setRun({ phase: "running", done: 0, total: paths.length, results, backupDir });
    for (let i = 0; i < paths.length; i += APPLY_CHUNK) {
      if (cancel.current) break;
      try {
        const { files } = await call<{ files: FileResult[] }>("optimize", { paths: paths.slice(i, i + APPLY_CHUNK), options, root, backupDir });
        results.push(...files);
      } catch (e) {
        results.push(...paths.slice(i, i + APPLY_CHUNK).map((path) => ({
          path, status: "error" as const, error: errorText(e), sizeBefore: 0, sizeAfter: 0, physicalBefore: 0, physicalAfter: 0,
        })));
      }
      setRun({ phase: "running", done: results.length, total: paths.length, results: [...results], backupDir });
    }
    const ok = results.filter((r) => r.status === "optimized");
    const bad = results.filter((r) => r.status === "error").length;
    setRun({ phase: "done", results, backupDir, canceled: cancel.current });
    toast({
      type: bad ? "warn" : "ok",
      title: ok.length ? `${ok.length} ${ok.length === 1 ? "arquivo otimizado" : "arquivos otimizados"}` : "Nenhum arquivo alterado",
      message: bad ? `${bad} com erro: o original deles não foi alterado.` : "Limpe a pasta cache do servidor antes de reiniciar.",
      action: ok.length ? { label: "Mostrar backup", run: () => revealItemInDir(backupDir) } : undefined,
    });
    if (ok.length) onChanged();
  };

  const restore = async (backupDir: string) => {
    try {
      const r = await call<{ restored: number; errors: string[] }>("restore", { backupDir });
      toast({
        type: r.errors.length ? "warn" : "ok",
        title: `${r.restored} ${r.restored === 1 ? "arquivo restaurado" : "arquivos restaurados"}`,
        message: r.errors.length ? `${r.errors.length} não voltaram: ${r.errors[0]}` : "Os originais estão de volta no lugar.",
      });
      setRun({ phase: "idle" });
      onChanged();
    } catch (e) {
      toast({ type: "err", title: "Não consegui restaurar", message: errorText(e) });
    }
  };

  const pickBackup = async () => {
    const r = await openDialog({ directory: true, defaultPath: await backupsRoot().catch(() => undefined), title: "Pasta do backup" });
    if (typeof r === "string") restore(r);
  };

  const set = (p: Partial<Options>) => setOptions({ ...options, ...p });

  return (
    <div className="anim-rise mt-6 flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)] grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)] gap-5 xl:gap-8"
         style={{ "--i": 2 } as CSSProperties}>
      {/* ---------- Opções ---------- */}
      <aside className="min-h-0 scroll flex flex-col gap-5">
        <Group title="Tamanho máximo" hint="Texturas maiores são reduzidas (Livre: não reduz). Com mipmaps, a redução não perde nada: só descarta o nível maior.">
          <Tabs items={SIZES} active={String(options.maxSize)} onChange={(v) => !busy && set({ maxSize: Number(v) })} />
        </Group>
        <Group title="Compressão">
          <Toggle checked={options.bc3ToBc1} disabled={busy} onChange={(v) => set({ bc3ToBc1: v })}
                  label="DXT5 sem transparência → DXT1" hint="Sem perda de qualidade. Usa metade da memória." />
          <Toggle checked={options.compressRaw} disabled={busy} onChange={(v) => set({ compressRaw: v })}
                  label="Comprimir texturas sem compressão" hint="A8R8G8B8 vira DXT1 ou DXT5. Usa de 4 a 8 vezes menos memória." />
        </Group>
        <Group title="Só arquivos a partir de" hint="Use para mexer só nos que pesam mais.">
          <Tabs items={MINS} active={minMiB} onChange={(v) => !busy && setMinMiB(v)} />
        </Group>
        <p className="text-xs text-paper/45 leading-relaxed">
          Normal maps (nomes terminados em _n) não mudam de formato. Dados que nenhuma textura usa, deixados por edições
          antigas, são removidos.
        </p>
        <button className="mt-auto text-left text-xs text-paper/50 hover:text-paper transition-colors duration-1 cursor-pointer" onClick={pickBackup}>
          Restaurar um backup antigo…
        </button>
      </aside>

      {/* ---------- Plano / resultado ---------- */}
      <section className="min-h-0 min-w-0 flex flex-col">
        {run.phase === "idle" ? (
          <>
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3 min-h-7">
              <h2 className="section-title">Simulação</h2>
              <p className="text-xs text-paper/50 tabular-nums">
                {plans ? `${candidates.length} .ytd analisados` : `Analisando ${planning.done} de ${planning.total}`}
              </p>
            </div>
            {!plans ? (
              <Progress done={planning.done} total={planning.total} label="Lendo as texturas" />
            ) : changed.length === 0 ? (
              <Empty>
                {candidates.length === 0 ? "Nenhum .ytd com esse filtro." : "Nada a otimizar com essas opções. As texturas já estão dentro do limite."}
              </Empty>
            ) : (
              <>
                <div className="shrink-0 grid grid-cols-3 gap-1.5 mb-4">
                  <Big label="Arquivos que mudam" value={String(changed.length)} />
                  <Big label="Memória física" value={`${size(before)} → ${size(after)}`} />
                  <Big label="Economia" value={`${size(before - after)} · ${percent(before, after)}`} accent />
                </div>
                <div className="flex-1 min-h-[6rem] scroll flex flex-col gap-[0.1875rem]">
                  {changed.map((p) => <PlanRow key={p.path} p={p} />)}
                </div>
              </>
            )}
            <div className="shrink-0 mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 bg-glass/82 py-3 pl-4 pr-3">
              <p className="min-w-0 grow basis-[16rem] text-xs text-paper/50">
                Os originais vão para <span className="text-paper/80">Documentos\RISE Tools\backups</span> antes de cada troca.
                {kept.length > 0 && ` ${kept.length} ${kept.length === 1 ? "arquivo será mantido" : "arquivos serão mantidos"} por segurança.`}
              </p>
              <button className="btn btn-focus ml-auto" disabled={!plans || changed.length === 0} onClick={apply}>
                Otimizar {changed.length || ""} {changed.length === 1 ? "arquivo" : "arquivos"}
              </button>
            </div>
          </>
        ) : (
          <Result run={run} onCancel={() => (cancel.current = true)} onRestore={restore} onClose={() => setRun({ phase: "idle" })} />
        )}
      </section>
    </div>
  );
}

function PlanRow({ p }: { p: FilePlan }) {
  const parts = [
    p.resized && `${p.resized} ${p.resized === 1 ? "reduzida" : "reduzidas"}`,
    p.converted && `${p.converted} ${p.converted === 1 ? "convertida" : "convertidas"}`,
    p.orphan > 0 && `${size(p.orphan)} de dados sem uso`,
  ].filter(Boolean);
  return (
    <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 py-2 px-3 bg-glass/82" title={p.path}>
      <div className="min-w-0 grow basis-[12rem]">
        <p className="text-sm font-semibold truncate">{fileName(p.path)}</p>
        <p className="text-xs text-paper/50 truncate">
          {parts.join(" · ")}
          {p.notes.length > 0 && <span className="text-warn"> · {p.notes[0]}</span>}
        </p>
      </div>
      <div className="flex items-center gap-2 text-xs tabular-nums">
        <span className="text-paper/60">{size(p.physical)}</span>
        <IconArrowRight className="size-3.5 text-mainLight" />
        <span className="font-semibold">{size(p.physicalAfter)}</span>
        <span className="w-10 text-right text-ok">−{percent(p.physical, p.physicalAfter)}</span>
      </div>
    </div>
  );
}

function Result({ run, onCancel, onRestore, onClose }: {
  run: Exclude<Run, { phase: "idle" }>; onCancel: () => void; onRestore: (dir: string) => void; onClose: () => void;
}) {
  const ok = run.results.filter((r) => r.status === "optimized");
  const bad = run.results.filter((r) => r.status === "error");
  const mem = ok.reduce((s, r) => s + r.physicalBefore - r.physicalAfter, 0);
  const disk = ok.reduce((s, r) => s + r.sizeBefore - r.sizeAfter, 0);
  const done = run.phase === "done";

  return (
    <>
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3 min-h-7">
        <h2 className="section-title">{done ? (run.canceled ? "Interrompido" : "Concluído") : "Otimizando"}</h2>
        <button className="text-xs text-paper/50 hover:text-paper transition-colors duration-1 cursor-pointer inline-flex items-center gap-1.5"
                onClick={() => revealItemInDir(run.backupDir)}>
          <IconReveal className="size-3.5" />Pasta do backup
        </button>
      </div>
      {!done && <Progress done={run.done} total={run.total} label={`Otimizando ${run.done} de ${run.total}`} />}
      {done && (
        <div className="shrink-0 grid grid-cols-3 gap-1.5 mb-4">
          <Big label="Otimizados" value={String(ok.length)} />
          <Big label="Memória liberada" value={size(mem)} accent />
          <Big label="Disco liberado" value={size(Math.max(0, disk))} />
        </div>
      )}
      <div className="flex-1 min-h-[6rem] scroll flex flex-col gap-[0.1875rem]">
        {[...bad, ...run.results.filter((r) => r.status !== "error")].map((r) => (
          <div key={r.path} title={r.path} className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 py-2 px-3 bg-glass/82">
            {r.status === "error" ? <IconAlert className="size-4 text-err shrink-0" /> : r.status === "optimized" ? <IconCheck className="size-4 text-ok shrink-0" /> : <IconX className="size-4 text-paper/40 shrink-0" />}
            <div className="min-w-0 grow basis-[12rem]">
              <p className="text-sm font-semibold truncate">{fileName(r.path)}</p>
              {r.error && <p className="text-xs text-err">{r.error}</p>}
              {r.status === "unchanged" && <p className="text-xs text-paper/50">Sem mudança</p>}
            </div>
            {r.status === "optimized" && (
              <span className="text-xs tabular-nums">
                <span className="text-paper/60">{size(r.physicalBefore)}</span> → <span className="font-semibold">{size(r.physicalAfter)}</span>
                <span className="text-paper/40"> · disco {size(r.sizeBefore)} → {size(r.sizeAfter)}</span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="shrink-0 mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 bg-glass/82 py-3 pl-4 pr-3">
        <p className="min-w-0 grow basis-[16rem] text-xs text-paper/50">
          {done
            ? "Limpe a pasta cache do servidor antes de reiniciar, para o FiveM carregar os arquivos novos."
            : "Cada arquivo é conferido e copiado para o backup antes de ser trocado."}
        </p>
        <div className="ml-auto flex gap-1.5">
          {done ? (
            <>
              {ok.length > 0 && (
                <button className="btn btn-secondary" onClick={() => onRestore(run.backupDir)}><IconUndo className="size-4" />Desfazer</button>
              )}
              <button className="btn btn-primary" onClick={onClose}>Voltar</button>
            </>
          ) : (
            <button className="btn btn-danger" onClick={onCancel}>Parar</button>
          )}
        </div>
      </div>
    </>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[0.6875rem] font-display font-bold uppercase text-paper/45">{title}</h3>
      {children}
      {hint && <p className="text-xs text-paper/45 leading-relaxed">{hint}</p>}
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

function Big({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-glass/82 py-2.5 px-3 min-w-0">
      <p className="text-[0.6875rem] font-display font-bold uppercase text-paper/45">{label}</p>
      <p className={`mt-1 font-display font-extrabold text-lg leading-tight tabular-nums truncate ${accent ? "text-ok" : "text-paper"}`}>{value}</p>
    </div>
  );
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div className="shrink-0 mb-4">
      <div className="flex items-center gap-3 text-xs text-paper/60 mb-2"><Spinner className="size-4" />{label}</div>
      <div className="h-1 bg-paper/10 overflow-hidden">
        <div className="h-full bg-main origin-left transition-transform duration-2" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex-1 min-h-[6rem] grid place-items-center bg-glass/60 text-sm text-paper/55 text-center px-6">{children}</div>;
}
