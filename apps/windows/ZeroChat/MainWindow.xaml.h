#pragma once

#include "MainWindow.xaml.g.h"

namespace winrt::ZeroChat::implementation
{
    struct MainWindow : MainWindowT<MainWindow>
    {
        MainWindow();
    };
}
