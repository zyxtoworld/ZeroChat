use crate::{
    LinuxAppState,
    i18n::{replace_placeholders, tr},
    local_file::{
        MAX_SKILL_FILE_BYTES, local_file_too_large_message, read_bounded_local_file_text,
    },
    skill_list::{SKILL_LIST_INITIAL_RENDER_LIMIT, render_skill_list},
    skills::{
        content_type_from_file_name, create_native_skill, normalize_whitespace,
        skill_name_from_file_name,
    },
    ui_helpers::{settings_box, settings_text},
};
use gtk::prelude::*;
use std::{cell::RefCell, rc::Rc};

fn parse_bounded_i32(value: &str, fallback: i32, min: i32, max: i32) -> i32 {
    value
        .trim()
        .parse::<i32>()
        .unwrap_or(fallback)
        .clamp(min, max)
}

pub(crate) fn skills_settings(
    locale: &str,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
) -> gtk::Box {
    let box_ = settings_box(compact);
    let help = settings_text(tr(locale, "settings.skillsHelp"));
    help.add_css_class("dim-label");
    box_.append(&help);

    let global_auto = gtk::CheckButton::with_label(tr(locale, "label.skillGlobalAutoMatch"));
    global_auto.set_active(state.skill_settings().auto_match);
    let state_for_global_auto = state.clone();
    global_auto.connect_toggled(move |button| {
        state_for_global_auto.update_skill_settings(|settings| {
            settings.auto_match = button.is_active();
        });
    });
    box_.append(&global_auto);

    let context_budget = gtk::Entry::builder()
        .placeholder_text(tr(locale, "field.skillContextBudget"))
        .text(state.skill_settings().context_budget.to_string())
        .build();
    let state_for_budget = state.clone();
    context_budget.connect_changed(move |entry| {
        let value = parse_bounded_i32(&entry.text(), 2400, 400, 20000);
        state_for_budget.update_skill_settings(|settings| {
            settings.context_budget = value;
        });
    });
    box_.append(&context_budget);

    let auto_count = gtk::Entry::builder()
        .placeholder_text(tr(locale, "field.skillAutoCount"))
        .text(state.skill_settings().max_auto_skills.to_string())
        .build();
    let state_for_auto_count = state.clone();
    auto_count.connect_changed(move |entry| {
        let value = parse_bounded_i32(&entry.text(), 3, 1, 12);
        state_for_auto_count.update_skill_settings(|settings| {
            settings.max_auto_skills = value;
        });
    });
    box_.append(&auto_count);

    box_.append(&settings_text(tr(locale, "settings.skillBudgetNote")));

    let status = gtk::Label::new(Some(""));
    status.set_xalign(0.0);
    status.add_css_class("dim-label");

    let skills_list = gtk::Box::new(gtk::Orientation::Vertical, 0);
    let render_limit = Rc::new(RefCell::new(SKILL_LIST_INITIAL_RENDER_LIMIT));

    let import_skill = gtk::Button::with_label(tr(locale, "button.importSkill"));
    let window_for_import = window.clone();
    let state_for_import = state.clone();
    let list_for_import = skills_list.clone();
    let status_for_import = status.clone();
    let render_limit_for_import = render_limit.clone();
    let locale_for_import = locale.to_owned();
    import_skill.connect_clicked(move |_| {
        let dialog = gtk::FileChooserNative::builder()
            .title(tr(&locale_for_import, "button.importSkill"))
            .transient_for(&window_for_import)
            .action(gtk::FileChooserAction::Open)
            .accept_label(tr(&locale_for_import, "button.importSkill"))
            .cancel_label(tr(&locale_for_import, "action.cancel"))
            .modal(true)
            .build();
        let state_for_response = state_for_import.clone();
        let list_for_response = list_for_import.clone();
        let status_for_response = status_for_import.clone();
        let render_limit_for_response = render_limit_for_import.clone();
        let locale_for_response = locale_for_import.clone();
        dialog.connect_response(move |dialog, response| {
            if response == gtk::ResponseType::Accept {
                if let Some(file) = dialog.file() {
                    if let Some(path) = file.path() {
                        let too_large = local_file_too_large_message(
                            &locale_for_response,
                            MAX_SKILL_FILE_BYTES,
                        );
                        match read_bounded_local_file_text(&path, MAX_SKILL_FILE_BYTES, &too_large)
                        {
                            Ok(content) => {
                                let file_name = path
                                    .file_name()
                                    .and_then(|name| name.to_str())
                                    .unwrap_or("skill.txt")
                                    .to_owned();
                                let name = skill_name_from_file_name(
                                    &file_name,
                                    tr(&locale_for_response, "fallback.skillName"),
                                );
                                let content_type = content_type_from_file_name(&file_name);
                                if let Some(skill) = create_native_skill(
                                    &name,
                                    &content,
                                    &content_type,
                                    Some(file_name),
                                    tr(&locale_for_response, "fallback.skillName"),
                                    tr(&locale_for_response, "fallback.skillHeading"),
                                ) {
                                    state_for_response.add_skill(skill.clone());
                                    render_skill_list(
                                        &locale_for_response,
                                        compact,
                                        state_for_response.clone(),
                                        status_for_response.clone(),
                                        list_for_response.clone(),
                                        render_limit_for_response.clone(),
                                    );
                                    status_for_response
                                        .set_text(tr(&locale_for_response, "notice.skillAdded"));
                                } else {
                                    status_for_response.set_text(tr(
                                        &locale_for_response,
                                        "notice.skillContentRequired",
                                    ));
                                }
                            }
                            Err(error) => {
                                let message = replace_placeholders(
                                    tr(&locale_for_response, "notice.skillImportFailed"),
                                    &[("{message}", &error.to_string())],
                                );
                                status_for_response.set_text(&message);
                            }
                        }
                    }
                }
            }
            dialog.destroy();
        });
        dialog.show();
    });
    box_.append(&import_skill);

    render_skill_list(
        locale,
        compact,
        state.clone(),
        status.clone(),
        skills_list.clone(),
        render_limit.clone(),
    );
    box_.append(&status);
    box_.append(&skills_list);

    let name = gtk::Entry::builder()
        .placeholder_text(tr(locale, "placeholder.skillName"))
        .build();
    box_.append(&name);

    let content = gtk::TextView::new();
    content.set_wrap_mode(gtk::WrapMode::WordChar);
    content.set_size_request(-1, 120);
    let content_scroller = gtk::ScrolledWindow::builder()
        .child(&content)
        .min_content_height(if compact { 110 } else { 140 })
        .hexpand(true)
        .build();
    box_.append(&content_scroller);

    let add_skill = gtk::Button::with_label(tr(locale, "button.addSkill"));
    add_skill.set_sensitive(false);
    let add_skill_for_content = add_skill.clone();
    content.buffer().connect_changed(move |buffer| {
        let body = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), true)
            .to_string();
        add_skill_for_content.set_sensitive(!normalize_whitespace(&body).is_empty());
    });
    let name_for_add = name.clone();
    let content_for_add = content.clone();
    let state_for_add = state.clone();
    let list_for_add = skills_list.clone();
    let status_for_add = status.clone();
    let render_limit_for_add = render_limit.clone();
    let locale_for_add = locale.to_owned();
    add_skill.connect_clicked(move |_| {
        let buffer = content_for_add.buffer();
        let body = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), true)
            .to_string();
        let name = name_for_add.text().to_string();
        if let Some(skill) = create_native_skill(
            &name,
            &body,
            "text",
            None,
            tr(&locale_for_add, "fallback.skillName"),
            tr(&locale_for_add, "fallback.skillHeading"),
        ) {
            state_for_add.add_skill(skill.clone());
            render_skill_list(
                &locale_for_add,
                compact,
                state_for_add.clone(),
                status_for_add.clone(),
                list_for_add.clone(),
                render_limit_for_add.clone(),
            );
            name_for_add.set_text("");
            buffer.set_text("");
            status_for_add.set_text(tr(&locale_for_add, "notice.skillAdded"));
        } else {
            status_for_add.set_text(tr(&locale_for_add, "notice.skillContentRequired"));
        }
    });
    box_.append(&add_skill);
    box_
}
