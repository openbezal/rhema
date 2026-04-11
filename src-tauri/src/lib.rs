mod commands;
mod events;
mod state;

use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

/// Root entry point for the Rhema application logic.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    dotenvy::from_filename("../.env").ok();

    let http_client = reqwest::Client::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new()
            .level(tauri_plugin_log::log::LevelFilter::Info)
            .build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(Mutex::new(state::AppState::new(http_client)))
        .manage(Mutex::new(rhema_broadcast::ndi::NdiRuntime::default()))
        .manage(Mutex::new(rhema_detection::DirectDetector::new()))
        .manage(Mutex::new(rhema_detection::DetectionMerger::new()))
        .manage(Mutex::new(rhema_detection::ReadingMode::new()))
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
            commands::detection::semantic_search,
            commands::detection::toggle_paraphrase_detection,
            commands::detection::quotation_search,
            commands::detection::reading_mode_status,
            commands::detection::stop_reading_mode,
            commands::audio::get_audio_devices,
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
        ])
        .setup(|app| {
            setup_bible_database(app);
            setup_semantic_engine(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_bible_database<R: Runtime>(app: &AppHandle<R>) {
    let db_path = app.path().resource_dir()
        .map(|p| p.join("rhema.db"))
        .ok()
        .filter(|p| p.exists())
        .unwrap_or_else(|| {
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../data/rhema.db")
        });

    if !db_path.exists() {
        log::warn!("Bible database not found at {:?}", db_path);
        return;
    }

    let bible_db = match rhema_bible::BibleDb::open(&db_path) {
        Ok(db) => db,
        Err(e) => {
            log::error!("Failed to open Bible database: {e}");
            return;
        }
    };

    log::info!("Building quotation matching index...");
    let quotation_matcher = match bible_db.load_all_verses_for_quotation(Some("en")) {
        Ok(verses) => {
            log::info!("Loaded {} English verses for quotation index", verses.len());
            rhema_detection::QuotationMatcher::build(verses)
        }
        Err(e) => {
            log::warn!("Failed to load verses for quotation index: {e}");
            rhema_detection::QuotationMatcher::new()
        }
    };

    let managed_state = app.state::<Mutex<state::AppState>>();
    if let Ok(mut state) = managed_state.lock() {
        state.bible_db = Some(bible_db);
        state.quotation_matcher = quotation_matcher;
        log::info!("Bible database loaded successfully ({:?})", db_path.file_name().unwrap_or_default());
    }
}

fn setup_semantic_engine<R: Runtime>(app: &AppHandle<R>) {
    let base_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let model_path = {
        let int8 = base_dir.join("models/qwen3-embedding-0.6b-int8/model_quantized.onnx");
        let fp32 = base_dir.join("models/qwen3-embedding-0.6b/model.onnx");
        if int8.exists() {
            log::info!("Using INT8 quantized ONNX model");
            int8 
        } else { 
            log::info!("Using FP32 ONNX model");
            fp32 
        }
    };
    let tokenizer_path = base_dir.join("models/qwen3-embedding-0.6b/tokenizer.json");
    let embeddings_path = base_dir.join("embeddings/kjv-qwen3-0.6b.bin");
    let ids_path = base_dir.join("embeddings/kjv-qwen3-0.6b-ids.bin");

    if !model_path.exists() || !tokenizer_path.exists() {
        log::info ! ("ONNX model not found. Semantic search disabled.");
        return;
    }

    use rhema_detection::semantic::embedder::TextEmbedder;
    use rhema_detection::semantic::index::VectorIndex;
    match rhema_detection::OnnxEmbedder::load(&model_path, &tokenizer_path) {
        Ok(embedder) => {
            log::info!("ONNX embedding model loaded");
            let managed_state = app.state::<Mutex<state::AppState>>();
            let mut state = match managed_state.lock() {
                Ok(s) => s,
                Err(_) => return,
            };

            if embeddings_path.exists() && ids_path.exists() {
                let dim = embedder.dimension();
                match rhema_detection::HnswVectorIndex::load(&embeddings_path, &ids_path, dim) {
                    Ok(index) => {
                        log::info!("Verse embeddings loaded ({} vectors)", index.len());
                        state.detection_pipeline.semantic = rhema_detection::SemanticDetector::new(
                            Box::new(embedder),
                            Box::new(index),
                        );
                    }
                    Err(e) => log::warn!("Failed to load verse embeddings: {e}"),
                }
            }
        }
        Err(e) => log::warn!("Failed to load ONNX model: {e}"),
    }
}
