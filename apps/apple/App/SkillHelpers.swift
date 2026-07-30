import Foundation
import CryptoKit
import ZeroChatCore

func makeNativeSkill(
    name: String,
    content: String,
    contentType: String,
    fileName: String? = nil,
    id: String = UUID().uuidString,
    createdAt: Int64 = nowMillis(),
    fixed: Bool = false,
    enabled: Bool = true,
    autoMatch: Bool = true,
    fallbackSkillName: String,
    fallbackHeading: String
) -> UserSkill {
    let normalized = content
        .replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let now = nowMillis()
    let chunks = chunkSkillContent(normalized, fallbackHeading: fallbackHeading)
    let description = normalized
        .split(separator: "\n")
        .map { line in
            line.replacingOccurrences(
                of: #"^#{1,6}\s+"#,
                with: "",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        .first { !$0.isEmpty && !$0.hasPrefix("```") }
        .map { String($0.prefix(140)) } ?? ""

    return UserSkill(
        id: id,
        name: name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? (fileName ?? fallbackSkillName) : name,
        description: description,
        fileName: fileName,
        contentType: contentType,
        sourceSize: normalized.count,
        contentHash: skillSha256Hex(normalized),
        keywords: skillKeywords("\(name)\n\(description)\n\(normalized)", limit: 48),
        chunks: chunks,
        fixed: fixed,
        enabled: enabled,
        autoMatch: autoMatch,
        createdAt: createdAt,
        updatedAt: now
    )
}

func chunkSkillContent(_ content: String, fallbackHeading: String) -> [UserSkillChunk] {
    let maxChunkChars = 2600
    var chunks: [UserSkillChunk] = []
    var start = content.startIndex
    let heading = content
        .split(separator: "\n")
        .first { $0.hasPrefix("#") }
        .map {
            $0.replacingOccurrences(
                of: #"^#{1,6}\s+"#,
                with: "",
                options: .regularExpression
            )
            .trimmingCharacters(in: .whitespacesAndNewlines)
        } ?? fallbackHeading

    while start < content.endIndex {
        let end = content.index(start, offsetBy: maxChunkChars, limitedBy: content.endIndex) ?? content.endIndex
        let part = String(content[start..<end]).trimmingCharacters(in: .whitespacesAndNewlines)

        if !part.isEmpty {
            chunks.append(
                UserSkillChunk(
                    id: "chunk-\(chunks.count + 1)",
                    heading: heading.isEmpty ? fallbackHeading : heading,
                    content: part,
                    keywords: skillKeywords(part, limit: 28),
                    tokenEstimate: max(1, Int(ceil(Double(part.count) / 3.8)))
                )
            )
        }

        start = end
    }

    return chunks
}

func skillContentType(fileName: String) -> String {
    let lower = fileName.lowercased()

    if lower.hasSuffix(".json") {
        return "json"
    }

    if lower.hasSuffix(".md") || lower.hasSuffix(".markdown") {
        return "markdown"
    }

    return "text"
}

func nativeSkillContent(_ skill: UserSkill) -> String {
    skill.chunks.map(\.content).joined(separator: "\n\n")
}

func skillMetaText(_ skill: UserSkill, _ i18n: NativeI18n) -> String {
    i18n.t("settings.skillMeta")
        .replacingOccurrences(
            of: "{chunks}",
            with: i18n.formatNumber(skill.chunks.count)
        )
        .replacingOccurrences(
            of: "{tokens}",
            with: i18n.formatNumber(skill.chunks.reduce(0) { $0 + $1.tokenEstimate })
        )
}

func skillListProgressText(_ i18n: NativeI18n, shown: Int, total: Int) -> String {
    i18n.t("settings.skillListProgress")
        .replacingOccurrences(of: "{shown}", with: i18n.formatNumber(shown))
        .replacingOccurrences(of: "{total}", with: i18n.formatNumber(total))
}

func skillKeywords(_ content: String, limit: Int) -> [String] {
    let words = content
        .lowercased()
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { $0.count >= 2 }
    let counts = Dictionary(words.map { ($0, 1) }, uniquingKeysWith: +)

    return counts
        .sorted { left, right in
            left.value == right.value ? left.key < right.key : left.value > right.value
        }
        .prefix(limit)
        .map(\.key)
}

func skillSha256Hex(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8))
        .map { String(format: "%02x", $0) }
        .joined()
}
