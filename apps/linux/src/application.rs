use crate::{
    LinuxAppState,
    app_state::LinuxAppResources,
    chat_view::main_area,
    i18n::{resolve_locale, tr},
    settings_window::open_linux_settings_window,
    sidebar::sidebar,
    ui_helpers::apply_theme_mode,
};
use adw::prelude::*;
use gtk::{gio, glib};
use std::{
    cell::{Cell, OnceCell, RefCell},
    collections::VecDeque,
    ffi::OsString,
    path::PathBuf,
    rc::Rc,
    time::Duration,
};

pub(crate) const APP_ID: &str = "app.zerochat.client";
pub(crate) const STREAMING_UI_FRAME_MS: u64 = 16;

pub(crate) fn run() -> glib::ExitCode {
    let app = adw::Application::builder()
        .application_id(APP_ID)
        .flags(gio::ApplicationFlags::HANDLES_COMMAND_LINE)
        .build();
    let session = Rc::new(LinuxApplicationSession::default());

    let session_for_activate = session.clone();
    app.connect_activate(move |app| {
        session_for_activate.handle(app, LinuxStartupRoute::Chat);
    });
    let session_for_command_line = session;
    app.connect_command_line(move |app, command_line| {
        session_for_command_line
            .handle(app, LinuxStartupRoute::from_args(command_line.arguments()));
        0.into()
    });
    app.run()
}

#[derive(Default)]
struct LinuxApplicationSession {
    window: OnceCell<adw::ApplicationWindow>,
    runtime: OnceCell<LinuxApplicationRuntime>,
    pending_routes: RefCell<VecDeque<LinuxStartupRoute>>,
    loading: Cell<bool>,
}

impl LinuxApplicationSession {
    fn handle(self: &Rc<Self>, app: &adw::Application, route: LinuxStartupRoute) {
        if let Some(runtime) = self.runtime.get() {
            runtime.route(route);
            return;
        }

        self.pending_routes.borrow_mut().push_back(route);
        self.ensure_window(app).present();
        if !self.begin_loading() {
            return;
        }

        let app = app.clone();
        let session = Rc::downgrade(self);
        glib::spawn_future_local(async move {
            let loaded = gio::spawn_blocking(LinuxAppState::load_resources).await;
            let Some(session) = session.upgrade() else {
                return;
            };
            match loaded {
                Ok(resources) => session.finish_loading(&app, resources),
                Err(_) => session.fail_loading(),
            }
        });
    }

    fn ensure_window(&self, app: &adw::Application) -> &adw::ApplicationWindow {
        self.window.get_or_init(|| {
            add_linux_icon_search_path();
            let window = adw::ApplicationWindow::builder()
                .application(app)
                .title("ZeroChat")
                .icon_name(APP_ID)
                .default_width(1180)
                .default_height(760)
                .build();
            window.set_size_request(900, 600);

            let spinner = gtk::Spinner::new();
            spinner.set_halign(gtk::Align::Center);
            spinner.set_valign(gtk::Align::Center);
            spinner.start();
            window.set_content(Some(&spinner));
            window
        })
    }

    fn finish_loading(&self, app: &adw::Application, resources: LinuxAppResources) {
        self.loading.set(false);
        let state = LinuxAppState::from_resources(resources);
        apply_theme_mode(&state.theme());
        let window = self.ensure_window(app).clone();
        let runtime = LinuxApplicationRuntime::new(app, window, state);
        if self.runtime.set(runtime).is_err() {
            return;
        }

        let routes = self.take_pending_routes();
        let runtime = self.runtime.get().expect("runtime was just initialized");
        if routes.is_empty() {
            runtime.route(LinuxStartupRoute::Chat);
        } else {
            for route in routes {
                runtime.route(route);
            }
        }
    }

    fn fail_loading(&self) {
        self.loading.set(false);
        eprintln!("ZeroChat Linux application state initialization failed.");
        let label = gtk::Label::new(Some(
            "ZeroChat could not initialize its Linux application state.",
        ));
        label.set_wrap(true);
        label.set_margin_top(24);
        label.set_margin_bottom(24);
        label.set_margin_start(24);
        label.set_margin_end(24);
        if let Some(window) = self.window.get() {
            window.set_content(Some(&label));
            window.present();
        }
    }

    fn begin_loading(&self) -> bool {
        !self.loading.replace(true)
    }

    fn take_pending_routes(&self) -> Vec<LinuxStartupRoute> {
        self.pending_routes.borrow_mut().drain(..).collect()
    }
}

struct LinuxApplicationRuntime {
    window: adw::ApplicationWindow,
    state: LinuxAppState,
    content_initialized: Cell<bool>,
}

