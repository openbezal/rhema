use rhema_broadcast::frame_pump::{FrameTrace, VideoFrame};

pub struct FramePacket {
    pub output_id: String,
    pub lease: String,
    pub frame: VideoFrame,
}

pub fn parse_packet<'a>(
    header: impl Fn(&str) -> Option<&'a str>,
    bytes: &[u8],
) -> Result<FramePacket, String> {
    let required = |name: &str| header(name).ok_or_else(|| format!("missing frame header {name}"));
    let output_id = required("x-rhema-output")?;
    let lease = required("x-rhema-lease")?;
    if lease.len() > 64 {
        return Err("invalid frame lease".into());
    }
    let revision = required("x-rhema-revision")?
        .parse::<u64>()
        .map_err(|error| error.to_string())?;
    let width = required("x-rhema-width")?
        .parse::<u32>()
        .map_err(|error| error.to_string())?;
    let height = required("x-rhema-height")?
        .parse::<u32>()
        .map_err(|error| error.to_string())?;
    if revision == 0
        || width == 0
        || height == 0
        || width > 3840
        || height > 2160
        || u64::try_from(bytes.len()).unwrap_or(u64::MAX)
            != u64::from(width) * u64::from(height) * 4
    {
        return Err("invalid frame revision, dimensions or byte count".into());
    }
    let trace = if let Some(id) = header("x-rhema-trace") {
        if id.len() > 96
            || id.is_empty()
            || !id
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || "-_:".contains(ch))
        {
            return Err("invalid frame trace id".into());
        }
        Some(FrameTrace {
            id: id.to_owned(),
            output_id: output_id.to_owned(),
            accepted_ms: required("x-rhema-accepted-ms")?
                .parse::<u64>()
                .map_err(|error| error.to_string())?,
            rendered_ms: required("x-rhema-rendered-ms")?
                .parse::<u64>()
                .map_err(|error| error.to_string())?,
        })
    } else {
        None
    };
    Ok(FramePacket {
        output_id: output_id.to_owned(),
        lease: lease.to_owned(),
        frame: VideoFrame {
            epoch: 0,
            revision,
            width,
            height,
            pixels: bytes.to_vec(),
            trace,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    fn headers() -> BTreeMap<&'static str, &'static str> {
        BTreeMap::from([
            ("x-rhema-output", "main"),
            ("x-rhema-lease", "1:2"),
            ("x-rhema-revision", "3"),
            ("x-rhema-width", "1"),
            ("x-rhema-height", "1"),
        ])
    }
    #[test]
    fn parses_binary_pixels_and_bounded_trace_metadata() {
        let mut headers = headers();
        headers.extend([
            ("x-rhema-trace", "test-123"),
            ("x-rhema-accepted-ms", "100"),
            ("x-rhema-rendered-ms", "120"),
        ]);
        let packet = parse_packet(|name| headers.get(name).copied(), &[1, 2, 3, 4]).unwrap();
        assert_eq!(
            (packet.output_id.as_str(), packet.lease.as_str()),
            ("main", "1:2")
        );
        assert_eq!(packet.frame.revision, 3);
        assert_eq!(packet.frame.pixels, [1, 2, 3, 4]);
        assert_eq!(packet.frame.trace.as_ref().unwrap().rendered_ms, 120);
    }
    #[test]
    fn rejects_missing_invalid_overflow_and_zero_headers_before_enqueue() {
        for (key, value) in [
            ("x-rhema-revision", "0"),
            ("x-rhema-revision", "18446744073709551616"),
            ("x-rhema-width", "0"),
            ("x-rhema-width", "3841"),
            ("x-rhema-height", "2161"),
            ("x-rhema-height", "no"),
            (
                "x-rhema-lease",
                "123456789012345678901234567890123456789012345678901234567890123456789",
            ),
        ] {
            let mut headers = headers();
            headers.insert(key, value);
            assert!(
                parse_packet(|name| headers.get(name).copied(), &[0; 4]).is_err(),
                "{key}={value}"
            );
        }
        let mut headers = headers();
        headers.remove("x-rhema-output");
        assert!(parse_packet(|name| headers.get(name).copied(), &[0; 4]).is_err());
    }
    #[test]
    fn rejects_truncated_pixels_and_invalid_or_incomplete_trace() {
        let mut headers = headers();
        assert!(parse_packet(|name| headers.get(name).copied(), &[0; 3]).is_err());
        headers.insert("x-rhema-trace", "bad<id");
        assert!(parse_packet(|name| headers.get(name).copied(), &[0; 4]).is_err());
        headers.insert("x-rhema-trace", "valid-id");
        assert!(parse_packet(|name| headers.get(name).copied(), &[0; 4]).is_err());
    }
}
