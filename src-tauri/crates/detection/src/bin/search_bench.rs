//! Search accuracy benchmark over a golden query set.
//!
//! Runs FTS5-only, vector-only, and fused search against the real Bible
//! database, embeddings index, and ONNX model, reporting recall@1, recall@5,
//! and MRR@10 per query category. Local tooling only — never run in CI
//! (the model, embeddings, and database are not checked in).
//!
//! Usage (from the repo root):
//!   cd src-tauri && cargo run -p rhema-detection --features bench-bin --release \
//!     --bin `search_bench` -- --db ../data/rhema.db --golden ../data/search-golden.json \
//!     --model ../models/qwen3-embedding-0.6b-int8/model_quantized.onnx \
//!     --tokenizer ../models/qwen3-embedding-0.6b/tokenizer.json \
//!     --embeddings ../embeddings/kjv-qwen3-0.6b.bin --ids ../embeddings/kjv-qwen3-0.6b-ids.bin
//!
//! Pass `--probe-prefix` to also run the embedding-convention probes that
//! gate the embedding regeneration work: a provenance probe (was the shipped
//! index built with a "passage: " prefix?) and a query-format comparison.
//!
//! Pass `--fragments N` to additionally benchmark partial quoting the way a
//! minister actually quotes: N random KJV verses are sampled (deterministic
//! seed, any of the ~31k verses) and each contributes three queries — the
//! first, middle, and last 8 words of the verse — reported as the
//! frag_start / frag_middle / frag_end categories. Any verse containing the
//! exact fragment counts as a correct answer, so common phrases that appear
//! in several verses are scored fairly.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rhema_bible::BibleDb;
use rhema_detection::fusion::{fuse, VerseKey};
use rhema_detection::semantic::embedder::TextEmbedder;
use rhema_detection::semantic::index::VectorIndex;
use rhema_detection::{HnswVectorIndex, OnnxEmbedder};

const K: usize = 15;
const MRR_DEPTH: usize = 10;

/// Words per generated verse fragment (--fragments mode).
const FRAGMENT_WORDS: usize = 8;

/// Minimum verse length (words) to be eligible for fragment sampling, so the
/// start/middle/end windows are meaningfully distinct.
const FRAGMENT_MIN_WORDS: usize = 12;

/// Fixed seed for fragment sampling — results must be reproducible run-to-run.
const FRAGMENT_SEED: u64 = 0x5EED_0F_B1B1E;

/// Query formats compared by the `--probe-prefix` query-format probe.
/// "passage: " is the E5-style prefix used by the precompute binary; the
/// instruct format is Qwen3-Embedding's documented query convention.
const QUERY_FORMATS: &[(&str, &str)] = &[
    ("none", ""),
    ("passage", "passage: "),
    (
        "instruct",
        "Instruct: Given a search query, retrieve relevant Bible verses that answer or match the query\nQuery: ",
    ),
];

#[derive(serde::Deserialize)]
struct GoldenFile {
    queries: Vec<GoldenQuery>,
}

#[derive(serde::Deserialize)]
struct GoldenQuery {
    id: String,
    category: String,
    query: String,
    accept: Vec<AcceptKey>,
}

#[derive(serde::Deserialize, Clone, Copy)]
struct AcceptKey {
    book_number: i32,
    chapter: i32,
    verse: i32,
}

impl AcceptKey {
    fn key(self) -> VerseKey {
        VerseKey { book_number: self.book_number, chapter: self.chapter, verse: self.verse }
    }
}

/// Per-(category, mode) metric accumulator.
#[derive(Default, Clone, Copy)]
struct Tally {
    queries: usize,
    hits_at_1: usize,
    hits_at_5: usize,
    mrr_sum: f64,
}

impl Tally {
    /// Record one query given the rank (0-based) of the best accepted verse.
    fn record(&mut self, best_rank: Option<usize>) {
        self.queries += 1;
        if let Some(rank) = best_rank {
            if rank == 0 {
                self.hits_at_1 += 1;
            }
            if rank < 5 {
                self.hits_at_5 += 1;
            }
            if rank < MRR_DEPTH {
                #[expect(clippy::cast_precision_loss, reason = "rank is small")]
                let rr = 1.0 / (rank as f64 + 1.0);
                self.mrr_sum += rr;
            }
        }
    }

    #[expect(clippy::cast_precision_loss, reason = "query counts are small")]
    fn row(&self) -> (f64, f64, f64) {
        let n = self.queries.max(1) as f64;
        (
            self.hits_at_1 as f64 / n,
            self.hits_at_5 as f64 / n,
            self.mrr_sum / n,
        )
    }
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    let args: Vec<String> = std::env::args().collect();

