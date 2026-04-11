//! Utility to pre-compute embeddings for every Bible verse and persist
//! them to binary files that `HnswVectorIndex::load` can read.
//!
//! This module requires the `onnx` feature so it has access to
//! `OnnxEmbedder`.

#[cfg(feature = "onnx")]
use std::io::Write;
#[cfg(feature = "onnx")]
use std::path::Path;

#[cfg(feature = "onnx")]
use crate::error::DetectionError;
#[cfg(feature = "onnx")]
use super::embedder::TextEmbedder;
#[cfg(feature = "onnx")]
use super::onnx_embedder::OnnxEmbedder;

/// Pre-compute embeddings for a set of verses and write the results to
/// binary files.
///
/// # Arguments
///
/// * `embedder` -- an `OnnxEmbedder` whose prompt prefix should be set to
///   `"passage: "` for document embedding (as opposed to `"query: "` used
///   at search time).
/// * `verses` -- `(verse_id, verse_text)` pairs.
/// * `output_embeddings_path` -- destination for the raw `f32` embedding
///   matrix.
/// * `output_ids_path` -- destination for the raw `i64` verse-ID array.
///
/// Both files are written in the platform's native byte order.  The
/// embeddings file is a flat array of `f32` values (`dim * num_verses`
/// floats) and the IDs file is a flat array of `i64` values
/// (`num_verses` entries).
#[cfg(feature = "onnx")]
pub fn precompute_embeddings(
    embedder: &OnnxEmbedder,
    verses: &[(i64, String)],
    output_embeddings_path: &Path,
    output_ids_path: &Path,
) -> Result<(), DetectionError> {
    let total = verses.len();
    log::info!("Pre-computing embeddings for {total} verses ...");

    let mut emb_file = std::fs::File::create(output_embeddings_path).map_err(|e| {
        DetectionError::Internal(format!(
            "create {}: {e}",
            output_embeddings_path.display()
        ))
    })?;

    let mut ids_file = std::fs::File::create(output_ids_path).map_err(|e| {
        DetectionError::Internal(format!("create {}: {e}", output_ids_path.display()))
    })?;

    for (i, (verse_id, text)) in verses.iter().enumerate() {
        let embedding = embedder.embed(text)?;

        // Write f32 vector as raw bytes (native byte order).
        // Safety: f32 has no padding and a well-defined repr.
        let emb_bytes: &[u8] = unsafe {
            std::slice::from_raw_parts(
                embedding.as_ptr().cast::<u8>(),
                embedding.len() * std::mem::size_of::<f32>(),
            )
        };
        emb_file.write_all(emb_bytes).map_err(|e| {
            DetectionError::Internal(format!("write embedding: {e}"))
        })?;

        // Write verse_id as raw i64 bytes (native byte order).
        let id_bytes = verse_id.to_ne_bytes();
        ids_file.write_all(&id_bytes).map_err(|e| {
            DetectionError::Internal(format!("write id: {e}"))
        })?;

        if (i + 1) % 1000 == 0 || i + 1 == total {
            log::info!("  embedded {}/{} verses", i + 1, total);
        }
    }

    log::info!("Pre-computation complete. Files written.");
    Ok(())
}
