use crate::{
    STREAMING_UI_FRAME_MS,
    ai::{AiClient, AiHttpFailure, AiTimeoutFailure, GeneratedImage, ImageUpload},
    chat_retry_policy::{ChatRequestFailureKind, should_retry_chat_request},
    models::{ChatMessage, ProviderConfig},
    sync::SyncClient,
};
use gtk::glib;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant},
};
use tokio::sync::watch;

pub(crate) const MAX_CHAT_AUTO_RETRIES: u8 = 3;
const CHAT_AUTO_RETRY_DELAYS_MS: [u64; 3] = [400, 900, 1_600];

#[derive(Clone)]
pub(crate) struct AiChatRequest {
    pub(crate) provider: ProviderConfig,
    pub(crate) api_key: String,
    pub(crate) access_key: String,
    pub(crate) model: String,
    pub(crate) messages: Vec<ChatMessage>,
    pub(crate) context_message_limit: i32,
}

pub(crate) enum AiChatStreamEvent {
    Delta(String),
    Retry { attempt: u8, total: u8 },
    Done(Result<String, String>),
}

pub(crate) fn chat_auto_retry_delay_ms(retry_index: usize) -> u64 {
    CHAT_AUTO_RETRY_DELAYS_MS
        .get(retry_index)
        .copied()
        .unwrap_or(*CHAT_AUTO_RETRY_DELAYS_MS.last().unwrap_or(&1_600))
}

fn chat_request_failure(error: &anyhow::Error) -> ChatRequestFailureKind {
    for cause in error.chain() {
        if let Some(failure) = cause.downcast_ref::<AiHttpFailure>() {
            return ChatRequestFailureKind::Http(failure.status());
        }
        if cause.downcast_ref::<AiTimeoutFailure>().is_some() {
            return ChatRequestFailureKind::Timeout;
        }
        if let Some(failure) = cause.downcast_ref::<reqwest::Error>()
            && (failure.is_timeout() || failure.is_connect() || failure.is_body())
        {
            return ChatRequestFailureKind::Transport;
        }
        if cause.downcast_ref::<std::io::Error>().is_some() {
            return ChatRequestFailureKind::Transport;
        }
    }

    ChatRequestFailureKind::Other
}

async fn wait_for_chat_retry(delay_ms: u64, cancel: &AtomicBool) -> bool {
    let mut waited_ms = 0;

    while waited_ms < delay_ms {
        if cancel.load(Ordering::SeqCst) {
            return false;
        }

        let step = 50.min(delay_ms - waited_ms);
        tokio::time::sleep(Duration::from_millis(step)).await;
        waited_ms += step;
    }

    !cancel.load(Ordering::SeqCst)
}

async fn wait_for_generation_cancellation(cancellation: &mut watch::Receiver<bool>) {
    if *cancellation.borrow() {
        return;
    }

    let _ = cancellation.changed().await;
}

pub(crate) struct AiImageRequest {
    pub(crate) provider: ProviderConfig,
    pub(crate) api_key: String,
    pub(crate) access_key: String,
    pub(crate) model: String,
    pub(crate) responses_model: String,
    pub(crate) prompt: String,
    pub(crate) kind: AiImageRequestKind,
}

pub(crate) enum AiImageRequestKind {
    Generate,
    Edit {
        source: ImageUpload,
    },
    Inpaint {
        source: ImageUpload,
        mask: ImageUpload,
    },
}

pub(crate) enum AiImageRequestEvent {
    Done(Result<GeneratedImage, String>),
}

pub(crate) struct AiSpeechRequest {
    pub(crate) provider: ProviderConfig,
    pub(crate) api_key: String,
    pub(crate) access_key: String,
    pub(crate) model: String,
    pub(crate) input: String,
}

pub(crate) fn spawn_ai_chat_request(
    request: AiChatRequest,
    sender: mpsc::Sender<Result<String, String>>,
) {
    thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(async {
                        AiClient::new()
                            .send(
                                &request.provider,
                                &request.api_key,
                                &request.model,
                                &request.messages,
                                request.context_message_limit,
                                &request.access_key,
                            )
                            .await
                    })
                    .map_err(|error| error.to_string())
            });
        let _ = sender.send(result);
    });
}

