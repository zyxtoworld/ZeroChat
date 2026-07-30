use crate::{
    LinuxAppState,
    backup::{confirm_import_encrypted_backup, show_export_encrypted_backup_dialog},
    dialogs::{
        confirm_change_sync_passphrase, confirm_clear_cloud_data, confirm_reset_local_data,
        confirm_reset_sync_passphrase,
    },
    i18n::tr,
    ui_helpers::settings_box,
};
use gtk::prelude::*;

pub(crate) fn data_settings(
    locale: &str,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
) -> gtk::Box {
    let box_ = settings_box(compact);
    if let Some(key) = state.local_storage_notice_key() {
        let warning = gtk::Label::new(Some(tr(locale, key)));
        warning.set_wrap(true);
        warning.set_xalign(0.0);
        warning.add_css_class("warning");
        box_.append(&warning);
    }
    box_.append(&gtk::Label::new(Some(tr(
        locale,
        "settings.syncEncryptedNote",
    ))));
    box_.append(&gtk::Label::new(Some(tr(
        locale,
        "danger.changeSyncPassword.body",
    ))));
    let data_passphrase = gtk::PasswordEntry::builder()
        .placeholder_text(tr(locale, "field.dataPassphrase"))
        .build();
    box_.append(&data_passphrase);
    let status = gtk::Label::new(Some(""));
    status.set_xalign(0.0);
    status.add_css_class("dim-label");
    let save_sync_password = gtk::Button::with_label(tr(locale, "action.saveSyncPassword"));
    save_sync_password.add_css_class("suggested-action");
    let passphrase_for_save = data_passphrase.clone();
    let status_for_save = status.clone();
    let state_for_save = state.clone();
    let locale_for_save = locale.to_owned();
    let window_for_save = window.clone();
    save_sync_password.connect_clicked(move |_| {
        let value = passphrase_for_save.text().trim().to_owned();
        if value.is_empty() {
            status_for_save.set_text(tr(&locale_for_save, "message.emptyInput"));
            return;
        }

        let committed = state_for_save.sync_passphrase();
        if value == committed.trim() {
            passphrase_for_save.set_text("");
            status_for_save.set_text(tr(&locale_for_save, "message.syncPasswordAlreadySaved"));
            return;
        }

        if state_for_save.sync_config().mode != "local" && !committed.trim().is_empty() {
            confirm_change_sync_passphrase(
                &locale_for_save,
                &window_for_save,
                state_for_save.clone(),
                status_for_save.clone(),
                passphrase_for_save.clone(),
                value,
            );
            return;
        }

        match state_for_save.save_sync_passphrase(&value) {
            Ok(()) => {
                passphrase_for_save.set_text("");
                status_for_save.set_text(tr(&locale_for_save, "message.syncPasswordSaved"));
            }
            Err(error) => {
                eprintln!("ZeroChat sync passphrase enqueue failed: {error:#}");
                status_for_save.set_text(tr(&locale_for_save, "message.secretSaveFailed"));
            }
        }
    });
    box_.append(&save_sync_password);
    let reset_sync_password = gtk::Button::with_label(tr(locale, "action.resetSyncPassword"));
    reset_sync_password.add_css_class("destructive-action");
    let status_for_reset_password = status.clone();
    let window_for_reset_password = window.clone();
    let state_for_reset_password = state.clone();
    let locale_for_reset_password = locale.to_owned();
    reset_sync_password.connect_clicked(move |_| {
        confirm_reset_sync_passphrase(
            &locale_for_reset_password,
            &window_for_reset_password,
            state_for_reset_password.clone(),
            status_for_reset_password.clone(),
        );
    });
    box_.append(&reset_sync_password);
    box_.append(&status);
    box_.append(&gtk::Label::new(Some(tr(
        locale,
        "message.backupEncryptedHint",
    ))));
    let export_backup = gtk::Button::with_label(tr(locale, "action.exportEncryptedBackup"));
    let locale_for_export = locale.to_owned();
    let window_for_export = window.clone();
    let state_for_export = state.clone();
    let status_for_export = status.clone();
    export_backup.connect_clicked(move |_| {
        show_export_encrypted_backup_dialog(
            &locale_for_export,
            &window_for_export,
            state_for_export.clone(),
            status_for_export.clone(),
        );
    });
    box_.append(&export_backup);
    let import_backup = gtk::Button::with_label(tr(locale, "action.importEncryptedBackup"));
    let locale_for_import_backup = locale.to_owned();
    let window_for_import_backup = window.clone();
    let state_for_import_backup = state.clone();
    let status_for_import_backup = status.clone();
    import_backup.connect_clicked(move |_| {
        confirm_import_encrypted_backup(
            &locale_for_import_backup,
            &window_for_import_backup,
            state_for_import_backup.clone(),
            status_for_import_backup.clone(),
        );
    });
    box_.append(&import_backup);
    let reset_local = gtk::Button::with_label(tr(locale, "action.resetLocalData"));
    reset_local.add_css_class("destructive-action");
    let locale_for_reset = locale.to_owned();
    let window_for_reset = window.clone();
    let state_for_reset = state.clone();
    let status_for_reset = status.clone();
    reset_local.connect_clicked(move |_| {
        confirm_reset_local_data(
            &locale_for_reset,
            &window_for_reset,
            state_for_reset.clone(),
            status_for_reset.clone(),
        );
    });
    box_.append(&reset_local);
    let clear_cloud = gtk::Button::with_label(tr(locale, "action.clearCloudData"));
    clear_cloud.add_css_class("destructive-action");
    let locale_for_clear_cloud = locale.to_owned();
    let window_for_clear_cloud = window.clone();
    let state_for_clear_cloud = state;
    let status_for_clear_cloud = status.clone();
    clear_cloud.connect_clicked(move |button| {
        confirm_clear_cloud_data(
            &locale_for_clear_cloud,
            &window_for_clear_cloud,
            state_for_clear_cloud.clone(),
            status_for_clear_cloud.clone(),
            button.clone(),
        );
    });
    box_.append(&clear_cloud);
    box_
}
