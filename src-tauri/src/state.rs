use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use rhema_bible::BibleDb;
use rhema_detection::DetectionPipeline;

pub struct AppState {
    pub bible_db: Option<BibleDb>,
    pub detection_pipeline: DetectionPipeline,
    pub active_translation_id: i64,
    pub audio_active: Arc<AtomicBool>,
    pub stt_active: Arc<AtomicBool>,
    pub verse_predictor: VersePredictor,
    #[expect(dead_code, reason = "reserved for future Deepgram key injection")]
    pub deepgram_api_key: Option<String>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            bible_db: None,
            detection_pipeline: DetectionPipeline::new(),
            active_translation_id: 1,
            audio_active: Arc::new(AtomicBool::new(false)),
            stt_active: Arc::new(AtomicBool::new(false)),
            verse_predictor: VersePredictor::new(),
            deepgram_api_key: None,
        }
    }
}
