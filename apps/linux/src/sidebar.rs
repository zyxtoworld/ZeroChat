use crate::{
    APP_ID, LinuxAppState,
    conversations::{linux_conversation_search_text, normalize_conversation_search_value},
    dialogs::confirm_delete_conversation,
    i18n::{localize_sync_status, tr},
    set_window_content,
    settings_window::open_linux_settings_window,
    ui_helpers::{edge_margin, panel_spacing, row_spacing},
};
use gtk::{glib, prelude::*};
use std::rc::Rc;

pub(crate) fn sidebar(
    locale: &str,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    focus_search: bool,
) -> gtk::Box {
    let sidebar = gtk::Box::new(gtk::Orientation::Vertical, panel_spacing(compact));
    sidebar.set_width_request(if compact { 260 } else { 300 });
    sidebar.add_css_class("navigation-sidebar");
    sidebar.set_margin_top(edge_margin(compact));
    sidebar.set_margin_bottom(edge_margin(compact));
    sidebar.set_margin_start(edge_margin(compact));
    sidebar.set_margin_end(if compact { 8 } else { 10 });

    let brand = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    brand.set_tooltip_text(Some("ZeroChat"));

    let brand_icon = gtk::Image::from_icon_name(APP_ID);
    brand_icon.set_pixel_size(if compact { 28 } else { 32 });
    brand_icon.add_css_class("dim-label");
    brand.append(&brand_icon);

    let title = gtk::Label::new(Some("ZeroChat"));
    title.add_css_class("title-2");
    title.set_xalign(0.0);
    brand.append(&title);
    sidebar.append(&brand);

    let new_chat = gtk::Button::with_label(tr(locale, "title.newChat"));
    new_chat.add_css_class("suggested-action");
    new_chat.set_tooltip_text(Some(&format!("{} (Ctrl+N)", tr(locale, "title.newChat"))));
    let state_for_new_chat = state.clone();
    let window_for_new_chat = window.clone();
    new_chat.connect_clicked(move |_| {
        state_for_new_chat.create_empty_conversation();
        set_window_content(
            &window_for_new_chat,
            state_for_new_chat.clone(),
            "chat-focus-composer",
        );
    });
    sidebar.append(&new_chat);

    sidebar.append(&sync_status_button(locale, compact, window, state.clone()));

    let search = gtk::SearchEntry::builder()
        .placeholder_text(tr(locale, "conversation.searchPlaceholder"))
        .build();
    search.set_tooltip_text(Some(&format!(
        "{} (Ctrl+K)",
        tr(locale, "conversation.searchLabel")
    )));
    sidebar.append(&search);

    let no_results = gtk::Box::new(gtk::Orientation::Vertical, 4);
    no_results.add_css_class("card");
    no_results.set_margin_top(row_spacing(compact));
    no_results.set_margin_bottom(row_spacing(compact));
    no_results.set_margin_start(panel_spacing(compact));
    no_results.set_margin_end(panel_spacing(compact));
    let no_results_title = gtk::Label::new(Some(tr(locale, "conversation.searchNoResultsTitle")));
    no_results_title.add_css_class("heading");
    no_results_title.set_wrap(true);
    no_results_title.set_xalign(0.0);
    let no_results_body = gtk::Label::new(Some(tr(locale, "conversation.searchNoResultsBody")));
    no_results_body.add_css_class("dim-label");
    no_results_body.set_wrap(true);
    no_results_body.set_xalign(0.0);
    no_results.append(&no_results_title);
    no_results.append(&no_results_body);
    no_results.set_visible(false);
    sidebar.append(&no_results);

    let list = gtk::ListBox::new();
    list.add_css_class("boxed-list");
    let snapshot = state.snapshot.borrow();
    let active_id = snapshot.preferences.active_conversation_id.clone();
    let conversations = snapshot.conversations.clone();
    drop(snapshot);

    let rows = if conversations.is_empty() {
        vec![(
            tr(locale, "title.newChat").to_owned(),
            tr(locale, "title.newChat").to_owned(),
            false,
            None,
        )]
    } else {
        conversations
            .iter()
            .map(|conversation| {
                let title = if conversation.title.trim().is_empty() {
                    tr(locale, "title.newChat").to_owned()
                } else {
                    conversation.title.clone()
                };
                let searchable_text = linux_conversation_search_text(&title, conversation);
                (
                    title,
                    searchable_text,
                    Some(conversation.id.clone()) == active_id,
                    Some(conversation.id.clone()),
                )
            })
            .collect::<Vec<_>>()
    };

    let conversation_ids = rows
        .iter()
        .map(|(_, _, _, conversation_id)| conversation_id.clone())
        .collect::<Vec<_>>();
    let row_searches = Rc::new(
        rows.iter()
            .map(|(_, searchable_text, _, _)| normalize_conversation_search_value(searchable_text))
            .collect::<Vec<_>>(),
    );

    for (item, _, active, conversation_id) in rows {
        let row_box = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
        row_box.set_margin_top(row_spacing(compact));
        row_box.set_margin_bottom(row_spacing(compact));
        row_box.set_margin_start(panel_spacing(compact));
        row_box.set_margin_end(panel_spacing(compact));
        let label = gtk::Label::new(Some(item.as_str()));
        label.set_hexpand(true);
        label.set_xalign(0.0);
        if active {
            label.add_css_class("accent");
        }
        let delete = gtk::Button::with_label(tr(locale, "action.delete"));
        delete.add_css_class("flat");
        if let Some(delete_conversation_id) = conversation_id.clone() {
            let state_for_delete = state.clone();
            let window_for_delete = window.clone();
            let locale_for_delete = locale.to_owned();
            let title_for_delete = item.clone();
            delete.connect_clicked(move |_| {
                confirm_delete_conversation(
                    &locale_for_delete,
                    &window_for_delete,
                    state_for_delete.clone(),
                    delete_conversation_id.clone(),
                    title_for_delete.clone(),
                );
            });
        } else {
            delete.set_sensitive(false);
        }
        row_box.append(&label);
        row_box.append(&delete);

        let row = gtk::ListBoxRow::new();
        row.set_activatable(conversation_id.is_some());
        row.set_child(Some(&row_box));
        list.append(&row);
    }
    let state_for_select = state.clone();
    let window_for_select = window.clone();
    list.connect_row_activated(move |_, row| {
        let index = row.index();
        if index < 0 {
            return;
        }
        if let Some(Some(conversation_id)) = conversation_ids.get(index as usize) {
            state_for_select.select_conversation(conversation_id);
            set_window_content(&window_for_select, state_for_select.clone(), "chat");
        }
    });
    sidebar.append(&list);

    let row_searches_for_filter = row_searches.clone();
    let search_for_filter = search.clone();
    list.set_filter_func(move |row| {
        let query = normalize_conversation_search_value(search_for_filter.text().as_str());
        if query.is_empty() {
            return true;
        }

        row.index()
            .try_into()
            .ok()
            .and_then(|index: usize| row_searches_for_filter.get(index))
            .map(|searchable| searchable.contains(&query))
            .unwrap_or(false)
    });

    let list_for_search = list.clone();
    let no_results_for_search = no_results.clone();
    let row_searches_for_search = row_searches.clone();
    search.connect_search_changed(move |entry| {
        let query = normalize_conversation_search_value(entry.text().as_str());
        list_for_search.invalidate_filter();
        no_results_for_search.set_visible(
            !query.is_empty()
                && !row_searches_for_search
                    .iter()
                    .any(|searchable| searchable.contains(&query)),
        );
    });

    if focus_search {
        let search_for_focus = search.clone();
        glib::idle_add_local_once(move || {
            search_for_focus.grab_focus();
        });
    }

    let status = gtk::Label::new(Some(tr(locale, "app.localFirst")));
    status.set_wrap(true);
    status.set_xalign(0.0);
    status.add_css_class("dim-label");
    sidebar.append(&status);
    sidebar
}

