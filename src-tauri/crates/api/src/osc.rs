use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rosc::{OscPacket, OscMessage};

use crate::coerce::parse_osc;
use crate::dispatch::{CommandDispatcher, CommandSink};
use crate::error::CommandError;

/// Configuration for the OSC listener.
#[derive(Debug, Clone)]
pub struct OscConfig {
    pub port: u16,
    pub host: String,
}

impl Default for OscConfig {
    fn default() -> Self {
        Self {
            port: 8000,
            host: "0.0.0.0".into(),
        }
    }
}

/// Handle to a running OSC listener. Dropping or calling `stop()` shuts it down.
pub struct OscHandle {
    active: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl OscHandle {
    /// Signal the listener to stop and wait for the thread to finish.
    pub fn stop(&mut self) {
        self.active.store(false, Ordering::SeqCst);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }

    /// Check if the listener is still running.
    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }
}

impl Drop for OscHandle {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Result of attempting to start the OSC listener.
pub struct OscStartResult {
    pub handle: OscHandle,
    pub bound_port: u16,
}

/// Start the OSC UDP listener on a dedicated thread.
///
/// The listener binds to `config.host:config.port`, reads incoming UDP packets,
/// decodes OSC messages, parses them into `RemoteCommand` via `parse_osc`,
/// and dispatches through the provided `CommandSink`.
///
/// Returns a handle that can be used to stop the listener, plus the actual bound port.
///
/// # Errors
///
/// Returns `CommandError::DispatchFailed` if the UDP socket cannot bind.
#[expect(clippy::needless_pass_by_value, reason = "OscConfig is consumed to move fields into the spawned thread")]
pub fn start_osc_listener<S>(config: OscConfig, sink: Arc<S>) -> Result<OscStartResult, CommandError>
where
    S: CommandSink + 'static,
{
    let bind_addr = format!("{}:{}", config.host, config.port);

    let socket = UdpSocket::bind(&bind_addr).map_err(|e| {
        CommandError::DispatchFailed(format!("Failed to bind OSC on {bind_addr}: {e}"))
    })?;

    let bound_port = socket.local_addr().map(|a| a.port()).unwrap_or(config.port);

    // Non-blocking with a short timeout so we can check the active flag
    socket
        .set_read_timeout(Some(Duration::from_millis(100)))
        .map_err(|e| CommandError::DispatchFailed(format!("Failed to set read timeout: {e}")))?;

    let active = Arc::new(AtomicBool::new(true));
    let thread_active = active.clone();

    let thread = std::thread::Builder::new()
        .name("osc-listener".into())
        .spawn(move || {
            log::info!("OSC listener started on {bind_addr} (port {bound_port})");

            let mut buf = [0u8; 4096];

            while thread_active.load(Ordering::SeqCst) {
                let (size, _src) = match socket.recv_from(&mut buf) {
                    Ok(result) => result,
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        // Timeout — loop back to check active flag
                        continue;
                    }
                    Err(e) => {
                        log::debug!("OSC recv error: {e}");
                        continue;
                    }
                };

                let packet = match rosc::decoder::decode_udp(&buf[..size]) {
                    Ok((_rest, packet)) => packet,
                    Err(e) => {
                        log::debug!("OSC decode error: {e:?}");
                        continue;
                    }
                };

                handle_packet(&packet, &*sink);
            }

            log::info!("OSC listener stopped");
        })
        .map_err(|e| CommandError::DispatchFailed(format!("Failed to spawn OSC thread: {e}")))?;

    Ok(OscStartResult {
        handle: OscHandle {
            active,
            thread: Some(thread),
        },
        bound_port,
    })
}

/// Recursively handle an OSC packet (messages and bundles).
fn handle_packet(packet: &OscPacket, sink: &dyn CommandSink) {
    match packet {
        OscPacket::Message(msg) => handle_message(msg, sink),
        OscPacket::Bundle(bundle) => {
            for content in &bundle.content {
                handle_packet(content, sink);
            }
        }
    }
}

