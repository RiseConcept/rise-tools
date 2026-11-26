//! Texture dictionary (.ytd): leitura, plano de otimização e reconstrução.
//!
//! O segmento de sistema (estruturas e nomes) é mantido byte a byte; só os campos de cada
//! textura (largura, altura, stride, formato, níveis, ponteiro) são ajustados. O segmento
//! gráfico (pixels) é remontado do zero com páginas novas.

use super::pixels::{self as px, DXT1, DXT3, DXT5, X8R8G8B8};
use crate::formats::rsc7::{self, Header, R, GFX_BASE, MAX_PAGES, SYS_BASE};
use rayon::prelude::*;
use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    /// Maior lado permitido (0 = não reduzir).
    pub max_size: u32,
    /// DXT5/DXT3 sem transparência -> DXT1 (sem perda, metade do tamanho).
    pub bc3_to_bc1: bool,
    /// Texturas sem compressão (A8R8G8B8…) -> DXT1/DXT5.
    pub compress_raw: bool,
}

#[derive(Clone, Debug)]
pub struct Tex {
    pub name: String,
    off: usize, // offset da estrutura no segmento de sistema
    pub width: u32,
    pub height: u32,
    depth: u32,
    #[allow(dead_code)] // lido pelos testes
    pub stride: u32,
    pub format: u32,
    pub levels: u32,
    data: usize, // offset dos pixels no segmento gráfico
    len: usize,  // bytes de pixels
}

