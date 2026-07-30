use crate::{
    LinuxAppState,
    background::{poll_background_result, spawn_ai_speech_request},
    i18n::{localize_ai_error, replace_placeholders, tr},
    set_window_content,
    ui_helpers::row_spacing,
};
use gtk::{gio, prelude::*};
use std::mpsc;

pub(crate) fn attach_message_context_menu(
    bubble: &gtk::Box,
    row: &gtk::ListBoxRow,
    text: &str,
    is_user: bool,
    is_error: bool,
    is_streaming: bool,
    message_id: String,
    state: LinuxAppState,
    window: adw::ApplicationWindow,
    notice: Option<gtk::Label>,
    locale: &str,
) {
    let action_group = gio::SimpleActionGroup::new();

    let copy_action = gio::SimpleAction::new("copy", None);
    let text_for_copy = text.to_owned();
    copy_action.connect_activate(move |_, _| {
        copy_text_to_clipboard(&text_for_copy);
    });
    action_group.add_action(&copy_action);

    if is_user {
        let edit_action = gio::SimpleAction::new("edit", None);
        let locale_for_edit = locale.to_owned();
        let text_for_edit = text.to_owned();
        let state_for_edit = state.clone();
        let message_id_for_edit = message_id.clone();
        let window_for_edit = window.clone();
        edit_action.connect_activate(move |_, _| {
            show_edit_message_dialog(
                &locale_for_edit,
                &window_for_edit,
                state_for_edit.clone(),
                message_id_for_edit.clone(),
                text_for_edit.clone(),
            );
        });
        action_group.add_action(&edit_action);
    } else {
        let regenerate_action = gio::SimpleAction::new("regenerate", None);
        let locale_for_regenerate = locale.to_owned();
        let state_for_regenerate = state.clone();
        let message_id_for_regenerate = message_id.clone();
        let window_for_regenerate = window.clone();
        regenerate_action.connect_activate(move |_, _| {
            if state_for_regenerate
                .regenerate_assistant_message(
                    &message_id_for_regenerate,
                    tr(&locale_for_regenerate, "message.configureModelFirst").to_owned(),
                )
                .is_some()
            {
                set_window_content(&window_for_regenerate, state_for_regenerate.clone(), "chat");
            }
        });
        action_group.add_action(&regenerate_action);

        let speak_action = gio::SimpleAction::new("speak", None);
        let locale_for_speak = locale.to_owned();
        let state_for_speak = state.clone();
        let message_id_for_speak = message_id.clone();
        let notice_for_speak = notice.clone();
        speak_action.connect_activate(move |_, _| {
            start_message_speech(
                &locale_for_speak,
                state_for_speak.clone(),
                message_id_for_speak.clone(),
                notice_for_speak.clone(),
            );
        });
        action_group.add_action(&speak_action);

        let stop_speech_action = gio::SimpleAction::new("stop-speech", None);
        stop_speech_action.set_enabled(false);
        let locale_for_stop = locale.to_owned();
        let state_for_stop = state.clone();
        let notice_for_stop = notice.clone();
        stop_speech_action.connect_activate(move |_, _| {
            if state_for_stop.stop_speaking_message() {
                if let Some(notice) = &notice_for_stop {
                    set_notice_info(notice, tr(&locale_for_stop, "notice.audioSpeechStopped"));
                }
            }
        });
        action_group.add_action(&stop_speech_action);
    }

    let delete_action = gio::SimpleAction::new("delete", None);
    let state_for_delete = state.clone();
    let message_id_for_delete = message_id.clone();
    let row_for_delete = row.clone();
    delete_action.connect_activate(move |_, _| {
        if state_for_delete.delete_message(&message_id_for_delete) {
            row_for_delete.set_visible(false);
        }
    });
    action_group.add_action(&delete_action);
    bubble.insert_action_group("message", Some(&action_group));

    let menu = gio::Menu::new();
    menu.append(Some(tr(locale, "button.copy")), Some("message.copy"));
    if is_user {
        menu.append(Some(tr(locale, "action.editResend")), Some("message.edit"));
    } else {
        let rerun_label = if is_error {
            tr(locale, "button.retry")
        } else {
            tr(locale, "action.regenerate")
        };
        menu.append(Some(rerun_label), Some("message.regenerate"));
        if !is_streaming && !text.trim().is_empty() {
            menu.append(
                Some(tr(locale, "button.speakMessage")),
                Some("message.speak"),
            );
        }
        menu.append(
            Some(tr(locale, "button.stopSpeaking")),
            Some("message.stop-speech"),
        );
    }
    menu.append(Some(tr(locale, "action.delete")), Some("message.delete"));

    let popover = gtk::PopoverMenu::from_model(Some(&menu));
    popover.set_parent(bubble);
    popover.set_has_arrow(false);

    let right_click = gtk::GestureClick::new();
    right_click.set_button(3);
    let popover_for_click = popover.clone();
    let stop_speech_for_click = action_group
        .lookup_action("stop-speech")
        .and_then(|action| action.downcast::<gio::SimpleAction>().ok());
    let state_for_click = state.clone();
    let message_id_for_click = message_id.clone();
    right_click.connect_pressed(move |_, _, x, y| {
        if let Some(action) = &stop_speech_for_click {
            action.set_enabled(
                state_for_click.speaking_message_id().as_deref()
                    == Some(message_id_for_click.as_str()),
            );
        }
        popup_message_menu_at(&popover_for_click, x, y);
    });
    bubble.add_controller(right_click);

    let long_press = gtk::GestureLongPress::new();
    let popover_for_press = popover.clone();
    let stop_speech_for_press = action_group
        .lookup_action("stop-speech")
        .and_then(|action| action.downcast::<gio::SimpleAction>().ok());
    let state_for_press = state;
    let message_id_for_press = message_id;
    long_press.connect_pressed(move |_, x, y| {
        if let Some(action) = &stop_speech_for_press {
            action.set_enabled(
                state_for_press.speaking_message_id().as_deref()
                    == Some(message_id_for_press.as_str()),
            );
        }
        popup_message_menu_at(&popover_for_press, x, y);
    });
    bubble.add_controller(long_press);
}

