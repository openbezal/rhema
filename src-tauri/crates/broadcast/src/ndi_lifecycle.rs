//! SDK teardown/create serialization is per output; the registry only revokes
//! intent and swaps ownership. Never wait for an SDK worker with that lock held.
use super::{
    dev_fallback_dir, ActiveNdiSession, Arc, FramePump, Mutex, NdiError, NdiLibrary, NdiRuntime,
    NdiSender, NdiSessionInfo, NdiStartRequest, PathBuf,
};

pub(super) type LibraryCache = Arc<Mutex<Option<Arc<NdiLibrary>>>>;
#[derive(Default)]
pub(super) struct OutputLifecycle {
    operation: Mutex<()>,
    retired: Mutex<Vec<ActiveNdiSession>>,
}
pub(super) fn load_cached_library(
    cache: &LibraryCache,
    dirs: &[PathBuf],
) -> Result<Arc<NdiLibrary>, NdiError> {
    let mut loaded = cache.lock().map_err(lock_error)?;
    if let Some(library) = loaded.as_ref() {
        return Ok(Arc::clone(library));
    }
    let mut paths = dirs.to_vec();
    paths.push(dev_fallback_dir());
    let library = Arc::new(NdiLibrary::load(&paths)?);
    *loaded = Some(Arc::clone(&library));
    Ok(library)
}
fn lock_error<T>(error: std::sync::PoisonError<T>) -> NdiError {
    let message = error.to_string();
    drop(error);
    NdiError::FrameDelivery(message)
}
/// The separate retirement lock permits revocation without waiting on operation.
/// Draining the queue (rather than just this request's sender) also handles
/// non-FIFO mutex acquisition by newer accepted start/stop requests.
pub(super) fn drain_retired(lifecycle: &OutputLifecycle) {
    loop {
        let retired = std::mem::take(
            &mut *lifecycle
                .retired
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        if retired.is_empty() {
            break;
        }
        for mut session in retired {
            session.pump.stop();
            log::info!(
                "[BCAST] stage=stopped generation={} stats={}",
                session.info.generation,
                serde_json::to_string(&session.pump.stats()).unwrap_or_default()
            );
        }
    }
}
impl NdiRuntime {
    fn retire(&mut self, id: &str) -> Arc<OutputLifecycle> {
        let lifecycle = Arc::clone(self.lifecycles.entry(id.into()).or_default());
        if let Some(session) = self.sessions.remove(id) {
            session.pump.request_stop();
            lifecycle
                .retired
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(session);
        }
        lifecycle
    }
    fn prune_lifecycle(&mut self, id: &str, lifecycle: &Arc<OutputLifecycle>) {
        if !self.sessions.contains_key(id)
            && !self.pending_starts.contains_key(id)
            && Arc::strong_count(lifecycle) == 2
        {
            self.lifecycles.remove(id);
        }
    }
    pub fn start_shared(
        runtime: &Mutex<Self>,
        id: &str,
        request: NdiStartRequest,
    ) -> Result<NdiSessionInfo, NdiError> {
        Self::start_shared_with(runtime, id, request, |request, generation, cache, dirs| {
            let sender =
                NdiSender::create(request, load_cached_library(&cache, &dirs)?, generation)?;
            let info = sender.info.clone();
            let pump = FramePump::start(info.width, info.height, info.fps, sender)
                .map_err(NdiError::FrameDelivery)?;
            Ok(ActiveNdiSession { info, pump })
        })
    }
    pub(super) fn start_shared_with(
        runtime: &Mutex<Self>,
        id: &str,
        request: NdiStartRequest,
        create: impl FnOnce(
            NdiStartRequest,
            String,
            LibraryCache,
            Vec<PathBuf>,
        ) -> Result<ActiveNdiSession, NdiError>,
    ) -> Result<NdiSessionInfo, NdiError> {
        if request.source_name.trim().is_empty() || request.source_name.contains('\0') {
            return Err(NdiError::EmptySourceName);
        }
        let (generation, lifecycle, cache, dirs) = {
            let mut registry = runtime.lock().map_err(lock_error)?;
            let generation = registry
                .next_generation
                .checked_add(1)
                .ok_or_else(|| NdiError::FrameDelivery("session generation exhausted".into()))?;
            registry.next_generation = generation;
            registry.pending_starts.insert(id.to_owned(), generation);
            let lifecycle = registry.retire(id);
            (
                generation,
                lifecycle,
                Arc::clone(&registry.library),
                registry.library_search_dirs.clone(),
            )
        };
        let operation = lifecycle.operation.lock().map_err(lock_error)?;
        drain_retired(&lifecycle);
        let result = (|| {
            if runtime.lock().map_err(lock_error)?.pending_starts.get(id) != Some(&generation) {
                return Err(NdiError::StaleRenderer);
            }
            let mut created = Some(create(request, generation.to_string(), cache, dirs)?);
            let committed = {
                let mut registry = runtime.lock().map_err(lock_error)?;
                if registry.pending_starts.get(id) == Some(&generation) {
                    registry.pending_starts.remove(id);
                    let session = created.take().expect("new sender");
                    let info = session.info.clone();
                    registry.sessions.insert(id.to_owned(), session);
                    Some(info)
                } else {
                    None
                }
            };
            // A revoked creation is joined/destroyed outside the registry while
            // still owning the per-output operation lock. Stop waits for it.
            drop(created);
            committed.ok_or(NdiError::StaleRenderer)
        })();
        {
            let mut registry = runtime.lock().map_err(lock_error)?;
            if result.is_err() && registry.pending_starts.get(id) == Some(&generation) {
                registry.pending_starts.remove(id);
            }
        }
        drop(operation);
        runtime
            .lock()
            .map_err(lock_error)?
            .prune_lifecycle(id, &lifecycle);
        result
    }
    pub fn stop_shared(runtime: &Mutex<Self>, id: &str) -> Result<(), NdiError> {
        let lifecycle = {
            let mut registry = runtime.lock().map_err(lock_error)?;
            registry.pending_starts.remove(id);
            registry.retire(id)
        };
        let operation = lifecycle.operation.lock().map_err(lock_error)?;
        drain_retired(&lifecycle);
        drop(operation);
        runtime
            .lock()
            .map_err(lock_error)?
            .prune_lifecycle(id, &lifecycle);
        Ok(())
    }
}
