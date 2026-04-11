use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;
use crate::commands::detection::DetectionResult;

/// Run semantic (ONNX embedding) detection. Slow, runs in background worker.
pub fn run(app: &AppHandle, transcript: &str) {
    log::info ! ("[DET-SEMANTIC] Running on: {:?}", &transcript[..transcript.len().min(80)]);
    let managed: State<'_, Mutex<AppState>> = app.state();
    let mut app_state = match managed.lock() {
        Ok(s) => s,
        Err(e) => {
            log::error!("Failed to lock AppState for semantic detection: {e}");
            return;
        }
    };
    let mut detections = app_state.detection_pipeline.process_semantic(transcript);
    if detections.is_empty() {
        log::info ! ("[DET-SEMANTIC] No detections");
        return;
    }

    for m in &mut detections {
        let boost = app_state.sermon_context.confidence_boost(
            m.detection.verse_ref.book_number,
            m.detection.verse_ref.chapter,
        );
        if boost > 0.0 {
            m.detection.confidence = (m.detection.confidence + boost).min(1.0);
        }
    }

    if let Some(top) = detections.first() {
        app_state.sermon_context.update(
            &top.detection.verse_ref,
            top.detection.confidence,
            "semantic",
        );
    }

    let results: Vec<DetectionResult> = detections
        .iter()
        .map(|m| crate::commands::detection::to_result(&app_state, m))
        .collect();
    for r in &results {
        log::info ! (
            "[DET-SEMANTIC] Found: {} ({:.0}% {}) auto_q={}",
            r.verse_ref, r.confidence * 100.0, r.source, r.auto_queued
        );
    }
    drop(app_state);
    let _ = app.emit("verse_detections", &results);
}
