# Changelog

## 0.8.1 — Native desktop rebuild and public app distribution

Application/self-hosting source and releases now live in RavoxX/helious-apps. Marketing code, illustrations and film remain private. AGENTS.md describes repository ownership, checks, Cloud availability and signing boundaries.

Added Rust/egui/eframe/wgpu Windows UI and SwiftUI/AppKit macOS UI over the guarded Rust vault engine, with clear navigation, native sign-in, local/server vaults, editor/reading previews, real-note graph, history drafts, selected-Space sync and appearance/editor settings. Cloud defaults to https://helious.work, which is not live yet. Browser/native feature differences are documented; Phase 9 remains unfinished.

Added signed GitHub updating, Windows signature/hash/version checks, macOS Sparkle archives, update preferences and version-tag release automation. Update signing is configured; trusted Authenticode/Developer ID/notarization are not. Old 0.8.0 apps need one manual upgrade.
