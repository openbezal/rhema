//! CLI binary to pre-compute verse embeddings using the ONNX model.
//!
//! Usage:
//!   cargo run -p rhema-detection --features onnx,vector-search --bin precompute -- \
//!     --model models/qwen3-embedding-0.6b/model.onnx \
//!     --tokenizer models/qwen3-embedding-0.6b/tokenizer.json \
//!     --verses data/verses-for-embedding.json \
//!     --output-embeddings embeddings/kjv-qwen3-0.6b.bin \
//!     --output-ids embeddings/kjv-qwen3-0.6b-ids.bin

use std::path::PathBuf;

fn main() {
    // Initialize logging
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let args: Vec<String> = std::env::args().collect();

    let model_path = get_arg(&args, "--model")
        .unwrap_or_else(|| "models/qwen3-embedding-0.6b/model.onnx".to_string());
    let tokenizer_path = get_arg(&args, "--tokenizer")
        .unwrap_or_else(|| "models/qwen3-embedding-0.6b/tokenizer.json".to_string());
    let verses_path = get_arg(&args, "--verses")
        .unwrap_or_else(|| "data/verses-for-embedding.json".to_string());
    let output_embeddings = get_arg(&args, "--output-embeddings")
        .unwrap_or_else(|| "embeddings/kjv-qwen3-0.6b.bin".to_string());
    let output_ids = get_arg(&args, "--output-ids")
        .unwrap_or_else(|| "embeddings/kjv-qwen3-0.6b-ids.bin".to_string());

    log::info!("=== Rhema Verse Embedding Pre-computation ===");
    log::info!("Model: {}", model_path);
    log::info!("Tokenizer: {}", tokenizer_path);
    log::info!("Verses: {}", verses_path);
    log::info!("Output embeddings: {}", output_embeddings);
    log::info!("Output IDs: {}", output_ids);

    // Create output directory
    if let Some(parent) = PathBuf::from(&output_embeddings).parent() {
        std::fs::create_dir_all(parent).expect("Failed to create output directory");
    }

    log::info!("Loading ONNX model...");
    let embedder = rhema_detection::OnnxEmbedder::load(
        &PathBuf::from(&model_path),
        &PathBuf::from(&tokenizer_path),
    )
    .expect("Failed to load ONNX model");

    // No prompt prefix: verse and query embeddings must live in the same
    // space, and the runtime embedder (semantic search + detection) embeds
    // queries with no prefix. The previous "passage: " prefix (an E5-style
    // convention that Qwen3-Embedding does not use) put documents and
    // queries in mismatched spaces.

    log::info!(
        "Model loaded. Embedding dimension: {}",
        rhema_detection::semantic::embedder::TextEmbedder::dimension(&embedder)
    );

    // Read verses JSON
    log::info!("Reading verses from {}...", verses_path);
    let verses_json = std::fs::read_to_string(&verses_path).expect("Failed to read verses JSON");

    #[derive(serde::Deserialize)]
    struct VerseEntry {
        id: i64,
        text: String,
        #[allow(dead_code)]
        r#ref: String,
    }

    let entries: Vec<VerseEntry> =
        serde_json::from_str(&verses_json).expect("Failed to parse verses JSON");

    log::info!("Loaded {} verses", entries.len());

    // Convert to (id, text) pairs
    let verses: Vec<(i64, String)> = entries.into_iter().map(|e| (e.id, e.text)).collect();

    // Run pre-computation
    rhema_detection::semantic::precompute::precompute_embeddings(
        &embedder,
        &verses,
        &PathBuf::from(&output_embeddings),
        &PathBuf::from(&output_ids),
    )
    .expect("Pre-computation failed");

    write_meta_sidecar(&output_embeddings, &model_path, &verses.len());

    log::info!("=== Done! ===");
}

/// Write a provenance sidecar next to the embeddings so the app (and future
/// regenerations) can tell how the index was built. The previous index
/// shipped with no provenance and turned out not to match the runtime
/// embedder at all (self-similarity 0.65 instead of ~1.0).
fn write_meta_sidecar(output_embeddings: &str, model_path: &str, count: &usize) {
    let meta_path = PathBuf::from(output_embeddings).with_extension("meta.json");
    let model_file = PathBuf::from(model_path)
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    let generated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let meta = serde_json::json!({
        "model_file": model_file,
        "prompt_prefix": "",
        "pooling": "runtime OnnxEmbedder (sentence_embedding output, else masked mean)",
        "verse_count": count,
        "generated_at_unix": generated_at,
        "generated_by": "cargo precompute bin",
    });
    match std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap_or_default()) {
        Ok(()) => log::info!("Wrote provenance sidecar {}", meta_path.display()),
        Err(e) => log::warn!("Failed to write provenance sidecar: {e}"),
    }
}

fn get_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
