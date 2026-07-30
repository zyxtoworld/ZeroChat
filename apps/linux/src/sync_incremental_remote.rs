use crate::{
    crypto::SnapshotCrypto,
    models::{EncryptedObjectEnvelope, IncrementalManifest, IncrementalSyncHead},
    sync_http_body::{
        MAX_SYNC_ERROR_BODY_BYTES, MAX_SYNC_INCREMENTAL_HEAD_BYTES,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES, drain_bounded_body, ensure_bytes_size,
        read_bounded_json, read_bounded_text,
    },
    sync_incremental_helpers::is_safe_object_key,
};
use anyhow::{Result, bail};
use reqwest::{Client, StatusCode, header};
use std::{error::Error, fmt};

const SYNC_GENERATION_HEADER: &str = "x-zerochat-sync-generation";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SyncGeneration(String);

impl SyncGeneration {
    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone)]
pub(crate) enum IncrementalHeadRead {
    Unsupported,
    Empty {
        generation: SyncGeneration,
    },
    Head {
        head: IncrementalSyncHead,
        generation: SyncGeneration,
    },
}

impl IncrementalHeadRead {
    pub(crate) fn generation(&self) -> Option<&SyncGeneration> {
        match self {
            Self::Unsupported => None,
            Self::Empty { generation } | Self::Head { generation, .. } => Some(generation),
        }
    }
}

#[derive(Debug)]
struct CloudSyncConflict;

impl fmt::Display for CloudSyncConflict {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("Cloud data changed. Pull again before uploading.")
    }
}

impl Error for CloudSyncConflict {}

pub(crate) fn is_cloud_sync_conflict(error: &anyhow::Error) -> bool {
    error.is::<CloudSyncConflict>()
}

pub(crate) fn cloud_sync_conflict() -> anyhow::Error {
    CloudSyncConflict.into()
}

pub(crate) fn ensure_same_sync_generation(
    expected: &SyncGeneration,
    actual: &SyncGeneration,
) -> Result<()> {
    if expected != actual {
        return Err(cloud_sync_conflict());
    }
    Ok(())
}

pub(crate) fn ensure_same_incremental_observation(
    expected: &IncrementalHeadRead,
    actual: &IncrementalHeadRead,
) -> Result<()> {
    let matches = match (expected, actual) {
        (IncrementalHeadRead::Unsupported, IncrementalHeadRead::Unsupported) => true,
        (
            IncrementalHeadRead::Empty {
                generation: expected,
            },
            IncrementalHeadRead::Empty { generation: actual },
        ) => expected == actual,
        (
            IncrementalHeadRead::Head {
                head: expected_head,
                generation: expected_generation,
            },
            IncrementalHeadRead::Head {
                head: actual_head,
                generation: actual_generation,
            },
        ) => {
            expected_generation == actual_generation
                && expected_head.kind == actual_head.kind
                && expected_head.version == actual_head.version
                && expected_head.manifest_key == actual_head.manifest_key
                && expected_head.updated_at == actual_head.updated_at
        }
        _ => false,
    };

    if !matches {
        return Err(cloud_sync_conflict());
    }
    Ok(())
}

pub(crate) fn validated_sync_generation(
    value: Option<&header::HeaderValue>,
) -> Result<SyncGeneration> {
    let value = value
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let bytes = value.as_bytes();
    let hyphens = [8, 13, 18, 23];
    let has_canonical_shape = bytes.len() == 36
        && bytes.iter().enumerate().all(|(index, byte)| {
            if hyphens.contains(&index) {
                *byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        });
    let is_v4 = has_canonical_shape && bytes[14] == b'4';
    let has_rfc4122_variant =
        has_canonical_shape && matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b');

    if !is_v4 || !has_rfc4122_variant {
        return Err(cloud_sync_conflict());
    }

    Ok(SyncGeneration(value.to_owned()))
}

fn is_conflict_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::CONFLICT | StatusCode::PRECONDITION_FAILED | StatusCode::PRECONDITION_REQUIRED
    )
}

