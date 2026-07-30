use crate::{
    crypto::SnapshotCrypto,
    models::{EncryptedSnapshotEnvelope, SyncVault},
    sync_http_body::{
        MAX_SYNC_SNAPSHOT_BYTES, drain_bounded_body, ensure_bytes_size, read_bounded_json,
    },
    sync_incremental_remote::{
        SyncGeneration, cloud_sync_conflict, delete_incremental_head, delete_legacy_snapshot,
        ensure_same_sync_generation, read_incremental_head, validated_sync_generation,
    },
};
use anyhow::{Result, bail};
use reqwest::{StatusCode, Url, header};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LegacySnapshotObservation {
    generation: SyncGeneration,
    strong_etag: Option<String>,
}

#[derive(Debug)]
pub(crate) enum LegacySnapshotRead<T> {
    Missing {
        generation: SyncGeneration,
    },
    Found {
        value: T,
        strong_etag: String,
        generation: SyncGeneration,
    },
}

impl<T> LegacySnapshotRead<T> {
    pub(crate) fn into_value(self) -> Option<T> {
        match self {
            Self::Missing { .. } => None,
            Self::Found { value, .. } => Some(value),
        }
    }

    pub(crate) fn generation(&self) -> &SyncGeneration {
        match self {
            Self::Missing { generation } | Self::Found { generation, .. } => generation,
        }
    }

    pub(crate) fn observation(&self) -> LegacySnapshotObservation {
        match self {
            Self::Missing { generation } => LegacySnapshotObservation {
                generation: generation.clone(),
                strong_etag: None,
            },
            Self::Found {
                strong_etag,
                generation,
                ..
            } => LegacySnapshotObservation {
                generation: generation.clone(),
                strong_etag: Some(strong_etag.clone()),
            },
        }
    }