impl LinuxApplicationRuntime {
    fn new(app: &adw::Application, window: adw::ApplicationWindow, state: LinuxAppState) -> Self {
        install_app_actions(app, &window, state.clone());
        install_secret_store_issue_monitor(&window, state.clone());
        Self {
            window,
            state,
            content_initialized: Cell::new(false),
        }
    }

    fn route(&self, route: LinuxStartupRoute) {
        match route {
            LinuxStartupRoute::Chat => {
                if !self.content_initialized.get() {
                    self.show("chat");
                }
            }
            LinuxStartupRoute::QuickAsk => {
                self.state.create_empty_conversation();
                self.show("chat-focus-composer");
            }
            LinuxStartupRoute::SearchChats => self.show("chat-focus-search"),
            LinuxStartupRoute::Settings => {
                for action in settings_startup_actions(self.content_initialized.get()) {
                    match action {
                        LinuxSettingsStartupAction::ShowChat => self.show("chat"),
                        LinuxSettingsStartupAction::PresentMainWindow => self.window.present(),
                        LinuxSettingsStartupAction::OpenNativeSettings => {
                            let window = self.window.clone();
                            let state = self.state.clone();
                            open_linux_settings_window(&window, state, "appearance");
                        }
                    }
                }
                return;
            }
        }
        self.window.present();
    }

