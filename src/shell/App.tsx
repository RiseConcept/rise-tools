import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { errorText, listBackend, tools, type BackendManifest, type ToolDefinition } from "../core/tools";
import { FeedbackProvider, useHints } from "../ui/feedback";
import { IconHome, Mountain } from "../ui/icons";
import { Editorial, Loading, ToolBoundary, useSlidingIndicator } from "../ui/layout";

/* Rota = hash (#/ycd-editor). Sem dependência de router. */
function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [route, (r: string) => (window.location.hash = r ? `/${r}` : "")] as const;
}

type Status = { state: "loading" } | { state: "ready"; backend: Map<string, BackendManifest> } | { state: "error"; message: string };

function availability(tool: ToolDefinition, status: Status) {
  if (tool.backend === false) return { ok: true, version: undefined };
  if (status.state !== "ready") return { ok: status.state === "loading", version: undefined };
  const m = status.backend.get(tool.id);
  return { ok: !!m, version: m?.version };
}

export default function App() {
  const [route, go] = useRoute();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [version, setVersion] = useState("");

  useEffect(() => {
    listBackend()
      .then((list) => setStatus({ state: "ready", backend: new Map(list.map((m) => [m.id, m])) }))
      .catch((e) => setStatus({ state: "error", message: errorText(e) }));
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const current = tools.find((t) => t.id === route);

  return (
    <FeedbackProvider baseHints={current ? [{ keys: ["Esc"], label: "Início" }] : []}>
      {/* Fundo de tela cheia sem mundo (§3): from→to + scanlines + vinheta + montanha d'água */}
      <div className="fixed inset-0 bg-default" />
      <Mountain shade={false} className="fixed -right-[6rem] -bottom-[3rem] w-[46rem] opacity-[.08] pointer-events-none" />
      <div className="fixed inset-0 bg-scanlines mix-blend-overlay pointer-events-none" />
      <div className="fixed inset-0 pointer-events-none" style={{ background: "radial-gradient(transparent 55%, rgb(0 0 0 / .45))" }} />

      <div className="anim-screen relative z-10 flex h-full">
        <Sidebar route={route} go={go} status={status} version={version} />
        <main className="flex-1 min-w-0 h-full">
          {current ? (
            <ToolScreen key={current.id} tool={current} status={status} back={() => go("")} />
          ) : (
            <Home key="home" open={go} status={status} />
          )}
        </main>
      </div>
    </FeedbackProvider>
  );
}

function Sidebar({ route, go, status, version }: { route: string; go: (r: string) => void; status: Status; version: string }) {
  const list = useRef<HTMLElement>(null);
  const items = [{ id: "", name: "Início", icon: IconHome }, ...tools];
  const active = Math.max(0, items.findIndex((t) => t.id === route));
  const indicator = useSlidingIndicator(list, active, [items.length]);

  return (
    <aside className="w-[14rem] xl:w-[17rem] shrink-0 h-full flex flex-col bg-glass/82">
      <div className="px-6 pt-8 pb-7 flex items-end gap-3">
        <Mountain className="w-12" />
        <span className="font-display font-black text-[1.75rem] leading-[.84] tracking-display uppercase">RISE Tools</span>
      </div>

      <nav ref={list} className="relative flex-1 px-3 flex flex-col gap-[0.1875rem]">
        <div className="slide-indicator absolute left-0 top-0 bg-paper" style={indicator} />
        {items.map((t, i) => {
          const sel = i === active;
          const Icon = t.icon;
          const off = t.id !== "" && !availability(t as ToolDefinition, status).ok;
          return (
            <button key={t.id} data-slide-item onClick={() => go(t.id)}
                    className={`relative z-10 flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer transition-colors duration-1
                                ${sel ? "text-ink" : "text-paper hover:bg-paper/[0.06]"}`}>
              <Icon className={`size-5 shrink-0 ${sel ? "" : "text-paper/70"}`} />
              <span className="font-display font-bold text-sm uppercase tracking-[0.02em] truncate">{t.name}</span>
              {off && <span className={`ml-auto size-1.5 ${sel ? "bg-err" : "bg-err/80"}`} title="Módulo indisponível" />}
            </button>
          );
        })}
      </nav>

      <div className="px-6 py-6 text-2xs text-dim tabular-nums">
        {version && `v${version} · `}
        {tools.length} {tools.length === 1 ? "ferramenta" : "ferramentas"}
        {status.state === "error" && <p className="text-err mt-1">Back-end fora do ar: {status.message}</p>}
      </div>
    </aside>
  );
}

function Home({ open, status }: { open: (id: string) => void; status: Status }) {
  useHints([{ keys: ["↵"], label: "Abrir" }]);
  return (
    <div className="h-full scroll px-6 xl:px-10 pt-8 xl:pt-10 pb-24">
      <Editorial title="Ferramentas" subtitle="Tudo o que você usa no FiveM, num lugar só."
                 text="Escolha uma ferramenta para começar. Cada uma funciona de forma independente." />

      <div className="mt-10 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-1.5 max-w-[80rem]">
        {tools.map((t, i) => {
          const a = availability(t, status);
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => open(t.id)} style={{ "--i": i + 2 } as CSSProperties}
                    className="anim-rise text-left bg-glass/82 p-5 flex flex-col gap-4 cursor-pointer
                               outline outline-2 outline-transparent -outline-offset-2 focus-visible:outline-paper
                               transition-[filter,transform] duration-1 hover:brightness-110 active:scale-[.98]">
              <div className="flex items-start justify-between">
                <div className="icon-sq size-12"><Icon className="size-6" /></div>
                {a.version && <span className="h-4 px-[0.3125rem] bg-paper/[0.12] border border-paper/20 text-[0.625rem] font-semibold tabular-nums">v{a.version}</span>}
              </div>
              <div>
                <p className="font-display font-extrabold text-lg uppercase leading-tight">{t.name}</p>
                <p className="mt-1 text-xs text-paper/60 leading-relaxed">{t.description}</p>
              </div>
              <p className={`mt-auto font-display font-extrabold text-[0.6875rem] uppercase ${a.ok ? "text-ok" : "text-err"}`}>
                {a.ok ? "Pronta" : "Módulo indisponível"}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToolScreen({ tool, status, back }: { tool: ToolDefinition; status: Status; back: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.activeElement instanceof HTMLInputElement) return (document.activeElement as HTMLInputElement).blur();
      back();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [back]);

  const a = availability(tool, status);
  if (!a.ok)
    return (
      <div className="px-10 pt-10">
        <Editorial title={tool.name} />
        <p className="mt-8 text-sm text-err">O módulo "{tool.id}" não está registrado no back-end (src-tauri/src/modules).</p>
      </div>
    );

  return (
    <ToolBoundary name={tool.name}>
      <Suspense fallback={<Loading label="Carregando ferramenta…" />}>
        <tool.view />
      </Suspense>
    </ToolBoundary>
  );
}
