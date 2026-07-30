use crate::{
    LinuxAppState,
    i18n::{format_number, replace_placeholders, tr},
    models::UserSkill,
    skills::{
        display_skill_name, normalize_whitespace, rebuild_skill_content, refresh_skill_keywords,
        skill_content, skill_meta_text,
    },
    ui_helpers::{editable_entry, row_spacing, settings_card, settings_text},
};
use gtk::prelude::*;
use std::{cell::RefCell, rc::Rc};

pub(crate) const SKILL_LIST_INITIAL_RENDER_LIMIT: usize = 80;
const SKILL_LIST_RENDER_BATCH: usize = 80;

fn clear_box_children(box_: &gtk::Box) {
    while let Some(child) = box_.first_child() {
        box_.remove(&child);
    }
}

fn skill_list_progress_text(locale: &str, shown: usize, total: usize) -> String {
    let shown_text = format_number(locale, shown as i64);
    let total_text = format_number(locale, total as i64);
    replace_placeholders(
        tr(locale, "settings.skillListProgress"),
        &[("{shown}", &shown_text), ("{total}", &total_text)],
    )
}

fn append_skill_list_more_controls(
    locale: &str,
    compact: bool,
    state: LinuxAppState,
    status: gtk::Label,
    skills_list: gtk::Box,
    render_limit: Rc<RefCell<usize>>,
    shown: usize,
    total: usize,
) {
    let progress = settings_text(&skill_list_progress_text(locale, shown, total));
    progress.add_css_class("dim-label");
    skills_list.append(&progress);

    let show_more = gtk::Button::with_label(tr(locale, "button.showMoreSkills"));
    let locale_for_more = locale.to_owned();
    let state_for_more = state.clone();
    let status_for_more = status.clone();
    let list_for_more = skills_list.clone();
    let limit_for_more = render_limit.clone();
    show_more.connect_clicked(move |_| {
        let total = state_for_more.skills().len();
        {
            let mut limit = limit_for_more.borrow_mut();
            *limit = (*limit + SKILL_LIST_RENDER_BATCH).min(total);
        }
        render_skill_list(
            &locale_for_more,
            compact,
            state_for_more.clone(),
            status_for_more.clone(),
            list_for_more.clone(),
            limit_for_more.clone(),
        );
    });
    skills_list.append(&show_more);
}

pub(crate) fn render_skill_list(
    locale: &str,
    compact: bool,
    state: LinuxAppState,
    status: gtk::Label,
    skills_list: gtk::Box,
    render_limit: Rc<RefCell<usize>>,
) {
    clear_box_children(&skills_list);

    let skills = state.skills();
    if skills.is_empty() {
        let empty = settings_text(tr(locale, "settings.skillsEmpty"));
        empty.add_css_class("dim-label");
        skills_list.append(&empty);
        return;
    }

    let total = skills.len();
    let shown = (*render_limit.borrow()).min(total);

    if shown < total {
        append_skill_list_more_controls(
            locale,
            compact,
            state.clone(),
            status.clone(),
            skills_list.clone(),
            render_limit.clone(),
            shown,
            total,
        );
    }

    for skill in skills.into_iter().take(shown) {
        skills_list.append(&skill_card(
            locale,
            compact,
            skill,
            state.clone(),
            status.clone(),
        ));
    }

    if shown < total {
        append_skill_list_more_controls(
            locale,
            compact,
            state,
            status,
            skills_list,
            render_limit,
            shown,
            total,
        );
    }
}

