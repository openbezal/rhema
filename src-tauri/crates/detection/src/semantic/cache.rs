use lru::LruCache;
use std::num::NonZeroUsize;

use super::index::SearchResult;

/// LRU cache that maps a text chunk to its embedding and top-k search results.
///
/// This avoids redundant embedding and search calls when the same chunk
/// appears in overlapping transcript windows.
pub struct EmbeddingCache {
    cache: LruCache<String, (Vec<f32>, Vec<SearchResult>)>,
}

impl EmbeddingCache {
    /// Create a cache with the given maximum number of entries.
    ///
    /// # Panics
    ///
    /// Panics if `capacity` is 0.
    pub fn new(capacity: usize) -> Self {
        Self {
            cache: LruCache::new(NonZeroUsize::new(capacity).expect("capacity must be > 0")),
        }
    }

    /// Look up a cached entry by the original text chunk.
    pub fn get(&mut self, key: &str) -> Option<&(Vec<f32>, Vec<SearchResult>)> {
        self.cache.get(key)
    }

    /// Insert an entry into the cache, evicting the least-recently-used
    /// entry if the cache is full.
    pub fn insert(&mut self, key: String, value: (Vec<f32>, Vec<SearchResult>)) {
        self.cache.put(key, value);
    }

    /// Remove all entries from the cache.
    pub fn clear(&mut self) {
        self.cache.clear();
    }
}

# [ cfg ( test ) ]
mod tests {
    use super::*;

    # [ test ]
    fn test_cache_insert_and_get() {
        let mut cache = EmbeddingCache::new(10);
        let embedding = vec![1.0, 2.0, 3.0];
        let results = vec![SearchResult {
            verse_id: 42,
            similarity: 0.95,
        }];
        cache.insert("hello".to_string(), (embedding.clone(), results));

        let entry = cache.get("hello").unwrap();
        assert_eq!(entry.0, embedding);
        assert_eq!(entry.1.len(), 1);
        assert_eq!(entry.1[0].verse_id, 42);
    }

    # [ test ]
    fn test_cache_miss() {
        let mut cache = EmbeddingCache::new(10);
        assert!(cache.get("missing").is_none());
    }

    # [ test ]
    fn test_cache_eviction() {
        let mut cache = EmbeddingCache::new(2);
        cache.insert("a".to_string(), (vec![1.0], vec![]));
        cache.insert("b".to_string(), (vec![2.0], vec![]));
        cache.insert("c".to_string(), (vec![3.0], vec![]));

        // "a" should have been evicted
        assert!(cache.get("a").is_none());
        assert!(cache.get("b").is_some());
        assert!(cache.get("c").is_some());
    }

    # [ test ]
    fn test_cache_clear() {
        let mut cache = EmbeddingCache::new(10);
        cache.insert("x".to_string(), (vec![1.0], vec![]));
        cache.clear();
        assert!(cache.get("x").is_none());
    }
}
