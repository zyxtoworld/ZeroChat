use crate::{
    ImageTaskMode, ai::ImageUpload, i18n::tr, media::choose_image_file, ui_helpers::row_spacing,
};
use gtk::prelude::*;
use std::{cell::RefCell, rc::Rc};

#[derive(Clone)]
pub(crate) struct ImageComposerControls {
    pub(crate) tools: gtk::Box,
    source_row: gtk::Box,
    mask_row: gtk::Box,
    source_button: gtk::Button,
    mask_button: gtk::Button,
    clear_source: gtk::Button,
    clear_mask: gtk::Button,
    pub(crate) source_upload: Rc<RefCell<Option<ImageUpload>>>,
    pub(crate) mask_upload: Rc<RefCell<Option<ImageUpload>>>,
}

impl ImageComposerControls {
    pub(crate) fn new(locale: &str, compact: bool) -> Self {
        let tools = gtk::Box::new(gtk::Orientation::Vertical, row_spacing(compact));
        let source_row = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
        let mask_row = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
        let source_button = gtk::Button::with_label(tr(locale, "placeholder.sourceImage"));
        source_button.set_hexpand(true);
        source_button.set_halign(gtk::Align::Fill);
        let clear_source = gtk::Button::with_label(tr(locale, "action.clear"));
        let mask_button = gtk::Button::with_label(tr(locale, "placeholder.maskImage"));
        mask_button.set_hexpand(true);
        mask_button.set_halign(gtk::Align::Fill);
        let clear_mask = gtk::Button::with_label(tr(locale, "action.clear"));

        source_row.append(&source_button);
        source_row.append(&clear_source);
        mask_row.append(&mask_button);
        mask_row.append(&clear_mask);
        tools.append(&source_row);
        tools.append(&mask_row);

        Self {
            tools,
            source_row,
            mask_row,
            source_button,
            mask_button,
            clear_source,
            clear_mask,
            source_upload: Rc::new(RefCell::new(None)),
            mask_upload: Rc::new(RefCell::new(None)),
        }
    }

    pub(crate) fn connect_actions(
        &self,
        locale: &str,
        window: &adw::ApplicationWindow,
        notice: &gtk::Label,
        refresh_controls: Rc<dyn Fn()>,
    ) {
        {
            let locale = locale.to_owned();
            let window = window.clone();
            let target = self.source_upload.clone();
            let button = self.source_button.clone();
            let notice = notice.clone();
            let refresh_controls = refresh_controls.clone();
            self.source_button.connect_clicked(move |_| {
                choose_image_file(
                    &locale,
                    &window,
                    target.clone(),
                    button.clone(),
                    notice.clone(),
                    refresh_controls.clone(),
                    tr(&locale, "placeholder.sourceImage"),
                );
            });
        }
        {
            let locale = locale.to_owned();
            let target = self.source_upload.clone();
            let button = self.source_button.clone();
            let refresh_controls = refresh_controls.clone();
            self.clear_source.connect_clicked(move |_| {
                target.borrow_mut().take();
                button.set_label(tr(&locale, "placeholder.sourceImage"));
                refresh_controls();
            });
        }
        {
            let locale = locale.to_owned();
            let window = window.clone();
            let target = self.mask_upload.clone();
            let button = self.mask_button.clone();
            let notice = notice.clone();
            let refresh_controls = refresh_controls.clone();
            self.mask_button.connect_clicked(move |_| {
                choose_image_file(
                    &locale,
                    &window,
                    target.clone(),
                    button.clone(),
                    notice.clone(),
                    refresh_controls.clone(),
                    tr(&locale, "placeholder.maskImage"),
                );
            });
        }
        {
            let locale = locale.to_owned();
            let target = self.mask_upload.clone();
            let button = self.mask_button.clone();
            self.clear_mask.connect_clicked(move |_| {
                target.borrow_mut().take();
                button.set_label(tr(&locale, "placeholder.maskImage"));
                refresh_controls();
            });
        }
    }

    pub(crate) fn refresh_visibility(&self, is_image: bool, task_mode: ImageTaskMode) {
        let needs_source = is_image && task_mode != ImageTaskMode::Generate;
        let needs_mask = is_image && task_mode == ImageTaskMode::Inpaint;

        self.tools.set_visible(needs_source || needs_mask);
        self.source_row.set_visible(needs_source);
        self.source_button.set_visible(needs_source);
        self.clear_source
            .set_visible(needs_source && self.source_upload.borrow().is_some());
        self.mask_row.set_visible(needs_mask);
        self.mask_button.set_visible(needs_mask);
        self.clear_mask
            .set_visible(needs_mask && self.mask_upload.borrow().is_some());
    }

    pub(crate) fn clear_uploads(&self, locale: &str) {
        self.source_upload.borrow_mut().take();
        self.mask_upload.borrow_mut().take();
        self.source_button
            .set_label(tr(locale, "placeholder.sourceImage"));
        self.mask_button
            .set_label(tr(locale, "placeholder.maskImage"));
    }
}