impl Tex {
    /// Formato e layout que sabemos ler e escrever com segurança.
    fn supported(&self) -> bool {
        px::known(self.format) && self.depth <= 1 && self.levels >= 1
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Op {
    Keep,
    /// Só descarta os mipmaps maiores (sem perda).
    DropMips,
    /// DXT5/DXT3 -> DXT1, bloco a bloco (sem perda).
    ToBc1,
    /// Decodifica, (reduz) e codifica de novo.
    Encode,
}

#[derive(Clone, Debug)]
pub struct Plan {
    pub op: Op,
    drop: u32,
    halve: u32,
    pub width: u32,
    pub height: u32,
    pub format: u32,
    pub levels: u32,
    pub size: usize,
    pub steps: Vec<String>,
    pub note: Option<String>,
}

pub struct Ytd {
    pub header: Header,
    sys: Vec<u8>,
    gfx: Vec<u8>,
    pub textures: Vec<Tex>,
}

fn rd<const N: usize>(b: &[u8], at: usize) -> R<[u8; N]> {
    b.get(at..at + N)
        .map(|s| s.try_into().unwrap())
        .ok_or_else(|| "estrutura fora dos limites (arquivo corrompido?)".to_string())
}
fn u16_at(b: &[u8], at: usize) -> R<u16> {
    Ok(u16::from_le_bytes(rd(b, at)?))
}
fn u32_at(b: &[u8], at: usize) -> R<u32> {
    Ok(u32::from_le_bytes(rd(b, at)?))
}
fn u64_at(b: &[u8], at: usize) -> R<u64> {
    Ok(u64::from_le_bytes(rd(b, at)?))
}

fn sys_off(p: u64, len: usize) -> R<usize> {
    if p >> 28 != 5 || (p - SYS_BASE) as usize >= len {
        return Err("ponteiro inválido no dicionário".into());
    }
    Ok((p - SYS_BASE) as usize)
}

fn is_normal_map(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.ends_with("_n") || n.ends_with("_nm") || n.ends_with("_nrm") || n.ends_with("normal")
}

impl Ytd {
    pub fn load(path: &std::path::Path) -> R<Self> {
        let raw = std::fs::read(path).map_err(|e| format!("não consegui ler o arquivo: {e}"))?;
        Self::parse(&raw)
    }

    pub fn parse(raw: &[u8]) -> R<Self> {
        let header = Header::parse(raw)?;
        let vs = header.virtual_size();
        let mut sys = rsc7::inflate(raw, vs + header.physical_size())?;
        let gfx = sys.split_off(vs);

        let list = u64_at(&sys, 0x30)?;
        let count = u16_at(&sys, 0x38)? as usize;
        let mut textures = Vec::with_capacity(count);
        if count > 0 {
            let list = sys_off(list, sys.len())?;
            for i in 0..count {
                let off = sys_off(u64_at(&sys, list + i * 8)?, sys.len())?;
                textures.push(Self::read_tex(&sys, &gfx, off)?);
            }
        }
        Ok(Self { header, sys, gfx, textures })
    }

    fn read_tex(sys: &[u8], gfx: &[u8], off: usize) -> R<Tex> {
        let name_ptr = u64_at(sys, off + 0x28)?;
        let name = match sys_off(name_ptr, sys.len()) {
            Ok(n) => {
                let end = sys[n..].iter().take(256).position(|&c| c == 0).unwrap_or(0);
                String::from_utf8_lossy(&sys[n..n + end]).into_owned()
            }
            Err(_) => String::new(),
        };
        let width = u16_at(sys, off + 0x50)? as u32;
        let height = u16_at(sys, off + 0x52)? as u32;
        let depth = u16_at(sys, off + 0x54)? as u32;
        let stride = u16_at(sys, off + 0x56)? as u32;
        let format = u32_at(sys, off + 0x58)?;
        let levels = rd::<1>(sys, off + 0x5D)?[0] as u32;
        let ptr = u64_at(sys, off + 0x70)?;
        if ptr >> 28 != 6 || (ptr - GFX_BASE) as usize > gfx.len() {
            return Err(format!("textura \"{name}\": ponteiro de pixels inválido"));
        }
        let data = (ptr - GFX_BASE) as usize;
        let mut t = Tex { name, off, width, height, depth, stride, format, levels, data, len: 0 };
        // tamanho real dos pixels; para formatos desconhecidos usa a conta do CodeWalker (stride * altura)
        t.len = if t.supported() {
            px::data_size(format, width, height, 0, levels)
        } else {
            let mut sum = 0usize;
            let mut l = stride as usize * height as usize;
            for _ in 0..levels.max(1) {
                sum += l;
                l /= 4;
            }
            sum
        };
        if data + t.len > gfx.len() {
            return Err(format!("textura \"{}\": pixels fora dos limites do arquivo", t.name));
        }
        Ok(t)
    }

    fn pixels(&self, t: &Tex) -> &[u8] {
        &self.gfx[t.data..t.data + t.len]
    }

    /// Bytes não-zero do segmento gráfico que nenhuma textura usa (sobras de edições no OpenIV).
    pub fn orphan_bytes(&self) -> usize {
        let mut ranges: Vec<(usize, usize)> = self.textures.iter().map(|t| (t.data, t.data + t.len)).collect();
        ranges.sort();
        let count = |r: &[u8]| r.iter().filter(|&&b| b != 0).count();
        let (mut at, mut n) = (0, 0);
        for (s, e) in ranges {
            if s > at {
                n += count(&self.gfx[at..s]);
            }
            at = at.max(e);
        }
        n + count(&self.gfx[at.min(self.gfx.len())..])
    }

    /// Dá para remontar o segmento gráfico com segurança? Só se o único jeito de o jogo chegar
    /// nos pixels for pelos ponteiros das texturas: varre a parte de sistema atrás de qualquer
    /// outro ponteiro para o segmento gráfico. Se houver, o arquivo não é reescrito.
    pub fn safe(&self) -> bool {
        let known: std::collections::HashSet<u64> = self.textures.iter().map(|t| GFX_BASE + t.data as u64).collect();
        let end = GFX_BASE + self.gfx.len() as u64;
        self.sys.chunks_exact(8).all(|c| {
            let v = u64::from_le_bytes(c.try_into().unwrap());
            !(GFX_BASE..=end).contains(&v) || known.contains(&v)
        })
    }

    pub fn plan(&self, t: &Tex, o: &Options) -> Plan {
        let keep = Plan {
            op: Op::Keep,
            drop: 0,
            halve: 0,
            width: t.width,
            height: t.height,
            format: t.format,
            levels: t.levels,
            size: t.len,
            steps: vec![],
            note: None,
        };
        if !t.supported() {
            return Plan { note: Some(format!("formato {} não suportado: mantida", px::name(t.format))), ..keep };
        }
        let (f, w, h, l) = (t.format, t.width, t.height, t.levels);
        let mut note = None;

        // 1) tamanho: primeiro descarta mipmaps (sem perda), depois reamostra se faltar
        let mut k = 0;
        if o.max_size > 0 {
            while px::mip(w, k).max(px::mip(h, k)) > o.max_size {
                k += 1;
            }
        }
        let drop = k.min(l - 1);
        let mut halve = k - drop;
        let (mut nw, mut nh) = (px::mip(w, k), px::mip(h, k));
        if halve > 0 && (!px::reencodable(f) || (px::is_block(f) && (nw % 4 != 0 || nh % 4 != 0))) {
            halve = 0;
            nw = px::mip(w, drop);
            nh = px::mip(h, drop);
            note = Some(if drop > 0 {
                format!("sem mipmaps suficientes: reduzida só até {nw}x{nh}")
            } else {
                format!("{} sem mipmaps não é reduzida", px::name(f))
            });
        }

        // 2) formato. A transparência é medida nos pixels que de fato vão para o arquivo:
        // reamostrar faz média do alpha, e um "quase opaco" pode virar opaco.
        let normal = is_normal_map(&t.name);
        let wants = !normal
            && ((o.bc3_to_bc1 && (f == DXT5 || f == DXT3)) || (o.compress_raw && px::is_raw32(f) && nw % 4 == 0 && nh % 4 == 0));
        let opaque = wants
            && (f == X8R8G8B8
                || if halve > 0 {
                    self.resample(t, drop, halve).is_some_and(|(img, ..)| img.chunks_exact(4).all(|p| p[3] == 255))
                } else {
                    px::opaque(f, &self.pixels(t)[px::data_size(f, w, h, 0, drop)..])
                });
        let mut nf = f;
        if wants && (f == DXT5 || f == DXT3) && opaque {
            nf = DXT1;
        }
        if wants && px::is_raw32(f) {
            nf = if opaque { DXT1 } else { DXT5 };
        }

        let op = if halve > 0 || (px::is_raw32(f) && nf != f) {
            Op::Encode
        } else if nf != f {
            Op::ToBc1
        } else if drop > 0 {
            Op::DropMips
        } else {
            return Plan { note, ..keep };
        };
        let levels = if halve > 0 { 1 } else { l - drop };
        let mut steps = vec![];
        if k > 0 && (nw, nh) != (w, h) {
            steps.push(format!("{w}x{h} → {nw}x{nh}"));
        }
        if nf != f {
            steps.push(format!("{} → {}", px::name(f), px::name(nf)));
        }
        Plan {
            op,
            drop,
            halve,
            width: nw,
            height: nh,
            format: nf,
            levels,
            size: px::data_size(nf, nw, nh, 0, levels),
            steps,
            note,
        }
    }

    pub fn plan_all(&self, o: &Options) -> Vec<Plan> {
        self.textures.iter().map(|t| self.plan(t, o)).collect()
    }

    /// Memória física depois do plano (mesma conta da reconstrução, sem gerar pixels).
    pub fn physical_after(&self, plans: &[Plan]) -> R<usize> {
        let sizes: Vec<usize> = plans.iter().map(|p| p.size).collect();
        let max = MAX_PAGES.saturating_sub(rsc7::flags_count(self.header.sys_flags));
        Ok(rsc7::flags_size(rsc7::layout(&sizes, false, max)?.1))
    }

    /// Nível `drop` em RGBA, reduzido à metade `halve` vezes.
    fn resample(&self, t: &Tex, drop: u32, halve: u32) -> Option<(Vec<u8>, u32, u32)> {
        let (f, w, h) = (t.format, t.width, t.height);
        let (mut cw, mut ch) = (px::mip(w, drop), px::mip(h, drop));
        let start = px::data_size(f, w, h, 0, drop);
        let mut img = px::to_rgba(f, &self.pixels(t)[start..start + px::level_size(f, cw, ch)], cw, ch)?;
        for _ in 0..halve {
            (img, cw, ch) = px::half(&img, cw, ch);
        }
        Some((img, cw, ch))
    }

    fn build_pixels(&self, t: &Tex, p: &Plan) -> R<Vec<u8>> {
        let src = self.pixels(t);
        let (f, w, h) = (t.format, t.width, t.height);
        let level = |i: u32| {
            let s = px::data_size(f, w, h, 0, i);
            &src[s..s + px::level_size(f, px::mip(w, i), px::mip(h, i))]
        };
        let fail = || format!("textura \"{}\": não consegui converter", t.name);
        let out = match p.op {
            Op::Keep => src.to_vec(),
            Op::DropMips => src[px::data_size(f, w, h, 0, p.drop)..].to_vec(),
            Op::ToBc1 => px::bc3_to_bc1(&src[px::data_size(f, w, h, 0, p.drop)..]),
            Op::Encode if p.halve > 0 => {
                let (img, cw, ch) = self.resample(t, p.drop, p.halve).ok_or_else(fail)?;
                px::from_rgba(p.format, &img, cw, ch).ok_or_else(fail)?
            }
            Op::Encode => {
                let mut out = Vec::with_capacity(p.size);
                for i in p.drop..t.levels {
                    let (lw, lh) = (px::mip(w, i), px::mip(h, i));
                    let rgba = px::to_rgba(f, level(i), lw, lh).ok_or_else(fail)?;
                    out.extend(px::from_rgba(p.format, &rgba, lw, lh).ok_or_else(fail)?);
                }
                out
            }
        };
        if out.len() != p.size {
            return Err(format!("textura \"{}\": tamanho inesperado depois da conversão", t.name));
        }
        Ok(out)
    }

    /// Monta o arquivo .ytd novo (já compactado, com cabeçalho).
    pub fn rebuild(&self, plans: &[Plan]) -> R<Vec<u8>> {
        if !self.safe() {
            return Err("o arquivo tem estruturas que o otimizador não reconhece; mantido como está".into());
        }
        let blocks: Vec<Vec<u8>> = self
            .textures
            .par_iter()
            .zip(plans)
            .map(|(t, p)| self.build_pixels(t, p))
            .collect::<R<_>>()?;
        let sizes: Vec<usize> = blocks.iter().map(Vec::len).collect();
        let max = MAX_PAGES.saturating_sub(rsc7::flags_count(self.header.sys_flags));
        let (offsets, flags) = rsc7::layout(&sizes, false, max)?;

        let vs = self.sys.len();
        let mut buf = Vec::with_capacity(vs + rsc7::flags_size(flags));
        buf.extend_from_slice(&self.sys);
        buf.resize(vs + rsc7::flags_size(flags), 0);
        for ((t, p), (block, &o)) in self.textures.iter().zip(plans).zip(blocks.iter().zip(&offsets)) {
            buf[vs + o..vs + o + block.len()].copy_from_slice(block);
            let s = t.off;
            if p.op != Op::Keep {
                buf[s + 0x50..s + 0x52].copy_from_slice(&(p.width as u16).to_le_bytes());
                buf[s + 0x52..s + 0x54].copy_from_slice(&(p.height as u16).to_le_bytes());
                buf[s + 0x56..s + 0x58].copy_from_slice(&(px::stride(p.format, p.width) as u16).to_le_bytes());
                buf[s + 0x58..s + 0x5C].copy_from_slice(&p.format.to_le_bytes());
                buf[s + 0x5D] = p.levels as u8;
            }
            buf[s + 0x70..s + 0x78].copy_from_slice(&(GFX_BASE + o as u64).to_le_bytes());
        }

        let header = Header { gfx_flags: (self.header.gfx_flags & 0xF000_0000) | flags, ..self.header };
        let mut out = header.to_bytes().to_vec();
        out.extend(rsc7::deflate(&buf)?);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn corpus() -> Vec<PathBuf> {
        let Ok(dir) = std::env::var("YTD_DIR") else { return vec![] };
        let mut out = vec![];
        let mut stack = vec![PathBuf::from(dir)];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("ytd")) {
                    out.push(p);
                }
            }
        }
        out.sort();
        out
    }

