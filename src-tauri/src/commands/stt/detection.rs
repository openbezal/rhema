use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use crate::state::AppState;

/// Run direct (regex/pattern) detection only. Instant, no ONNX.
/// Returns true if high-confidence results were found (>= 0.90).
pub fn run_direct_detection(app: &AppHandle, transcript: &str) -> bool {
    use rhema_detection::{DirectDetector, DetectionMerger};

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
            let results: Vec<crate::commands::detection::DetectionResult> = merged
                .iter()
                .map(|m| {
                    let vr = &m.detection.verse_ref;
                    crate::commands::detection::DetectionResult {
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
                })
                .collect();
            for r in &results {
                log::info!("[DET-DIRECT] Found: {} ({:.0}%) (no DB)", r.verse_ref, r.confidence * 100.0);
            }
            let _ = app.emit("verse_detections", &results);
            return has_high_confidence;
        }
    };
    let results: Vec<crate::commands::detection::DetectionResult> = merged
        .iter()
        .map(|m| crate::commands::detection::to_result(&app_state, m))
        .collect();

    for m in &merged {
        app_state.sermon_context.update(
            &m.detection.verse_ref,
            m.detection.confidence,
            "direct",
        );
    }

    for r in &results {
        log::info!("[DET-DIRECT] Found: {} ({:.0}%)", r.verse_ref, r.confidence * 100.0);
    }
    drop(app_state);
    let _ = app.emit("verse_detections", &results);
    has_high_confidence
}

/// Run semantic (ONNX embedding) detection. Slow, runs in background worker.
pub fn run_semantic_detection(app: &AppHandle, transcript: &str) {
    log::info!("[DET-SEMANTIC] Running on: {:?}", &transcript[..transcript.len().min(80)]);
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
        log::info!("[DET-SEMANTIC] No detections");
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

    let results: Vec<crate::commands::detection::DetectionResult> = detections
        .iter()
        .map(|m| crate::commands::detection::to_result(&app_state, m))
        .collect();
    for r in &results {
        log::info!(
            "[DET-SEMANTIC] Found: {} ({:.0}% {}) auto_q={}",
            r.verse_ref, r.confidence * 100.0, r.source, r.auto_queued
        );
    }
    drop(app_state);
    let _ = app.emit("verse_detections", &results);
}