fn start_message_speech(
    locale: &str,
    state: LinuxAppState,
    message_id: String,
    notice: Option<gtk::Label>,
) {
    let request = match state.prepare_message_speech_request(&message_id, locale) {
        Ok(request) => request,
        Err(message) => {
            if let Some(notice) = &notice {
                set_notice_warning(notice, &message);
            }
            return;
        }
    };

    let serial = state.begin_speaking_message(&message_id);
    if let Some(notice) = &notice {
        let message = replace_placeholders(
            tr(locale, "notice.audioSpeechPlaying"),
            &[("{model}", &request.model)],
        );
        set_notice_info(notice, &message);
    }

    let (sender, receiver) = mpsc::channel();
    spawn_ai_speech_request(request, sender);
    let locale_for_result = locale.to_owned();
    let state_for_result = state;
    let message_id_for_result = message_id;
    let notice_for_result = notice;
    poll_background_result(receiver, move |result| {
        if !state_for_result.is_current_speech_request(&message_id_for_result, serial) {
            return;
        }

        match result {
            Ok(bytes) => {
                if let Err(message) =
                    state_for_result.play_speech_audio(message_id_for_result.clone(), serial, bytes)
                {
                    state_for_result.stop_speaking_message();
                    if let Some(notice) = &notice_for_result {
                        set_audio_speech_failed_notice(notice, &locale_for_result, &message);
                    }
                }
            }
            Err(message) => {
                state_for_result.stop_speaking_message();
                if let Some(notice) = &notice_for_result {
                    let message = localize_ai_error(&locale_for_result, &message);
                    set_audio_speech_failed_notice(notice, &locale_for_result, &message);
                }
            }
        }
    });
}

fn set_notice_info(notice: &gtk::Label, message: &str) {
    notice.remove_css_class("warning");
    notice.set_text(message);
}

fn set_notice_warning(notice: &gtk::Label, message: &str) {
    notice.add_css_class("warning");
    notice.set_text(message);
}

fn set_audio_speech_failed_notice(notice: &gtk::Label, locale: &str, message: &str) {
    let message = replace_placeholders(
        tr(locale, "notice.audioSpeechFailed"),
        &[("{message}", message)],
    );
    set_notice_warning(notice, &message);
}

fn popup_message_menu_at(popover: &gtk::PopoverMenu, x: f64, y: f64) {
    let pointing_to = gtk::gdk::Rectangle::new(x.round() as i32, y.round() as i32, 1, 1);
    popover.set_pointing_to(Some(&pointing_to));
    popover.popup();
}

fn copy_text_to_clipboard(text: &str) {
    if let Some(display) = gtk::gdk::Display::default() {
        display.clipboard().set_text(text);
    }
}

fn show_edit_message_dialog(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    message_id: String,
    text: String,
) {
    let dialog = gtk::Dialog::builder()
        .transient_for(window)
        .modal(true)
        .title(tr(locale, "action.editResend"))
        .build();
    dialog.add_button(tr(locale, "action.cancel"), gtk::ResponseType::Cancel);
    dialog.add_button(tr(locale, "action.send"), gtk::ResponseType::Accept);

    let content = dialog.content_area();
    content.set_spacing(row_spacing(false));
    content.set_margin_top(16);
    content.set_margin_bottom(16);
    content.set_margin_start(16);
    content.set_margin_end(16);

    let hint = gtk::Label::new(Some(tr(locale, "message.editing")));
    hint.set_wrap(true);
    hint.set_xalign(0.0);
    content.append(&hint);

    let editor = gtk::TextView::new();
    editor.set_wrap_mode(gtk::WrapMode::WordChar);
    editor.set_size_request(420, 140);
    editor.buffer().set_text(&text);
    let scroller = gtk::ScrolledWindow::builder()
        .child(&editor)
        .min_content_height(140)
        .build();
    content.append(&scroller);

    let warning = gtk::Label::new(None);
    warning.set_xalign(0.0);
    warning.add_css_class("warning");
    content.append(&warning);

    let locale_for_response = locale.to_owned();
    let window_for_response = window.clone();
    let state_for_response = state.clone();
    dialog.connect_response(move |dialog, response| {
        if response != gtk::ResponseType::Accept {
            dialog.close();
            return;
        }

        let buffer = editor.buffer();
        let content = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), true)
            .trim()
            .to_owned();
        if content.is_empty() {
            warning.set_text(tr(&locale_for_response, "message.emptyInput"));
            return;
        }

        if state_for_response
            .edit_and_resend_message(
                &message_id,
                content,
                tr(&locale_for_response, "message.configureModelFirst").to_owned(),
            )
            .is_some()
        {
            set_window_content(&window_for_response, state_for_response.clone(), "chat");
        }
        dialog.close();
    });
    dialog.present();
}
