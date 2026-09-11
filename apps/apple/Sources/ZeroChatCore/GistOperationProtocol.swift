import CoreFoundation
import CryptoKit
import Foundation

let gistOperationKind = "zerochat.gistOperation"
let gistOperationObjectType = "gist-operation-v2"

enum GistOperationType: String, Codable, Sendable {
    case state
    case clear
}

enum GistTombstoneKind: String, Codable, CaseIterable, Hashable, Sendable {
    case conversation
    case message
    case provider
    case providerSecret = "provider-secret"
    case skill
}

struct GistTombstone: Codable, Hashable, Sendable {
    var fingerprint: String
    var id: String
    var kind: GistTombstoneKind
    var parentId: String?

    private enum CodingKeys: String, CodingKey {
        case fingerprint
        case id
        case kind
        case parentId
    }

    init(fingerprint: String, id: String, kind: GistTombstoneKind, parentId: String?) {
        self.fingerprint = fingerprint
        self.id = id
        self.kind = kind
        self.parentId = parentId
    }

    init(from decoder: Decoder) throws {
        try rejectUnknownGistKeys(
            decoder,
            allowed: ["fingerprint", "id", "kind", "parentId"]
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        fingerprint = try container.decode(String.self, forKey: .fingerprint)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(GistTombstoneKind.self, forKey: .kind)
        if kind == .message {
            parentId = try container.decode(String.self, forKey: .parentId)
        } else {
            guard !container.contains(.parentId) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .parentId,
                    in: container,
                    debugDescription: "Only message tombstones may contain parentId."
                )
            }
            parentId = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(fingerprint, forKey: .fingerprint)
        try container.encode(id, forKey: .id)
        try container.encode(kind, forKey: .kind)
        try container.encodeIfPresent(parentId, forKey: .parentId)
    }
}

struct GistOperation: Codable, Sendable {
    var kind: String
    var version: Int
    var id: String
    var operation: GistOperationType
    var parents: [String]
    var tombstones: [GistTombstone]
    var vault: SyncVault?

    init(
        kind: String = gistOperationKind,
        version: Int = 2,
        id: String,
        operation: GistOperationType,
        parents: [String],
        tombstones: [GistTombstone],
        vault: SyncVault?
    ) {
        self.kind = kind
        self.version = version
        self.id = id
        self.operation = operation
        self.parents = parents
        self.tombstones = tombstones
        self.vault = vault
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case version
        case id
        case operation
        case parents
        case tombstones
        case vault
    }

    init(from decoder: Decoder) throws {
        try rejectUnknownGistKeys(
            decoder,
            allowed: ["kind", "version", "id", "operation", "parents", "tombstones", "vault"]
        )
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(String.self, forKey: .kind)
        version = try container.decode(Int.self, forKey: .version)
        id = try container.decode(String.self, forKey: .id)
        operation = try container.decode(GistOperationType.self, forKey: .operation)
        parents = try container.decode([String].self, forKey: .parents)
        tombstones = try container.decode([GistTombstone].self, forKey: .tombstones)
        switch operation {
        case .state:
            vault = try container.decode(StrictGistSyncVault.self, forKey: .vault).value
        case .clear:
            guard !container.contains(.vault) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .vault,
                    in: container,
                    debugDescription: "Clear Gist operations must omit vault."
                )
            }
            vault = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(version, forKey: .version)
        try container.encode(id, forKey: .id)
        try container.encode(operation, forKey: .operation)
        try container.encode(parents, forKey: .parents)
        try container.encode(tombstones, forKey: .tombstones)
        try container.encodeIfPresent(vault, forKey: .vault)
    }
}

private struct StrictGistSyncVault: Decodable {
    let value: SyncVault

    init(from decoder: Decoder) throws {
        do {
            let json = try GistJSONValue(from: decoder)
            let object = try json.foundationObject()
            guard JSONSerialization.isValidJSONObject(object) else {
                throw SyncError.badGistOperation
            }
            let data = try JSONSerialization.data(withJSONObject: object)
            value = try decodeValidatedSyncVault(data, decoder: JSONDecoder())
        } catch {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "Gist state vault has an invalid shape.",
                    underlyingError: error
                )
            )
        }
    }
}

private indirect enum GistJSONValue: Decodable {
    case array([GistJSONValue])
    case boolean(Bool)
    case integer(Int64)
    case null
    case number(Double)
    case object([String: GistJSONValue])
    case string(String)

    init(from decoder: Decoder) throws {
        if let container = try? decoder.container(keyedBy: GistDynamicCodingKey.self) {
            var values: [String: GistJSONValue] = [:]
            for key in container.allKeys {
                values[key.stringValue] = try container.decode(GistJSONValue.self, forKey: key)
            }
            self = .object(values)
            return
        }

        if var container = try? decoder.unkeyedContainer() {
            var values: [GistJSONValue] = []
            while !container.isAtEnd {
                values.append(try container.decode(GistJSONValue.self))
            }
            self = .array(values)
            return
        }

        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Int64.self) {
            self = .integer(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    func foundationObject() throws -> Any {
        switch self {
        case .array(let values):
            return try values.map { try $0.foundationObject() }
        case .boolean(let value):
            return value
        case .integer(let value):
            return value
        case .null:
            return NSNull()
        case .number(let value):
            guard value.isFinite else { throw SyncError.badGistOperation }
            return value
        case .object(let values):
            return try values.mapValues { try $0.foundationObject() }
        case .string(let value):
            return value
        }
    }
}

private struct GistDynamicCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init?(stringValue: String) {
        self.stringValue = stringValue
        intValue = nil
    }

    init?(intValue: Int) {
        stringValue = String(intValue)
        self.intValue = intValue
    }
}

private func rejectUnknownGistKeys(_ decoder: Decoder, allowed: Set<String>) throws {
    let container = try decoder.container(keyedBy: GistDynamicCodingKey.self)
    let unknown = container.allKeys
        .map(\.stringValue)
        .filter { !allowed.contains($0) }
        .sorted(by: utf16CodeUnitLess)
    guard unknown.isEmpty else {
        throw DecodingError.dataCorrupted(
            DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "Unknown Gist operation fields: \(unknown.joined(separator: ", "))."
            )
        )
    }
}

struct MaterializedGistOperations: Sendable {
    var heads: [String]
    var tombstones: [GistTombstone]
    var vault: SyncVault?
}

struct GistRemoteState: Sendable {
    var heads: [String]
    var legacy: Bool
    var managedFiles: [String]
    var operations: [String: GistOperation]
    var tombstones: [GistTombstone]
    var vault: SyncVault?
}

private struct GistOperationCore: Encodable {
    var kind: String
    var version: Int
    var operation: GistOperationType
    var parents: [String]
    var tombstones: [GistTombstone]
    var vault: SyncVault?

