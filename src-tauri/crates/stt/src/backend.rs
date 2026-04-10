use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::types::TranscriptionBackend;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalModelStatus {
    pub model_name: String,
    pub model_path: Option<PathBuf>,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionStatus {
    pub backend: TranscriptionBackend,
    pub recommended_backend: TranscriptionBackend,
    pub local_model: LocalModelStatus,
    pub deepgram_key_configured: bool,
}

#[cfg(test)]
mod tests {
    use crate::local::local_model_status;
    use std::fs;

    #[test]
    fn local_model_status_detects_expected_model_path() {
        let unique = format!(
            "rhema-stt-local-model-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_nanos()
        );
        let base_dir = std::env::temp_dir().join(unique);
        let model_path = base_dir.join("models/whisper/ggml-small.en.bin");

        fs::create_dir_all(model_path.parent().expect("model parent")).expect("create model dir");
        fs::write(&model_path, b"abc").expect("write model file");

        let status = local_model_status(&base_dir);

        assert!(status.exists);
        assert_eq!(status.model_name, "ggml-small.en.bin");
        assert_eq!(status.model_path.as_ref(), Some(&model_path));
        assert_eq!(status.size_bytes, Some(3));
        assert!(status.note.contains("Local Whisper.cpp model"));

        let _ = fs::remove_dir_all(&base_dir);
    }
}
