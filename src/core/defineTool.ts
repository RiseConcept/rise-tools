import type { ComponentType, LazyExoticComponent } from "react";

/**
 * Contrato de uma ferramenta no front. Cada pasta em `src/tools/<id>/` exporta
 * `defineTool({...})` no `index.ts` e é descoberta sozinha: adicionar ou apagar a
 * pasta adiciona ou remove a ferramenta do painel, sem tocar no resto.
 */
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  view: LazyExoticComponent<ComponentType>;
  /** false para ferramentas que rodam só no front. Padrão: true (precisa do módulo Rust com o mesmo id). */
  backend?: boolean;
  /** Ordem no menu (menor primeiro). */
  order?: number;
}

export const defineTool = (def: ToolDefinition) => def;
