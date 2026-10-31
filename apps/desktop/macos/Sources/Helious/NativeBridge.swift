import Foundation
import CBridge

enum NativeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let value) = self { return value }
        return nil
    }
}

/// Asynchronous C-bridge client that dispatches synchronous `helious_call` work onto a dedicated
/// serial background queue so Swift's cooperative thread pool and `@MainActor` UI never block.
final class NativeBridge: @unchecked Sendable {
    private let queue = DispatchQueue(label: "work.helious.engine", qos: .userInitiated)

    func call(_ request: [String: Any]) async throws -> [String: Any] {
        let bytes = try JSONSerialization.data(withJSONObject: request)
        guard let source = String(data: bytes, encoding: .utf8) else {
            throw NativeFailure.message("Cannot encode the native request.")
        }
        let rawEnvelope: String = try await withCheckedThrowingContinuation { continuation in
            queue.async {
                let pointer = source.withCString { helious_call($0) }
                guard let pointer else {
                    continuation.resume(throwing: NativeFailure.message("The native engine returned no response."))
                    return
                }
                defer { helious_free(pointer) }
                continuation.resume(returning: String(cString: pointer))
            }
        }
        let result = Data(rawEnvelope.utf8)
        guard let envelope = try JSONSerialization.jsonObject(with: result) as? [String: Any] else {
            throw NativeFailure.message("Invalid native response.")
        }
        guard envelope["ok"] as? Bool == true else {
            throw NativeFailure.message(envelope["error"] as? String ?? "The native operation failed.")
        }
        return envelope["data"] as? [String: Any] ?? [:]
    }
}

struct Vault: Identifiable, Decodable, Equatable, Hashable {
    var id: String
    var name: String
    var path: String?
}

struct Space: Identifiable, Decodable, Equatable, Hashable {
    var id: String
    var name: String
    var kind: String
}

struct Note: Identifiable, Decodable, Equatable, Hashable {
    var id: String
    var path: String
    var title: String?
    var markdown: String?
    var spaceId: String?
    var hash: String?
    var revision: Int?
}

func decode<T: Decodable>(_ value: Any, as type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
}
