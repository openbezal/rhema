use crate::meter;
use crate::types::AudioFrame;

#[derive(Debug, Clone)]
pub struct VadConfig {
    /// RMS level below which a frame is considered silence (0.0-1.0).
    pub silence_threshold: f32,
    /// Per-frame voice energy threshold.
    pub frame_threshold: f32,
    /// Overall voice probability threshold (ratio of voiced frames in window).
    pub overall_threshold: f32,
    /// How many consecutive silent frames before transitioning to Silence.
    pub silence_frame_count: usize,
    /// Minimum voiced frames before transitioning to Speech.
    pub min_voice_frames: usize,
    /// Maximum utterance length in frames before force-flushing.
    pub max_utterance_frames: usize,
    /// Number of pre-speech frames to keep (captures speech onset).
    pub pre_buffer_frames: usize,
}

impl Default for VadConfig {
    fn default() -> Self {
        // At 16kHz with ~1024 sample frames: 1 frame ≈ 64ms
        // Defaults: silence_threshold=0.005, frame_threshold=0.0025,
        // overall_threshold=0.05
        Self {
            silence_threshold: 0.005,
            frame_threshold: 0.0025,
            overall_threshold: 0.05,
            silence_frame_count: 12,       // ~750ms of silence to end
            min_voice_frames: 4,           // ~250ms of voice to start
            max_utterance_frames: 240,     // ~15s max utterance
            pre_buffer_frames: 4,          // ~250ms pre-buffer
        }
    }
}

/// VAD state machine states.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadState {
    /// No speech detected. Audio is NOT forwarded.
    Silence,
    /// Speech detected. Audio IS forwarded.
    Speech,
    /// Speech ended but within trailing window. Audio still forwarded.
    Trailing,
}

/// Voice Activity Detector that gates audio frames.
///
/// Only frames during Speech/Trailing states are forwarded to the consumer.
/// Uses energy-based detection via RMS levels from the existing meter module.
pub struct Vad {
    config: VadConfig,
    state: VadState,
    /// Count of consecutive voiced frames (for Silence→Speech transition).
    voice_count: usize,
    /// Count of consecutive silent frames (for Speech→Trailing→Silence).
    silence_count: usize,
    /// Total frames in current utterance.
    utterance_frames: usize,
    /// Circular pre-buffer of recent frames (kept during Silence).
    pre_buffer: Vec<AudioFrame>,
}

impl Vad {
    pub fn new(config: VadConfig) -> Self {
        Self {
            pre_buffer: Vec::with_capacity(config.pre_buffer_frames),
            config,
            state: VadState::Silence,
            voice_count: 0,
            silence_count: 0,
            utterance_frames: 0,
        }
    }

    /// Returns the current VAD state.
    pub fn state(&self) -> VadState {
        self.state
    }

    /// Process an audio frame and return frames to forward (may be empty).
    ///
    /// During Silence: frames are buffered but not forwarded.
    /// On Speech start: the pre-buffer + current frame are flushed.
    /// During Speech/Trailing: frames are forwarded immediately.
    /// On transition to Silence: returns empty (audio gated).
    ///
    /// Also returns a state transition event if the state changed.
    pub fn process(&mut self, frame: &AudioFrame) -> VadResult {
        let level = meter::compute_level(&frame.samples);
        let is_voiced = level.rms >= self.config.silence_threshold
            && level.rms >= self.config.frame_threshold;

        match self.state {
            VadState::Silence => {
                if is_voiced {
                    self.voice_count += 1;
                    if self.voice_count >= self.config.min_voice_frames {
                        // Transition to Speech
                        self.state = VadState::Speech;
                        self.silence_count = 0;
                        self.utterance_frames = 0;

                        // Flush pre-buffer + current frame
                        let mut frames: Vec<AudioFrame> = self.pre_buffer.drain(..).collect();
                        frames.push(frame.clone());
                        self.utterance_frames += frames.len();

                        return VadResult {
                            frames,
                            transition: Some(VadTransition::SpeechStarted),
                        };
                    }
                } else {
                    self.voice_count = 0;
                }

                // Buffer frame for pre-speech capture
                if self.pre_buffer.len() >= self.config.pre_buffer_frames {
                    self.pre_buffer.remove(0);
                }
                self.pre_buffer.push(frame.clone());

                VadResult {
                    frames: vec![],
                    transition: None,
                }
            }

            VadState::Speech => {
                self.utterance_frames += 1;

                // Force-flush on max utterance length
                if self.utterance_frames >= self.config.max_utterance_frames {
                    self.state = VadState::Silence;
                    self.voice_count = 0;
                    self.silence_count = 0;
                    self.pre_buffer.clear();
                    return VadResult {
                        frames: vec![frame.clone()],
                        transition: Some(VadTransition::SpeechEnded),
                    };
                }

                if is_voiced {
                    self.silence_count = 0;
                } else {
                    self.silence_count += 1;
                    if self.silence_count >= self.config.silence_frame_count {
                        // Transition to Silence (skip Trailing for simplicity)
                        self.state = VadState::Silence;
                        self.voice_count = 0;
                        self.silence_count = 0;
                        self.pre_buffer.clear();
                        return VadResult {
                            frames: vec![], // Don't forward trailing silence
                            transition: Some(VadTransition::SpeechEnded),
                        };
                    }
                }

                // Forward the frame
                VadResult {
                    frames: vec![frame.clone()],
                    transition: None,
                }
            }

            VadState::Trailing => {
                // Simplified: we go directly from Speech to Silence
                // This state is reserved for future use
                self.state = VadState::Silence;
                VadResult {
                    frames: vec![],
                    transition: Some(VadTransition::SpeechEnded),
                }
            }
        }
    }