pub(crate) async fn read_incremental_head(
    http: &Client,
    endpoint: &str,
    token: &str,
) -> Result<IncrementalHeadRead> {
    let response = http
        .get(format!("{endpoint}/sync/head"))
        .bearer_auth(token)
        .send()
        .await?;

    if response.status() == StatusCode::NOT_IMPLEMENTED {
        drain_bounded_body(response).await?;
        return Ok(IncrementalHeadRead::Unsupported);
    }

    if response.status() == StatusCode::NOT_FOUND {
        let generation = validated_sync_generation(response.headers().get(SYNC_GENERATION_HEADER))?;
        read_bounded_text(
            response,
            MAX_SYNC_ERROR_BODY_BYTES,
            "Cloud incremental head not-found response",
        )
        .await?;
        return Ok(IncrementalHeadRead::Empty { generation });
    }

    if response.status() != StatusCode::OK {
        if response.status().is_success() {
            drain_bounded_body(response).await?;
            bail!("Cloud incremental head response returned an unexpected status.");
        }
        response.error_for_status()?;
        bail!("Cloud incremental head request failed.");
    }

    let generation = validated_sync_generation(response.headers().get(SYNC_GENERATION_HEADER))?;
    let head = read_bounded_json::<IncrementalSyncHead>(
        response,
        MAX_SYNC_INCREMENTAL_HEAD_BYTES,
        "Cloud incremental head response",
    )
    .await?;
    if head.kind != "zerochat.incrementalHead"
        || head.version != 1
        || !is_safe_object_key(&head.manifest_key)
        || !head.manifest_key.starts_with("manifest-")
        || head.updated_at <= 0
    {
        bail!("Remote incremental sync head is invalid.");
    }

    Ok(IncrementalHeadRead::Head { head, generation })
}

pub(crate) async fn read_incremental_object(
    http: &Client,
    endpoint: &str,
    token: &str,
    key: &str,
) -> Result<EncryptedObjectEnvelope> {
    let response = http
        .get(format!("{endpoint}/sync/object/{key}"))
        .bearer_auth(token)
        .send()
        .await?;

    if !response.status().is_success() {
        response.error_for_status()?;
        bail!("Cloud incremental object request failed.");
    }

    let envelope = read_bounded_json::<EncryptedObjectEnvelope>(
        response,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
        "Cloud incremental object response",
    )
    .await?;
    if envelope.kind != "zerochat.encryptedObject" || envelope.version != 1 {
        bail!("Remote incremental sync object is invalid.");
    }
    Ok(envelope)
}

