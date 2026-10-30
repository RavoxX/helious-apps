# Application roadmap

The original phases implemented accounts/recovery, Markdown/link handling, the browser editor, graph/analytics, Spaces/history, encrypted secrets/MFA and scoped MCP/OAuth. Desktop local folders, watching and selected-Space sync followed.

The native **v0.8.1 prerelease** is available for Windows Rust/egui and macOS SwiftUI, with account/settings navigation and signed GitHub updating. Existing 0.8.0 installations need one manual upgrade. Advanced browser features continue to be ported; see the desktop guide for differences and signing limits.

Registration supports an adult self-declaration and versioned terms. Account settings include profile correction, private portable export and queued permanent deletion; see [your account and data](./account-data). Instance policies, provider contracts, backup/log retention and deployment remain operator responsibilities.

The first Phase 9 browser milestone adds daily notes, Markdown templates, typed YAML properties and a conflict-safe JSON Canvas editor. See [authoring](./authoring) and [canvas](./canvas). Native authoring controls, richer embeds/media, Mermaid, KaTeX, remaining reading features and a sandboxed plugin API are still pending; Phase 9 is not fully complete.

Public managed Cloud deployment, trusted platform signing/notarization and final hardening are separate operational work. This repository does not ship the marketing homepage.
