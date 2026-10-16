use serde::{Deserialize, Serialize};
use std::{
    future::Future,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tokio::sync::Mutex;

const LATEST_RELEASE: &str = "https://api.github.com/repos/openbezal/rhema/releases/latest";
const MAX_RELEASE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub(crate) enum ReleaseNotice {
    Current {
        current_version: String,
    },
    Available {
        current_version: String,
        latest_version: String,
        url: String,
    },
    Unavailable,
}
#[derive(Deserialize)]
struct PublishedRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
}

fn stable_version(tag: &str) -> Result<semver::Version, String> {
    if tag.len() > 64 {
        return Err("Unrecognized release version".into());
    }
    let version = semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| "Unrecognized release version".to_string())?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err("Only stable releases are checked".into());
    }
    Ok(version)
}
fn parse_notice(current: &str, bytes: &[u8]) -> Result<ReleaseNotice, String> {
    if bytes.len() > MAX_RELEASE_BYTES {
        return Err("Release response is too large".into());
    }
    let release: PublishedRelease =
        serde_json::from_slice(bytes).map_err(|_| "Unrecognized release response".to_string())?;
    if release.draft || release.prerelease {
        return Err("Not a stable published release".into());
    }
    let installed = stable_version(current)?;
    let latest = stable_version(&release.tag_name)?;
    if latest > installed {
        Ok(ReleaseNotice::Available {
            current_version: installed.to_string(),
            latest_version: latest.to_string(),
            url: format!(
                "https://github.com/openbezal/rhema/releases/tag/{}",
                release.tag_name
            ),
        })
    } else {
        Ok(ReleaseNotice::Current {
            current_version: installed.to_string(),
        })
    }
}

