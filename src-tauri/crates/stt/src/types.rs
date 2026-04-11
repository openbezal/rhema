use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub confidence: f64,
    pub punctuated_word: Option<String>,
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
