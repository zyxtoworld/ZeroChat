use crate::{
    ai::{GeneratedImage, ImageUpload},
    i18n::tr,
    local_file::{
        MAX_IMAGE_FILE_BYTES, local_file_too_large_message, read_bounded_local_file_bytes,
    },
    models::MessageAttachment,
    now_millis,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use gtk::prelude::*;
use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    rc::Rc,
    time::Duration,
};
use uuid::Uuid;

#[derive(Default)]
pub(crate) struct LinuxSpeechPlayback {
    speaking_message_id: Option<String>,
    serial: u64,
    player: Option<gtk::MediaFile>,
    temp_path: Option<PathBuf>,
}

impl LinuxSpeechPlayback {
    pub(crate) fn speaking_message_id(&self) -> Option<String> {
        self.speaking_message_id.clone()
    }

    pub(crate) fn begin(&mut self, message_id: &str) -> u64 {
        self.stop();
        self.serial = self.serial.saturating_add(1);
        self.speaking_message_id = Some(message_id.to_owned());
        self.serial
    }

    pub(crate) fn is_current(&self, message_id: &str, serial: u64) -> bool {
        self.serial == serial && self.speaking_message_id.as_deref() == Some(message_id)
    }

    pub(crate) fn stop(&mut self) -> bool {
        let was_speaking = self.speaking_message_id.is_some();
        if let Some(player) = &self.player {
            player.pause();
        }
        self.player = None;
        self.speaking_message_id = None;
        if let Some(path) = self.temp_path.take() {
            let _ = std::fs::remove_file(path);
        }
        was_speaking
    }

    fn set_player(&mut self, player: gtk::MediaFile, path: PathBuf) {
        if let Some(old_path) = self.temp_path.replace(path) {
            let _ = std::fs::remove_file(old_path);
        }
        self.player = Some(player);
    }

    fn finish_if_current(&mut self, message_id: &str, serial: u64) -> bool {
        if !self.is_current(message_id, serial) {
            return false;
        }
        self.stop();
        true
    }
}

pub(crate) fn choose_image_file(
    locale: &str,
    window: &adw::ApplicationWindow,
    target: Rc<RefCell<Option<ImageUpload>>>,
    button: gtk::Button,
    notice: gtk::Label,
    refresh_controls: Rc<dyn Fn()>,
    title: &str,
) {
    let dialog = gtk::FileChooserNative::new(
        Some(title),
        Some(window),
        gtk::FileChooserAction::Open,
        Some(tr(locale, "action.done")),
        Some(tr(locale, "action.cancel")),
    );
    let filter = gtk::FileFilter::new();
    filter.set_name(Some(tr(locale, "mode.image")));
    for mime in ["image/png", "image/jpeg", "image/webp"] {
        filter.add_mime_type(mime);
    }
    dialog.add_filter(&filter);

    let locale = locale.to_owned();
    dialog.connect_response(move |dialog, response| {
        if response == gtk::ResponseType::Accept {
            let result = dialog
                .file()
                .and_then(|file| file.path())
                .ok_or_else(|| tr(&locale, "message.imageReadFailedPrefix").to_owned())
                .and_then(|path| read_image_upload(&path, &locale));

            match result {
                Ok(upload) => {
                    button.set_label(&upload.file_name);
                    *target.borrow_mut() = Some(upload);
                    notice.set_text(tr(&locale, "message.imageAttached"));
                    refresh_controls();
                }
                Err(message) => {
                    notice.set_text(&format!(
                        "{}: {}",
                        tr(&locale, "message.imageReadFailedPrefix"),
                        message
                    ));
                    notice.add_css_class("warning");
                }
            }
        }
        dialog.destroy();
    });
    dialog.show();
}

pub(crate) fn upload_to_attachment(
    upload: &ImageUpload,
    purpose: &str,
    alt: &str,
    created_at: i64,
) -> MessageAttachment {
    MessageAttachment {
        id: format!("linux-attachment-{}", Uuid::new_v4()),
        kind: "image".to_owned(),
        purpose: Some(purpose.to_owned()),
        mime_type: upload.mime_type.clone(),
        data_url: Some(format!(
            "data:{};base64,{}",
            upload.mime_type,
            BASE64_STANDARD.encode(&upload.bytes)
        )),
        url: None,
        alt: Some(alt.to_owned()),
        model: None,
        created_at,
    }
}

pub(crate) fn generated_image_attachment(
    image: GeneratedImage,
    prompt: &str,
    model: &str,
) -> MessageAttachment {
    MessageAttachment {
        id: format!("linux-attachment-{}", Uuid::new_v4()),
        kind: "image".to_owned(),
        purpose: Some("generated".to_owned()),
        mime_type: image.mime_type,
        data_url: image.data_url,
        url: image.url,
        alt: Some(prompt.to_owned()),
        model: Some(model.to_owned()),
        created_at: now_millis(),
    }
}

pub(crate) fn save_data_url_to_downloads(
    data_url: &str,
    mime_type: &str,
) -> Result<PathBuf, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, payload)| payload)
        .ok_or_else(|| "Invalid data URL".to_owned())?;
    let bytes = BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|error| error.to_string())?;
    let mut path = downloads_dir();
    path.push(format!(
        "zerochat-image-{}.{}",
        now_millis(),
        image_extension_for_mime(mime_type)
    ));
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    Ok(path)
}

pub(crate) fn play_speech_audio_bytes(
    playback: Rc<RefCell<LinuxSpeechPlayback>>,
    message_id: String,
    serial: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("Audio response was empty.".to_owned());
    }

    if !playback.borrow().is_current(&message_id, serial) {
        return Ok(());
    }

    let path = speech_temp_path();
    std::fs::write(&path, bytes).map_err(|error| error.to_string())?;
    let file = gtk::gio::File::for_path(&path);
    let player = gtk::MediaFile::for_file(&file);
    player.play();
    playback.borrow_mut().set_player(player.clone(), path);

    let playback_for_finish = playback;
    gtk::glib::timeout_add_local(Duration::from_millis(300), move || {
        if !playback_for_finish.borrow().is_current(&message_id, serial) {
            return gtk::glib::ControlFlow::Break;
        }

        if player.is_ended() {
            playback_for_finish
                .borrow_mut()
                .finish_if_current(&message_id, serial);
            return gtk::glib::ControlFlow::Break;
        }

        gtk::glib::ControlFlow::Continue
    });

    Ok(())
}

pub(crate) fn open_default_uri(uri: &str) -> Result<(), String> {
    gtk::gio::AppInfo::launch_default_for_uri(uri, None::<&gtk::gio::AppLaunchContext>)
        .map_err(|error| error.to_string())
}

fn read_image_upload(path: &Path, locale: &str) -> Result<ImageUpload, String> {
    let too_large = local_file_too_large_message(locale, MAX_IMAGE_FILE_BYTES);
    let bytes = read_bounded_local_file_bytes(path, MAX_IMAGE_FILE_BYTES, &too_large)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("image.png")
        .to_owned();
    Ok(ImageUpload {
        bytes,
        file_name,
        mime_type: mime_type_from_path(path),
    })
}

fn mime_type_from_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
    .to_owned()
}

fn downloads_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|path| path.join("Downloads"))
        .filter(|path| path.exists())
        .unwrap_or_else(std::env::temp_dir)
}

fn speech_temp_path() -> PathBuf {
    std::env::temp_dir().join(format!("zerochat-speech-{}.mp3", now_millis()))
}

fn image_extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    }
}
