use super::*;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

struct FakeSender {
    seen: mpsc::Sender<u64>,
    blocked: Option<mpsc::Receiver<()>>,
}
impl FrameSender for FakeSender {
    fn send(&mut self, frame: &VideoFrame) -> Result<(), String> {
        self.seen.send(frame.revision).ok();
        if let Some(release) = self.blocked.take() {
            release.recv().unwrap();
        }
        Ok(())
    }
}
fn request() -> NdiStartRequest {
    NdiStartRequest {
        source_name: "test".into(),
        resolution: NdiResolution::R720p,
        frame_rate: NdiFrameRate::Fps60,
        alpha_mode: NdiAlphaMode::StraightAlpha,
    }
}
fn session(generation: &str, sender: FakeSender) -> ActiveNdiSession {
    ActiveNdiSession {
        info: NdiSessionInfo {
            generation: generation.into(),
            frame_protocol: 1,
            source_name: "test".into(),
            resolution: NdiResolution::R720p,
            frame_rate: NdiFrameRate::Fps60,
            alpha_mode: NdiAlphaMode::StraightAlpha,
            width: 1,
            height: 1,
            fps: 60,
        },
        pump: FramePump::start(1, 1, 60, sender).unwrap(),
    }
}
fn frame(revision: u64) -> VideoFrame {
    VideoFrame {
        trace: None,
        epoch: 0,
        revision,
        width: 1,
        height: 1,
        pixels: vec![0; 4],
    }
}
fn wait_detached(runtime: &Mutex<NdiRuntime>, id: &str) {
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        if runtime.try_lock().is_ok_and(|value| !value.is_active(id)) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "registry held during SDK teardown"
        );
        std::thread::yield_now();
    }
}
#[test]
fn blocked_runtime_stop_allows_other_output_to_accept_and_send_clear() {
    let runtime = Arc::new(Mutex::new(NdiRuntime::default()));
    let (a_seen, a_frames) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let (b_seen, b_frames) = mpsc::channel();
    {
        let mut value = runtime.lock().unwrap();
        value.sessions.insert(
            "a".into(),
            session(
                "1",
                FakeSender {
                    seen: a_seen,
                    blocked: Some(blocked),
                },
            ),
        );
        value.sessions.insert(
            "b".into(),
            session(
                "2",
                FakeSender {
                    seen: b_seen,
                    blocked: None,
                },
            ),
        );
        value.submit_frame("a", "1:0", frame(1)).unwrap();
    }
    a_frames.recv_timeout(Duration::from_secs(2)).unwrap();
    let stopping = Arc::clone(&runtime);
    let stop = std::thread::spawn(move || NdiRuntime::stop_shared(&stopping, "a").unwrap());
    // Release even if the isolation assertion fails, so the test cannot hang Drop.
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        wait_detached(&runtime, "a");
        runtime
            .lock()
            .unwrap()
            .submit_frame("b", "2:0", frame(9))
            .unwrap();
        assert_eq!(b_frames.recv_timeout(Duration::from_secs(2)).unwrap(), 9);
        assert!(!stop.is_finished());
    }));
    release.send(()).unwrap();
    stop.join().unwrap();
    outcome.unwrap();
}
#[test]
fn stop_revokes_a_pending_restart_before_its_sender_can_be_created() {
    let runtime = Arc::new(Mutex::new(NdiRuntime::default()));
    let (seen, frames) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    runtime.lock().unwrap().sessions.insert(
        "a".into(),
        session(
            "1",
            FakeSender {
                seen,
                blocked: Some(blocked),
            },
        ),
    );
    runtime
        .lock()
        .unwrap()
        .submit_frame("a", "1:0", frame(1))
        .unwrap();
    frames.recv_timeout(Duration::from_secs(2)).unwrap();
    let restarting = Arc::clone(&runtime);
    let start = std::thread::spawn(move || {
        NdiRuntime::start_shared_with(&restarting, "a", request(), |_, _, _, _| {
            panic!("revoked restart must never create a sender")
        })
    });
    wait_detached(&runtime, "a");
    let stopping = Arc::clone(&runtime);
    let stop = std::thread::spawn(move || NdiRuntime::stop_shared(&stopping, "a").unwrap());
    let deadline = Instant::now() + Duration::from_secs(2);
    while !runtime.lock().unwrap().pending_starts.is_empty() {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    release.send(()).unwrap();
    assert!(matches!(
        start.join().unwrap(),
        Err(NdiError::StaleRenderer)
    ));
    stop.join().unwrap();
    assert!(!runtime.lock().unwrap().any_active());
}

#[test]
fn stop_waits_for_inflight_creation_and_rejects_its_late_commit() {
    let runtime = Arc::new(Mutex::new(NdiRuntime::default()));
    let (entered, creating) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let (seen, _frames) = mpsc::channel();
    let starting = Arc::clone(&runtime);
    let start = std::thread::spawn(move || {
        NdiRuntime::start_shared_with(&starting, "a", request(), move |_, generation, _, _| {
            entered.send(()).unwrap();
            blocked.recv().unwrap();
            Ok(session(
                &generation,
                FakeSender {
                    seen,
                    blocked: None,
                },
            ))
        })
    });
    creating.recv_timeout(Duration::from_secs(2)).unwrap();
    let stopping = Arc::clone(&runtime);
    let stop = std::thread::spawn(move || NdiRuntime::stop_shared(&stopping, "a").unwrap());
    let deadline = Instant::now() + Duration::from_secs(2);
    while !runtime.lock().unwrap().pending_starts.is_empty() {
        assert!(Instant::now() < deadline);
        std::thread::yield_now();
    }
    assert!(!stop.is_finished());
    release.send(()).unwrap();
    assert!(matches!(
        start.join().unwrap(),
        Err(NdiError::StaleRenderer)
    ));
    stop.join().unwrap();
    let state = runtime.lock().unwrap();
    assert!(!state.any_active());
    assert!(state.lifecycles.is_empty());
}
