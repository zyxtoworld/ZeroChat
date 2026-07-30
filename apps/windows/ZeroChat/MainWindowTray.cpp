#include "pch.h"
#include "MainWindow.xaml.h"
#include "resource.h"

#include <microsoft.ui.xaml.window.h>
#include <string>

namespace winrt::ZeroChat::implementation
{
    namespace
    {
        constexpr UINT WindowTrayMessage = WM_APP + 42;
        constexpr UINT_PTR TrayIconId = 101;
        constexpr UINT TrayOpenCommand = 40001;
        constexpr UINT TrayNewChatCommand = 40002;
        constexpr UINT TrayExitCommand = 40003;
        constexpr int MinWindowWidth = 900;
        constexpr int MinWindowHeight = 600;
        constexpr int DefaultWindowWidth = 1280;
        constexpr int DefaultWindowHeight = 735;
        constexpr wchar_t WindowPropName[] = L"ZeroChat.MainWindow";

        long MaxLong(long left, long right)
        {
            return left > right ? left : right;
        }

        long MinLong(long left, long right)
        {
            return left < right ? left : right;
        }

        HICON LoadZeroChatTrayIcon(int width, int height)
        {
            return static_cast<HICON>(LoadImageW(
                GetModuleHandleW(nullptr),
                MAKEINTRESOURCEW(IDI_ZEROCHAT_APP),
                IMAGE_ICON,
                width,
                height,
                LR_DEFAULTCOLOR));
        }
    }

    void MainWindow::InitializeTrayIcon()
    {
        if (m_windowHandle)
        {
            return;
        }

        auto nativeWindow = this->try_as<IWindowNative>();
        if (!nativeWindow)
        {
            return;
        }

        HWND windowHandle = nullptr;
        if (FAILED(nativeWindow->get_WindowHandle(&windowHandle)) || !windowHandle)
        {
            return;
        }

        m_windowHandle = windowHandle;
        m_taskbarCreatedMessage = RegisterWindowMessageW(L"TaskbarCreated");
        SetPropW(m_windowHandle, WindowPropName, reinterpret_cast<HANDLE>(this));
        m_originalWindowProc = reinterpret_cast<WNDPROC>(
            SetWindowLongPtrW(m_windowHandle, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(&MainWindow::TrayWindowProc)));

        m_trayIconData = {};
        m_trayIconData.cbSize = sizeof(m_trayIconData);
        m_trayIconData.hWnd = m_windowHandle;
        m_trayIconData.uID = TrayIconId;
        m_trayIconData.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        m_trayIconData.uCallbackMessage = WindowTrayMessage;

        static HICON trayIcon = LoadZeroChatTrayIcon(GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON));
        m_trayIconData.hIcon = trayIcon;
        wcscpy_s(m_trayIconData.szTip, L"ZeroChat");

        AddTrayIcon();

