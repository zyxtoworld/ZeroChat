use crate::{
    LINUX_PROVIDER_MODEL_FEATURE_HINT_ID, LinuxAppState,
    chat_composer::composer,
    i18n::tr,
    messages::{message_display_text, message_row},
    models::MessageRole,
    providers::{chat_composer_hint, provider_key_missing, provider_model_options},
    settings_window::{open_linux_settings_window, settings_page},
    ui_helpers::{edge_margin, row_spacing},
};
use gtk::prelude::*;

pub(crate) fn main_area(
    locale: &str,
    language_mode: String,
    visible_page: &str,
    focus_composer: bool,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
) -> gtk::Box {
    let main = gtk::Box::new(gtk::Orientation::Vertical, 0);
    main.set_hexpand(true);

    let stack = gtk::Stack::new();
    stack.set_hexpand(true);
    stack.set_vexpand(true);
    stack.add_named(
        &chat_page(locale, compact, window, state.clone(), focus_composer),
        Some("chat"),
    );
    stack.add_named(
        &settings_page(locale, language_mode, compact, window, state.clone()),
        Some("settings"),
    );
    stack.set_visible_child_name(visible_page);

    let header = adw::HeaderBar::new();
    let (provider_options, provider_selected) = provider_model_options(locale, &state);
    let provider_option_labels = provider_options
        .iter()
        .map(|option| option.label.clone())
        .collect::<Vec<_>>();
    let provider_option_refs = provider_option_labels
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let provider_menu = gtk::DropDown::from_strings(&provider_option_refs);
    provider_menu.set_selected(provider_selected);
    provider_menu.set_hexpand(true);
    let state_for_provider_menu = state.clone();
    provider_menu.connect_selected_notify(move |dropdown| {
        if let Some(option) = provider_options.get(dropdown.selected() as usize) {
            state_for_provider_menu.update_active_conversation_provider(
                option.provider_id.clone(),
                option.model.clone(),
            );
        }
    });
    header.set_title_widget(Some(&provider_menu));

    let settings_button = gtk::Button::with_label(tr(locale, "title.settings"));
    settings_button.set_tooltip_text(Some(&format!("{} (Ctrl+,)", tr(locale, "title.settings"))));
    let window_for_settings = window.clone();
    let state_for_settings = state.clone();
    settings_button.connect_clicked(move |_| {
        open_linux_settings_window(
            &window_for_settings,
            state_for_settings.clone(),
            "appearance",
        );
    });
    header.pack_end(&settings_button);

    let chat_button = gtk::Button::with_label(tr(locale, "mode.chat"));
    let stack_for_chat = stack.clone();
    chat_button.connect_clicked(move |_| {
        stack_for_chat.set_visible_child_name("chat");
    });
    header.pack_start(&chat_button);

    main.append(&header);
    if state.should_show_feature_hint(LINUX_PROVIDER_MODEL_FEATURE_HINT_ID) {
        main.append(&provider_model_feature_hint(locale, compact, state.clone()));
    }
    main.append(&stack);
    main
}

fn provider_model_feature_hint(locale: &str, compact: bool, state: LinuxAppState) -> gtk::Box {
    let hint = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    hint.add_css_class("card");
    hint.set_margin_start(edge_margin(compact));
    hint.set_margin_end(edge_margin(compact));
    hint.set_margin_top(row_spacing(compact));
    hint.set_margin_bottom(row_spacing(compact));
    hint.set_tooltip_text(Some(tr(locale, "featureHint.provider-model")));

    let icon = gtk::Image::from_icon_name("dialog-information-symbolic");
    icon.set_pixel_size(18);
    icon.set_valign(gtk::Align::Center);
    hint.append(&icon);

    let text = gtk::Label::new(Some(tr(locale, "featureHint.provider-model")));
    text.set_hexpand(true);
    text.set_wrap(true);
    text.set_xalign(0.0);
    hint.append(&text);

    let dismiss = gtk::Button::with_label(tr(locale, "featureHint.dismiss"));
    dismiss.add_css_class("flat");
    dismiss.set_tooltip_text(Some(tr(locale, "featureHint.dismiss")));
    let hint_for_dismiss = hint.clone();
    dismiss.connect_clicked(move |_| {
        state.dismiss_feature_hint(LINUX_PROVIDER_MODEL_FEATURE_HINT_ID);
        hint_for_dismiss.set_visible(false);
    });
    hint.append(&dismiss);

    hint
}

