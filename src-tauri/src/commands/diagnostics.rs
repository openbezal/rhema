//! Assembling a log excerpt a user can send us.
//!
//! Filtering happens here rather than in the frontend so that tens of
//! megabytes never cross the IPC boundary, and so the log directory can be
//! read without granting the webview any new filesystem scope.

#![expect(clippy::needless_pass_by_value, reason = "Tauri command extractors require pass-by-value")]

use std::path::{Path, PathBuf};

use tauri::Manager;

/// Log-file basename configured on the plugin's `LogDir` target in `lib.rs`.
/// Rotated archives are `rhema_<date>.log` alongside it.
const LOG_STEM: &str = "rhema";

/// Timestamp prefix written by our formatter: `[YYYY-MM-DD][HH:MM:SS.mmm]`.
/// Anything not starting with this is a continuation of the line before it.
fn parse_line_timestamp(line: &str) -> Option<(i64, u32, u32, u32, u32, u32)> {
    let bytes = line.as_bytes();
    if bytes.len() < 24 || bytes[0] != b'[' {
        return None;
    }
    let date = line.get(1..11)?;
    if bytes.get(11) != Some(&b']') || bytes.get(12) != Some(&b'[') {
        return None;
    }
    let time = line.get(13..21)?;

    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: u32 = date_parts.next()?.parse().ok()?;
    let day: u32 = date_parts.next()?.parse().ok()?;

    let mut time_parts = time.split(':');
    let hour: u32 = time_parts.next()?.parse().ok()?;
    let minute: u32 = time_parts.next()?.parse().ok()?;
    let second: u32 = time_parts.next()?.parse().ok()?;

    Some((year, month, day, hour, minute, second))
}

/// Seconds since the Unix epoch for a UTC calendar timestamp.
///
/// Days-from-civil, from Howard Hinnant's `chrono` algorithms — valid for any
/// proleptic Gregorian date, and it keeps `time` out of this crate's
/// dependencies for what is a handful of arithmetic.
fn to_unix_seconds(year: i64, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = i64::from(month);
    let d = i64::from(day);
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    days * 86_400 + i64::from(hour) * 3600 + i64::from(minute) * 60 + i64::from(second)
}

fn line_epoch_seconds(line: &str) -> Option<i64> {
    let (year, month, day, hour, minute, second) = parse_line_timestamp(line)?;
    Some(to_unix_seconds(year, month, day, hour, minute, second))
}

/// Keep every line at or after `cutoff`.
///
/// A line with no timestamp belongs to the record above it — multi-line error
/// `Display` output and panic backtraces both look like this — so it inherits
/// that record's verdict instead of being dropped. Leading orphan lines (a
/// file that begins mid-record) are skipped, since nothing dates them.
fn filter_since(contents: &str, cutoff: Option<i64>) -> Vec<&str> {
    let Some(cutoff) = cutoff else {
        return contents.lines().collect();
    };
    let mut kept = Vec::new();
    let mut keeping = false;
    for line in contents.lines() {
        match line_epoch_seconds(line) {
            Some(ts) => {
                keeping = ts >= cutoff;
                if keeping {
                    kept.push(line);
                }
            }
            None => {
                if keeping {
                    kept.push(line);
                }
            }
        }
    }
    kept
}

/// The active log plus its rotated archives, oldest first.
///
/// Archives are named `rhema_<YYYY-MM-DD_HH-MM-SS>.log`, so a lexical sort of
/// the archive names is chronological; the live file is always newest.
fn log_files(dir: &Path) -> Vec<PathBuf> {
    let mut archives: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                return false;
            };
            name.starts_with(concat!("rhema", "_")) && std::path::Path::new(name)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))
        })
        .collect();
    archives.sort();

    let live = dir.join(format!("{LOG_STEM}.log"));
    if live.is_file() {
        archives.push(live);
    }
    archives
}

fn header(
    version: &str,
    window: &str,
    files_scanned: usize,
    first: Option<&str>,
    last: Option<&str>,
) -> String {
    format!(
        "==== Rhema diagnostic log ====\n\
         app version : {version}\n\
         platform    : {} {}\n\
         window      : {window}\n\
         files read  : {files_scanned}\n\
         first entry : {}\n\
         last entry  : {}\n\
         timestamps are UTC. this file contains short fragments of speech\n\
         picked up by transcription.\n\
         ==============================\n\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        first.unwrap_or("(none in range)"),
        last.unwrap_or("(none in range)"),
    )
}

