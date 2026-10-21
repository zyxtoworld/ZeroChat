import UIKit
import UniformTypeIdentifiers

private enum ShareExtensionBridge {
    static let appGroupIdentifier = "group.app.zerochat.client"
    static let pendingTextKey = "pendingShareText.v1"
    static let pendingTextCreatedAtKey = "pendingShareTextCreatedAt.v1"
    static let openAppURLString = "zerochat://share"

    @discardableResult
    static func save(_ text: String) -> Bool {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
            return false
        }

        defaults.set(text, forKey: pendingTextKey)
        defaults.set(Date().timeIntervalSince1970, forKey: pendingTextCreatedAtKey)
        defaults.synchronize()
        return true
    }

    static func clear() {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
            return
        }

        defaults.removeObject(forKey: pendingTextKey)
        defaults.removeObject(forKey: pendingTextCreatedAtKey)
        defaults.synchronize()
    }

    static func t(_ key: String) -> String {
        let language = Locale.preferredLanguages.first?.lowercased() ?? "en"
        let locale: String
        if language.hasPrefix("zh") {
            locale = "zh"
        } else if language.hasPrefix("es") {
            locale = "es"
        } else if language.hasPrefix("hi") {
            locale = "hi"
        } else if language.hasPrefix("ar") {
            locale = "ar"
        } else if language.hasPrefix("pt") {
            locale = "pt"
        } else if language.hasPrefix("ru") {
            locale = "ru"
        } else if language.hasPrefix("ja") {
            locale = "ja"
        } else if language.hasPrefix("ko") {
            locale = "ko"
        } else if language.hasPrefix("fr") {
            locale = "fr"
        } else {
            locale = "en"
        }

        return translations[locale]?[key] ?? translations["en"]?[key] ?? key
    }

    private static let translations: [String: [String: String]] = [
        "en": [
            "adding": "Adding to ZeroChat...",
            "opening": "Opening ZeroChat...",
            "empty": "No shareable text was found.",
        ],
        "zh": [
            "adding": "正在添加到 ZeroChat...",
            "opening": "正在打开 ZeroChat...",
            "empty": "没有找到可分享的文本。",
        ],
        "es": [
            "adding": "Añadiendo a ZeroChat...",
            "opening": "Abriendo ZeroChat...",
            "empty": "No se encontró texto para compartir.",
        ],
        "hi": [
            "adding": "ZeroChat में जोड़ा जा रहा है...",
            "opening": "ZeroChat खोला जा रहा है...",
            "empty": "साझा करने योग्य पाठ नहीं मिला।",
        ],
        "ar": [
            "adding": "جارٍ الإضافة إلى ZeroChat...",
            "opening": "جارٍ فتح ZeroChat...",
            "empty": "لم يتم العثور على نص قابل للمشاركة.",
        ],
        "pt": [
            "adding": "Adicionando ao ZeroChat...",
            "opening": "Abrindo ZeroChat...",
            "empty": "Nenhum texto compartilhável foi encontrado.",
        ],
        "ru": [
            "adding": "Добавляем в ZeroChat...",
            "opening": "Открываем ZeroChat...",
            "empty": "Текст для отправки не найден.",
        ],
        "ja": [
            "adding": "ZeroChat に追加中...",
            "opening": "ZeroChat を開いています...",
            "empty": "共有できるテキストが見つかりません。",
        ],
        "ko": [
            "adding": "ZeroChat에 추가하는 중...",
            "opening": "ZeroChat 여는 중...",
            "empty": "공유할 수 있는 텍스트를 찾지 못했습니다.",
        ],
        "fr": [
            "adding": "Ajout à ZeroChat...",
            "opening": "Ouverture de ZeroChat...",
            "empty": "Aucun texte partageable trouvé.",
        ],
    ]
}

@MainActor
private final class ShareTextCollector {
    private(set) var values: [String] = []

    func append(_ value: String?) {
        if let value {
            values.append(value)
        }
    }
}

@MainActor
@objc(ShareViewController)
final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)

    override func viewDidLoad() {
        super.viewDidLoad()

        view.backgroundColor = .systemBackground
        statusLabel.text = ShareExtensionBridge.t("adding")
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.font = .preferredFont(forTextStyle: .body)

        let stack = UIStackView(arrangedSubviews: [spinner, statusLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.layoutMarginsGuide.trailingAnchor),
        ])

        spinner.startAnimating()
        collectSharedText()
    }

    private func collectSharedText() {
        let providers = extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] } ?? []

        guard !providers.isEmpty else {
            finishWithoutText()
            return
        }

        let collector = ShareTextCollector()
        let group = DispatchGroup()

        for provider in providers {
            loadText(from: provider, group: group) { @MainActor value in
                collector.append(value)
            }
        }

        group.notify(queue: .main) { [weak self, collector] in
            let text = collector.values
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: "\n\n")
                .prefix(20000)

            guard !text.isEmpty else {
                self?.finishWithoutText()
                return
            }

            guard ShareExtensionBridge.save(String(text)) else {
                self?.finishWithoutText()
                return
            }
            self?.openZeroChat()
        }
    }

    private func loadText(
        from provider: NSItemProvider,
        group: DispatchGroup,
        completion: @escaping @MainActor @Sendable (String?) -> Void
    ) {
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            group.enter()
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                let value = Self.string(from: item)
                Task { @MainActor in
                    completion(value)
                    group.leave()
                }
            }
            return
        }

        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            group.enter()
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                let value = Self.string(from: item)
                Task { @MainActor in
                    completion(value)
                    group.leave()
                }
            }
        }
    }

    private nonisolated static func string(from item: NSSecureCoding?) -> String? {
        if let text = item as? String {
            return text
        }

        if let url = item as? URL {
            return url.absoluteString
        }

        if let data = item as? Data {
            return String(data: data, encoding: .utf8)
        }

        return nil
    }

    private func openZeroChat() {
        statusLabel.text = ShareExtensionBridge.t("opening")
        guard let extensionContext else {
            ShareExtensionBridge.clear()
            return
        }
        guard let openAppURL = URL(string: ShareExtensionBridge.openAppURLString) else {
            ShareExtensionBridge.clear()
            extensionContext.completeRequest(returningItems: nil)
            return
        }
        extensionContext.open(openAppURL) { [weak self] opened in
            Task { @MainActor [weak self] in
                if !opened {
                    ShareExtensionBridge.clear()
                }
                self?.extensionContext?.completeRequest(returningItems: nil)
            }
        }
    }

    private func finishWithoutText() {
        statusLabel.text = ShareExtensionBridge.t("empty")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
