mod tool;
mod formats;
mod modules;

use tool::{Registry, ToolManifest};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
fn tools_list(registry: State<'_, Arc<Registry>>) -> Vec<ToolManifest> {
    registry.manifests()
}

/// Ponto único de entrada para qualquer ferramenta. Roda fora da thread da UI.
#[tauri::command]
async fn tool_invoke(
    registry: State<'_, Arc<Registry>>,
    tool: String,
    action: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        registry.invoke(&tool, &action, payload.unwrap_or(Value::Null))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = Arc::new(Registry::new(modules::all()));
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(registry)
        .invoke_handler(tauri::generate_handler![tools_list, tool_invoke])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
