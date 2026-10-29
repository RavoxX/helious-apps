# Native Helious desktop

- engine/: Rust vault/history/watch, server sessions, sync and Windows update verification.
- windows/: egui/eframe UI rendered by wgpu, with winit supplied by eframe.
- macos/: SwiftUI/AppKit UI and Sparkle; a C bridge calls the shared Rust engine.
- assets/: application branding only.
- installers/ and scripts/: native packaging, signed metadata and release automation.

Cloud defaults to https://helious.work (not deployed yet). Custom server origins and offline local folders are supported. Read [desktop documentation](../docs/desktop.md) and [agent instructions](../../AGENTS.md). Signing private keys never belong in source.
