#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ImageRequestFailure {
    http_status: Option<u16>,
}

impl ImageRequestFailure {
    pub(crate) fn http(status: u16) -> Self {
        Self {
            http_status: Some(status),
        }
    }

    #[cfg(test)]
    fn without_http_status() -> Self {
        Self { http_status: None }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DirectImageFailureAction {
    Stop,
    TryResponsesRoute,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ResponsesImageFailureAction {
    Stop,
    TryNextModel,
}

pub(crate) fn direct_image_failure_action(
    failure: ImageRequestFailure,
) -> DirectImageFailureAction {
    match failure.http_status {
        Some(status) if matches!(status, 404 | 405 | 501) || (500..=599).contains(&status) => {
            DirectImageFailureAction::TryResponsesRoute
        }
        _ => DirectImageFailureAction::Stop,
    }
}

pub(crate) fn responses_image_failure_action(
    failure: ImageRequestFailure,
) -> ResponsesImageFailureAction {
    match failure.http_status {
        Some(400 | 422) => ResponsesImageFailureAction::TryNextModel,
        _ => ResponsesImageFailureAction::Stop,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DirectImageFailureAction, ImageRequestFailure, ResponsesImageFailureAction,
        direct_image_failure_action, responses_image_failure_action,
    };

    const BACKGROUND_SOURCE: &str = include_str!("background.rs");

    #[test]
    fn image_worker_is_single_attempt_while_chat_retry_and_cancellation_remain() {
        assert_eq!(
            BACKGROUND_SOURCE
                .matches("run_ai_image_request_once(&request)")
                .count(),
            1
        );
        assert!(
            BACKGROUND_SOURCE.contains("_ = wait_for_generation_cancellation(&mut cancellation)")
        );
        assert!(
            BACKGROUND_SOURCE.contains("cancel.load(Ordering::SeqCst) || *cancellation.borrow()")
        );
        assert!(BACKGROUND_SOURCE.contains("MAX_CHAT_AUTO_RETRIES"));
        assert!(BACKGROUND_SOURCE.contains("AiChatStreamEvent::Retry"));
    }

    #[test]
    fn direct_image_route_falls_back_only_for_missing_or_broken_routes() {
        for status in [404, 405, 500, 501, 502, 503, 504, 599] {
            assert_eq!(
                direct_image_failure_action(ImageRequestFailure::http(status)),
                DirectImageFailureAction::TryResponsesRoute,
                "HTTP {status} must fall back to the Responses image route"
            );
        }

        for status in [400, 401, 403, 408, 409, 422, 425, 429, 600] {
            assert_eq!(
                direct_image_failure_action(ImageRequestFailure::http(status)),
                DirectImageFailureAction::Stop,
                "HTTP {status} must stop at the direct image route boundary"
            );
        }
    }

    #[test]
    fn responses_image_candidates_continue_only_for_model_shape_rejections() {
        for status in [400, 422] {
            assert_eq!(
                responses_image_failure_action(ImageRequestFailure::http(status)),
                ResponsesImageFailureAction::TryNextModel,
                "HTTP {status} may select the next Responses image model"
            );
        }

        for status in [
            401, 403, 404, 405, 408, 409, 425, 429, 500, 501, 502, 503, 504, 599, 600,
        ] {
            assert_eq!(
                responses_image_failure_action(ImageRequestFailure::http(status)),
                ResponsesImageFailureAction::Stop,
                "HTTP {status} must stop Responses image model selection"
            );
        }
    }

    #[test]
    fn failure_without_typed_http_status_never_selects_another_route_or_model() {
        for failure_kind in [
            "network",
            "timeout",
            "cancellation",
            "response read",
            "response parse",
            "materialization",
        ] {
            let failure = ImageRequestFailure::without_http_status();
            assert_eq!(
                direct_image_failure_action(failure),
                DirectImageFailureAction::Stop,
                "{failure_kind} failure must stop direct route selection"
            );
            assert_eq!(
                responses_image_failure_action(failure),
                ResponsesImageFailureAction::Stop,
                "{failure_kind} failure must stop Responses model selection"
            );
        }
    }
}
