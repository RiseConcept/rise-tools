//! Asset Renamer: troca um nome em todos os assets de uma pasta, de forma consistente.
//! Ações:
//!   plan    { root, find, mode, text, partial, scripts }              -> Plan
//!   apply   { root, find, mode, text, partial, scripts, backupDir }   -> { renamed, edited, backupDir }
//!   restore { backupDir }                                             -> { restored }
//!
//! Renomeia arquivos, atualiza .meta/.xml/.json/fxmanifest (e .lua/.js se pedido) e troca os
//! hashes dos nomes dentro de .ytyp/.ymap. Tudo vai para o backup antes; se algo falhar no meio,
//! o que já foi feito é desfeito sozinho.

mod matcher;
mod plan;

use crate::tool::{parse, to_value, Tool, ToolManifest, ToolResult};
use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;

pub struct AssetRenamer;

impl Tool for AssetRenamer {
    fn manifest(&self) -> ToolManifest {
        ToolManifest { id: "asset-renamer", version: "1.0.0", actions: &["plan", "apply", "restore"] }
    }

    fn invoke(&self, action: &str, payload: Value) -> ToolResult {
        match action {
            "plan" => {
                let req: plan::Request = parse(payload)?;
                to_value(plan::compute(&req)?.plan)
            }
            "apply" => {
                let req: ApplyReq = parse(payload)?;
                let dir = PathBuf::from(&req.backup_dir);
                std::fs::create_dir_all(&dir).map_err(|e| format!("não consegui criar a pasta de backup: {e}"))?;
                to_value(plan::apply(&req.req, &dir)?)
            }
            "restore" => {
                let req: RestoreReq = parse(payload)?;
                let n = plan::restore(&PathBuf::from(&req.backup_dir))?;
                Ok(serde_json::json!({ "restored": n }))
            }
            _ => unreachable!(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyReq {
    #[serde(flatten)]
    req: plan::Request,
    backup_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreReq {
    backup_dir: String,
}

#[cfg(test)]
mod tests {
    use super::matcher::{Mode, Rule};
    use super::plan::{self, Request};
    use crate::formats::{joaat, rsc7};
    use std::collections::{BTreeMap, HashSet};
    use std::path::{Path, PathBuf};

    fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut out = BTreeMap::new();
        let mut stack = vec![root.to_path_buf()];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p)
                } else {
                    out.insert(plan::rel(&p, root), std::fs::read(&p).unwrap());
                }
            }
        }
        out
    }

    fn meta_resource(hashes: &[u32]) -> Vec<u8> {
        let mut body = vec![0u8; 0x100];
        for (i, h) in hashes.iter().enumerate() {
            body[0x10 + i * 8..0x14 + i * 8].copy_from_slice(&h.to_le_bytes());
        }
        let (_, flags) = rsc7::layout(&[body.len()], true, 128).unwrap();
        body.resize(rsc7::flags_size(flags), 0);
        let mut out = rsc7::Header { version: 2, sys_flags: flags, gfx_flags: 0 }.to_bytes().to_vec();
        out.extend(rsc7::deflate(&body).unwrap());
        out
    }

    fn words(raw: &[u8]) -> Vec<u32> {
        let Ok(h) = rsc7::Header::parse(raw) else { return vec![] }; // criptografado: fica de fora
        let d = rsc7::inflate(raw, h.virtual_size() + h.physical_size()).unwrap();
        d.chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect()
    }

    fn req(root: &Path, find: &str, text: &str) -> Request {
        Request {
            root: root.to_string_lossy().into(),
            rule: Rule { find: find.into(), mode: Mode::Replace, text: text.into(), partial: false },
            scripts: false,
        }
    }

