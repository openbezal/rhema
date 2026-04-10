use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub confidence: f64,
    pub punctuated_word: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionBackend {
    Auto,
    Local,
    Deepgram,
}

#[derive(Debug, Clone)]
pub enum TranscriptEvent {
    Partial {
        transcript: String,
        words: Vec<Word>,
    },
    Final {
        transcript: String,
        words: Vec<Word>,
        confidence: f64,
        speech_final: bool,
    },
    UtteranceEnd,
    SpeechStarted,
    Error(String),
    Connected,
    Disconnected,
}

#[derive(Debug, Clone)]
pub struct SttConfig {
    pub api_key: String,
    pub model: String,
    pub sample_rate: u32,
    pub encoding: String,
    pub language: Option<String>,
}

impl Default for SttConfig {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            model: "nova-3".to_string(),
            sample_rate: 16000,
            encoding: "linear16".to_string(),
            language: None,
        }
    }
}

impl TranscriptionBackend {
    pub fn from_option(value: Option<&str>) -> Self {
        match value.unwrap_or("auto").to_lowercase().as_str() {
            "local" => Self::Local,
            "deepgram" => Self::Deepgram,
            _ => Self::Auto,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Local => "local",
            Self::Deepgram => "deepgram",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::TranscriptionBackend;

    #[test]
    fn transcription_backend_from_option_normalizes_case_and_defaults() {
        assert_eq!(
            TranscriptionBackend::from_option(None),
            TranscriptionBackend::Auto
        );
        assert_eq!(
            TranscriptionBackend::from_option(Some("LOCAL")),
            TranscriptionBackend::Local
        );
        assert_eq!(
            TranscriptionBackend::from_option(Some("deepgram")),
            TranscriptionBackend::Deepgram
        );
        assert_eq!(
            TranscriptionBackend::from_option(Some("something-else")),
            TranscriptionBackend::Auto
        );
        assert_eq!(TranscriptionBackend::Local.as_str(), "local");
    }
}
