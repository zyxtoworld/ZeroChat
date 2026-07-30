use crate::{
    ai_protocol::{safe_generated_image_data_url, safe_generated_image_url},
    i18n::tr,
    media::{open_default_uri, save_data_url_to_downloads},
    models::MessageAttachment,
    ui_helpers::row_spacing,
};
use gtk::prelude::*;

pub(crate) fn message_attachments(
    locale: &str,
    attachments: &[MessageAttachment],
    compact: bool,
) -> gtk::Box {
    let list = gtk::Box::new(gtk::Orientation::Vertical, row_spacing(compact));

    for attachment in attachments
        .iter()
        .filter(|attachment| attachment.kind == "image")
    {
        let row = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
        row.set_margin_top(row_spacing(compact));

        let label = gtk::Label::new(Some(
            attachment
                .alt
                .as_deref()
                .filter(|alt| !alt.trim().is_empty())
                .unwrap_or_else(|| tr(locale, "message.imageAttached")),
        ));
        label.set_xalign(0.0);
        label.set_wrap(true);
        label.add_css_class("dim-label");
        row.append(&label);

        if let Some((data_url, safe_mime_type)) = attachment
            .data_url
            .as_deref()
            .and_then(safe_generated_image_data_url)
        {
            let download = gtk::Button::with_label(tr(locale, "action.downloadImage"));
            let locale_for_download = locale.to_owned();
            download.connect_clicked(move |button| {
                match save_data_url_to_downloads(&data_url, &safe_mime_type) {
                    Ok(path) => {
                        let label = path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or_else(|| tr(&locale_for_download, "action.done"));
                        button.set_label(label);
                    }
                    Err(message) => {
                        button.set_label(&format!(
                            "{}: {}",
                            tr(&locale_for_download, "message.imageRequestFailed"),
                            message
                        ));
                    }
                }
            });
            row.append(&download);
        }

        if let Some(url) = attachment.url.as_deref().and_then(safe_generated_image_url) {
            let open = gtk::Button::with_label(tr(locale, "action.openGeneratedImage"));
            let locale_for_open = locale.to_owned();
            open.connect_clicked(move |button| {
                if let Err(message) = open_default_uri(&url) {
                    button.set_label(&format!(
                        "{}: {}",
                        tr(&locale_for_open, "message.imageRequestFailed"),
                        message
                    ));
                }
            });
            row.append(&open);
        }

        list.append(&row);
    }

    list
}
