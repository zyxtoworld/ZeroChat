import Foundation

public let maxEncryptedBackupFileBytes = 50_000_000
public let maxSkillFileBytes = 2_000_000
public let maxImageFileBytes = 20_000_000
public let maxLocalSnapshotFileBytes = 64_000_000

public enum LocalFileReadError: Error, Equatable, LocalizedError, Sendable {
    case invalidLimit
    case tooLarge(maxBytes: Int)

    public var errorDescription: String? {
        switch self {
        case .invalidLimit:
            return "Local file size limit must not be negative."
        case .tooLarge(let maxBytes):
            return "Selected file exceeded the \(maxBytes)-byte safety limit."
        }
    }
}

public func assertLocalFileByteCount(
    _ byteCount: Int,
    maxBytes: Int
) throws {
    guard byteCount >= 0, maxBytes >= 0 else {
        throw LocalFileReadError.invalidLimit
    }
    guard byteCount <= maxBytes else {
        throw LocalFileReadError.tooLarge(maxBytes: maxBytes)
    }
}

public func readBoundedLocalFileData(
    at url: URL,
    maxBytes: Int
) throws -> Data {
    try assertLocalFileByteCount(0, maxBytes: maxBytes)

    let resourceValues = try url.resourceValues(forKeys: [.fileSizeKey])
    if let fileSize = resourceValues.fileSize {
        try assertLocalFileByteCount(fileSize, maxBytes: maxBytes)
    }

    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }

    var output = Data()
    output.reserveCapacity(min(resourceValues.fileSize ?? 0, maxBytes))

    while true {
        let remaining = maxBytes - output.count
        let requestedBytes = remaining == 0 ? 1 : min(64 * 1024, remaining)
        guard let chunk = try handle.read(upToCount: requestedBytes), !chunk.isEmpty else {
            break
        }
        guard chunk.count <= remaining else {
            throw LocalFileReadError.tooLarge(maxBytes: maxBytes)
        }

        output.append(chunk)
    }

    return output
}

public func readBoundedLocalFileText(
    at url: URL,
    maxBytes: Int
) throws -> String {
    let data = try readBoundedLocalFileData(at: url, maxBytes: maxBytes)
    guard let text = String(data: data, encoding: .utf8) else {
        throw CocoaError(.fileReadInapplicableStringEncoding)
    }
    return text
}
