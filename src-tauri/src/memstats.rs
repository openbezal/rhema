//! Periodic process memory sampler for diagnostics.
//!
//! Spawns a tokio task that logs RSS, virtual size, and thread count every
//! `INTERVAL`. Output is tagged `[MEM]` so it's easy to grep out of the
//! Tauri dev log alongside the queue/buffer counters added in the
//! transcription pipeline.

use std::time::Duration;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

const INTERVAL: Duration = Duration::from_secs(5);

pub fn spawn() {
    tauri::async_runtime::spawn(async move {
        let pid = Pid::from_u32(std::process::id());
        let mut sys = System::new();
        let refresh = ProcessRefreshKind::nothing().with_memory();

        loop {
            sys.refresh_processes_specifics(
                ProcessesToUpdate::Some(&[pid]),
                true,
                refresh,
            );

            if let Some(proc_) = sys.process(pid) {
                let rss_mb = proc_.memory() as f64 / 1024.0 / 1024.0;
                let virt_mb = proc_.virtual_memory() as f64 / 1024.0 / 1024.0;
                log::info!(
                    "[MEM] rss={:.1}MB virt={:.0}MB",
                    rss_mb,
                    virt_mb,
                );
            }

            tokio::time::sleep(INTERVAL).await;
        }
    });
}
