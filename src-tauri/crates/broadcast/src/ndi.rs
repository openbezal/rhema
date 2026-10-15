use std::ffi::{c_void, CString};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Weak};

use crate::frame_pump::{FramePump, FrameSender, FrameStats, VideoFrame};
use libloading::{Library, Symbol};
use serde::{Deserialize, Serialize};
use thiserror::Error;

type NdiSendInstance = *mut c_void;
type NdiInitializeFn = unsafe extern "C" fn() -> bool;
type NdiDestroyFn = unsafe extern "C" fn();
type NdiSendCreateFn = unsafe extern "C" fn(*const NdiSendCreate) -> NdiSendInstance;
type NdiSendDestroyFn = unsafe extern "C" fn(NdiSendInstance);
type NdiSendVideoV2Fn = unsafe extern "C" fn(NdiSendInstance, *const NdiVideoFrameV2);

#[repr(C)]
struct NdiSendCreate {
    p_ndi_name: *const i8,
    p_groups: *const i8,
    clock_video: bool,
    clock_audio: bool,
}

#[repr(C)]
struct NdiVideoFrameV2 {
    xres: i32,
    yres: i32,
    fourcc: u32,
    frame_rate_n: i32,
    frame_rate_d: i32,
    picture_aspect_ratio: f32,
    frame_format_type: i32,
    timecode: i64,
    p_data: *mut u8,
    line_stride_in_bytes: i32,
    p_metadata: *const i8,
    timestamp: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiStartRequest {
    pub source_name: String,
    pub resolution: NdiResolution,
    pub frame_rate: NdiFrameRate,
    pub alpha_mode: NdiAlphaMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NdiResolution {
    R720p,
    R1080p,
    R4k,
}

impl NdiResolution {
    pub fn dimensions(&self) -> (u32, u32) {
        match self {
            Self::R720p => (1280, 720),
            Self::R1080p => (1920, 1080),
            Self::R4k => (3840, 2160),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NdiFrameRate {
    Fps24,
    Fps30,
    Fps60,
}

impl NdiFrameRate {
    pub fn ratio(&self) -> (i32, i32) {
        (i32::try_from(self.fps()).expect("supported NDI rate"), 1)
    }
    pub fn fps(&self) -> u32 {
        match self {
            Self::Fps24 => 24,
            Self::Fps30 => 30,
            Self::Fps60 => 60,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NdiAlphaMode {
    NoneOpaque,
    StraightAlpha,
    PremultipliedAlpha,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiSessionInfo {
    pub generation: String,
    pub frame_protocol: u32,
    pub source_name: String,
    pub resolution: NdiResolution,
    pub frame_rate: NdiFrameRate,
    pub alpha_mode: NdiAlphaMode,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[non_exhaustive]
#[derive(Debug, Clone, Error)]
pub enum NdiError {
    #[error("frame delivery failed: {0}")]
    FrameDelivery(String),
    #[error("obsolete NDI session or renderer lease")]
    StaleRenderer,
    #[error("NDI source name must not be empty")]
    EmptySourceName,
    #[error("unable to locate NDI library at {0}")]
    LibraryNotFound(String),
    #[error("failed to load NDI library: {0}")]
    LibraryLoad(String),
    #[error("failed to load symbol {symbol}: {message}")]
    SymbolLoad {
        symbol: &'static str,
        message: String,
    },
    #[error("NDI initialization failed")]
    InitializeFailed,
    #[error("failed to create NDI sender instance")]
    SenderCreateFailed,
    #[error("NDI session is not active")]
    SessionNotActive,
    #[error(
        "frame dimensions do not match active NDI settings ({expected_width}x{expected_height})"
    )]
    FrameDimensionsMismatch {
        expected_width: u32,
        expected_height: u32,
    },
    #[error("frame buffer size is invalid for dimensions {width}x{height}")]
    InvalidFrameBufferSize { width: u32, height: u32 },
}

/// The loaded NDI runtime library plus the function pointers resolved from it.
///
/// Exactly one `NdiLibrary` exists while any NDI session is alive: sessions
/// hold an `Arc<NdiLibrary>` and `NdiRuntime` keeps only a `Weak`, so
/// `NDIlib_initialize`/`NDIlib_destroy` run once per load — not once per
/// session — and the library unloads when the last session drops.
struct NdiLibrary {
    _library: Library,
    send_create: NdiSendCreateFn,
    send_destroy: NdiSendDestroyFn,
    send_video: NdiSendVideoV2Fn,
    ndi_destroy: NdiDestroyFn,
}

impl NdiLibrary {
    fn load(search_dirs: &[PathBuf]) -> Result<Self, NdiError> {
        let library_path = resolve_library_path(search_dirs)?;
        log::info!(
            "NDI: loading runtime library from {}",
            library_path.display()
        );
        // SAFETY: library_path was validated to exist by resolve_library_path()
        let library = unsafe { Library::new(&library_path) }
            .map_err(|e| NdiError::LibraryLoad(e.to_string()))?;

        let initialize_fn =
            *load_symbol::<NdiInitializeFn>(&library, b"NDIlib_initialize\0", "NDIlib_initialize")?;
        let ndi_destroy_fn =
            *load_symbol::<NdiDestroyFn>(&library, b"NDIlib_destroy\0", "NDIlib_destroy")?;
        let send_create_fn = *load_symbol::<NdiSendCreateFn>(
            &library,
            b"NDIlib_send_create\0",
            "NDIlib_send_create",
        )?;
        let send_destroy_fn = *load_symbol::<NdiSendDestroyFn>(
            &library,
            b"NDIlib_send_destroy\0",
            "NDIlib_send_destroy",
        )?;
        let send_video_fn = *load_symbol::<NdiSendVideoV2Fn>(
            &library,
            b"NDIlib_send_send_video_v2\0",
            "NDIlib_send_send_video_v2",
        )?;

        // SAFETY: initialize_fn is a valid function pointer loaded from the NDI library
        if !unsafe { initialize_fn() } {
            return Err(NdiError::InitializeFailed);
        }

        Ok(Self {
            _library: library,
            send_create: send_create_fn,
            send_destroy: send_destroy_fn,
            send_video: send_video_fn,
            ndi_destroy: ndi_destroy_fn,
        })
    }
}

impl Drop for NdiLibrary {
    fn drop(&mut self) {
        log::info!("NDI: last session closed — destroying NDI runtime");
        // SAFETY: NDIlib_initialize succeeded in load(); this is the sole
        // NDIlib_destroy call site and runs once, when the last Arc drops.
        unsafe { (self.ndi_destroy)() };
    }
}

#[derive(Default)]
pub struct NdiRuntime {
    sessions: std::collections::HashMap<String, ActiveNdiSession>,
    /// Weak handle to the shared library so concurrent sessions reuse one
    /// load/initialize, while an idle runtime holds nothing alive.
    library: Weak<NdiLibrary>,
    /// Directories searched (in order) for the NDI runtime library before the
    /// compile-time dev fallback. In production this is the Tauri resource dir.
    library_search_dirs: Vec<PathBuf>,
    next_generation: u64,
}

impl std::fmt::Debug for NdiRuntime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NdiRuntime")
            .field("active_sessions", &self.sessions.len())
            .field("library_loaded", &(self.library.strong_count() > 0))
            .field("library_search_dirs", &self.library_search_dirs)
            .field("next_generation", &self.next_generation)
            .finish()
    }
}

impl NdiRuntime {
    /// Set the directories searched for the NDI runtime library, in order of
    /// preference. The compile-time dev checkout path stays as a fallback.
    pub fn set_library_search_dirs(&mut self, dirs: Vec<PathBuf>) {
        self.library_search_dirs = dirs;
    }

    /// Reuse the already-loaded NDI library, or load and initialize it fresh
    /// when no session currently holds it.
    fn shared_library(&mut self) -> Result<Arc<NdiLibrary>, NdiError> {
        if let Some(library) = self.library.upgrade() {
            return Ok(library);
        }
        let mut search_dirs = self.library_search_dirs.clone();
        search_dirs.push(dev_fallback_dir());
        let library = Arc::new(NdiLibrary::load(&search_dirs)?);
        self.library = Arc::downgrade(&library);
        Ok(library)
    }

    /// Check if a specific session is active.
    pub fn is_active(&self, session_id: &str) -> bool {
        self.sessions
            .get(session_id)
            .is_some_and(|session| session.pump.stats().active)
    }

    /// Check if any session is active.
    pub fn any_active(&self) -> bool {
        self.sessions
            .values()
            .any(|session| session.pump.stats().active)
    }

    pub fn start(
        &mut self,
        session_id: String,
        request: NdiStartRequest,
    ) -> Result<NdiSessionInfo, NdiError> {
        let next = self
            .next_generation
            .checked_add(1)
            .ok_or_else(|| NdiError::FrameDelivery("session generation exhausted".into()))?;
        let library = self.shared_library()?;
        if request.source_name.trim().is_empty() || request.source_name.contains('\0') {
            return Err(NdiError::EmptySourceName);
        }
        // Destroy the previous sender before reusing its discovery name. Two
        // simultaneous SDK senders can cause automatic source-name suffixes.
        self.stop(&session_id);
        let sender = NdiSender::create(request, library, next.to_string())?;
        let info = sender.info.clone();
        let pump = FramePump::start(info.width, info.height, info.fps, sender)
            .map_err(NdiError::FrameDelivery)?;
        self.next_generation = next;
        self.sessions.insert(
            session_id,
            ActiveNdiSession {
                info: info.clone(),
                pump,
            },
        );
        Ok(info)
    }

    pub fn stop(&mut self, session_id: &str) {
        if let Some(mut existing) = self.sessions.remove(session_id) {
            log::info!("NDI[{session_id}]: stopping session");
            existing.pump.stop();
            log::info!(
                "[BCAST] output={session_id} stage=stopped stats={}",
                serde_json::to_string(&existing.pump.stats()).unwrap_or_default()
            );
            drop(existing);
        }
    }

    pub fn stop_all(&mut self) {
        for session in self.sessions.values() {
            session.pump.request_stop();
        }
        for (id, _session) in self.sessions.drain() {
            log::info!("NDI[{id}]: stopping session");
        }
    }

    pub fn current_info(&self, session_id: &str) -> Option<NdiSessionInfo> {
        self.sessions.get(session_id).map(|s| s.info.clone())
    }

    pub fn begin_renderer(
        &self,
        session_id: &str,
        generation: &str,
        expected_epoch: u64,
    ) -> Result<String, NdiError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or(NdiError::SessionNotActive)?;
        if session.info.generation != generation {
            return Err(NdiError::StaleRenderer);
        }
        let epoch = session
            .pump
            .begin_epoch_if(expected_epoch)
            .map_err(NdiError::FrameDelivery)?;
        Ok(format!("{generation}:{epoch}"))
    }
    pub fn frame_stats(&self, session_id: &str) -> Option<FrameStats> {
        self.sessions
            .get(session_id)
            .map(|session| session.pump.stats())
    }
    pub fn submit_frame(
        &self,
        session_id: &str,
        lease: &str,
        mut frame: VideoFrame,
    ) -> Result<(), NdiError> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or(NdiError::SessionNotActive)?;
        let (generation, epoch) = lease.split_once(':').ok_or(NdiError::StaleRenderer)?;
        if generation != session.info.generation {
            return Err(NdiError::StaleRenderer);
        }
        frame.epoch = epoch.parse().map_err(|_| NdiError::StaleRenderer)?;
        session.pump.submit(frame).map_err(NdiError::FrameDelivery)
    }
}

struct ActiveNdiSession {
    info: NdiSessionInfo,
    pump: FramePump,
}

struct NdiSender {
    library: Arc<NdiLibrary>,
    _sender_name: CString,
    sender: NdiSendInstance,
    info: NdiSessionInfo,
    frame_count: u64,
    frame_buffer: Vec<u8>,
    last_frame: Option<(u64, u64)>,
    frame_metadata: Option<CString>,
}

// SAFETY: The sender and all owned buffers move to exactly one frame-worker
// thread. SDK send and destroy run only there; no other thread accesses it.
unsafe impl Send for NdiSender {}

impl NdiSender {
    #[expect(
        clippy::needless_pass_by_value,
        reason = "request fields are destructured and moved into the session"
    )]
    fn create(
        request: NdiStartRequest,
        library: Arc<NdiLibrary>,
        generation: String,
    ) -> Result<Self, NdiError> {
        let source_name = request.source_name.trim().to_string();
        if source_name.is_empty() {
            return Err(NdiError::EmptySourceName);
        }

        let name = CString::new(source_name.clone()).map_err(|_| NdiError::EmptySourceName)?;
        let create = NdiSendCreate {
            p_ndi_name: name.as_ptr(),
            p_groups: std::ptr::null(),
            clock_video: false,
            clock_audio: false,
        };

        // SAFETY: send_create is a valid function pointer. The NdiSendCreate struct has valid
        // pointers (name is a CString kept alive by _sender_name field). p_groups is null which
        // NDI accepts.
        let create_ptr = std::ptr::from_ref(&create);
        let sender = unsafe { (library.send_create)(create_ptr) };
        if sender.is_null() {
            let os_err = std::io::Error::last_os_error();
            log::error!(
                "NDI: NDIlib_send_create returned null for '{source_name}' (last OS error: {os_err})"
            );
            // NDIlib_destroy fires via the Arc<NdiLibrary> drop if this was the only holder.
            return Err(NdiError::SenderCreateFailed);
        }

        let (width, height) = request.resolution.dimensions();
        let fps = request.frame_rate.fps();

        Ok(Self {
            library,
            _sender_name: name,
            sender,
            info: NdiSessionInfo {
                generation,
                frame_protocol: 1,
                source_name,
                resolution: request.resolution,
                frame_rate: request.frame_rate,
                alpha_mode: request.alpha_mode,
                width,
                height,
                fps,
            },
            frame_buffer: vec![0; (width * height * 4) as usize],
            frame_count: 0,
            last_frame: None,
            frame_metadata: None,
        })
    }

    fn send_frame_rgba(
        &mut self,
        width: u32,
        height: u32,
        rgba_data: &[u8],
        changed: bool,
    ) -> Result<(), NdiError> {
        if width != self.info.width || height != self.info.height {
            return Err(NdiError::FrameDimensionsMismatch {
                expected_width: self.info.width,
                expected_height: self.info.height,
            });
        }

        let expected = (width * height * 4) as usize;
        if rgba_data.len() != expected {
            return Err(NdiError::InvalidFrameBufferSize { width, height });
        }

        if self.frame_buffer.len() != expected {
            self.frame_buffer.resize(expected, 0);
        }

        if changed {
            // Convert RGBA -> BGRA for NDIlib_FourCC_type_BGRA.
            for (idx, px) in rgba_data.chunks_exact(4).enumerate() {
                let offset = idx * 4;
                self.frame_buffer[offset] = px[2];
                self.frame_buffer[offset + 1] = px[1];
                self.frame_buffer[offset + 2] = px[0];
                self.frame_buffer[offset + 3] = match self.info.alpha_mode {
                    NdiAlphaMode::NoneOpaque => 255,
                    NdiAlphaMode::StraightAlpha | NdiAlphaMode::PremultipliedAlpha => px[3],
                };
            }
        }

        #[expect(
            clippy::cast_possible_wrap,
            reason = "NDI FFI requires i32 for dimensions/rates that are always positive and small"
        )]
        #[expect(
            clippy::cast_precision_loss,
            reason = "NDI FFI requires f32 aspect ratio; u32 dimensions fit in f32 without loss"
        )]
        let frame = NdiVideoFrameV2 {
            xres: width as i32,
            yres: height as i32,
            fourcc: u32::from_le_bytes(*b"BGRA"),
            frame_rate_n: self.info.frame_rate.ratio().0,
            frame_rate_d: self.info.frame_rate.ratio().1,
            picture_aspect_ratio: (width as f32) / (height as f32),
            frame_format_type: 1, // NDIlib_frame_format_type_progressive
            timecode: i64::MAX,   // NDIlib_send_timecode_synthesize
            p_data: self.frame_buffer.as_mut_ptr(),
            line_stride_in_bytes: (width * 4) as i32,
            p_metadata: self
                .frame_metadata
                .as_ref()
                .map_or(std::ptr::null(), |value| value.as_ptr()),
            timestamp: 0,
        };

        // SAFETY: sender is a valid NDI send instance. frame points to self.frame_buffer which
        // is correctly sized and will outlive this call.
        let sender = self.sender;
        let frame_ptr = std::ptr::from_ref(&frame);
        unsafe {
            (self.library.send_video)(sender, frame_ptr);
        }
        self.frame_count += 1;
        if self.frame_count == 1 {
            log::info!(
                "NDI: first frame sent ({width}x{height}, {} bytes)",
                self.frame_buffer.len()
            );
        } else if self.frame_count.is_multiple_of(300) {
            log::info!("NDI: {} frames sent", self.frame_count);
        }
        Ok(())
    }
}

