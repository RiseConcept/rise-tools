//! YCD Editor: lista e renomeia o dict e as anims de arquivos .ycd.
//! Ações:
//!   open { paths: [arquivo | pasta] }                      -> { files: [YcdFile] }
//!   save { path, dict, renames: [{ from, to }] }           -> { file: YcdFile }

mod ycd;

use crate::tool::{parse, to_value, Tool, ToolManifest, ToolResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use ycd::Ycd;

pub struct YcdEditor;

impl Tool for YcdEditor {
    fn manifest(&self) -> ToolManifest {
        ToolManifest { id: "ycd-editor", version: "1.0.0", actions: &["open", "save"] }
    }

    fn invoke(&self, action: &str, payload: Value) -> ToolResult {
        match action {
            "open" => to_value(open(parse(payload)?)),
            "save" => to_value(save(parse(payload)?)?),
            _ => unreachable!(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct YcdFile {
    path: String,
    name: String,
    dict: String,
    anims: Vec<String>,
    error: Option<String>,
}

fn read_file(path: &Path) -> YcdFile {
    let result = Ycd::load(path).and_then(|y| y.anims());
    let (anims, error) = match result {
        Ok(a) => (a, None),
        Err(e) => (vec![], Some(e)),
    };
    YcdFile {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        dict: path.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        anims,
        error,
    }
}

fn is_ycd(p: &Path) -> bool {
    p.extension().is_some_and(|e| e.eq_ignore_ascii_case("ycd"))
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut items: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
    items.sort();
    for p in items {
        if p.is_dir() {
            collect(&p, out);
        } else if is_ycd(&p) {
            out.push(p);
        }
    }
}

#[derive(Deserialize)]
struct OpenReq {
    paths: Vec<String>,
}

#[derive(Serialize)]
struct OpenRes {
    files: Vec<YcdFile>,
}

fn open(req: OpenReq) -> OpenRes {
    let mut paths = Vec::new();
    for p in req.paths.iter().map(PathBuf::from) {
        if p.is_dir() {
            collect(&p, &mut paths);
        } else if is_ycd(&p) {
            paths.push(p);
        }
    }
    paths.dedup();
    OpenRes { files: paths.iter().map(|p| read_file(p)).collect() }
}

#[derive(Deserialize)]
struct Rename {
    from: String,
    to: String,
}

#[derive(Deserialize)]
struct SaveReq {
    path: String,
    dict: String,
    renames: Vec<Rename>,
}

#[derive(Serialize)]
struct SaveRes {
    file: YcdFile,
}

fn validate_name(kind: &str, name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err(format!("{kind} não pode ficar vazio"));
    }
    if let Some(c) = name.chars().find(|c| c.is_whitespace() || !c.is_ascii() || "/\\:*?\"<>|".contains(*c)) {
        return Err(format!("{kind} \"{name}\" tem um caractere inválido: '{c}'"));
    }
    Ok(())
}

fn save(req: SaveReq) -> Result<SaveRes, String> {
    let src = PathBuf::from(&req.path);
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dict = req.dict.trim();
    validate_name("o nome do dict", dict)?;

    let mut y = Ycd::load(&src)?;
    let mut changed = dict != stem;
    for r in req.renames.iter().filter(|r| r.from != r.to) {
        validate_name("o nome da anim", &r.to)?;
        y.rename(&r.from, &r.to)?;
        changed = true;
    }
    if !changed {
        return Err("nada foi alterado".into());
    }

    let dir = src.parent().unwrap_or(Path::new("."));
    let mut out = dir.join(format!("{dict}.ycd"));
    if out == src || out.to_string_lossy().eq_ignore_ascii_case(&src.to_string_lossy()) {
        out = dir.join(format!("{dict}_novo.ycd"));
    }
    if out.exists() {
        return Err(format!(
            "{} já existe, não vou sobrescrever",
            out.file_name().unwrap().to_string_lossy()
        ));
    }
    std::fs::write(&out, y.to_bytes()?).map_err(|e| format!("não consegui salvar: {e}"))?;

    // relê o arquivo salvo para conferir
    let file = read_file(&out);
    if let Some(e) = &file.error {
        let _ = std::fs::remove_file(&out);
        return Err(format!("o arquivo salvo não passou na conferência: {e}"));
    }
    Ok(SaveRes { file })
}
