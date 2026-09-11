// ZeroChat current design tokens for the GTK/libadwaita build.
// Mirrors src/app/app.css: accent color and bubble radii. libadwaita keeps
// control of widgets; this sheet only re-skins accents and chat bubbles.
// Light/dark variants are swapped at runtime from `apply_theme_mode`.
use adw::prelude::*;
use gtk::gdk::Display;

const THEME_CSS_LIGHT: &str = r"
@define-color accent_color #0a7cff;
@define-color accent_bg_color #0a7cff;
@define-color accent_fg_color #ffffff;

.zc-bubble-user {
  background: #0a7cff;
  color: #ffffff;
  border-radius: 16px;
}
.zc-bubble-user label {
  color: #ffffff;
}
.zc-bubble-ai {
  border-radius: 16px;
}
";

const THEME_CSS_DARK: &str = r"
@define-color accent_color #3b93ff;
@define-color accent_bg_color #3b93ff;
@define-color accent_fg_color #0b1220;

.zc-bubble-user {
  background: #3b93ff;
  color: #0b1220;
  border-radius: 16px;
}
.zc-bubble-user label {
  color: #0b1220;
}
.zc-bubble-ai {
  background: #1c2029;
  border-radius: 16px;
}
";

fn install_provider(css: &str) {
    let provider = gtk::CssProvider::new();
    provider.load_from_string(css);
    if let Some(display) = Display::default() {
        gtk::style_context_add_provider_for_display(
            &display,
            &provider,
            gtk::STYLE_PROVIDER_PRIORITY_APPLICATION,
        );
    }
}

/// Applies the token sheet for the current mode. Light/dark sheets are
/// both installed once (application priority); the mode switch only flips
/// libadwaita's color scheme, and the sheets are written so each is harmless
/// under the opposite scheme (bubble colors are absolute values).
pub(crate) fn install_theme(mode: &str) {
    let dark = match mode {
        "light" => false,
        "dark" => true,
        _ => adw::StyleManager::default().is_dark(),
    };
    install_provider(if dark {
        THEME_CSS_DARK
    } else {
        THEME_CSS_LIGHT
    });
}
