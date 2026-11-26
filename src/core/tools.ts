import { invoke } from "@tauri-apps/api/core";
import type { ToolDefinition } from "./defineTool";

export type { ToolDefinition };

const found = import.meta.glob<{ default: ToolDefinition }>("../tools/*/index.ts", { eager: true });

// uma pasta de ferramenta quebrada (sem default válido) fica de fora em vez de derrubar o painel
export const tools: ToolDefinition[] = Object.values(found)
  .map((m) => m?.default)
  .filter((t): t is ToolDefinition => !!t?.id && !!t.view)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));

export interface BackendManifest {
  id: string;
  version: string;
  actions: string[];
}

export const listBackend = () => invoke<BackendManifest[]>("tools_list");

/** Cliente de uma ferramenta: `const call = toolClient("ycd-editor"); await call("open", {...})`. */
export function toolClient(id: string) {
  return <T>(action: string, payload?: unknown) =>
    invoke<T>("tool_invoke", { tool: id, action, payload: payload ?? null });
}

export const errorText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));
