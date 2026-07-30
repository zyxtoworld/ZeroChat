#include "pch.h"

namespace winrt::ZeroChat::implementation
{
    using namespace Microsoft::UI::Xaml;
    using namespace Microsoft::UI::Xaml::Controls;

    TextBlock FallbackText(hstring const& value, double fontSize)
    {
        TextBlock block;
        block.Text(value);
        block.TextWrapping(TextWrapping::Wrap);
        if (fontSize > 0)
        {
            block.FontSize(fontSize);
        }
        return block;
    }

    TextBlock FallbackHintText(hstring const& value)
    {
        auto block = FallbackText(value, 12);
        block.Opacity(0.78);
        return block;
    }

    Button FallbackButton(hstring const& value)
    {
        Button item;
        item.Content(box_value(value));
        item.HorizontalAlignment(HorizontalAlignment::Stretch);
        return item;
    }

    ComboBoxItem FallbackComboItem(hstring const& value)
    {
        ComboBoxItem item;
        item.Content(box_value(value));
        return item;
    }

    ComboBoxItem FallbackImageModeItem(hstring const& shortLabel, hstring const& fullLabel)
    {
        ComboBoxItem item;
        item.Content(box_value(shortLabel));
        Microsoft::UI::Xaml::Automation::AutomationProperties::SetName(item, fullLabel);
        ToolTipService::SetToolTip(item, box_value(fullLabel));
        return item;
    }

    ComboBox FallbackCombo(hstring const& header)
    {
        ComboBox item;
        item.Header(box_value(header));
        item.HorizontalAlignment(HorizontalAlignment::Stretch);
        return item;
    }

    TextBox FallbackTextBox(hstring const& header)
    {
        TextBox item;
        item.Header(box_value(header));
        return item;
    }

    PasswordBox FallbackPasswordBox(hstring const& header)
    {
        PasswordBox item;
        item.Header(box_value(header));
        return item;
    }

    ToggleSwitch FallbackToggle(hstring const& header, bool on)
    {
        ToggleSwitch item;
        item.Header(box_value(header));
        item.IsOn(on);
        return item;
    }

    InfoBar FallbackInfoBar(hstring const& message, InfoBarSeverity severity)
    {
        InfoBar item;
        item.IsOpen(true);
        item.Severity(severity);
        item.Message(message);
        return item;
    }

    void DisableFallbackControl(Control const& control)
    {
        control.IsEnabled(false);
    }
}
