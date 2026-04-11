use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use crate::state::AppState;
use rhema_detection::{DirectDetector, DetectionMerger, MergedDetection};
use crate::commands::detection::DetectionResult;

/// Run direct (regex/pattern) detection only. Instant, no ONNX.
/// Returns true if high-confidence results were found (>= 0.90).
pub fn run(app: &AppHandle, transcript: &str) -> bool {
    let detector_state: State<'_, Mutex<DirectDetector>> = app.state();
    let mut detector = match detector_state.lock() {
        Ok(d) => d,
        Err(e) => {
            log::error!("Failed to lock DirectDetector: {e}");
            return false;
        }
    };
    let direct_results = detector.detect(transcript);
    drop(detector); // Release immediately

    if direct_results.is_empty() {
        return false;
    }

    // Check if any result has high confidence before merging
    let has_high_confidence = direct_results.iter().any(|d| d.confidence >= 0.90);

    // Merge using the managed merger
    let merger_state: State<'_, Mutex<DetectionMerger>> = app.state();
    let mut merger = match merger_state.lock() {
        Ok(m) => m,
        Err(e) => {
            log::error!("Failed to lock DetectionMerger: {e}");
            return false;
        }
    };
    let merged = merger.merge(direct_results, vec![]);
    drop(merger);
    if merged.is_empty() {
        return false;
    }

    // Resolve verse info from DB
    let app_managed: State<'_, Mutex<AppState>> = app.state();
    let mut app_state = match app_managed.try_lock() {
        Ok(s) => s,
        Err(_) => {
            // AppState locked by semantic worker — emit results without verse text
            let results: Vec<DetectionResult> = merged
                .iter()
                .map(map_no_db)
                .collect();
            for r in &results {
                log::info!("[DET-DIRECT] Found: {} ({:.0}%) (no DB)", r.verse_ref, r.confidence * 100.0);
            }
            let _ = app.emit("verse_detections", &results);
            return has_high_confidence;
        }
    };

    let results: Vec<DetectionResult> = merged
        .iter()
        .map(|m| crate::commands::detection::to_result(&app_state, m))
        .collect();

    // Update sermon context
    for m in &merged {
        app_state.sermon_context.update(
            &m.detection.verse_ref,
            m.detection.confidence,
            "direct",
        );
    }

    for r in &results {
        log::info ! ("[DET-DIRECT] Found: {} ({:.0}%)", r.verse_ref, r.confidence * 100.0);
    }
    
    drop(app_state);
    let _ = app.emit("verse_detections", &results);
    has_high_confidence
}

/// Helper for direct detection without DB access.
fn map_no_db(m: &MergedDetection) -> DetectionResult {
    let vr = &m.detection.verse_ref;
    DetectionResult {
        verse_ref: format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start),
        verse_text: String::new(),
        book_name: vr.book_name.clone(),
        book_number: vr.book_number,
        chapter: vr.chapter,
        verse: vr.verse_start,
        confidence: m.detection.confidence,
        source: "direct".to_string(),
        auto_queued: m.auto_queued,
        transcript_snippet: m.detection.transcript_snippet.clone(),
    }
}

# [ cfg ( test ) ]
mod tests {
    use super::*;

    # [ test ]
    fn test_direct_run_no_detector() {
        // Mock app without the required state should handle lock failure gracefully
        let app = tauri::test::mock_builder().build(tauri::generate_context!()).unwrap();
        assert!(!run(&app.handle(), "John 3:16"));
    }

    # [ cfg ( kani ) ]
    mod kani_proofs {
        use super::*;

        #[kani::proof]
        fn proof_direct_logic_boundary() {
            // Verifies that the mapping logic handles empty strings safely
            let app = tauri::test::mock_builder().build(tauri::generate_context!()).unwrap();
            let handle = app.handle();
            assert!(!run(&handle, ""));
        }
    }
}
