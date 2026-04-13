use std::collections::HashMap;

use super::cache::EmbeddingCache;
use super::embedder::TextEmbedder;
use super::index::VectorIndex;
use super::synonyms::SynonymExpander;
use crate::error::DetectionError;

/// Ensemble search weights.
const ORIGINAL_WEIGHT: f64 = 0.7;
const SYNONYM_WEIGHT: f64 = 0.2;
const CONCEPT_WEIGHT: f64 = 0.1;

/// Minimum similarity for a result to be included from each strategy.
const ORIGINAL_CUTOFF: f64 = 0.50;
const SYNONYM_CUTOFF: f64 = 0.50;
const CONCEPT_CUTOFF: f64 = 0.45;

/// Minimum combined ensemble score to include in final results.
const ENSEMBLE_THRESHOLD: f64 = 0.50;

/// Result from the ensemble search with combined scoring.
#[derive(Debug, Clone)]
pub struct EnsembleResult {
    pub verse_id: i64,
    /// Weighted combined score across all strategies.
    pub score: f64,
    /// Best raw similarity from any single strategy.
    pub best_similarity: f64,
    /// Which strategies contributed to this result.
    pub sources: Vec<String>,
}

/// Runs multiple search strategies on the same text and combines
/// results with weighted scoring for better accuracy.
///
/// Strategies:
/// 1. **Original** (weight 0.7): Direct embedding of the input text.
/// 2. **Synonym** (weight 0.2): Synonym-expanded variants of the text.
/// 3. **Concept** (weight 0.1): Key biblical concepts extracted from text.
pub struct EnsembleSearcher {
    synonym_expander: SynonymExpander,
    cache: EmbeddingCache,
}

impl EnsembleSearcher {
    pub fn new() -> Self {
        Self {
            synonym_expander: SynonymExpander::new(),
            cache: EmbeddingCache::new(128),
        }
    }

    /// Run all strategies and return combined, deduplicated results.
    pub fn search(
        &mut self,
        text: &str,
        embedder: &dyn TextEmbedder,
        index: &dyn VectorIndex,
        k: usize,
    ) -> Result<Vec<EnsembleResult>, DetectionError> {
        let mut combined: HashMap<i64, EnsembleResult> = HashMap::new();

        // Strategy 1: Original (direct embedding)
        let original_results = self.run_strategy(
            text,
            embedder,
            index,
            k,
            "original",
        )?;
        for (verse_id, similarity) in &original_results {
            if *similarity >= ORIGINAL_CUTOFF {
                let entry = combined.entry(*verse_id).or_insert_with(|| EnsembleResult {
                    verse_id: *verse_id,
                    score: 0.0,
                    best_similarity: 0.0,
                    sources: Vec::new(),
                });
                entry.score += similarity * ORIGINAL_WEIGHT;
                entry.best_similarity = entry.best_similarity.max(*similarity);
                entry.sources.push("original".to_string());
            }
        }

        // Strategy 2: Synonym expansion
        let variants = self.synonym_expander.expand(text);
        // Skip the first variant (it's the original text, already searched)
        for variant in variants.iter().skip(1).take(2) {
            let synonym_results = self.run_strategy(
                variant,
                embedder,
                index,
                k,
                "synonym",
            )?;
            for (verse_id, similarity) in &synonym_results {
                if *similarity >= SYNONYM_CUTOFF {
                    let entry = combined.entry(*verse_id).or_insert_with(|| EnsembleResult {
                        verse_id: *verse_id,
                        score: 0.0,
                        best_similarity: 0.0,
                        sources: Vec::new(),
                    });
                    // Divide weight among synonym variants to avoid over-counting
                    entry.score += similarity * SYNONYM_WEIGHT / 2.0;
                    entry.best_similarity = entry.best_similarity.max(*similarity);
                    if !entry.sources.contains(&"synonym".to_string()) {
                        entry.sources.push("synonym".to_string());
                    }
                }
            }
        }

        // Strategy 3: Concept extraction (key biblical themes)
        let concepts = extract_concepts(text);
        if !concepts.is_empty() {
            let concept_query = concepts.join(" ");
            let concept_results = self.run_strategy(
                &concept_query,
                embedder,
                index,
                k,
                "concept",
            )?;
            for (verse_id, similarity) in &concept_results {
                if *similarity >= CONCEPT_CUTOFF {
                    let entry = combined.entry(*verse_id).or_insert_with(|| EnsembleResult {
                        verse_id: *verse_id,
                        score: 0.0,
                        best_similarity: 0.0,
                        sources: Vec::new(),
                    });
                    entry.score += similarity * CONCEPT_WEIGHT;
                    entry.best_similarity = entry.best_similarity.max(*similarity);
                    if !entry.sources.contains(&"concept".to_string()) {
                        entry.sources.push("concept".to_string());
                    }
                }
            }
        }

        // Filter by ensemble threshold and sort by score
        let mut results: Vec<EnsembleResult> = combined
            .into_values()
            .filter(|r| r.score >= ENSEMBLE_THRESHOLD)
            .collect();

        results.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        results.truncate(k);

        Ok(results)
    }