async fn fetch_notice(
    client: &reqwest::Client,
    endpoint: &str,
    current: &str,
) -> Result<ReleaseNotice, String> {
    let mut response = client
        .get(endpoint)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|_| "Release check unavailable".to_string())?;
    if !response.status().is_success() {
        return Err("Release check unavailable".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RELEASE_BYTES as u64)
    {
        return Err("Release response is too large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Release check unavailable".to_string())?
    {
        if chunk.len() > MAX_RELEASE_BYTES - bytes.len() {
            return Err("Release response is too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_notice(current, &bytes)
}

fn release_client(current: &str) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!(
            "Rhema/{current} (+https://github.com/openbezal/rhema)"
        ))
}
pub(crate) async fn fetch_latest(current: &str) -> ReleaseNotice {
    let Ok(client) = release_client(current).https_only(true).build() else {
        return ReleaseNotice::Unavailable;
    };
    fetch_notice(&client, LATEST_RELEASE, current)
        .await
        .unwrap_or(ReleaseNotice::Unavailable)
}

#[derive(Default)]
pub(crate) struct ReleaseNoticeRuntime {
    snapshot: Mutex<Option<ReleaseNotice>>,
    announced: AtomicBool,
}
impl ReleaseNoticeRuntime {
    pub(crate) async fn check<F, Fut>(&self, retry: bool, fetch: F) -> ReleaseNotice
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = ReleaseNotice>,
    {
        let mut snapshot = self.snapshot.lock().await;
        if !retry {
            if let Some(status) = &*snapshot {
                return status.clone();
            }
        }
        let status = fetch().await;
        *snapshot = Some(status.clone());
        status
    }
    pub(crate) async fn claim(&self) -> bool {
        let snapshot = self.snapshot.lock().await;
        matches!(*snapshot, Some(ReleaseNotice::Available { .. }))
            && !self.announced.swap(true, Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payload(tag: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "tag_name":tag,"draft":false,"prerelease":false,
            "html_url":"https://untrusted.invalid/ignored","extra":"ignored"
        }))
        .unwrap()
    }
    async fn stub(response: Vec<u8>, delay: Duration) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let job = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 2048];
            let _ = stream.read(&mut request).await;
            tokio::time::sleep(delay).await;
            let _ = stream.write_all(&response).await;
        });
        (url, job)
    }
    #[tokio::test]
    async fn handles_real_http_status_json_and_bounded_streamed_bodies() {
        let body = payload("v0.3.3");
        let mut good = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        good.extend_from_slice(&body);
        let mut huge = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
        huge.extend_from_slice(&vec![b' '; MAX_RELEASE_BYTES + 1]);
        let cases = [
            (good, true),
            (
                b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n".to_vec(),
                false,
            ),
            (
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_vec(),
                false,
            ),
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\noops".to_vec(),
                false,
            ),
            (
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                    MAX_RELEASE_BYTES + 1
                )
                .into_bytes(),
                false,
            ),
            (
                b"HTTP/1.1 200 OK\r\nContent-Length: 999\r\n\r\n{}".to_vec(),
                false,
            ),
            (huge, false),
        ];
        let client = release_client("0.3.2")
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        for (response, ok) in cases {
            let (url, server) = stub(response, Duration::ZERO).await;
            let result = fetch_notice(&client, &url, "0.3.2").await;
            server.abort();
            let _ = server.await;
            assert_eq!(result.is_ok(), ok, "{result:?}");
        }
    }
    #[tokio::test]
    async fn a_slow_response_is_bounded_by_the_configured_request_timeout() {
        let (url, server) = stub(Vec::new(), Duration::from_secs(5)).await;
        let client = release_client("0.3.2")
            .timeout(Duration::from_millis(250))
            .build()
            .unwrap();
        let result =
            tokio::time::timeout(Duration::from_secs(2), fetch_notice(&client, &url, "0.3.2"))
                .await;
        server.abort();
        let _ = server.await;
        assert!(result
            .expect("request ignored its configured timeout")
            .is_err());
    }
    #[tokio::test]
    async fn rejects_redirects_without_requesting_the_destination() {
        use std::sync::{atomic::AtomicUsize, Arc};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let observed = requests.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; 2048];
                let _ = stream.read(&mut request).await;
                let response = if observed.fetch_add(1, Ordering::SeqCst) == 0 {
                    b"HTTP/1.1 302 Found\r\nLocation: /redirected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
                } else {
                    let body = payload("v0.3.3");
                    let mut response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .into_bytes();
                    response.extend(body);
                    response
                };
                let _ = stream.write_all(&response).await;
            }
        });
        let client = release_client("0.3.2")
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let result = fetch_notice(&client, &url, "0.3.2").await;
        server.abort();
        let _ = server.await;
        assert!(result.is_err());
        assert_eq!(requests.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn compares_stable_versions_numerically_and_derives_only_our_release_link() {
        for (current, latest) in [
            ("0.3.2", "v0.3.3"),
            ("0.9.99", "0.10.0"),
            ("1.99.99", "v2.0.0"),
        ] {
            let notice = parse_notice(current, &payload(latest)).unwrap();
            assert_eq!(
                notice,
                ReleaseNotice::Available {
                    current_version: current.into(),
                    latest_version: latest.trim_start_matches('v').into(),
                    url: format!("https://github.com/openbezal/rhema/releases/tag/{latest}")
                }
            );
        }
        for latest in ["v0.3.2", "0.3.1", "v0.2.99"] {
            assert_eq!(
                parse_notice("0.3.2", &payload(latest)).unwrap(),
                ReleaseNotice::Current {
                    current_version: "0.3.2".into()
                }
            );
        }
    }
    #[test]
    fn untrusted_versions_flags_and_oversized_payloads_never_prompt() {
        for bad in [
            "nightly",
            "0.4",
            "0.4.0-beta.1",
            "v0.4.0+build",
            "0.04.0",
            "vv0.4.0",
            "0.4.0/../../elsewhere",
            "",
        ] {
            assert!(parse_notice("0.3.2", &payload(bad)).is_err(), "{bad}");
            assert!(
                parse_notice(bad, &payload("v9.0.0")).is_err(),
                "current {bad}"
            );
        }
        for raw in [
            br"{}".as_slice(),
            br#"{"tag_name":"v1.0.0","draft":true,"prerelease":false}"#,
            br#"{"tag_name":"v1.0.0","draft":false,"prerelease":true}"#,
            br#"{"tag_name":"v1.0.0","draft":false}"#,
            b"not JSON",
        ] {
            assert!(parse_notice("0.3.2", raw).is_err());
        }
        assert!(parse_notice("0.3.2", &vec![b' '; MAX_RELEASE_BYTES + 1]).is_err());
    }
    #[tokio::test]
    async fn shares_the_initial_check_allows_explicit_retry_and_claims_only_once_per_process() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let runtime = ReleaseNoticeRuntime::default();
        let calls = AtomicUsize::new(0);
        let fetch = || async {
            calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            ReleaseNotice::Unavailable
        };
        let (a, b) = tokio::join!(runtime.check(false, fetch), runtime.check(false, fetch));
        assert_eq!(a, ReleaseNotice::Unavailable);
        assert_eq!(a, b);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(!runtime.claim().await);
        let available = parse_notice("0.3.2", &payload("v0.3.3")).unwrap();
        assert_eq!(
            runtime
                .check(true, || async {
                    calls.fetch_add(1, Ordering::SeqCst);
                    available.clone()
                })
                .await,
            available
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert!(runtime.claim().await);
        assert!(!runtime.claim().await);
        assert_eq!(
            runtime
                .check(false, || async {
                    panic!("webview reload bypassed cached initial status")
                })
                .await,
            available
        );
    }
}
