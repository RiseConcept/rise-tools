//! Contêiner RSC7 (resources do GTA V / FiveM): cabeçalho, páginas de memória e compressão.
//! A distribuição de blocos em páginas segue o `ResourceBuilder` do CodeWalker, que é o que
//! as ferramentas da comunidade geram e o jogo aceita.

use flate2::read::{DeflateDecoder, ZlibDecoder};
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::io::{Read, Write};

pub type R<T> = Result<T, String>;

pub const MAGIC: u32 = 0x3743_5352; // "RSC7"
pub const SYS_BASE: u64 = 0x5000_0000;
pub const GFX_BASE: u64 = 0x6000_0000;
/// Total de páginas (sistema + gráfica) que um resource pode ter.
pub const MAX_PAGES: u32 = 128;
const ALIGN: usize = 16;

#[derive(Clone, Copy, Debug)]
pub struct Header {
    pub version: u32,
    pub sys_flags: u32,
    pub gfx_flags: u32,
}

impl Header {
    pub fn parse(b: &[u8]) -> R<Self> {
        if b.len() < 16 {
            return Err("arquivo pequeno demais para ser um resource".into());
        }
        let u = |i: usize| u32::from_le_bytes(b[i..i + 4].try_into().unwrap());
        if u(0) != MAGIC {
            return Err("não é um resource RSC7 (pode estar criptografado ou ser de outra versão do jogo)".into());
        }
        Ok(Self { version: u(4), sys_flags: u(8), gfx_flags: u(12) })
    }

    pub fn to_bytes(self) -> [u8; 16] {
        let mut b = [0u8; 16];
        b[0..4].copy_from_slice(&MAGIC.to_le_bytes());
        b[4..8].copy_from_slice(&self.version.to_le_bytes());
        b[8..12].copy_from_slice(&self.sys_flags.to_le_bytes());
        b[12..16].copy_from_slice(&self.gfx_flags.to_le_bytes());
        b
    }

    /// Memória virtual (estruturas, nomes…), em bytes.
    pub fn virtual_size(&self) -> usize {
        flags_size(self.sys_flags)
    }

    /// Memória física (dados de GPU: pixels das texturas, vértices…), em bytes.
    /// É esse número que o FiveM usa no aviso de "oversized asset".
    pub fn physical_size(&self) -> usize {
        flags_size(self.gfx_flags)
    }
}

/// Tamanho total das páginas descritas pelas flags (CodeWalker `GetSizeFromFlags`).
pub fn flags_size(f: u32) -> usize {
    let base = 0x200usize << (f & 0xF);
    let n = ((f >> 27) & 1)
        + (((f >> 26) & 1) << 1)
        + (((f >> 25) & 1) << 2)
        + (((f >> 24) & 1) << 3)
        + (((f >> 17) & 0x7F) << 4)
        + (((f >> 11) & 0x3F) << 5)
        + (((f >> 7) & 0xF) << 6)
        + (((f >> 5) & 0x3) << 7)
        + (((f >> 4) & 0x1) << 8);
    base * n as usize
}

/// Quantidade de páginas descritas pelas flags.
pub fn flags_count(f: u32) -> u32 {
    ((f >> 4) & 1) + ((f >> 5) & 3) + ((f >> 7) & 0xF) + ((f >> 11) & 0x3F) + ((f >> 17) & 0x7F)
        + ((f >> 24) & 1) + ((f >> 25) & 1) + ((f >> 26) & 1) + ((f >> 27) & 1)
}

/// `counts[0]` é a maior página (base << 8), `counts[8]` a menor (base).
fn make_flags(c: &[u32; 9], shift: u32) -> u32 {
    (shift & 0xF)
        | ((c[0] & 0x1) << 4)
        | ((c[1] & 0x3) << 5)
        | ((c[2] & 0xF) << 7)
        | ((c[3] & 0x3F) << 11)
        | ((c[4] & 0x7F) << 17)
        | ((c[5] & 0x1) << 24)
        | ((c[6] & 0x1) << 25)
        | ((c[7] & 0x1) << 26)
        | ((c[8] & 0x1) << 27)
}

/// Descompacta o corpo do resource. Devolve exatamente `expected` bytes (sistema + gráfica).
pub fn inflate(raw: &[u8], expected: usize) -> R<Vec<u8>> {
    let body = raw.get(16..).ok_or("arquivo truncado")?;
    let mut out = Vec::with_capacity(expected);
    let deflate_ok = DeflateDecoder::new(body).read_to_end(&mut out).is_ok() && out.len() >= expected;
    if !deflate_ok {
        out.clear();
        ZlibDecoder::new(body)
            .read_to_end(&mut out)
            .map_err(|_| "não consegui descompactar o resource (arquivo corrompido?)".to_string())?;
    }
    if out.len() < expected {
        return Err("os dados do resource estão incompletos".into());
    }
    out.truncate(expected);
    Ok(out)
}