pub(crate) async fn write_incremental_object(
    http: &Client,
    endpoint: &str,
    token: &str,
    key: &str,
    envelope: &EncryptedObjectEnvelope,
    generation: &SyncGeneration,
) -> Result<()> {
    let body = serde_json::to_vec(envelope)?;
    ensure_bytes_size(
        &body,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
        "Encrypted incremental sync object",
    )?;
    let response = http
        .put(format!("{endpoint}/sync/object/{key}"))
        .bearer_auth(token)
        .header(header::CONTENT_TYPE, "application/json")
        .header(SYNC_GENERATION_HEADER, generation.as_str())
        .body(body)
        .send()
        .await?;
    if is_conflict_status(response.status()) {
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

pub(crate) async fn delete_incremental_object(
    http: &Client,
    endpoint: &str,
    token: &str,
    key: &str,
    generation: &SyncGeneration,
) -> Result<()> {
    let response = http
        .delete(format!("{endpoint}/sync/object/{key}"))
        .bearer_auth(token)
        .header(SYNC_GENERATION_HEADER, generation.as_str())
        .send()
        .await?;

    let status = response.status();
    if is_conflict_status(status) {
        let _ = drain_bounded_body(response).await;
        return Err(cloud_sync_conflict());
    }
    if status.is_success() || status == StatusCode::NOT_FOUND {
        drain_bounded_body(response).await?;
        return Ok(());
    }

    response.error_for_status()?;
    Ok(())
}

pub(crate) async fn write_incremental_head(
    http: &Client,
    endpoint: &str,
    token: &str,
    head: &IncrementalSyncHead,
    previous: Option<&IncrementalSyncHead>,
    generation: &SyncGeneration,
) -> Result<()> {
    let body = serde_json::to_vec(head)?;
    ensure_bytes_size(
        &body,
        MAX_SYNC_INCREMENTAL_HEAD_BYTES,
        "Incremental sync head",
    )?;
    let request = http
        .put(format!("{endpoint}/sync/head"))
        .bearer_auth(token)
        .header(header::CONTENT_TYPE, "application/json")
        .header(SYNC_GENERATION_HEADER, generation.as_str())
        .body(body);
    let request = if let Some(previous) = previous {
        request.header(header::IF_MATCH, format!("\"{}\"", previous.manifest_key))
    } else {
        request.header(header::IF_NONE_MATCH, "*")
    };
    let response = request.send().await?;

    if is_conflict_status(response.status()) {
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

pub(crate) async fn delete_incremental_head(
    http: &Client,
    endpoint: &str,
    token: &str,
    generation: &SyncGeneration,
) -> Result<()> {
    let response = http
        .delete(format!("{endpoint}/sync/head"))
        .bearer_auth(token)
        .header(SYNC_GENERATION_HEADER, generation.as_str())
        .send()
        .await?;
    let status = response.status();
    if is_conflict_status(status) {
        let _ = drain_bounded_body(response).await;
        return Err(cloud_sync_conflict());
    }
    if status.is_success() || status == StatusCode::NOT_FOUND {
        drain_bounded_body(response).await?;
        return Ok(());
    }
    response.error_for_status()?;
    Ok(())
}

pub(crate) async fn delete_legacy_snapshot(
    http: &Client,
    endpoint: &str,
    token: &str,
    generation: &SyncGeneration,
) -> Result<()> {
    let response = http
        .delete(format!("{endpoint}/snapshot"))
        .bearer_auth(token)
        .header(SYNC_GENERATION_HEADER, generation.as_str())
        .send()
        .await?;

    let status = response.status();
    if is_conflict_status(status) {
        let _ = drain_bounded_body(response).await;
        return Err(cloud_sync_conflict());
    }
    if status.is_success()
        || status == StatusCode::NOT_FOUND
        || status == StatusCode::METHOD_NOT_ALLOWED
    {
        drain_bounded_body(response).await?;
        return Ok(());
    }
    response.error_for_status()?;
    Ok(())
}

pub(crate) async fn read_incremental_manifest(
    http: &Client,
    crypto: &SnapshotCrypto,
    endpoint: &str,
    token: &str,
    passphrase: &str,
    head: &IncrementalSyncHead,
) -> Result<IncrementalManifest> {
    let envelope = read_incremental_object(http, endpoint, token, &head.manifest_key).await?;
    let manifest =
        crypto.decrypt_object::<IncrementalManifest>(&envelope, passphrase, "manifest")?;
    if manifest.kind != "zerochat.incrementalManifest"
        || manifest.version != 1
        || manifest.updated_at != head.updated_at
    {
        bail!("Remote incremental manifest is invalid.");
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ObjectEnvelopeCrypto;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc::{self, Receiver},
        thread,
        time::Duration,
    };

    const GENERATION: &str = "00000000-0000-4000-8000-000000000001";

    fn generation() -> SyncGeneration {
        let value = header::HeaderValue::from_static(GENERATION);
        validated_sync_generation(Some(&value)).unwrap()
    }

    fn head() -> IncrementalSyncHead {
        IncrementalSyncHead {
            kind: "zerochat.incrementalHead".to_owned(),
            version: 1,
            manifest_key: "manifest-00000000-0000-4000-8000-000000000001.json".to_owned(),
            updated_at: 10,
        }
    }

    fn object() -> EncryptedObjectEnvelope {
        EncryptedObjectEnvelope {
            kind: "zerochat.encryptedObject".to_owned(),
            version: 1,
            object_type: "manifest".to_owned(),
            encrypted_at: 10,
            updated_at: 10,
            crypto: ObjectEnvelopeCrypto {
                cipher: "AES-GCM".to_owned(),
                kdf: "PBKDF2-SHA256".to_owned(),
                iterations: 600_000,
                salt: "AA==".to_owned(),
                iv: "AA==".to_owned(),
                aad: "AA==".to_owned(),
                compression: "gzip".to_owned(),
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
                if expected_length.is_none()
                    && let Some(header_end) =
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
    fn generation_requires_canonical_uuid_v4_with_rfc4122_variant() {
        for valid in [GENERATION, "ABCDEFAB-CDEF-4ABC-9DEF-ABCDEFABCDEF"] {
            let header = header::HeaderValue::from_str(valid).unwrap();
            assert_eq!(
                validated_sync_generation(Some(&header)).unwrap().as_str(),
                valid
            );
        }

        for invalid in [
            "",
            "00000000-0000-1000-8000-000000000001",
            "00000000-0000-4000-7000-000000000001",
            "00000000000040008000000000000001",
            "{00000000-0000-4000-8000-000000000001}",
            "00000000-0000-4000-8000-000000000001 ",
        ] {
            let value =
                (!invalid.is_empty()).then(|| header::HeaderValue::from_str(invalid).unwrap());
            let error = validated_sync_generation(value.as_ref()).unwrap_err();
            assert!(error.is::<CloudSyncConflict>());
        }
    }

    #[tokio::test]
    async fn head_200_and_404_preserve_the_validated_generation() {
        let body = serde_json::to_string(&head()).unwrap();
        for (status, body) in [("200 OK", body.as_str()), ("404 Not Found", "")] {
            let (endpoint, _, server) = serve_once(response(
                status,
                &[(SYNC_GENERATION_HEADER, GENERATION)],
                body,
            ));
            let read = read_incremental_head(&Client::new(), &endpoint, "test-token")
                .await
                .unwrap();
            assert_eq!(read.generation().unwrap().as_str(), GENERATION);
            assert!(matches!(
                (status, read),
                ("200 OK", IncrementalHeadRead::Head { .. })
                    | ("404 Not Found", IncrementalHeadRead::Empty { .. })
            ));
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn head_200_and_404_without_generation_fail_closed() {
        let body = serde_json::to_string(&head()).unwrap();
        for (status, body) in [("200 OK", body.as_str()), ("404 Not Found", "")] {
            let (endpoint, _, server) = serve_once(response(status, &[], body));
            let error = read_incremental_head(&Client::new(), &endpoint, "test-token")
                .await
                .expect_err("head observations without a generation must fail closed");
            assert!(error.is::<CloudSyncConflict>());
            server.join().unwrap();
        }
    }

    #[test]
    fn different_attempt_generations_are_a_conflict() {
        let first = generation();
        let second_value = header::HeaderValue::from_static("00000000-0000-4000-8000-000000000002");
        let second = validated_sync_generation(Some(&second_value)).unwrap();
        assert!(ensure_same_sync_generation(&first, &first).is_ok());
        assert!(
            ensure_same_sync_generation(&first, &second)
                .unwrap_err()
                .is::<CloudSyncConflict>()
        );
    }

    #[test]
    fn changed_head_within_the_same_generation_is_a_conflict() {
        let generation = generation();
        let expected = IncrementalHeadRead::Head {
            head: head(),
            generation: generation.clone(),
        };
        let mut changed = head();
        changed.manifest_key = "manifest-00000000-0000-4000-8000-000000000002.json".to_owned();
        changed.updated_at += 1;
        let actual = IncrementalHeadRead::Head {
            head: changed,
            generation,
        };

        assert!(
            ensure_same_incremental_observation(&expected, &actual)
                .unwrap_err()
                .is::<CloudSyncConflict>()
        );
    }

    #[tokio::test]
    async fn every_incremental_mutation_carries_the_attempt_generation() {
        let generation = generation();

        let (endpoint, request, server) = serve_once(response("200 OK", &[], "OK"));
        write_incremental_object(
            &Client::new(),
            &endpoint,
            "test-token",
            "manifest-test",
            &object(),
            &generation,
        )
        .await
        .unwrap();
        assert_generation_header(request);
        server.join().unwrap();

        let (endpoint, request, server) = serve_once(response("200 OK", &[], "OK"));
        delete_incremental_object(
            &Client::new(),
            &endpoint,
            "test-token",
            "manifest-test",
            &generation,
        )
        .await
        .unwrap();
        assert_generation_header(request);
        server.join().unwrap();

        let (endpoint, request, server) = serve_once(response("200 OK", &[], "OK"));
        write_incremental_head(
            &Client::new(),
            &endpoint,
            "test-token",
            &head(),
            None,
            &generation,
        )
        .await
        .unwrap();
        assert_generation_header(request);
        server.join().unwrap();

        let (endpoint, request, server) = serve_once(response("200 OK", &[], "OK"));
        delete_incremental_head(&Client::new(), &endpoint, "test-token", &generation)
            .await
            .unwrap();
        assert_generation_header(request);
        server.join().unwrap();

        let (endpoint, request, server) = serve_once(response("200 OK", &[], "OK"));
        delete_legacy_snapshot(&Client::new(), &endpoint, "test-token", &generation)
            .await
            .unwrap();
        assert_generation_header(request);
        server.join().unwrap();
    }

    fn assert_generation_header(request: Receiver<String>) {
        let request = request
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .to_ascii_lowercase();
        assert!(request.contains(&format!(
            "\r\n{}: {}\r\n",
            SYNC_GENERATION_HEADER, GENERATION
        )));
    }

    #[tokio::test]
    async fn incremental_precondition_statuses_are_conflicts() {
        for status in [
            "409 Conflict",
            "412 Precondition Failed",
            "428 Precondition Required",
        ] {
            let (endpoint, _, server) = serve_once(response(status, &[], "changed"));
            let error = write_incremental_head(
                &Client::new(),
                &endpoint,
                "test-token",
                &head(),
                None,
                &generation(),
            )
            .await
            .expect_err("precondition status must map to a sync conflict");
            assert!(is_cloud_sync_conflict(&error));
            server.join().unwrap();
        }
    }
}