    private enum CodingKeys: String, CodingKey {
        case kind
        case version
        case operation
        case parents
        case tombstones
        case vault
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(version, forKey: .version)
        try container.encode(operation, forKey: .operation)
        try container.encode(parents, forKey: .parents)
        try container.encode(tombstones, forKey: .tombstones)
        try container.encodeIfPresent(vault, forKey: .vault)
    }
}

struct BaselineConversation: Codable, Sendable {
    var fingerprint: String
    var messages: [String: String]
}

struct GistBaseline: Codable, Sendable {
    var conversations: [String: BaselineConversation]
    var providerSecrets: [String: String]
    var providers: [String: String]
    var skills: [String: String]
}

struct GistCursor: Codable, Sendable {
    var baseline: GistBaseline
    var heads: [String]
    var localSyncAt: Int64
    var version: Int
}

struct GistCursorStore {
    private let defaults: UserDefaults
    private static let prefix = "zerochat:gist-sync-cursor:v2:"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load(gistId: String, fileName: String, localSyncAt: Int64? = nil) -> GistCursor? {
        guard let data = defaults.data(forKey: storageKey(gistId: gistId, fileName: fileName)),
              let cursor = try? JSONDecoder().decode(GistCursor.self, from: data),
              isValidGistCursor(cursor),
              localSyncAt == nil || cursor.localSyncAt == localSyncAt else {
            return nil
        }
        return cursor
    }

    func store(
        gistId: String,
        fileName: String,
        heads: [String],
        localSyncAt: Int64?,
        vault: SyncVault
    ) throws {
        guard let localSyncAt else { return }
        let cursor = GistCursor(
            baseline: try createGistBaseline(vault),
            heads: normalizedGistParents(heads),
            localSyncAt: localSyncAt,
            version: 1
        )
        defaults.set(try canonicalJSONData(cursor), forKey: storageKey(gistId: gistId, fileName: fileName))
    }

    func clear(gistId: String, fileName: String) {
        defaults.removeObject(forKey: storageKey(gistId: gistId, fileName: fileName))
    }

    private func storageKey(gistId: String, fileName: String) -> String {
        let allowed = CharacterSet.alphanumerics
        let encodedId = gistId.addingPercentEncoding(withAllowedCharacters: allowed) ?? gistId
        let encodedFile = fileName.addingPercentEncoding(withAllowedCharacters: allowed) ?? fileName
        return "\(Self.prefix)\(encodedId):\(encodedFile)"
    }
}

func gistOperationFilePrefix(_ fileName: String) -> String {
    "\(fileName).zerochat-op-"
}

func gistOperationFileName(_ fileName: String, id: String) -> String {
    "\(gistOperationFilePrefix(fileName))\(id).json"
}

func gistOperationId(fileName: String, candidate: String) -> String? {
    let prefix = gistOperationFilePrefix(fileName)
    guard candidate.hasPrefix(prefix), candidate.hasSuffix(".json") else { return nil }
    let start = candidate.index(candidate.startIndex, offsetBy: prefix.count)
    let end = candidate.index(candidate.endIndex, offsetBy: -5)
    let id = String(candidate[start..<end])
    return isLowercaseSHA256Hex(id) ? id : nil
}

func isManagedGistFile(fileName: String, candidate: String) -> Bool {
    candidate == fileName || gistOperationId(fileName: fileName, candidate: candidate) != nil
}

func normalizeGistVault(_ vault: SyncVault) -> SyncVault {
    var copy = vault
    copy.data.skills = copy.data.skills ?? []
    copy.data.skillSettings = copy.data.skillSettings ?? SkillSettings()
    copy.data.sync.encryptionEnabled = true
    copy.data.sync.gistId = nil
    copy.data.sync.gistFile = nil
    copy.data.sync.lastSyncAt = nil
    copy.data.sync.lastSyncStatus = nil
    for providerIndex in copy.data.providers.indices {
        if copy.data.providers[providerIndex].clientRequestMode == false {
            copy.data.providers[providerIndex].clientRequestMode = nil
        }
        if copy.data.providers[providerIndex].custom == false {
            copy.data.providers[providerIndex].custom = nil
        }
        if copy.data.providers[providerIndex].models?.isEmpty == true {
            copy.data.providers[providerIndex].models = nil
        }
        if copy.data.providers[providerIndex].capabilities?.isEmpty == true {
            copy.data.providers[providerIndex].capabilities = nil
        }
    }
    for conversationIndex in copy.data.conversations.indices {
        for messageIndex in copy.data.conversations[conversationIndex].messages.indices {
            if copy.data.conversations[conversationIndex].messages[messageIndex].status == "done" {
                copy.data.conversations[conversationIndex].messages[messageIndex].status = nil
            }
            if copy.data.conversations[conversationIndex].messages[messageIndex].attachments?.isEmpty == true {
                copy.data.conversations[conversationIndex].messages[messageIndex].attachments = nil
            }
        }
    }
    if copy.data.preferences.chatContextMessageLimit == 24 {
        copy.data.preferences.chatContextMessageLimit = nil
    }
    if copy.data.preferences.dismissedDangerWarnings?.isEmpty == true {
        copy.data.preferences.dismissedDangerWarnings = nil
    }
    if copy.data.preferences.dismissedFeatureHints?.isEmpty == true {
        copy.data.preferences.dismissedFeatureHints = nil
    }
    return copy
}

func gistVaultsEqual(_ left: SyncVault, _ right: SyncVault) throws -> Bool {
    try canonicalJSONData(normalizeGistVault(left)) == canonicalJSONData(normalizeGistVault(right))
}

func createGistStateOperation(
    parents: [String],
    vault: SyncVault,
    tombstones: [GistTombstone]
) throws -> GistOperation {
    guard parents.allSatisfy(isLowercaseSHA256Hex),
          tombstones.allSatisfy(isValidGistTombstone) else {
        throw SyncError.badGistOperation
    }
    let core = GistOperationCore(
        kind: gistOperationKind,
        version: 2,
        operation: .state,
        parents: normalizedGistParents(parents),
        tombstones: normalizedGistTombstones(tombstones),
        vault: normalizeGistVault(vault)
    )
    return GistOperation(
        id: try gistOperationId(core),
        operation: .state,
        parents: core.parents,
        tombstones: core.tombstones,
        vault: core.vault
    )
}

func createGistClearOperation(parents: [String]) throws -> GistOperation {
    guard parents.allSatisfy(isLowercaseSHA256Hex) else {
        throw SyncError.badGistOperation
    }
    let core = GistOperationCore(
        kind: gistOperationKind,
        version: 2,
        operation: .clear,
        parents: normalizedGistParents(parents),
        tombstones: [],
        vault: nil
    )
    return GistOperation(
        id: try gistOperationId(core),
        operation: .clear,
        parents: core.parents,
        tombstones: [],
        vault: nil
    )
}

