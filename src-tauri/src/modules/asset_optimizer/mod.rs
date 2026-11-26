//! Asset Optimizer: audita o peso dos assets de streaming e otimiza texturas (.ytd).
//! Ações:
//!   scan    { paths }                                   -> { root, assets: [Asset] }
//!   inspect { path, options }                           -> { physical, physicalAfter, textures: [TexInfo] }
//!   plan    { paths, options }                          -> { files: [FilePlan] }
//!   optimize{ paths, options, root, backupDir }         -> { files: [FileResult] }
//!   restore { backupDir }                               -> { restored, errors }
//!
//! Otimizar sobrescreve o .ytd, mas só depois de: montar o arquivo novo, relê-lo para conferir
//! e copiar o original para `backupDir` (que fica fora da pasta do servidor).

mod pixels;
mod ytd;

use crate::formats::rsc7;
use crate::tool::{parse, to_value, Tool, ToolManifest, ToolResult};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use ytd::{Op, Options, Ytd};

pub struct AssetOptimizer;

impl Tool for AssetOptimizer {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            id: "asset-optimizer",
            version: "1.0.0",
            actions: &["scan", "inspect", "plan", "optimize", "restore"],
        }
    }

    fn invoke(&self, action: &str, payload: Value) -> ToolResult {
        match action {
            "scan" => to_value(scan(parse(payload)?)),
            "inspect" => to_value(inspect(parse(payload)?)?),
            "plan" => to_value(plan(parse(payload)?)),
            "optimize" => to_value(optimize(parse(payload)?)?),
            "restore" => to_value(restore(parse(payload)?)?),
            _ => unreachable!(),
        }
    }
}

const KINDS: [&str; 4] = ["ytd", "ydr", "ydd", "yft"];
/// Pastas que não são assets do servidor (o cache do FiveM duplica tudo de stream/).
const SKIP_DIRS: [&str; 4] = ["cache", ".git", "node_modules", "_5mtools_backup"];

fn kind(p: &Path) -> Option<String> {
    let e = p.extension()?.to_str()?.to_ascii_lowercase();
    KINDS.contains(&e.as_str()).then_some(e)
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_dir() {
            let n = e.file_name().to_string_lossy().to_ascii_lowercase();
            if !SKIP_DIRS.contains(&n.as_str()) {
                collect(&p, out);
            }
        } else if kind(&p).is_some() {
            out.push(p);
        }
    }
}

fn common_root(paths: &[PathBuf]) -> PathBuf {
    let dirs: Vec<&Path> = paths
        .iter()
        .map(|p| if p.is_dir() { p.as_path() } else { p.parent().unwrap_or(p) })
        .collect();
    let mut root: Vec<Component> = dirs.first().map(|d| d.components().collect()).unwrap_or_default();
    for d in &dirs[1.min(dirs.len())..] {
        let c: Vec<Component> = d.components().collect();
        let n = root.iter().zip(&c).take_while(|(a, b)| a == b).count();
        root.truncate(n);
    }
    root.iter().collect()
}

fn rel(path: &Path, root: &Path) -> PathBuf {
    path.strip_prefix(root).map(Path::to_path_buf).unwrap_or_else(|_| {
        // fora da raiz: usa o caminho completo sem a letra do drive
        path.components()
            .filter_map(|c| match c {
                Component::Normal(s) => Some(s),
                _ => None,
            })
            .collect()
    })
}

