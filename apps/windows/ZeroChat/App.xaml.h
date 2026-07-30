#pragma once

#include "App.g.h"

namespace winrt::ZeroChat::implementation
{
    struct App : AppT<App>
    {
        App();
        void InitializeComponent();
        void OnLaunched(Microsoft::UI::Xaml::LaunchActivatedEventArgs const&);

    private:
        ZeroChat::MainWindow m_window{ nullptr };
    };
}

namespace winrt::ZeroChat::factory_implementation
{
    struct App : AppT<App, implementation::App>
    {
    };
}
