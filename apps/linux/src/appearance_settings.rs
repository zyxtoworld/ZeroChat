use crate::{
    LinuxAppState,
    i18n::{LANGUAGE_MODES, language_summary, resolve_locale, tr},
    set_window_content,
    settings_window::open_linux_settings_window,
    ui_helpers::{settings_box, theme_selector},
};
use gtk::prelude::*;

#[derive(Clone)]
pub(crate) enum SettingsSurface {
    MainStack,
    PreferencesWindow(adw::PreferencesWindow),
}

pub(crate) fn appearance_settings(
    locale: &str,
    language_mode: String,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    surface: SettingsSurface,
) -> gtk::Box {
    let box_ = settings_box(compact);
    let theme_label = gtk::Label::new(Some(tr(locale, "field.theme")));
    theme_label.set_xalign(0.0);
    box_.append(&theme_label);
    box_.append(&theme_selector(
        &[
            tr(locale, "theme.system"),
            tr(locale, "theme.light"),
            tr(locale, "theme.dark"),
        ],
        &state.theme(),
        state.clone(),
    ));

    let language_label = gtk::Label::new(Some(tr(locale, "field.language")));
    language_label.set_xalign(0.0);
    box_.append(&language_label);
    let summary_text = language_summary(locale);
    let language_summary = gtk::Label::new(Some(&summary_text));
    language_summary.set_xalign(0.0);
    language_summary.add_css_class("dim-label");
    let language_dropdown = gtk::DropDown::from_strings(&[
        tr(locale, "language.system"),
        "中文",
        "English",
        "Español",
        "हिन्दी",
        "العربية",
        "Português",
        "Русский",
        "日本語",
        "한국어",
        "Français",
    ]);
    let selected_language_index = LANGUAGE_MODES
        .iter()
        .position(|mode| *mode == language_mode.as_str())
        .unwrap_or(0) as u32;
    language_dropdown.set_selected(selected_language_index);
    let summary_for_language = language_summary.clone();
    let window_for_language = window.clone();
    let state_for_language = state.clone();
    let surface_for_language = surface.clone();
    language_dropdown.connect_selected_notify(move |dropdown| {
        let index = dropdown.selected() as usize;
        let mode = LANGUAGE_MODES.get(index).copied().unwrap_or("system");
        let resolved = resolve_locale(mode);
        summary_for_language.set_text(language_summary(&resolved));
        state_for_language.update_preferences(|preferences| {
            preferences.language = mode.to_owned();
        });
        match &surface_for_language {
            SettingsSurface::MainStack => {
                set_window_content(&window_for_language, state_for_language.clone(), "settings");
            }
            SettingsSurface::PreferencesWindow(_) => {
                refresh_settings_surface(
                    &surface_for_language,
                    &window_for_language,
                    state_for_language.clone(),
                    "appearance",
                );
            }
        }
    });
    box_.append(&language_dropdown);
    box_.append(&language_summary);

    let compact_enabled = compact;
    let compact_button = gtk::CheckButton::with_label(tr(locale, "field.compactDisplay"));
    compact_button.set_active(compact_enabled);
    let window_for_compact = window.clone();
    let state_for_compact = state.clone();
    let surface_for_compact = surface.clone();
    compact_button.connect_toggled(move |button| {
        state_for_compact.update_preferences(|preferences| {
            preferences.compact_mode = button.is_active();
        });
        refresh_settings_surface(
            &surface_for_compact,
            &window_for_compact,
            state_for_compact.clone(),
            "appearance",
        );
    });
    box_.append(&compact_button);
    box_
}

fn refresh_settings_surface(
    surface: &SettingsSurface,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    visible_page: &str,
) {
    match surface {
        SettingsSurface::MainStack => {
            set_window_content(window, state, "settings");
        }
        SettingsSurface::PreferencesWindow(settings_window) => {
            settings_window.close();
            set_window_content(window, state.clone(), "chat");
            open_linux_settings_window(window, state, visible_page);
        }
    }
}
