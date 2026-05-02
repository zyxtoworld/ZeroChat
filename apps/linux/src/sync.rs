use crate::models::EncryptedSnapshotEnvelope;
use anyhow::{Result, bail};
use reqwest::Url;

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
        let endpoint = normalized_worker_endpoint(worker_endpoint)? + "/snapshot";

        if token.trim().is_empty() {
            bail!("同步访问密钥为空");
        }

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

fn normalized_worker_endpoint(value: &str) -> Result<String> {
    let endpoint = value.trim().trim_end_matches('/');

    if endpoint.is_empty() {
        bail!("Cloudflare Worker 地址为空");
    }

    let url = Url::parse(endpoint)?;
    let host = url.host_str().unwrap_or_default();
    let is_loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    let is_safe_scheme = url.scheme() == "https" || (url.scheme() == "http" && is_loopback);

    if !url.username().is_empty() || url.password().is_some() {
        bail!("Cloudflare Worker 地址不能包含用户名或密码");
    }

    if url.query().is_some() || url.fragment().is_some() {
        bail!("Cloudflare Worker 地址不能包含 query 或 fragment");
    }

    if !is_safe_scheme {
        bail!("Cloudflare Worker 地址必须使用 HTTPS，本机调试地址除外");
    }

    Ok(endpoint.to_owned())
}
