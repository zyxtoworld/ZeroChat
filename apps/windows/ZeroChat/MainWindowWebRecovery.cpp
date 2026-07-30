#include "pch.h"
#include "MainWindow.xaml.h"

#include <array>
#include <cwctype>
#include <string>
#include <string_view>
#include <winrt/Windows.System.UserProfile.h>

namespace winrt::ZeroChat::implementation
{
    namespace
    {
        constexpr std::array<std::wstring_view, 11> RecoveryLanguageModes{
            L"system",
            L"zh-CN",
            L"en-US",
            L"es-ES",
            L"hi-IN",
            L"ar-SA",
            L"pt-BR",
            L"ru-RU",
            L"ja-JP",
            L"ko-KR",
            L"fr-FR",
        };

        bool StartsWith(std::wstring const& value, std::wstring_view prefix)
        {
            return value.rfind(prefix, 0) == 0;
        }

        std::wstring Lower(std::wstring value)
        {
            for (auto& ch : value)
            {
                ch = static_cast<wchar_t>(std::towlower(ch));
            }
            return value;
        }

        hstring LocaleFromLanguage(std::wstring const& language)
        {
            auto value = Lower(language);

            if (StartsWith(value, L"zh")) return L"zh-CN";
            if (StartsWith(value, L"en")) return L"en-US";
            if (StartsWith(value, L"es")) return L"es-ES";
            if (StartsWith(value, L"hi")) return L"hi-IN";
            if (StartsWith(value, L"ar")) return L"ar-SA";
            if (StartsWith(value, L"pt")) return L"pt-BR";
            if (StartsWith(value, L"ru")) return L"ru-RU";
            if (StartsWith(value, L"ja")) return L"ja-JP";
            if (StartsWith(value, L"ko")) return L"ko-KR";
            if (StartsWith(value, L"fr")) return L"fr-FR";
            return L"";
        }

        hstring ResolveRecoveryLocale(hstring const& mode)
        {
            auto selected = std::wstring{ mode };

            for (auto supported : RecoveryLanguageModes)
            {
                if (selected == supported && selected != L"system")
                {
                    return hstring{ selected };
                }
            }

            auto languages = winrt::Windows::System::UserProfile::GlobalizationPreferences::Languages();

            for (uint32_t index = 0; index < languages.Size(); ++index)
            {
                auto locale = LocaleFromLanguage(std::wstring{ languages.GetAt(index) });

                if (!locale.empty())
                {
                    return locale;
                }
            }

            return L"en-US";
        }
    }

    hstring MissingWebBuildHtml()
    {
        auto locale = std::wstring{ ResolveRecoveryLocale(L"system") };
        const bool zh = locale == L"zh-CN";
        const bool es = locale == L"es-ES";
        const bool hi = locale == L"hi-IN";
        const bool fr = locale == L"fr-FR";
        const bool ja = locale == L"ja-JP";
        const bool ko = locale == L"ko-KR";
        const bool ar = locale == L"ar-SA";
        const bool pt = locale == L"pt-BR";
        const bool ru = locale == L"ru-RU";
        const auto direction = ar ? L"rtl" : L"ltr";
        const auto heading = zh ? L"找不到内置网页应用" : es ? L"No se encontró la app web incluida" : hi ? L"बंडल किया गया वेब ऐप नहीं मिला" : ar ? L"تعذر العثور على تطبيق الويب المضمن" : pt ? L"App Web incluído não encontrado" : ru ? L"Встроенное веб-приложение не найдено" : fr ? L"Application Web intégrée introuvable" : ja ? L"同梱 Web アプリが見つかりません" : ko ? L"번들된 웹 앱을 찾을 수 없습니다" : L"Bundled web app not found";
        const auto body = zh ? L"Windows 外壳没有找到随应用一起打包的 Web/PWA 文件。" : es ? L"El contenedor de Windows no encontró los archivos Web/PWA incluidos con la app." : hi ? L"Windows शेल को ऐप के साथ पैक की गई Web/PWA फ़ाइलें नहीं मिलीं।" : ar ? L"لم يعثر غلاف Windows على ملفات Web/PWA المرفقة مع التطبيق." : pt ? L"O shell do Windows não encontrou os arquivos Web/PWA empacotados com o app." : ru ? L"Оболочка Windows не нашла файлы Web/PWA, упакованные вместе с приложением." : fr ? L"Le shell Windows n'a pas trouvé les fichiers Web/PWA inclus avec l'application." : ja ? L"Windows シェルはアプリに同梱された Web/PWA ファイルを見つけられませんでした。" : ko ? L"Windows 셸이 앱과 함께 패키징된 Web/PWA 파일을 찾지 못했습니다." : L"The Windows shell could not find the bundled Web/PWA files.";
        const auto hint = zh ? L"先构建 Web/PWA，再重新构建 Windows。Windows 项目会自动把 dist 复制到应用输出目录。" : es ? L"Compila Web/PWA una vez y luego recompila Windows. El proyecto Windows copia dist en la salida de la app automáticamente." : hi ? L"पहले Web/PWA बनाएं, फिर Windows को फिर से बनाएं। Windows प्रोजेक्ट dist को ऐप आउटपुट में अपने आप कॉपी करता है।" : ar ? L"ابن Web/PWA أولا، ثم أعد بناء Windows. ينسخ مشروع Windows مجلد dist إلى مخرجات التطبيق تلقائيا." : pt ? L"Compile o Web/PWA uma vez e depois recompile Windows. O projeto Windows copia dist para a saída do app automaticamente." : ru ? L"Сначала соберите Web/PWA, затем пересоберите Windows. Проект Windows автоматически копирует dist в выходную папку приложения." : fr ? L"Construisez d'abord Web/PWA, puis reconstruisez Windows. Le projet Windows copie automatiquement dist dans la sortie de l'application." : ja ? L"先に Web/PWA をビルドしてから Windows を再ビルドしてください。Windows プロジェクトは dist をアプリ出力へ自動コピーします。" : ko ? L"먼저 Web/PWA를 빌드한 뒤 Windows를 다시 빌드하세요. Windows 프로젝트가 dist를 앱 출력 폴더로 자동 복사합니다." : L"Build the Web/PWA once, then rebuild Windows. The Windows project copies dist into the app output automatically.";

        std::wstring html;
        html.reserve(3200);
        html += LR"ZEROCHAT_HTML(
<!doctype html>
<html lang=")ZEROCHAT_HTML";
        html += locale;
        html += L"\" dir=\"";
        html += direction;
        html += LR"ZEROCHAT_HTML(">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZeroChat</title>
  <style>
    :root { color-scheme: dark; font-family: "Segoe UI", system-ui, sans-serif; background: #11160f; color: #eef5ec; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
    main { width: min(520px, 100%); border: 1px solid #334034; border-radius: 8px; background: #182017; padding: 24px; box-sizing: border-box; }
    h1 { margin: 0 0 10px; font-size: 28px; letter-spacing: 0; }
    p { margin: 0 0 14px; color: #c7d2c4; line-height: 1.55; }
    code { display: block; margin-top: 12px; padding: 12px; border-radius: 6px; background: #0c110b; color: #9be3ce; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <main>
    <h1>ZeroChat</h1>
)ZEROCHAT_HTML";
        html += L"    <p>";
        html += heading;
        html += L"</p>\n    <p>";
        html += body;
        html += L"</p>\n    <p>";
        html += hint;
        html += LR"ZEROCHAT_HTML(</p>
    <code>pnpm run build</code>
  </main>
</body>
</html>
)ZEROCHAT_HTML";
        return hstring{ html };
    }
}
