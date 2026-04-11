/// Cloud embedding client for `OpenAI` text-embedding-3-large.
///
/// Used as a fallback when local semantic confidence is below a threshold.
/// When enabled, the pipeline will re-embed low-confidence chunks via the
/// `OpenAI` API and perform a second search pass against the same vector index.
#[derive(Debug)]
pub struct CloudBooster {
    api_key: Option<String>,
    model: String,
    confidence_gate: f64, // trigger cloud when local sim < this (default 0.80)
    enabled: bool,
}

impl CloudBooster {
    pub fn new() -> Self {
        Self {
            api_key: None,
            model: "text-embedding-3-large".to_string(),
            confidence_gate: 0.80,
            enabled: false,
        }
    }

    /// Configure the `OpenAI` API key and enable cloud boost.
    pub fn set_api_key(&mut self, key: String) {
        self.api_key = Some(key);
        self.enabled = true;
    }

    /// Returns `true` when cloud boost is configured and enabled.
    pub fn is_enabled(&self) -> bool {
        self.enabled && self.api_key.is_some()
    }

    /// Returns the model identifier used for cloud embeddings.
    pub fn model(&self) -> &str {
        &self.model
    }

    /// Check if a local result should trigger a cloud boost.
    ///
    /// Returns `true` when cloud is enabled and the given local similarity
    /// score falls below the confidence gate.
    pub fn should_boost(&self, local_similarity: f64) -> bool {
        self.is_enabled() && local_similarity < self.confidence_gate
    }

    /// Update the confidence gate threshold.
    pub fn set_confidence_gate(&mut self, gate: f64) {
        self.confidence_gate = gate;
    }

    /// Returns the current confidence gate value.
    pub fn confidence_gate(&self) -> f64 {
        self.confidence_gate
    }

    // Note: actual HTTP call to OpenAI will be added when reqwest is integrated.
    // For now this defines the API surface only.
}

impl Default for CloudBooster {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_state() {
        let booster = CloudBooster::new();
        assert!(!booster.is_enabled());
        assert!(!booster.should_boost(0.5));
        assert_eq!(booster.model(), "text-embedding-3-large");
        assert!((booster.confidence_gate() - 0.80).abs() < f64::EPSILON);
    }

    #[test]
    fn test_enable_with_api_key() {
        let mut booster = CloudBooster::new();
        booster.set_api_key("sk-test-key".to_string());
        assert!(booster.is_enabled());
    }

    #[test]
    fn test_should_boost_when_enabled() {
        let mut booster = CloudBooster::new();
        booster.set_api_key("sk-test-key".to_string());

        // Below gate -> should boost
        assert!(booster.should_boost(0.60));
        // At gate -> should not boost
        assert!(!booster.should_boost(0.80));
        // Above gate -> should not boost
        assert!(!booster.should_boost(0.95));
    }

    #[test]
    fn test_should_not_boost_when_disabled() {
        let booster = CloudBooster::new();
        // Even low similarity should not boost when disabled
        assert!(!booster.should_boost(0.10));
    }

    #[test]
    fn test_custom_confidence_gate() {
        let mut booster = CloudBooster::new();
        booster.set_api_key("sk-test-key".to_string());
        booster.set_confidence_gate(0.60);

        assert!(booster.should_boost(0.50));
        assert!(!booster.should_boost(0.70));
    }
}
