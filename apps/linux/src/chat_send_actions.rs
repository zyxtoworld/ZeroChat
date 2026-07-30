use crate::{
    ImageTaskMode, LinuxAppState,
    background::{
        AiChatStreamEvent, AiImageRequestEvent, poll_ai_image_request, poll_background_result,
        poll_chat_stream, spawn_ai_chat_stream_request, spawn_ai_image_request,
    },
    chat_image_controls::ImageComposerControls,
    chat_mode_controls::ComposeMode,
    i18n::{localize_ai_error, replace_placeholders, tr},
    media::generated_image_attachment,
    messages::{message_display_text, message_row, message_row_with_body},
    set_window_content,
};
use gtk::prelude::*;
use std::{
    cell::RefCell,
    mpsc,
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use tokio::sync::watch;

pub(crate) struct ActiveChatStream {
    assistant_message_id: String,
    body: Option<gtk::Label>,
    generating_content: String,
    cancel: Arc<AtomicBool>,
    cancellation: watch::Sender<bool>,
}

impl ActiveChatStream {
    pub(crate) fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        let _ = self.cancellation.send(true);
    }

    pub(crate) fn cancel_after_surface_detached(
        self,
        state: &LinuxAppState,
        stopped_content: &str,
    ) {
        self.request_cancel();
        let visible_content = self
            .body
            .as_ref()
            .map(|body| body.text().to_string())
            .unwrap_or_default();
        state.stop_streaming_assistant_message(
            &self.assistant_message_id,
            &visible_content,
            &self.generating_content,
            stopped_content,
        );
    }
}

fn take_active_stream_if_matches(
    active: &mut Option<ActiveChatStream>,
    assistant_message_id: &str,
) -> Option<ActiveChatStream> {
    if active
        .as_ref()
        .is_some_and(|stream| stream.assistant_message_id == assistant_message_id)
    {
        active.take()
    } else {
        None
    }
}

fn set_notice_info(notice: &gtk::Label, message: &str) {
    notice.remove_css_class("warning");
    notice.set_text(message);
}