    /// YTD_DIR=<pasta com .ytd> cargo test corpus -- --nocapture
    #[test]
    fn corpus_roundtrip() {
        let files = corpus();
        let opts = Options { max_size: 1024, bc3_to_bc1: true, compress_raw: true };
        let none = Options { max_size: 0, bc3_to_bc1: false, compress_raw: false };
        let mut orphans = 0;
        let (mut ok, mut unmapped, mut stride_off, mut before, mut after) = (0, 0, 0, 0usize, 0usize);
        let mut formats = std::collections::BTreeMap::new();
        for path in &files {
            let y = Ytd::load(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            for t in &y.textures {
                *formats.entry(px::name(t.format)).or_insert(0) += 1;
                if t.supported() && t.stride != px::stride(t.format, t.width) {
                    stride_off += 1;
                }
            }
            if !y.safe() {
                unmapped += 1;
                continue;
            }
            if y.orphan_bytes() > 0 {
                orphans += 1;
            }
            // sem mudanças: os pixels de cada textura saem idênticos
            let same = Ytd::parse(&y.rebuild(&y.plan_all(&none)).unwrap()).unwrap();
            for (a, b) in y.textures.iter().zip(&same.textures) {
                assert_eq!(y.pixels(a), same.pixels(b), "{} / {}", path.display(), a.name);
            }
            // com otimização: relê, confere o plano e que o resultado não cresceu
            let plans = y.plan_all(&opts);
            let out = Ytd::parse(&y.rebuild(&plans).unwrap()).unwrap();
            assert_eq!(out.orphan_bytes(), 0);
            assert_eq!(out.header.physical_size(), y.physical_after(&plans).unwrap());
            for ((a, p), b) in y.textures.iter().zip(&plans).zip(&out.textures) {
                assert_eq!((b.width, b.height, b.format, b.levels), (p.width, p.height, p.format, p.levels), "{}", a.name);
                assert_eq!(a.name, b.name);
                if p.op == Op::ToBc1 {
                    let src = &y.pixels(a)[px::data_size(a.format, a.width, a.height, 0, p.drop)..];
                    let (w, h) = (px::mip(a.width, p.drop), px::mip(a.height, p.drop));
                    let l0 = px::level_size(a.format, w, h);
                    assert_eq!(px::to_rgba(a.format, &src[..l0], w, h), px::to_rgba(DXT1, &out.pixels(b)[..l0 / 2], w, h));
                }
            }
            assert!(out.header.physical_size() <= y.header.physical_size(), "{} cresceu", path.display());
            before += y.header.physical_size();
            after += out.header.physical_size();
            ok += 1;
        }
        println!(
            "{} arquivos, {ok} reconstruídos, {unmapped} inseguros, {orphans} com dados órfãos, {stride_off} strides fora do padrão, física {} MiB -> {} MiB",
            files.len(),
            before >> 20,
            after >> 20
        );
        println!("formatos: {formats:?}");
    }
}
