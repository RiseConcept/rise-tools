import { toolClient } from "../../core/tools";

export const call = toolClient("asset-optimizer");

/** Tipos do backend e formatação compartilhada pelas telas do Asset Optimizer. */

export interface Asset {
  path: string;
  dir: string;
  name: string;
  kind: string;
  fileSize: number;
  virtualSize: number;
  physical: number;
  error: string | null;
}

export interface Options {
  maxSize: number;
  bc3ToBc1: boolean;
  compressRaw: boolean;
}

export interface FilePlan {
  path: string;
  physical: number;
  physicalAfter: number;
  textures: number;
  resized: number;
  converted: number;
  orphan: number;
  notes: string[];
  error: string | null;
}

export interface FileResult {
  path: string;
  status: "optimized" | "unchanged" | "error";
  error: string | null;
  sizeBefore: number;
  sizeAfter: number;
  physicalBefore: number;
  physicalAfter: number;
}

export interface TexState {
  width: number;
  height: number;
  format: string;
  levels: number;
  size: number;
}

export interface TexInfo {
  name: string;
  before: TexState;
  after: TexState | null;
  steps: string[];
  note: string | null;
}

export interface Inspect {
  physical: number;
  physicalAfter: number;
  editable: boolean;
  textures: TexInfo[];
}

export const MIB = 1024 * 1024;
/** O FiveM avisa "oversized asset" acima disso de memória física. */
export const LIMIT = 16 * MIB;

export function size(b: number) {
  if (b < MIB) return `${Math.max(1, Math.round(b / 1024)).toLocaleString("pt-BR")} KB`;
  const v = b / MIB;
  return `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })} MiB`;
}

export const percent = (before: number, after: number) =>
  before > 0 ? `${Math.round((1 - after / before) * 100)}%` : "0%";

/** Cor do peso: acima do limite do FiveM, metade do limite, normal. */
export const weight = (b: number) => (b > LIMIT ? "err" : b > LIMIT / 2 ? "warn" : "ok");

export const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function stamp(d = new Date()) {
  const n = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${n(d.getMonth() + 1)}-${n(d.getDate())}_${n(d.getHours())}-${n(d.getMinutes())}-${n(d.getSeconds())}`;
}

export const texLabel = (t: TexState) => `${t.width}×${t.height} ${t.format} · ${t.levels} ${t.levels === 1 ? "nível" : "níveis"}`;
