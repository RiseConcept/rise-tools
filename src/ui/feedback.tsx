import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo, IconX } from "./icons";

/* ---------- Toasts (§6.9, família A) ---------- */

type ToastType = "ok" | "err" | "warn" | "info";
export interface ToastInput {
  type: ToastType;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
  time?: number;
}
type Toast = ToastInput & { id: number };

/* ---------- Dicas de tecla (§5.2): cada tela registra as suas ---------- */

export interface Hint {
  keys: string[];
  label: string;
}

interface Ctx {
  toast: (t: ToastInput) => void;
  setHints: (h: Hint[]) => void;
}
const FeedbackCtx = createContext<Ctx>({ toast: () => {}, setHints: () => {} });

export const useToast = () => useContext(FeedbackCtx).toast;

export function useHints(hints: Hint[]) {
  const { setHints } = useContext(FeedbackCtx);
  const key = JSON.stringify(hints);
  useEffect(() => {
    setHints(hints);
    return () => setHints([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setHints]);
}

const COLOR: Record<ToastType, string> = { ok: "--ok", err: "--err", warn: "--warn", info: "--info" };
const ICON = { ok: IconCheck, err: IconX, warn: IconAlert, info: IconInfo };

let seq = 0;

export function FeedbackProvider({ children, baseHints }: { children: ReactNode; baseHints: Hint[] }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hints, setHints] = useState<Hint[]>([]);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++seq;
      setToasts((list) => [...list, { ...t, id }].slice(-5));
      setTimeout(() => dismiss(id), t.time ?? 5000);
    },
    [dismiss],
  );
  const ctx = useMemo(() => ({ toast, setHints }), [toast]);
  const allHints = [...hints, ...baseHints];

  return (
    <FeedbackCtx.Provider value={ctx}>
      {children}

      <div className="fixed right-10 bottom-[5.5rem] z-[999] flex flex-col gap-1.5 w-96">
        {toasts.map((t) => {
          const Icon = ICON[t.type];
          const c = `rgb(var(${COLOR[t.type]}))`;
          return (
            <div key={t.id} className="anim-toast relative bg-glass/95 border border-paper/10 px-4 pt-3.5 pb-4 overflow-hidden">
              <div className="flex gap-3">
                <div className="size-7 shrink-0 grid place-items-center text-ink" style={{ background: c }}>
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-extrabold uppercase text-base leading-7">{t.title}</p>
                  {t.message && <p className="text-sm text-paper/60 break-words">{t.message}</p>}
                  {t.action && (
                    <button className="btn btn-outline btn-sm mt-2.5"
                            onClick={() => { t.action!.run(); dismiss(t.id); }}>
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button className="text-paper/40 hover:text-paper transition-colors duration-1 self-start cursor-pointer"
                        onClick={() => dismiss(t.id)} aria-label="Fechar">
                  <IconX className="size-4" />
                </button>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-[0.1875rem] bg-paper/15">
                <div className="h-full origin-left animate-progress"
                     style={{ background: c, ["--timeout" as string]: `${t.time ?? 5000}ms` }} />
              </div>
            </div>
          );
        })}
      </div>

      {allHints.length > 0 && (
        <div className="anim-hints fixed right-10 bottom-8 z-50 flex items-center bg-glass/82 rounded-[0.1875rem] py-1.5">
          {allHints.map((h, i) => (
            <div key={h.label} className={`flex items-center gap-2 px-3 ${i ? "border-l border-paper/20" : ""}`}>
              <span className="keycap">
                {h.keys.map((k, j) => (
                  <span key={j}>{j > 0 && <span className="text-ink/50 px-0.5">+</span>}{k}</span>
                ))}
              </span>
              <span className="font-display font-bold text-sm uppercase text-paper">{h.label}</span>
            </div>
          ))}
        </div>
      )}
    </FeedbackCtx.Provider>
  );
}