func canonicalGistOperationCoreJSON(_ operation: GistOperation) throws -> String {
    let core = try normalizedGistOperationCore(operation)
    guard let value = String(data: try canonicalJSONData(core), encoding: .utf8) else {
        throw SyncError.badGistOperation
    }
    return value
}

func validateGistOperation(_ operation: GistOperation, expectedId: String) throws -> GistOperation {
    guard operation.kind == gistOperationKind,
          operation.version == 2,
          isLowercaseSHA256Hex(operation.id),
          operation.parents.allSatisfy(isLowercaseSHA256Hex),
          Set(operation.parents).count == operation.parents.count,
          operation.tombstones.allSatisfy(isValidGistTombstone) else {
        throw SyncError.badGistOperation
    }
    if operation.operation == .clear {
        guard operation.vault == nil, operation.tombstones.isEmpty else {
            throw SyncError.badGistOperation
        }
    } else {
        guard let vault = operation.vault else { throw SyncError.badGistOperation }
        _ = try decodeValidatedSyncVault(try canonicalJSONData(vault), decoder: JSONDecoder())
    }

    let core = try normalizedGistOperationCore(operation)
    let computedId = try gistOperationId(core)
    guard operation.id == computedId, operation.id == expectedId else {
        throw SyncError.badGistOperation
    }
    return GistOperation(
        id: operation.id,
        operation: operation.operation,
        parents: core.parents,
        tombstones: core.tombstones,
        vault: core.vault
    )
}

func materializeGistOperations(_ operations: [String: GistOperation]) throws -> MaterializedGistOperations {
    guard !operations.isEmpty else {
        return MaterializedGistOperations(heads: [], tombstones: [], vault: nil)
    }

    var ancestorMemo: [String: Set<String>] = [:]
    var visiting = Set<String>()

    func ancestors(_ id: String) throws -> Set<String> {
        if let cached = ancestorMemo[id] { return cached }
        guard !visiting.contains(id) else { throw SyncError.badGistOperation }
        visiting.insert(id)
        var result: Set<String> = [id]
        if let operation = operations[id] {
            for parent in operation.parents where operations[parent] != nil {
                result.formUnion(try ancestors(parent))
            }
        }
        visiting.remove(id)
        ancestorMemo[id] = result
        return result
    }

    func active(_ ids: [String]) throws -> [String] {
        let existing = Array(Set(ids))
            .filter { operations[$0] != nil }
            .sorted(by: utf16CodeUnitLess)
        var result: [String] = []
        for candidate in existing {
            var isAncestor = false
            for other in existing where other != candidate {
                if try ancestors(other).contains(candidate) {
                    isAncestor = true
                    break
                }
            }
            if !isAncestor { result.append(candidate) }
        }
        return result
    }

    func commonAncestors(_ ids: [String]) throws -> [String] {
        let sets = try ids.map(ancestors)
        guard var common = sets.first else { return [] }
        for values in sets.dropFirst() { common.formIntersection(values) }
        return try active(Array(common))
    }

    enum CachedVault {
        case empty
        case value(SyncVault)
    }
    var operationMemo: [String: CachedVault] = [:]
    var groupMemo: [String: CachedVault] = [:]

    func materializeGroup(_ ids: [String]) throws -> SyncVault? {
        let currentHeads = try active(ids)
        let key = currentHeads.joined(separator: ",")
        if let cached = groupMemo[key] {
            if case .value(let vault) = cached { return vault }
            return nil
        }
        guard !currentHeads.isEmpty else {
            groupMemo[key] = .empty
            return nil
        }
        if currentHeads.count == 1, let id = currentHeads.first {
            if let cached = operationMemo[id] {
                if case .value(let vault) = cached { return vault }
                return nil
            }
            guard let operation = operations[id] else { throw SyncError.badGistOperation }
            let vault = operation.operation == .state ? operation.vault.map(normalizeGistVault) : nil
            operationMemo[id] = vault.map(CachedVault.value) ?? .empty
            groupMemo[key] = vault.map(CachedVault.value) ?? .empty
            return vault
        }

        var merged: SyncVault?
        var mergedIds: [String] = []
        for id in currentHeads {
            guard let operation = operations[id] else { throw SyncError.badGistOperation }
            guard operation.operation == .state, let current = operation.vault.map(normalizeGistVault) else {
                continue
            }
            guard let previous = merged else {
                merged = current
                mergedIds.append(id)
                continue
            }
            let common = try commonAncestors(mergedIds + [id])
            let base = common.isEmpty ? nil : try materializeGroup(common)
            merged = try mergeGistVaults(base: base, remote: previous, local: current)
            mergedIds.append(id)
        }
        groupMemo[key] = merged.map(CachedVault.value) ?? .empty
        return merged
    }

    let heads = try active(Array(operations.keys))
    let stateHeads = heads.filter { operations[$0]?.operation == .state }
    var vault = try materializeGroup(stateHeads)
    let tombstones = normalizedGistTombstones(
        stateHeads.flatMap { operations[$0]?.tombstones ?? [] }
    )
    if let current = vault {
        vault = try removeGistTombstonedRecords(from: current, tombstones: tombstones)
    }
    return MaterializedGistOperations(
        heads: heads,
        tombstones: vault.map { current in
            tombstones.filter { gistTombstoneStillActive(vault: current, tombstone: $0) }
        } ?? [],
        vault: vault
    )
}

func tombstonesFromGistCursor(_ cursor: GistCursor, vault: SyncVault) throws -> [GistTombstone] {
    let normalized = normalizeGistVault(vault)
    let providers = Set(normalized.data.providers.map(\.id))
    let conversations = Set(normalized.data.conversations.map(\.id))
    let skills = Set((normalized.data.skills ?? []).map(\.id))
    let secrets = Set(normalized.secrets.providerKeys.keys)
    var tombstones: [GistTombstone] = []

    tombstones += missingGistTombstones(.provider, cursor.baseline.providers, providers)
    tombstones += missingGistTombstones(
        .conversation,
        cursor.baseline.conversations.mapValues { $0.fingerprint },
        conversations
    )
    tombstones += missingGistTombstones(.skill, cursor.baseline.skills, skills)
    tombstones += missingGistTombstones(.providerSecret, cursor.baseline.providerSecrets, secrets)

    for conversation in normalized.data.conversations {
        guard let baseline = cursor.baseline.conversations[conversation.id] else { continue }
        let messageIds = Set(conversation.messages.map(\.id))
        for (id, fingerprint) in baseline.messages where !messageIds.contains(id) {
            tombstones.append(GistTombstone(
                fingerprint: fingerprint,
                id: id,
                kind: .message,
                parentId: conversation.id
            ))
        }
    }
    return normalizedGistTombstones(tombstones)
}

