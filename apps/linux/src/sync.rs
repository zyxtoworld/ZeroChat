use crate::models::AppSnapshot;
use anyhow::{Context, Result};

pub struct SyncClient {
    http: reqwest::Client,
}

impl SyncClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
        }
    }

    pub async fn sync_cloudflare(&self, snapshot: AppSnapshot, token: &str) -> Result<AppSnapshot> {
        let endpoint = snapshot
            .sync
            .worker_endpoint
            .as_ref()
            .context("Cloudflare Worker 地址为空")?
            .trim_end_matches('/')
            .to_owned()
            + "/snapshot";

        let read = self.http.get(&endpoint).bearer_auth(token).send().await?;
        if read.status().is_success() {
            let remote = read.json::<AppSnapshot>().await?;
            if remote.updated_at > snapshot.updated_at {
                return Ok(remote);
            }
        }

        self.http
            .put(&endpoint)
            .bearer_auth(token)
            .json(&snapshot)
            .send()
            .await?
            .error_for_status()?;

        Ok(snapshot)
    }
}