/// Collect the log for the requested window as one text blob.
///
/// `since_minutes` of `None` means everything still on disk.
#[tauri::command]
pub fn export_diagnostics(
    app: tauri::AppHandle,
    since_minutes: Option<u64>,
) -> Result<String, String> {
    let dir = app.path().app_log_dir().map_err(|e| {
        log::error!("export_diagnostics: no log dir: {e}");
        format!("Could not locate the log directory: {e}")
    })?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    #[expect(clippy::cast_possible_wrap, reason = "seconds since 1970 fit in i64 for millennia")]
    let cutoff = since_minutes.map(|mins| now as i64 - (mins as i64) * 60);

    let files = log_files(&dir);
    let mut body = String::new();
    for path in &files {
        match std::fs::read_to_string(path) {
            Ok(contents) => {
                for line in filter_since(&contents, cutoff) {
                    body.push_str(line);
                    body.push('\n');
                }
            }
            Err(e) => {
                log::warn!("export_diagnostics: skipping {}: {e}", path.display());
            }
        }
    }

    let first = body.lines().find(|l| line_epoch_seconds(l).is_some());
    let last = body.lines().rfind(|l| line_epoch_seconds(l).is_some());
    let window = since_minutes.map_or_else(
        || "everything on disk".to_string(),
        |mins| format!("last {mins} minutes"),
    );

    let head = header(
        app.package_info().version.to_string().as_str(),
        &window,
        files.len(),
        first.map(|l| &l[..l.len().min(24)]),
        last.map(|l| &l[..l.len().min(24)]),
    );

    log::info!(
        "export_diagnostics: {} lines from {} file(s), window={window}",
        body.lines().count(),
        files.len()
    );
    Ok(head + &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    const T1: &str = "[2026-08-19][10:00:00.000][rhema][INFO] one";
    const T2: &str = "[2026-08-19][10:30:00.000][rhema][INFO] two";
    const T3: &str = "[2026-08-19][11:00:00.000][rhema][INFO] three";

    fn epoch(h: u32, m: u32) -> i64 {
        to_unix_seconds(2026, 8, 19, h, m, 0)
    }

    #[test]
    fn parses_our_timestamp_format() {
        assert_eq!(line_epoch_seconds(T1), Some(epoch(10, 0)));
    }

    #[test]
    fn unix_conversion_matches_known_epochs() {
        assert_eq!(to_unix_seconds(1970, 1, 1, 0, 0, 0), 0);
        assert_eq!(to_unix_seconds(2000, 1, 1, 0, 0, 0), 946_684_800);
        assert_eq!(to_unix_seconds(2026, 8, 19, 12, 34, 56), 1_787_142_896);
    }

    #[test]
    fn none_cutoff_keeps_everything() {
        let text = format!("{T1}\n{T2}\n{T3}");
        assert_eq!(filter_since(&text, None).len(), 3);
    }

    #[test]
    fn cutoff_is_inclusive_and_drops_older_lines() {
        let text = format!("{T1}\n{T2}\n{T3}");
        let kept = filter_since(&text, Some(epoch(10, 30)));
        assert_eq!(kept, vec![T2, T3], "the boundary line itself must be kept");
    }

    #[test]
    fn everything_older_than_the_cutoff_yields_nothing() {
        let text = format!("{T1}\n{T2}");
        assert!(filter_since(&text, Some(epoch(23, 0))).is_empty());
    }

    #[test]
    fn continuation_lines_follow_the_record_above_them() {
        // A panic backtrace under a kept record stays; one under a dropped
        // record goes with it.
        let text = format!("{T1}\n   at old_frame\n{T3}\n   at new_frame\n   at deeper_frame");
        let kept = filter_since(&text, Some(epoch(11, 0)));
        assert_eq!(kept, vec![T3, "   at new_frame", "   at deeper_frame"]);
    }

    #[test]
    fn leading_orphan_lines_are_dropped_when_filtering() {
        // A file that begins mid-record has nothing dating those first lines.
        let text = format!("   dangling continuation\n{T3}");
        assert_eq!(filter_since(&text, Some(epoch(10, 0))), vec![T3]);
    }

    #[test]
    fn malformed_lines_do_not_panic_or_parse() {
        for line in [
            "",
            "[",
            "[not-a-date][10:00:00.000][x][INFO] hi",
            "[2026-08-19] 10:00:00 missing bracket",
            "[2026-08-19][aa:bb:cc.ddd][x][INFO] hi",
            "plain text",
        ] {
            assert!(line_epoch_seconds(line).is_none(), "{line:?} parsed");
        }
    }

    #[test]
    fn header_states_version_platform_and_utc() {
        let head = header("0.2.0", "last 60 minutes", 2, Some(T1), Some(T3));
        assert!(head.contains("0.2.0"));
        assert!(head.contains(std::env::consts::OS));
        assert!(head.contains("last 60 minutes"));
        assert!(head.contains("UTC"));
        assert!(
            head.contains("fragments of speech"),
            "users must be told the file carries speech content"
        );
    }

    #[test]
    fn archives_are_ordered_before_the_live_log() {
        let dir = std::env::temp_dir().join(format!("rhema-diag-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in [
            "rhema.log",
            "rhema_2026-08-19_09-00-00.log",
            "rhema_2026-08-19_08-00-00.log",
            "unrelated.txt",
        ] {
            std::fs::write(dir.join(name), "x").unwrap();
        }

        let names: Vec<String> = log_files(&dir)
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            names,
            vec![
                "rhema_2026-08-19_08-00-00.log",
                "rhema_2026-08-19_09-00-00.log",
                "rhema.log",
            ]
        );

        std::fs::remove_dir_all(&dir).unwrap();
    }

}
