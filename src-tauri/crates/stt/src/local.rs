use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crossbeam_channel::Receiver;
use tokio::sync::mpsc;
use whisper_rs::{
    FullParams, SamplingStrategy, SegmentCallbackData, WhisperContext, WhisperContextParameters,
};

use crate::backend::LocalModelStatus;
use crate::error::SttError;
use crate::types::TranscriptEvent;
use rhema_audio::{
    vad::{Vad, VadConfig, VadTransition},
    AudioFrame,
};

const DEFAULT_MODEL_DIR: &str = "models/whisper";
const DEFAULT_MODEL_NAME: &str = "ggml-small.en.bin";
const MODEL_CANDIDATES: &[&str] = &["ggml-small.en.bin", "ggml-base.en.bin", "ggml-tiny.en.bin"];

const PARTIAL_FRAME_INTERVAL: usize = 16;
const MIN_PARTIAL_SAMPLES: usize = 16_000;

fn model_prompt() -> &'static str {
    "Bible verses, chapter and verse references, Jesus Christ, God, Lord, Holy Spirit, Genesis, Matthew, Mark, Luke, John, Romans, Revelation."
}

fn normalize_whisper_model_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("ggml-") && trimmed.ends_with(".bin") {
        trimmed.to_string()
    } else {
        let stripped_prefix = trimmed.strip_prefix("ggml-").unwrap_or(trimmed);
        let stripped_suffix = stripped_prefix
            .strip_suffix(".bin")
            .unwrap_or(stripped_prefix);
        format!("ggml-{stripped_suffix}.bin")
    }
}

pub fn whisper_model_candidates(base_dir: &Path) -> Vec<PathBuf> {
    let whisper_dir = base_dir.join(DEFAULT_MODEL_DIR);
    let mut candidates = Vec::new();

    if let Ok(env_path) = std::env::var("WHISPER_MODEL_PATH") {
        candidates.push(PathBuf::from(env_path));
    }

    if let Ok(model_name) = std::env::var("WHISPER_MODEL") {
        candidates.push(whisper_dir.join(normalize_whisper_model_name(&model_name)));
    }

    candidates.push(whisper_dir.join(DEFAULT_MODEL_NAME));
    for name in MODEL_CANDIDATES {
        let candidate = whisper_dir.join(name);
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
    }

    candidates
}

pub fn resolve_whisper_model(base_dir: &Path) -> Option<PathBuf> {
    whisper_model_candidates(base_dir)
        .into_iter()
        .find(|path| path.exists())
}

pub fn local_model_status(base_dir: &Path) -> LocalModelStatus {
    let model_path = resolve_whisper_model(base_dir);
    let exists = model_path.is_some();
    let size_bytes = model_path
        .as_ref()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len());

    let model_name = model_path
        .as_ref()
        .and_then(|path| path.file_name())
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| DEFAULT_MODEL_NAME.to_string());

    let note = if exists {
        "Local Whisper.cpp model is ready.".to_string()
    } else {
        format!(
            "Missing local model. Run `bun run download:whisper-model` to download {} into models/whisper/.",
            DEFAULT_MODEL_NAME
        )
    };

    LocalModelStatus {
        model_name,
        model_path,
        exists,
        size_bytes,
        note,
    }
}

pub struct LocalWhisperClient {
    context: Arc<WhisperContext>,
    model_path: PathBuf,
    language: Option<String>,
    threads: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum JobKind {
    Partial,
    Final,
}

#[derive(Debug)]
struct LocalJob {
    utterance_id: u64,
    kind: JobKind,
    samples: Vec<i16>,
}

#[derive(Debug)]
struct TranscriptionResult {
    transcript: String,
    confidence: f64,
}

impl LocalWhisperClient {
    pub fn new(model_path: PathBuf) -> Result<Self, SttError> {
        if !model_path.exists() {
            return Err(SttError::LocalModelMissing(
                model_path.to_string_lossy().to_string(),
            ));
        }

        let threads = std::thread::available_parallelism()
            .map(|n| n.get().saturating_sub(1).max(1))
            .unwrap_or(4);

        let context = WhisperContext::new_with_params(
            model_path.to_string_lossy().into_owned(),
            WhisperContextParameters::default(),
        )
        .map_err(|e| SttError::LocalModelLoadFailed(e.to_string()))?;

        Ok(Self {
            context: Arc::new(context),
            model_path,
            language: Some("en".to_string()),
            threads,
        })
    }

    pub fn model_status(&self) -> LocalModelStatus {
        let size_bytes = std::fs::metadata(&self.model_path)
            .ok()
            .map(|meta| meta.len());

        LocalModelStatus {
            model_name: self
                .model_path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| DEFAULT_MODEL_NAME.to_string()),
            model_path: Some(self.model_path.clone()),
            exists: true,
            size_bytes,
            note: "Local Whisper.cpp model is ready.".to_string(),
        }
    }

