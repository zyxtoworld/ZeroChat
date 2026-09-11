use crate::{
    LinuxAppState,
    atomic_file::write_private_file_atomically,
    dialogs::{RESPONSE_ACCEPT, destructive_confirmation_dialog},
    i18n::{localize_sync_error, tr},
    local_file::{
        MAX_ENCRYPTED_BACKUP_FILE_BYTES, ensure_local_file_size, local_file_too_large_message,
        read_bounded_local_file_text,
    },
    set_window_content,
};
use adw::prelude::*;

pub(crate) fn show_export_encrypted_backup_dialog(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    status: gtk::Label,
) {
    if state.sync_passphrase().trim().is_empty() {
        status.set_text(tr(locale, "notice.backupExportNeedsPassphrase"));
        return;
    }

    let dialog = gtk::FileChooserNative::builder()
        .title(tr(locale, "action.exportEncryptedBackup"))
        .transient_for(window)
        .action(gtk::FileChooserAction::Save)
        .accept_label(tr(locale, "action.exportEncryptedBackup"))
        .cancel_label(tr(locale, "action.cancel"))
        .build();
    dialog.set_current_name(&backup_file_name());
    add_json_filter(&dialog);

    let locale_for_response = locale.to_owned();
    let state_for_response = state.clone();
    let status_for_response = status.clone();
    dialog.connect_response(move |dialog, response| {
        if response == gtk::ResponseType::Accept {
            let result = dialog
                .file()
                .and_then(|file| file.path())
                .ok_or_else(|| {
                    tr(&locale_for_response, "notice.backupExportFailedPrefix").to_owned()
                })
                .and_then(|path| {
                    state_for_response
                        .export_encrypted_backup()
                        .map_err(|error| error.to_string())
                        .and_then(|text| {
                            let too_large = local_file_too_large_message(
                                &locale_for_response,
                                MAX_ENCRYPTED_BACKUP_FILE_BYTES,
                            );
                            ensure_local_file_size(
                                text.len(),
                                MAX_ENCRYPTED_BACKUP_FILE_BYTES,
                                &too_large,
                            )?;
                            write_private_file_atomically(&path, text.as_bytes())
                                .map_err(|error| error.to_string())
                        })
                });

            match result {
                Ok(()) => status_for_response
                    .set_text(tr(&locale_for_response, "notice.backupExportStarted")),
                Err(message) => status_for_response.set_text(&format!(
                    "{}: {}",
                    tr(&locale_for_response, "notice.backupExportFailedPrefix"),
                    localize_backup_error(&locale_for_response, &message)
                )),
            }
        }
        dialog.destroy();
    });
    dialog.show();
}

pub(crate) fn confirm_import_encrypted_backup(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    status: gtk::Label,
) {
    if state.sync_passphrase().trim().is_empty() {
        status.set_text(tr(locale, "notice.backupImportNeedsPassphrase"));
        return;
    }

    let body = format!(
        "{}\n\n{}\n{}\n{}",
        tr(locale, "danger.import.body"),
        tr(locale, "danger.import.detail1"),
        tr(locale, "danger.import.detail2"),
        tr(locale, "danger.import.detail3"),
    );
    let dialog = destructive_confirmation_dialog(
        locale,
        window,
        "danger.import.title",
        &body,
        "action.importEncryptedBackup",
    );

    let locale_for_response = locale.to_owned();
    let window_for_response = window.clone();
    let state_for_response = state.clone();
    let status_for_response = status.clone();
    dialog.connect_response(None, move |dialog, response| {
        if response == RESPONSE_ACCEPT {
            show_import_encrypted_backup_dialog(
                &locale_for_response,
                &window_for_response,
                state_for_response.clone(),
                status_for_response.clone(),
            );
        }
        dialog.close();
    });
    dialog.present();
}

fn show_import_encrypted_backup_dialog(
    locale: &str,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    status: gtk::Label,
) {
    let dialog = gtk::FileChooserNative::builder()
        .title(tr(locale, "action.importEncryptedBackup"))
        .transient_for(window)
        .action(gtk::FileChooserAction::Open)
        .accept_label(tr(locale, "action.importEncryptedBackup"))
        .cancel_label(tr(locale, "action.cancel"))
        .build();
    add_json_filter(&dialog);

    let locale_for_response = locale.to_owned();
    let window_for_response = window.clone();
    let state_for_response = state.clone();
    let status_for_response = status.clone();
    dialog.connect_response(move |dialog, response| {
        if response == gtk::ResponseType::Accept {
            let result = dialog
                .file()
                .and_then(|file| file.path())
                .ok_or_else(|| {
                    tr(&locale_for_response, "notice.backupImportFailedPrefix").to_owned()
                })
                .and_then(|path| {
                    let too_large = local_file_too_large_message(
                        &locale_for_response,
                        MAX_ENCRYPTED_BACKUP_FILE_BYTES,
                    );
                    read_bounded_local_file_text(&path, MAX_ENCRYPTED_BACKUP_FILE_BYTES, &too_large)
                })
                .and_then(|text| {
                    state_for_response
                        .import_encrypted_backup(&text)
                        .map_err(|error| error.to_string())
                });

            match result {
                Ok(()) => {
                    status_for_response.set_text(tr(&locale_for_response, "notice.backupImported"));
                    set_window_content(
                        &window_for_response,
                        state_for_response.clone(),
                        "settings",
                    );
                }
                Err(message) => status_for_response.set_text(&format!(
                    "{}: {}",
                    tr(&locale_for_response, "notice.backupImportFailedPrefix"),
                    localize_backup_error(&locale_for_response, &message)
                )),
            }
        }
        dialog.destroy();
    });
    dialog.show();
}

fn add_json_filter(dialog: &gtk::FileChooserNative) {
    let filter = gtk::FileFilter::new();
    filter.set_name(Some("ZeroChat JSON"));
    filter.add_mime_type("application/json");
    filter.add_pattern("*.json");
    dialog.add_filter(&filter);
}

fn localize_backup_error(locale: &str, message: &str) -> String {
    let trimmed = message.trim();

    if trimmed == "Data encryption password is required." {
        return tr(locale, "message.dataPasswordRequired").to_owned();
    }
    if trimmed == "File format is invalid"
        || trimmed == "File format is invalid."
        || trimmed == "Remote snapshot payload has invalid format."
    {
        return tr(locale, "notice.backupImportFormatInvalid").to_owned();
    }
    if trimmed == "Remote data is not a supported ZeroChat encrypted snapshot." {
        return tr(locale, "notice.backupImportEncryptedOnly").to_owned();
    }

    localize_sync_error(locale, trimmed)
}

fn backup_file_name() -> String {
    let date = gtk::glib::DateTime::now_local()
        .and_then(|value| value.format("%Y-%m-%d"))
        .map(|value| value.to_string())
        .unwrap_or_else(|_| "backup".to_owned());
    format!("zerochat-encrypted-{date}.json")
}
