mod commands;
mod events;
mod memstats;
mod state;

use std::sync::Mutex;

#[expect(clippy::too_many_lines, reason = "app setup is inherently complex")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file — try src-tauri/.env first, then project root ../.env
    dotenvy::dotenv().ok();
    dotenvy::from_filename("../.env").ok();
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("rhema".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Mutex::new(state::AppState::new()))
        .manage(Mutex::new(rhema_detection::DetectionPipeline::new()))
        .manage(Mutex::new(rhema_broadcast::ndi::NdiRuntime::default()))
        .manage(Mutex::new(rhema_detection::DirectDetector::new()))
        .manage(Mutex::new(rhema_detection::DetectionMerger::new()))
        .manage(Mutex::new(rhema_detection::ReadingMode::new()))
        .manage(Mutex::new(commands::remote::OscRuntime::new()))
        .manage(Mutex::new(commands::remote::HttpRuntime::new()))
        .invoke_handler(tauri::generate_handler![
            commands::bible::list_translations,
            commands::bible::list_books,
            commands::bible::get_chapter,
            commands::bible::get_verse,
            commands::bible::search_verses,
            commands::bible::get_translation_verses_for_search,
            commands::bible::get_cross_references,
            commands::bible::get_active_translation,
            commands::bible::set_active_translation,
            commands::detection::detect_verses,
            commands::detection::detection_status,
            commands::detection::ui_mark,
            commands::detection::semantic_search,
            commands::detection::reading_mode_status,
            commands::detection::stop_reading_mode,
            commands::audio::get_audio_devices,
            commands::audio::start_audio_test,
            commands::audio::stop_audio_test,
            commands::stt::start_transcription,
            commands::stt::stop_transcription,
            commands::broadcast::list_monitors,
            commands::broadcast::ensure_broadcast_window,
            commands::broadcast::open_broadcast_window,
            commands::broadcast::close_broadcast_window,
            commands::broadcast::start_ndi,
            commands::broadcast::stop_ndi,
            commands::broadcast::get_ndi_status,
            commands::broadcast::push_ndi_frame,
            commands::fonts::list_system_fonts,
            commands::remote::start_osc,
            commands::remote::stop_osc,
            commands::remote::get_osc_status,
            commands::remote::start_http,
            commands::remote::stop_http,
            commands::remote::get_http_status,
            commands::remote::update_remote_status,
        ])
        .setup(|app| {
            use tauri::Manager;

            memstats::spawn();

            // Point the NDI runtime at the bundled resource dir (production).
            // The source-checkout path stays as a fallback inside the crate.
            if let Ok(resource_dir) = app.path().resource_dir() {
                let managed_ndi = app.state::<Mutex<rhema_broadcast::ndi::NdiRuntime>>();
                let mut ndi = managed_ndi.lock().unwrap();
                ndi.set_library_search_dirs(vec![resource_dir]);
            }

            // Try resource dir first (production), then dev fallback
            let db_path = app
                .path()
                .resource_dir()
                .map(|p| p.join("rhema.db"))
                .ok()
                .filter(|p| p.exists())
                .unwrap_or_else(|| {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../data/rhema.db")
                });

            if db_path.exists() {
                let bible_db = rhema_bible::BibleDb::open(&db_path)
                    .expect("Failed to open Bible database");

                let managed_state = app.state::<Mutex<state::AppState>>();
                let mut state = managed_state.lock().unwrap();
                state.bible_db = Some(bible_db);
                drop(state);
                log::info!("Bible database loaded from {}", db_path.display());
            } else {
                log::warn!("Bible database not found at {}", db_path.display());
            }

            // Try to load ONNX embedding model and pre-computed verse index
            // Prefer INT8 quantized model (~571MB) over FP32 (~2.4GB)
            let base_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
            let model_path = {
                let int8 = base_dir.join("models/qwen3-embedding-0.6b-int8/model_quantized.onnx");
                let fp32 = base_dir.join("models/qwen3-embedding-0.6b/model.onnx");
                if int8.exists() {
                    log::info!("Using INT8 quantized ONNX model");
                    int8
                } else if fp32.exists() {
                    log::info!("Using FP32 ONNX model (INT8 not found)");
                    fp32
                } else {
                    fp32
                }
            };
            let tokenizer_path = base_dir.join("models/qwen3-embedding-0.6b/tokenizer.json");
            let embeddings_path = base_dir.join("embeddings/kjv-qwen3-0.6b.bin");
            let ids_path = base_dir.join("embeddings/kjv-qwen3-0.6b-ids.bin");

            if model_path.exists() && tokenizer_path.exists() {
                use rhema_detection::semantic::embedder::TextEmbedder;
                use rhema_detection::semantic::index::VectorIndex;
                match rhema_detection::OnnxEmbedder::load(&model_path, &tokenizer_path) {
                    Ok(embedder) => {
                        log::info!("ONNX embedding model loaded");
                        let managed_pipeline = app.state::<Mutex<rhema_detection::DetectionPipeline>>();
                        let mut pipeline = managed_pipeline.lock().unwrap();

                        // If pre-computed embeddings exist, load the vector index
                        if embeddings_path.exists() && ids_path.exists() {
                            let dim = embedder.dimension();
                            match rhema_detection::HnswVectorIndex::load(&embeddings_path, &ids_path, dim) {
                                Ok(index) => {
                                    log::info!("Verse embeddings loaded ({} vectors)", index.len());
                                    if let Some(warning) =
                                        check_embedding_provenance(&embeddings_path, &model_path)
                                    {
                                        // Surface in the UI (warning banner via detection_status).
                                        set_embedding_warning(app.handle(), warning);
                                    }
                                    pipeline.set_semantic(
                                        rhema_detection::SemanticDetector::new(
                                            Box::new(embedder),
                                            Box::new(index),
                                        ),
                                    );
                                    drop(pipeline);
                                    // The sidecar can be missing (indexes built before it
                                    // existed) or wrong — verify EMPIRICALLY in the
                                    // background: a matched index finds a verse's own text
                                    // at ~1.0 similarity; the historical mismatched index
                                    // scored ~0.65. One ONNX embed, off the startup path.
                                    spawn_embedding_self_check(app.handle().clone());
                                }
                                Err(e) => {
                                    log::warn!("Failed to load verse embeddings: {e}");
                                }
                            }
                        } else {
                            log::info!(
                                "Embedding re-ranking not installed (optional) — keyword + reference \
                                 search fully functional. Opt in with 'bun run setup:all --with-embedding'."
                            );
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to load ONNX model: {e}");
                    }
                }
            } else {
                log::info!(
                    "Embedding re-ranking not installed (optional) — keyword + reference \
                     search fully functional. Opt in with 'bun run setup:all --with-embedding'."
                );
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Store an embedding warning in `AppState` (read by `detection_status`)
/// and push it to the webview so the banner appears without a reload.
fn set_embedding_warning(app: &tauri::AppHandle, warning: String) {
    use tauri::{Emitter, Manager};
    let managed_state = app.state::<Mutex<state::AppState>>();
    managed_state.lock().unwrap().embedding_warning = Some(warning.clone());
    let _ = app.emit("embedding_warning", warning);
}

/// Empirical index verification, run in the background after startup.
///
/// Embeds one known verse's exact KJV text and asks the index for its
/// nearest neighbour. A healthy index returns that same verse at ~1.0
/// cosine; the historical mismatched index (built with a different
/// model/pooling) scored ~0.65. This needs no provenance sidecar, so it
/// catches the most common broken state in the wild: an old index with no
/// `meta.json` at all.
fn spawn_embedding_self_check(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
            // John 3:16 KJV — present in every index build.
            let (verse_id, verse_text) = {
                let managed_state = app.state::<Mutex<state::AppState>>();
                let app_state = managed_state.lock().unwrap();
                let Some(db) = app_state.bible_db.as_ref() else { return };
                match db.get_verse(1, 43, 3, 16) {
                    Ok(Some(v)) => (v.id, v.text),
                    _ => return,
                }
            };

            let top_hit = {
                let managed_pipeline =
                    app.state::<Mutex<rhema_detection::DetectionPipeline>>();
                let mut pipeline = managed_pipeline.lock().unwrap();
                if !pipeline.has_semantic() {
                    return;
                }
                pipeline.semantic_search(&verse_text, 1).into_iter().next()
            };

            match top_hit {
                Some((id, similarity)) if id == verse_id && similarity >= 0.98 => {
                    log::info!(
                        "Embedding index self-check OK (self-similarity {similarity:.4})"
                    );
                }
                other => {
                    let observed = other.map_or_else(
                        || "no result".to_string(),
                        |(id, sim)| format!("verse_id {id} at {sim:.2}"),
                    );
                    let warning = format!(
                        "Semantic search index failed verification: a test verse should \
                         match its own embedding at ~1.0 similarity but returned {observed}. \
                         The index was built with a different model than the app is running, \
                         so semantic results will be unreliable. Fix: delete \
                         embeddings/kjv-qwen3-0.6b* and run `bun run setup:all --with-embedding`."
                    );
                    log::warn!("{warning}");
                    set_embedding_warning(&app, warning);
                }
            }
        })
        .await;
    });
}