fn set_notice_warning(notice: &gtk::Label, message: &str) {
    notice.add_css_class("warning");
    notice.set_text(message);
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn connect_send_action(
    send: &gtk::Button,
    messages: &gtk::ListBox,
    input: &gtk::TextView,
    notice: &gtk::Label,
    locale: &str,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    compose_mode: Rc<RefCell<ComposeMode>>,
    image_task_mode: Rc<RefCell<ImageTaskMode>>,
    image_controls: ImageComposerControls,
    chat_streaming: Rc<RefCell<Option<ActiveChatStream>>>,
    refresh_controls: Rc<dyn Fn()>,
) {
    let messages_for_send = messages.clone();
    let input_for_send = input.clone();
    let notice_for_send = notice.clone();
    let locale_for_send = locale.to_owned();
    let compact_for_send = compact;
    let window_for_send = window.clone();
    let state_for_send = state;
    let compose_mode_for_send = compose_mode;
    let image_task_mode_for_send = image_task_mode;
    let image_controls_for_send = image_controls;
    let chat_streaming_for_send = chat_streaming;
    let refresh_controls_for_send = refresh_controls;

    send.connect_clicked(move |_| {
        if let Some(active) = chat_streaming_for_send.borrow_mut().take() {
            active.request_cancel();
            let content = state_for_send
                .stop_streaming_assistant_message(
                    &active.assistant_message_id,
                    active
                        .body
                        .as_ref()
                        .map(|body| body.text().to_string())
                        .unwrap_or_default()
                        .as_str(),
                    &active.generating_content,
                    tr(&locale_for_send, "message.generationStopped"),
                )
                .unwrap_or_else(|| tr(&locale_for_send, "message.generationStopped").to_owned());
            if let Some(body) = active.body {
                body.set_text(&content);
            } else {
                set_window_content(&window_for_send, state_for_send.clone(), "chat");
            }
            refresh_controls_for_send();
            set_notice_info(
                &notice_for_send,
                tr(&locale_for_send, "message.generationStopped"),
            );
            return;
        }

        let buffer = input_for_send.buffer();
        let text = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), true)
            .trim()
            .to_owned();

        if *compose_mode_for_send.borrow() == ComposeMode::Image {
            let (user_message, assistant_message, request) = match state_for_send
                .append_pending_image_turn(
                    text.clone(),
                    *image_task_mode_for_send.borrow(),
                    image_controls_for_send.source_upload.borrow().clone(),
                    image_controls_for_send.mask_upload.borrow().clone(),
                    &locale_for_send,
                ) {
                Ok(result) => result,
                Err(message) => {
                    set_notice_warning(&notice_for_send, &message);
                    return;
                }
            };
            messages_for_send.append(&message_row(
                tr(&locale_for_send, "role.user"),
                &user_message.content,
                &user_message.attachments,
                true,
                false,
                false,
                Some(user_message.id),
                Some(state_for_send.clone()),
                Some(window_for_send.clone()),
                Some(notice_for_send.clone()),
                &locale_for_send,
                compact_for_send,
            ));
            let assistant_message_id = assistant_message.id.clone();
            messages_for_send.append(&message_row(
                "AI",
                &assistant_message.content,
                &assistant_message.attachments,
                false,
                false,
                true,
                Some(assistant_message.id),
                Some(state_for_send.clone()),
                Some(window_for_send.clone()),
                Some(notice_for_send.clone()),
                &locale_for_send,
                compact_for_send,
            ));
            buffer.set_text("");
            image_controls_for_send.clear_uploads(&locale_for_send);
            refresh_controls_for_send();
            set_notice_info(
                &notice_for_send,
                tr(&locale_for_send, "message.generatingImage"),
            );
            let prompt_for_result = request.prompt.clone();
            let model_for_result = request.model.clone();
            let (sender, receiver) = mpsc::channel();
            let image_cancel = Arc::new(AtomicBool::new(false));
            let (image_cancellation, image_cancellation_receiver) = watch::channel(false);
            *chat_streaming_for_send.borrow_mut() = Some(ActiveChatStream {
                assistant_message_id: assistant_message_id.clone(),
                body: None,
                generating_content: tr(&locale_for_send, "message.generatingImage").to_owned(),
                cancel: image_cancel.clone(),
                cancellation: image_cancellation,
            });
            refresh_controls_for_send();
            spawn_ai_image_request(request, sender, image_cancel, image_cancellation_receiver);
            let state_for_result = state_for_send.clone();
            let window_for_result = window_for_send.clone();
            let locale_for_result = locale_for_send.clone();
            let notice_for_result = notice_for_send.clone();
            let chat_streaming_for_result = chat_streaming_for_send.clone();
            let refresh_controls_for_result = refresh_controls_for_send.clone();
            poll_ai_image_request(receiver, move |event| match event {
                AiImageRequestEvent::Done(result) => {
                    if take_active_stream_if_matches(
                        &mut chat_streaming_for_result.borrow_mut(),
                        &assistant_message_id,
                    )
                    .is_none()
                    {
                        return;
                    }
                    refresh_controls_for_result();

                    let (content, attachment, error) = match result {
                        Ok(image) => {
                            let content = image
                                .revised_prompt
                                .as_deref()
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .unwrap_or(prompt_for_result.as_str())
                                .to_owned();
                            let attachment = generated_image_attachment(
                                image,
                                &prompt_for_result,
                                &model_for_result,
                            );
                            (content, Some(attachment), None)
                        }
                        Err(message) => {
                            let message = localize_ai_error(&locale_for_result, &message);
                            let failure = tr(&locale_for_result, "message.imageRequestFailed");
                            let content = if message == failure {
                                failure.to_owned()
                            } else {
                                format!("{failure}: {message}")
                            };
                            (content.clone(), None, Some(content))
                        }
                    };

                    state_for_result.complete_assistant_image_message(
                        &assistant_message_id,
                        content,
                        attachment,
                        error,
                    );
                    set_window_content(&window_for_result, state_for_result.clone(), "chat");
                }
            });
            return;
        }

        if text.is_empty() {
            set_notice_warning(&notice_for_send, tr(&locale_for_send, "message.emptyInput"));
            return;
        }

        let (user_message, assistant_message, request) =
            match state_for_send.append_pending_chat_turn(text.clone(), &locale_for_send) {
                Ok(result) => result,
                Err(message) => {
                    set_notice_warning(&notice_for_send, &message);
                    return;
                }
            };
        messages_for_send.append(&message_row(
            tr(&locale_for_send, "role.user"),
            &user_message.content,
            &user_message.attachments,
            true,
            false,
            false,
            Some(user_message.id),
            Some(state_for_send.clone()),
            Some(window_for_send.clone()),
            Some(notice_for_send.clone()),
            &locale_for_send,
            compact_for_send,
        ));
        let assistant_message_id = assistant_message.id.clone();
        let assistant_display = message_display_text(&locale_for_send, &assistant_message);
        let (assistant_row, assistant_body) = message_row_with_body(
            "AI",
            &assistant_display,
            &assistant_message.attachments,
            false,
            false,
            true,
            Some(assistant_message.id),
            Some(state_for_send.clone()),
            Some(window_for_send.clone()),
            Some(notice_for_send.clone()),
            &locale_for_send,
            compact_for_send,
        );
        messages_for_send.append(&assistant_row);
        buffer.set_text("");
        set_notice_info(&notice_for_send, tr(&locale_for_send, "message.generating"));
        let (sender, receiver) = mpsc::channel();
        let stream_cancel = Arc::new(AtomicBool::new(false));
        let (cancellation, cancellation_receiver) = watch::channel(false);
        *chat_streaming_for_send.borrow_mut() = Some(ActiveChatStream {
            assistant_message_id: assistant_message_id.clone(),
            body: Some(assistant_body.clone()),
            generating_content: tr(&locale_for_send, "message.generating").to_owned(),
            cancel: stream_cancel.clone(),
            cancellation,
        });
        refresh_controls_for_send();
        spawn_ai_chat_stream_request(request, sender, stream_cancel, cancellation_receiver);
        let state_for_result = state_for_send.clone();
        let window_for_result = window_for_send.clone();
        let locale_for_result = locale_for_send.clone();
        let notice_for_result = notice_for_send.clone();
        let chat_streaming_for_result = chat_streaming_for_send.clone();
        let refresh_controls_for_result = refresh_controls_for_send.clone();
        poll_chat_stream(receiver, move |event| match event {
            AiChatStreamEvent::Delta(content) => {
                let is_active = chat_streaming_for_result
                    .borrow()
                    .as_ref()
                    .is_some_and(|active| active.assistant_message_id == assistant_message_id);
                if !is_active {
                    return;
                }

                state_for_result
                    .update_streaming_assistant_message(&assistant_message_id, content.clone());
                let visible = if content.trim().is_empty() {
                    format!("{}|", tr(&locale_for_result, "message.generating"))
                } else {
                    format!("{content}|")
                };
                assistant_body.set_text(&visible);
            }
            AiChatStreamEvent::Retry { attempt, total } => {
                let is_active = chat_streaming_for_result
                    .borrow()
                    .as_ref()
                    .is_some_and(|active| active.assistant_message_id == assistant_message_id);
                if !is_active {
                    return;
                }

                let attempt = attempt.to_string();
                let total = total.to_string();
                let message = replace_placeholders(
                    tr(&locale_for_result, "notice.networkRetrying"),
                    &[("{attempt}", &attempt), ("{total}", &total)],
                );
                set_notice_warning(&notice_for_result, &message);
            }
            AiChatStreamEvent::Done(result) => {
                if take_active_stream_if_matches(
                    &mut chat_streaming_for_result.borrow_mut(),
                    &assistant_message_id,
                )
                .is_none()
                {
                    return;
                }
                refresh_controls_for_result();
                let (content, error) = match result {
                    Ok(content) => {
                        let trimmed = content.trim().to_owned();
                        if trimmed.is_empty() {
                            let message =
                                tr(&locale_for_result, "message.providerEmptyResponse").to_owned();
                            (message.clone(), Some(message))
                        } else {
                            (trimmed, None)
                        }
                    }
                    Err(message) => {
                        let message = localize_ai_error(&locale_for_result, &message);
                        let content = replace_placeholders(
                            tr(&locale_for_result, "message.generationFailed"),
                            &[("{message}", &message)],
                        );
                        (content.clone(), Some(content))
                    }
                };

                state_for_result.complete_assistant_message(&assistant_message_id, content, error);
                set_window_content(&window_for_result, state_for_result.clone(), "chat");
            }
        });
    });
}

