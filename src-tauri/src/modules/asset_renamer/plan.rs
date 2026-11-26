//! Plano de renomeação: o que muda em cada arquivo, calculado sem tocar em nada.
//! A gravação recalcula o mesmo plano e executa, com backup e desfazer automático em caso de erro.

use super::matcher::{Matcher, Rule};
use crate::formats::{joaat, rsc7};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

pub type R<T> = Result<T, String>;

const SKIP_DIRS: [&str; 3] = ["cache", ".git", "node_modules"];
/// Arquivos de dados: sempre atualizados (referenciam nomes e caminhos de assets).
const DATA_EXT: [&str; 3] = ["meta", "xml", "json"];
/// Scripts: só com a opção ligada.
const SCRIPT_EXT: [&str; 2] = ["lua", "js"];
/// Manifestos são dados (listam os arquivos), nunca renomeados.
const MANIFESTS: [&str; 2] = ["fxmanifest.lua", "__resource.lua"];
/// Resources binários em que os nomes ficam como hash e são trocados no lugar.
const HASH_EXT: [&str; 2] = ["ytyp", "ymap"];
const MAX_TEXT: u64 = 16 * 1024 * 1024;
const SAMPLES: usize = 4;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub root: String,
    #[serde(flatten)]
    pub rule: Rule,
    #[serde(default)]
    pub scripts: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NameChange {
    pub from: String,
    pub to: String,
    pub from_hash: String,
    pub to_hash: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileRename {
    pub from: String,
    pub to: String,
    pub conflict: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub line: usize,
    pub before: String,
    pub after: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEdit {
    pub path: String,
    /// "text" | "hash"
    pub kind: &'static str,
    pub count: usize,
    pub samples: Vec<Sample>,
    /// nomes trocados (arquivos com hash)
    pub names: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    pub path: String,
    pub reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub root: String,
    pub total_files: usize,
    pub names: Vec<NameChange>,
    pub renames: Vec<FileRename>,
    pub edits: Vec<FileEdit>,
    pub skipped: Vec<Skipped>,
    pub conflicts: usize,
}

fn ext(p: &Path) -> String {
    p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn rel(p: &Path, root: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        let p = e.path();
        if ft.is_dir() {
            if !SKIP_DIRS.contains(&e.file_name().to_string_lossy().to_ascii_lowercase().as_str()) {
                collect(&p, out);
            }
        } else if ft.is_file() {
            out.push(p);
        }
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Kind {
    Data,
    Script,
    Hash,
    Other,
}

fn kind(p: &Path) -> Kind {
    let e = ext(p);
    if MANIFESTS.contains(&file_name(p).to_ascii_lowercase().as_str()) || DATA_EXT.contains(&e.as_str()) {
        Kind::Data
    } else if SCRIPT_EXT.contains(&e.as_str()) {
        Kind::Script
    } else if HASH_EXT.contains(&e.as_str()) {
        Kind::Hash
    } else {
        Kind::Other
    }
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Sequências que podem ser nome de asset num arquivo de texto.
fn tokens(data: &[u8], out: &mut HashSet<String>) {
    for t in data.split(|&b| !(b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'+')) {
        if !t.is_empty() && t.len() <= 128 {
            out.insert(String::from_utf8_lossy(t).into_owned());
        }
    }
}

fn is_text(data: &[u8]) -> bool {
    !(data.starts_with(&[0xFF, 0xFE]) || data.starts_with(&[0xFE, 0xFF]) || data.iter().take(8192).any(|&b| b == 0))
}

fn samples(m: &Matcher, data: &[u8]) -> Vec<Sample> {
    let cut = |l: &[u8]| {
        let s = String::from_utf8_lossy(l).trim().to_string();
        if s.chars().count() > 160 { s.chars().take(160).collect::<String>() + "…" } else { s }
    };
    data.split(|&b| b == b'\n')
        .enumerate()
        .filter(|(_, l)| !m.find_all(l).is_empty())
        .take(SAMPLES)
        .map(|(i, l)| Sample { line: i + 1, before: cut(l), after: cut(&m.apply(l).0) })
        .collect()
}

/// Troca hashes (u32 alinhados, little-endian) dentro de um resource RSC7. Devolve o arquivo novo,
/// os dados descompactados esperados (para conferência) e os hashes trocados.
pub fn patch_hashes(raw: &[u8], map: &HashMap<u32, u32>) -> R<(Vec<u8>, Vec<u8>, Vec<u32>)> {
    let h = rsc7::Header::parse(raw)?;
    let mut data = rsc7::inflate(raw, h.virtual_size() + h.physical_size())?;
    let mut hit = vec![];
    for c in data.chunks_exact_mut(4) {
        let v = u32::from_le_bytes(c.try_into().unwrap());
        if let Some(&n) = map.get(&v) {
            c.copy_from_slice(&n.to_le_bytes());
            hit.push(v);
        }
    }
    let mut out = h.to_bytes().to_vec();
    out.extend(rsc7::deflate(&data)?);
    Ok((out, data, hit))
}

pub struct Computed {
    pub plan: Plan,
    pub hash_map: HashMap<u32, u32>,
    pub matcher: Matcher,
}

pub fn compute(req: &Request) -> R<Computed> {
    let m = Matcher::new(&req.rule)?;
    let root = PathBuf::from(&req.root);
    if !root.is_dir() {
        return Err("pasta não encontrada".into());
    }
    let mut files = vec![];
    collect(&root, &mut files);
    files.sort();

    // 1) nomes conhecidos: nomes dos arquivos + identificadores dos arquivos de dados/scripts
    let texts: Vec<(PathBuf, Kind, Option<Vec<u8>>)> = files
        .par_iter()
        .filter_map(|p| {
            let k = kind(p);
            if k != Kind::Data && k != Kind::Script {
                return None;
            }
            let ok = std::fs::metadata(p).map(|md| md.len() <= MAX_TEXT).unwrap_or(false);
            let data = ok.then(|| std::fs::read(p).ok()).flatten().filter(|d| is_text(d));
            Some((p.clone(), k, data))
        })
        .collect();
    let mut known: HashSet<String> = files.iter().map(|p| stem(p)).collect();
    for (_, _, d) in &texts {
        if let Some(d) = d {
            tokens(d, &mut known);
        }
    }
    let mut names: BTreeMap<String, NameChange> = BTreeMap::new();
    let mut hash_map = HashMap::new();
    for k in &known {
        if let Some(to) = m.rename(k) {
            let (a, b) = (joaat(k), joaat(&to));
            if a != b {
                hash_map.insert(a, b);
            }
            names.entry(k.to_ascii_lowercase()).or_insert(NameChange {
                from: k.clone(),
                to,
                from_hash: format!("0x{a:08X}"),
                to_hash: format!("0x{b:08X}"),
            });
        }
    }

    // 2) arquivos renomeados e conflitos
    let existing: HashSet<String> = files.iter().map(|p| p.to_string_lossy().to_ascii_lowercase()).collect();
    let mut renames = vec![];
    let mut targets: HashMap<String, usize> = HashMap::new();
    let leaving: HashSet<String> = files
        .iter()
        .filter(|p| !MANIFESTS.contains(&file_name(p).to_ascii_lowercase().as_str()) && m.rename(&stem(p)).is_some())
        .map(|p| p.to_string_lossy().to_ascii_lowercase())
        .collect();
    for p in &files {
        if !leaving.contains(&p.to_string_lossy().to_ascii_lowercase()) {
            continue;
        }
        let to_stem = m.rename(&stem(p)).unwrap();
        let e = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
        let to = p.with_file_name(format!("{to_stem}{e}"));
        let key = to.to_string_lossy().to_ascii_lowercase();
        let same_file = key == p.to_string_lossy().to_ascii_lowercase();
        let conflict = if !same_file && existing.contains(&key) && !leaving.contains(&key) {
            Some(format!("{} já existe", file_name(&to)))
        } else {
            None
        };
        *targets.entry(rel(&to, &root).to_ascii_lowercase()).or_insert(0) += 1;
        renames.push(FileRename { from: rel(p, &root), to: rel(&to, &root), conflict });
    }
    for r in &mut renames {
        if r.conflict.is_none() && targets.get(&r.to.to_ascii_lowercase()).copied().unwrap_or(0) > 1 {
            r.conflict = Some("dois arquivos ficariam com o mesmo nome".into());
        }
    }

    // 3) conteúdo: textos e hashes
    let mut edits = vec![];
    let mut skipped = vec![];
    for (p, k, data) in &texts {
        let Some(d) = data else {
            skipped.push(Skipped { path: rel(p, &root), reason: "não é texto simples (UTF-16 ou binário) ou é grande demais".into() });
            continue;
        };
        let count = m.find_all(d).len();
        if count == 0 {
            continue;
        }
        if *k == Kind::Script && !req.scripts {
            skipped.push(Skipped {
                path: rel(p, &root),
                reason: format!("script com {count} {}: ligue \"Atualizar scripts\" para alterar", if count == 1 { "ocorrência" } else { "ocorrências" }),
            });
            continue;
        }
        edits.push(FileEdit { path: rel(p, &root), kind: "text", count, samples: samples(&m, d), names: vec![] });
    }
    let by_hash: HashMap<u32, String> = names.values().map(|n| (joaat(&n.from), n.from.clone())).collect();
    let hashed: Vec<(PathBuf, R<Vec<u32>>)> = files
        .par_iter()
        .filter(|p| kind(p) == Kind::Hash)
        .map(|p| {
            let r = std::fs::read(p).map_err(|e| e.to_string()).and_then(|raw| patch_hashes(&raw, &hash_map).map(|(_, _, h)| h));
            (p.clone(), r)
        })
        .collect();
    for (p, r) in hashed {
        match r {
            Ok(h) if !h.is_empty() => {
                let mut n: Vec<String> = h.iter().filter_map(|v| by_hash.get(v).cloned()).collect::<HashSet<_>>().into_iter().collect();
                n.sort();
                edits.push(FileEdit { path: rel(&p, &root), kind: "hash", count: h.len(), samples: vec![], names: n });
            }
            Ok(_) => {}
            Err(_) => skipped.push(Skipped {
                path: rel(&p, &root),
                reason: "criptografado ou em formato desconhecido: as referências dentro dele não serão atualizadas".into(),
            }),
        }
    }
    // formatos que referenciam nomes mas não são alterados
    for p in &files {
        let e = ext(p);
        if e == "ymf" || e == "ymt" {
            let raw = std::fs::read(p).unwrap_or_default();
            let mentions = !m.find_all(stem(p).as_bytes()).is_empty()
                || raw.chunks_exact(4).any(|c| {
                    let le = u32::from_le_bytes(c.try_into().unwrap());
                    let be = u32::from_be_bytes(c.try_into().unwrap());
                    hash_map.contains_key(&le) || hash_map.contains_key(&be)
                });
            if mentions {
                skipped.push(Skipped {
                    path: rel(p, &root),
                    reason: format!(".{e} não é suportado e cita nomes renomeados: atualize no CodeWalker"),
                });
            }
        }
    }
    if files.iter().any(|p| ext(p) == "fxap") {
        skipped.push(Skipped {
            path: ".fxap".into(),
            reason: "resource protegido pelo Asset Escrow: arquivos criptografados não podem ser alterados e renomeá-los pode quebrar a proteção".into(),
        });
    }
    edits.sort_by(|a, b| a.path.cmp(&b.path));
    skipped.sort_by(|a, b| a.path.cmp(&b.path));

    let conflicts = renames.iter().filter(|r| r.conflict.is_some()).count();
    Ok(Computed {
        plan: Plan {
            root: req.root.clone(),
            total_files: files.len(),
            names: names.into_values().collect(),
            renames,
            edits,
            skipped,
            conflicts,
        },
        hash_map,
        matcher: m,
    })
}

/* ---------- gravação ---------- */

#[derive(Serialize, Deserialize)]
pub struct Entry {
    pub original: String,
    pub current: String,
}

#[derive(Serialize, Deserialize)]
pub struct Manifest {
    pub tool: String,
    pub root: String,
    pub created: u64,
    pub entries: Vec<Entry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub renamed: usize,
    pub edited: usize,
    pub backup_dir: String,
}

fn write_atomic(path: &Path, bytes: &[u8]) -> R<()> {
    let tmp = path.with_file_name(format!("{}.5mtools-tmp", file_name(path)));
    std::fs::write(&tmp, bytes).map_err(|e| format!("não consegui gravar {}: {e}", file_name(path)))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("não consegui substituir {} (aberto em outro programa?): {e}", file_name(path))
    })
}

pub fn apply(req: &Request, backup_dir: &Path) -> R<Applied> {
    let c = compute(req)?;
    let plan = &c.plan;
    if plan.conflicts > 0 {
        return Err("há conflitos de nome; resolva antes de renomear".into());
    }
    if plan.renames.is_empty() && plan.edits.is_empty() {
        return Err("nada a alterar".into());
    }
    let root = PathBuf::from(&plan.root);

    // backup de tudo que vai mudar, antes de qualquer alteração
    let renamed: HashMap<&str, &str> = plan.renames.iter().map(|r| (r.from.as_str(), r.to.as_str())).collect();
    let mut touched: Vec<&str> = plan.renames.iter().map(|r| r.from.as_str()).chain(plan.edits.iter().map(|e| e.path.as_str())).collect();
    touched.sort();
    touched.dedup();
    let files_dir = backup_dir.join("files");
    for t in &touched {
        let dest = files_dir.join(t);
        std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| format!("não consegui criar o backup: {e}"))?;
        std::fs::copy(root.join(t), &dest).map_err(|e| format!("não consegui copiar {t} para o backup: {e}"))?;
    }
    let manifest = Manifest {
        tool: "asset-renamer".into(),
        root: plan.root.clone(),
        created: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        entries: touched.iter().map(|t| Entry { original: t.to_string(), current: renamed.get(t).unwrap_or(t).to_string() }).collect(),
    };
    std::fs::write(backup_dir.join("manifest.json"), serde_json::to_vec_pretty(&manifest).unwrap())
        .map_err(|e| format!("não consegui criar o backup: {e}"))?;

    let run = || -> R<()> {
        // conteúdo primeiro (nos caminhos antigos), depois os nomes
        for e in &plan.edits {
            let p = root.join(&e.path);
            let raw = std::fs::read(&p).map_err(|er| format!("não consegui ler {}: {er}", e.path))?;
            let out = if e.kind == "hash" {
                let (out, expected, _) = patch_hashes(&raw, &c.hash_map)?;
                let h = rsc7::Header::parse(&out)?;
                if rsc7::inflate(&out, h.virtual_size() + h.physical_size())? != expected {
                    return Err(format!("{} não passou na conferência", e.path));
                }
                out
            } else {
                c.matcher.apply(&raw).0
            };
            write_atomic(&p, &out)?;
        }
        for r in &plan.renames {
            let (from, to) = (root.join(&r.from), root.join(&r.to));
            if r.from.eq_ignore_ascii_case(&r.to) {
                // só muda maiúsculas: o Windows precisa de um nome intermediário
                let mid = from.with_file_name(format!("{}.5mtools-case", file_name(&from)));
                std::fs::rename(&from, &mid).and_then(|_| std::fs::rename(&mid, &to))
            } else if to.exists() {
                return Err(format!("{} já existe", r.to));
            } else {
                std::fs::rename(&from, &to)
            }
            .map_err(|e| format!("não consegui renomear {}: {e}", r.from))?;
        }
        Ok(())
    };
    if let Err(e) = run() {
        let undo = restore(backup_dir);
        return Err(match undo {
            Ok(_) => format!("{e}. Tudo foi desfeito; nenhum arquivo ficou alterado."),
            Err(u) => format!("{e}. Ao desfazer: {u}. Os originais estão em {}", backup_dir.display()),
        });
    }
    Ok(Applied { renamed: plan.renames.len(), edited: plan.edits.len(), backup_dir: backup_dir.to_string_lossy().into_owned() })
}

/// Volta tudo como era: apaga os arquivos com nome novo e recoloca os originais.
pub fn restore(backup_dir: &Path) -> R<usize> {
    let m: Manifest = std::fs::read(backup_dir.join("manifest.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .filter(|m: &Manifest| m.tool == "asset-renamer")
        .ok_or("essa pasta não é um backup do Asset Renamer")?;
    let root = PathBuf::from(&m.root);
    let mut errors = vec![];
    for e in &m.entries {
        let cur = root.join(&e.current);
        let orig = root.join(&e.original);
        if e.current != e.original && cur.exists() {
            let r = if e.current.eq_ignore_ascii_case(&e.original) {
                std::fs::rename(&cur, &orig)
            } else {
                std::fs::remove_file(&cur)
            };
            if let Err(er) = r {
                errors.push(format!("{}: {er}", e.current));
            }
        }
    }
    let mut n = 0;
    for e in &m.entries {
        match std::fs::copy(backup_dir.join("files").join(&e.original), root.join(&e.original)) {
            Ok(_) => n += 1,
            Err(er) => errors.push(format!("{}: {er}", e.original)),
        }
    }
    if errors.is_empty() { Ok(n) } else { Err(errors.join("; ")) }
}