fn slash(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

/* ---------- scan ---------- */

#[derive(Deserialize)]
struct ScanReq {
    paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Asset {
    path: String,
    /// pasta relativa à raiz (com "/")
    dir: String,
    name: String,
    kind: String,
    file_size: u64,
    virtual_size: u64,
    physical: u64,
    error: Option<String>,
}

#[derive(Serialize)]
struct ScanRes {
    root: String,
    assets: Vec<Asset>,
}

fn read_header(path: &Path) -> Result<rsc7::Header, String> {
    let mut b = [0u8; 16];
    std::fs::File::open(path)
        .and_then(|mut f| f.read_exact(&mut b))
        .map_err(|e| format!("não consegui ler: {e}"))?;
    rsc7::Header::parse(&b)
}

fn scan(req: ScanReq) -> ScanRes {
    let inputs: Vec<PathBuf> = req.paths.iter().map(PathBuf::from).collect();
    let root = common_root(&inputs);
    let mut files = vec![];
    for p in &inputs {
        if p.is_dir() {
            collect(p, &mut files);
        } else if kind(p).is_some() {
            files.push(p.clone());
        }
    }
    files.sort();
    files.dedup();
    // só o cabeçalho (16 bytes) de cada arquivo: rápido mesmo com milhares
    let assets = files
        .par_iter()
        .map(|p| {
            let file_size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            let (virtual_size, physical, error) = match read_header(p) {
                Ok(h) => (h.virtual_size() as u64, h.physical_size() as u64, None),
                Err(e) => (0, 0, Some(e)),
            };
            Asset {
                path: p.to_string_lossy().into_owned(),
                dir: rel(p, &root).parent().map(slash).unwrap_or_default(),
                name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                kind: kind(p).unwrap_or_default(),
                file_size,
                virtual_size,
                physical,
                error,
            }
        })
        .collect();
    ScanRes { root: root.to_string_lossy().into_owned(), assets }
}

/* ---------- inspect ---------- */

#[derive(Deserialize)]
struct InspectReq {
    path: String,
    options: Options,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TexState {
    width: u32,
    height: u32,
    format: String,
    levels: u32,
    size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TexInfo {
    name: String,
    before: TexState,
    /// null quando a textura não muda
    after: Option<TexState>,
    steps: Vec<String>,
    note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InspectRes {
    physical: usize,
    physical_after: usize,
    /// false quando o arquivo tem dados não reconhecidos e não será alterado
    editable: bool,
    textures: Vec<TexInfo>,
}

fn inspect(req: InspectReq) -> Result<InspectRes, String> {
    let y = Ytd::load(Path::new(&req.path))?;
    let plans = y.plan_all(&req.options);
    let editable = y.safe();
    let textures = y
        .textures
        .iter()
        .zip(&plans)
        .map(|(t, p)| TexInfo {
            name: t.name.clone(),
            before: TexState {
                width: t.width,
                height: t.height,
                format: pixels::name(t.format),
                levels: t.levels,
                size: pixels::known(t.format).then(|| pixels::data_size(t.format, t.width, t.height, 0, t.levels)).unwrap_or(0),
            },
            after: (editable && p.op != Op::Keep).then(|| TexState {
                width: p.width,
                height: p.height,
                format: pixels::name(p.format),
                levels: p.levels,
                size: p.size,
            }),
            steps: p.steps.clone(),
            note: p.note.clone(),
        })
        .collect();
    let physical = y.header.physical_size();
    Ok(InspectRes {
        physical,
        physical_after: if editable { y.physical_after(&plans)? } else { physical },
        editable,
        textures,
    })
}

/* ---------- plan ---------- */

/// Reescreve só quando o resultado fica menor (texturas mudaram e/ou havia dados órfãos).
fn worth(plans: &[ytd::Plan], before: usize, after: usize) -> bool {
    after < before || (after == before && plans.iter().any(|p| p.op != Op::Keep))
}

#[derive(Deserialize)]
struct PlanReq {
    paths: Vec<String>,
    options: Options,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct FilePlan {
    path: String,
    physical: usize,
    physical_after: usize,
    textures: usize,
    resized: usize,
    converted: usize,
    /// bytes de pixels que nenhuma textura usa e que somem ao otimizar
    orphan: usize,
    notes: Vec<String>,
    error: Option<String>,
}

fn plan_file(path: &str, o: &Options) -> FilePlan {
    let mut fp = FilePlan { path: path.into(), ..Default::default() };
    let y = match Ytd::load(Path::new(path)) {
        Ok(y) => y,
        Err(e) => {
            fp.error = Some(e);
            return fp;
        }
    };
    fp.physical = y.header.physical_size();
    fp.physical_after = fp.physical;
    fp.textures = y.textures.len();
    if !y.safe() {
        fp.notes.push("tem estruturas que o otimizador não reconhece: será mantido".into());
        return fp;
    }
    fp.orphan = y.orphan_bytes();
    let plans = y.plan_all(o);
    for (t, p) in y.textures.iter().zip(&plans) {
        if (p.width, p.height) != (t.width, t.height) {
            fp.resized += 1;
        }
        if p.format != t.format {
            fp.converted += 1;
        }
        if let Some(n) = &p.note {
            if !fp.notes.contains(n) {
                fp.notes.push(n.clone());
            }
        }
    }
    match y.physical_after(&plans) {
        Ok(s) if worth(&plans, fp.physical, s) => fp.physical_after = s,
        Ok(_) => {}
        Err(e) => fp.error = Some(e),
    }
    fp
}

fn plan(req: PlanReq) -> Value {
    let files: Vec<FilePlan> = req.paths.par_iter().map(|p| plan_file(p, &req.options)).collect();
    serde_json::json!({ "files": files })
}

/* ---------- optimize ---------- */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OptimizeReq {
    paths: Vec<String>,
    options: Options,
    root: String,
    backup_dir: String,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    root: String,
    created: u64,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct FileResult {
    path: String,
    /// "optimized" | "unchanged" | "error"
    status: &'static str,
    error: Option<String>,
    size_before: u64,
    size_after: u64,
    physical_before: usize,
    physical_after: usize,
}

fn optimize_file(path: &Path, o: &Options, root: &Path, backup: &Path) -> FileResult {
    let mut r = FileResult { path: path.to_string_lossy().into_owned(), status: "error", ..Default::default() };
    let run = |r: &mut FileResult| -> Result<(), String> {
        let raw = std::fs::read(path).map_err(|e| format!("não consegui ler: {e}"))?;
        r.size_before = raw.len() as u64;
        r.size_after = r.size_before;
        let y = Ytd::parse(&raw)?;
        r.physical_before = y.header.physical_size();
        r.physical_after = r.physical_before;
        let plans = y.plan_all(o);
        if !y.safe() || !worth(&plans, r.physical_before, y.physical_after(&plans)?) {
            r.status = "unchanged";
            return Ok(());
        }
        let bytes = y.rebuild(&plans)?;

        // confere o resultado antes de tocar no disco
        let check = Ytd::parse(&bytes).map_err(|e| format!("o arquivo novo não passou na conferência: {e}"))?;
        let same = check.textures.len() == y.textures.len()
            && check.safe()
            && check.orphan_bytes() == 0
            && check.textures.iter().zip(&plans).all(|(t, p)| (t.width, t.height, t.format, t.levels) == (p.width, p.height, p.format, p.levels));
        if !same {
            return Err("o arquivo novo não passou na conferência; original mantido".into());
        }

        // backup do original (se já existe, é o original de uma rodada anterior: mantém)
        let dest = backup.join(rel(path, root));
        if !dest.exists() {
            if let Some(d) = dest.parent() {
                std::fs::create_dir_all(d).map_err(|e| format!("não consegui criar o backup: {e}"))?;
            }
            std::fs::write(&dest, &raw).map_err(|e| format!("não consegui criar o backup: {e}"))?;
        }

        // troca atômica: escreve ao lado e renomeia por cima
        let tmp = path.with_extension("ytd.5mtools-tmp");
        std::fs::write(&tmp, &bytes).map_err(|e| format!("não consegui gravar: {e}"))?;
        if let Err(e) = std::fs::rename(&tmp, path) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("não consegui substituir o arquivo (está aberto no servidor ou em outro programa?): {e}"));
        }
        r.size_after = bytes.len() as u64;
        r.physical_after = check.header.physical_size();
        r.status = "optimized";
        Ok(())
    };
    if let Err(e) = run(&mut r) {
        r.status = "error";
        r.error = Some(e);
    }
    r
}

fn optimize(req: OptimizeReq) -> Result<Value, String> {
    let root = PathBuf::from(&req.root);
    let backup = PathBuf::from(&req.backup_dir);
    std::fs::create_dir_all(&backup).map_err(|e| format!("não consegui criar a pasta de backup: {e}"))?;
    let manifest = backup.join("manifest.json");
    if !manifest.exists() {
        let created = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let m = Manifest { root: req.root.clone(), created };
        std::fs::write(&manifest, serde_json::to_vec_pretty(&m).unwrap()).map_err(|e| format!("não consegui criar o backup: {e}"))?;
    }
    let files: Vec<FileResult> = req
        .paths
        .par_iter()
        .map(|p| optimize_file(Path::new(p), &req.options, &root, &backup))
        .collect();
    Ok(serde_json::json!({ "files": files }))
}

/* ---------- restore ---------- */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreReq {
    backup_dir: String,
}

#[derive(Serialize)]
struct RestoreRes {
    restored: usize,
    errors: Vec<String>,
}

fn restore(req: RestoreReq) -> Result<RestoreRes, String> {
    let backup = PathBuf::from(&req.backup_dir);
    let m: Manifest = std::fs::read(backup.join("manifest.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or("essa pasta não é um backup do Asset Optimizer (falta o manifest.json)")?;
    let root = PathBuf::from(&m.root);
    let mut files = vec![];
    collect(&backup, &mut files);
    let mut res = RestoreRes { restored: 0, errors: vec![] };
    for f in files {
        let dest = root.join(f.strip_prefix(&backup).unwrap());
        match std::fs::copy(&f, &dest) {
            Ok(_) => res.restored += 1,
            Err(e) => res.errors.push(format!("{}: {e}", dest.display())),
        }
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    fn file_name(p: &str) -> &str { p.rsplit(['/', '\\']).next().unwrap() }

    /// E2E_DIR=<cópia descartável de uma pasta com .ytd> cargo test --release e2e -- --nocapture
    #[test]
    fn e2e_scan_plan_optimize_restore() {
        let Ok(dir) = std::env::var("E2E_DIR") else { return };
        let backup = format!("{dir}_backup");
        let _ = std::fs::remove_dir_all(&backup);
        let opts = Options { max_size: 1024, bc3_to_bc1: true, compress_raw: true };

        let t = Instant::now();
        let s = scan(ScanReq { paths: vec![dir.clone()] });
        println!("scan: {} assets em {:?}", s.assets.len(), t.elapsed());
        let paths: Vec<String> = s.assets.iter().filter(|a| a.kind == "ytd").map(|a| a.path.clone()).collect();
        let originals: Vec<Vec<u8>> = paths.iter().map(|p| std::fs::read(p).unwrap()).collect();

        let t = Instant::now();
        let plans: Vec<FilePlan> = paths.par_iter().map(|p| plan_file(p, &opts)).collect();
        let todo: Vec<String> = plans.iter().filter(|p| p.physical_after < p.physical).map(|p| p.path.clone()).collect();
        println!("plan: {} de {} mudam, em {:?}", todo.len(), paths.len(), t.elapsed());

        let t = Instant::now();
        let mut results = vec![];
        for chunk in todo.chunks(4) {
            let v = optimize(OptimizeReq { paths: chunk.to_vec(), options: opts, root: s.root.clone(), backup_dir: backup.clone() }).unwrap();
            results.extend(v["files"].as_array().unwrap().clone());
        }
        let ok = results.iter().filter(|r| r["status"] == "optimized").count();
        let errs: Vec<_> = results.iter().filter(|r| r["status"] == "error").collect();
        println!("optimize: {ok} otimizados, {} erros, em {:?}", errs.len(), t.elapsed());
        for e in &errs {
            println!("  ERRO {}: {}", e["path"], e["error"]);
        }
        // o plano bate com o resultado
        for r in &results {
            let p = plans.iter().find(|p| p.path == r["path"].as_str().unwrap()).unwrap();
            assert_eq!(r["physicalAfter"].as_u64().unwrap() as usize, p.physical_after, "{}", p.path);
        }
        // rodar de novo não muda nada (idempotente)
        let again: Vec<FilePlan> = todo.par_iter().map(|p| plan_file(p, &opts)).collect();
        for p in again.iter().filter(|p| p.physical_after != p.physical) {
            let y = Ytd::load(Path::new(&p.path)).unwrap();
            for (t, pl) in y.textures.iter().zip(y.plan_all(&opts)) {
                if pl.op != Op::Keep {
                    println!("  2a rodada {}: {} {}x{} {} -> {:?} {:?}", file_name(&p.path), t.name, t.width, t.height, pixels::name(t.format), pl.op, pl.steps);
                }
            }
            println!("  {} {} -> {} órfãos={}", file_name(&p.path), p.physical, p.physical_after, p.orphan);
        }
        assert!(again.iter().all(|p| p.physical_after == p.physical), "a segunda rodada ainda mudaria algo");

        let r = restore(RestoreReq { backup_dir: backup.clone() }).unwrap();
        println!("restore: {} restaurados, {} erros", r.restored, r.errors.len());
        for (p, orig) in paths.iter().zip(&originals) {
            assert_eq!(&std::fs::read(p).unwrap(), orig, "{p} não voltou igual");
        }
        assert!(!std::fs::read_dir(&dir).unwrap().flatten().any(|e| e.path().to_string_lossy().contains("5mtools-tmp")));
    }
}