fn sync_status_button(
    locale: &str,
    compact: bool,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
) -> gtk::Button {
    let button = gtk::Button::new();
    button.set_tooltip_text(Some(tr(locale, "setting.sync")));
    button.add_css_class("flat");
    button.set_hexpand(true);
    button.set_halign(gtk::Align::Fill);

    let content = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    content.set_margin_top(row_spacing(compact));
    content.set_margin_bottom(row_spacing(compact));
    content.set_margin_start(panel_spacing(compact));
    content.set_margin_end(panel_spacing(compact));

    let sync_mode = state.snapshot.borrow().sync.mode.clone();
    let icon = gtk::Image::from_icon_name(sync_icon_name(&sync_mode));
    icon.add_css_class("dim-label");
    content.append(&icon);

    let copy = gtk::Box::new(gtk::Orientation::Vertical, 2);
    copy.set_hexpand(true);

    let title_text = if sync_mode == "local" {
        tr(locale, "action.startCloudSync")
    } else {
        tr(locale, "setting.sync")
    };
    let title = gtk::Label::new(Some(title_text));
    title.set_xalign(0.0);
    title.add_css_class("heading");
    copy.append(&title);

    let summary = gtk::Label::new(Some(&cloud_sync_summary(locale, &state)));
    summary.set_xalign(0.0);
    summary.set_wrap(true);
    summary.set_lines(3);
    summary.add_css_class("dim-label");
    copy.append(&summary);

    content.append(&copy);
    button.set_child(Some(&content));

    let window_for_settings = window.clone();
    button.connect_clicked(move |_| {
        open_linux_settings_window(&window_for_settings, state.clone(), "sync");
    });

    button
}

fn sync_icon_name(mode: &str) -> &'static str {
    match mode {
        "cloudflare" => "folder-sync-symbolic",
        "gist" => "vcs-branch-symbolic",
        _ => "drive-harddisk-symbolic",
    }
}

fn cloud_sync_summary(locale: &str, state: &LinuxAppState) -> String {
    let sync = state.snapshot.borrow().sync.clone();
    if sync.mode == "local" {
        return tr(locale, "sync.localSummary").to_owned();
    }

    let mode_label = match sync.mode.as_str() {
        "gist" => tr(locale, "mode.gist"),
        "cloudflare" => tr(locale, "mode.cloudflare"),
        _ => tr(locale, "mode.local"),
    };
    let status = sync
        .last_sync_status
        .as_deref()
        .map(str::trim)
        .filter(|status| !status.is_empty())
        .map(|status| localize_sync_status(locale, status))
        .unwrap_or_else(|| tr(locale, "button.syncNow").to_owned());

    format!("{mode_label} · {status}")
}
