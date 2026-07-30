#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ChatRequestFailureKind {
    Http(u16),
    Timeout,
    Transport,
    Other,
}

pub(crate) fn should_retry_chat_request(
    failure: ChatRequestFailureKind,
    partial_seen: bool,
) -> bool {
    if partial_seen {
        return false;
    }

    match failure {
        ChatRequestFailureKind::Http(status) => {
            matches!(status, 408 | 409 | 425 | 429 | 500 | 502 | 503 | 504)
        }
        ChatRequestFailureKind::Timeout | ChatRequestFailureKind::Transport => true,
        ChatRequestFailureKind::Other => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{ChatRequestFailureKind, should_retry_chat_request};

    #[test]
    fn retryable_http_statuses_are_exact_and_bounded() {
        for status in [408, 409, 425, 429, 500, 502, 503, 504] {
            assert!(
                should_retry_chat_request(ChatRequestFailureKind::Http(status), false),
                "HTTP {status} should be retryable before partial output"
            );
        }

        for status in [400, 401, 403, 404, 405, 422, 501, 505, 599, 600] {
            assert!(
                !should_retry_chat_request(ChatRequestFailureKind::Http(status), false),
                "HTTP {status} must stop automatic chat retry"
            );
        }
    }

    #[test]
    fn typed_timeout_and_transport_failures_retry_before_partial_output() {
        assert!(should_retry_chat_request(
            ChatRequestFailureKind::Timeout,
            false
        ));
        assert!(should_retry_chat_request(
            ChatRequestFailureKind::Transport,
            false
        ));
        assert!(!should_retry_chat_request(
            ChatRequestFailureKind::Other,
            false
        ));
    }

    #[test]
    fn partial_output_disables_every_automatic_retry() {
        for failure in [
            ChatRequestFailureKind::Http(503),
            ChatRequestFailureKind::Timeout,
            ChatRequestFailureKind::Transport,
            ChatRequestFailureKind::Other,
        ] {
            assert!(!should_retry_chat_request(failure, true));
        }
    }
}
