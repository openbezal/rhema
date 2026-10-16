use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

use crate::document_files::{
    read_json_document, save_document_at, suggested_file_name, validate_document, DocumentFormat,
    ImportedDocument,
};

/// Paths are selected natively; the webview cannot request an arbitrary write.
#[tauri::command]
pub async fn save_export_document(
    app: tauri::AppHandle,
    content: String,
    format: DocumentFormat,
    default_name: String,
) -> Result<bool, String> {
    validate_document(&content, format)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Export document")
        .set_file_name(suggested_file_name(&default_name, format))
        .add_filter("Document", &[format.extension()]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let (send, receive) = oneshot::channel();
    dialog.save_file(move |selected| {
        let _ = send.send(selected);
    });
    let selected = receive.await.map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(false);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || save_document_at(&path, &content, format))
        .await
        .map_err(|error| error.to_string())??;
    Ok(true)
}

/// Read a bounded JSON document chosen by the operator; cancellation is distinct.
#[tauri::command]
pub async fn read_import_document(
    app: tauri::AppHandle,
) -> Result<Option<ImportedDocument>, String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Import JSON document")
        .add_filter("JSON", &["json"]);
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.set_parent(&window);
    }
    let (send, receive) = oneshot::channel();
    dialog.pick_file(move |selected| {
        let _ = send.send(selected);
    });
    let selected = receive.await.map_err(|error| error.to_string())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || read_json_document(&path).map(Some))
        .await
        .map_err(|error| error.to_string())?
}
