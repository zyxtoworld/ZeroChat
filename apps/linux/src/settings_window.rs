use crate::{
    APP_ID, LinuxAppState,
    appearance_settings::{SettingsSurface, appearance_settings},
    data_settings::data_settings,
    i18n::{resolve_locale, tr},
    model_settings::model_settings,
    provider_settings::provider_settings,
    skill_settings::skills_settings,
    sync_settings::sync_settings,
    ui_helpers::{edge_margin, panel_spacing, row_spacing},
};
use adw::prelude::*;
use gtk::prelude::*;
use std::rc::Rc;

pub(crate) fn settings_page(
    locale: &str,
    language_mode: String,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
) -> gtk::Box {
    let page = gtk::Box::new(gtk::Orientation::Vertical, panel_spacing(compact));
    page.set_margin_top(edge_margin(compact));
    page.set_margin_bottom(edge_margin(compact));
    page.set_margin_start(edge_margin(compact));
    page.set_margin_end(edge_margin(compact));

    let heading = gtk::Label::new(Some(tr(locale, "title.settings")));
    heading.add_css_class("title-2");
    heading.set_xalign(0.0);
    page.append(&heading);

    let description = gtk::Label::new(Some(tr(locale, "settings.changesSaved")));
    description.set_wrap(true);
    description.set_xalign(0.0);
    description.add_css_class("dim-label");
    page.append(&description);

    let settings_stack = gtk::Stack::new();
    settings_stack.set_vexpand(true);
    page.append(&settings_tab_grid(locale, compact, &settings_stack));
    settings_stack.add_titled(
        &appearance_settings(
            locale,
            language_mode,
            compact,
            window,
            state.clone(),
            SettingsSurface::MainStack,
        ),
        Some("appearance"),
        tr(locale, "setting.appearance"),
    );
    settings_stack.add_titled(
        &provider_settings(locale, compact, state.clone()),
        Some("providers"),
        tr(locale, "setting.providers"),
    );
    settings_stack.add_titled(
        &model_settings(locale, compact, state.clone()),
        Some("models"),
        tr(locale, "setting.models"),
    );
    settings_stack.add_titled(
        &skills_settings(locale, compact, window, state.clone()),
        Some("skills"),
        tr(locale, "setting.skills"),
    );
    settings_stack.add_titled(
        &sync_settings(locale, compact, state.clone()),
        Some("sync"),
        tr(locale, "setting.sync"),
    );
    settings_stack.add_titled(
        &data_settings(locale, compact, window, state.clone()),
        Some("data"),
        tr(locale, "setting.data"),
    );
    settings_stack.set_visible_child_name("providers");

    page.append(&settings_stack);
    page
}

pub(crate) fn open_linux_settings_window(
    parent: &adw::ApplicationWindow,
    state: LinuxAppState,
    visible_page: &str,
) {
    let language_mode = state.language_mode();
    let locale = resolve_locale(&language_mode);
    let compact = state.compact();
    let window = adw::PreferencesWindow::builder()
        .title(tr(&locale, "title.settings"))
        .icon_name(APP_ID)
        .transient_for(parent)
        .destroy_with_parent(true)
        .search_enabled(true)
        .default_width(860)
        .default_height(720)
        .build();
    window.set_size_request(720, 560);
    window.set_direction(if locale == "ar-SA" {
        gtk::TextDirection::Rtl
    } else {
        gtk::TextDirection::Ltr
    });

    add_settings_preferences_page(
        &window,
        "appearance",
        tr(&locale, "setting.appearance"),
        "preferences-desktop-appearance-symbolic",
        &appearance_settings(
            &locale,
            language_mode,
            compact,
            parent,
            state.clone(),
            SettingsSurface::PreferencesWindow(window.clone()),
        ),
    );
    add_settings_preferences_page(
        &window,
        "providers",
        tr(&locale, "setting.providers"),
        "network-server-symbolic",
        &provider_settings(&locale, compact, state.clone()),
    );
    add_settings_preferences_page(
        &window,
        "models",
        tr(&locale, "setting.models"),
        "view-list-symbolic",
        &model_settings(&locale, compact, state.clone()),
    );
    add_settings_preferences_page(
        &window,
        "skills",
        tr(&locale, "setting.skills"),
        "starred-symbolic",
        &skills_settings(&locale, compact, parent, state.clone()),
    );
    add_settings_preferences_page(
        &window,
        "sync",
        tr(&locale, "setting.sync"),
        "folder-sync-symbolic",
        &sync_settings(&locale, compact, state.clone()),
    );
    add_settings_preferences_page(
        &window,
        "data",
        tr(&locale, "setting.data"),
        "drive-harddisk-symbolic",
        &data_settings(&locale, compact, parent, state.clone()),
    );

    window.set_visible_page_name(visible_page);
    window.present();
}

fn add_settings_preferences_page(
    window: &adw::PreferencesWindow,
    name: &str,
    title: &str,
    icon_name: &str,
    content: &impl IsA<gtk::Widget>,
) {
    let page = adw::PreferencesPage::builder()
        .name(name)
        .title(title)
        .icon_name(icon_name)
        .build();
    let group = adw::PreferencesGroup::builder().title(title).build();
    group.add(content);
    page.add(&group);
    window.add(&page);
}

fn settings_tab_grid(locale: &str, compact: bool, settings_stack: &gtk::Stack) -> gtk::FlowBox {
    let tabs = [
        ("providers", "setting.providers"),
        ("models", "setting.models"),
        ("appearance", "setting.appearance"),
        ("skills", "setting.skills"),
        ("sync", "setting.sync"),
        ("data", "setting.data"),
    ];
    let grid = gtk::FlowBox::new();
    grid.set_selection_mode(gtk::SelectionMode::None);
    grid.set_homogeneous(true);
    grid.set_row_spacing(row_spacing(compact));
    grid.set_column_spacing(row_spacing(compact));
    grid.set_max_children_per_line(if compact { 2 } else { 3 });
    grid.set_hexpand(true);

    let mut buttons = Vec::new();
    let mut button_pairs = Vec::new();
    for (name, label_key) in tabs.iter() {
        let label = gtk::Label::new(Some(tr(locale, label_key)));
        label.set_wrap(true);
        label.set_lines(2);
        label.set_justify(gtk::Justification::Center);
        label.set_xalign(0.5);

        let button = gtk::ToggleButton::new();
        button.set_child(Some(&label));
        button.set_tooltip_text(Some(tr(locale, label_key)));
        button.set_hexpand(true);
        button.set_halign(gtk::Align::Fill);
        button.set_size_request(96, if compact { 36 } else { 40 });
        if *name == "providers" {
            button.set_active(true);
        }
        grid.insert(&button, -1);
        buttons.push(button.clone());
        button_pairs.push(((*name).to_owned(), button));
    }

    let buttons = Rc::new(buttons);
    for (name, button) in button_pairs {
        let stack_for_button = settings_stack.clone();
        let buttons_for_button = buttons.clone();
        button.connect_clicked(move |clicked| {
            stack_for_button.set_visible_child_name(&name);
            for item in buttons_for_button.iter() {
                item.set_active(false);
            }
            clicked.set_active(true);
        });
    }

    grid
}