pub(crate) fn spawn_ai_chat_stream_request(
    request: AiChatRequest,
    sender: mpsc::Sender<AiChatStreamEvent>,
    cancel: Arc<AtomicBool>,
    cancellation: watch::Receiver<bool>,
) {
    thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(async {
                        let mut retry_index = 0usize;

                        loop {
                            if cancel.load(Ordering::SeqCst) {
                                return Err(anyhow::anyhow!("Generation stopped"));
                            }

                            let sender_for_delta = sender.clone();
                            let cancel_for_delta = cancel.clone();
                            let partial_seen = Arc::new(AtomicBool::new(false));
                            let partial_seen_for_delta = partial_seen.clone();
                            let mut last_emit = Instant::now()
                                .checked_sub(Duration::from_millis(STREAMING_UI_FRAME_MS))
                                .unwrap_or_else(Instant::now);

                            let result = AiClient::new()
                                .stream(
                                    &request.provider,
                                    &request.api_key,
                                    &request.model,
                                    &request.messages,
                                    request.context_message_limit,
                                    &request.access_key,
                                    cancellation.clone(),
                                    |partial| {
                                        if cancel_for_delta.load(Ordering::SeqCst) {
                                            return false;
                                        }

                                        partial_seen_for_delta.store(true, Ordering::SeqCst);
                                        if last_emit.elapsed()
                                            >= Duration::from_millis(STREAMING_UI_FRAME_MS)
                                        {
                                            last_emit = Instant::now();
                                            let _ = sender_for_delta
                                                .send(AiChatStreamEvent::Delta(partial));
                                        }

                                        !cancel_for_delta.load(Ordering::SeqCst)
                                    },
                                )
                                .await;

                            match result {
                                Ok(content) => return Ok(content),
                                Err(error) => {
                                    let partial_seen = partial_seen.load(Ordering::SeqCst);
                                    if cancel.load(Ordering::SeqCst)
                                        || retry_index >= usize::from(MAX_CHAT_AUTO_RETRIES)
                                        || !should_retry_chat_request(
                                            chat_request_failure(&error),
                                            partial_seen,
                                        )
                                    {
                                        return Err(error);
                                    }

                                    retry_index += 1;
                                    let _ = sender.send(AiChatStreamEvent::Retry {
                                        attempt: retry_index as u8,
                                        total: MAX_CHAT_AUTO_RETRIES,
                                    });

                                    if !wait_for_chat_retry(
                                        chat_auto_retry_delay_ms(retry_index - 1),
                                        &cancel,
                                    )
                                    .await
                                    {
                                        return Err(anyhow::anyhow!("Generation stopped"));
                                    }
                                }
                            }
                        }
                    })
                    .map_err(|error| error.to_string())
            });

        let _ = sender.send(AiChatStreamEvent::Done(result));
    });
}

pub(crate) fn spawn_ai_image_request(
    request: AiImageRequest,
    sender: mpsc::Sender<AiImageRequestEvent>,
    cancel: Arc<AtomicBool>,
    mut cancellation: watch::Receiver<bool>,
) {
    thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(async {
                        if cancel.load(Ordering::SeqCst) || *cancellation.borrow() {
                            return Err(anyhow::anyhow!("Generation stopped"));
                        }

                        tokio::select! {
                            _ = wait_for_generation_cancellation(&mut cancellation) => {
                                Err(anyhow::anyhow!("Generation stopped"))
                            }
                            result = run_ai_image_request_once(&request) => result,
                        }
                    })
                    .map_err(|error| error.to_string())
            });
        let _ = sender.send(AiImageRequestEvent::Done(result));
    });
}

pub(crate) fn spawn_ai_speech_request(
    request: AiSpeechRequest,
    sender: mpsc::Sender<Result<Vec<u8>, String>>,
) {
    thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(async {
                        AiClient::new()
                            .create_speech(
                                &request.provider,
                                &request.api_key,
                                &request.access_key,
                                &request.model,
                                &request.input,
                                Some("alloy"),
                                Some("mp3"),
                                None,
                            )
                            .await
                    })
                    .map_err(|error| error.to_string())
            });
        let _ = sender.send(result);
    });
}

async fn run_ai_image_request_once(request: &AiImageRequest) -> anyhow::Result<GeneratedImage> {
    match &request.kind {
        AiImageRequestKind::Generate => {
            AiClient::new()
                .generate_image(
                    &request.provider,
                    &request.api_key,
                    &request.access_key,
                    &request.model,
                    Some(&request.responses_model),
                    &request.prompt,
                    None,
                )
                .await
        }
        AiImageRequestKind::Edit { source } => {
            AiClient::new()
                .edit_image(
                    &request.provider,
                    &request.api_key,
                    &request.access_key,
                    &request.model,
                    Some(&request.responses_model),
                    &request.prompt,
                    source.clone(),
                    None,
                    None,
                )
                .await
        }
        AiImageRequestKind::Inpaint { source, mask } => {
            AiClient::new()
                .edit_image(
                    &request.provider,
                    &request.api_key,
                    &request.access_key,
                    &request.model,
                    Some(&request.responses_model),
                    &request.prompt,
                    source.clone(),
                    Some(mask.clone()),
                    None,
                )
                .await
        }
    }
}

pub(crate) fn spawn_model_list_request(
    provider: ProviderConfig,
    api_key: String,
    access_key: String,
    sender: mpsc::Sender<Result<Vec<String>, String>>,
) {
    thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(async {
                        AiClient::new()
                            .list_models(&provider, &api_key, &access_key)
                            .await
                    })
                    .map_err(|error| error.to_string())
            });
        let _ = sender.send(result);
    });
}