    pub async fn connect(
        &self,
        audio_rx: Receiver<AudioFrame>,
        event_tx: mpsc::Sender<TranscriptEvent>,
    ) -> Result<(), SttError> {
        let context = self.context.clone();
        let model_path = self.model_path.clone();
        let language = self.language.clone();
        let threads = self.threads;

        tokio::task::spawn_blocking(move || {
            run_local_session(context, model_path, language, threads, audio_rx, event_tx)
        })
        .await
        .map_err(|e| SttError::ConnectionFailed(format!("Local Whisper worker join failed: {e}")))?
    }
}

fn run_local_session(
    context: Arc<WhisperContext>,
    _model_path: PathBuf,
    language: Option<String>,
    threads: usize,
    audio_rx: Receiver<AudioFrame>,
    event_tx: mpsc::Sender<TranscriptEvent>,
) -> Result<(), SttError> {
    let job_rx_cancel = Arc::new(AtomicBool::new(false));
    let worker_failed = Arc::new(AtomicBool::new(false));
    let worker_error = Arc::new(Mutex::new(None::<String>));
    let (job_tx, job_rx) = crossbeam_channel::bounded::<LocalJob>(8);

    let worker_failed_thread = worker_failed.clone();
    let worker_error_thread = worker_error.clone();
    let worker_cancel = job_rx_cancel.clone();
    let worker_context = context.clone();
    let worker_language = language.clone();
    let worker_event_tx = event_tx.clone();

    let worker = std::thread::Builder::new()
        .name("whisper-worker".into())
        .spawn(move || {
            let mut current_utterance_id = 0_u64;
            let last_partial = Arc::new(Mutex::new(String::new()));

            while !worker_cancel.load(Ordering::SeqCst) {
                let job = match job_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(job) => job,
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                };

                if job.utterance_id != current_utterance_id {
                    current_utterance_id = job.utterance_id;
                    if let Ok(mut last) = last_partial.lock() {
                        last.clear();
                    }
                }

                match transcribe_chunk(
                    &worker_context,
                    worker_language.as_deref(),
                    threads,
                    &job.samples,
                    &worker_event_tx,
                    &last_partial,
                ) {
                    Ok(result) => {
                        if job.kind == JobKind::Final && !result.transcript.is_empty() {
                            let _ = worker_event_tx.blocking_send(TranscriptEvent::Final {
                                transcript: result.transcript,
                                words: vec![],
                                confidence: result.confidence,
                                speech_final: true,
                            });
                        }
                    }
                    Err(err) => {
                        worker_failed_thread.store(true, Ordering::SeqCst);
                        if let Ok(mut slot) = worker_error_thread.lock() {
                            *slot = Some(err.to_string());
                        }
                        let _ =
                            worker_event_tx.blocking_send(TranscriptEvent::Error(err.to_string()));
                        break;
                    }
                }
            }
        })
        .map_err(|e| SttError::ConnectionFailed(format!("Failed to spawn Whisper worker: {e}")))?;

    let audio_event_tx = event_tx.clone();
    let audio_cancel = job_rx_cancel.clone();
    let audio_worker_failed = worker_failed.clone();
    let audio = std::thread::Builder::new()
        .name("whisper-audio".into())
        .spawn(move || {
            let mut vad = Vad::new(VadConfig::default());
            let mut current_utterance: Vec<i16> = Vec::new();
            let mut in_speech = false;
            let mut utterance_id: u64 = 0;
            let mut frames_since_partial = 0usize;

            let _ = audio_event_tx.blocking_send(TranscriptEvent::Connected);

            loop {
                if audio_cancel.load(Ordering::SeqCst) {
                    break;
                }
                if audio_worker_failed.load(Ordering::SeqCst) {
                    break;
                }

                let frame = match audio_rx.recv_timeout(Duration::from_millis(100)) {
                    Ok(frame) => frame,
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
                };

                let vad_result = vad.process(&frame);

                match vad_result.transition {
                    Some(VadTransition::SpeechStarted) => {
                        utterance_id = utterance_id.wrapping_add(1);
                        current_utterance.clear();
                        in_speech = true;
                        frames_since_partial = 0;
                        let _ = audio_event_tx.blocking_send(TranscriptEvent::SpeechStarted);
                    }
                    Some(VadTransition::SpeechEnded) => {
                        if in_speech && !current_utterance.is_empty() {
                            let samples = std::mem::take(&mut current_utterance);
                            if job_tx
                                .send(LocalJob {
                                    utterance_id,
                                    kind: JobKind::Final,
                                    samples,
                                })
                                .is_err()
                            {
                                break;
                            }
                        }
                        in_speech = false;
                        frames_since_partial = 0;
                    }
                    None => {}
                }

                if !vad_result.frames.is_empty() {
                    for frame in vad_result.frames {
                        current_utterance.extend(frame.samples);
                    }

                    if in_speech {
                        frames_since_partial += 1;
                        if frames_since_partial >= PARTIAL_FRAME_INTERVAL
                            && current_utterance.len() >= MIN_PARTIAL_SAMPLES
                        {
                            let _ = job_tx.try_send(LocalJob {
                                utterance_id,
                                kind: JobKind::Partial,
                                samples: current_utterance.clone(),
                            });
                            frames_since_partial = 0;
                        }
                    }
                }
            }

            if in_speech && !current_utterance.is_empty() {
                let _ = job_tx.send(LocalJob {
                    utterance_id,
                    kind: JobKind::Final,
                    samples: current_utterance,
                });
            }
        })
        .map_err(|e| {
            SttError::ConnectionFailed(format!("Failed to spawn Whisper audio thread: {e}"))
        })?;

    while !audio.is_finished() || !worker.is_finished() {
        if worker_failed.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    job_rx_cancel.store(true, Ordering::SeqCst);
    let _ = audio.join();
    let _ = worker.join();

    if worker_failed.load(Ordering::SeqCst) {
        if let Ok(slot) = worker_error.lock() {
            if let Some(message) = slot.clone() {
                return Err(SttError::ConnectionFailed(message));
            }
        }
        return Err(SttError::ConnectionFailed(
            "Local Whisper transcription failed".to_string(),
        ));
    }

    let _ = event_tx.blocking_send(TranscriptEvent::Disconnected);
    Ok(())
}

