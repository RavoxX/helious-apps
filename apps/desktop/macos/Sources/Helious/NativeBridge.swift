import Foundation
import CBridge
enum NativeFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { return value }; return nil }
}
actor NativeBridge {
    func call(_ request: [String: Any]) throws -> [String: Any] {
        let bytes = try JSONSerialization.data(withJSONObject: request)
        guard let source = String(data: bytes, encoding: .utf8) else { throw NativeFailure.message("Cannot encode the native request.") }
        let pointer = source.withCString { helious_call($0) }
        guard let pointer else { throw NativeFailure.message("The native engine returned no response.") }
        defer { helious_free(pointer) }
        let result = Data(String(cString: pointer).utf8)
        guard let envelope = try JSONSerialization.jsonObject(with: result) as? [String: Any] else { throw NativeFailure.message("Invalid native response.") }
        guard envelope["ok"] as? Bool == true else { throw NativeFailure.message(envelope["error"] as? String ?? "The native operation failed.") }
        return envelope["data"] as? [String: Any] ?? [:]
    }
}
struct Vault: Identifiable, Decodable {
    var id: String; var name: String; var path: String?
}
struct Space: Identifiable, Decodable {var id: String; var name: String; var kind: String}
struct Note: Identifiable, Decodable {
    var id: String; var path: String; var title: String?; var markdown: String?; var spaceId: String?; var hash: String?; var revision: Int?
}
func decode<T: Decodable>(_ value: Any, as type: T.Type) throws -> T {
    try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
}