pub fn deflate(data: &[u8]) -> R<Vec<u8>> {
    let mut e = DeflateEncoder::new(Vec::with_capacity(data.len() / 2), Compression::default());
    e.write_all(data).map_err(|e| e.to_string())?;
    e.finish().map_err(|e| e.to_string())
}

fn pad(p: usize) -> usize {
    (ALIGN - p % ALIGN) % ALIGN
}

/// Distribui blocos nas páginas do resource, sem nenhum bloco atravessar o fim de uma página.
/// Mesmo algoritmo do CodeWalker (`ResourceBuilder.AssignPositions`), sem bloco raiz (segmento gráfico).
/// Devolve o offset de cada bloco e as flags de página (sem os bits de versão).
pub fn layout(sizes: &[usize], sys: bool, max_pages: u32) -> R<(Vec<usize>, u32)> {
    let mut offsets = vec![0usize; sizes.len()];
    if sizes.is_empty() {
        return Ok((offsets, 0));
    }
    let largest = *sizes.iter().max().unwrap();
    let mut total = 0usize;
    for &s in sizes {
        total += s;
        total += pad(total);
    }
    let mut order: Vec<usize> = (0..sizes.len()).collect();
    order.sort_by(|&a, &b| sizes[b].cmp(&sizes[a]).then(a.cmp(&b)));

    let mut start_page = 0x2000usize;
    while start_page < largest {
        start_page *= 2;
    }
    let mut mult = 1usize;

    for _ in 0..24 {
        let mut remaining = order.clone();
        let mut pos = 0usize;
        let mut page_size = start_page;
        let mut page_start = 0usize;
        let mut space = start_page as isize;
        let mut remainder = total as isize;
        let mut page_count = 1u32;
        let mut counts = [0u32; 9];

        let target = (65536 * mult).max(start_page >> if sys { 5 } else { 2 });
        let min_page = (512 * mult).max(target.min(start_page) >> 4);
        let mut shift = 0u32;
        let mut base = 512usize;
        while base < min_page {
            shift += 1;
            base *= 2;
            if shift >= 0xF {
                break;
            }
        }
        let base_max = base << 8;
        let mut idx = 0usize;
        let mut test = start_page;
        while test < base_max {
            idx += 1;
            test *= 2;
        }
        if idx > 8 {
            start_page *= 2;
            mult *= 2;
            continue;
        }
        counts[idx] = 1;

        loop {
            // maior bloco que ainda cabe na página atual
            if let Some(p) = remaining.iter().position(|&i| sizes[i] as isize <= space) {
                let i = remaining.remove(p);
                offsets[i] = pos;
                let o = pos;
                pos += sizes[i];
                pos += pad(pos);
                let used = (pos - o) as isize;
                space -= used;
                remainder -= used;
            } else if let Some(&biggest) = remaining.first() {
                // nova página, do menor tamanho em que o maior bloco restante cabe
                page_start += page_size;
                pos = page_start;
                let biggest = sizes[biggest];
                while biggest <= page_size >> 1 {
                    if page_size <= min_page || idx >= 8 {
                        break;
                    }
                    if page_size <= target && remainder >= (page_size - min_page) as isize {
                        break;
                    }
                    page_size >>= 1;
                    idx += 1;
                }
                space = page_size as isize;
                counts[idx] += 1;
                page_count += 1;
            } else {
                break;
            }
        }

        let flags = make_flags(&counts, shift);
        if page_count == flags_count(flags) && flags_size(flags) >= pos && page_count <= max_pages {
            return Ok((offsets, flags));
        }
        start_page *= 2;
        mult *= 2;
    }
    Err("os dados não couberam nas páginas de um resource".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_never_crosses_pages() {
        let sizes = [5_592_416, 1_398_128, 349_552, 87_408, 43_704, 2_796_208, 700_000, 64, 128, 22_000];
        let (offs, flags) = layout(&sizes, false, MAX_PAGES).unwrap();
        // reconstrói as páginas e confere que cada bloco está inteiro dentro de uma
        let base = 0x200usize << (flags & 0xF);
        let fields = [(4, 1, 8), (5, 3, 7), (7, 0xF, 6), (11, 0x3F, 5), (17, 0x7F, 4), (24, 1, 3), (25, 1, 2), (26, 1, 1), (27, 1, 0)];
        let mut pages = vec![];
        let mut at = 0;
        for (bit, mask, k) in fields {
            for _ in 0..((flags >> bit) & mask) {
                pages.push((at, at + (base << k)));
                at += base << k;
            }
        }
        assert_eq!(at, flags_size(flags));
        for (i, &o) in offs.iter().enumerate() {
            let end = o + sizes[i];
            assert!(pages.iter().any(|&(s, e)| o >= s && end <= e), "bloco {i} atravessa página");
            for (j, &o2) in offs.iter().enumerate() {
                if i != j {
                    assert!(end <= o2 || o2 + sizes[j] <= o, "blocos {i} e {j} sobrepostos");
                }
            }
        }
    }
}
