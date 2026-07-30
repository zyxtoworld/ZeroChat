import SwiftUI
import WidgetKit

private enum QuickAskWidgetCopy {
    static func t(_ key: String) -> String {
        return translations[locale]?[key] ?? translations["en"]?[key] ?? key
    }

    static var isRightToLeft: Bool {
        locale == "ar"
    }

    private static var locale: String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? "en"
        if language.hasPrefix("zh") {
            return "zh"
        } else if language.hasPrefix("es") {
            return "es"
        } else if language.hasPrefix("hi") {
            return "hi"
        } else if language.hasPrefix("ar") {
            return "ar"
        } else if language.hasPrefix("pt") {
            return "pt"
        } else if language.hasPrefix("ru") {
            return "ru"
        } else if language.hasPrefix("ja") {
            return "ja"
        } else if language.hasPrefix("ko") {
            return "ko"
        } else if language.hasPrefix("fr") {
            return "fr"
        } else {
            return "en"
        }
    }

    private static let translations: [String: [String: String]] = [
        "en": [
            "displayName": "ZeroChat",
            "description": "Start a quick ZeroChat prompt from the desktop.",
            "headline": "Quick ask",
            "body": "Open a fresh chat and start typing.",
            "action": "Ask now",
            "accessibility": "Open ZeroChat quick ask",
            "accessibilityHint": "Creates a fresh chat without sending.",
        ],
        "zh": [
            "displayName": "ZeroChat",
            "description": "从桌面快速发起 ZeroChat 提问。",
            "headline": "快速提问",
            "body": "打开新对话，直接开始输入。",
            "action": "现在提问",
            "accessibility": "打开 ZeroChat 快速提问",
            "accessibilityHint": "创建新对话，不会自动发送。",
        ],
        "es": [
            "displayName": "ZeroChat",
            "description": "Inicia una pregunta rápida de ZeroChat desde el escritorio.",
            "headline": "Pregunta rápida",
            "body": "Abre un chat nuevo y empieza a escribir.",
            "action": "Preguntar",
            "accessibility": "Abrir pregunta rápida de ZeroChat",
            "accessibilityHint": "Crea un chat nuevo sin enviar.",
        ],
        "hi": [
            "displayName": "ZeroChat",
            "description": "डेस्कटॉप से ZeroChat में तुरंत प्रश्न शुरू करें।",
            "headline": "त्वरित प्रश्न",
            "body": "नई चैट खोलें और लिखना शुरू करें।",
            "action": "अभी पूछें",
            "accessibility": "ZeroChat त्वरित प्रश्न खोलें",
            "accessibilityHint": "भेजे बिना नई चैट बनाता है।",
        ],
        "ar": [
            "displayName": "ZeroChat",
            "description": "ابدأ سؤال ZeroChat سريعًا من سطح المكتب.",
            "headline": "سؤال سريع",
            "body": "افتح محادثة جديدة وابدأ الكتابة.",
            "action": "اسأل الآن",
            "accessibility": "فتح سؤال ZeroChat السريع",
            "accessibilityHint": "ينشئ محادثة جديدة من دون إرسال.",
        ],
        "pt": [
            "displayName": "ZeroChat",
            "description": "Inicie uma pergunta rápida do ZeroChat pela mesa.",
            "headline": "Pergunta rápida",
            "body": "Abra uma nova conversa e comece a digitar.",
            "action": "Perguntar",
            "accessibility": "Abrir pergunta rápida do ZeroChat",
            "accessibilityHint": "Cria uma nova conversa sem enviar.",
        ],
        "ru": [
            "displayName": "ZeroChat",
            "description": "Быстро задайте вопрос ZeroChat с рабочего стола.",
            "headline": "Быстрый вопрос",
            "body": "Откройте новый чат и начните ввод.",
            "action": "Спросить",
            "accessibility": "Открыть быстрый вопрос ZeroChat",
            "accessibilityHint": "Создает новый чат без отправки.",
        ],
        "ja": [
            "displayName": "ZeroChat",
            "description": "デスクトップから ZeroChat にすばやく質問します。",
            "headline": "クイック質問",
            "body": "新しいチャットを開いて入力を始めます。",
            "action": "今すぐ質問",
            "accessibility": "ZeroChat のクイック質問を開く",
            "accessibilityHint": "送信せずに新しいチャットを作成します。",
        ],
        "ko": [
            "displayName": "ZeroChat",
            "description": "데스크톱에서 ZeroChat 질문을 빠르게 시작합니다.",
            "headline": "빠른 질문",
            "body": "새 채팅을 열고 바로 입력하세요.",
            "action": "지금 질문",
            "accessibility": "ZeroChat 빠른 질문 열기",
            "accessibilityHint": "보내지 않고 새 채팅을 만듭니다.",
        ],
        "fr": [
            "displayName": "ZeroChat",
            "description": "Lancez une question ZeroChat rapide depuis le bureau.",
            "headline": "Question rapide",
            "body": "Ouvrez un nouveau chat et commencez à écrire.",
            "action": "Demander",
            "accessibility": "Ouvrir la question rapide ZeroChat",
            "accessibilityHint": "Cree un nouveau chat sans envoyer.",
        ],
    ]
}

