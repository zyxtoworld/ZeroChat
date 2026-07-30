use crate::{
    LinuxAppState,
    background::{
        poll_background_result, spawn_cloudflare_clear_request, spawn_gist_clear_request,
    },
    i18n::{localize_sync_error, tr},
    set_window_content,
};
use adw::prelude::*;
use std::sync::mpsc;

pub(crate) const RESPONSE_ACCEPT: &str = "accept";
const RESPONSE_CANCEL: &str = "cancel";

pub(crate) fn destructive_confirmation_dialog(
    locale: &str,
    window: &adw::ApplicationWindow,
    heading_key: &str,
    body: &str,
    accept_label_key: &str,
) -> adw::MessageDialog {
    let dialog = adw::MessageDialog::builder()
        .transient_for(window)
        .modal(true)
        .heading(tr(locale, heading_key))
        .body(body)
        .close_response(RESPONSE_CANCEL)
        .default_response(RESPONSE_CANCEL)
        .build();
    dialog.add_response(RESPONSE_CANCEL, tr(locale, "action.cancel"));
    dialog.add_response(RESPONSE_ACCEPT, tr(locale, accept_label_key));
    dialog.set_response_appearance(RESPONSE_ACCEPT, adw::ResponseAppearance::Destructive);
    dialog
}

pub(crate) fn confirm_delete_conversation(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    conversation_id: String,
    title: String,
) {
    let body = if title.trim().is_empty() {
        tr(locale, "danger.deleteConversation.body").to_owned()
    } else {
        format!(
            "{}\n\n{}",
            title.trim(),
            tr(locale, "danger.deleteConversation.body")
        )
    };
    let dialog = destructive_confirmation_dialog(
        locale,
        window,
        "danger.deleteConversation.title",
        &body,
        "action.delete",
    );

    let state_for_response = state.clone();
    let window_for_response = window.clone();
    dialog.connect_response(None, move |dialog, response| {
        if response == RESPONSE_ACCEPT && state_for_response.delete_conversation(&conversation_id) {
            set_window_content(&window_for_response, state_for_response.clone(), "chat");
        }
        dialog.close();
    });
    dialog.present();
}

pub(crate) fn confirm_reset_local_data(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    status: gtk::Label,
) {
    let body = format!(
        "{}\n\n{}\n{}\n{}",
        tr(locale, "danger.resetLocalData.body"),
        tr(locale, "danger.resetLocalData.detail1"),
        tr(locale, "danger.resetLocalData.detail2"),
        tr(locale, "danger.resetLocalData.detail3"),
    );
    let dialog = destructive_confirmation_dialog(
        locale,
        window,
        "danger.resetLocalData.title",
        &body,
        "action.resetLocalData",
    );

    let state_for_response = state.clone();
    let window_for_response = window.clone();
    let status_for_response = status.clone();
    let locale_for_response = locale.to_owned();
    dialog.connect_response(None, move |dialog, response| {
        if response == RESPONSE_ACCEPT {
            match state_for_response.reset_local_data() {
                Ok(()) => {
                    set_window_content(&window_for_response, state_for_response.clone(), "chat");
                }
                Err(error) => {
                    eprintln!("ZeroChat local reset failed: {error:#}");
                    status_for_response
                        .set_text(tr(&locale_for_response, "message.localResetFailed"));
                }
            }
        }
        dialog.close();
    });
    dialog.present();
}

pub(crate) fn confirm_reset_sync_passphrase(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    status: gtk::Label,
) {
    let body = format!(
        "{}\n\n{}\n{}\n{}",
        tr(locale, "danger.resetSyncPassword.body"),
        tr(locale, "danger.resetSyncPassword.detail1"),
        tr(locale, "danger.resetSyncPassword.detail2"),
        tr(locale, "danger.resetSyncPassword.detail3"),
    );
    let dialog = destructive_confirmation_dialog(
        locale,
        window,
        "danger.resetSyncPassword.title",
        &body,
        "action.resetSyncPassword",
    );

    let state_for_response = state.clone();
    let status_for_response = status.clone();
    let locale_for_response = locale.to_owned();
    dialog.connect_response(None, move |dialog, response| {
        if response == RESPONSE_ACCEPT {
            match state_for_response.reset_sync_passphrase() {
                Ok(()) => status_for_response
                    .set_text(tr(&locale_for_response, "notice.syncPasswordReset")),
                Err(error) => {
                    eprintln!("ZeroChat sync passphrase clear enqueue failed: {error:#}");
                    status_for_response
                        .set_text(tr(&locale_for_response, "message.secretSaveFailed"));
                }
            }
        }
        dialog.close();
    });
    dialog.present();
}