    #[test]
    fn synthetic_rename_and_undo() {
        let base = std::env::temp_dir().join(format!("5mtools-renamer-{}", std::process::id()));
        let root = base.join("res");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(root.join("stream")).unwrap();
        std::fs::write(root.join("fxmanifest.lua"), "data_file 'DLC_ITYP_REQUEST' 'stream/carro.ytyp'\n").unwrap();
        std::fs::write(root.join("vehicles.meta"), "<modelName>carro</modelName>\n<txdName>carro</txdName>\n<x>scarro</x>\n").unwrap();
        std::fs::write(root.join("client.lua"), "local m = 'carro'\n").unwrap();
        std::fs::write(root.join("stream/prop_carro_01.ydr"), b"ydr").unwrap();
        std::fs::write(root.join("stream/scarro.ydr"), b"outro").unwrap();
        let other = joaat("prop_poste");
        std::fs::write(root.join("stream/carro.ytyp"), meta_resource(&[joaat("prop_carro_01"), joaat("carro"), other])).unwrap();
        let before = snapshot(&root);

        let p = plan::compute(&req(&root, "carro", "moto")).unwrap().plan;
        let mut renames: Vec<_> = p.renames.iter().map(|r| (r.from.clone(), r.to.clone())).collect();
        renames.sort();
        assert_eq!(renames, vec![
            ("stream/carro.ytyp".to_string(), "stream/moto.ytyp".to_string()),
            ("stream/prop_carro_01.ydr".to_string(), "stream/prop_moto_01.ydr".to_string()),
        ]);
        assert_eq!(p.conflicts, 0);
        let edited: Vec<_> = p.edits.iter().map(|e| (e.path.as_str(), e.kind, e.count)).collect();
        assert_eq!(edited, vec![("fxmanifest.lua", "text", 1), ("stream/carro.ytyp", "hash", 2), ("vehicles.meta", "text", 2)]);
        assert!(p.skipped.iter().any(|s| s.path == "client.lua"));

        let backup = base.join("backup");
        std::fs::create_dir_all(&backup).unwrap();
        plan::apply(&req(&root, "carro", "moto"), &backup).unwrap();
        assert_eq!(std::fs::read_to_string(root.join("fxmanifest.lua")).unwrap(), "data_file 'DLC_ITYP_REQUEST' 'stream/moto.ytyp'\n");
        assert!(std::fs::read_to_string(root.join("vehicles.meta")).unwrap().contains("<x>scarro</x>"));
        assert_eq!(std::fs::read_to_string(root.join("client.lua")).unwrap(), "local m = 'carro'\n");
        let w: Vec<u32> = words(&std::fs::read(root.join("stream/moto.ytyp")).unwrap()).into_iter().filter(|&v| v != 0).collect();
        assert_eq!(w, vec![joaat("prop_moto_01"), joaat("moto"), other]);
        assert!(root.join("stream/scarro.ydr").exists() && !root.join("stream/carro.ytyp").exists());

        // conflito: o nome de destino já existe
        std::fs::write(root.join("stream/prop_moto_02.ydr"), b"x").unwrap();
        std::fs::write(root.join("stream/prop_moto_x_02.ydr"), b"x").unwrap();
        assert_eq!(plan::compute(&req(&root, "moto_x", "moto")).unwrap().plan.conflicts, 1);
        assert!(plan::apply(&req(&root, "moto_x", "moto"), &base.join("b2")).is_err());
        std::fs::remove_file(root.join("stream/prop_moto_02.ydr")).unwrap();
        std::fs::remove_file(root.join("stream/prop_moto_x_02.ydr")).unwrap();

        plan::restore(&backup).unwrap();
        assert_eq!(snapshot(&root), before, "desfazer não voltou tudo igual");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// RENAME_DIR=<cópia descartável> RENAME_FIND=x RENAME_TO=y cargo test real_resource -- --nocapture
    #[test]
    fn real_resource() {
        let (Ok(dir), Ok(find), Ok(to)) = (std::env::var("RENAME_DIR"), std::env::var("RENAME_FIND"), std::env::var("RENAME_TO")) else {
            return;
        };
        let root = PathBuf::from(&dir);
        let before = snapshot(&root);
        let c = plan::compute(&req(&root, &find, &to)).unwrap();
        let p = &c.plan;
        println!(
            "{} arquivos | {} nomes | {} renomeados | {} editados | {} ignorados | {} conflitos",
            p.total_files, p.names.len(), p.renames.len(), p.edits.len(), p.skipped.len(), p.conflicts
        );
        for e in p.edits.iter().take(10) {
            println!("  {} {} x{} {:?}", e.kind, e.path, e.count, e.names.iter().take(3).collect::<Vec<_>>());
        }
        for s in &p.skipped {
            println!("  ignorado {}: {}", s.path, s.reason);
        }

        // referências por hash: as antigas somem e viram exatamente a mesma quantidade de novas
        let olds: HashSet<u32> = c.hash_map.keys().copied().collect();
        let news: HashSet<u32> = c.hash_map.values().copied().collect();
        let count = |files: &BTreeMap<String, Vec<u8>>, set: &HashSet<u32>| -> usize {
            files
                .iter()
                .filter(|(k, _)| k.ends_with(".ytyp") || k.ends_with(".ymap"))
                .map(|(_, raw)| words(raw).iter().filter(|v| set.contains(v)).count())
                .sum()
        };
        let old_before = count(&before, &olds);
        let new_before = count(&before, &news);

        let backup = root.with_file_name("renamer_backup");
        let _ = std::fs::remove_dir_all(&backup);
        std::fs::create_dir_all(&backup).unwrap();
        let t = std::time::Instant::now();
        plan::apply(&req(&root, &find, &to), &backup).unwrap();
        println!("aplicado em {:?}", t.elapsed());
        let after = snapshot(&root);
        assert_eq!(count(&after, &olds), 0, "sobrou hash antigo");
        assert_eq!(count(&after, &news), old_before + new_before, "quantidade de referências mudou");
        assert_eq!(after.len(), before.len());
        assert!(plan::compute(&req(&root, &find, &to)).unwrap().plan.renames.is_empty(), "ainda haveria o que renomear");

        plan::restore(&backup).unwrap();
        assert_eq!(snapshot(&root), before, "desfazer não voltou tudo igual");
        let _ = std::fs::remove_dir_all(&backup);
        println!("referências por hash trocadas: {old_before} | desfazer: idêntico ao original");
    }
}