    fn show(&self, visible_page: &str) {
        set_window_content(&self.window, self.state.clone(), visible_page);
        self.content_initialized.set(true);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LinuxSettingsStartupAction {
    ShowChat,
    PresentMainWindow,
    OpenNativeSettings,
}

fn settings_startup_actions(content_initialized: bool) -> &'static [LinuxSettingsStartupAction] {
    const COLD_START: &[LinuxSettingsStartupAction] = &[
        LinuxSettingsStartupAction::ShowChat,
        LinuxSettingsStartupAction::PresentMainWindow,
        LinuxSettingsStartupAction::OpenNativeSettings,
    ];
    const WARM_START: &[LinuxSettingsStartupAction] = &[
        LinuxSettingsStartupAction::PresentMainWindow,
        LinuxSettingsStartupAction::OpenNativeSettings,
    ];

    if content_initialized {
        WARM_START
    } else {
        COLD_START
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LinuxStartupRoute {
    Chat,
    QuickAsk,
    SearchChats,
    Settings,
}

impl LinuxStartupRoute {
    fn from_args(args: Vec<OsString>) -> Self {
        for arg in args.iter().skip(1).filter_map(|arg| arg.to_str()) {
            match arg {
                "--quick-ask" | "--new-chat" => return Self::QuickAsk,
                "--search-chats" => return Self::SearchChats,
                "--settings" => return Self::Settings,
                _ => {}
            }
        }

        Self::Chat
    }
}

fn install_app_actions(
    app: &adw::Application,
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
) {
    let new_chat_action = gio::SimpleAction::new("new-chat", None);
    let window_for_new_chat = window.clone();
    let state_for_new_chat = state.clone();
    new_chat_action.connect_activate(move |_, _| {
        state_for_new_chat.create_empty_conversation();
        set_window_content(
            &window_for_new_chat,
            state_for_new_chat.clone(),
            "chat-focus-composer",
        );
    });
    app.add_action(&new_chat_action);
    app.set_accels_for_action("app.new-chat", &["<Primary>n"]);

    let open_settings_action = gio::SimpleAction::new("open-settings", None);
    let window_for_settings = window.clone();
    let state_for_settings = state.clone();
    open_settings_action.connect_activate(move |_, _| {
        open_linux_settings_window(
            &window_for_settings,
            state_for_settings.clone(),
            "appearance",
        );
    });
    app.add_action(&open_settings_action);
    app.set_accels_for_action("app.open-settings", &["<Primary>comma"]);

    let search_conversations_action = gio::SimpleAction::new("search-conversations", None);
    let window_for_search = window.clone();
    let state_for_search = state.clone();
    search_conversations_action.connect_activate(move |_, _| {
        set_window_content(
            &window_for_search,
            state_for_search.clone(),
            "chat-focus-search",
        );
    });
    app.add_action(&search_conversations_action);
    app.set_accels_for_action("app.search-conversations", &["<Primary>k"]);

    let close_window_action = gio::SimpleAction::new("close-window", None);
    let window_for_close = window.clone();
    close_window_action.connect_activate(move |_, _| {
        window_for_close.close();
    });
    app.add_action(&close_window_action);
    app.set_accels_for_action("app.close-window", &["<Primary>w"]);
}

fn add_linux_icon_search_path() {
    let icon_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("data/icons");

    if !icon_root.exists() {
        return;
    }

    if let Some(display) = gtk::gdk::Display::default() {
        gtk::IconTheme::for_display(&display).add_search_path(icon_root);
    }
}

fn install_secret_store_issue_monitor(window: &adw::ApplicationWindow, state: LinuxAppState) {
    let window = window.downgrade();
    glib::timeout_add_local(Duration::from_millis(250), move || {
        let Some(window) = window.upgrade() else {
            return glib::ControlFlow::Break;
        };
        if let Some(message) = state.take_secret_store_issue() {
            if let Some(overlay) = window_toast_overlay(&window) {
                overlay.add_toast(adw::Toast::new(&message));
            }
        }
        glib::ControlFlow::Continue
    });
}

fn window_toast_overlay(window: &adw::ApplicationWindow) -> Option<adw::ToastOverlay> {
    window.content()?.downcast::<adw::ToastOverlay>().ok()
}

pub(crate) fn set_window_content(
    window: &adw::ApplicationWindow,
    state: LinuxAppState,
    visible_page: &str,
) {
    let language_mode = state.language_mode();
    let compact = state.compact();
    let locale = resolve_locale(&language_mode);
    let focus_composer = visible_page == "chat-focus-composer";
    let focus_search = visible_page == "chat-focus-search";
    let stack_page = if focus_composer || focus_search {
        "chat"
    } else {
        visible_page
    };

    let split_view = adw::NavigationSplitView::new();
    let root = split_view.clone();
    split_view.set_hexpand(true);
    split_view.set_vexpand(true);
    split_view.set_min_sidebar_width(260.0);
    split_view.set_max_sidebar_width(320.0);
    split_view.set_sidebar_width_unit(adw::LengthUnit::Px);
    split_view.set_sidebar_width_fraction(280.0);
    split_view.set_show_content(true);
    root.set_direction(if locale == "ar-SA" {
        gtk::TextDirection::Rtl
    } else {
        gtk::TextDirection::Ltr
    });

    let sidebar_page = adw::NavigationPage::new(
        &sidebar(&locale, compact, window, state.clone(), focus_search),
        "ZeroChat",
    );
    let content_page = adw::NavigationPage::new(
        &main_area(
            &locale,
            language_mode,
            stack_page,
            focus_composer,
            compact,
            window,
            state,
        ),
        tr(&locale, "mode.chat"),
    );
    split_view.set_sidebar(Some(&sidebar_page));
    split_view.set_content(Some(&content_page));

    if let Some(overlay) = window_toast_overlay(window) {
        overlay.set_child(Some(&split_view));
    } else {
        let overlay = adw::ToastOverlay::new();
        overlay.set_child(Some(&split_view));
        window.set_content(Some(&overlay));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        LinuxApplicationSession, LinuxSettingsStartupAction, LinuxStartupRoute,
        settings_startup_actions,
    };
    use std::ffi::OsString;

    #[test]
    fn command_line_routes_known_linux_entry_points() {
        assert_eq!(
            LinuxStartupRoute::from_args(vec![
                OsString::from("zerochat"),
                OsString::from("--quick-ask")
            ]),
            LinuxStartupRoute::QuickAsk
        );
        assert_eq!(
            LinuxStartupRoute::from_args(vec![
                OsString::from("zerochat"),
                OsString::from("--search-chats")
            ]),
            LinuxStartupRoute::SearchChats
        );
        assert_eq!(
            LinuxStartupRoute::from_args(vec![
                OsString::from("zerochat"),
                OsString::from("--settings")
            ]),
            LinuxStartupRoute::Settings
        );
    }

    #[test]
    fn unrelated_arguments_keep_the_existing_chat_route() {
        assert_eq!(
            LinuxStartupRoute::from_args(vec![
                OsString::from("zerochat"),
                OsString::from("--unknown")
            ]),
            LinuxStartupRoute::Chat
        );
    }

    #[test]
    fn cold_settings_route_presents_chat_before_opening_native_settings() {
        assert_eq!(
            settings_startup_actions(false),
            [
                LinuxSettingsStartupAction::ShowChat,
                LinuxSettingsStartupAction::PresentMainWindow,
                LinuxSettingsStartupAction::OpenNativeSettings,
            ]
        );
    }

    #[test]
    fn warm_settings_route_keeps_chat_and_opens_native_settings() {
        assert_eq!(
            settings_startup_actions(true),
            [
                LinuxSettingsStartupAction::PresentMainWindow,
                LinuxSettingsStartupAction::OpenNativeSettings,
            ]
        );
    }

    #[test]
    fn application_state_initialization_starts_only_once() {
        let session = LinuxApplicationSession::default();

        assert!(session.begin_loading());
        assert!(!session.begin_loading());
    }

    #[test]
    fn commands_received_during_initialization_are_not_overwritten() {
        let session = LinuxApplicationSession::default();
        session
            .pending_routes
            .borrow_mut()
            .extend([LinuxStartupRoute::QuickAsk, LinuxStartupRoute::SearchChats]);

        assert_eq!(
            session.take_pending_routes(),
            vec![LinuxStartupRoute::QuickAsk, LinuxStartupRoute::SearchChats]
        );
    }
}
