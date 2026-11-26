import {
  Component, useLayoutEffect, useRef, useState,
  type ComponentType, type CSSProperties, type ReactNode, type RefObject,
} from "react";
import { IconAlert, Spinner } from "./icons";

/** Bloco editorial (§6.12): título Barlow 900 → barra main → (subtítulo → texto). */
export function Editorial({ title, subtitle, text }: { title: ReactNode; subtitle?: string; text?: string }) {
  return (
    <header>
      <h1 className="anim-title font-display font-black text-[2.75rem] leading-[.84] tracking-display uppercase text-paper">
        {title}
      </h1>
      <div className="anim-bar mt-4 w-12 h-1 bg-main" />
      {subtitle && <p className="anim-rise mt-4 text-base font-bold text-paper" style={{ "--i": 1 } as CSSProperties}>{subtitle}</p>}
      {text && <p className="anim-rise mt-1 text-sm text-mist" style={{ "--i": 2 } as CSSProperties}>{text}</p>}
    </header>
  );
}

/**
 * Indicador único que desliza entre itens (§11.3). Devolve o estilo do elemento absoluto
 * que fica atrás do item ativo dentro de `container`.
 */
export function useSlidingIndicator(container: RefObject<HTMLElement | null>, active: number, deps: unknown[] = []) {
  const [style, setStyle] = useState<CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const update = () => {
      const el = container.current?.querySelectorAll<HTMLElement>("[data-slide-item]")[active];
      if (!el) return setStyle({ opacity: 0 });
      setStyle({
        opacity: 1,
        transform: `translate3d(${el.offsetLeft}px, ${el.offsetTop}px, 0)`,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    if (container.current) ro.observe(container.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, container, ...deps]);
  return style;
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

/** Abas (§6.2): ativa invertida (paper/ink) com bloco deslizante. */
export function Tabs<T extends string>({ items, active, onChange }: { items: TabItem<T>[]; active: T; onChange: (id: T) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const index = items.findIndex((t) => t.id === active);
  const indicator = useSlidingIndicator(box, index, [items.length]);

  return (
    <div ref={box} role="tablist" className="relative flex gap-1">
        <div className="slide-indicator absolute left-0 top-0 bg-paper" style={indicator} />
        {items.map((t) => {
          const sel = t.id === active;
          const Icon = t.icon;
          return (
            <button key={t.id} data-slide-item role="tab" aria-selected={sel} onClick={() => onChange(t.id)}
                    className={`relative z-10 flex items-center gap-2 px-4 h-7 font-display font-bold uppercase text-sm cursor-pointer
                                transition-colors duration-1 ${sel ? "text-ink" : "bg-glass/82 text-paper hover:brightness-110"}`}>
              {Icon && <Icon className="size-4" />}
              {t.label}
            </button>
          );
        })}
    </div>
  );
}

/** Isola cada ferramenta: se a tela de uma quebrar, o resto do painel continua funcionando. */
export class ToolBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-10 max-w-xl bg-glass/90 border border-paper/10 border-l-4 py-4 pl-5 pr-4"
           style={{ borderLeftColor: "rgb(var(--err))", backgroundImage: "linear-gradient(90deg, rgb(var(--err)/.12), transparent 55%)" }}>
        <div className="flex items-center gap-3">
          <IconAlert className="size-5 text-err" />
          <p className="font-display font-extrabold uppercase text-err">{this.props.name} parou de responder</p>
        </div>
        <p className="mt-2 text-sm text-paper/70">As outras ferramentas continuam funcionando. Detalhe: {this.state.error.message}</p>
        <button className="btn btn-secondary btn-sm mt-4" onClick={() => this.setState({ error: null })}>Tentar de novo</button>
      </div>
    );
  }
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-paper/50">
      <Spinner />
      <p className="font-display uppercase text-sm mt-4">{label}</p>
    </div>
  );
}
