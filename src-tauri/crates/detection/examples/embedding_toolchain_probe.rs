//! Local full-model compatibility probe; no production assets are modified.
//!
//! Build with `--features precompute-bin --example embedding_toolchain_probe`.
//! Arguments: `FP32_DIRECTORY INT8_DIRECTORY PYTHON_REPORT VERSES QUERIES OUTPUT_DIRECTORY`.

use std::collections::HashMap;
use std::error::Error;
use std::path::{Path, PathBuf};

use rhema_detection::semantic::embedder::TextEmbedder;
use rhema_detection::semantic::index::VectorIndex;
use rhema_detection::{HnswVectorIndex, OnnxEmbedder};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct PythonReport {
    texts: Vec<String>,
    vectors: HashMap<String, Vec<Vec<f32>>>,
}

#[derive(Deserialize)]
struct Verse {
    id: i64,
    text: String,
}

#[derive(Deserialize)]
struct Query {
    category: String,
    text: String,
    accept: Vec<i64>,
}

fn cosine(left: &[f32], right: &[f32]) -> f64 {
    let dot: f64 = left
        .iter()
        .zip(right)
        .map(|(a, b)| f64::from(*a) * f64::from(*b))
        .sum();
    let norm = |values: &[f32]| {
        values
            .iter()
            .map(|value| f64::from(*value).powi(2))
            .sum::<f64>()
            .sqrt()
    };
    dot / (norm(left) * norm(right))
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, Box<dyn Error>> {
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}

fn compare_reference(
    name: &str,
    embedder: &OnnxEmbedder,
    reference: &PythonReport,
) -> Result<Vec<serde_json::Value>, Box<dyn Error>> {
    let expected = reference
        .vectors
        .get(name)
        .ok_or("missing Python vectors")?;
    if expected.len() != reference.texts.len() {
        return Err("reference vector count mismatch".into());
    }
    reference.texts.iter().zip(expected).map(|(text, expected)| {
        let actual = embedder.embed(text)?;
        let norm: f64 = actual.iter().map(|value| f64::from(*value).powi(2)).sum::<f64>().sqrt();
        let similarity = cosine(&actual, expected);
        let passed = actual.len() == 1024 && expected.len() == 1024 && actual.iter().all(|value| value.is_finite())
            && similarity.is_finite() && similarity >= 0.99999 && (norm - 1.0).abs() <= 1e-5;
        Ok(json!({"model": name, "characters": text.chars().count(), "cosine": similarity, "norm": norm, "passed": passed}))
    }).collect()
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    if args.len() != 6 {
        return Err(
            "Expected FP32_DIRECTORY INT8_DIRECTORY PYTHON_REPORT VERSES QUERIES OUTPUT_DIRECTORY"
                .into(),
        );
    }
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    std::fs::create_dir_all(&args[5])?;
    let reference: PythonReport = read_json(&args[2])?;
    let mut comparisons = Vec::new();
    {
        let embedder =
            OnnxEmbedder::load(&args[0].join("model.onnx"), &args[0].join("tokenizer.json"))?;
        comparisons.extend(compare_reference("fp32", &embedder, &reference)?);
    }
    let embedder = OnnxEmbedder::load(
        &args[1].join("model_quantized.onnx"),
        &args[1].join("tokenizer.json"),
    )?;
    comparisons.extend(compare_reference("int8", &embedder, &reference)?);
    let verses: Vec<Verse> = read_json(&args[3])?;
    let pairs: Vec<_> = verses
        .iter()
        .map(|verse| (verse.id, verse.text.clone()))
        .collect();
    let embeddings_path = args[5].join("vectors.bin");
    let ids_path = args[5].join("ids.bin");
    rhema_detection::semantic::precompute::precompute_embeddings(
        &embedder,
        &pairs,
        &embeddings_path,
        &ids_path,
    )?;
    let index = HnswVectorIndex::load(&embeddings_path, &ids_path, embedder.dimension())?;
    let queries: Vec<Query> = read_json(&args[4])?;
    let mut results = Vec::new();
    let comparison_passed = comparisons.iter().all(|report| report["passed"] == true);
    let mut retrieval_passed = true;
    for query in queries {
        let started = std::time::Instant::now();
        let results_for_query = index.search(&embedder.embed(&query.text)?, index.len())?;
        let rank = results_for_query
            .iter()
            .position(|result| query.accept.contains(&result.verse_id))
            .map(|value| value + 1);
        let exact = query.category == "exact";
        let accepted = if exact {
            rank == Some(1)
                && results_for_query
                    .first()
                    .is_some_and(|result| result.similarity >= 0.9999)
        } else {
            rank.is_some_and(|value| value <= 5)
        };
        retrieval_passed &= accepted;
        results.push(json!({"category": query.category, "query": query.text, "rank": rank, "passed": accepted,
            "elapsedMs": started.elapsed().as_secs_f64() * 1000.0,
            "top5": results_for_query.iter().take(5).map(|result| json!({"id": result.verse_id, "score": result.similarity})).collect::<Vec<_>>() }));
    }
    let passed = comparison_passed && retrieval_passed;
    let report = json!({"indexVerses": index.len(), "dimension": embedder.dimension(), "comparisons": comparisons, "queries": results, "comparisonPassed": comparison_passed, "retrievalPassed": retrieval_passed, "passed": passed});
    std::fs::write(
        args[5].join("rust-probe.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    if !passed {
        return Err("Full-model acceptance check failed; numerical and retrieval results retained separately".into());
    }
    Ok(())
}
