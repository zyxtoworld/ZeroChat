use crate::{
    ImageTaskMode, LinuxAppState,
    chat_image_controls::ImageComposerControls,
    chat_mode_controls::{ComposeMode, ComposerModeControls},
    chat_send_actions::{ActiveChatStream, connect_send_action, text_view_text},
    i18n::tr,
    providers::{active_image_provider_model_label, chat_composer_hint, image_composer_hint},
    ui_helpers::{edge_margin, row_spacing},
};
use gtk::{glib, prelude::*};
use std::{cell::RefCell, rc::Rc};

pub(crate) fn composer(
    messages: &gtk::ListBox,
    scroller: &gtk::ScrolledWindow,
    notice: &gtk::Label,
    locale: &str,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    focus_on_build: bool,
) -> gtk::Box {
    let composer = gtk::Box::new(gtk::Orientation::Vertical, row_spacing(compact));
    composer.set_margin_top(if compact { 8 } else { 10 });
    composer.set_margin_bottom(edge_margin(compact));
    composer.set_margin_start(edge_margin(compact));
    composer.set_margin_end(edge_margin(compact));

    let chat_streaming = Rc::new(RefCell::new(None::<ActiveChatStream>));

    let mode_controls = ComposerModeControls::new(locale);
    composer.append(&mode_controls.mode_row);

    let image_model_hint = gtk::Label::new(Some(""));
    image_model_hint.set_xalign(0.0);
    image_model_hint.set_wrap(true);
    image_model_hint.add_css_class("dim-label");
    composer.append(&image_model_hint);

    composer.append(&mode_controls.image_mode_row);

    let image_controls = ImageComposerControls::new(locale, compact);
    composer.append(&image_controls.tools);

    let row = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    let input = gtk::TextView::new();
    input.set_wrap_mode(gtk::WrapMode::WordChar);
    input.set_vexpand(false);
    input.set_hexpand(true);
    input.set_size_request(-1, if compact { 56 } else { 76 });
    let input_hint = gtk::Label::new(Some(tr(locale, "placeholder.message")));
    input_hint.set_xalign(0.0);
    input_hint.add_css_class("dim-label");
    composer.append(&input_hint);

    let send = gtk::Button::with_label(tr(locale, "action.send"));
    send.add_css_class("suggested-action");
    send.set_halign(gtk::Align::End);
    let refresh_controls: Rc<dyn Fn()> = {
        let compose_mode = mode_controls.compose_mode.clone();
        let image_task_mode = mode_controls.image_task_mode.clone();
        let image_mode_row = mode_controls.image_mode_row.clone();
        let row = row.clone();
        let image_controls = image_controls.clone();
        let input_for_refresh = input.clone();
        let image_model_hint = image_model_hint.clone();
        let input_hint = input_hint.clone();
        let send = send.clone();
        let notice = notice.clone();
        let state = state.clone();
        let chat_streaming = chat_streaming.clone();
        let locale = locale.to_owned();
        Rc::new(move || {
            let is_image = *compose_mode.borrow() == ComposeMode::Image;
            let is_streaming = chat_streaming.borrow().is_some();
            let task_mode = *image_task_mode.borrow();
            let stack_image_action = is_image && compact;

            image_model_hint.set_visible(is_image);
            if is_image {
                image_model_hint.set_text(&active_image_provider_model_label(&locale, &state));
            }
            image_mode_row.set_visible(is_image);
            image_controls.refresh_visibility(is_image, task_mode);
            row.set_orientation(if stack_image_action {
                gtk::Orientation::Vertical
            } else {
                gtk::Orientation::Horizontal
            });
            send.set_hexpand(stack_image_action);
            send.set_halign(if stack_image_action {
                gtk::Align::Fill
            } else {
                gtk::Align::End
            });
            input_hint.set_text(if is_image {
                tr(&locale, "placeholder.imagePrompt")
            } else {
                tr(&locale, "placeholder.message")
            });
            send.set_label(if is_streaming {
                tr(&locale, "action.stopGenerating")
            } else if is_image {
                match task_mode {
                    ImageTaskMode::Generate => tr(&locale, "action.generate"),
                    ImageTaskMode::Edit => tr(&locale, "mode.imageEdit"),
                    ImageTaskMode::Inpaint => tr(&locale, "mode.imageInpaint"),
                }
            } else {
                tr(&locale, "action.send")
            });
            if is_streaming {
                send.set_sensitive(true);
                return;
            }
            let text = text_view_text(&input_for_refresh);
            if is_image {
                let source = image_controls.source_upload.borrow();
                let mask = image_controls.mask_upload.borrow();
                if let Some(hint) =
                    image_composer_hint(&locale, &state, task_mode, source.as_ref(), mask.as_ref())
                {
                    notice.set_text(&hint);
                    notice.add_css_class("warning");
                    send.set_sensitive(false);
                } else {
                    notice.set_text("");
                    notice.remove_css_class("warning");
                    send.set_sensitive(!text.is_empty());
                }
            } else if let Some(hint) = chat_composer_hint(&locale, &state) {
                notice.set_text(&hint);
                notice.add_css_class("warning");
                send.set_sensitive(false);
            } else {
                notice.set_text("");
                notice.remove_css_class("warning");
                send.set_sensitive(!text.is_empty());
            }
        })
    };
    refresh_controls();
    {
        let refresh_controls = refresh_controls.clone();
        input.buffer().connect_changed(move |_| refresh_controls());
    }
    mode_controls.connect_actions(refresh_controls.clone());
    image_controls.connect_actions(locale, window, notice, refresh_controls.clone());
    {
        let send_for_shortcut = send.clone();
        let send_shortcut = gtk::EventControllerKey::new();
        send_shortcut.connect_key_pressed(move |_, key, _, state| {
            let is_enter = matches!(
                key,
                gtk::gdk::Key::Return | gtk::gdk::Key::KP_Enter | gtk::gdk::Key::ISO_Enter
            );
            if is_enter
                && state.contains(gtk::gdk::ModifierType::CONTROL_MASK)
                && send_for_shortcut.is_sensitive()
            {
                send_for_shortcut.emit_clicked();
                return glib::Propagation::Stop;
            }

            glib::Propagation::Proceed
        });
        input.add_controller(send_shortcut);
    }

    connect_send_action(
        &send,
        messages,
        scroller,
        &input,
        notice,
        locale,
        compact,
        window,
        state.clone(),
        mode_controls.compose_mode.clone(),
        mode_controls.image_task_mode.clone(),
        image_controls.clone(),
        chat_streaming.clone(),
        refresh_controls.clone(),
    );

    let streaming_for_unrealize = chat_streaming;
    let state_for_unrealize = state;
    let stopped_content = tr(locale, "message.generationStopped").to_owned();
    composer.connect_unrealize(move |_| {
        let Some(active) = streaming_for_unrealize.borrow_mut().take() else {
            return;
        };
        active.cancel_after_surface_detached(&state_for_unrealize, &stopped_content);
    });

    row.append(&input);
    row.append(&send);
    composer.append(&row);

    if focus_on_build {
        let input_for_focus = input.clone();
        glib::idle_add_local_once(move || {
            input_for_focus.grab_focus();
        });
    }

    composer
}
