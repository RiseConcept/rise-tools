// STYLE-NPV §14.1: toda a família do tema deriva de uma cor só.
export const DEFAULT_THEME = "#41e5ff";

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const lum = (rgb: number[]) =>
  rgb
    .map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);

const KEYS = ["--main", "--mainText", "--mainLight", "--mainHover", "--mainDeep"];

export function applyTheme(hex: string = DEFAULT_THEME) {
  const valid = /^#?[0-9a-f]{6}$/i.test(hex);
  if (!valid) console.warn("[theme] cor inválida; usando o padrão");
  const rgb = hexToRgb(valid ? hex : DEFAULT_THEME);
  const root = document.documentElement;
  const gray = Math.max(...rgb) === Math.min(...rgb);
  KEYS.forEach((k) => root.style.removeProperty(k));
  root.classList.toggle("grayscale", gray);
  if (gray) return;
  const set = (k: string, v: number[]) => root.style.setProperty(k, v.join(" "));
  set("--main", rgb);
  set("--mainText", lum(rgb) > 0.45 ? [5, 6, 8] : [255, 255, 255]);
  set("--mainLight", mix(rgb, [255, 255, 255], 0.25));
  set("--mainHover", rgb.map((v) => Math.round(v * 0.8)));
  set("--mainDeep", mix(rgb, [0, 0, 0], 0.4));
}
