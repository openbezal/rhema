//! Tells the operator when a newer release exists.
//!
//! Deliberately only a notice: it never downloads or installs anything. The
//! check runs here rather than in the webview because the app's CSP is
//! `connect-src 'self'`, and a version string is not worth widening it for.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Where releases are published. `/releases/latest` excludes prereleases and
/// drafts, so this only ever reports a release that is public and complete.
const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/openbezal/rhema/releases/latest";

/// GitHub rejects requests without a User-Agent, and a slow network must never
/// hold anything up — this is a background nicety, not a feature the operator
/// is waiting on.
const REQUEST_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// The running app's version.
    pub current: String,
    /// The newest published release, without the `v` prefix.
    pub latest: String,
    /// Where a human goes to download it.
    pub url: String,
    /// Whether `latest` is actually ahead of `current`.
    pub is_newer: bool,
}

/// The two fields we need out of GitHub's release payload. Everything else in
/// the response is ignored, so new fields upstream cannot break parsing.
#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
}

/// Parse `0.3.2` or `v0.3.2` into comparable numbers.
///
/// Returns `None` for anything that is not purely numeric dotted components,
/// which includes prerelease tags like `0.4.0-rc1`. Callers treat `None` as
/// "do not claim this is newer": a version we cannot reason about should never
/// nag the operator to install it.
fn parse_version(raw: &str) -> Option<Vec<u32>> {
    let trimmed = raw.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return None;
    }
    trimmed
        .split('.')
        .map(|part| part.parse::<u32>().ok())
        .collect()
}

/// Whether `latest` is a higher version than `current`.
///
/// Ragged component counts compare as if the shorter were zero-padded, so
/// `0.4` beats `0.3.9` and `0.3` ties with `0.3.0`.
fn is_newer(latest: &str, current: &str) -> bool {
    let (Some(latest), Some(current)) = (parse_version(latest), parse_version(current)) else {
        return false;
    };

    let len = latest.len().max(current.len());
    for i in 0..len {
        let l = latest.get(i).copied().unwrap_or(0);
        let c = current.get(i).copied().unwrap_or(0);
        if l != c {
            return l > c;
        }
    }
    false
}

/// Ask GitHub for the newest release. Errors are for the caller to swallow:
/// being offline is the normal case in a lot of church buildings.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<UpdateStatus, String> {
    let current = app.package_info().version.to_string();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(format!("Rhema/{current}"))
        .build()
        .map_err(|e| format!("could not build HTTP client: {e}"))?;

    let response = client
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("update check failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("update check returned {}", response.status()));
    }

    let release: GithubRelease = response
        .json()
        .await
        .map_err(|e| format!("could not read release info: {e}"))?;

    let latest = release.tag_name.trim_start_matches(['v', 'V']).to_string();
    let is_newer = is_newer(&latest, &current);

    log::info!(
        "[UPDATE] current={current} latest={latest} newer={is_newer}"
    );

    Ok(UpdateStatus {
        current,
        latest,
        url: release.html_url,
        is_newer,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn later_patch_minor_and_major_are_newer() {
        assert!(is_newer("0.3.3", "0.3.2"));
        assert!(is_newer("0.4.0", "0.3.9"));
        assert!(is_newer("1.0.0", "0.9.9"));
    }

    #[test]
    fn same_version_is_not_newer() {
        assert!(!is_newer("0.3.2", "0.3.2"));
    }

    #[test]
    fn older_version_is_not_newer() {
        assert!(!is_newer("0.3.1", "0.3.2"));
        assert!(!is_newer("0.2.9", "0.3.0"));
    }

    #[test]
    fn the_v_prefix_is_ignored() {
        assert!(is_newer("v0.3.3", "0.3.2"));
        assert!(!is_newer("v0.3.2", "0.3.2"));
    }

    #[test]
    fn ragged_component_counts_pad_with_zeroes() {
        assert!(is_newer("0.4", "0.3.9"));
        assert!(!is_newer("0.3", "0.3.0"));
        assert!(!is_newer("0.3.0", "0.3"));
    }

    #[test]
    fn double_digit_components_compare_numerically_not_alphabetically() {
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(!is_newer("0.9.0", "0.10.0"));
    }

    #[test]
    fn unparseable_versions_never_prompt_an_update() {
        assert!(!is_newer("0.4.0-rc1", "0.3.2"));
        assert!(!is_newer("nightly", "0.3.2"));
        assert!(!is_newer("", "0.3.2"));
        assert!(!is_newer("0.3.3", "not-a-version"));
    }

    #[test]
    fn release_payload_parses_and_ignores_unknown_fields() {
        let payload = r#"{
            "tag_name": "v0.3.2",
            "html_url": "https://github.com/openbezal/rhema/releases/tag/v0.3.2",
            "name": "Rhema v0.3.2",
            "draft": false,
            "prerelease": false,
            "assets": [{"name": "Rhema-macos-arm64.dmg"}],
            "some_field_github_adds_next_year": 42
        }"#;

        let release: GithubRelease = serde_json::from_str(payload).unwrap();

        assert_eq!(release.tag_name, "v0.3.2");
        assert_eq!(
            release.html_url,
            "https://github.com/openbezal/rhema/releases/tag/v0.3.2"
        );
    }
}