fn skill_card(
    locale: &str,
    compact: bool,
    skill: UserSkill,
    state: LinuxAppState,
    status: gtk::Label,
) -> gtk::Box {
    let title = display_skill_name(&skill.name, tr(locale, "fallback.skillName"));
    let card = settings_card(&title);
    let meta = skill_meta_text(locale, &skill);
    let meta_label = settings_text(&meta);
    meta_label.add_css_class("dim-label");
    card.append(&meta_label);

    let skill_id = skill.id.clone();
    let fallback_name = tr(locale, "fallback.skillName").to_owned();
    card.append(&editable_entry(tr(locale, "field.name"), Some(&title), {
        let state = state.clone();
        let skill_id = skill_id.clone();
        move |value| {
            let fallback_name = fallback_name.clone();
            state.update_skill(&skill_id, |skill| {
                skill.name = display_skill_name(&value, &fallback_name);
                refresh_skill_keywords(skill);
            });
        }
    }));

    let content_editor = gtk::TextView::new();
    content_editor.set_wrap_mode(gtk::WrapMode::WordChar);
    content_editor.buffer().set_text(&skill_content(&skill));
    let content_scroller = gtk::ScrolledWindow::builder()
        .child(&content_editor)
        .min_content_height(if compact { 120 } else { 160 })
        .hexpand(true)
        .build();
    card.append(&content_scroller);

    let toggles = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    let enabled = gtk::CheckButton::with_label(tr(locale, "field.enabled"));
    enabled.set_active(skill.enabled);
    let state_for_enabled = state.clone();
    let skill_id_for_enabled = skill_id.clone();
    enabled.connect_toggled(move |button| {
        state_for_enabled.update_skill(&skill_id_for_enabled, |skill| {
            skill.enabled = button.is_active();
        });
    });
    toggles.append(&enabled);

    let fixed = gtk::CheckButton::with_label(tr(locale, "label.skillFixed"));
    fixed.set_active(skill.fixed);
    let state_for_fixed = state.clone();
    let skill_id_for_fixed = skill_id.clone();
    fixed.connect_toggled(move |button| {
        state_for_fixed.update_skill(&skill_id_for_fixed, |skill| {
            skill.fixed = button.is_active();
        });
    });
    toggles.append(&fixed);

    let auto_match = gtk::CheckButton::with_label(tr(locale, "label.skillAutoMatch"));
    auto_match.set_active(skill.auto_match);
    let state_for_auto_match = state.clone();
    let skill_id_for_auto_match = skill_id.clone();
    auto_match.connect_toggled(move |button| {
        state_for_auto_match.update_skill(&skill_id_for_auto_match, |skill| {
            skill.auto_match = button.is_active();
        });
    });
    toggles.append(&auto_match);
    card.append(&toggles);

    let actions = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    let save_skill = gtk::Button::with_label(tr(locale, "button.save"));
    save_skill.add_css_class("suggested-action");
    save_skill.set_sensitive(!normalize_whitespace(&skill_content(&skill)).is_empty());
    let save_skill_for_content = save_skill.clone();
    content_editor.buffer().connect_changed(move |buffer| {
        let body = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), true)
            .to_string();
        save_skill_for_content.set_sensitive(!normalize_whitespace(&body).is_empty());
    });
    let editor_for_save = content_editor.clone();
    let state_for_save = state.clone();
    let skill_id_for_save = skill_id.clone();
    let status_for_save = status.clone();
    let locale_for_save = locale.to_owned();
    save_skill.connect_clicked(move |_| {
        let buffer = editor_for_save.buffer();
        let body = buffer
            .text(&buffer.start_iter(), &buffer.end_iter(), true)
            .to_string();
        let normalized = normalize_whitespace(&body);
        if normalized.is_empty() {
            status_for_save.set_text(tr(&locale_for_save, "notice.skillContentRequired"));
            return;
        }

        state_for_save.update_skill(&skill_id_for_save, |skill| {
            rebuild_skill_content(
                skill,
                &normalized,
                tr(&locale_for_save, "fallback.skillHeading"),
            );
        });
        status_for_save.set_text(tr(&locale_for_save, "notice.skillSaved"));
    });
    actions.append(&save_skill);

    let delete_skill = gtk::Button::with_label(tr(locale, "button.deleteSkill"));
    delete_skill.add_css_class("destructive-action");
    let state_for_delete = state;
    let skill_id_for_delete = skill_id;
    let card_for_delete = card.clone();
    let status_for_delete = status;
    let locale_for_delete = locale.to_owned();
    delete_skill.connect_clicked(move |_| {
        if state_for_delete.delete_skill(&skill_id_for_delete) {
            card_for_delete.set_visible(false);
            status_for_delete.set_text(tr(&locale_for_delete, "notice.skillDeleted"));
        }
    });
    actions.append(&delete_skill);
    card.append(&actions);
    card
}