impl FrameSender for NdiSender {
    fn send(&mut self, frame: &VideoFrame) -> Result<(), String> {
        let key = (frame.epoch, frame.revision);
        if self.last_frame != Some(key) {
            self.frame_metadata = Some(
                CString::new(format!(
                    "<rhema-frame renderer=\"{}\" revision=\"{}\"/>",
                    frame.epoch, frame.revision
                ))
                .map_err(|error| error.to_string())?,
            );
        }
        self.send_frame_rgba(
            frame.width,
            frame.height,
            &frame.pixels,
            self.last_frame != Some(key),
        )
        .map_err(|error| error.to_string())?;
        self.last_frame = Some(key);
        Ok(())
    }
}

impl Drop for NdiSender {
    fn drop(&mut self) {
        // SAFETY: sender was created by NDIlib_send_create and is non-null (validated in create()).
        // send_destroy is a valid function pointer kept alive by the Arc<NdiLibrary>, which drops
        // after this struct's fields — running NDIlib_destroy only once the last session is gone.
        let sender = self.sender;
        unsafe {
            (self.library.send_destroy)(sender);
        }
    }
}

/// Relative locations of the NDI runtime library for the current OS. The same
/// layout is used by the repo checkout (`sdk/…` at the workspace root) and by
/// the bundled app (`sdk/…` inside the Tauri resource dir).
fn library_candidates() -> &'static [&'static str] {
    if cfg!(target_os = "macos") {
        &["sdk/ndi/macos/libndi.dylib"]
    } else if cfg!(target_os = "windows") {
        &["sdk/ndi/windows/Processing.NDI.Lib.x64.dll"]
    } else {
        &[
            "sdk/ndi/linux/libndi.so",
            "sdk/ndi/linux/x86_64/libndi.so.6",
            "sdk/ndi/linux/libndi.so.6",
        ]
    }
}