func tombstonesBetweenGistVaults(_ baseline: SyncVault, _ current: SyncVault) throws -> [GistTombstone] {
    let cursor = GistCursor(
        baseline: try createGistBaseline(baseline),
        heads: [],
        localSyncAt: 0,
        version: 1
    )
    return try tombstonesFromGistCursor(cursor, vault: current)
}

private func canonicalJSONData<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    let encoded = try encoder.encode(value)
    let object = try JSONSerialization.jsonObject(with: encoded, options: [.fragmentsAllowed])
    var output = ""
    try appendCanonicalJSON(object, to: &output)
    guard let data = output.data(using: .utf8) else { throw SyncError.badGistOperation }
    return data
}

private func appendCanonicalJSON(_ value: Any, to output: inout String) throws {
    if value is NSNull {
        output += "null"
        return
    }
    if let string = value as? String {
        appendJSONString(string, to: &output)
        return
    }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            output += number.boolValue ? "true" : "false"
        } else {
            let data = try JSONSerialization.data(withJSONObject: number, options: [.fragmentsAllowed])
            guard let encoded = String(data: data, encoding: .utf8) else {
                throw SyncError.badGistOperation
            }
            output += encoded
        }
        return
    }
    if let array = value as? [Any] {
        output += "["
        for (index, item) in array.enumerated() {
            if index > 0 { output += "," }
            try appendCanonicalJSON(item, to: &output)
        }
        output += "]"
        return
    }
    if let object = value as? [String: Any] {
        output += "{"
        for (index, key) in object.keys.sorted(by: utf16CodeUnitLess).enumerated() {
            if index > 0 { output += "," }
            appendJSONString(key, to: &output)
            output += ":"
            guard let item = object[key] else { throw SyncError.badGistOperation }
            try appendCanonicalJSON(item, to: &output)
        }
        output += "}"
        return
    }
    throw SyncError.badGistOperation
}

private func appendJSONString(_ value: String, to output: inout String) {
    output += "\""
    for scalar in value.unicodeScalars {
        switch scalar.value {
        case 0x08: output += "\\b"
        case 0x09: output += "\\t"
        case 0x0A: output += "\\n"
        case 0x0C: output += "\\f"
        case 0x0D: output += "\\r"
        case 0x22: output += "\\\""
        case 0x5C: output += "\\\\"
        case 0x00...0x1F:
            output += String(format: "\\u%04x", scalar.value)
        default:
            output += String(scalar)
        }
    }
    output += "\""
}

private func utf16CodeUnitLess(_ left: String, _ right: String) -> Bool {
    var leftIterator = left.utf16.makeIterator()
    var rightIterator = right.utf16.makeIterator()
    while true {
        let leftValue = leftIterator.next()
        let rightValue = rightIterator.next()
        switch (leftValue, rightValue) {
        case (nil, nil): return false
        case (nil, .some): return true
        case (.some, nil): return false
        case (.some(let leftValue), .some(let rightValue)):
            if leftValue != rightValue { return leftValue < rightValue }
        }
    }
}

func gistUTF16CodeUnitLess(_ left: String, _ right: String) -> Bool {
    utf16CodeUnitLess(left, right)
}

private func gistOperationId<T: Encodable>(_ core: T) throws -> String {
    SHA256.hash(data: try canonicalJSONData(core))
        .map { String(format: "%02x", $0) }
        .joined()
}

private func normalizedGistParents(_ parents: [String]) -> [String] {
    Array(Set(parents)).sorted(by: utf16CodeUnitLess)
}

private func gistTombstoneKey(_ tombstone: GistTombstone) -> String {
    [
        tombstone.kind.rawValue,
        tombstone.parentId ?? "",
        tombstone.id,
        tombstone.fingerprint,
    ].joined(separator: "\0")
}

private struct GistUTF16Key: Hashable {
    let codeUnits: [UInt16]

    init(_ value: String) {
        codeUnits = Array(value.utf16)
    }
}

private func normalizedGistTombstones(_ tombstones: [GistTombstone]) -> [GistTombstone] {
    var unique: [GistUTF16Key: GistTombstone] = [:]
    for tombstone in tombstones {
        unique[GistUTF16Key(gistTombstoneKey(tombstone))] = tombstone
    }
    return unique.values.sorted {
        utf16CodeUnitLess(gistTombstoneKey($0), gistTombstoneKey($1))
    }
}

private func normalizedGistOperationCore(_ operation: GistOperation) throws -> GistOperationCore {
    switch operation.operation {
    case .clear:
        return GistOperationCore(
            kind: gistOperationKind,
            version: 2,
            operation: .clear,
            parents: normalizedGistParents(operation.parents),
            tombstones: [],
            vault: nil
        )
    case .state:
        guard let vault = operation.vault else { throw SyncError.badGistOperation }
        return GistOperationCore(
            kind: gistOperationKind,
            version: 2,
            operation: .state,
            parents: normalizedGistParents(operation.parents),
            tombstones: normalizedGistTombstones(operation.tombstones),
            vault: normalizeGistVault(vault)
        )
    }
}

private func isValidGistTombstone(_ tombstone: GistTombstone) -> Bool {
    guard !tombstone.id.isEmpty, isLowercaseSHA256Hex(tombstone.fingerprint) else { return false }
    if tombstone.kind == .message {
        return !(tombstone.parentId?.isEmpty ?? true)
    }
    return tombstone.parentId == nil
}

private func isLowercaseSHA256Hex(_ value: String) -> Bool {
    value.utf8.count == 64
        && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}

private func isValidGistCursor(_ cursor: GistCursor) -> Bool {
    guard cursor.version == 1,
          cursor.localSyncAt >= 0,
          cursor.heads.allSatisfy(isLowercaseSHA256Hex),
          Set(cursor.heads).count == cursor.heads.count else {
        return false
    }
    var fingerprints = Array(cursor.baseline.providers.values)
    fingerprints.append(contentsOf: cursor.baseline.skills.values)
    fingerprints.append(contentsOf: cursor.baseline.providerSecrets.values)
    for conversation in cursor.baseline.conversations.values {
        fingerprints.append(conversation.fingerprint)
        fingerprints.append(contentsOf: conversation.messages.values)
    }
    return fingerprints.allSatisfy(isLowercaseSHA256Hex)
}

private func fingerprint<T: Encodable>(_ value: T) throws -> String {
    try gistOperationId(value)
}