    pub(crate) fn write_condition(&self) -> LegacySnapshotWriteCondition {
        match self {
            Self::Missing { generation } => LegacySnapshotWriteCondition::Create {
                generation: generation.clone(),
            },
            Self::Found {
                strong_etag,
                generation,
                ..
            } => LegacySnapshotWriteCondition::Replace {
                strong_etag: strong_etag.clone(),
                generation: generation.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LegacySnapshotWriteCondition {
    Create {
        generation: SyncGeneration,
    },
    Replace {
        strong_etag: String,
        generation: SyncGeneration,
    },
}

impl LegacySnapshotWriteCondition {
    fn generation(&self) -> &SyncGeneration {
        match self {
            Self::Create { generation } | Self::Replace { generation, .. } => generation,
        }
    }
}

pub(crate) fn ensure_same_snapshot_observation<T>(
    expected: &LegacySnapshotObservation,
    actual: &LegacySnapshotRead<T>,
) -> Result<()> {
    ensure_same_sync_generation(&expected.generation, actual.generation())?;
    if expected.strong_etag != actual.observation().strong_etag {
        return Err(cloud_sync_conflict());
    }
    Ok(())
}

pub(crate) fn normalized_worker_endpoint(value: &str) -> Result<String> {
    let endpoint = value.trim().trim_end_matches('/');

    if endpoint.is_empty() {
        bail!("Cloudflare Worker endpoint is required.");
    }

    let url = Url::parse(endpoint)?;
    let host = url.host_str().unwrap_or_default();
    let is_loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    let is_safe_scheme = url.scheme() == "https" || (url.scheme() == "http" && is_loopback);

    if !url.username().is_empty() || url.password().is_some() {
        bail!("Cloudflare Worker endpoint cannot include username or password.");
    }

    if url.query().is_some() || url.fragment().is_some() {
        bail!("Cloudflare Worker endpoint cannot include query parameters or # fragments.");
    }

    if !is_safe_scheme {
        bail!("Cloudflare Worker endpoint must use HTTPS unless it is a loopback address.");
    }

    Ok(endpoint.to_owned())
}

pub(crate) async fn read_cloudflare_snapshot_envelope(
    http: &reqwest::Client,
    endpoint: &str,
    token: &str,
) -> Result<LegacySnapshotRead<EncryptedSnapshotEnvelope>> {
    let (resource, generation) = read_cloudflare_snapshot_resource(http, endpoint, token).await?;
    let Some((value, strong_etag)) = resource else {
        return Ok(LegacySnapshotRead::Missing { generation });
    };
    Ok(LegacySnapshotRead::Found {
        value,
        strong_etag,
        generation,
    })
}

async fn read_cloudflare_snapshot_resource(
    http: &reqwest::Client,
    endpoint: &str,
    token: &str,
) -> Result<(Option<(EncryptedSnapshotEnvelope, String)>, SyncGeneration)> {
    let token = cloudflare_access_key(token)?;
    let response = http
        .get(format!("{endpoint}/snapshot"))
        .bearer_auth(token)
        .send()
        .await?;

    if response.status() == StatusCode::NOT_FOUND {
        let generation =
            validated_sync_generation(response.headers().get("x-zerochat-sync-generation"))?;
        drain_bounded_body(response).await?;
        return Ok((None, generation));
    }

    if response.status() != StatusCode::OK {
        if response.status().is_success() {
            drain_bounded_body(response).await?;
            bail!("Cloud sync snapshot response returned an unexpected status.");
        }
        response.error_for_status()?;
        bail!("Cloud sync snapshot request failed.");
    }

    let generation =
        validated_sync_generation(response.headers().get("x-zerochat-sync-generation"))?;
    let strong_etag = validated_snapshot_etag(response.headers().get(header::ETAG))?;
    let value = read_bounded_json(
        response,
        MAX_SYNC_SNAPSHOT_BYTES,
        "Cloud sync snapshot response",
    )
    .await?;
    Ok((Some((value, strong_etag)), generation))
}

pub(crate) async fn write_cloudflare_snapshot_envelope(
    http: &reqwest::Client,
    endpoint: &str,
    token: &str,
    envelope: &EncryptedSnapshotEnvelope,
    condition: &LegacySnapshotWriteCondition,
) -> Result<()> {
    let token = cloudflare_access_key(token)?;
    let body = serde_json::to_vec(envelope)?;
    ensure_bytes_size(&body, MAX_SYNC_SNAPSHOT_BYTES, "Encrypted sync snapshot")?;
    let request = http
        .put(format!("{endpoint}/snapshot"))
        .bearer_auth(token)
        .header(header::CONTENT_TYPE, "application/json")
        .header(
            "x-zerochat-sync-generation",
            condition.generation().as_str(),
        )
        .body(body);
    let request = match condition {
        LegacySnapshotWriteCondition::Create { .. } => request.header(header::IF_NONE_MATCH, "*"),
        LegacySnapshotWriteCondition::Replace { strong_etag, .. } => {
            request.header(header::IF_MATCH, strong_etag)
        }
    };
    let response = request.send().await?;

    if matches!(
        response.status(),
        StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED | StatusCode::PRECONDITION_REQUIRED
    ) {
        let _ = drain_bounded_body(response).await;
        return Err(cloud_sync_conflict());
    }

    if response.status().is_success() {
        drain_bounded_body(response).await?;
        return Ok(());
    }

    response.error_for_status()?;

    Ok(())
}

pub(crate) async fn read_cloudflare_snapshot_vault(
    http: &reqwest::Client,
    crypto: &SnapshotCrypto,
    endpoint: &str,
    token: &str,
    passphrase: &str,
) -> Result<LegacySnapshotRead<SyncVault>> {
    match read_cloudflare_snapshot_envelope(http, endpoint, token).await? {
        LegacySnapshotRead::Missing { generation } => {
            Ok(LegacySnapshotRead::Missing { generation })
        }
        LegacySnapshotRead::Found {
            value,
            strong_etag,
            generation,
        } => Ok(LegacySnapshotRead::Found {
            value: crypto.decrypt_vault(&value, passphrase)?,
            strong_etag,
            generation,
        }),
    }
}

pub(crate) async fn write_cloudflare_snapshot_vault(
    http: &reqwest::Client,
    crypto: &SnapshotCrypto,
    endpoint: &str,
    token: &str,
    vault: &SyncVault,
    passphrase: &str,
    condition: &LegacySnapshotWriteCondition,
) -> Result<()> {
    let envelope = crypto.encrypt_vault(vault, passphrase)?;
    write_cloudflare_snapshot_envelope(http, endpoint, token, &envelope, condition).await
}

pub(crate) async fn clear_cloudflare_remote(
    http: &reqwest::Client,
    worker_endpoint: &str,
    token: &str,
) -> Result<()> {
    let endpoint = normalized_worker_endpoint(worker_endpoint)?;
    let token = cloudflare_access_key(token)?;

    let bulk = http
        .delete(format!("{endpoint}/sync/clear"))
        .bearer_auth(token)
        .send()
        .await?;

    let bulk_status = bulk.status();
    if bulk_status.is_success() {
        let generation = bulk.headers().get("x-zerochat-sync-generation").cloned();
        drain_bounded_body(bulk).await?;
        validated_sync_generation(generation.as_ref())?;
        return Ok(());
    }

    if !matches!(
        bulk_status,
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED | StatusCode::NOT_IMPLEMENTED
    ) {
        bulk.error_for_status()?;
        return Ok(());
    }
    drain_bounded_body(bulk).await?;

    let head = read_incremental_head(http, &endpoint, token).await?;
    let Some(generation) = head.generation().cloned() else {
        bail!("Cloudflare Worker does not support generation-safe remote clear.");
    };
    let snapshot = read_cloudflare_snapshot_envelope(http, &endpoint, token).await?;
    ensure_same_sync_generation(&generation, snapshot.generation())?;
    delete_incremental_head(http, &endpoint, token, &generation).await?;
    delete_legacy_snapshot(http, &endpoint, token, &generation).await?;

    Ok(())
}

fn cloudflare_access_key(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty() {
        bail!("Cloudflare access key is required.");
    }
    Ok(value)
}

fn validated_snapshot_etag(value: Option<&header::HeaderValue>) -> Result<String> {
    let value = value
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let Some(digest) = value
        .strip_prefix("\"snapshot-sha256-")
        .and_then(|value| value.strip_suffix('"'))
    else {
        bail!("Remote snapshot has invalid strong ETag.");
    };

    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("Remote snapshot has invalid strong ETag.");
    }

    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EnvelopeCrypto;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc::{self, Receiver},
        thread,
        time::Duration,
    };

    const GENERATION: &str = "00000000-0000-4000-8000-000000000001";

    fn generation() -> SyncGeneration {
        validated_sync_generation(Some(&header::HeaderValue::from_static(GENERATION))).unwrap()
    }

    fn envelope() -> EncryptedSnapshotEnvelope {
        EncryptedSnapshotEnvelope {
            kind: "zerochat.encryptedSnapshot".to_owned(),
            version: 1,
            encrypted_at: 10,
            updated_at: 10,
            crypto: EnvelopeCrypto {
                cipher: "AES-GCM".to_owned(),
                kdf: "PBKDF2-SHA256".to_owned(),
                iterations: 600_000,
                salt: "AA==".to_owned(),
                iv: "AA==".to_owned(),
                aad: "AA==".to_owned(),
            },
            payload: "AA==".to_owned(),
        }
    }

    fn response(status: &str, headers: &[(&str, &str)], body: &str) -> String {
        let mut response = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
            body.len()
        );
        for (name, value) in headers {
            response.push_str(&format!("{name}: {value}\r\n"));
        }
        response.push_str("\r\n");
        response.push_str(body);
        response
    }

    fn serve_once(response: String) -> (String, Receiver<String>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server should have address");
        let (sender, receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("test request should connect");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("read timeout should configure");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let mut expected_length = None;

            loop {
                let count = stream
                    .read(&mut buffer)
                    .expect("request should be readable");
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..count]);

                if expected_length.is_none() {
                    if let Some(header_end) =
                        request.windows(4).position(|part| part == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_length = headers
                            .lines()
                            .find_map(|line| {
                                line.split_once(':').and_then(|(name, value)| {
                                    name.eq_ignore_ascii_case("content-length")
                                        .then(|| value.trim().parse::<usize>().ok())
                                        .flatten()
                                })
                            })
                            .unwrap_or(0);
                        expected_length = Some(header_end + 4 + content_length);
                    }
                }

                if expected_length.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }

            stream
                .write_all(response.as_bytes())
                .expect("response should be writable");
            let _ = sender.send(String::from_utf8_lossy(&request).into_owned());
        });
        (format!("http://{address}"), receiver, handle)
    }

    #[test]
    fn snapshot_etag_requires_the_exact_strong_digest_shape() {
        let valid = format!("\"snapshot-sha256-{}\"", "a".repeat(64));
        let valid_header = header::HeaderValue::from_bytes(valid.as_bytes()).unwrap();
        assert_eq!(validated_snapshot_etag(Some(&valid_header)).unwrap(), valid);

        for invalid in [
            None,
            Some(format!("W/\"snapshot-sha256-{}\"", "a".repeat(64))),
            Some(format!("\"snapshot-sha256-{}\"", "a".repeat(63))),
            Some(format!("\"snapshot-sha256-{}g\"", "a".repeat(63))),
            Some(format!("\"other-sha256-{}\"", "a".repeat(64))),
        ] {
            let header = invalid
                .as_deref()
                .map(|value| header::HeaderValue::from_bytes(value.as_bytes()).unwrap());
            assert!(validated_snapshot_etag(header.as_ref()).is_err());
        }
    }

    #[test]
    fn changed_snapshot_etag_within_the_same_generation_is_a_conflict() {
        let expected = LegacySnapshotRead::<()>::Found {
            value: (),
            strong_etag: format!("\"snapshot-sha256-{}\"", "a".repeat(64)),
            generation: generation(),
        }
        .observation();
        let actual = LegacySnapshotRead::<()>::Found {
            value: (),
            strong_etag: format!("\"snapshot-sha256-{}\"", "b".repeat(64)),
            generation: generation(),
        };

        let error = ensure_same_snapshot_observation(&expected, &actual).unwrap_err();
        assert!(crate::sync_incremental_remote::is_cloud_sync_conflict(
            &error
        ));
    }

    #[tokio::test]
    async fn snapshot_get_requires_and_preserves_the_strong_etag() {
        let etag = format!("\"snapshot-sha256-{}\"", "b".repeat(64));
        let body = serde_json::to_string(&envelope()).unwrap();
        let (endpoint, request, server) = serve_once(response(
            "200 OK",
            &[
                ("ETag", etag.as_str()),
                ("Content-Type", "application/json"),
                ("x-zerochat-sync-generation", GENERATION),
            ],
            &body,
        ));

        let read =
            read_cloudflare_snapshot_envelope(&reqwest::Client::new(), &endpoint, "test-token")
                .await
                .unwrap();

        match read {
            LegacySnapshotRead::Found {
                value,
                strong_etag,
                generation,
            } => {
                assert_eq!(value.updated_at, 10);
                assert_eq!(strong_etag, etag);
                assert_eq!(generation.as_str(), GENERATION);
            }
            LegacySnapshotRead::Missing { .. } => panic!("snapshot should exist"),
        }
        assert!(
            request
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .starts_with("GET /snapshot HTTP/1.1")
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn snapshot_get_without_etag_fails_closed() {
        let body = serde_json::to_string(&envelope()).unwrap();
        let (endpoint, _, server) = serve_once(response(
            "200 OK",
            &[
                ("Content-Type", "application/json"),
                ("x-zerochat-sync-generation", GENERATION),
            ],
            &body,
        ));

        let error =
            read_cloudflare_snapshot_envelope(&reqwest::Client::new(), &endpoint, "test-token")
                .await
                .expect_err("missing ETag must reject the remote snapshot");
        assert_eq!(
            error.to_string(),
            "Remote snapshot has invalid strong ETag."
        );
        server.join().unwrap();
    }

    #[tokio::test]
    async fn snapshot_404_drives_if_none_match_create() {
        let (read_endpoint, _, read_server) = serve_once(response(
            "404 Not Found",
            &[("x-zerochat-sync-generation", GENERATION)],
            "",
        ));
        let read = read_cloudflare_snapshot_envelope(
            &reqwest::Client::new(),
            &read_endpoint,
            "test-token",
        )
        .await
        .unwrap();
        let condition = read.write_condition();
        assert!(matches!(read, LegacySnapshotRead::Missing { .. }));
        read_server.join().unwrap();

        let (endpoint, request, server) = serve_once(response("200 OK", &[], "OK"));
        write_cloudflare_snapshot_envelope(
            &reqwest::Client::new(),
            &endpoint,
            "test-token",
            &envelope(),
            &condition,
        )
        .await
        .unwrap();

        let request = request.recv_timeout(Duration::from_secs(5)).unwrap();
        let request = request.to_ascii_lowercase();
        assert!(request.starts_with("put /snapshot http/1.1"));
        assert!(request.contains("\r\nif-none-match: *\r\n"));
        assert!(request.contains(&format!(
            "\r\nx-zerochat-sync-generation: {}\r\n",
            GENERATION
        )));
        assert!(!request.contains("\r\nif-match:"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn snapshot_replace_uses_the_just_read_etag_only() {
        let etag = format!("\"snapshot-sha256-{}\"", "c".repeat(64));
        let body = serde_json::to_string(&envelope()).unwrap();
        let (read_endpoint, _, read_server) = serve_once(response(
            "200 OK",
            &[
                ("ETag", etag.as_str()),
                ("Content-Type", "application/json"),
                ("x-zerochat-sync-generation", GENERATION),
            ],
            &body,
        ));
        let read = read_cloudflare_snapshot_envelope(
            &reqwest::Client::new(),
            &read_endpoint,
            "test-token",
        )
        .await
        .unwrap();
        let condition = read.write_condition();
        read_server.join().unwrap();

        let (endpoint, request, server) = serve_once(response("200 OK", &[], "OK"));
        write_cloudflare_snapshot_envelope(
            &reqwest::Client::new(),
            &endpoint,
            "test-token",
            &envelope(),
            &condition,
        )
        .await
        .unwrap();

        let request = request.recv_timeout(Duration::from_secs(5)).unwrap();
        let request = request.to_ascii_lowercase();
        assert!(request.contains(&format!("\r\nif-match: {}\r\n", etag)));
        assert!(request.contains(&format!(
            "\r\nx-zerochat-sync-generation: {}\r\n",
            GENERATION
        )));
        assert!(!request.contains("\r\nif-none-match:"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn snapshot_precondition_failures_are_remote_updates() {
        for status in [
            "409 Conflict",
            "412 Precondition Failed",
            "428 Precondition Required",
        ] {
            let (endpoint, _, server) = serve_once(response(status, &[], "Snapshot changed"));
            let error = write_cloudflare_snapshot_envelope(
                &reqwest::Client::new(),
                &endpoint,
                "test-token",
                &envelope(),
                &LegacySnapshotWriteCondition::Create {
                    generation: generation(),
                },
            )
            .await
            .expect_err("precondition failure must reject local publication");
            assert!(crate::sync_incremental_remote::is_cloud_sync_conflict(
                &error
            ));
            assert_eq!(
                error.to_string(),
                "Cloud data changed. Pull again before uploading."
            );
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn snapshot_200_and_404_require_a_valid_v4_generation() {
        let body = serde_json::to_string(&envelope()).unwrap();
        let etag = format!("\"snapshot-sha256-{}\"", "d".repeat(64));
        for (status, headers, body) in [
            (
                "200 OK",
                vec![
                    ("ETag", etag.as_str()),
                    ("Content-Type", "application/json"),
                ],
                body.as_str(),
            ),
            ("404 Not Found", vec![], ""),
        ] {
            let (endpoint, _, server) = serve_once(response(status, &headers, body));
            let error =
                read_cloudflare_snapshot_envelope(&reqwest::Client::new(), &endpoint, "test-token")
                    .await
                    .expect_err("snapshot observations without a generation must fail closed");
            assert_eq!(
                error.to_string(),
                "Cloud data changed. Pull again before uploading."
            );
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn bulk_clear_does_not_send_a_stale_generation() {
        let (endpoint, request, server) = serve_once(response(
            "200 OK",
            &[("x-zerochat-sync-generation", GENERATION)],
            "OK",
        ));
        clear_cloudflare_remote(&reqwest::Client::new(), &endpoint, "test-token")
            .await
            .unwrap();

        let request = request
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .to_ascii_lowercase();
        assert!(request.starts_with("delete /sync/clear http/1.1"));
        assert!(!request.contains("\r\nx-zerochat-sync-generation:"));
        server.join().unwrap();
    }

    #[tokio::test]
    async fn bulk_clear_requires_the_rotated_generation_response() {
        let (endpoint, _request, server) = serve_once(response("200 OK", &[], "OK"));
        let error = clear_cloudflare_remote(&reqwest::Client::new(), &endpoint, "test-token")
            .await
            .expect_err("clear success without a rotated generation must fail closed");

        assert_eq!(
            error.to_string(),
            "Cloud data changed. Pull again before uploading."
        );
        server.join().unwrap();
    }
}
