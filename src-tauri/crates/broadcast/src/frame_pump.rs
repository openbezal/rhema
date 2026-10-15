//! A bounded latest-frame handoff and a dedicated paced worker per output.
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::Serialize;

pub fn wall_epoch_ms() -> u64 {
    u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    )
    .unwrap_or(u64::MAX)
}
#[derive(Debug)]
pub struct FrameTrace {
    pub id: String,
    pub output_id: String,
    pub accepted_ms: u64,
    pub rendered_ms: u64,
}

#[derive(Debug)]
pub struct VideoFrame {
    pub trace: Option<FrameTrace>,
    pub epoch: u64,
    pub revision: u64,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Implementations own their transport/buffers until the worker has joined.
pub trait FrameSender: Send + 'static {
    fn send(&mut self, frame: &VideoFrame) -> Result<(), String>;
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameStats {
    pub active: bool,
    pub epoch: u64,
    pub submitted: u64,
    pub coalesced: u64,
    pub duplicates: u64,
    pub rejected: u64,
    pub sent: u64,
    pub repeated: u64,
    pub last_sent_epoch: u64,
    pub last_sent_revision: u64,
    pub last_send_duration_us: u64,
    pub last_received_ms: u64,
    pub last_sent_ms: u64,
    pub last_error: Option<String>,
}
struct PumpState {
    pending: Option<VideoFrame>,
    accepted_revision: u64,
    stats: FrameStats,
}
struct Shared {
    state: Mutex<PumpState>,
    wake: Condvar,
}
impl Shared {
    fn lock(&self) -> MutexGuard<'_, PumpState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

pub struct FramePump {
    shared: Arc<Shared>,
    worker: Option<JoinHandle<()>>,
    width: u32,
    height: u32,
}
impl FramePump {
    pub fn start(
        width: u32,
        height: u32,
        fps: u32,
        sender: impl FrameSender,
    ) -> Result<Self, String> {
        if width == 0
            || height == 0
            || width > 3840
            || height > 2160
            || ![24, 30, 60].contains(&fps)
        {
            return Err("unsupported frame-pump dimensions or frame rate".into());
        }
        let shared = Arc::new(Shared {
            state: Mutex::new(PumpState {
                pending: None,
                accepted_revision: 0,
                stats: FrameStats {
                    active: true,
                    ..FrameStats::default()
                },
            }),
            wake: Condvar::new(),
        });
        let control = Arc::clone(&shared);
        let worker = std::thread::Builder::new()
            .name("rhema-video-output".into())
            .spawn(move || {
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run(&control, fps, sender);
                }));
                let mut state = control.lock();
                state.stats.active = false;
                state.pending = None;
                if outcome.is_err() {
                    state.stats.last_error = Some("frame sender panicked".into());
                }
                control.wake.notify_all();
            })
            .map_err(|error| format!("could not start frame worker: {error}"))?;
        Ok(Self {
            shared,
            worker: Some(worker),
            width,
            height,
        })
    }
    /// A new renderer lease revokes queued old-renderer work; the last valid
    /// cached frame stays on air until the replacement submits its first frame.
    pub fn begin_epoch(&self) -> Result<u64, String> {
        self.begin_epoch_if(self.stats().epoch)
    }
    pub fn begin_epoch_if(&self, expected_epoch: u64) -> Result<u64, String> {
        let mut state = self.shared.lock();
        if state.stats.epoch != expected_epoch {
            return Err("renderer epoch changed; renegotiate".into());
        }
        if !state.stats.active {
            return Err("frame pump is stopped".into());
        }
        state.stats.epoch = state
            .stats
            .epoch
            .checked_add(1)
            .ok_or("renderer epoch exhausted")?;
        state.accepted_revision = 0;
        state.pending = None;
        Ok(state.stats.epoch)
    }
    pub fn submit(&self, frame: VideoFrame) -> Result<(), String> {
        let mut state = self.shared.lock();
        let expected = u64::from(self.width) * u64::from(self.height) * 4;
        if !state.stats.active
            || frame.epoch != state.stats.epoch
            || frame.revision == 0
            || frame.width != self.width
            || frame.height != self.height
            || u64::try_from(frame.pixels.len()).unwrap_or(u64::MAX) != expected
            || frame.revision < state.accepted_revision
        {
            state.stats.rejected += 1;
            return Err("stopped, stale, or invalid video frame".into());
        }
        if frame.revision == state.accepted_revision {
            // An IPC acknowledgment may be lost after acceptance. Retrying the
            // same revision acknowledges it without replacing newer pixels.
            state.stats.duplicates += 1;
            return Ok(());
        }
        state.accepted_revision = frame.revision;
        state.stats.submitted += 1;
        state.stats.last_received_ms = wall_epoch_ms();
        if let Some(trace) = &frame.trace {
            log::info!("[BCAST] trace={} output={} stage=ipc_received epoch_ms={} accepted_ms={} rendered_ms={} revision={} renderer_epoch={}", trace.id, trace.output_id, state.stats.last_received_ms, trace.accepted_ms, trace.rendered_ms, frame.revision, frame.epoch);
        }
        if state.pending.is_some() {
            state.stats.coalesced += 1;
        }
        state.pending = Some(frame);
        self.shared.wake.notify_one();
        Ok(())
    }
    pub fn stats(&self) -> FrameStats {
        self.shared.lock().stats.clone()
    }
    pub fn request_stop(&self) {
        let mut state = self.shared.lock();
        state.stats.active = false;
        state.pending = None;
        self.shared.wake.notify_all();
    }
    /// Return only after the in-flight synchronous transport call and sender
    /// destructor finish. There is no detached SDK work after this boundary.
    pub fn stop(&mut self) {
        self.request_stop();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
impl Drop for FramePump {
    fn drop(&mut self) {
        self.stop();
    }
}
/// Scheduling math is separate from waits so wakeups/delays can be checked
/// with a controlled monotonic clock at every supported integer frame rate.
struct FrameCadence {
    period: Duration,
    deadline: Duration,
}
impl FrameCadence {
    fn new(fps: u32) -> Self {
        Self {
            period: Duration::from_nanos(1_000_000_000 / u64::from(fps)),
            deadline: Duration::ZERO,
        }
    }
    fn reset(&mut self, now: Duration) {
        self.deadline = now;
    }
    fn remaining(&self, now: Duration) -> Option<Duration> {
        self.deadline
            .checked_sub(now)
            .filter(|duration| !duration.is_zero())
    }
    fn completed(&mut self, now: Duration) {
        self.deadline = (self.deadline + self.period).max(now);
    }
}
fn run(shared: &Shared, fps: u32, mut sender: impl FrameSender) {
    let clock = Instant::now();
    let mut cadence = FrameCadence::new(fps);
    let mut cached: Option<VideoFrame> = None;
    loop {
        let mut state = shared.lock();
        loop {
            if !state.stats.active {
                return;
            }
            if cached.is_none() && state.pending.is_none() {
                state = shared
                    .wake
                    .wait(state)
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                cadence.reset(clock.elapsed());
            } else if let Some(remaining) = cadence.remaining(clock.elapsed()) {
                state = shared
                    .wake
                    .wait_timeout(state, remaining)
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .0;
            } else {
                break;
            }
        }
        if let Some(frame) = state.pending.take() {
            cached = Some(frame);
        }
        let Some(frame) = cached.as_ref() else {
            continue;
        };
        let repeated = (state.stats.last_sent_epoch, state.stats.last_sent_revision)
            == (frame.epoch, frame.revision);
        drop(state);
        let started = Instant::now();
        let result = sender.send(frame);
        let mut state = shared.lock();
        state.stats.last_send_duration_us =
            u64::try_from(started.elapsed().as_micros()).unwrap_or(u64::MAX);
        match result {
            Ok(()) => {
                state.stats.sent += 1;
                state.stats.last_sent_ms = wall_epoch_ms();
                if !repeated {
                    if let Some(trace) = &frame.trace {
                        log::info!("[BCAST] trace={} output={} stage=sdk_complete epoch_ms={} revision={} renderer_epoch={} sdk_us={}", trace.id, trace.output_id, state.stats.last_sent_ms, frame.revision, frame.epoch, state.stats.last_send_duration_us);
                    }
                }
                state.stats.repeated += u64::from(repeated);
                state.stats.last_sent_epoch = frame.epoch;
                state.stats.last_sent_revision = frame.revision;
                state.stats.last_error = None;
            }
            Err(error) => state.stats.last_error = Some(error.chars().take(512).collect()),
        }
        // Never catch up with a burst after a stalled send. Reuse only one
        // cached bitmap, with one pending replacement, at the configured rate.
        cadence.completed(clock.elapsed());
    }
}

#[cfg(test)]
mod tests {
    use super::{FrameCadence, FramePump, FrameSender, VideoFrame};

    #[test]
    fn controlled_cadence_preserves_deadlines_across_wakeups_without_catchup_bursts() {
        for fps in [24, 30, 60] {
            let mut cadence = FrameCadence::new(fps);
            let period = Duration::from_nanos(1_000_000_000 / u64::from(fps));
            assert_eq!(cadence.remaining(Duration::ZERO), None);
            cadence.completed(Duration::ZERO);
            assert_eq!(
                cadence.remaining(period / 4),
                Some(period.checked_sub(period / 4).unwrap())
            );
            assert_eq!(cadence.remaining(period), None);
            cadence.completed(period * 10);
            assert_eq!(cadence.remaining(period * 10), None);
            cadence.completed(period * 10);
            assert_eq!(cadence.remaining(period * 10), Some(period));
            cadence.reset(period * 100);
            assert_eq!(cadence.remaining(period * 100), None);
        }
    }
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant};

    type Record = Arc<(Mutex<Vec<(u64, u64, u8)>>, Condvar)>;
    struct Recorder(Record);
    impl FrameSender for Recorder {
        fn send(&mut self, frame: &VideoFrame) -> Result<(), String> {
            let (lock, wake) = &*self.0;
            lock.lock()
                .unwrap()
                .push((frame.epoch, frame.revision, frame.pixels[0]));
            wake.notify_all();
            Ok(())
        }
    }
    fn recorder() -> (Record, Recorder) {
        let record = Arc::new((Mutex::new(Vec::new()), Condvar::new()));
        (Arc::clone(&record), Recorder(record))
    }
    fn frame(epoch: u64, revision: u64, value: u8) -> VideoFrame {
        VideoFrame {
            trace: None,
            epoch,
            revision,
            width: 1,
            height: 1,
            pixels: vec![value, 0, 0, 255],
        }
    }
    fn wait_for(record: &Record, count: usize) -> Vec<(u64, u64, u8)> {
        let (lock, wake) = &**record;
        let (values, timeout) = wake
            .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(2), |values| {
                values.len() < count
            })
            .unwrap();
        assert!(
            !timeout.timed_out(),
            "expected {count} frames, got {}",
            values.len()
        );
        values.clone()
    }
    #[test]
    fn repeats_cached_pixels_natively_at_configured_cadence() {
        let (record, sender) = recorder();
        let mut pump = FramePump::start(1, 1, 60, sender).unwrap();
        let epoch = pump.begin_epoch().unwrap();
        pump.submit(frame(epoch, 1, 7)).unwrap();
        let values = wait_for(&record, 3);
        pump.stop();
        assert!(values.iter().all(|value| *value == (epoch, 1, 7)));
        let stats = pump.stats();
        assert_eq!(stats.submitted, 1);
        assert!(stats.sent >= 3 && stats.repeated >= 2);
        assert!(!stats.active);
    }
    #[test]
    fn rejects_stale_revision_after_clear_and_old_renderer_after_reload() {
        let (record, sender) = recorder();
        let mut pump = FramePump::start(1, 1, 60, sender).unwrap();
        let old = pump.begin_epoch().unwrap();
        pump.submit(frame(old, 1, 8)).unwrap();
        wait_for(&record, 1);
        pump.submit(frame(old, 3, 0)).unwrap();
        assert!(pump.submit(frame(old, 2, 9)).is_err());
        wait_for(&record, 2);
        let current = pump.begin_epoch().unwrap();
        assert!(current > old);
        assert!(pump.submit(frame(old, 100, 9)).is_err());
        pump.submit(frame(current, 1, 2)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let values = record.0.lock().unwrap().clone();
            if values.last().is_some_and(|value| *value == (current, 1, 2)) {
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        pump.stop();
        assert_eq!(pump.stats().last_sent_revision, 1);
        assert_eq!(pump.stats().epoch, current);
    }
    struct BlockedSender {
        entered: Record,
        release: Arc<(Mutex<bool>, Condvar)>,
    }
    impl FrameSender for BlockedSender {
        fn send(&mut self, frame: &VideoFrame) -> Result<(), String> {
            let (lock, wake) = &*self.entered;
            lock.lock()
                .unwrap()
                .push((frame.epoch, frame.revision, frame.pixels[0]));
            wake.notify_all();
            let (lock, wake) = &*self.release;
            drop(
                wake.wait_while(lock.lock().unwrap(), |released| !*released)
                    .unwrap(),
            );
            Ok(())
        }
    }
    #[test]
    fn coalesces_to_one_pending_frame_and_stop_waits_for_inflight_send() {
        let (record, _) = recorder();
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let sender = BlockedSender {
            entered: Arc::clone(&record),
            release: Arc::clone(&release),
        };
        let pump = FramePump::start(1, 1, 60, sender).unwrap();
        let epoch = pump.begin_epoch().unwrap();
        pump.submit(frame(epoch, 1, 1)).unwrap();
        wait_for(&record, 1);
        for revision in 2..=100 {
            pump.submit(frame(epoch, revision, u8::try_from(revision).unwrap()))
                .unwrap();
        }
        assert_eq!(pump.stats().coalesced, 98);
        pump.request_stop();
        let stopped = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let done = Arc::clone(&stopped);
        let handle = std::thread::spawn(move || {
            let mut pump = pump;
            pump.stop();
            done.store(true, std::sync::atomic::Ordering::SeqCst);
            pump
        });
        assert!(!stopped.load(std::sync::atomic::Ordering::SeqCst));
        *release.0.lock().unwrap() = true;
        release.1.notify_all();
        let pump = handle.join().unwrap();
        assert!(!pump.stats().active);
        assert!(pump.submit(frame(epoch, 101, 0)).is_err());
        assert_eq!(record.0.lock().unwrap().len(), 1);
    }
    #[test]
    fn blocked_output_does_not_stop_another_outputs_cadence() {
        let (slow_record, _) = recorder();
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let mut slow = FramePump::start(
            1,
            1,
            24,
            BlockedSender {
                entered: Arc::clone(&slow_record),
                release: Arc::clone(&release),
            },
        )
        .unwrap();
        slow.submit(frame(slow.begin_epoch().unwrap(), 1, 1))
            .unwrap();
        wait_for(&slow_record, 1);
        let (fast_record, fast_sender) = recorder();
        let mut fast = FramePump::start(1, 1, 60, fast_sender).unwrap();
        fast.submit(frame(fast.begin_epoch().unwrap(), 1, 2))
            .unwrap();
        wait_for(&fast_record, 3);
        fast.stop();
        *release.0.lock().unwrap() = true;
        release.1.notify_all();
        slow.stop();
    }
    #[test]
    fn renderer_claim_uses_compare_and_swap_to_reject_late_handshakes() {
        let (_, sender) = recorder();
        let mut pump = FramePump::start(1, 1, 24, sender).unwrap();
        let epoch = pump.begin_epoch_if(0).unwrap();
        assert!(pump.begin_epoch_if(0).is_err());
        assert_eq!(pump.stats().epoch, epoch);
        assert_eq!(pump.begin_epoch_if(epoch).unwrap(), epoch + 1);
        pump.stop();
    }

    #[test]
    fn validates_configuration_dimensions_bytes_and_revision_before_enqueue() {
        let (_, sender) = recorder();
        assert!(FramePump::start(1, 1, 0, sender).is_err());
        let (_, sender) = recorder();
        let mut pump = FramePump::start(1, 1, 24, sender).unwrap();
        let epoch = pump.begin_epoch().unwrap();
        assert!(pump.submit(frame(epoch, 0, 0)).is_err());
        let mut invalid = frame(epoch, 1, 0);
        invalid.width = 2;
        assert!(pump.submit(invalid).is_err());
        let mut invalid = frame(epoch, 1, 0);
        invalid.pixels.pop();
        assert!(pump.submit(invalid).is_err());
        assert_eq!(pump.stats().submitted, 0);
        pump.stop();
    }
}