pub(crate) fn text_view_text(input: &gtk::TextView) -> String {
    let buffer = input.buffer();
    buffer
        .text(&buffer.start_iter(), &buffer.end_iter(), true)
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::{ActiveChatStream, take_active_stream_if_matches};
    use std::sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    };
    use tokio::sync::watch;

    fn active_stream(assistant_message_id: &str) -> ActiveChatStream {
        let (cancellation, _) = watch::channel(false);
        ActiveChatStream {
            assistant_message_id: assistant_message_id.to_owned(),
            body: None,
            generating_content: "Generating...".to_owned(),
            cancel: Arc::new(AtomicBool::new(false)),
            cancellation,
        }
    }

    #[test]
    fn stale_done_cannot_take_replacement_stream_after_stop_and_resend() {
        let mut active = Some(active_stream("assistant-a"));
        let _stopped = active.take().expect("request A should stop");
        active = Some(active_stream("assistant-b"));

        assert!(take_active_stream_if_matches(&mut active, "assistant-a").is_none());
        assert_eq!(
            active
                .as_ref()
                .map(|stream| stream.assistant_message_id.as_str()),
            Some("assistant-b")
        );

        let completed = take_active_stream_if_matches(&mut active, "assistant-b")
            .expect("request B should retain completion ownership");
        assert_eq!(completed.assistant_message_id, "assistant-b");
        assert!(active.is_none());
    }

    #[test]
    fn cancel_signals_both_retry_loop_and_in_flight_network_waiter() {
        let stream = active_stream("assistant-a");
        let mut cancellation = stream.cancellation.subscribe();

        stream.request_cancel();

        assert!(stream.cancel.load(Ordering::SeqCst));
        assert!(*cancellation.borrow_and_update());
    }
}
