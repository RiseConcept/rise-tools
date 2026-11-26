//! Núcleo modular: cada ferramenta implementa `Tool` e é registrada em `modules::all()`.
//! O front fala com todas por um único comando (`tool_invoke`), então adicionar,
//! remover ou editar uma ferramenta nunca exige mexer nas outras nem no núcleo.

use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::Arc;

pub type ToolResult = Result<Value, String>;

#[derive(Serialize, Clone)]
pub struct ToolManifest {
    pub id: &'static str,
    pub version: &'static str,
    /// Ações que o módulo aceita em `tool_invoke` (documentação e validação).
    pub actions: &'static [&'static str],
}

pub trait Tool: Send + Sync {
    fn manifest(&self) -> ToolManifest;
    fn invoke(&self, action: &str, payload: Value) -> ToolResult;
}

pub struct Registry {
    tools: BTreeMap<&'static str, Arc<dyn Tool>>,
}

impl Registry {
    pub fn new(tools: Vec<Arc<dyn Tool>>) -> Self {
        let mut map = BTreeMap::new();
        for t in tools {
            let id = t.manifest().id;
            if map.insert(id, t).is_some() {
                panic!("módulo duplicado: {id}");
            }
        }
        Self { tools: map }
    }

    pub fn manifests(&self) -> Vec<ToolManifest> {
        self.tools.values().map(|t| t.manifest()).collect()
    }

    /// Executa a ação isolando falhas: um módulo com bug devolve erro, não derruba o app.
    pub fn invoke(&self, id: &str, action: &str, payload: Value) -> ToolResult {
        let tool = self
            .tools
            .get(id)
            .ok_or_else(|| format!("ferramenta \"{id}\" não está instalada"))?;
        if !tool.manifest().actions.contains(&action) {
            return Err(format!("ação \"{action}\" não existe em \"{id}\""));
        }
        catch_unwind(AssertUnwindSafe(|| tool.invoke(action, payload)))
            .unwrap_or_else(|_| Err(format!("falha interna em \"{id}\" ao executar \"{action}\"")))
    }
}

/// Lê o payload como o tipo de entrada da ação.
pub fn parse<T: serde::de::DeserializeOwned>(payload: Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|e| format!("dados inválidos: {e}"))
}

pub fn to_value<T: Serialize>(v: T) -> ToolResult {
    serde_json::to_value(v).map_err(|e| e.to_string())
}
