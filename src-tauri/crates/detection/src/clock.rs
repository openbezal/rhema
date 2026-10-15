use std::time::Instant;

/// Monotonic time for context expiry. Replay clocks advance without wall-clock sleeps.
pub trait DetectionClock: Send + Sync {
    fn now(&self) -> Instant;
}

pub struct SystemClock;
impl DetectionClock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}