private func createGistBaseline(_ vault: SyncVault) throws -> GistBaseline {
    let normalized = normalizeGistVault(vault)
    var conversations: [String: BaselineConversation] = [:]
    for conversation in normalized.data.conversations {
        var messages: [String: String] = [:]
        for message in conversation.messages { messages[message.id] = try fingerprint(message) }
        conversations[conversation.id] = BaselineConversation(
            fingerprint: try fingerprint(conversation),
            messages: messages
        )
    }
    var providers: [String: String] = [:]
    for provider in normalized.data.providers { providers[provider.id] = try fingerprint(provider) }
    var skills: [String: String] = [:]
    for skill in normalized.data.skills ?? [] { skills[skill.id] = try fingerprint(skill) }
    var providerSecrets: [String: String] = [:]
    for (id, value) in normalized.secrets.providerKeys { providerSecrets[id] = try fingerprint(value) }
    return GistBaseline(
        conversations: conversations,
        providerSecrets: providerSecrets,
        providers: providers,
        skills: skills
    )
}

private func missingGistTombstones(
    _ kind: GistTombstoneKind,
    _ baseline: [String: String],
    _ currentIds: Set<String>
) -> [GistTombstone] {
    baseline.compactMap { id, value in
        currentIds.contains(id) ? nil : GistTombstone(
            fingerprint: value,
            id: id,
            kind: kind,
            parentId: nil
        )
    }
}

private func mergeGistProviderSecrets(
    base: ProviderSecrets?,
    remote: ProviderSecrets,
    local: ProviderSecrets
) -> ProviderSecrets {
    var keys = Set(base?.providerKeys.keys.map { $0 } ?? [])
    keys.formUnion(remote.providerKeys.keys)
    keys.formUnion(local.providerKeys.keys)
    var values: [String: String] = [:]
    for key in keys {
        let baseValue = base?.providerKeys[key]
        let remoteValue = remote.providerKeys[key]
        let localValue = local.providerKeys[key]
        let value: String?
        if localValue == baseValue {
            value = remoteValue
        } else if remoteValue == baseValue || remoteValue == localValue {
            value = localValue
        } else {
            value = localValue
        }
        if let value { values[key] = value }
    }
    return ProviderSecrets(providerKeys: values)
}

func mergeGistVaults(base: SyncVault?, remote: SyncVault, local: SyncVault) throws -> SyncVault {
    SyncVault(
        data: try mergeConcurrentGistAppData(
            base: base?.data,
            remote: remote.data,
            local: local.data,
            mergedAt: max(remote.data.updatedAt, local.data.updatedAt)
        ),
        secrets: mergeGistProviderSecrets(base: base?.secrets, remote: remote.secrets, local: local.secrets)
    )
}

private func removeGistTombstonedRecords(
    from vault: SyncVault,
    tombstones: [GistTombstone]
) throws -> SyncVault {
    var copy = normalizeGistVault(vault)
    func matches<T: Encodable>(_ value: T, kind: GistTombstoneKind, id: String, parentId: String? = nil) throws -> Bool {
        let candidates = tombstones.filter {
            $0.kind == kind && $0.id == id && $0.parentId == parentId
        }
        guard !candidates.isEmpty else { return false }
        let valueFingerprint = try fingerprint(value)
        return candidates.contains { $0.fingerprint == valueFingerprint }
    }

    copy.data.providers = try copy.data.providers.filter {
        try !matches($0, kind: .provider, id: $0.id)
    }
    copy.data.conversations = try copy.data.conversations.compactMap { conversation in
        if try matches(conversation, kind: .conversation, id: conversation.id) { return nil }
        var updated = conversation
        updated.messages = try conversation.messages.filter {
            try !matches($0, kind: .message, id: $0.id, parentId: conversation.id)
        }
        return updated
    }
    copy.data.skills = try (copy.data.skills ?? []).filter {
        try !matches($0, kind: .skill, id: $0.id)
    }
    copy.secrets.providerKeys = try copy.secrets.providerKeys.filter { id, value in
        try !matches(value, kind: .providerSecret, id: id)
    }
    return normalizeGistVault(copy)
}

private func gistTombstoneStillActive(vault: SyncVault, tombstone: GistTombstone) -> Bool {
    switch tombstone.kind {
    case .provider:
        return !vault.data.providers.contains { $0.id == tombstone.id }
    case .conversation:
        return !vault.data.conversations.contains { $0.id == tombstone.id }
    case .skill:
        return !(vault.data.skills ?? []).contains { $0.id == tombstone.id }
    case .providerSecret:
        return vault.secrets.providerKeys[tombstone.id] == nil
    case .message:
        guard let conversation = vault.data.conversations.first(where: { $0.id == tombstone.parentId }) else {
            return true
        }
        return !conversation.messages.contains { $0.id == tombstone.id }
    }
}

private func jsonEqual<T: Encodable>(_ left: T?, _ right: T?) throws -> Bool {
    switch (left, right) {
    case (nil, nil): return true
    case (.some(let left), .some(let right)):
        return try canonicalJSONData(left) == canonicalJSONData(right)
    default: return false
    }
}

private func resolveGistValue<T: Encodable>(
    base: T?,
    remote: T?,
    local: T?,
    preferLocal: Bool
) throws -> T? {
    if try jsonEqual(local, base) { return remote }
    if try jsonEqual(remote, base) || (try jsonEqual(local, remote)) { return local }
    return preferLocal ? local : remote
}

private func mergeGistStringSet(
    base: [String]?,
    remote: [String]?,
    local: [String]?,
    preferLocal: Bool
) throws -> [String] {
    let baseSet = Set(base ?? [])
    let remoteSet = Set(remote ?? [])
    let localSet = Set(local ?? [])
    var seen = Set<String>()
    var result: [String] = []
    for value in (local ?? []) + (remote ?? []) + (base ?? []) where seen.insert(value).inserted {
        if try resolveGistValue(
            base: baseSet.contains(value),
            remote: remoteSet.contains(value),
            local: localSet.contains(value),
            preferLocal: preferLocal
        ) == true {
            result.append(value)
        }
    }
    return result
}

