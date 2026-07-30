use anyhow::{Context, Result, bail};
use futures_util::StreamExt;
use reqwest::Response;
use serde::de::DeserializeOwned;

pub(crate) const MAX_SYNC_SNAPSHOT_BYTES: usize = 900_000;
pub(crate) const MAX_SYNC_INCREMENTAL_OBJECT_BYTES: usize = 5_000_000;
pub(crate) const MAX_SYNC_INCREMENTAL_HEAD_BYTES: usize = 16_384;
pub(crate) const MAX_SYNC_ERROR_BODY_BYTES: usize = 16_384;
pub(crate) const MAX_SYNC_GIST_RESPONSE_BYTES: usize = 5_000_000;

pub(crate) fn ensure_bytes_size(bytes: &[u8], max_bytes: usize, label: &str) -> Result<()> {
    if bytes.len() > max_bytes {
        bail!("{label} exceeded the {max_bytes}-byte safety limit.");
    }
    Ok(())
}

pub(crate) fn ensure_text_size(text: &str, max_bytes: usize, label: &str) -> Result<()> {
    ensure_bytes_size(text.as_bytes(), max_bytes, label)
}

pub(crate) async fn read_bounded_bytes(
    response: Response,
    max_bytes: usize,
    label: &str,
) -> Result<Vec<u8>> {
    if let Some(length) = response.content_length() {
        if length > max_bytes as u64 {
            bail!("{label} exceeded the {max_bytes}-byte safety limit.");
        }
    }

    let capacity = response
        .content_length()
        .unwrap_or(8_192)
        .min(max_bytes as u64) as usize;
    let mut body = Vec::with_capacity(capacity);
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if body.len().saturating_add(chunk.len()) > max_bytes {
            bail!("{label} exceeded the {max_bytes}-byte safety limit.");
        }
        body.extend_from_slice(&chunk);
    }

    Ok(body)
}

pub(crate) async fn read_bounded_text(
    response: Response,
    max_bytes: usize,
    label: &str,
) -> Result<String> {
    String::from_utf8(read_bounded_bytes(response, max_bytes, label).await?)
        .with_context(|| format!("{label} was not valid UTF-8."))
}

pub(crate) async fn read_bounded_json<T: DeserializeOwned>(
    response: Response,
    max_bytes: usize,
    label: &str,
) -> Result<T> {
    Ok(serde_json::from_slice(
        &read_bounded_bytes(response, max_bytes, label).await?,
    )?)
}

pub(crate) async fn drain_bounded_body(response: Response) -> Result<()> {
    let mut total = 0usize;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        total = total.saturating_add(chunk?.len());
        if total > MAX_SYNC_ERROR_BODY_BYTES {
            break;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_size_counts_utf8_bytes() {
        assert!(ensure_text_size("你好", 6, "payload").is_ok());
        assert_eq!(
            ensure_text_size("你好", 5, "payload")
                .expect_err("five bytes must reject two UTF-8 Han characters")
                .to_string(),
            "payload exceeded the 5-byte safety limit."
        );
    }
}