fn chat_page(
    locale: &str,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    focus_composer: bool,
) -> gtk::Box {
    let page = gtk::Box::new(gtk::Orientation::Vertical, 0);
    page.set_vexpand(true);

    let notice = gtk::Label::new(Some(""));
    notice.set_xalign(0.0);
    notice.set_margin_start(edge_margin(compact));
    notice.set_margin_end(edge_margin(compact));
    notice.set_margin_top(row_spacing(compact));
    notice.add_css_class("dim-label");
    if let Some(key) = state.local_storage_notice_key() {
        notice.add_css_class("warning");
        notice.set_text(tr(locale, key));
    }
    page.append(&notice);

    let messages = gtk::ListBox::new();
    messages.set_selection_mode(gtk::SelectionMode::None);
    if let Some(conversation) = state.active_conversation() {
        if conversation.messages.is_empty() {
            let hint = chat_composer_hint(locale, &state)
                .unwrap_or_else(|| tr(locale, "message.emptyChat").to_owned());
            messages.append(&message_row(
                "AI",
                &hint,
                &[],
                false,
                false,
                false,
                None,
                None,
                Some(window.clone()),
                Some(notice.clone()),
                locale,
                compact,
            ));
            if let Some((label, page)) = chat_setup_action(locale, &state) {
                messages.append(&setup_action_row(
                    &label,
                    page,
                    window,
                    state.clone(),
                    compact,
                ));
            }
        }

        for message in conversation.messages {
            let is_user = matches!(message.role, MessageRole::User);
            let is_error = !is_user
                && (message.status.as_deref() == Some("error")
                    || message
                        .error
                        .as_deref()
                        .is_some_and(|error| !error.trim().is_empty()));
            let is_streaming = matches!(
                message.status.as_deref(),
                Some("streaming") | Some("pending")
            );
            let author = if is_user {
                tr(locale, "role.user")
            } else {
                "AI"
            };
            let display_text = message_display_text(locale, &message);
            messages.append(&message_row(
                author,
                &display_text,
                &message.attachments,
                is_user,
                is_error,
                is_streaming,
                Some(message.id.clone()),
                Some(state.clone()),
                Some(window.clone()),
                Some(notice.clone()),
                locale,
                compact,
            ));
        }
    } else {
        let hint = chat_composer_hint(locale, &state)
            .unwrap_or_else(|| tr(locale, "message.emptyChat").to_owned());
        messages.append(&message_row(
            "AI",
            &hint,
            &[],
            false,
            false,
            false,
            None,
            None,
            Some(window.clone()),
            Some(notice.clone()),
            locale,
            compact,
        ));
        if let Some((label, page)) = chat_setup_action(locale, &state) {
            messages.append(&setup_action_row(
                &label,
                page,
                window,
                state.clone(),
                compact,
            ));
        }
    }

    let scroller = gtk::ScrolledWindow::builder()
        .child(&messages)
        .hexpand(true)
        .vexpand(true)
        .build();
    page.append(&scroller);

    page.append(&composer(
        &messages,
        &notice,
        locale,
        compact,
        window,
        state,
        focus_composer,
    ));
    page
}

fn chat_setup_action(locale: &str, state: &LinuxAppState) -> Option<(String, &'static str)> {
    let conversation = state.active_conversation();
    let providers = state.providers();
    let provider = conversation
        .as_ref()
        .and_then(|conversation| {
            providers
                .iter()
                .find(|provider| provider.id == conversation.provider_id && provider.enabled)
                .cloned()
        })
        .or_else(|| providers.iter().find(|provider| provider.enabled).cloned());

    let Some(provider) = provider else {
        return Some((tr(locale, "button.addProvider").to_owned(), "providers"));
    };

    if provider_key_missing(state, &provider) {
        return Some((tr(locale, "action.addProviderKey").to_owned(), "providers"));
    }

    let model = conversation
        .as_ref()
        .map(|conversation| conversation.model.trim().to_owned())
        .filter(|model| !model.is_empty())
        .unwrap_or_else(|| provider.model.trim().to_owned());

    if model.is_empty() {
        return Some((tr(locale, "action.addModel").to_owned(), "models"));
    }

    None
}

fn setup_action_row(
    label: &str,
    page: &'static str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    compact: bool,
) -> gtk::ListBoxRow {
    let row = gtk::ListBoxRow::new();
    row.set_selectable(false);
    row.set_activatable(false);

    let outer = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    outer.set_margin_start(edge_margin(compact));
    outer.set_margin_end(edge_margin(compact));
    outer.set_margin_bottom(row_spacing(compact));

    let button = gtk::Button::with_label(label);
    button.add_css_class("suggested-action");
    let window_for_settings = window.clone();
    button.connect_clicked(move |_| {
        open_linux_settings_window(&window_for_settings, state.clone(), page);
    });
    outer.append(&button);

    row.set_child(Some(&outer));
    row
}
