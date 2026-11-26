//! Regra de busca e troca do Asset Renamer.
//!
//! Por padrão o texto só é encontrado como "pedaço de nome": as bordas precisam ser o começo/fim
//! ou um caractere que não é letra nem número (`_`, `-`, `+`, `.`, `/`, aspas…). Assim `carro`
//! acha `prop_carro_01` e `carro+hi`, mas não `scarro` nem `carros`.
//! Busca sem diferenciar maiúsculas; a troca opera em bytes ASCII, então funciona em qualquer
//! arquivo de texto compatível com ASCII (UTF-8, Latin-1).

use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Replace,
    Prefix,
    Suffix,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub find: String,
    pub mode: Mode,
    pub text: String,
    /// também acha dentro de palavras (`car` em `scar`)
    #[serde(default)]
    pub partial: bool,
}

pub struct Matcher {
    find: Vec<u8>,
    mode: Mode,
    text: Vec<u8>,
    partial: bool,
}

fn word(b: u8) -> bool {
    b.is_ascii_alphanumeric()
}

/// Caracteres aceitos em nomes de asset.
pub fn valid_name(s: &str) -> Result<(), String> {
    match s.chars().find(|c| !(c.is_ascii_alphanumeric() || "_-+.".contains(*c))) {
        Some(c) => Err(format!("caractere inválido: \"{}\"", if c == ' ' { "espaço".into() } else { c.to_string() })),
        None => Ok(()),
    }
}

impl Matcher {
    pub fn new(r: &Rule) -> Result<Self, String> {
        let find = r.find.trim();
        let text = r.text.trim();
        if find.is_empty() {
            return Err("informe o texto a procurar".into());
        }
        valid_name(find).map_err(|e| format!("texto a procurar: {e}"))?;
        if text.is_empty() {
            return Err(match r.mode {
                Mode::Replace => "informe o texto novo",
                Mode::Prefix => "informe o prefixo",
                Mode::Suffix => "informe o sufixo",
            }
            .into());
        }
        valid_name(text).map_err(|e| format!("texto novo: {e}"))?;
        if r.mode == Mode::Replace && text.eq_ignore_ascii_case(find) && text == find {
            return Err("o texto novo é igual ao procurado".into());
        }
        Ok(Self {
            find: find.as_bytes().to_ascii_lowercase(),
            mode: r.mode,
            text: text.as_bytes().to_vec(),
            partial: r.partial,
        })
    }

    /// Início de cada ocorrência.
    pub fn find_all(&self, s: &[u8]) -> Vec<usize> {
        let n = self.find.len();
        let mut out = vec![];
        let mut i = 0;
        while i + n <= s.len() {
            let hit = s[i..i + n].eq_ignore_ascii_case(&self.find)
                && (self.partial || ((i == 0 || !word(s[i - 1])) && (i + n == s.len() || !word(s[i + n]))));
            if hit {
                out.push(i);
                i += n;
            } else {
                i += 1;
            }
        }
        out
    }

    /// Aplica a troca. Devolve o resultado e quantas ocorrências foram trocadas.
    pub fn apply(&self, s: &[u8]) -> (Vec<u8>, usize) {
        let hits = self.find_all(s);
        if hits.is_empty() {
            return (s.to_vec(), 0);
        }
        let n = self.find.len();
        let mut out = Vec::with_capacity(s.len() + hits.len() * self.text.len());
        let mut at = 0;
        for &i in &hits {
            out.extend_from_slice(&s[at..i]);
            let found = &s[i..i + n];
            match self.mode {
                Mode::Replace => out.extend_from_slice(&self.text),
                Mode::Prefix => {
                    out.extend_from_slice(&self.text);
                    out.extend_from_slice(found);
                }
                Mode::Suffix => {
                    out.extend_from_slice(found);
                    out.extend_from_slice(&self.text);
                }
            }
            at = i + n;
        }
        out.extend_from_slice(&s[at..]);
        (out, hits.len())
    }

    pub fn rename(&self, name: &str) -> Option<String> {
        let (out, n) = self.apply(name.as_bytes());
        (n > 0).then(|| String::from_utf8_lossy(&out).into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(find: &str, mode: Mode, text: &str, partial: bool) -> Matcher {
        Matcher::new(&Rule { find: find.into(), mode, text: text.into(), partial }).unwrap()
    }

    #[test]
    fn borders() {
        let r = m("carro", Mode::Replace, "moto", false);
        assert_eq!(r.rename("prop_carro_01").as_deref(), Some("prop_moto_01"));
        assert_eq!(r.rename("Carro+hi").as_deref(), Some("moto+hi"));
        assert_eq!(r.rename("carro").as_deref(), Some("moto"));
        assert_eq!(r.rename("scarro"), None);
        assert_eq!(r.rename("carros"), None);
        assert_eq!(r.rename("carro2"), None);
        let p = m("carro", Mode::Replace, "moto", true);
        assert_eq!(p.rename("carros").as_deref(), Some("motos"));
    }

    #[test]
    fn prefix_suffix_keep_case() {
        assert_eq!(m("carro", Mode::Prefix, "x_", false).rename("CARRO_hi").as_deref(), Some("x_CARRO_hi"));
        assert_eq!(m("carro", Mode::Suffix, "_v2", false).rename("prop_carro").as_deref(), Some("prop_carro_v2"));
    }

    #[test]
    fn text() {
        let r = m("carro", Mode::Replace, "moto", false);
        let (out, n) = r.apply(b"<modelName>carro</modelName>\n'stream/carro.ytyp' scarro");
        assert_eq!(n, 2);
        assert_eq!(out, b"<modelName>moto</modelName>\n'stream/moto.ytyp' scarro");
    }

    #[test]
    fn invalid() {
        assert!(Matcher::new(&Rule { find: "a b".into(), mode: Mode::Replace, text: "x".into(), partial: false }).is_err());
        assert!(Matcher::new(&Rule { find: "a".into(), mode: Mode::Replace, text: "x/y".into(), partial: false }).is_err());
    }
}
