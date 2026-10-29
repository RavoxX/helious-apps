# Helious Apps

Public application and self-hosting source for Helious. The marketing website and its assets are maintained separately and are not included here.

- Windows: native Rust / egui / eframe interface with wgpu rendering.
- macOS: native SwiftUI / AppKit interface with a shared Rust vault engine.
- Server: Fastify, MongoDB, cookie authentication, scoped MCP and a browser workspace.
- Cloud sign-in defaults to https://helious.work; that hosted service is not live yet. Local folders work offline, and self-hosting works independently.

Read [AGENTS.md](AGENTS.md), [desktop setup](apps/docs/desktop.md), [Docker installation](apps/docs/deployment.md) and [security guidance](SECURITY.md). Native desktop rebuilding and automatic updating are in progress. No marketing homepage is shipped: the server redirects / to /app/.