    /// Reset the VAD state (e.g., when stopping transcription).
    pub fn reset(&mut self) {
        self.state = VadState::Silence;
        self.voice_count = 0;
        self.silence_count = 0;
        self.utterance_frames = 0;
        self.pre_buffer.clear();
    }
}

/// Result of processing a single audio frame through the VAD.
pub struct VadResult {
    /// Frames to forward to the consumer (empty if gated).
    pub frames: Vec<AudioFrame>,
    /// State transition that occurred, if any.
    pub transition: Option<VadTransition>,
}

/// VAD state transitions emitted as events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadTransition {
    SpeechStarted,
    SpeechEnded,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_frame(rms_level: f32) -> AudioFrame {
        // Create a frame with samples that produce roughly the desired RMS level
        let amplitude = (rms_level * i16::MAX as f32) as i16;
        let samples = vec![amplitude; 1024];
        AudioFrame {
            samples,
            timestamp_ms: 0,
        }
    }

    fn silent_frame() -> AudioFrame {
        make_frame(0.0)
    }

    fn voiced_frame() -> AudioFrame {
        make_frame(0.05) // Well above silence_threshold of 0.005
    }

    #[test]
    fn test_starts_in_silence() {
        let vad = Vad::new(VadConfig::default());
        assert_eq!(vad.state(), VadState::Silence);
    }

    #[test]
    fn test_silence_gates_audio() {
        let mut vad = Vad::new(VadConfig::default());
        let result = vad.process(&silent_frame());
        assert!(result.frames.is_empty());
        assert!(result.transition.is_none());
    }

    #[test]
    fn test_speech_detection() {
        let mut config = VadConfig::default();
        config.min_voice_frames = 2; // Lower for testing
        let mut vad = Vad::new(config);

        // First voiced frame: not enough yet
        let result = vad.process(&voiced_frame());
        assert!(result.frames.is_empty());
        assert_eq!(vad.state(), VadState::Silence);

        // Second voiced frame: transition to Speech
        let result = vad.process(&voiced_frame());
        assert!(!result.frames.is_empty());
        assert_eq!(vad.state(), VadState::Speech);
        assert_eq!(result.transition, Some(VadTransition::SpeechStarted));
    }

    #[test]
    fn test_speech_forwards_audio() {
        let mut config = VadConfig::default();
        config.min_voice_frames = 1;
        let mut vad = Vad::new(config);

        // Trigger speech
        let _ = vad.process(&voiced_frame());

        // Subsequent frames should be forwarded
        let result = vad.process(&voiced_frame());
        assert_eq!(result.frames.len(), 1);
    }

    #[test]
    fn test_silence_after_speech() {
        let mut config = VadConfig::default();
        config.min_voice_frames = 1;
        config.silence_frame_count = 2; // Quick silence detection for testing
        let mut vad = Vad::new(config);

        // Start speech
        let _ = vad.process(&voiced_frame());
        assert_eq!(vad.state(), VadState::Speech);

        // First silent frame: still in Speech
        let _ = vad.process(&silent_frame());
        assert_eq!(vad.state(), VadState::Speech);

        // Second silent frame: transition to Silence
        let result = vad.process(&silent_frame());
        assert_eq!(vad.state(), VadState::Silence);
        assert_eq!(result.transition, Some(VadTransition::SpeechEnded));
    }

    #[test]
    fn test_pre_buffer_flushed_on_speech() {
        let mut config = VadConfig::default();
        config.min_voice_frames = 1;
        config.pre_buffer_frames = 2;
        let mut vad = Vad::new(config);

        // Feed 2 silent frames (goes into pre-buffer)
        vad.process(&silent_frame());
        vad.process(&silent_frame());

        // Trigger speech — should flush pre-buffer + current = 3 frames
        let result = vad.process(&voiced_frame());
        assert_eq!(result.frames.len(), 3);
        assert_eq!(result.transition, Some(VadTransition::SpeechStarted));
    }

    #[test]
    fn test_reset() {
        let mut config = VadConfig::default();
        config.min_voice_frames = 1;
        let mut vad = Vad::new(config);

        let _ = vad.process(&voiced_frame());
        assert_eq!(vad.state(), VadState::Speech);

        vad.reset();
        assert_eq!(vad.state(), VadState::Silence);
    }
}
