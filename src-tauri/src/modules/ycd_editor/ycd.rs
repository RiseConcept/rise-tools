//! Leitura e renomeação de clip dictionaries (.ycd, resource RSC7) do GTA V / FiveM.
//! Port de `Tools/Rename YCD/ycd_anims.py`.

use flate2::read::{DeflateDecoder, ZlibDecoder};
use flate2::write::DeflateEncoder;
use flate2::Compression;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;

const SYS_BASE: u64 = 0x5000_0000;
const CLIPS_PTR: usize = 0x28; // ClipDictionary: ponteiro da hash table de clips, capacidade, quantidade

type R<T> = Result<T, String>;

pub fn joaat(s: &str) -> u32 {
    let mut h: u32 = 0;
    for c in s.to_lowercase().bytes() {
        h = h.wrapping_add(c as u32);
        h = h.wrapping_add(h << 10);
        h ^= h >> 6;
    }
    h = h.wrapping_add(h << 3);
    h ^= h >> 11;
    h.wrapping_add(h << 15)
}

/// Hash que o jogo usa para achar o clip. Anims de UV de props ("objeto_uv_N") usam hash(objeto) + 1.
pub fn clip_hash(name: &str) -> u32 {
    if let Some(i) = name.rfind("_uv_") {
        let (base, num) = (&name[..i], &name[i + 4..]);
        if !base.is_empty() && !num.is_empty() && num.bytes().all(|b| b.is_ascii_digit()) {
            return joaat(base).wrapping_add(1);
        }
    }
    joaat(name)
}

/// Tamanhos das páginas de memória do resource, da maior para a menor.
fn page_sizes(flags: u32) -> Vec<usize> {
    let base = 0x200usize << (flags & 0xF);
    let counts = [
        (8, (flags >> 4) & 0x1),
        (7, (flags >> 5) & 0x3),
        (6, (flags >> 7) & 0xF),
        (5, (flags >> 11) & 0x3F),
        (4, (flags >> 17) & 0x7F),
        (3, (flags >> 24) & 1),
        (2, (flags >> 25) & 1),
        (1, (flags >> 26) & 1),
        (0, (flags >> 27) & 1),
    ];
    counts
        .iter()
        .flat_map(|&(k, n)| std::iter::repeat(base << k).take(n as usize))
        .collect()
}

fn strip_name(raw: &str) -> &str {
    let s = raw.strip_prefix("pack:/").unwrap_or(raw);
    s.strip_suffix(".clip").unwrap_or(s)
}

pub struct Ycd {
    header: Vec<u8>,
    sys_flags: u32,
    data: Vec<u8>,
    sys_size: usize,
    table: u64,
    cap: u16,
    entries: Vec<(usize, usize)>, // (offset da entrada, offset do clip)
}

impl Ycd {
    pub fn load(path: &Path) -> R<Self> {
        let raw = std::fs::read(path).map_err(|e| format!("não consegui ler o arquivo: {e}"))?;
        Self::parse(&raw)
    }

    pub fn parse(raw: &[u8]) -> R<Self> {
        if raw.len() < 16 || &raw[..4] != b"RSC7" {
            return Err("não é um resource RSC7 (arquivo corrompido ou formato diferente)".into());
        }
        let sys_flags = u32::from_le_bytes(raw[8..12].try_into().unwrap());
        let mut data = Vec::new();
        if DeflateDecoder::new(&raw[16..]).read_to_end(&mut data).is_err() {
            data.clear();
            ZlibDecoder::new(&raw[16..])
                .read_to_end(&mut data)
                .map_err(|_| "não consegui descompactar o arquivo".to_string())?;
        }
        let mut y = Ycd {
            header: raw[..16].to_vec(),
            sys_flags,
            data,
            sys_size: page_sizes(sys_flags).iter().sum(),
            table: 0,
            cap: 0,
            entries: Vec::new(),
        };

        // hash table: cada bucket aponta para uma lista de entradas {hash, clip, next}
        y.table = y.u64(CLIPS_PTR)?;
        y.cap = y.u16(CLIPS_PTR + 8)?;
        let count = y.u16(CLIPS_PTR + 10)? as usize;
        let t = if y.cap > 0 { y.off(y.table)? } else { 0 };
        for i in 0..y.cap as usize {
            let mut ep = y.u64(t + i * 8)?;
            while ep != 0 {
                if y.entries.len() > count {
                    return Err("estrutura de clips inesperada".into());
                }
                let e = y.off(ep)?;
                let clip = y.off(y.u64(e + 8)?)?;
                y.entries.push((e, clip));
                ep = y.u64(e + 0x10)?;
            }
        }
        if y.entries.len() != count {
            return Err("estrutura de clips inesperada".into());
        }
        Ok(y)
    }