/// Compare the embeddings' provenance sidecar (written by the precompute
/// bin) against the ONNX model actually loaded. A mismatched index silently
/// wrecks vector-search accuracy — the shipped pre-2025 index scored
/// cosine ~0.65 against its own verses because it was built with a
/// different model/prefix than the runtime.
///
/// Returns a user-facing warning message when the index provably mismatches
/// the loaded model (surfaced as a UI banner); `None` otherwise.
fn check_embedding_provenance(
    embeddings_path: &std::path::Path,
    model_path: &std::path::Path,
) -> Option<String> {
    let meta_path = embeddings_path.with_extension("meta.json");
    // Missing/unreadable sidecar is informational only (e.g. assets built
    // before the sidecar existed). The loud warning is reserved for the one
    // real hazard: an index provably built with a DIFFERENT model.
    let Ok(raw) = std::fs::read_to_string(&meta_path) else {
        log::info!(
            "No embeddings provenance sidecar at {} — cannot verify the index matches the model. \
             Regenerating refreshes it: 'bun run setup:all --with-embedding'.",
            meta_path.display()
        );
        return None;
    };
    let Ok(meta) = serde_json::from_str::<serde_json::Value>(&raw) else {
        log::info!("Unreadable embeddings provenance sidecar at {}", meta_path.display());
        return None;
    };
    let index_model = meta.get("model_file").and_then(|v| v.as_str()).unwrap_or("");
    let loaded_model = model_path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    if index_model == loaded_model {
        log::info!("Embeddings provenance OK (model: {loaded_model})");
        None
    } else {
        let warning = format!(
            "Semantic search index mismatch: the verse embeddings were built with \
             \"{index_model}\" but the app loaded \"{loaded_model}\", so semantic results \
             will be unreliable. Fix: delete embeddings/kjv-qwen3-0.6b* and run \
             `bun run setup:all --with-embedding`."
        );
        log::warn!("{warning}");
        Some(warning)
    }
}