/// Parse a single OSC message and dispatch the resulting command.
fn handle_message(msg: &OscMessage, sink: &dyn CommandSink) {
    match parse_osc(&msg.addr, &msg.args) {
        Ok(cmd) => {
            log::debug!("OSC command: {cmd}");
            if let Err(e) = CommandDispatcher::dispatch(&cmd, sink) {
                log::warn!("OSC dispatch error for {}: {e}", msg.addr);
            }
        }
        Err(e) => {
            log::debug!("OSC parse error for {}: {e}", msg.addr);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MockSink {
        commands: Mutex<Vec<String>>,
    }

    impl MockSink {
        fn new() -> Self {
            Self {
                commands: Mutex::new(Vec::new()),
            }
        }

        fn command_count(&self) -> usize {
            self.commands.lock().unwrap().len()
        }
    }

    impl CommandSink for MockSink {
        fn emit_event(&self, event: &str, _payload: &str) -> Result<(), CommandError> {
            self.commands.lock().unwrap().push(event.to_string());
            Ok(())
        }

        fn invoke_backend(&self, action: &str, _args: &str) -> Result<(), CommandError> {
            self.commands.lock().unwrap().push(action.to_string());
            Ok(())
        }
    }

    #[test]
    fn osc_listener_binds_and_stops() {
        let sink = Arc::new(MockSink::new());
        let config = OscConfig {
            port: 0, // OS assigns a free port
            host: "127.0.0.1".into(),
        };

        let mut result = start_osc_listener(config, sink).expect("should bind");
        assert!(result.bound_port > 0);
        assert!(result.handle.is_active());

        result.handle.stop();
        assert!(!result.handle.is_active());
    }

    #[test]
    fn osc_listener_receives_and_dispatches() {
        let sink = Arc::new(MockSink::new());
        let config = OscConfig {
            port: 0,
            host: "127.0.0.1".into(),
        };

        let result = start_osc_listener(config, sink.clone()).expect("should bind");
        let port = result.bound_port;

        // Send an OSC message to the listener
        let send_socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        let msg = rosc::OscMessage {
            addr: "/rhema/next".into(),
            args: vec![],
        };
        let packet = rosc::OscPacket::Message(msg);
        let encoded = rosc::encoder::encode(&packet).unwrap();
        send_socket
            .send_to(&encoded, format!("127.0.0.1:{port}"))
            .unwrap();

        // Give the listener thread time to process
        std::thread::sleep(Duration::from_millis(200));

        assert!(sink.command_count() > 0, "Should have received at least one command");

        // Clean up
        let mut handle = result.handle;
        handle.stop();
    }

    #[test]
    fn osc_listener_port_conflict_returns_error() {
        // Bind a port first
        let blocker = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = blocker.local_addr().unwrap().port();

        let sink = Arc::new(MockSink::new());
        let config = OscConfig {
            port,
            host: "127.0.0.1".into(),
        };

        let result = start_osc_listener(config, sink);
        assert!(result.is_err(), "Should fail when port is already in use");
    }

    #[test]
    fn handle_message_dispatches_next() {
        let sink = MockSink::new();
        let msg = OscMessage {
            addr: "/rhema/next".into(),
            args: vec![],
        };
        handle_message(&msg, &sink);
        assert_eq!(sink.command_count(), 1);
    }

    #[test]
    fn handle_message_ignores_unknown_address() {
        let sink = MockSink::new();
        let msg = OscMessage {
            addr: "/foo/bar".into(),
            args: vec![],
        };
        handle_message(&msg, &sink);
        assert_eq!(sink.command_count(), 0);
    }

    #[test]
    fn handle_packet_processes_bundle() {
        let sink = MockSink::new();
        let bundle = OscPacket::Bundle(rosc::OscBundle {
            timetag: rosc::OscTime { seconds: 0, fractional: 0 },
            content: vec![
                OscPacket::Message(OscMessage {
                    addr: "/rhema/next".into(),
                    args: vec![],
                }),
                OscPacket::Message(OscMessage {
                    addr: "/rhema/prev".into(),
                    args: vec![],
                }),
            ],
        });
        handle_packet(&bundle, &sink);
        assert_eq!(sink.command_count(), 2);
    }
}
