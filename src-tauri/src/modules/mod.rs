//! Lista de ferramentas instaladas. Para adicionar uma: crie `modules/<nome>/mod.rs`
//! com uma struct que implementa `tool::Tool`, declare o `mod` abaixo e inclua-a em `all()`.
//! Para remover: apague a pasta e as duas linhas correspondentes.

use crate::tool::Tool;
use std::sync::Arc;

pub mod asset_optimizer;
pub mod asset_renamer;
pub mod ycd_editor;

pub fn all() -> Vec<Arc<dyn Tool>> {
    vec![Arc::new(ycd_editor::YcdEditor), Arc::new(asset_optimizer::AssetOptimizer), Arc::new(asset_renamer::AssetRenamer)]
}
