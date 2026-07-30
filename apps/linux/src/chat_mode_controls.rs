use crate::{ImageTaskMode, i18n::tr};
use gtk::prelude::*;
use std::{cell::RefCell, rc::Rc};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ComposeMode {
    Chat,
    Image,
}

#[derive(Clone)]
pub(crate) struct ComposerModeControls {
    pub(crate) mode_row: gtk::Box,
    pub(crate) image_mode_row: gtk::Box,
    pub(crate) compose_mode: Rc<RefCell<ComposeMode>>,
    pub(crate) image_task_mode: Rc<RefCell<ImageTaskMode>>,
    chat_mode: gtk::ToggleButton,
    image_mode: gtk::ToggleButton,
    generate_mode: gtk::ToggleButton,
    edit_mode: gtk::ToggleButton,
    inpaint_mode: gtk::ToggleButton,
}

impl ComposerModeControls {
    pub(crate) fn new(locale: &str) -> Self {
        let compose_mode = Rc::new(RefCell::new(ComposeMode::Chat));
        let image_task_mode = Rc::new(RefCell::new(ImageTaskMode::Generate));

        let mode_row = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        mode_row.add_css_class("linked");
        let chat_mode = gtk::ToggleButton::with_label(tr(locale, "mode.chat"));
        chat_mode.set_active(true);
        let image_mode = gtk::ToggleButton::with_label(tr(locale, "mode.image"));
        mode_row.append(&chat_mode);
        mode_row.append(&image_mode);

        let image_mode_row = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        image_mode_row.add_css_class("linked");
        let generate_mode = gtk::ToggleButton::with_label(tr(locale, "mode.imageGenerateShort"));
        generate_mode.set_tooltip_text(Some(tr(locale, "mode.imageGenerate")));
        generate_mode.set_active(true);
        let edit_mode = gtk::ToggleButton::with_label(tr(locale, "mode.imageEditShort"));
        edit_mode.set_tooltip_text(Some(tr(locale, "mode.imageEdit")));
        let inpaint_mode = gtk::ToggleButton::with_label(tr(locale, "mode.imageInpaintShort"));
        inpaint_mode.set_tooltip_text(Some(tr(locale, "mode.imageInpaint")));
        image_mode_row.append(&generate_mode);
        image_mode_row.append(&edit_mode);
        image_mode_row.append(&inpaint_mode);

        Self {
            mode_row,
            image_mode_row,
            compose_mode,
            image_task_mode,
            chat_mode,
            image_mode,
            generate_mode,
            edit_mode,
            inpaint_mode,
        }
    }

    pub(crate) fn connect_actions(&self, refresh_controls: Rc<dyn Fn()>) {
        {
            let compose_mode = self.compose_mode.clone();
            let image_mode = self.image_mode.clone();
            let refresh_controls = refresh_controls.clone();
            self.chat_mode.connect_toggled(move |button| {
                if button.is_active() {
                    *compose_mode.borrow_mut() = ComposeMode::Chat;
                    image_mode.set_active(false);
                    refresh_controls();
                } else if !image_mode.is_active() {
                    button.set_active(true);
                }
            });
        }
        {
            let compose_mode = self.compose_mode.clone();
            let chat_mode = self.chat_mode.clone();
            let refresh_controls = refresh_controls.clone();
            self.image_mode.connect_toggled(move |button| {
                if button.is_active() {
                    *compose_mode.borrow_mut() = ComposeMode::Image;
                    chat_mode.set_active(false);
                    refresh_controls();
                } else if !chat_mode.is_active() {
                    button.set_active(true);
                }
            });
        }
        {
            let image_task_mode = self.image_task_mode.clone();
            let edit_mode = self.edit_mode.clone();
            let inpaint_mode = self.inpaint_mode.clone();
            let refresh_controls = refresh_controls.clone();
            self.generate_mode.connect_toggled(move |button| {
                if button.is_active() {
                    *image_task_mode.borrow_mut() = ImageTaskMode::Generate;
                    edit_mode.set_active(false);
                    inpaint_mode.set_active(false);
                    refresh_controls();
                }
            });
        }
        {
            let image_task_mode = self.image_task_mode.clone();
            let generate_mode = self.generate_mode.clone();
            let inpaint_mode = self.inpaint_mode.clone();
            let refresh_controls = refresh_controls.clone();
            self.edit_mode.connect_toggled(move |button| {
                if button.is_active() {
                    *image_task_mode.borrow_mut() = ImageTaskMode::Edit;
                    generate_mode.set_active(false);
                    inpaint_mode.set_active(false);
                    refresh_controls();
                }
            });
        }
        {
            let image_task_mode = self.image_task_mode.clone();
            let generate_mode = self.generate_mode.clone();
            let edit_mode = self.edit_mode.clone();
            self.inpaint_mode.connect_toggled(move |button| {
                if button.is_active() {
                    *image_task_mode.borrow_mut() = ImageTaskMode::Inpaint;
                    generate_mode.set_active(false);
                    edit_mode.set_active(false);
                    refresh_controls();
                }
            });
        }
    }
}
