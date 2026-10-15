//! Native SDK handoff probe. This deliberately excludes Tauri/render/Windows/vMix
//! latency; use the documented full receiver matrix before claiming issue #177.
use rhema_broadcast::frame_pump::{wall_epoch_ms, FrameTrace, VideoFrame};
use rhema_broadcast::ndi::{
    NdiAlphaMode, NdiFrameRate, NdiResolution, NdiRuntime, NdiStartRequest,
};
use std::time::Duration;

fn pixels(width: u32, height: u32, value: u8) -> Vec<u8> {
    let mut pixels = vec![0; usize::try_from(width * height * 4).expect("supported dimensions")];
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.copy_from_slice(&[value, 80, 160, 128]);
    }
    pixels
}
struct Options {
    fps: NdiFrameRate,
    resolution: NdiResolution,
    source: String,
    output_count: usize,
    alpha: NdiAlphaMode,
}
fn options() -> Result<Options, Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let fps = match args.get(1).map_or("30", String::as_str) {
        "24" => NdiFrameRate::Fps24,
        "30" => NdiFrameRate::Fps30,
        "60" => NdiFrameRate::Fps60,
        _ => return Err("fps must be 24, 30 or 60".into()),
    };
    let resolution = match args.get(2).map_or("720", String::as_str) {
        "720" => NdiResolution::R720p,
        "1080" => NdiResolution::R1080p,
        _ => return Err("resolution must be 720 or 1080".into()),
    };
    let source = args
        .get(3)
        .cloned()
        .unwrap_or_else(|| format!("Rhema QA Frame Probe {}", std::process::id()));
    let output_count = args.get(4).map_or(Ok(1), |value| value.parse::<usize>())?;
    if !(1..=2).contains(&output_count) {
        return Err("probe supports one or two outputs".into());
    }
    let alpha = match args.get(5).map_or("straight", String::as_str) {
        "opaque" => NdiAlphaMode::NoneOpaque,
        "straight" => NdiAlphaMode::StraightAlpha,
        "premultiplied" => NdiAlphaMode::PremultipliedAlpha,
        _ => return Err("unknown alpha mode".into()),
    };
    Ok(Options {
        fps,
        resolution,
        source,
        output_count,
        alpha,
    })
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let Options {
        fps,
        resolution,
        source,
        output_count,
        alpha,
    } = options()?;
    let mut runtime = NdiRuntime::default();
    let mut sessions = Vec::new();
    for index in 0..output_count {
        let id = format!("qa-{index}");
        let request = NdiStartRequest {
            source_name: format!("{source}-{index}"),
            resolution,
            frame_rate: fps,
            alpha_mode: alpha,
        };
        let info = runtime.start(id.clone(), request.clone())?;
        let lease = runtime.begin_renderer(&id, &info.generation, 0)?;
        sessions.push((id, request, info, lease));
    }
    for revision in 1..=111 {
        for (id, _, info, lease) in &sessions {
            let data = if revision == 111 {
                vec![0; usize::try_from(info.width * info.height * 4)?]
            } else {
                pixels(info.width, info.height, u8::try_from(revision)?)
            };
            let accepted = wall_epoch_ms();
            runtime.submit_frame(
                id,
                lease,
                VideoFrame {
                    epoch: 0,
                    revision,
                    width: info.width,
                    height: info.height,
                    pixels: data,
                    trace: Some(FrameTrace {
                        id: format!("probe-{revision}"),
                        output_id: id.clone(),
                        accepted_ms: accepted,
                        rendered_ms: accepted,
                    }),
                },
            )?;
            println!(
                "{}",
                serde_json::json!({ "stage": "submitted", "output": id, "revision": revision, "acceptedMs": accepted })
            );
        }
        // Ten warmup changes (the first allows discovery), then 100 samples,
        // followed by one transparent terminal clear. No text/profile/audio.
        std::thread::sleep(if revision == 1 {
            Duration::from_secs(4)
        } else {
            Duration::from_millis(100)
        });
    }
    std::thread::sleep(Duration::from_millis(500));
    for (id, _, _, _) in &sessions {
        println!(
            "{}",
            serde_json::json!({ "stage": "stats", "output": id, "stats": runtime.frame_stats(id) })
        );
    }
    // Restart reuses the discovery name, rejects old lease, and accepts revision
    // one in the replacement generation. Stop joins all synchronous sends.
    for (id, request, old_info, old_lease) in sessions {
        let info = runtime.start(id.clone(), request)?;
        assert_ne!(info.generation, old_info.generation);
        let stale = VideoFrame {
            epoch: 0,
            revision: 999,
            width: info.width,
            height: info.height,
            pixels: pixels(info.width, info.height, 1),
            trace: None,
        };
        assert!(runtime.submit_frame(&id, &old_lease, stale).is_err());
        let lease = runtime.begin_renderer(&id, &info.generation, 0)?;
        runtime.submit_frame(
            &id,
            &lease,
            VideoFrame {
                epoch: 0,
                revision: 1,
                width: info.width,
                height: info.height,
                pixels: pixels(info.width, info.height, 2),
                trace: None,
            },
        )?;
        runtime.stop(&id);
        assert!(!runtime.is_active(&id));
    }
    assert!(!runtime.any_active());
    println!("{}", serde_json::json!({ "stage": "lifecycle_passed" }));
    Ok(())
}
