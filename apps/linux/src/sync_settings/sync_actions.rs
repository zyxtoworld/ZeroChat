use crate::{
    LinuxAppState,
    background::poll_background_result,
    i18n::{localize_sync_error, localize_sync_status, tr},
    models::SyncConfig,
    sync::FirstSyncStrategy,
    ui_helpers::{row_spacing, settings_text},
};
use gtk::prelude::*;
use std::sync::mpsc;

pub(crate) fn append_manual_sync_controls(
    box_: &gtk::Box,
    locale: &str,
    state: LinuxAppState,
    sync: &SyncConfig,
) {
    let manual_sync_status = gtk::Label::new(Some(""));
    manual_sync_status.set_xalign(0.0);
    manual_sync_status.add_css_class("dim-label");
    let manual_sync = gtk::Button::with_label(tr(locale, "button.syncNow"));
    manual_sync.add_css_class("suggested-action");
    if let Some(reason) = manual_sync_blocked_reason(locale, &state, sync) {
        manual_sync.set_sensitive(false);
        manual_sync_status.set_text(&reason);
    }
    let locale_for_manual_sync = locale.to_owned();
    let state_for_manual_sync = state.clone();
    let status_for_manual_sync = manual_sync_status.clone();
    let button_for_manual_sync = manual_sync.clone();
    manual_sync.connect_clicked(move |_| {
        run_manual_sync(
            &locale_for_manual_sync,
            state_for_manual_sync.clone(),
            status_for_manual_sync.clone(),
            button_for_manual_sync.clone(),
        );
    });
    box_.append(&manual_sync);
    box_.append(&manual_sync_status);
}

pub(crate) fn append_cloud_sync_status(
    box_: &gtk::Box,
    locale: &str,
    compact: bool,
    state: LinuxAppState,
    sync: &SyncConfig,
) {
    if sync.mode == "local" {
        return;
    }

    if let Some(status) = sync
        .last_sync_status
        .as_deref()
        .map(str::trim)
        .filter(|status| !status.is_empty())
    {
        let status_text = localize_sync_status(locale, status);
        box_.append(&settings_text(&status_text));
    }
    if sync
        .last_sync_status
        .as_deref()
        .map(|status| is_first_sync_conflict_status(locale, status))
        .unwrap_or(false)
    {
        let warning = settings_text(tr(locale, "error.firstSyncConflict"));
        warning.add_css_class("error");
        box_.append(&warning);

        let actions = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
        let choice_status = gtk::Label::new(Some(""));
        choice_status.set_xalign(0.0);
        choice_status.add_css_class("dim-label");

        let merge = gtk::Button::with_label(tr(locale, "button.mergeData"));
        let use_remote = gtk::Button::with_label(tr(locale, "button.useCloudData"));
        let use_local = gtk::Button::with_label(tr(locale, "button.uploadThisDevice"));
        actions.append(&merge);
        actions.append(&use_remote);
        actions.append(&use_local);

        let all_buttons = vec![merge.clone(), use_remote.clone(), use_local.clone()];
        let locale_for_merge = locale.to_owned();
        let state_for_merge = state.clone();
        let status_for_merge = choice_status.clone();
        let buttons_for_merge = all_buttons.clone();
        merge.connect_clicked(move |_| {
            run_first_sync_strategy(
                &locale_for_merge,
                state_for_merge.clone(),
                FirstSyncStrategy::Merge,
                status_for_merge.clone(),
                buttons_for_merge.clone(),
            );
        });

        let locale_for_remote = locale.to_owned();
        let state_for_remote = state.clone();
        let status_for_remote = choice_status.clone();
        let buttons_for_remote = all_buttons.clone();
        use_remote.connect_clicked(move |_| {
            run_first_sync_strategy(
                &locale_for_remote,
                state_for_remote.clone(),
                FirstSyncStrategy::UseRemote,
                status_for_remote.clone(),
                buttons_for_remote.clone(),
            );
        });

        let locale_for_local = locale.to_owned();
        let state_for_local = state.clone();
        let status_for_local = choice_status.clone();
        let buttons_for_local = all_buttons;
        use_local.connect_clicked(move |_| {
            run_first_sync_strategy(
                &locale_for_local,
                state_for_local.clone(),
                FirstSyncStrategy::UseLocal,
                status_for_local.clone(),
                buttons_for_local.clone(),
            );
        });

        box_.append(&actions);
        box_.append(&choice_status);
    }
}

fn manual_sync_blocked_reason(
    locale: &str,
    state: &LinuxAppState,
    sync: &SyncConfig,
) -> Option<String> {
    match sync.mode.as_str() {
        "gist" => {
            if state.sync_passphrase().trim().is_empty() {
                return Some(tr(locale, "message.dataPasswordRequired").to_owned());
            }
            if state.github_token().trim().is_empty() {
                return Some(tr(locale, "error.syncGithubTokenRequired").to_owned());
            }
        }
        "cloudflare" => {
            if sync
                .worker_endpoint
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                return Some(tr(locale, "message.cloudflareWorkerRequired").to_owned());
            }
            if state.sync_passphrase().trim().is_empty()
                || state.cloudflare_access_key().trim().is_empty()
            {
                return Some(tr(locale, "message.dataPasswordRequired").to_owned());
            }
        }
        _ => {
            return Some(tr(locale, "sync.requirement.local").to_owned());
        }
    }
    None
}

fn is_first_sync_conflict_status(locale: &str, status: &str) -> bool {
    let trimmed = status.trim();
    trimmed == "Local and cloud both have data. Choose local, cloud, or merge before syncing."
        || localize_sync_status(locale, trimmed) == tr(locale, "error.firstSyncConflict")
}

fn run_manual_sync(locale: &str, state: LinuxAppState, status: gtk::Label, button: gtk::Button) {
    button.set_sensitive(false);
    status.set_text("");

    let (sender, receiver) = mpsc::channel();
    state.request_manual_sync(sender);

    let locale = locale.to_owned();
    poll_background_result(receiver, move |result| {
        button.set_sensitive(true);

        match result {
            Ok(snapshot) => {
                let message = snapshot
                    .sync
                    .last_sync_status
                    .as_deref()
                    .map(|value| localize_sync_status(&locale, value))
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| tr(&locale, "sync.status.complete").to_owned());
                state.adopt_committed_sync_snapshot(snapshot);
                status.set_text(&message);
            }
            Err(message) => {
                status.set_text(&localize_sync_error(&locale, &message));
            }
        }
    });
}

fn run_first_sync_strategy(
    locale: &str,
    state: LinuxAppState,
    first_sync_strategy: FirstSyncStrategy,
    status: gtk::Label,
    buttons: Vec<gtk::Button>,
) {
    for button in &buttons {
        button.set_sensitive(false);
    }
    status.set_text("");

    let (sender, receiver) = mpsc::channel();
    state.request_first_sync_strategy(first_sync_strategy, sender);

    let locale = locale.to_owned();
    poll_background_result(receiver, move |result| {
        for button in &buttons {
            button.set_sensitive(true);
        }

        match result {
            Ok(snapshot) => {
                let message = snapshot
                    .sync
                    .last_sync_status
                    .as_deref()
                    .map(|value| localize_sync_status(&locale, value))
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| tr(&locale, "sync.status.complete").to_owned());
                state.adopt_committed_sync_snapshot(snapshot);
                status.set_text(&message);
            }
            Err(message) => {
                status.set_text(&localize_sync_error(&locale, &message));
            }
        }
    });
}
