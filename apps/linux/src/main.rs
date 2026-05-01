mod ai;
mod models;
mod storage;
mod sync;

use adw::prelude::*;
use gtk::glib;

fn main() -> glib::ExitCode {
    let app = adw::Application::builder()
        .application_id("app.zerochat.client")
        .build();

    app.connect_activate(build_ui);
    app.run()
}

fn build_ui(app: &adw::Application) {
    let window = adw::ApplicationWindow::builder()
        .application(app)
        .title("ZeroChat")
        .default_width(1080)
        .default_height(720)
        .build();

    let header = adw::HeaderBar::new();
    let sync_button = gtk::Button::builder().label("同步").build();
    header.pack_end(&sync_button);

    let conversations = gtk::ListBox::new();
    conversations.append(&gtk::Label::new(Some("新对话")));

    let sidebar = gtk::Box::new(gtk::Orientation::Vertical, 8);
    sidebar.set_width_request(280);
    sidebar.append(&gtk::Label::new(Some("ZeroChat")));
    sidebar.append(&conversations);

    let message_list = gtk::ListBox::new();
    message_list.append(&gtk::Label::new(Some("选择模型并开始对话")));

    let input = gtk::Entry::builder().placeholder_text("输入消息").build();
    let send = gtk::Button::builder().label("发送").build();
    let composer = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    composer.append(&input);
    composer.append(&send);

    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.append(&header);
    content.append(&message_list);
    content.append(&composer);

    let split = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    split.append(&sidebar);
    split.append(&content);

    window.set_content(Some(&split));
    window.present();
}
