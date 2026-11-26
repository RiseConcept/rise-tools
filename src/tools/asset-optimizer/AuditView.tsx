import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { errorText } from "../../core/tools";
import { IconAlert, IconArrowRight, IconChevron, IconSearch, Spinner } from "../../ui/icons";
import { Tabs, type TabItem } from "../../ui/layout";
import { LIMIT, call, size, texLabel, weight, type Asset, type Inspect, type Options } from "./format";

type Kind = "all" | "ytd" | "ydr" | "yft" | "ydd";
const KINDS: TabItem<Kind>[] = [
  { id: "all", label: "Todos" },
  { id: "ytd", label: "YTD" },
  { id: "ydr", label: "YDR" },
  { id: "yft", label: "YFT" },
  { id: "ydd", label: "YDD" },
];
type Sort = "physical" | "file" | "name";
const SORTS: TabItem<Sort>[] = [
  { id: "physical", label: "Memória" },
  { id: "file", label: "Arquivo" },
  { id: "name", label: "Nome" },
];
const PAGE = 200;

const TEXT = { err: "text-err", warn: "text-warn", ok: "text-paper" } as const;
const BAR = { err: "bg-err", warn: "bg-warn", ok: "bg-main" } as const;

export function AuditView({ assets, options, onOptimize }: { assets: Asset[]; options: Options; onOptimize: () => void }) {
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("physical");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const ok = assets.filter((a) => !a.error);
  const total = ok.reduce((s, a) => s + a.physical, 0);
  const over = ok.filter((a) => a.physical > LIMIT);
  const disk = assets.reduce((s, a) => s + a.fileSize, 0);
  const ytds = ok.filter((a) => a.kind === "ytd").length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = assets.filter((a) => (kind === "all" || a.kind === kind) && (!q || (a.dir + "/" + a.name).toLowerCase().includes(q)));
    const by = { physical: (a: Asset) => -a.physical, file: (a: Asset) => -a.fileSize, name: () => 0 }[sort];
    return list.sort((a, b) => by(a) - by(b) || a.name.localeCompare(b.name));
  }, [assets, kind, sort, query]);
  useEffect(() => setShown(PAGE), [kind, sort, query]);

  const scale = Math.max(LIMIT, ...ok.map((a) => a.physical));

  return (
    <div className="anim-rise mt-6 flex-1 min-h-0 flex flex-col gap-5" style={{ "--i": 2 } as CSSProperties}>
      <div className="shrink-0 grid grid-cols-2 lg:grid-cols-4 gap-1.5">
        <Stat label="Assets" value={assets.length.toLocaleString("pt-BR")} sub={`${ytds} .ytd`} />
        <Stat label="Memória física" value={size(total)} sub="soma de todos" />
        <Stat label="Acima de 16 MiB" value={String(over.length)} sub={over.length ? "o FiveM avisa: oversized asset" : "nenhum aviso do FiveM"}
              tone={over.length ? "err" : "ok"} />
        <Stat label="No disco" value={size(disk)} sub="arquivos compactados" />
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="relative w-60 max-w-full">
          <IconSearch className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-paper/45" />
          <input className="input h-7 pl-9 text-xs" placeholder="Buscar por nome ou pasta" value={query}
                 onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        </label>
        <Tabs items={KINDS} active={kind} onChange={setKind} />
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-paper/50">Ordenar</span>
          <Tabs items={SORTS} active={sort} onChange={setSort} />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="shrink-0 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_10rem_5rem] gap-4 px-3 pb-2 mr-3 text-[0.6875rem] font-display font-bold uppercase text-paper/45">
          <span>Asset</span><span>Pasta</span><span>Memória física</span><span className="text-right">Arquivo</span>
        </div>
        <div className="flex-1 min-h-0 scroll flex flex-col gap-[0.1875rem]">
          {rows.slice(0, shown).map((a) => {
            const w = weight(a.physical);
            const expandable = a.kind === "ytd" && !a.error;
            const isOpen = open === a.path;
            return (
              <div key={a.path} className="shrink-0">
                <div onClick={() => expandable && setOpen(isOpen ? null : a.path)} title={a.path}
                     className={`grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_10rem_5rem] gap-4 items-center py-2 px-3 bg-glass/82
                                 ${expandable ? "cursor-pointer hover:brightness-110" : ""} ${isOpen ? "outline outline-1 outline-paper/25 -outline-offset-1" : ""}`}>
                  <div className="min-w-0 flex items-center gap-2">
                    <IconChevron className={`size-3.5 shrink-0 transition-transform duration-1 ${expandable ? "text-paper/50" : "opacity-0"} ${isOpen ? "rotate-90" : ""}`} />
                    <span className="min-w-0 text-sm font-semibold truncate">{a.name}</span>
                  </div>
                  <span className="min-w-0 text-xs text-paper/50 truncate">{a.dir || "—"}</span>
                  {a.error ? (
                    <span className="text-xs text-err truncate" title={a.error}>Não abriu</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1 bg-paper/10 overflow-hidden">
                        <div className={`h-full origin-left ${BAR[w]}`} style={{ transform: `scaleX(${Math.max(0.02, a.physical / scale)})` }} />
                      </div>
                      <span className={`w-16 text-right text-xs tabular-nums font-semibold ${TEXT[w]}`}>{size(a.physical)}</span>
                    </div>
                  )}
                  <span className="text-right text-xs tabular-nums text-paper/60">{size(a.fileSize)}</span>
                </div>
                {isOpen && <Textures path={a.path} options={options} onOptimize={onOptimize} />}
              </div>
            );
          })}
          {rows.length === 0 && <p className="py-8 text-center font-display uppercase text-sm text-paper/50">Nada com esse filtro</p>}
          {rows.length > shown && (
            <button className="btn btn-secondary btn-sm self-center my-3" onClick={() => setShown((n) => n + PAGE)}>
              Mostrar mais ({(rows.length - shown).toLocaleString("pt-BR")} restantes)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone = "ok" }: { label: string; value: string; sub: string; tone?: "ok" | "err" }) {
  return (
    <div className="bg-glass/82 py-3 px-4 min-w-0">
      <p className="text-[0.6875rem] font-display font-bold uppercase text-paper/45">{label}</p>
      <p className={`mt-1 font-display font-extrabold text-2xl leading-none tabular-nums ${tone === "err" ? "text-err" : "text-paper"}`}>{value}</p>
      <p className="mt-1 text-xs text-paper/45 truncate">{sub}</p>
    </div>
  );
}

/** Texturas de um .ytd e o que acontece com cada uma nas opções atuais. */
function Textures({ path, options, onOptimize }: { path: string; options: Options; onOptimize: () => void }) {
  const [data, setData] = useState<Inspect | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    call<Inspect>("inspect", { path, options })
      .then((d) => live && setData(d))
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [path, options]);

  let body: ReactNode;
  if (error) body = <p className="text-xs text-err">{error}</p>;
  else if (!data) body = <div className="flex items-center gap-3 text-xs text-paper/50"><Spinner className="size-4" />Lendo as texturas</div>;
  else {
    const gain = data.physical - data.physicalAfter;
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-3">
          <p className="text-xs text-paper/60">
            {data.textures.length} {data.textures.length === 1 ? "textura" : "texturas"}
            {data.editable && gain > 0 && (
              <> · com as opções atuais: <span className="text-paper font-semibold">{size(data.physical)} → {size(data.physicalAfter)}</span></>
            )}
            {data.editable && gain <= 0 && " · nada a otimizar com as opções atuais"}
          </p>
          {data.editable && gain > 0 && (
            <button className="btn btn-outline btn-sm" onClick={onOptimize}>Ir para Otimizar<IconArrowRight className="size-3.5" /></button>
          )}
        </div>
        {!data.editable && (
          <p className="mb-3 flex items-center gap-2 text-xs text-warn">
            <IconAlert className="size-4 shrink-0" />Esse arquivo tem estruturas que o otimizador não reconhece. Ele não será alterado.
          </p>
        )}
        <div className="flex flex-col gap-px">
          {data.textures.map((t, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-4 items-center py-1.5 text-xs">
              <span className="truncate font-semibold" title={t.name}>{t.name || "(sem nome)"}</span>
              <span className="min-w-0 flex items-center gap-2 tabular-nums">
                <span className="text-paper/60 truncate">{texLabel(t.before)} · {size(t.before.size)}</span>
                {t.after ? (
                  <>
                    <IconArrowRight className="size-3.5 shrink-0 text-mainLight" />
                    <span className="text-paper truncate">{t.after.width}×{t.after.height} {t.after.format} · {size(t.after.size)}</span>
                  </>
                ) : t.note ? (
                  <span className="text-warn truncate" title={t.note}>· {t.note}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </>
    );
  }
  return <div className="bg-glass/60 border-l-2 border-main/60 ml-3 py-3 px-4 mt-px">{body}</div>;
}
