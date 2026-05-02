use crate::models::EncryptedSnapshotEnvelope;
use anyhow::Result;

pub struct SyncClient {
    http: reqwest::Client,
}

impl SyncClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    pub async fn sync_cloudflare(
        &self,
        envelope: EncryptedSnapshotEnvelope,
        worker_endpoint: &str,
        token: &str,
    ) -> Result<EncryptedSnapshotEnvelope> {
        let endpoint = worker_endpoint.trim_end_matches('/').to_owned() + "/snapshot";

        let read = self.http.get(&endpoint).bearer_auth(token).send().await?;
        if read.status().is_success() {
            let remote = read.json::<EncryptedSnapshotEnvelope>().await?;
            if remote.kind == "zerochat.encryptedSnapshot"
                && remote.updated_at > envelope.updated_at
            {
                return Ok(remote);
            }
        }

        self.http
            .put(&endpoint)
            .bearer_auth(token)
            .json(&envelope)
            .send()
            .await?
            .error_for_status()?;

        Ok(envelope)
    }
}