    fn bytes<const N: usize>(&self, o: usize) -> R<[u8; N]> {
        self.data
            .get(o..o + N)
            .map(|b| b.try_into().unwrap())
            .ok_or_else(|| "leitura fora do arquivo".to_string())
    }
    fn u64(&self, o: usize) -> R<u64> {
        Ok(u64::from_le_bytes(self.bytes(o)?))
    }
    fn u32(&self, o: usize) -> R<u32> {
        Ok(u32::from_le_bytes(self.bytes(o)?))
    }
    fn u16(&self, o: usize) -> R<u16> {
        Ok(u16::from_le_bytes(self.bytes(o)?))
    }
    fn write(&mut self, o: usize, b: &[u8]) -> R<()> {
        self.data
            .get_mut(o..o + b.len())
            .ok_or_else(|| "escrita fora do arquivo".to_string())?
            .copy_from_slice(b);
        Ok(())
    }

    fn off(&self, ptr: u64) -> R<usize> {
        if !(SYS_BASE..SYS_BASE + self.sys_size as u64).contains(&ptr) {
            return Err("ponteiro inválido no arquivo".into());
        }
        Ok((ptr - SYS_BASE) as usize)
    }

    fn clip_name_raw(&self, clip: usize) -> R<String> {
        let ptr = self.u64(clip + 0x18)?;
        let len = self.u16(clip + 0x20)? as usize;
        let o = self.off(ptr)?;
        let b = self.data.get(o..o + len).ok_or("nome de clip fora do arquivo")?;
        String::from_utf8(b.to_vec()).map_err(|_| "nome de clip com codificação inválida".into())
    }

    pub fn anims(&self) -> R<Vec<String>> {
        self.entries
            .iter()
            .map(|&(_, clip)| self.clip_name_raw(clip).map(|n| strip_name(&n).to_string()))
            .collect()
    }

    /// Espaço livre no fim da última página usada (as páginas não são contíguas na memória).
    fn alloc_tail(&self, size: usize) -> R<usize> {
        let sys = &self.data[..self.sys_size.min(self.data.len())];
        let used = sys.iter().rposition(|&b| b != 0).map_or(0, |i| i + 1);
        let start = (used + 64 + 15) & !15; // margem de segurança após o último byte usado
        let mut page_end = 0;
        for p in page_sizes(self.sys_flags) {
            page_end += p;
            if used <= page_end {
                break;
            }
        }
        if start + size > page_end || start + size > self.data.len() {
            return Err("sem espaço livre no arquivo para um nome tão longo; use um nome mais curto".into());
        }
        Ok(start)
    }