fn transcribe_chunk(
    context: &Arc<WhisperContext>,
    language: Option<&str>,
    threads: usize,
    samples: &[i16],
    event_tx: &mpsc::Sender<TranscriptEvent>,
    last_partial: &Arc<Mutex<String>>,
) -> Result<TranscriptionResult, SttError> {
    if samples.is_empty() {
        return Ok(TranscriptionResult {
            transcript: String::new(),
            confidence: 0.0,
        });
    }

    let mut state = context
        .create_state()
        .map_err(|e| SttError::LocalModelLoadFailed(e.to_string()))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(threads as i32);
    params.set_translate(false);
    params.set_no_context(true);
    params.set_single_segment(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_initial_prompt(model_prompt());
    if let Some(language) = language {
        params.set_language(Some(language));
    }

    let partial_segments = Arc::new(Mutex::new(Vec::<String>::new()));
    let partial_segments_cb = partial_segments.clone();
    let event_tx_cb = event_tx.clone();
    let last_partial_cb = last_partial.clone();

    let segment_callback: Box<dyn FnMut(SegmentCallbackData)> =
        Box::new(move |segment: SegmentCallbackData| {
            let text = segment.text.trim().to_string();
            if text.is_empty() {
                return;
            }

            if let Ok(mut parts) = partial_segments_cb.lock() {
                parts.push(text);
                let joined = parts.join(" ");

                if let Ok(mut last) = last_partial_cb.lock() {
                    if *last != joined {
                        *last = joined.clone();
                        let _ = event_tx_cb.try_send(TranscriptEvent::Partial {
                            transcript: joined,
                            words: vec![],
                        });
                    }
                }
            }
        });

    params.set_segment_callback_safe_lossy::<
        Option<Box<dyn FnMut(SegmentCallbackData)>>,
        Box<dyn FnMut(SegmentCallbackData)>,
    >(Some(segment_callback));

    let audio: Vec<f32> = samples
        .iter()
        .map(|sample| *sample as f32 / i16::MAX as f32)
        .collect();

    state
        .full(params, &audio)
        .map_err(|e| SttError::ConnectionFailed(format!("Whisper transcription failed: {e}")))?;

    let mut transcript = String::new();
    let mut confidences = Vec::new();
    for segment in state.as_iter() {
        let text = segment
            .to_str_lossy()
            .unwrap_or_default()
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }

        if !transcript.is_empty() {
            transcript.push(' ');
        }
        transcript.push_str(&text);
        confidences.push(1.0 - segment.no_speech_probability().clamp(0.0, 1.0));
    }

    if transcript.is_empty() {
        if let Ok(parts) = partial_segments.lock() {
            transcript = parts.join(" ");
        }
    }

    let confidence = if confidences.is_empty() {
        0.0
    } else {
        confidences.iter().copied().sum::<f32>() / confidences.len() as f32
    } as f64;

    Ok(TranscriptionResult {
        transcript,
        confidence,
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_whisper_model_name;

    #[test]
    fn normalize_whisper_model_name_handles_shortcuts_and_prefixes() {
        assert_eq!(normalize_whisper_model_name("tiny.en"), "ggml-tiny.en.bin");
        assert_eq!(
            normalize_whisper_model_name("ggml-small.en.bin"),
            "ggml-small.en.bin"
        );
        assert_eq!(
            normalize_whisper_model_name("ggml-base.en"),
            "ggml-base.en.bin"
        );
    }
}
