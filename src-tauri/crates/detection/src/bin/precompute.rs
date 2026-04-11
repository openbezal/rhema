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

    log::info ! ("=== Rhema Verse Embedding Pre-computation ===");
    log::info ! ("Model: {}", model_path);
    log::info ! ("Tokenizer: {}", tokenizer_path);
    log::info ! ("Verses: {}", verses_path);
    log::info ! ("Output embeddings: {}", output_embeddings);
    log::info ! ("Output IDs: {}", output_ids);

    // Create output directory
    if let Some(parent) = PathBuf::from(&output_embeddings).parent() {
        std::fs::create_dir_all(parent).expect("Failed to create output directory");
    }

    // Load the ONNX model with "passage: " prefix for document embedding
    log::info ! ("Loading ONNX model...");
    let mut embedder = rhema_detection::OnnxEmbedder::load(
        &PathBuf::from(&model_path),
        &PathBuf::from(&tokenizer_path),
    )
    .expect("Failed to load ONNX model");

    // Use "passage: " prefix for verse embedding (Qwen3 uses asymmetric prefixes)
    embedder.set_prompt_prefix("passage: ".to_string());

    log::info ! (
        "Model loaded. Embedding dimension: {}",
        rhema_detection::semantic::embedder::TextEmbedder::dimension(&embedder)
    );

    // Read verses JSON
    log::info ! ("Reading verses from {}...", verses_path);
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

    log::info ! ("Loaded {} verses", entries.len());

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

    log::info ! ("=== Done! ===");
}

fn get_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