private func mergeGistRecords<T: Identifiable & Encodable>(
    base: [T],
    remote: [T],
    local: [T],
    remoteBranchUpdatedAt: Int64,
    localBranchUpdatedAt: Int64,
    itemUpdatedAt: (T, Int64) -> Int64,
    mergeSameId: (T?, T, T) throws -> T
) throws -> [T] where T.ID == String {
    let baseById = gistRecordMap(base)
    let remoteById = gistRecordMap(remote)
    let localById = gistRecordMap(local)
    var ordered: [String] = []
    var seen = Set<String>()
    for id in local.map(\.id) + remote.map(\.id) + base.map(\.id) where seen.insert(id).inserted {
        ordered.append(id)
    }
    var merged: [T] = []
    for id in ordered {
        let baseline = baseById[id]
        let remoteValue = remoteById[id]
        let localValue = localById[id]
        guard let baseline else {
            if let remoteValue, let localValue {
                merged.append(try mergeSameId(nil, remoteValue, localValue))
            } else if let value = localValue ?? remoteValue {
                merged.append(value)
            }
            continue
        }
        if remoteValue == nil, localValue == nil { continue }
        if remoteValue == nil, let localValue {
            if !(try jsonEqual(localValue, baseline)),
               itemUpdatedAt(localValue, localBranchUpdatedAt) > remoteBranchUpdatedAt {
                merged.append(localValue)
            }
            continue
        }
        if let remoteValue, localValue == nil {
            if !(try jsonEqual(remoteValue, baseline)),
               itemUpdatedAt(remoteValue, remoteBranchUpdatedAt) > localBranchUpdatedAt {
                merged.append(remoteValue)
            }
            continue
        }
        if let remoteValue, let localValue {
            merged.append(try mergeSameId(baseline, remoteValue, localValue))
        }
    }
    return merged
}

private func gistRecordMap<T: Identifiable>(_ values: [T]) -> [String: T] where T.ID == String {
    var result: [String: T] = [:]
    for value in values { result[value.id] = value }
    return result
}

private func mergeGistAttachment(
    base: MessageAttachment?,
    remote: MessageAttachment,
    local: MessageAttachment,
    preferLocal: Bool
) throws -> MessageAttachment {
    MessageAttachment(
        id: local.id,
        kind: try resolveGistValue(base: base?.kind, remote: remote.kind, local: local.kind, preferLocal: preferLocal) ?? local.kind,
        purpose: try resolveGistValue(base: base?.purpose, remote: remote.purpose, local: local.purpose, preferLocal: preferLocal),
        mimeType: try resolveGistValue(base: base?.mimeType, remote: remote.mimeType, local: local.mimeType, preferLocal: preferLocal) ?? local.mimeType,
        dataUrl: try resolveGistValue(base: base?.dataUrl, remote: remote.dataUrl, local: local.dataUrl, preferLocal: preferLocal),
        url: try resolveGistValue(base: base?.url, remote: remote.url, local: local.url, preferLocal: preferLocal),
        alt: try resolveGistValue(base: base?.alt, remote: remote.alt, local: local.alt, preferLocal: preferLocal),
        model: try resolveGistValue(base: base?.model, remote: remote.model, local: local.model, preferLocal: preferLocal),
        createdAt: min(remote.createdAt, local.createdAt)
    )
}

private func mergeGistMessage(
    base: ChatMessage?,
    remote: ChatMessage,
    local: ChatMessage,
    remoteUpdatedAt: Int64,
    localUpdatedAt: Int64
) throws -> ChatMessage {
    let preferLocal = localUpdatedAt >= remoteUpdatedAt
    let attachments = try mergeGistRecords(
        base: base?.attachments ?? [],
        remote: remote.attachments ?? [],
        local: local.attachments ?? [],
        remoteBranchUpdatedAt: remoteUpdatedAt,
        localBranchUpdatedAt: localUpdatedAt,
        itemUpdatedAt: { value, _ in value.createdAt },
        mergeSameId: { try mergeGistAttachment(base: $0, remote: $1, local: $2, preferLocal: preferLocal) }
    ).sorted {
        $0.createdAt != $1.createdAt
            ? $0.createdAt < $1.createdAt
            : gistUTF16CodeUnitLess($0.id, $1.id)
    }
    return ChatMessage(
        id: local.id,
        role: try resolveGistValue(base: base?.role, remote: remote.role, local: local.role, preferLocal: preferLocal) ?? local.role,
        content: try resolveGistValue(base: base?.content, remote: remote.content, local: local.content, preferLocal: preferLocal) ?? local.content,
        createdAt: min(remote.createdAt, local.createdAt),
        status: try resolveGistValue(base: base?.status, remote: remote.status, local: local.status, preferLocal: preferLocal),
        error: try resolveGistValue(base: base?.error, remote: remote.error, local: local.error, preferLocal: preferLocal),
        attachments: attachments.isEmpty ? nil : attachments,
        queuedTextRequest: try resolveGistValue(
            base: base?.queuedTextRequest,
            remote: remote.queuedTextRequest,
            local: local.queuedTextRequest,
            preferLocal: preferLocal
        )
    )
}

private func mergeGistConversation(
    base: Conversation?,
    remote: Conversation,
    local: Conversation
) throws -> Conversation {
    let preferLocal = local.updatedAt >= remote.updatedAt
    let messages = try mergeGistRecords(
        base: base?.messages ?? [],
        remote: remote.messages,
        local: local.messages,
        remoteBranchUpdatedAt: remote.updatedAt,
        localBranchUpdatedAt: local.updatedAt,
        itemUpdatedAt: { _, branchUpdatedAt in branchUpdatedAt },
        mergeSameId: {
            try mergeGistMessage(
                base: $0,
                remote: $1,
                local: $2,
                remoteUpdatedAt: remote.updatedAt,
                localUpdatedAt: local.updatedAt
            )
        }
    ).sorted {
        $0.createdAt != $1.createdAt
            ? $0.createdAt < $1.createdAt
            : gistUTF16CodeUnitLess($0.id, $1.id)
    }
    return Conversation(
        id: local.id,
        title: try resolveGistValue(base: base?.title, remote: remote.title, local: local.title, preferLocal: preferLocal) ?? local.title,
        providerId: try resolveGistValue(base: base?.providerId, remote: remote.providerId, local: local.providerId, preferLocal: preferLocal) ?? local.providerId,
        model: try resolveGistValue(base: base?.model, remote: remote.model, local: local.model, preferLocal: preferLocal) ?? local.model,
        messages: messages,
        createdAt: min(remote.createdAt, local.createdAt),
        updatedAt: max(remote.updatedAt, local.updatedAt)
    )
}

