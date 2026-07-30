use crate::{
    crypto::SnapshotCrypto,
    models::{EncryptedSnapshotEnvelope, SyncVault},
    secret_store::{LinuxSecretStore, SyncSecretStore},
    sync_cloudflare::{
        LegacySnapshotObservation, LegacySnapshotRead, clear_cloudflare_remote,
        ensure_same_snapshot_observation, normalized_worker_endpoint,
        read_cloudflare_snapshot_envelope, read_cloudflare_snapshot_vault,
        write_cloudflare_snapshot_envelope, write_cloudflare_snapshot_vault,
    },
    sync_gist::{clear_gist_v2, sync_gist_v2},
    sync_incremental_engine::{
        manifest_to_vault, read_incremental_remote_state, upload_incremental_vault,
    },
    sync_incremental_remote::{
        IncrementalHeadRead, ensure_same_incremental_observation, ensure_same_sync_generation,
        read_incremental_head,
    },
    sync_merge::{accept_remote_vault, merge_first_sync_vault},
};
use anyhow::{Result, bail};
use reqwest::redirect::Policy;
use std::{
    sync::{Mutex, OnceLock},
    time::Duration,
};

pub(crate) const SYNC_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
static GIST_PASSPHRASE_CACHE: OnceLock<Mutex<String>> = OnceLock::new();

fn ensure_snapshot_matches_head<T>(
    head: &IncrementalHeadRead,
    snapshot: &LegacySnapshotRead<T>,
) -> Result<()> {
    if let Some(head_generation) = head.generation() {
        ensure_same_sync_generation(head_generation, snapshot.generation())?;
    }
    Ok(())
}

fn remember_gist_passphrase(passphrase: &str) {
    let passphrase = passphrase.trim();
    if passphrase.is_empty() {
        return;
    }
    let cache = GIST_PASSPHRASE_CACHE.get_or_init(|| Mutex::new(String::new()));
    *cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = passphrase.to_owned();
}

fn cached_gist_passphrase() -> String {
    GIST_PASSPHRASE_CACHE
        .get()
        .map(|cache| {
            cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        })
        .unwrap_or_default()
}

