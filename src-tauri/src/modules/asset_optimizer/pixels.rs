//! Formatos de textura do GTA V e conversões de pixels.

use texpresso::{Algorithm, Format, Params};

pub const DXT1: u32 = 0x3154_5844;
pub const DXT3: u32 = 0x3354_5844;
pub const DXT5: u32 = 0x3554_5844;
pub const ATI1: u32 = 0x3149_5441; // BC4
pub const ATI2: u32 = 0x3249_5441; // BC5
pub const BC7: u32 = 0x2037_4342;
pub const A8R8G8B8: u32 = 21;
pub const X8R8G8B8: u32 = 22;
pub const R5G6B5: u32 = 23;
pub const A1R5G5B5: u32 = 25;
pub const A8: u32 = 28;
pub const A8B8G8R8: u32 = 32;
pub const L8: u32 = 50;
pub const A8L8: u32 = 51;

pub fn name(f: u32) -> String {
    match f {
        DXT1 => "DXT1".into(),
        DXT3 => "DXT3".into(),
        DXT5 => "DXT5".into(),
        ATI1 => "BC4".into(),
        ATI2 => "BC5".into(),
        BC7 => "BC7".into(),
        A8R8G8B8 => "A8R8G8B8".into(),
        X8R8G8B8 => "X8R8G8B8".into(),
        R5G6B5 => "R5G6B5".into(),
        A1R5G5B5 => "A1R5G5B5".into(),
        A8 => "A8".into(),
        A8B8G8R8 => "A8B8G8R8".into(),
        L8 => "L8".into(),
        A8L8 => "A8L8".into(),
        other => format!("0x{other:X}"),
    }
}

/// (bits por pixel, é comprimido em blocos 4x4)
fn info(f: u32) -> Option<(usize, bool)> {
    Some(match f {
        DXT1 | ATI1 => (4, true),
        DXT3 | DXT5 | ATI2 | BC7 => (8, true),
        A8R8G8B8 | X8R8G8B8 | A8B8G8R8 => (32, false),
        R5G6B5 | A1R5G5B5 | A8L8 => (16, false),
        A8 | L8 => (8, false),
        _ => return None,
    })
}

pub fn known(f: u32) -> bool {
    info(f).is_some()
}

pub fn is_block(f: u32) -> bool {
    info(f).is_some_and(|(_, b)| b)
}

pub fn is_raw32(f: u32) -> bool {
    matches!(f, A8R8G8B8 | X8R8G8B8 | A8B8G8R8)
}

/// Formatos que sabemos decodificar e codificar de volta sem trocar o tipo.
pub fn reencodable(f: u32) -> bool {
    matches!(f, DXT1 | DXT3 | DXT5 | ATI1 | ATI2) || is_raw32(f)
}

pub fn mip(d: u32, level: u32) -> u32 {
    (d >> level).max(1)
}

/// Bytes de um nível de mipmap.
pub fn level_size(f: u32, w: u32, h: u32) -> usize {
    let (bpp, block) = info(f).expect("formato conhecido");
    let (w, h) = (w as usize, h as usize);
    if block {
        w.div_ceil(4) * h.div_ceil(4) * bpp * 2 // 16 pixels por bloco: bpp*16/8
    } else {
        w * h * bpp / 8
    }
}

/// Bytes de `levels` níveis a partir do nível `from`.
pub fn data_size(f: u32, w: u32, h: u32, from: u32, levels: u32) -> usize {
    (from..from + levels).map(|i| level_size(f, mip(w, i), mip(h, i))).sum()
}

/// Bytes por linha de pixels do nível 0 (campo Stride do grcTexture).
pub fn stride(f: u32, w: u32) -> u32 {
    let (bpp, _) = info(f).expect("formato conhecido");
    (w as usize * bpp / 8) as u32
}

fn texpresso_format(f: u32) -> Option<Format> {
    Some(match f {
        DXT1 => Format::Bc1,
        DXT3 => Format::Bc2,
        DXT5 => Format::Bc3,
        ATI1 => Format::Bc4,
        ATI2 => Format::Bc5,
        _ => return None,
    })
}

/// Um nível de mipmap em RGBA8.
pub fn to_rgba(f: u32, data: &[u8], w: u32, h: u32) -> Option<Vec<u8>> {
    let (wu, hu) = (w as usize, h as usize);
    let mut out = vec![0u8; wu * hu * 4];
    if let Some(fmt) = texpresso_format(f) {
        fmt.decompress(data, wu, hu, &mut out);
        return Some(out);
    }
    match f {
        // na memória: B G R A
        A8R8G8B8 | X8R8G8B8 => {
            for (o, i) in out.chunks_exact_mut(4).zip(data.chunks_exact(4)) {
                o.copy_from_slice(&[i[2], i[1], i[0], if f == X8R8G8B8 { 255 } else { i[3] }]);
            }
        }
        A8B8G8R8 => out.copy_from_slice(&data[..wu * hu * 4]),
        _ => return None,
    }
    Some(out)
}