private func mergeGistProvider(
    base: ProviderConfig?,
    remote: ProviderConfig,
    local: ProviderConfig
) throws -> ProviderConfig {
    let preferLocal = local.updatedAt >= remote.updatedAt
    let models = try mergeGistStringSet(base: base?.models, remote: remote.models, local: local.models, preferLocal: preferLocal)
    let capabilities = try mergeGistStringSet(
        base: base?.capabilities,
        remote: remote.capabilities,
        local: local.capabilities,
        preferLocal: preferLocal
    )
    return ProviderConfig(
        id: local.id,
        name: try resolveGistValue(base: base?.name, remote: remote.name, local: local.name, preferLocal: preferLocal) ?? local.name,
        kind: try resolveGistValue(base: base?.kind, remote: remote.kind, local: local.kind, preferLocal: preferLocal) ?? local.kind,
        baseUrl: try resolveGistValue(base: base?.baseUrl, remote: remote.baseUrl, local: local.baseUrl, preferLocal: preferLocal) ?? local.baseUrl,
        proxyUrl: try resolveGistValue(base: base?.proxyUrl, remote: remote.proxyUrl, local: local.proxyUrl, preferLocal: preferLocal),
        clientRequestMode: try resolveGistValue(base: base?.clientRequestMode, remote: remote.clientRequestMode, local: local.clientRequestMode, preferLocal: preferLocal),
        model: try resolveGistValue(base: base?.model, remote: remote.model, local: local.model, preferLocal: preferLocal) ?? local.model,
        imageModel: try resolveGistValue(base: base?.imageModel, remote: remote.imageModel, local: local.imageModel, preferLocal: preferLocal),
        audioSpeechModel: try resolveGistValue(base: base?.audioSpeechModel, remote: remote.audioSpeechModel, local: local.audioSpeechModel, preferLocal: preferLocal),
        audioTranscriptionModel: try resolveGistValue(base: base?.audioTranscriptionModel, remote: remote.audioTranscriptionModel, local: local.audioTranscriptionModel, preferLocal: preferLocal),
        embeddingModel: try resolveGistValue(base: base?.embeddingModel, remote: remote.embeddingModel, local: local.embeddingModel, preferLocal: preferLocal),
        moderationModel: try resolveGistValue(base: base?.moderationModel, remote: remote.moderationModel, local: local.moderationModel, preferLocal: preferLocal),
        realtimeModel: try resolveGistValue(base: base?.realtimeModel, remote: remote.realtimeModel, local: local.realtimeModel, preferLocal: preferLocal),
        models: models.isEmpty ? nil : models,
        capabilities: capabilities.isEmpty ? nil : capabilities,
        enabled: try resolveGistValue(base: base?.enabled, remote: remote.enabled, local: local.enabled, preferLocal: preferLocal) ?? local.enabled,
        needsApiKey: try resolveGistValue(base: base?.needsApiKey, remote: remote.needsApiKey, local: local.needsApiKey, preferLocal: preferLocal) ?? local.needsApiKey,
        custom: try resolveGistValue(base: base?.custom, remote: remote.custom, local: local.custom, preferLocal: preferLocal),
        createdAt: min(remote.createdAt, local.createdAt),
        updatedAt: max(remote.updatedAt, local.updatedAt)
    )
}

private func mergeGistSkillChunk(
    base: UserSkillChunk?,
    remote: UserSkillChunk,
    local: UserSkillChunk,
    preferLocal: Bool
) throws -> UserSkillChunk {
    UserSkillChunk(
        id: local.id,
        heading: try resolveGistValue(base: base?.heading, remote: remote.heading, local: local.heading, preferLocal: preferLocal) ?? local.heading,
        content: try resolveGistValue(base: base?.content, remote: remote.content, local: local.content, preferLocal: preferLocal) ?? "",
        contentRef: try resolveGistValue(base: base?.contentRef, remote: remote.contentRef, local: local.contentRef, preferLocal: preferLocal),
        contentPreview: try resolveGistValue(base: base?.contentPreview, remote: remote.contentPreview, local: local.contentPreview, preferLocal: preferLocal),
        keywords: try mergeGistStringSet(base: base?.keywords, remote: remote.keywords, local: local.keywords, preferLocal: preferLocal),
        tokenEstimate: try resolveGistValue(base: base?.tokenEstimate, remote: remote.tokenEstimate, local: local.tokenEstimate, preferLocal: preferLocal) ?? local.tokenEstimate
    )
}

private func mergeGistSkill(
    base: UserSkill?,
    remote: UserSkill,
    local: UserSkill
) throws -> UserSkill {
    let preferLocal = local.updatedAt >= remote.updatedAt
    let chunks = try mergeGistRecords(
        base: base?.chunks ?? [],
        remote: remote.chunks,
        local: local.chunks,
        remoteBranchUpdatedAt: remote.updatedAt,
        localBranchUpdatedAt: local.updatedAt,
        itemUpdatedAt: { _, branchUpdatedAt in branchUpdatedAt },
        mergeSameId: { try mergeGistSkillChunk(base: $0, remote: $1, local: $2, preferLocal: preferLocal) }
    )
    return UserSkill(
        id: local.id,
        name: try resolveGistValue(base: base?.name, remote: remote.name, local: local.name, preferLocal: preferLocal) ?? local.name,
        description: try resolveGistValue(base: base?.description, remote: remote.description, local: local.description, preferLocal: preferLocal) ?? local.description,
        fileName: try resolveGistValue(base: base?.fileName, remote: remote.fileName, local: local.fileName, preferLocal: preferLocal),
        contentType: try resolveGistValue(base: base?.contentType, remote: remote.contentType, local: local.contentType, preferLocal: preferLocal) ?? local.contentType,
        sourceSize: try resolveGistValue(base: base?.sourceSize, remote: remote.sourceSize, local: local.sourceSize, preferLocal: preferLocal) ?? local.sourceSize,
        contentHash: try resolveGistValue(base: base?.contentHash, remote: remote.contentHash, local: local.contentHash, preferLocal: preferLocal) ?? local.contentHash,
        keywords: try mergeGistStringSet(base: base?.keywords, remote: remote.keywords, local: local.keywords, preferLocal: preferLocal),
        chunks: chunks,
        fixed: try resolveGistValue(base: base?.fixed, remote: remote.fixed, local: local.fixed, preferLocal: preferLocal) ?? local.fixed,
        enabled: try resolveGistValue(base: base?.enabled, remote: remote.enabled, local: local.enabled, preferLocal: preferLocal) ?? local.enabled,
        autoMatch: try resolveGistValue(base: base?.autoMatch, remote: remote.autoMatch, local: local.autoMatch, preferLocal: preferLocal) ?? local.autoMatch,
        createdAt: min(remote.createdAt, local.createdAt),
        updatedAt: max(remote.updatedAt, local.updatedAt)
    )
}

private func mergeGistSkillSettings(
    base: SkillSettings?,
    remote: SkillSettings,
    local: SkillSettings,
    preferLocal: Bool
) throws -> SkillSettings {
    SkillSettings(
        autoMatch: try resolveGistValue(base: base?.autoMatch, remote: remote.autoMatch, local: local.autoMatch, preferLocal: preferLocal) ?? local.autoMatch,
        contextBudget: try resolveGistValue(base: base?.contextBudget, remote: remote.contextBudget, local: local.contextBudget, preferLocal: preferLocal) ?? local.contextBudget,
        maxAutoSkills: try resolveGistValue(base: base?.maxAutoSkills, remote: remote.maxAutoSkills, local: local.maxAutoSkills, preferLocal: preferLocal) ?? local.maxAutoSkills
    )
}