pub struct SyncClient {
    http: reqwest::Client,
    crypto: SnapshotCrypto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FirstSyncStrategy {
    Ask,
    UseLocal,
    UseRemote,
    Merge,
}

impl SyncClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(SYNC_REQUEST_TIMEOUT)
                .timeout(SYNC_REQUEST_TIMEOUT)
                .redirect(Policy::none())
                .build()
                .expect("sync HTTP client with timeout budget should build"),
            crypto: SnapshotCrypto::new(),
        }
    }

    async fn revalidate_cloudflare_read(
        &self,
        endpoint: &str,
        token: &str,
        initial_head: Option<&IncrementalHeadRead>,
        initial_snapshot: Option<&LegacySnapshotObservation>,
    ) -> Result<()> {
        if let Some(initial_snapshot) = initial_snapshot {
            let current_snapshot =
                read_cloudflare_snapshot_envelope(&self.http, endpoint, token).await?;
            ensure_same_snapshot_observation(initial_snapshot, &current_snapshot)?;
        }
        if let Some(initial_head) = initial_head {
            let current_head = read_incremental_head(&self.http, endpoint, token).await?;
            ensure_same_incremental_observation(initial_head, &current_head)?;
        }
        Ok(())
    }

    pub async fn sync_cloudflare_vault(
        &self,
        vault: SyncVault,
        passphrase: &str,
        worker_endpoint: &str,
        token: &str,
        first_sync_strategy: FirstSyncStrategy,
        has_completed_sync: bool,
        has_local_user_content: bool,
    ) -> Result<SyncVault> {
        let endpoint = normalized_worker_endpoint(worker_endpoint)?;
        let token = token.trim();

        if token.is_empty() {
            bail!("Cloudflare access key is required.");
        }
        if passphrase.is_empty() {
            bail!("Data encryption password is required.");
        }

        let head = read_incremental_head(&self.http, &endpoint, token).await?;
        if matches!(&head, IncrementalHeadRead::Unsupported) {
            return self
                .sync_cloudflare_snapshot_vault(
                    vault,
                    passphrase,
                    &endpoint,
                    token,
                    first_sync_strategy,
                    has_completed_sync,
                    has_local_user_content,
                )
                .await;
        }
        let generation = head
            .generation()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Cloud sync generation is unavailable."))?;
        let initial_head = head.clone();

        let remote_state = read_incremental_remote_state(
            &self.http,
            &self.crypto,
            &endpoint,
            token,
            passphrase,
            head,
        )
        .await?;
        let (remote_vault, legacy_snapshot) = if let Some(remote) = &remote_state {
            (
                Some(
                    manifest_to_vault(
                        &self.http,
                        &self.crypto,
                        &endpoint,
                        token,
                        passphrase,
                        &remote.manifest,
                    )
                    .await?,
                ),
                None,
            )
        } else {
            let snapshot = read_cloudflare_snapshot_vault(
                &self.http,
                &self.crypto,
                &endpoint,
                token,
                passphrase,
            )
            .await?;
            ensure_same_sync_generation(&generation, snapshot.generation())?;
            let observation = snapshot.observation();
            (snapshot.into_value(), Some(observation))
        };

        let selected = if let Some(remote) = remote_vault {
            if !has_completed_sync {
                match first_sync_strategy {
                    FirstSyncStrategy::UseRemote => {
                        self.revalidate_cloudflare_read(
                            &endpoint,
                            token,
                            Some(&initial_head),
                            legacy_snapshot.as_ref(),
                        )
                        .await?;
                        return Ok(accept_remote_vault(remote, &vault.data));
                    }
                    FirstSyncStrategy::UseLocal => vault,
                    FirstSyncStrategy::Merge => merge_first_sync_vault(remote, vault),
                    FirstSyncStrategy::Ask => {
                        if !has_local_user_content {
                            self.revalidate_cloudflare_read(
                                &endpoint,
                                token,
                                Some(&initial_head),
                                legacy_snapshot.as_ref(),
                            )
                            .await?;
                            return Ok(accept_remote_vault(remote, &vault.data));
                        }

                        bail!(
                            "Local and cloud both have data. Choose local, cloud, or merge before syncing."
                        );
                    }
                }
            } else if remote.data.updated_at > vault.data.updated_at {
                self.revalidate_cloudflare_read(
                    &endpoint,
                    token,
                    Some(&initial_head),
                    legacy_snapshot.as_ref(),
                )
                .await?;
                return Ok(accept_remote_vault(remote, &vault.data));
            } else {
                vault
            }
        } else {
            vault
        };

        upload_incremental_vault(
            &self.http,
            &self.crypto,
            selected,
            passphrase,
            &endpoint,
            token,
            &generation,
            remote_state,
        )
        .await
    }

    pub async fn sync_gist_vault(
        &self,
        vault: SyncVault,
        passphrase: &str,
        gist_id: &str,
        gist_file: &str,
        token: &str,
        first_sync_strategy: FirstSyncStrategy,
        has_completed_sync: bool,
        has_local_user_content: bool,
    ) -> Result<SyncVault> {
        remember_gist_passphrase(passphrase);
        sync_gist_v2(
            &self.http,
            &self.crypto,
            vault,
            passphrase,
            gist_id,
            gist_file,
            token,
            first_sync_strategy,
            has_completed_sync,
            has_local_user_content,
        )
        .await
    }

    pub async fn sync_cloudflare(
        &self,
        envelope: EncryptedSnapshotEnvelope,
        worker_endpoint: &str,
        token: &str,
    ) -> Result<EncryptedSnapshotEnvelope> {
        self.sync_cloudflare_with_strategy(
            envelope,
            worker_endpoint,
            token,
            FirstSyncStrategy::Ask,
            false,
            true,
        )
        .await
    }

    pub async fn sync_cloudflare_with_strategy(
        &self,
        envelope: EncryptedSnapshotEnvelope,
        worker_endpoint: &str,
        token: &str,
        first_sync_strategy: FirstSyncStrategy,
        has_completed_sync: bool,
        has_local_user_content: bool,
    ) -> Result<EncryptedSnapshotEnvelope> {
        let endpoint = normalized_worker_endpoint(worker_endpoint)?;

        if token.trim().is_empty() {
            bail!("Cloudflare access key is required.");
        }

        let token = token.trim();
        let head = read_incremental_head(&self.http, &endpoint, token).await?;
        if matches!(&head, IncrementalHeadRead::Head { .. }) {
            bail!(
                "Cloudflare has incremental sync data. Native sync must use sync_cloudflare_vault to keep Web, Android, iOS, macOS, Windows, and Linux data unified."
            );
        }

        let remote_read = read_cloudflare_snapshot_envelope(&self.http, &endpoint, token).await?;
        ensure_snapshot_matches_head(&head, &remote_read)?;
        let remote_observation = remote_read.observation();
        let write_condition = remote_read.write_condition();
        if let Some(remote) = remote_read.into_value() {
            if remote.kind == "zerochat.encryptedSnapshot" {
                if !has_completed_sync {
                    match first_sync_strategy {
                        FirstSyncStrategy::UseRemote => {
                            self.revalidate_cloudflare_read(
                                &endpoint,
                                token,
                                Some(&head),
                                Some(&remote_observation),
                            )
                            .await?;
                            return Ok(remote);
                        }
                        FirstSyncStrategy::UseLocal | FirstSyncStrategy::Merge => {}
                        FirstSyncStrategy::Ask => {
                            if !has_local_user_content {
                                self.revalidate_cloudflare_read(
                                    &endpoint,
                                    token,
                                    Some(&head),
                                    Some(&remote_observation),
                                )
                                .await?;
                                return Ok(remote);
                            }

                            bail!(
                                "Local and cloud both have data. Choose local, cloud, or merge before syncing."
                            );
                        }
                    }
                }

                if has_completed_sync && remote.updated_at > envelope.updated_at {
                    self.revalidate_cloudflare_read(
                        &endpoint,
                        token,
                        Some(&head),
                        Some(&remote_observation),
                    )
                    .await?;
                    return Ok(remote);
                }
            }
        }

        write_cloudflare_snapshot_envelope(
            &self.http,
            &endpoint,
            token,
            &envelope,
            &write_condition,
        )
        .await?;

        Ok(envelope)
    }

    pub async fn read_cloudflare_snapshot(
        &self,
        worker_endpoint: &str,
        token: &str,
    ) -> Result<Option<EncryptedSnapshotEnvelope>> {
        let endpoint = normalized_worker_endpoint(worker_endpoint)?;

        if token.trim().is_empty() {
            bail!("Cloudflare access key is required.");
        }

        let token = token.trim();
        let head = read_incremental_head(&self.http, &endpoint, token).await?;
        if matches!(&head, IncrementalHeadRead::Head { .. }) {
            bail!(
                "Cloudflare has incremental sync data. Use the current native sync flow so Web, mobile, and desktop stay unified."
            );
        }

        let snapshot = read_cloudflare_snapshot_envelope(&self.http, &endpoint, token).await?;
        ensure_snapshot_matches_head(&head, &snapshot)?;
        let observation = snapshot.observation();
        self.revalidate_cloudflare_read(&endpoint, token, Some(&head), Some(&observation))
            .await?;
        Ok(snapshot.into_value())
    }

    pub async fn write_cloudflare_snapshot(
        &self,
        envelope: &EncryptedSnapshotEnvelope,
        worker_endpoint: &str,
        token: &str,
    ) -> Result<()> {
        let endpoint = normalized_worker_endpoint(worker_endpoint)?;

        if token.trim().is_empty() {
            bail!("Cloudflare access key is required.");
        }

        let head = read_incremental_head(&self.http, &endpoint, token.trim()).await?;
        if matches!(&head, IncrementalHeadRead::Head { .. }) {
            bail!(
                "Cloudflare has incremental sync data. Use the current native sync flow so Web, mobile, and desktop stay unified."
            );
        }

        let remote = read_cloudflare_snapshot_envelope(&self.http, &endpoint, token.trim()).await?;
        ensure_snapshot_matches_head(&head, &remote)?;
        write_cloudflare_snapshot_envelope(
            &self.http,
            &endpoint,
            token.trim(),
            envelope,
            &remote.write_condition(),
        )
        .await
    }

    pub async fn clear_cloudflare(&self, worker_endpoint: &str, token: &str) -> Result<()> {
        clear_cloudflare_remote(&self.http, worker_endpoint, token).await
    }

    pub async fn clear_gist(&self, gist_id: &str, gist_file: &str, token: &str) -> Result<()> {
        let mut passphrase = cached_gist_passphrase();
        if passphrase.is_empty() {
            let secret_store = LinuxSecretStore::load(Vec::new());
            passphrase = secret_store.sync_passphrase()?;
        }
        clear_gist_v2(
            &self.http,
            &self.crypto,
            gist_id,
            gist_file,
            token,
            passphrase.trim(),
        )
        .await
    }

    async fn sync_cloudflare_snapshot_vault(
        &self,
        vault: SyncVault,
        passphrase: &str,
        endpoint: &str,
        token: &str,
        first_sync_strategy: FirstSyncStrategy,
        has_completed_sync: bool,
        has_local_user_content: bool,
    ) -> Result<SyncVault> {
        let remote_read =
            read_cloudflare_snapshot_vault(&self.http, &self.crypto, endpoint, token, passphrase)
                .await?;
        let remote_observation = remote_read.observation();
        let write_condition = remote_read.write_condition();
        let selected = if let Some(remote) = remote_read.into_value() {
            if !has_completed_sync {
                match first_sync_strategy {
                    FirstSyncStrategy::UseRemote => {
                        self.revalidate_cloudflare_read(
                            endpoint,
                            token,
                            None,
                            Some(&remote_observation),
                        )
                        .await?;
                        return Ok(accept_remote_vault(remote, &vault.data));
                    }
                    FirstSyncStrategy::UseLocal => vault,
                    FirstSyncStrategy::Merge => merge_first_sync_vault(remote, vault),
                    FirstSyncStrategy::Ask => {
                        if !has_local_user_content {
                            self.revalidate_cloudflare_read(
                                endpoint,
                                token,
                                None,
                                Some(&remote_observation),
                            )
                            .await?;
                            return Ok(accept_remote_vault(remote, &vault.data));
                        }
                        bail!(
                            "Local and cloud both have data. Choose local, cloud, or merge before syncing."
                        );
                    }
                }
            } else if remote.data.updated_at > vault.data.updated_at {
                self.revalidate_cloudflare_read(endpoint, token, None, Some(&remote_observation))
                    .await?;
                return Ok(accept_remote_vault(remote, &vault.data));
            } else {
                vault
            }
        } else {
            vault
        };

        write_cloudflare_snapshot_vault(
            &self.http,
            &self.crypto,
            endpoint,
            token,
            &selected,
            passphrase,
            &write_condition,
        )
        .await?;

        Ok(selected)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::EnvelopeCrypto;
    use crate::sync_incremental_remote::{is_cloud_sync_conflict, validated_sync_generation};
    use reqwest::header::HeaderValue;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc::{self, Receiver},
        thread,
        time::Duration,
    };

    const FIRST_GENERATION: &str = "00000000-0000-4000-8000-000000000001";
    const SECOND_GENERATION: &str = "00000000-0000-4000-8000-000000000002";

    fn generation(value: &'static str) -> crate::sync_incremental_remote::SyncGeneration {
        let value = HeaderValue::from_static(value);
        validated_sync_generation(Some(&value)).unwrap()
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

    fn serve_sequence(
        responses: Vec<String>,
    ) -> (String, Receiver<Vec<String>>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server should have address");
        let (sender, receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().expect("test request should connect");
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .expect("read timeout should configure");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 4096];
                while !request.windows(4).any(|part| part == b"\r\n\r\n") {
                    let count = stream
                        .read(&mut buffer)
                        .expect("request should be readable");
                    if count == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..count]);
                }
                requests.push(String::from_utf8_lossy(&request).into_owned());
                stream
                    .write_all(response.as_bytes())
                    .expect("response should be writable");
            }
            let _ = sender.send(requests);
        });
        (format!("http://{address}"), receiver, handle)
    }

    #[test]
    fn head_and_legacy_snapshot_generation_mismatch_fails_the_attempt() {
        let head = IncrementalHeadRead::Empty {
            generation: generation(FIRST_GENERATION),
        };
        let snapshot = LegacySnapshotRead::<()>::Missing {
            generation: generation(SECOND_GENERATION),
        };

        let error = ensure_snapshot_matches_head(&head, &snapshot)
            .expect_err("clear generation changes must invalidate the whole sync attempt");
        assert!(is_cloud_sync_conflict(&error));
    }

    #[tokio::test]
    async fn remote_accept_revalidates_snapshot_before_returning_local_publish_data() {
        let snapshot = serde_json::to_string(&envelope()).unwrap();
        let first_etag = format!("\"snapshot-sha256-{}\"", "a".repeat(64));
        let second_etag = format!("\"snapshot-sha256-{}\"", "b".repeat(64));
        let changed_snapshot = response(
            "200 OK",
            &[
                ("ETag", second_etag.as_str()),
                ("x-zerochat-sync-generation", FIRST_GENERATION),
                ("Content-Type", "application/json"),
            ],
            &snapshot,
        );
        let cleared_snapshot = response(
            "404 Not Found",
            &[("x-zerochat-sync-generation", SECOND_GENERATION)],
            "",
        );

        for final_snapshot in [changed_snapshot, cleared_snapshot] {
            let (endpoint, requests, server) = serve_sequence(vec![
                response(
                    "404 Not Found",
                    &[("x-zerochat-sync-generation", FIRST_GENERATION)],
                    "",
                ),
                response(
                    "200 OK",
                    &[
                        ("ETag", first_etag.as_str()),
                        ("x-zerochat-sync-generation", FIRST_GENERATION),
                        ("Content-Type", "application/json"),
                    ],
                    &snapshot,
                ),
                final_snapshot,
            ]);

            let error = SyncClient::new()
                .sync_cloudflare_with_strategy(
                    envelope(),
                    &endpoint,
                    "test-token",
                    FirstSyncStrategy::UseRemote,
                    false,
                    true,
                )
                .await
                .expect_err("changed remote observation must reject stale local publication");
            assert!(is_cloud_sync_conflict(&error));
            let requests = requests.recv_timeout(Duration::from_secs(5)).unwrap();
            assert_eq!(requests.len(), 3);
            assert!(requests[0].starts_with("GET /sync/head HTTP/1.1"));
            assert!(requests[1].starts_with("GET /snapshot HTTP/1.1"));
            assert!(requests[2].starts_with("GET /snapshot HTTP/1.1"));
            assert!(requests.iter().all(|request| !request.starts_with("PUT ")));
            server.join().unwrap();
        }
    }
}
