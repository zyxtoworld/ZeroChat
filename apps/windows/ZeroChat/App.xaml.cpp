#include "pch.h"
#include "App.xaml.h"
#if __has_include("App.g.cpp")
#include "App.g.cpp"
#endif
#include "MainWindow.xaml.h"
#include <windows.h>

using namespace winrt;
using namespace Microsoft::UI::Xaml;

namespace winrt::ZeroChat::implementation
{
    App::App()
    {
    }

    void App::InitializeComponent()
    {
    }

    void App::OnLaunched(LaunchActivatedEventArgs const& args)
    {
        m_window = make<MainWindow>(args.Arguments());
        m_window.Activate();
    }
}

int __stdcall wWinMain(HINSTANCE, HINSTANCE, PWSTR, int)
{
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    Microsoft::UI::Xaml::Application::Start([](auto&&)
    {
        static auto app = winrt::make_self<winrt::ZeroChat::implementation::App>();
    });
    return 0;
}