private func mergeGistSyncConfig(
    base: SyncConfig?,
    remote: SyncConfig,
    local: SyncConfig,
    preferLocal: Bool
) throws -> SyncConfig {
    SyncConfig(
        mode: try resolveGistValue(base: base?.mode, remote: remote.mode, local: local.mode, preferLocal: preferLocal) ?? local.mode,
        autoSync: try resolveGistValue(base: base?.autoSync, remote: remote.autoSync, local: local.autoSync, preferLocal: preferLocal) ?? local.autoSync,
        encryptionEnabled: try resolveGistValue(base: base?.encryptionEnabled, remote: remote.encryptionEnabled, local: local.encryptionEnabled, preferLocal: preferLocal) ?? true,
        gistId: try resolveGistValue(base: base?.gistId, remote: remote.gistId, local: local.gistId, preferLocal: preferLocal),
        gistFile: try resolveGistValue(base: base?.gistFile, remote: remote.gistFile, local: local.gistFile, preferLocal: preferLocal),
        workerEndpoint: try resolveGistValue(base: base?.workerEndpoint, remote: remote.workerEndpoint, local: local.workerEndpoint, preferLocal: preferLocal),
        lastSyncAt: try resolveGistValue(base: base?.lastSyncAt, remote: remote.lastSyncAt, local: local.lastSyncAt, preferLocal: preferLocal),
        lastSyncStatus: try resolveGistValue(base: base?.lastSyncStatus, remote: remote.lastSyncStatus, local: local.lastSyncStatus, preferLocal: preferLocal)
    )
}

private func mergeGistPreferences(
    base: Preferences?,
    remote: Preferences,
    local: Preferences,
    preferLocal: Bool
) throws -> Preferences {
    let warnings = try mergeGistStringSet(
        base: base?.dismissedDangerWarnings,
        remote: remote.dismissedDangerWarnings,
        local: local.dismissedDangerWarnings,
        preferLocal: preferLocal
    )
    let hints = try mergeGistStringSet(
        base: base?.dismissedFeatureHints,
        remote: remote.dismissedFeatureHints,
        local: local.dismissedFeatureHints,
        preferLocal: preferLocal
    )
    return Preferences(
        firstRunDone: try resolveGistValue(base: base?.firstRunDone, remote: remote.firstRunDone, local: local.firstRunDone, preferLocal: preferLocal) ?? local.firstRunDone,
        theme: try resolveGistValue(base: base?.theme, remote: remote.theme, local: local.theme, preferLocal: preferLocal) ?? local.theme,
        language: try resolveGistValue(base: base?.language, remote: remote.language, local: local.language, preferLocal: preferLocal) ?? local.language,
        compactMode: try resolveGistValue(base: base?.compactMode, remote: remote.compactMode, local: local.compactMode, preferLocal: preferLocal) ?? local.compactMode,
        chatContextMessageLimit: try resolveGistValue(base: base?.chatContextMessageLimit, remote: remote.chatContextMessageLimit, local: local.chatContextMessageLimit, preferLocal: preferLocal),
        activeConversationId: try resolveGistValue(base: base?.activeConversationId, remote: remote.activeConversationId, local: local.activeConversationId, preferLocal: preferLocal),
        dismissedDangerWarnings: warnings,
        dismissedFeatureHints: hints
    )
}

private func mergeConcurrentGistAppData(
    base: AppSnapshot?,
    remote: AppSnapshot,
    local: AppSnapshot,
    mergedAt: Int64
) throws -> AppSnapshot {
    let preferLocal = local.updatedAt >= remote.updatedAt
    var providers = try mergeGistRecords(
        base: base?.providers ?? [],
        remote: remote.providers,
        local: local.providers,
        remoteBranchUpdatedAt: remote.updatedAt,
        localBranchUpdatedAt: local.updatedAt,
        itemUpdatedAt: { value, _ in value.updatedAt },
        mergeSameId: mergeGistProvider
    )
    var conversations = try mergeGistRecords(
        base: base?.conversations ?? [],
        remote: remote.conversations,
        local: local.conversations,
        remoteBranchUpdatedAt: remote.updatedAt,
        localBranchUpdatedAt: local.updatedAt,
        itemUpdatedAt: { value, _ in value.updatedAt },
        mergeSameId: mergeGistConversation
    )
    let skills = try mergeGistRecords(
        base: base?.skills ?? [],
        remote: remote.skills ?? [],
        local: local.skills ?? [],
        remoteBranchUpdatedAt: remote.updatedAt,
        localBranchUpdatedAt: local.updatedAt,
        itemUpdatedAt: { value, _ in value.updatedAt },
        mergeSameId: mergeGistSkill
    )
    if providers.isEmpty { providers = Array((preferLocal ? local.providers : remote.providers).prefix(1)) }
    if conversations.isEmpty {
        conversations = Array((preferLocal ? local.conversations : remote.conversations).prefix(1))
    }
    let providersById = gistRecordMap(providers)
    conversations = conversations.map { conversation in
        guard providersById[conversation.providerId] == nil, let fallback = providers.first else {
            return conversation
        }
        var copy = conversation
        copy.providerId = fallback.id
        copy.model = fallback.model
        copy.updatedAt = max(copy.updatedAt, mergedAt)
        return copy
    }
    var preferences = try mergeGistPreferences(
        base: base?.preferences,
        remote: remote.preferences,
        local: local.preferences,
        preferLocal: preferLocal
    )
    let conversationIds = Set(conversations.map(\.id))
    preferences.activeConversationId = [
        preferences.activeConversationId,
        local.preferences.activeConversationId,
        remote.preferences.activeConversationId,
        conversations.first?.id,
    ].compactMap { $0 }.first { conversationIds.contains($0) }
    let remoteSettings = remote.skillSettings ?? SkillSettings()
    let localSettings = local.skillSettings ?? SkillSettings()
    return AppSnapshot(
        version: 1,
        providers: providers,
        conversations: conversations,
        skills: skills,
        skillSettings: try mergeGistSkillSettings(
            base: base?.skillSettings,
            remote: remoteSettings,
            local: localSettings,
            preferLocal: preferLocal
        ),
        sync: try mergeGistSyncConfig(
            base: base?.sync,
            remote: remote.sync,
            local: local.sync,
            preferLocal: preferLocal
        ),
        preferences: preferences,
        updatedAt: max(remote.updatedAt, local.updatedAt, mergedAt)
    )
}