pub(crate) fn confirm_change_sync_passphrase(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    status: gtk::Label,
    passphrase_entry: gtk::PasswordEntry,
    passphrase: String,
) {
    let body = format!(
        "{}\n\n{}\n{}\n{}",
        tr(locale, "danger.changeSyncPassword.body"),
        tr(locale, "danger.changeSyncPassword.detail1"),
        tr(locale, "danger.changeSyncPassword.detail2"),
        tr(locale, "danger.changeSyncPassword.detail3"),
    );
    let dialog = destructive_confirmation_dialog(
        locale,
        window,
        "danger.changeSyncPassword.title",
        &body,
        "action.changeSyncPassword",
    );

    let state_for_response = state.clone();
    let status_for_response = status.clone();
    let passphrase_for_response = passphrase_entry.clone();
    let locale_for_response = locale.to_owned();
    dialog.connect_response(None, move |dialog, response| {
        if response == RESPONSE_ACCEPT {
            match state_for_response.save_sync_passphrase(&passphrase) {
                Ok(()) => status_for_response
                    .set_text(tr(&locale_for_response, "message.syncPasswordChanged")),
                Err(error) => {
                    eprintln!("ZeroChat sync passphrase enqueue failed: {error:#}");
                    status_for_response
                        .set_text(tr(&locale_for_response, "message.secretSaveFailed"));
                }
            }
        }
        passphrase_for_response.set_text("");
        dialog.close();
    });
    dialog.present();
}

pub(crate) fn confirm_clear_cloud_data(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    status: gtk::Label,
    button: gtk::Button,
) {
    let sync = state.sync_config();
    if sync.mode == "gist" {
        let token = state.github_token();
        if token.trim().is_empty() {
            status.set_text(tr(locale, "error.syncGithubTokenRequired"));
            return;
        }

        let gist_id = sync.gist_id.unwrap_or_default();
        let gist_file = sync
            .gist_file
            .unwrap_or_else(|| "zerochat-sync.json".to_owned());
        present_clear_cloud_confirmation(locale, window, status, button, move |sender| {
            spawn_gist_clear_request(
                gist_id.trim().to_owned(),
                gist_file.trim().to_owned(),
                token.trim().to_owned(),
                sender,
            );
        });
        return;
    }

    if sync.mode != "cloudflare" {
        status.set_text(tr(locale, "sync.requirement.local"));
        return;
    }

    let endpoint = sync.worker_endpoint.unwrap_or_default();
    if endpoint.trim().is_empty() {
        status.set_text(tr(locale, "message.cloudflareWorkerRequired"));
        return;
    }

    let token = state.cloudflare_access_key();
    if token.trim().is_empty() {
        status.set_text(tr(locale, "message.dataPasswordRequired"));
        return;
    }

    let endpoint_for_request = endpoint.trim().to_owned();
    let token_for_request = token.trim().to_owned();
    present_clear_cloud_confirmation(locale, window, status, button, move |sender| {
        spawn_cloudflare_clear_request(
            endpoint_for_request.clone(),
            token_for_request.clone(),
            sender,
        );
    });
}

fn present_clear_cloud_confirmation(
    locale: &str,
    window: &adw::ApplicationWindow,
    status: gtk::Label,
    button: gtk::Button,
    start_request: impl Fn(mpsc::Sender<Result<(), String>>) + 'static,
) {
    let body = format!(
        "{}\n\n{}\n{}\n{}\n{}",
        tr(locale, "danger.clearCloudData.body"),
        tr(locale, "danger.clearCloudData.detail1"),
        tr(locale, "danger.clearCloudData.detail2"),
        tr(locale, "danger.clearCloudData.detail3"),
        tr(locale, "danger.clearCloudData.detail4"),
    );
    let dialog = destructive_confirmation_dialog(
        locale,
        window,
        "danger.clearCloudData.title",
        &body,
        "action.clearCloudData",
    );

    let locale_for_response = locale.to_owned();
    let status_for_response = status.clone();
    let button_for_response = button.clone();
    dialog.connect_response(None, move |dialog, response| {
        if response == RESPONSE_ACCEPT {
            button_for_response.set_sensitive(false);
            status_for_response.set_text("");

            let (sender, receiver) = mpsc::channel();
            start_request(sender);

            let locale_for_result = locale_for_response.clone();
            let status_for_result = status_for_response.clone();
            let button_for_result = button_for_response.clone();
            poll_background_result(receiver, move |result| {
                button_for_result.set_sensitive(true);
                match result {
                    Ok(()) => {
                        status_for_result
                            .set_text(tr(&locale_for_result, "message.cloudSyncCleared"));
                    }
                    Err(message) => {
                        let prefix = tr(&locale_for_result, "message.cloudClearFailedPrefix");
                        let detail = localize_sync_error(&locale_for_result, &message);
                        if detail.trim_start().starts_with(prefix) {
                            status_for_result.set_text(&detail);
                        } else {
                            status_for_result.set_text(&format!("{prefix}: {detail}"));
                        }
                    }
                }
            });
        }
        dialog.close();
    });
    dialog.present();
}