/// Check reading mode: if active, test transcript against expected verse.
pub fn check_reading_mode(app: &AppHandle, transcript: &str, direct_found: bool) {
    use rhema_detection::ReadingMode;

    if direct_found {
        let verse_info = {
            let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
            let detector = match detector_state.lock() {
                Ok(d) => d,
                Err(_) => return,
            };
            detector.recent_detections.front().cloned()
        };

        if let Some(recent) = verse_info {
            let detection_confidence = 0.95; // Direct detections are high confidence

            let should_start = {
                let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
                match rm_managed.lock() {
                    Ok(rm) => {
                        if !rm.is_active() && !rm.has_verses() {
                            true
                        } else if !rm.is_active() && rm.has_verses() {
                            true
                        } else if rm.current_book() == recent.book_number
                            && rm.current_chapter() == recent.chapter {
                            false
                        } else if rm.current_book() != recent.book_number
                            && detection_confidence >= 0.90 {
                            true
                        } else if rm.current_book() == recent.book_number {
                            true
                        } else {
                            false
                        }
                    }
                    Err(_) => false,
                }
            };

            if should_start {
                let chapter_data = {
                    let app_managed: State<'_, Mutex<crate::state::AppState>> = app.state();
                    let app_state = match app_managed.try_lock() {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    match &app_state.bible_db {
                        Some(db) => db.get_chapter(app_state.active_translation_id, recent.book_number, recent.chapter).ok(),
                        None => None,
                    }
                };

                if let Some(chapter_verses) = chapter_data {
                    let verses: Vec<(i32, String)> = chapter_verses
                        .into_iter()
                        .map(|v| (v.verse, v.text))
                        .collect();

                    let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
                    if let Ok(mut rm) = rm_managed.lock() {
                        rm.start(
                            recent.book_number,
                            &recent.book_name,
                            recent.chapter,
                            recent.verse_start,
                            verses,
                        );
                    }
                }
            }
        }
    }

    let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
    let advance = {
        let mut rm = match rm_managed.lock() {
            Ok(rm) => rm,
            Err(_) => return,
        };
        if !rm.is_active() {
            return;
        }
        rm.check_transcript(transcript)
    };

    if let Some(advance) = advance {
        let _ = app.emit("reading_mode_verse", &advance);

        let result = crate::commands::detection::DetectionResult {
            verse_ref: advance.reference.clone(),
            verse_text: advance.verse_text.clone(),
            book_name: advance.book_name.clone(),
            book_number: advance.book_number,
            chapter: advance.chapter,
            verse: advance.verse,
            confidence: advance.confidence,
            source: "contextual".to_string(),
            auto_queued: true,
            transcript_snippet: String::new(),
        };
        let _ = app.emit("verse_detections", &vec![result]);
    }
}

/// Check for voice translation commands like \"read in NIV\".
pub fn check_translation_command(app: &AppHandle, transcript: &str) {
    let detector_state: State<'_, Mutex<rhema_detection::DirectDetector>> = app.state();
    let detector = match detector_state.lock() {
        Ok(d) => d,
        Err(_) => return,
    };

    if let Some(abbrev) = detector.detect_translation_command(transcript) {
        drop(detector);

        let managed: State<'_, Mutex<AppState>> = app.state();
        let mut app_state = match managed.try_lock() {
            Ok(s) => s,
            Err(_) => return,
        };

        if let Some(ref db) = app_state.bible_db {
            if let Ok(translations) = db.list_translations() {
                if let Some(t) = translations.iter().find(|t| t.abbreviation == abbrev) {
                    app_state.active_translation_id = t.id;
                    log::info!("[STT] Voice command: switched to {} (id={})", abbrev, t.id);
                    drop(app_state);

                    #[derive(serde::Serialize, Clone)]
                    struct TranslationSwitch {
                        abbreviation: String,
                        translation_id: i64,
                    }
                    let _ = app.emit("translation_command", TranslationSwitch {
                        abbreviation: abbrev,
                        translation_id: t.id,
                    });
                }
            }
        }
    }
}

/// Run quotation matching against all loaded Bible translations.
pub fn run_quotation_matching(app: &AppHandle, transcript: &str) {
    {
        use rhema_detection::ReadingMode;
        let rm_managed: &Mutex<ReadingMode> = app.state::<Mutex<ReadingMode>>().inner();
        if let Ok(rm) = rm_managed.lock() {
            if rm.is_active() || rm.has_verses() {
                return;
            }
        }
    }

    let managed: State<'_, Mutex<AppState>> = app.state();
    let app_state = match managed.try_lock() {
        Ok(s) => s,
        Err(_) => return,
    };

    if !app_state.quotation_matcher.is_ready() {
        return;
    }

    let detections = app_state.quotation_matcher.match_transcript(transcript);
    if detections.is_empty() {
        return;
    }

    let results: Vec<crate::commands::detection::DetectionResult> = detections
        .iter()
        .map(|d| {
            let vr = &d.verse_ref;
            let verse_text = if let Some(ref db) = app_state.bible_db {
                db.get_verse(
                    app_state.active_translation_id,
                    vr.book_number,
                    vr.chapter,
                    vr.verse_start,
                )
                .ok()
                .flatten()
                .map(|v| v.text)
                .unwrap_or_default()
            } else {
                String::new()
            };

            crate::commands::detection::DetectionResult {
                verse_ref: format!("{} {}:{}", vr.book_name, vr.chapter, vr.verse_start),
                verse_text,
                book_name: vr.book_name.clone(),
                book_number: vr.book_number,
                chapter: vr.chapter,
                verse: vr.verse_start,
                confidence: d.confidence,
                source: "quotation".to_string(),
                auto_queued: d.confidence >= 0.85,
                transcript_snippet: d.transcript_snippet.clone(),
            }
        })
        .collect();

    for r in &results {
        log::info!(
            "[DET-QUOTATION] Found: {} ({:.0}%) auto_q={}",
            r.verse_ref,
            r.confidence * 100.0,
            r.auto_queued
        );
    }

    drop(app_state);
    let _ = app.emit("verse_detections", &results);
}