/// Dev fallback: the workspace root of a source checkout. Only meaningful on
/// the machine the binary was compiled on.
fn dev_fallback_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn resolve_library_path(search_dirs: &[PathBuf]) -> Result<PathBuf, NdiError> {
    let mut attempted = Vec::new();
    for base in search_dirs {
        for candidate in library_candidates() {
            let absolute = base.join(candidate);
            if absolute.exists() {
                return Ok(absolute);
            }
            attempted.push(absolute.display().to_string());
        }
    }

    Err(NdiError::LibraryNotFound(attempted.join(", ")))
}

fn load_symbol<'a, T>(
    library: &'a Library,
    symbol: &'static [u8],
    name: &'static str,
) -> Result<Symbol<'a, T>, NdiError> {
    // SAFETY: symbol name is a null-terminated byte string matching the NDI SDK's exported symbols
    unsafe { library.get::<T>(symbol) }.map_err(|e| NdiError::SymbolLoad {
        symbol: name,
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unique per-test scratch dir, removed on drop.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("rhema-ndi-test-{tag}-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn plant_library(base: &Path) -> PathBuf {
        let path = base.join(library_candidates()[0]);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"stub").unwrap();
        path
    }

    #[test]
    fn selected_integer_rates_are_advertised_exactly() {
        for (mode, expected) in [
            (NdiFrameRate::Fps24, 24),
            (NdiFrameRate::Fps30, 30),
            (NdiFrameRate::Fps60, 60),
        ] {
            assert_eq!(mode.ratio(), (expected, 1));
        }
    }

    #[test]
    fn resolves_library_from_search_dir() {
        let dir = TempDir::new("resolve");
        let planted = plant_library(&dir.0);
        let resolved = resolve_library_path(std::slice::from_ref(&dir.0)).unwrap();
        assert_eq!(resolved, planted);
    }

    #[test]
    fn earlier_search_dirs_win() {
        let first = TempDir::new("first");
        let second = TempDir::new("second");
        let planted_first = plant_library(&first.0);
        let _planted_second = plant_library(&second.0);
        let resolved = resolve_library_path(&[first.0.clone(), second.0.clone()]).unwrap();
        assert_eq!(resolved, planted_first);
    }

    #[test]
    fn missing_library_reports_attempted_paths() {
        let dir = TempDir::new("missing");
        let err = resolve_library_path(std::slice::from_ref(&dir.0)).unwrap_err();
        match err {
            NdiError::LibraryNotFound(paths) => {
                assert!(
                    paths.contains(dir.0.to_str().unwrap()),
                    "attempted paths: {paths}"
                );
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
