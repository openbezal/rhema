use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use rhema_bible::BibleDb;
use rhema_detection::{DetectionPipeline, QuotationMatcher, SermonContext};

/// Global application state container.
pub struct AppState {
    pub bible_db: Option<BibleDb>,
    pub http_client: reqwest::Client,
    pub detection_pipeline: DetectionPipeline,
    pub sermon_context: SermonContext,
    pub quotation_matcher: QuotationMatcher,
    pub active_translation_id: i64,
    pub audio_active: Arc<AtomicBool>,
    pub stt_active: Arc<AtomicBool>,
    #[allow(dead_code)]
    pub deepgram_api_key: Option<String>,
}

impl AppState {
    /// Create a new AppState instance with the provided HTTP client.
    pub fn new(http_client: reqwest::Client) -> Self {
        log::info ! ("[AppState] Initializing institutional core state engine");
        Self {
            bible_db: None,
            http_client,
            detection_pipeline: DetectionPipeline::new(),
            sermon_context: SermonContext::new(),
            quotation_matcher: QuotationMatcher::new(),
            active_translation_id: 1, // Default to first translation (KJV)
            audio_active: Arc::new(AtomicBool::new(false)),
            stt_active: Arc::new(AtomicBool::new(false)),
            deepgram_api_key: None,
        }
    }
}