    let db_path = get_arg(&args, "--db").unwrap_or_else(|| "../data/rhema.db".to_string());
    let golden_path =
        get_arg(&args, "--golden").unwrap_or_else(|| "../data/search-golden.json".to_string());
    let model_path = get_arg(&args, "--model").unwrap_or_else(|| {
        let int8 = "../models/qwen3-embedding-0.6b-int8/model_quantized.onnx";
        if Path::new(int8).exists() {
            int8.to_string()
        } else {
            "../models/qwen3-embedding-0.6b/model.onnx".to_string()
        }
    });
    let tokenizer_path = get_arg(&args, "--tokenizer")
        .unwrap_or_else(|| "../models/qwen3-embedding-0.6b/tokenizer.json".to_string());
    let embeddings_path = get_arg(&args, "--embeddings")
        .unwrap_or_else(|| "../embeddings/kjv-qwen3-0.6b.bin".to_string());
    let ids_path = get_arg(&args, "--ids")
        .unwrap_or_else(|| "../embeddings/kjv-qwen3-0.6b-ids.bin".to_string());
    let probe_prefix = args.iter().any(|a| a == "--probe-prefix");

    for (label, path) in [
        ("database", &db_path),
        ("golden set", &golden_path),
        ("ONNX model", &model_path),
        ("tokenizer", &tokenizer_path),
        ("embeddings", &embeddings_path),
        ("embedding ids", &ids_path),
    ] {
        assert!(
            Path::new(path).exists(),
            "Missing {label} at {path}. The benchmark needs local assets \
             (data/rhema.db, models/, embeddings/) — see README / package.json scripts."
        );
    }

    let mut golden: GoldenFile = serde_json::from_str(
        &std::fs::read_to_string(&golden_path).expect("read golden set"),
    )
    .expect("parse golden set");
    log::info!("Loaded {} golden queries", golden.queries.len());

    let db = BibleDb::open(Path::new(&db_path)).expect("open bible db");

    let fragments: usize = get_arg(&args, "--fragments")
        .map(|n| n.parse().expect("--fragments takes a number"))
        .unwrap_or(0);
    if fragments > 0 {
        let generated = generate_fragment_queries(&db, fragments);
        log::info!(
            "Generated {} fragment queries from {fragments} random KJV verses",
            generated.len()
        );
        golden.queries.extend(generated);
    }
    let golden = golden;

    log::info!("Loading ONNX model from {model_path}...");
    let mut embedder =
        OnnxEmbedder::load(&PathBuf::from(&model_path), &PathBuf::from(&tokenizer_path))
            .expect("load ONNX model");
    let dim = embedder.dimension();
    let index = HnswVectorIndex::load(
        &PathBuf::from(&embeddings_path),
        &PathBuf::from(&ids_path),
        dim,
    )
    .expect("load vector index");
    log::info!("Index ready: {} vectors, dim={dim}", index.len());

    if probe_prefix {
        run_provenance_probe(&mut embedder, &index, &db);
    }

    println!("\n=== Search accuracy benchmark (k={K}) ===");
    run_benchmark(&golden, &db, &embedder, &index, "");

    if probe_prefix {
        for (name, prefix) in QUERY_FORMATS.iter().skip(1) {
            println!("\n=== Query-format probe: vector-only with {name:?} prefix ===");
            run_benchmark_vector_only(&golden, &db, &embedder, &index, prefix, name);
        }
    }
}