        EnsureUsableWindowBounds();
    }

    bool MainWindow::AddTrayIcon()
    {
        m_trayIconAdded = false;
        if (!m_windowHandle || !Shell_NotifyIconW(NIM_ADD, &m_trayIconData))
        {
            return false;
        }

        m_trayIconAdded = true;
        m_trayIconData.uVersion = NOTIFYICON_VERSION_4;
        Shell_NotifyIconW(NIM_SETVERSION, &m_trayIconData);
        return true;
    }

    void MainWindow::DestroyTrayIcon()
    {
        if (m_trayIconAdded)
        {
            Shell_NotifyIconW(NIM_DELETE, &m_trayIconData);
            m_trayIconAdded = false;
        }
    }

    void MainWindow::ShowTrayMenu()
    {
        if (!m_windowHandle)
        {
            return;
        }

        HMENU menu = CreatePopupMenu();
        if (!menu)
        {
            return;
        }

        auto openLabel = std::wstring{ Text(L"action.open") };
        auto newChatLabel = std::wstring{ Text(L"title.newChat") };
        auto exitLabel = std::wstring{ Text(L"action.exit") };

        AppendMenuW(menu, MF_STRING, TrayOpenCommand, openLabel.c_str());
        AppendMenuW(menu, MF_STRING, TrayNewChatCommand, newChatLabel.c_str());
        AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(menu, MF_STRING, TrayExitCommand, exitLabel.c_str());

        POINT cursor{};
        GetCursorPos(&cursor);
        SetForegroundWindow(m_windowHandle);
        auto command = TrackPopupMenu(
            menu,
            TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN,
            cursor.x,
            cursor.y,
            0,
            m_windowHandle,
            nullptr);
        DestroyMenu(menu);
        PostMessageW(m_windowHandle, WM_NULL, 0, 0);

        switch (command)
        {
        case TrayOpenCommand:
            RestoreFromTray();
            break;
        case TrayNewChatCommand:
            TriggerTrayNewChat();
            break;
        case TrayExitCommand:
            ExitFromTray();
            break;
        default:
            break;
        }
    }

    void MainWindow::RestoreFromTray()
    {
        if (!m_windowHandle)
        {
            return;
        }

        ResumeWebViewFromTray();
        ShowWindow(m_windowHandle, SW_SHOW);
        ShowWindow(m_windowHandle, SW_RESTORE);
        EnsureUsableWindowBounds();
        SetForegroundWindow(m_windowHandle);
    }

    void MainWindow::EnsureUsableWindowBounds()
    {
        if (!m_windowHandle)
        {
            return;
        }

        RECT rect{};
        if (!GetWindowRect(m_windowHandle, &rect))
        {
            return;
        }

        const auto currentWidth = rect.right - rect.left;
        const auto currentHeight = rect.bottom - rect.top;

        if (currentWidth >= MinWindowWidth && currentHeight >= MinWindowHeight)
        {
            return;
        }

        HMONITOR monitor = MonitorFromWindow(m_windowHandle, MONITOR_DEFAULTTONEAREST);
        MONITORINFO monitorInfo{};
        monitorInfo.cbSize = sizeof(monitorInfo);

        RECT workArea{};
        if (monitor && GetMonitorInfoW(monitor, &monitorInfo))
        {
            workArea = monitorInfo.rcWork;
        }
        else
        {
            workArea.left = 0;
            workArea.top = 0;
            workArea.right = GetSystemMetrics(SM_CXSCREEN);
            workArea.bottom = GetSystemMetrics(SM_CYSCREEN);
        }

        const auto workWidth = MaxLong(1, workArea.right - workArea.left);
        const auto workHeight = MaxLong(1, workArea.bottom - workArea.top);
        const auto targetWidth = MinLong(MaxLong(MinWindowWidth, DefaultWindowWidth), workWidth);
        const auto targetHeight = MinLong(MaxLong(MinWindowHeight, DefaultWindowHeight), workHeight);
        const auto targetLeft = workArea.left + MaxLong(0, (workWidth - targetWidth) / 2);
        const auto targetTop = workArea.top + MaxLong(0, (workHeight - targetHeight) / 2);

        SetWindowPos(
            m_windowHandle,
            nullptr,
            targetLeft,
            targetTop,
            targetWidth,
            targetHeight,
            SWP_NOZORDER | SWP_NOACTIVATE);
    }

    bool MainWindow::HideToTray()
    {
        if (!m_windowHandle || (!m_trayIconAdded && !AddTrayIcon()))
        {
            return false;
        }

        SuspendWebViewForTray();
        ShowWindow(m_windowHandle, SW_HIDE);
        return true;
    }

    void MainWindow::SuspendWebViewForTray()
    {
        using namespace Microsoft::UI::Xaml;

        if (m_webViewSuspendedForTray)
        {
            return;
        }

        m_webViewSuspendedForTray = true;

        if (!m_WebView)
        {
            return;
        }

        try
        {
            m_WebView.Visibility(Visibility::Collapsed);

            if (auto coreWebView = m_WebView.CoreWebView2())
            {
                m_webViewTraySuspendOperation = coreWebView.TrySuspendAsync();
            }
        }
        catch (...)
        {
            m_webViewTraySuspendOperation = nullptr;
        }
    }

    void MainWindow::ResumeWebViewFromTray()
    {
        using namespace Microsoft::UI::Xaml;

        if (m_webViewTraySuspendOperation)
        {
            try
            {
                m_webViewTraySuspendOperation.Cancel();
            }
            catch (...)
            {
            }
        }

        m_webViewTraySuspendOperation = nullptr;

        if (m_WebView)
        {
            try
            {
                if (auto coreWebView = m_WebView.CoreWebView2())
                {
                    coreWebView.Resume();
                }
            }
            catch (...)
            {
                // The WebView may have auto-resumed while becoming visible.
            }

            try
            {
                m_WebView.Visibility(Visibility::Visible);
            }
            catch (...)
            {
            }
        }

        m_webViewSuspendedForTray = false;
    }

    void MainWindow::TriggerTrayNewChat()
    {
        RestoreFromTray();

        try
        {
            if (m_WebView && m_WebView.CoreWebView2())
            {
                m_WebView.CoreWebView2().ExecuteScriptAsync(
                    LR"ZEROCHAT_JS((() => {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'n',
    code: 'KeyN',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  }));
})())ZEROCHAT_JS");
            }
        }
        catch (...)
        {
            // The tray still restores the app even if WebView2 is not ready yet.
        }
    }

    void MainWindow::ExitFromTray()
    {
        DestroyTrayIcon();

        if (m_windowHandle)
        {
            PostMessageW(m_windowHandle, WM_CLOSE, 0, 0);
        }
        else
        {
            Close();
        }
    }

    LRESULT CALLBACK MainWindow::TrayWindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam)
    {
        auto window = reinterpret_cast<MainWindow*>(GetPropW(hwnd, WindowPropName));

        if (window)
        {
            if (
                window->m_taskbarCreatedMessage != 0 &&
                message == window->m_taskbarCreatedMessage)
            {
                window->m_trayIconAdded = false;
                if (!window->AddTrayIcon() && !IsWindowVisible(hwnd))
                {
                    window->RestoreFromTray();
                }
                return 0;
            }

            if (message == WindowTrayMessage)
            {
                if (LOWORD(lparam) == WM_RBUTTONUP || LOWORD(lparam) == WM_CONTEXTMENU)
                {
                    window->ShowTrayMenu();
                    return 0;
                }

                if (LOWORD(lparam) == WM_LBUTTONDBLCLK)
                {
                    window->RestoreFromTray();
                    return 0;
                }
            }

            if (message == WM_GETMINMAXINFO)
            {
                auto info = reinterpret_cast<MINMAXINFO*>(lparam);
                if (info)
                {
                    info->ptMinTrackSize.x = MaxLong(info->ptMinTrackSize.x, MinWindowWidth);
                    info->ptMinTrackSize.y = MaxLong(info->ptMinTrackSize.y, MinWindowHeight);
                }
                return 0;
            }

            if (message == WM_SYSCOMMAND && (wparam & 0xFFF0) == SC_MINIMIZE)
            {
                if (window->HideToTray())
                {
                    return 0;
                }
            }

            if (message == WM_SIZE && wparam == SIZE_MINIMIZED)
            {
                if (window->HideToTray())
                {
                    return 0;
                }
            }

            if (
                message == WM_SIZE &&
                (wparam == SIZE_RESTORED || wparam == SIZE_MAXIMIZED) &&
                window->m_webViewSuspendedForTray)
            {
                window->ResumeWebViewFromTray();
            }

            if (message == WM_COMMAND)
            {
                switch (LOWORD(wparam))
                {
                case TrayOpenCommand:
                    window->RestoreFromTray();
                    return 0;
                case TrayNewChatCommand:
                    window->TriggerTrayNewChat();
                    return 0;
                case TrayExitCommand:
                    window->ExitFromTray();
                    return 0;
                default:
                    break;
                }
            }

            if (message == WM_DESTROY)
            {
                window->DestroyTrayIcon();
            }

            if (message == WM_NCDESTROY)
            {
                auto original = window->m_originalWindowProc;
                RemovePropW(hwnd, WindowPropName);
                window->m_originalWindowProc = nullptr;
                window->m_windowHandle = nullptr;

                if (original)
                {
                    SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(original));
                    return CallWindowProcW(original, hwnd, message, wparam, lparam);
                }
            }

            if (window->m_originalWindowProc)
            {
                return CallWindowProcW(window->m_originalWindowProc, hwnd, message, wparam, lparam);
            }
        }

        return DefWindowProcW(hwnd, message, wparam, lparam);
    }
}