pub(crate) fn spawn_cloudflare_clear_request(
    worker_endpoint: String,
    token: String,
    sender: mpsc::Sender<Result<(), String>>,
) {
    thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(async {
                        SyncClient::new()
                            .clear_cloudflare(&worker_endpoint, &token)
                            .await
                    })
                    .map_err(|error| error.to_string())
            });
        let _ = sender.send(result);
    });
}

pub(crate) fn spawn_gist_clear_request(
    gist_id: String,
    gist_file: String,
    token: String,
    sender: mpsc::Sender<Result<(), String>>,
) {
    thread::spawn(move || {
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(async {
                        SyncClient::new()
                            .clear_gist(&gist_id, &gist_file, &token)
                            .await
                    })
                    .map_err(|error| error.to_string())
            });
        let _ = sender.send(result);
    });
}

pub(crate) fn poll_background_result<T: 'static>(
    receiver: mpsc::Receiver<T>,
    mut on_result: impl FnMut(T) + 'static,
) {
    glib::timeout_add_local(Duration::from_millis(80), move || {
        match receiver.try_recv() {
            Ok(result) => {
                on_result(result);
                glib::ControlFlow::Break
            }
            Err(mpsc::TryRecvError::Empty) => glib::ControlFlow::Continue,
            Err(mpsc::TryRecvError::Disconnected) => glib::ControlFlow::Break,
        }
    });
}

pub(crate) fn poll_chat_stream(
    receiver: mpsc::Receiver<AiChatStreamEvent>,
    mut on_event: impl FnMut(AiChatStreamEvent) + 'static,
) {
    glib::timeout_add_local(Duration::from_millis(STREAMING_UI_FRAME_MS), move || {
        loop {
            match receiver.try_recv() {
                Ok(AiChatStreamEvent::Delta(content)) => {
                    on_event(AiChatStreamEvent::Delta(content));
                }
                Ok(retry @ AiChatStreamEvent::Retry { .. }) => {
                    on_event(retry);
                }
                Ok(done @ AiChatStreamEvent::Done(_)) => {
                    on_event(done);
                    return glib::ControlFlow::Break;
                }
                Err(mpsc::TryRecvError::Empty) => return glib::ControlFlow::Continue,
                Err(mpsc::TryRecvError::Disconnected) => return glib::ControlFlow::Break,
            }
        }
    });
}

pub(crate) fn poll_ai_image_request(
    receiver: mpsc::Receiver<AiImageRequestEvent>,
    mut on_event: impl FnMut(AiImageRequestEvent) + 'static,
) {
    glib::timeout_add_local(Duration::from_millis(80), move || {
        loop {
            match receiver.try_recv() {
                Ok(done @ AiImageRequestEvent::Done(_)) => {
                    on_event(done);
                    return glib::ControlFlow::Break;
                }
                Err(mpsc::TryRecvError::Empty) => return glib::ControlFlow::Continue,
                Err(mpsc::TryRecvError::Disconnected) => return glib::ControlFlow::Break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        AiImageRequestEvent, MAX_CHAT_AUTO_RETRIES, chat_auto_retry_delay_ms, chat_request_failure,
    };
    use crate::{
        ai::{AiHttpFailure, AiTimeoutFailure},
        chat_retry_policy::ChatRequestFailureKind,
    };

    #[test]
    fn chat_retry_budget_matches_web_generation_retry_budget() {
        assert_eq!(MAX_CHAT_AUTO_RETRIES, 3);
        assert_eq!(chat_auto_retry_delay_ms(0), 400);
        assert_eq!(chat_auto_retry_delay_ms(1), 900);
        assert_eq!(chat_auto_retry_delay_ms(2), 1_600);
        assert_eq!(chat_auto_retry_delay_ms(99), 1_600);
    }

    #[test]
    fn retry_classifier_uses_error_types_instead_of_rendered_text() {
        let http: anyhow::Error =
            AiHttpFailure::new(503, "opaque provider failure".to_owned()).into();
        let timeout: anyhow::Error = AiTimeoutFailure::new("opaque timeout").into();
        let transport = anyhow::Error::new(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "opaque transport failure",
        ));
        let misleading = anyhow::anyhow!("AI request failed: HTTP 503; network timeout");

        assert_eq!(
            chat_request_failure(&http),
            ChatRequestFailureKind::Http(503)
        );
        assert_eq!(
            chat_request_failure(&timeout),
            ChatRequestFailureKind::Timeout
        );
        assert_eq!(
            chat_request_failure(&transport),
            ChatRequestFailureKind::Transport
        );
        assert_eq!(
            chat_request_failure(&misleading),
            ChatRequestFailureKind::Other
        );
    }

    #[test]
    fn image_request_event_contract_has_no_retry_state() {
        let AiImageRequestEvent::Done(result) =
            AiImageRequestEvent::Done(Err("request failed".to_owned()));
        assert_eq!(
            result.expect_err("the event should retain the failure"),
            "request failed"
        );
    }
}
