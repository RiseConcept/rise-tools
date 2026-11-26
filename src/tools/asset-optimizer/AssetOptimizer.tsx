import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { errorText } from "../../core/tools";
import { useHints, useToast } from "../../ui/feedback";
import { IconFolder, IconGauge, IconRefresh, IconSearch, IconUpload, Spinner } from "../../ui/icons";
import { Editorial, Tabs, type TabItem } from "../../ui/layout";
import { AuditView } from "./AuditView";
import { OptimizeView } from "./OptimizeView";
import { call, type Asset, type Options } from "./format";

type Mode = "audit" | "optimize";
const MODES: TabItem<Mode>[] = [
  { id: "audit", label: "Auditar", icon: IconSearch },
  { id: "optimize", label: "Otimizar", icon: IconGauge },
];

const OPTIONS_KEY = "asset-optimizer:options";
const DEFAULTS: Options = { maxSize: 1024, bc3ToBc1: true, compressRaw: true };

export default function AssetOptimizer() {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("audit");
  const [root, setRoot] = useState<string | null>(null);
  const [inputs, setInputs] = useState<string[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [scanning, setScanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [options, setOptions] = useState<Options>(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "{}") };
    } catch {
      return DEFAULTS;
    }
  });
  useEffect(() => localStorage.setItem(OPTIONS_KEY, JSON.stringify(options)), [options]);

  const scan = useCallback(
    async (paths: string[], quiet = false) => {
      if (!paths.length) return;
      setScanning(true);
      try {
        const res = await call<{ root: string; assets: Asset[] }>("scan", { paths });
        setInputs(paths);
        setRoot(res.root);
        setAssets(res.assets);
        if (!quiet && !res.assets.length) {
          toast({ type: "warn", title: "Nenhum asset encontrado", message: "Não há .ytd, .ydr, .yft ou .ydd nessa pasta." });
        }
      } catch (e) {
        toast({ type: "err", title: "Erro ao ler a pasta", message: errorText(e) });
      } finally {
        setScanning(false);
      }
    },
    [toast],
  );

  const pickFolder = useCallback(async () => {
    const r = await openDialog({ directory: true, multiple: false, title: "Pasta do servidor, de resources ou de um resource" });
    if (typeof r === "string") scan([r]);
  }, [scan]);

  const rescan = useCallback(() => scan(inputs, true), [scan, inputs]);

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
          scan(p.paths);
        }
      })
      .then((fn) => (dead ? fn() : (off = fn)));
    return () => {
      dead = true;
      off?.();
    };
  }, [scan]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        pickFolder();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [pickFolder]);

  useHints([{ keys: ["Ctrl", "O"], label: "Escolher pasta" }]);

  return (
    <div className="h-full flex flex-col px-6 xl:px-10 pt-8 xl:pt-10 pb-24 relative">
      <div className="shrink-0 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <Editorial title="Asset Optimizer" />
        <div className="anim-rise flex flex-wrap gap-1.5" style={{ "--i": 0 } as CSSProperties}>
          {root && (
            <button className="btn btn-secondary" onClick={rescan} disabled={scanning}>
              <IconRefresh className="size-4" />Ler de novo
            </button>
          )}
          <button className="btn btn-primary" onClick={pickFolder} disabled={scanning}>
            <IconFolder className="size-4" />Escolher pasta
          </button>
        </div>
      </div>

      <div className="anim-rise shrink-0 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2" style={{ "--i": 1 } as CSSProperties}>
        <Tabs items={MODES} active={mode} onChange={setMode} />
        <p className="min-w-0 text-xs text-paper/50 truncate" title={root ?? undefined}>
          {root ? root : mode === "audit" ? "Veja quanto cada asset pesa na memória do jogo." : "Reduza as texturas dos .ytd, com backup e desfazer."}
        </p>
      </div>

      {!root ? (
        <DropZone scanning={scanning} onPick={pickFolder} />
      ) : mode === "audit" ? (
        <AuditView key={root} assets={assets} options={options} onOptimize={() => setMode("optimize")} />
      ) : (
        <OptimizeView key={root} root={root} assets={assets} options={options} setOptions={setOptions} onChanged={rescan} />
      )}

      {dragging && (
        <div className="absolute inset-6 z-50 pointer-events-none grid place-items-center bg-glass/90 outline outline-2 outline-main -outline-offset-2 anim-toast"
             style={{ boxShadow: "inset 0 0 2.5rem rgb(var(--main) / .18)" }}>
          <div className="text-center">
            <IconUpload className="size-10 mx-auto text-mainLight" />
            <p className="mt-4 font-display font-extrabold text-2xl uppercase">Solte para analisar</p>
            <p className="mt-1 text-sm text-paper/60">Pastas ou arquivos .ytd, .ydr, .yft e .ydd</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({ scanning, onPick }: { scanning: boolean; onPick: () => void }) {
  return (
    <div className="anim-rise mt-6 flex-1 min-h-0 max-h-[30rem] grid place-items-center bg-glass/82 overflow-hidden" style={{ "--i": 2 } as CSSProperties}>
      {scanning ? (
        <div className="flex flex-col items-center text-paper/60">
          <Spinner />
          <p className="mt-4 font-display uppercase text-sm">Lendo os assets</p>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center px-6">
          <div className="icon-sq size-16"><IconGauge className="size-8" /></div>
          <p className="mt-6 font-display font-extrabold text-2xl uppercase">Arraste a pasta do servidor aqui</p>
          <p className="mt-1.5 text-sm text-paper/60 max-w-lg">
            Pode ser a pasta do servidor, a resources ou um resource só. A pasta cache do FiveM é ignorada.
            Nada é alterado até você mandar otimizar.
          </p>
          <button className="btn btn-primary mt-6" onClick={onPick}><IconFolder className="size-4" />Escolher pasta</button>
        </div>
      )}
    </div>
  );
}