private struct QuickAskEntry: TimelineEntry {
    let date: Date
}

private struct QuickAskProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickAskEntry {
        QuickAskEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (QuickAskEntry) -> Void) {
        completion(QuickAskEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickAskEntry>) -> Void) {
        completion(Timeline(entries: [QuickAskEntry(date: Date())], policy: .never))
    }
}

private struct QuickAskWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family

    let entry: QuickAskEntry

    private var isCompactFamily: Bool {
        family == .systemSmall
    }

    private var contentSpacing: CGFloat {
        isCompactFamily ? 8 : 10
    }

    private var outerPadding: CGFloat {
        isCompactFamily ? 14 : 16
    }

    private var iconSize: CGFloat {
        isCompactFamily ? 30 : 34
    }

    private var brandSymbolSize: CGFloat {
        isCompactFamily ? 14 : 16
    }

    private var actionSymbolSize: CGFloat {
        isCompactFamily ? 13 : 18
    }

    var body: some View {
        VStack(alignment: .leading, spacing: contentSpacing) {
            HStack(alignment: .center) {
                ZStack {
                    Circle()
                        .fill(Color(red: 0.06, green: 0.50, blue: 0.41))
                    Image(systemName: "sparkles")
                        .font(.system(size: brandSymbolSize, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(width: iconSize, height: iconSize)

                Spacer(minLength: 8)

                Image(systemName: "square.and.pencil")
                    .font(.system(size: actionSymbolSize, weight: .semibold))
                    .foregroundStyle(Color(red: 0.09, green: 0.16, blue: 0.14).opacity(0.68))
            }

            Spacer(minLength: 2)

            VStack(alignment: .leading, spacing: 4) {
                Text(QuickAskWidgetCopy.t("displayName"))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color(red: 0.09, green: 0.16, blue: 0.14).opacity(0.72))
                    .lineLimit(1)

                Text(QuickAskWidgetCopy.t("headline"))
                    .font((isCompactFamily ? Font.subheadline : Font.headline).weight(.semibold))
                    .foregroundStyle(Color(red: 0.08, green: 0.12, blue: 0.11))
                    .lineLimit(2)
                    .minimumScaleFactor(0.78)

                if family != .systemSmall {
                    Text(QuickAskWidgetCopy.t("body"))
                        .font(.subheadline)
                        .foregroundStyle(Color(red: 0.21, green: 0.28, blue: 0.25))
                        .lineLimit(2)
                        .minimumScaleFactor(0.82)
                }
            }

            HStack(spacing: 5) {
                Text(QuickAskWidgetCopy.t("action"))
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
                Image(systemName: "arrow.up.right")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(Color(red: 0.06, green: 0.43, blue: 0.36))
        }
        .padding(outerPadding)
        .containerBackground(for: .widget) {
            Color(red: 0.95, green: 0.98, blue: 0.96)
        }
        .widgetURL(URL(string: "zerochat://quick-ask"))
        .environment(\.layoutDirection, QuickAskWidgetCopy.isRightToLeft ? .rightToLeft : .leftToRight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(QuickAskWidgetCopy.t("accessibility"))
        .accessibilityHint(QuickAskWidgetCopy.t("accessibilityHint"))
        .accessibilityAddTraits(.isButton)
    }
}

private struct ZeroChatQuickAskWidget: Widget {
    let kind = "ZeroChatQuickAskWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuickAskProvider()) { entry in
            QuickAskWidgetEntryView(entry: entry)
        }
        .configurationDisplayName(LocalizedStringKey(QuickAskWidgetCopy.t("displayName")))
        .description(LocalizedStringKey(QuickAskWidgetCopy.t("description")))
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct ZeroChatQuickAskWidgetBundle: WidgetBundle {
    var body: some Widget {
        ZeroChatQuickAskWidget()
    }
}