    /// Run a single strategy: embed text, search index, return results.
    fn run_strategy(
        &mut self,
        text: &str,
        embedder: &dyn TextEmbedder,
        index: &dyn VectorIndex,
        k: usize,
        _strategy_name: &str,
    ) -> Result<Vec<(i64, f64)>, DetectionError> {
        // Check cache
        if let Some((_embedding, results)) = self.cache.get(text) {
            return Ok(results.iter().map(|r| (r.verse_id, r.similarity)).collect());
        }

        let embedding = embedder.embed(text)?;
        let results = index.search(&embedding, k)?;

        // Cache the results
        self.cache
            .insert(text.to_string(), (embedding, results.clone()));

        Ok(results.iter().map(|r| (r.verse_id, r.similarity)).collect())
    }
}

impl Default for EnsembleSearcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Extract key biblical concepts/themes from text.
///
/// This simplistic approach picks out theologically significant words
/// that help identify the verse's topic even when the exact wording differs.
fn extract_concepts(text: &str) -> Vec<String> {
    // Biblical concept keywords — if any appear in the text, include them
    const CONCEPT_WORDS: &[&str] = &[
        "love", "faith", "grace", "mercy", "sin", "salvation", "forgiveness",
        "righteousness", "holy", "spirit", "prayer", "worship", "heaven",
        "eternal", "life", "death", "resurrection", "cross", "blood",
        "covenant", "promise", "blessing", "curse", "judgment", "kingdom",
        "peace", "joy", "hope", "truth", "wisdom", "light", "darkness",
        "shepherd", "lamb", "sacrifice", "temple", "circumcision",
        "baptism", "communion", "apostle", "prophet", "priest",
        "repentance", "obedience", "commandment", "law", "gospel",
    ];

    let lower = text.to_lowercase();
    let words: Vec<&str> = lower.split_whitespace().collect();

    let mut concepts: Vec<String> = Vec::new();
    for &concept in CONCEPT_WORDS {
        if words.iter().any(|w| w.trim_matches(|c: char| !c.is_alphabetic()) == concept) {
            concepts.push(concept.to_string());
        }
    }

    concepts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_concepts() {
        let concepts = extract_concepts("God's grace and love through faith in Jesus");
        assert!(concepts.contains(&"grace".to_string()));
        assert!(concepts.contains(&"love".to_string()));
        assert!(concepts.contains(&"faith".to_string()));
    }

    #[test]
    fn test_extract_concepts_empty() {
        let concepts = extract_concepts("the weather is nice today");
        assert!(concepts.is_empty());
    }

    #[test]
    fn test_ensemble_threshold() {
        assert!(ENSEMBLE_THRESHOLD > 0.0);
        assert!(ORIGINAL_WEIGHT + SYNONYM_WEIGHT + CONCEPT_WEIGHT <= 1.01);
    }
}
