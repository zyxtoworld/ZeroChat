use crate::LinuxAppState;
use adw::prelude::*;

pub(crate) fn edge_margin(compact: bool) -> i32 {
    if compact { 8 } else { 14 }
}

pub(crate) fn panel_spacing(compact: bool) -> i32 {
    if compact { 8 } else { 12 }
}

pub(crate) fn row_spacing(compact: bool) -> i32 {
    if compact { 6 } else { 8 }
}

pub(crate) fn settings_box(compact: bool) -> gtk::Box {
    let box_ = gtk::Box::new(gtk::Orientation::Vertical, if compact { 8 } else { 10 });
    box_.set_margin_top(panel_spacing(compact));
    box_.set_margin_bottom(panel_spacing(compact));
    box_.set_margin_start(panel_spacing(compact));
    box_.set_margin_end(panel_spacing(compact));
    box_
}

pub(crate) fn theme_selector(
    items: &[&str],
    selected_mode: &str,
    state: LinuxAppState,
) -> gtk::DropDown {
    let dropdown = gtk::DropDown::from_strings(items);
    dropdown.set_selected(match selected_mode {
        "light" => 1,
        "dark" => 2,
        _ => 0,
    });
    dropdown.connect_selected_notify(move |dropdown| {
        let mode = match dropdown.selected() {
            1 => "light",
            2 => "dark",
            _ => "system",
        };
        apply_theme_mode(mode);
        state.update_preferences(|preferences| {
            preferences.theme = mode.to_owned();
        });
    });
    dropdown
}

pub(crate) fn apply_theme_mode(mode: &str) {
    let manager = adw::StyleManager::default();
    let scheme = match mode {
        "light" => adw::ColorScheme::ForceLight,
        "dark" => adw::ColorScheme::ForceDark,
        _ => adw::ColorScheme::Default,
    };
    manager.set_color_scheme(scheme);
    crate::theme::install_theme(mode);
}

pub(crate) fn disabled_entry(placeholder: &str, value: Option<&str>) -> gtk::Entry {
    let entry = gtk::Entry::builder().placeholder_text(placeholder).build();
    if let Some(value) = value {
        entry.set_text(value);
    }
    entry.set_sensitive(false);
    entry
}

pub(crate) fn editable_entry(
    placeholder: &str,
    value: Option<&str>,
    on_change: impl Fn(String) + 'static,
) -> gtk::Entry {
    let entry = gtk::Entry::builder().placeholder_text(placeholder).build();
    if let Some(value) = value {
        entry.set_text(value);
    }
    entry.connect_changed(move |entry| {
        on_change(entry.text().trim().to_owned());
    });
    entry
}

pub(crate) fn optional_text(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

pub(crate) fn settings_text(text: &str) -> gtk::Label {
    let label = gtk::Label::new(Some(text));
    label.set_wrap(true);
    label.set_xalign(0.0);
    label
}

pub(crate) fn settings_card(title: &str) -> gtk::Box {
    let card = gtk::Box::new(gtk::Orientation::Vertical, 8);
    card.add_css_class("card");
    card.set_margin_top(8);
    card.set_margin_bottom(8);
    card.set_margin_start(8);
    card.set_margin_end(8);
    let label = gtk::Label::new(Some(title));
    label.set_xalign(0.0);
    label.add_css_class("heading");
    card.append(&label);
    card
}