/// The main three-mode benchmark: FTS5-only, vector-only, fused.
fn run_benchmark(
    golden: &GoldenFile,
    db: &BibleDb,
    embedder: &OnnxEmbedder,
    index: &HnswVectorIndex,
    query_prefix: &str,
) {
    let mut tallies: HashMap<(String, &'static str), Tally> = HashMap::new();

    for q in &golden.queries {
        let accepts: Vec<VerseKey> = q.accept.iter().map(|a| a.key()).collect();

        let fts_keys = fts_search(db, &q.query);
        let vector_hits = vector_search(db, embedder, index, &q.query, query_prefix);
        let fused_keys: Vec<VerseKey> = fuse(&vector_hits, &fts_keys)
            .into_iter()
            .map(|h| h.key)
            .collect();
        let vector_keys: Vec<VerseKey> = vector_hits.iter().map(|&(k, _)| k).collect();

        for (mode, keys) in [
            ("fts", &fts_keys),
            ("vector", &vector_keys),
            ("fused", &fused_keys),
        ] {
            let best = best_rank(keys, &accepts);
            tallies.entry((q.category.clone(), mode)).or_default().record(best);
            tallies.entry(("ALL".to_string(), mode)).or_default().record(best);
        }
        log::debug!("query {} done", q.id);
    }

    print_table(&tallies);
}

/// Vector-only run used by the query-format probe.
fn run_benchmark_vector_only(
    golden: &GoldenFile,
    db: &BibleDb,
    embedder: &OnnxEmbedder,
    index: &HnswVectorIndex,
    query_prefix: &str,
    mode_name: &str,
) {
    let mut tallies: HashMap<(String, &'static str), Tally> = HashMap::new();
    for q in &golden.queries {
        let accepts: Vec<VerseKey> = q.accept.iter().map(|a| a.key()).collect();
        let hits = vector_search(db, embedder, index, &q.query, query_prefix);
        let keys: Vec<VerseKey> = hits.iter().map(|&(k, _)| k).collect();
        let best = best_rank(&keys, &accepts);
        tallies.entry((q.category.clone(), "vector")).or_default().record(best);
        tallies.entry(("ALL".to_string(), "vector")).or_default().record(best);
    }
    println!("(query prefix mode: {mode_name})");
    print_table(&tallies);
}

fn fts_search(db: &BibleDb, query: &str) -> Vec<VerseKey> {
    db.search_verses_bm25(query, K)
        .unwrap_or_default()
        .iter()
        .map(|f| VerseKey { book_number: f.book_number, chapter: f.chapter, verse: f.verse })
        .collect()
}

fn vector_search(
    db: &BibleDb,
    embedder: &OnnxEmbedder,
    index: &HnswVectorIndex,
    query: &str,
    prefix: &str,
) -> Vec<(VerseKey, f64)> {
    let text = format!("{prefix}{query}");
    let Ok(embedding) = embedder.embed(&text) else {
        log::warn!("embedding failed for query {query:?}");
        return vec![];
    };
    let Ok(results) = index.search(&embedding, K) else {
        return vec![];
    };
    results
        .iter()
        .filter_map(|r| {
            let v = db.get_verse_by_id(r.verse_id).ok().flatten()?;
            Some((
                VerseKey { book_number: v.book_number, chapter: v.chapter, verse: v.verse },
                r.similarity,
            ))
        })
        .collect()
}

fn best_rank(ranked: &[VerseKey], accepts: &[VerseKey]) -> Option<usize> {
    ranked.iter().position(|k| accepts.contains(k))
}

fn print_table(tallies: &HashMap<(String, &'static str), Tally>) {
    let mut categories: Vec<&String> = tallies.keys().map(|(c, _)| c).collect();
    categories.sort();
    categories.dedup();
    // Show ALL last.
    categories.retain(|c| c.as_str() != "ALL");
    let all = "ALL".to_string();
    categories.push(&all);

    println!(
        "{:<16} {:<8} {:>4} {:>8} {:>8} {:>8}",
        "category", "mode", "n", "R@1", "R@5", "MRR@10"
    );
    for cat in categories {
        for mode in ["fts", "vector", "fused"] {
            if let Some(t) = tallies.get(&(cat.clone(), mode)) {
                let (r1, r5, mrr) = t.row();
                println!(
                    "{:<16} {:<8} {:>4} {:>8.3} {:>8.3} {:>8.3}",
                    cat, mode, t.queries, r1, r5, mrr
                );
            }
        }
    }
}

/// Provenance probe: was the shipped index built with a "passage: " prefix?
///
/// Embeds a handful of verses' exact KJV text with and without the prefix
/// and compares each against the verse's stored vector. The variant with
/// cosine ≈ 1.0 is how the index was generated.
fn run_provenance_probe(embedder: &mut OnnxEmbedder, index: &HnswVectorIndex, db: &BibleDb) {
    // (book_number, chapter, verse) for well-known verses; resolved to KJV
    // text and verse ids through the database (KJV translation_id = 1).
    let refs = [(43, 3, 16), (1, 1, 1), (19, 23, 1), (45, 8, 28), (40, 11, 28)];

    println!("\n=== Embedding provenance probe ===");
    println!("cosine of freshly embedded KJV verse text vs stored index vector\n");
    println!("{:<18} {:>10} {:>12}", "verse", "no prefix", "\"passage: \"");

    let mut sum_none = 0.0f64;
    let mut sum_passage = 0.0f64;
    let mut count = 0usize;

    for (book, chapter, verse) in refs {
        let Ok(Some(v)) = db.get_verse(1, book, chapter, verse) else {
            log::warn!("KJV verse {book} {chapter}:{verse} not found");
            continue;
        };
        let Some(stored) = index.vector(v.id) else {
            log::warn!("no stored vector for verse id {}", v.id);
            continue;
        };

        embedder.set_prompt_prefix(String::new());
        let Ok(plain) = embedder.embed(&v.text) else { continue };
        embedder.set_prompt_prefix("passage: ".to_string());
        let Ok(passage) = embedder.embed(&v.text) else { continue };

        let cos_none = dot(&plain, stored);
        let cos_passage = dot(&passage, stored);
        sum_none += cos_none;
        sum_passage += cos_passage;
        count += 1;

        println!(
            "{:<18} {:>10.4} {:>12.4}",
            format!("{} {}:{}", v.book_name, chapter, verse),
            cos_none,
            cos_passage
        );
    }
    embedder.set_prompt_prefix(String::new());

    if count > 0 {
        #[expect(clippy::cast_precision_loss, reason = "count is tiny")]
        let (avg_none, avg_passage) = (sum_none / count as f64, sum_passage / count as f64);
        println!("\nmean: no-prefix={avg_none:.4}  passage={avg_passage:.4}");
        let verdict = if avg_none > 0.99 {
            "index was built WITHOUT a prefix — matches the runtime query convention"
        } else if avg_passage > 0.99 {
            "index was built WITH \"passage: \" — runtime queries (no prefix) are MISMATCHED"
        } else {
            "inconclusive — neither variant reproduces the stored vectors \
             (different model, quantization, or pooling?)"
        };
        println!("verdict: {verdict}");
    }
}

fn dot(a: &[f32], b: &[f32]) -> f64 {
    a.iter().zip(b.iter()).map(|(&x, &y)| f64::from(x) * f64::from(y)).sum()
}

/// Sample `count` random KJV verses (deterministic seed) and build three
/// queries per verse: the first, middle, and last `FRAGMENT_WORDS` words.
///
/// Acceptance for each fragment is every KJV verse whose whitespace-normalized
/// text contains the fragment — common phrases legitimately live in several
/// verses and any of them is a correct search result.
fn generate_fragment_queries(db: &BibleDb, count: usize) -> Vec<GoldenQuery> {
    let verses = db
        .load_translation_verses_for_search(1)
        .expect("load KJV verses for fragment sampling");

    // Normalized text per verse, shared by fragment slicing and acceptance.
    let normalized: Vec<(VerseKey, String)> = verses
        .iter()
        .map(|v| {
            (
                VerseKey { book_number: v.book_number, chapter: v.chapter, verse: v.verse },
                v.text.split_whitespace().collect::<Vec<_>>().join(" "),
            )
        })
        .collect();

    let mut eligible: Vec<usize> = normalized
        .iter()
        .enumerate()
        .filter(|(_, (_, text))| text.split_whitespace().count() >= FRAGMENT_MIN_WORDS)
        .map(|(i, _)| i)
        .collect();

    // Fisher-Yates with a fixed-seed xorshift so every run samples the same
    // verses without pulling in a rand dependency.
    let mut state = FRAGMENT_SEED;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    let n = eligible.len();
    for i in (1..n).rev() {
        #[expect(clippy::cast_possible_truncation, reason = "index fits in usize")]
        let j = (next() % (i as u64 + 1)) as usize;
        eligible.swap(i, j);
    }
    eligible.truncate(count.min(n));

    let mut queries = Vec::with_capacity(eligible.len() * 3);
    for (sample_no, &vi) in eligible.iter().enumerate() {
        let (_, text) = &normalized[vi];
        let words: Vec<&str> = text.split_whitespace().collect();
        let mid_start = (words.len() - FRAGMENT_WORDS) / 2;
        let windows = [
            ("frag_start", 0),
            ("frag_middle", mid_start),
            ("frag_end", words.len() - FRAGMENT_WORDS),
        ];
        for (category, start) in windows {
            let fragment = words[start..start + FRAGMENT_WORDS].join(" ");
            let accept: Vec<AcceptKey> = normalized
                .iter()
                .filter(|(_, t)| t.contains(&fragment))
                .map(|(k, _)| AcceptKey {
                    book_number: k.book_number,
                    chapter: k.chapter,
                    verse: k.verse,
                })
                .collect();
            queries.push(GoldenQuery {
                id: format!("{category}-{sample_no}"),
                category: category.to_string(),
                query: fragment,
                accept,
            });
        }
    }
    queries
}

fn get_arg(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .cloned()
}
