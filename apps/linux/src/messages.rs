use crate::{
    LinuxAppState,
    i18n::tr,
    message_actions::attach_message_context_menu,
    message_attachments::message_attachments,
    models::{ChatMessage, MessageAttachment, MessageRole},
    ui_helpers::{edge_margin, row_spacing},
};
use gtk::prelude::*;

pub(crate) fn message_row_with_body(
    author: &str,
    text: &str,
    attachments: &[MessageAttachment],
    is_user: bool,
    is_error: bool,
    is_streaming: bool,
    message_id: Option<String>,
    state: Option<LinuxAppState>,
    window: Option<adw::ApplicationWindow>,
    notice: Option<gtk::Label>,
    locale: &str,
    compact: bool,
) -> (gtk::ListBoxRow, gtk::Label) {
    let row = gtk::ListBoxRow::new();
    let outer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    outer.set_margin_top(row_spacing(compact));
    outer.set_margin_bottom(row_spacing(compact));
    outer.set_margin_start(edge_margin(compact));
    outer.set_margin_end(edge_margin(compact));

    if is_user {
        outer.append(&gtk::Box::new(gtk::Orientation::Horizontal, 0));
    }

    let bubble = gtk::Box::new(gtk::Orientation::Vertical, if compact { 4 } else { 6 });
    bubble.set_margin_top(row_spacing(compact));
    bubble.set_margin_bottom(row_spacing(compact));
    bubble.set_margin_start(row_spacing(compact));
    bubble.set_margin_end(row_spacing(compact));
    bubble.set_width_request(if compact { 460 } else { 520 });
    bubble.add_css_class(if is_user { "accent" } else { "card" });

    let heading = gtk::Label::new(Some(author));
    heading.set_xalign(if is_user { 1.0 } else { 0.0 });
    heading.add_css_class("caption-heading");
    let body = gtk::Label::new(Some(text));
    body.set_wrap(true);
    body.set_xalign(if is_user { 1.0 } else { 0.0 });

    bubble.append(&heading);
    bubble.append(&body);
    if !attachments.is_empty() {
        bubble.append(&message_attachments(locale, attachments, compact));
    }
    bubble.append(&gtk::Label::new(Some(tr(locale, "status.localSaved"))));

    if let (Some(message_id), Some(state), Some(window)) = (message_id, state, window.clone()) {
        attach_message_context_menu(
            &bubble,
            &row,
            text,
            is_user,
            is_error,
            is_streaming,
            message_id,
            state,
            window,
            notice,
            locale,
        );
    }
    outer.append(&bubble);

    if !is_user {
        outer.append(&gtk::Box::new(gtk::Orientation::Horizontal, 0));
    }

    row.set_child(Some(&outer));
    (row, body)
}

pub(crate) fn message_row(
    author: &str,
    text: &str,
    attachments: &[MessageAttachment],
    is_user: bool,
    is_error: bool,
    is_streaming: bool,
    message_id: Option<String>,
    state: Option<LinuxAppState>,
    window: Option<adw::ApplicationWindow>,
    notice: Option<gtk::Label>,
    locale: &str,
    compact: bool,
) -> gtk::ListBoxRow {
    message_row_with_body(
        author,
        text,
        attachments,
        is_user,
        is_error,
        is_streaming,
        message_id,
        state,
        window,
        notice,
        locale,
        compact,
    )
    .0
}

pub(crate) fn message_display_text(locale: &str, message: &ChatMessage) -> String {
    let is_streaming_assistant = matches!(message.role, MessageRole::Assistant)
        && message.status.as_deref() == Some("streaming");
    if !is_streaming_assistant {
        return message.content.clone();
    }

    let content = if message.content.trim().is_empty() {
        tr(locale, "message.generating").to_owned()
    } else {
        message.content.clone()
    };
    format!("{content}|")
}
