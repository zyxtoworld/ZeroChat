#include "pch.h"
#include "App.xaml.h"
#if __has_include("App.g.cpp")
#include "App.g.cpp"
#endif
#include "MainWindow.xaml.h"
#include <chrono>
#include <windows.h>
#include <microsoft.ui.xaml.window.h>

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
        m_window.Activated([](auto&&, auto&&)
        {
            ApplyZeroChatWindowIconToProcessWindows();
        });
        m_window.Activate();

        auto nativeWindow = m_window.try_as<IWindowNative>();
        HWND windowHandle = nullptr;
        if (nativeWindow && SUCCEEDED(nativeWindow->get_WindowHandle(&windowHandle)))
        {
            ApplyZeroChatWindowIcon(windowHandle);
        }
        ApplyZeroChatWindowIconToProcessWindows();
        m_window.DispatcherQueue().TryEnqueue([windowHandle]()
        {
            if (windowHandle)
            {
                ApplyZeroChatWindowIcon(windowHandle);
            }
            ApplyZeroChatWindowIconToProcessWindows();
        });
        auto iconRetryTimer = m_window.DispatcherQueue().CreateTimer();
        iconRetryTimer.Interval(std::chrono::milliseconds(250));
        iconRetryTimer.IsRepeating(true);
        iconRetryTimer.Tick([iconRetryTimer, windowHandle, retryCount = 0](auto&&, auto&&) mutable
        {
            if (windowHandle)
            {
                ApplyZeroChatWindowIcon(windowHandle);
            }
            ApplyZeroChatWindowIconToProcessWindows();
            if (++retryCount >= 120)
            {
                iconRetryTimer.Stop();
            }
        });
        iconRetryTimer.Start();
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