    pub fn rename(&mut self, old: &str, new: &str) -> R<()> {
        if self.anims()?.iter().any(|a| a == new) {
            return Err(format!("já existe uma anim chamada \"{new}\""));
        }
        for i in 0..self.entries.len() {
            let (entry, clip) = self.entries[i];
            let raw = self.clip_name_raw(clip)?;
            if strip_name(&raw) != old {
                continue;
            }
            let mut new_raw = String::new();
            if raw.starts_with("pack:/") {
                new_raw.push_str("pack:/");
            }
            new_raw.push_str(new);
            if raw.ends_with(".clip") {
                new_raw.push_str(".clip");
            }
            let mut enc = new_raw.into_bytes();
            enc.push(0);

            let mut ptr = self.u64(clip + 0x18)?;
            let mut cap = self.u16(clip + 0x22)? as usize;
            if enc.len() <= cap {
                // cabe no lugar do nome antigo
                let o = self.off(ptr)?;
                let mut padded = enc.clone();
                padded.resize(cap, 0);
                self.write(o, &padded)?;
            } else {
                let o = self.alloc_tail(enc.len())?;
                self.write(o, &enc)?;
                ptr = SYS_BASE + o as u64;
                cap = enc.len();
            }
            if cap > u16::MAX as usize {
                return Err("nome longo demais".into());
            }
            self.write(clip + 0x18, &ptr.to_le_bytes())?;
            self.write(clip + 0x20, &((enc.len() - 1) as u16).to_le_bytes())?;
            self.write(clip + 0x22, &(cap as u16).to_le_bytes())?;
            self.write(entry, &clip_hash(new).to_le_bytes())?;
            return self.rebuild_table();
        }
        Err(format!("anim \"{old}\" não encontrada"))
    }

    /// O jogo procura o clip no bucket hash % capacidade, então reencadeia tudo.
    fn rebuild_table(&mut self) -> R<()> {
        if self.cap == 0 {
            return Ok(());
        }
        let t = self.off(self.table)?;
        let cap = self.cap as usize;
        self.write(t, &vec![0u8; cap * 8])?;
        let mut tails: HashMap<usize, usize> = HashMap::new();
        for i in 0..self.entries.len() {
            let entry = self.entries[i].0;
            let b = self.u32(entry)? as usize % cap;
            self.write(entry + 0x10, &0u64.to_le_bytes())?;
            let link = tails.get(&b).map_or(t + b * 8, |&tail| tail + 0x10);
            self.write(link, &(SYS_BASE + entry as u64).to_le_bytes())?;
            tails.insert(b, entry);
        }
        Ok(())
    }

    pub fn to_bytes(&self) -> R<Vec<u8>> {
        let mut enc = DeflateEncoder::new(self.header.clone(), Compression::best());
        enc.write_all(&self.data).map_err(|e| e.to_string())?;
        enc.finish().map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes() {
        assert_eq!(joaat("player_zero"), 0xD7114C9);
        assert_eq!(clip_hash("prop_uv_0"), joaat("prop").wrapping_add(1));
        assert_eq!(clip_hash("prop_uv_x"), joaat("prop_uv_x"));
    }

    /// Roda contra um .ycd real: `YCD_SAMPLE=caminho cargo test -- --nocapture`
    #[test]
    fn roundtrip_sample() {
        let Ok(p) = std::env::var("YCD_SAMPLE") else { return };
        let mut y = Ycd::load(Path::new(&p)).unwrap();
        let anims = y.anims().unwrap();
        println!("anims: {anims:?}");
        let first = anims[0].clone();
        let long = format!("{first}_renomeada_com_um_nome_bem_mais_longo");
        y.rename(&first, &long).unwrap();
        let bytes = y.to_bytes().unwrap();
        if let Ok(out) = std::env::var("YCD_OUT") {
            std::fs::write(out, &bytes).unwrap();
        }
        let back = Ycd::parse(&bytes).unwrap();
        let got = back.anims().unwrap();
        assert!(got.contains(&long));
        assert_eq!(got.len(), anims.len());
        // cada entrada precisa estar no bucket certo (é assim que o jogo acha o clip)
        let t = back.off(back.table).unwrap();
        for b in 0..back.cap as usize {
            let mut ep = back.u64(t + b * 8).unwrap();
            while ep != 0 {
                let e = back.off(ep).unwrap();
                assert_eq!(back.u32(e).unwrap() as usize % back.cap as usize, b);
                ep = back.u64(e + 0x10).unwrap();
            }
        }
    }
}
