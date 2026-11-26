//! Formatos de arquivo do GTA V usados por mais de uma ferramenta.

pub mod rsc7;

/// Hash Jenkins one-at-a-time que o jogo usa para nomes (sem diferenciar maiúsculas).
pub fn joaat(s: &str) -> u32 {
    let mut h: u32 = 0;
    for c in s.bytes().map(|b| b.to_ascii_lowercase()) {
        h = h.wrapping_add(c as u32);
        h = h.wrapping_add(h << 10);
        h ^= h >> 6;
    }
    h = h.wrapping_add(h << 3);
    h ^= h >> 11;
    h.wrapping_add(h << 15)
}