/// Codifica RGBA8 em um nível do formato `f`.
pub fn from_rgba(f: u32, rgba: &[u8], w: u32, h: u32) -> Option<Vec<u8>> {
    let (wu, hu) = (w as usize, h as usize);
    if let Some(fmt) = texpresso_format(f) {
        let mut out = vec![0u8; fmt.compressed_size(wu, hu)];
        let params = Params { algorithm: Algorithm::ClusterFit, ..Params::default() };
        fmt.compress(rgba, wu, hu, params, &mut out);
        return Some(out);
    }
    match f {
        A8R8G8B8 | X8R8G8B8 => Some(
            rgba.chunks_exact(4)
                .flat_map(|p| [p[2], p[1], p[0], if f == X8R8G8B8 { 255 } else { p[3] }])
                .collect(),
        ),
        A8B8G8R8 => Some(rgba.to_vec()),
        _ => None,
    }
}

/// Reduz pela metade com filtro de caixa 2x2.
pub fn half(src: &[u8], w: u32, h: u32) -> (Vec<u8>, u32, u32) {
    let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
    let (w, h) = (w as usize, h as usize);
    let mut out = vec![0u8; nw as usize * nh as usize * 4];
    for y in 0..nh as usize {
        let (y0, y1) = ((y * 2).min(h - 1), (y * 2 + 1).min(h - 1));
        for x in 0..nw as usize {
            let (x0, x1) = ((x * 2).min(w - 1), (x * 2 + 1).min(w - 1));
            for c in 0..4 {
                let s = src[(y0 * w + x0) * 4 + c] as u32
                    + src[(y0 * w + x1) * 4 + c] as u32
                    + src[(y1 * w + x0) * 4 + c] as u32
                    + src[(y1 * w + x1) * 4 + c] as u32;
                out[(y * nw as usize + x) * 4 + c] = ((s + 2) / 4) as u8;
            }
        }
    }
    (out, nw, nh)
}

/// O bloco de alpha do DXT5 só produz 255?
fn bc3_alpha_opaque(b: &[u8]) -> bool {
    let (a0, a1) = (b[0] as u32, b[1] as u32);
    let mut pal = [0u32; 8];
    pal[0] = a0;
    pal[1] = a1;
    if a0 > a1 {
        for i in 1..7 {
            pal[i + 1] = ((7 - i as u32) * a0 + i as u32 * a1) / 7;
        }
    } else {
        for i in 1..5 {
            pal[i + 1] = ((5 - i as u32) * a0 + i as u32 * a1) / 5;
        }
        pal[6] = 0;
        pal[7] = 255;
    }
    let bits = b[2..8].iter().enumerate().fold(0u64, |acc, (i, &v)| acc | (v as u64) << (8 * i));
    (0..16).all(|i| pal[((bits >> (3 * i)) & 7) as usize] == 255)
}

/// Todos os pixels dos dados (um ou mais níveis) são 100% opacos?
pub fn opaque(f: u32, data: &[u8]) -> bool {
    match f {
        DXT1 | ATI1 | ATI2 | X8R8G8B8 => true,
        DXT3 => data.chunks_exact(16).all(|b| b[..8].iter().all(|&v| v == 0xFF)),
        DXT5 => data.chunks_exact(16).all(bc3_alpha_opaque),
        A8R8G8B8 | A8B8G8R8 => data.chunks_exact(4).all(|p| p[3] == 255),
        _ => false,
    }
}

/// DXT3/DXT5 opaco -> DXT1 sem perda: o bloco de cor do DXT5 é um bloco DXT1 de 4 cores.
/// Quando c0 <= c1 (que no DXT1 ativaria o modo de 3 cores + transparente) troca as pontas
/// e remapeia os índices, o que dá exatamente as mesmas cores.
pub fn bc3_to_bc1(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() / 2);
    for b in data.chunks_exact(16) {
        let c = &b[8..16];
        let c0 = u16::from_le_bytes([c[0], c[1]]);
        let c1 = u16::from_le_bytes([c[2], c[3]]);
        let idx = u32::from_le_bytes([c[4], c[5], c[6], c[7]]);
        if c0 > c1 {
            out.extend_from_slice(c);
        } else if c0 == c1 {
            // as 4 cores do DXT5 são iguais a c0
            out.extend_from_slice(&c0.to_le_bytes());
            out.extend_from_slice(&c1.to_le_bytes());
            out.extend_from_slice(&[0, 0, 0, 0]);
        } else {
            out.extend_from_slice(&c1.to_le_bytes());
            out.extend_from_slice(&c0.to_le_bytes());
            out.extend_from_slice(&(idx ^ 0x5555_5555).to_le_bytes()); // 0<->1, 2<->3
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bc3_to_bc1_is_lossless() {
        // imagem opaca com gradientes: força blocos com c0 < c1, c0 == c1 e c0 > c1
        let (w, h) = (64u32, 64u32);
        let mut rgba = vec![255u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                rgba[i] = (x * 4) as u8;
                rgba[i + 1] = if y < 16 { 80 } else { (255 - y * 3) as u8 };
                rgba[i + 2] = ((x * y) % 256) as u8;
            }
        }
        let bc3 = from_rgba(DXT5, &rgba, w, h).unwrap();
        assert!(opaque(DXT5, &bc3));
        let bc1 = bc3_to_bc1(&bc3);
        assert_eq!(bc1.len(), bc3.len() / 2);
        assert_eq!(to_rgba(DXT5, &bc3, w, h).unwrap(), to_rgba(DXT1, &bc1, w, h).unwrap());
    }

    #[test]
    fn transparent_is_not_opaque() {
        let mut rgba = vec![255u8; 16 * 16 * 4];
        rgba[3] = 0;
        let bc3 = from_rgba(DXT5, &rgba, 16, 16).unwrap();
        assert!(!opaque(DXT5, &bc3));
    }
}
