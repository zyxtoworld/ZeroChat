use crate::{
    LinuxAppState,
    i18n::tr,
    ui_helpers::{
        editable_entry, optional_text, row_spacing, settings_box, settings_card, settings_text,
    },
};
use gtk::prelude::*;

mod sync_actions;
use sync_actions::{append_cloud_sync_status, append_manual_sync_controls};

pub(crate) fn sync_settings(locale: &str, compact: bool, state: LinuxAppState) -> gtk::Box {
    let box_ = settings_box(compact);
    let sync = state.snapshot.borrow().sync.clone();
    box_.append(&settings_text(tr(locale, "sync.compare.encrypted")));
    let mode_selector = gtk::DropDown::from_strings(&[
        tr(locale, "mode.local"),
        tr(locale, "mode.gist"),
        tr(locale, "mode.cloudflare"),
    ]);
    mode_selector.set_selected(match sync.mode.as_str() {
        "gist" => 1,
        "cloudflare" => 2,
        _ => 0,
    });
    let state_for_mode = state.clone();
    mode_selector.connect_selected_notify(move |dropdown| {
        let mode = match dropdown.selected() {
            1 => "gist",
            2 => "cloudflare",
            _ => "local",
        };
        state_for_mode.update_sync_config(|sync| {
            sync.mode = mode.to_owned();
            sync.auto_sync = mode != "local";
        });
    });
    box_.append(&mode_selector);
    let auto_sync_row = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    let auto_sync_label = gtk::Label::new(Some(tr(locale, "field.autoSync")));
    auto_sync_label.set_xalign(0.0);
    auto_sync_label.set_hexpand(true);
    let auto_sync_switch = gtk::Switch::builder()
        .active(sync.auto_sync)
        .sensitive(sync.mode != "local")
        .build();
    let auto_sync_note = settings_text(if sync.auto_sync {
        tr(locale, "sync.autoSync.on")
    } else {
        tr(locale, "sync.autoSync.off")
    });
    let state_for_auto_sync = state.clone();
    let note_for_auto_sync = auto_sync_note.clone();
    let locale_for_auto_sync = locale.to_owned();
    auto_sync_switch.connect_active_notify(move |switch| {
        let enabled = switch.is_active();
        state_for_auto_sync.update_sync_config(|sync| {
            sync.auto_sync = sync.mode != "local" && enabled;
        });
        note_for_auto_sync.set_text(if enabled {
            tr(&locale_for_auto_sync, "sync.autoSync.on")
        } else {
            tr(&locale_for_auto_sync, "sync.autoSync.off")
        });
    });
    auto_sync_row.append(&auto_sync_label);
    auto_sync_row.append(&auto_sync_switch);
    box_.append(&auto_sync_row);
    box_.append(&auto_sync_note);
    append_manual_sync_controls(&box_, locale, state.clone(), &sync);

    let local_card = settings_card(tr(locale, "mode.local"));
    local_card.append(&settings_text(tr(locale, "sync.requirement.local")));
    box_.append(&local_card);

    let gist_card = settings_card(tr(locale, "mode.gist"));
    gist_card.append(&settings_text(tr(locale, "sync.compare.gist.fit")));
    let state_for_gist_id = state.clone();
    gist_card.append(&editable_entry(
        tr(locale, "field.gistId"),
        sync.gist_id.as_deref(),
        move |value| {
            state_for_gist_id.update_sync_config(|sync| {
                sync.gist_id = optional_text(value);
            });
        },
    ));
    gist_card.append(&settings_text(tr(locale, "settings.gistIdHint")));
    let state_for_gist_file = state.clone();
    gist_card.append(&editable_entry(
        tr(locale, "field.gistFile"),
        Some(sync.gist_file.as_deref().unwrap_or("zerochat-sync.json")),
        move |value| {
            state_for_gist_file.update_sync_config(|sync| {
                sync.gist_file =
                    optional_text(value).or_else(|| Some("zerochat-sync.json".to_owned()));
            });
        },
    ));
    gist_card.append(&settings_text(tr(locale, "settings.gistFileHint")));
    let github_token = gtk::PasswordEntry::builder()
        .placeholder_text(tr(locale, "field.githubToken"))
        .show_peek_icon(true)
        .build();
    github_token.set_text(&state.github_token());
    gist_card.append(&github_token);
    gist_card.append(&settings_text(tr(locale, "settings.githubTokenHint")));
    let token_actions = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    let token_status = gtk::Label::new(Some(""));
    token_status.set_xalign(0.0);
    token_status.add_css_class("dim-label");
    let save_github_token = gtk::Button::with_label(tr(locale, "button.saveProviderKey"));
    save_github_token.add_css_class("suggested-action");
    let token_for_save = github_token.clone();
    let state_for_token = state.clone();
    let status_for_token = token_status.clone();
    let locale_for_token = locale.to_owned();
    save_github_token.connect_clicked(move |_| {
        let value = token_for_save.text().trim().to_owned();
        match state_for_token.save_github_token(&value) {
            Ok(()) => status_for_token.set_text(tr(&locale_for_token, "settings.changesSaved")),
            Err(error) => {
                eprintln!("ZeroChat GitHub token enqueue failed: {error:#}");
                status_for_token.set_text(tr(&locale_for_token, "message.secretSaveFailed"));
            }
        }
    });
    token_actions.append(&save_github_token);
    let clear_github_token = gtk::Button::with_label(tr(locale, "action.clear"));
    let token_for_clear = github_token.clone();
    let state_for_clear_token = state.clone();
    let status_for_clear_token = token_status.clone();
    let locale_for_clear_token = locale.to_owned();
    clear_github_token.connect_clicked(move |_| {
        match state_for_clear_token.save_github_token("") {
            Ok(()) => {
                token_for_clear.set_text("");
                status_for_clear_token
                    .set_text(tr(&locale_for_clear_token, "settings.changesSaved"));
            }
            Err(error) => {
                eprintln!("ZeroChat GitHub token clear enqueue failed: {error:#}");
                status_for_clear_token
                    .set_text(tr(&locale_for_clear_token, "message.secretSaveFailed"));
            }
        }
    });
    token_actions.append(&clear_github_token);
    gist_card.append(&token_actions);
    gist_card.append(&settings_text(tr(
        locale,
        "settings.linuxGithubTokenSessionNote",
    )));
    gist_card.append(&token_status);
    box_.append(&gist_card);

    let cloudflare_card = settings_card(tr(locale, "mode.cloudflare"));
    cloudflare_card.append(&settings_text(tr(locale, "sync.compare.cloudflare.fit")));
    let state_for_worker = state.clone();
    cloudflare_card.append(&editable_entry(
        tr(locale, "field.cloudflareWorkerUrl"),
        sync.worker_endpoint.as_deref(),
        move |value| {
            state_for_worker.update_sync_config(|sync| {
                sync.worker_endpoint = optional_text(value);
            });
        },
    ));
    cloudflare_card.append(&settings_text(tr(
        locale,
        "settings.cloudflareWorkerUrlHint",
    )));
    let access_key_value = state.cloudflare_access_key();
    let access_key = gtk::PasswordEntry::builder()
        .placeholder_text(tr(locale, "field.cloudflareAccessKey"))
        .show_peek_icon(true)
        .build();
    access_key.set_text(&access_key_value);
    access_key.set_editable(false);
    cloudflare_card.append(&access_key);
    cloudflare_card.append(&settings_text(tr(
        locale,
        "settings.cloudflareAccessKeyFieldHint",
    )));
    cloudflare_card.append(&settings_text(tr(
        locale,
        "settings.cloudflareAccessKeyNote",
    )));
    box_.append(&cloudflare_card);
    append_cloud_sync_status(&box_, locale, compact, state.clone(), &sync);
    box_
}
