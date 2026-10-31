# Application roadmap

The original phases implemented accounts/recovery, Markdown/link handling, the browser editor, graph/analytics, Spaces/history, encrypted secrets/MFA and scoped MCP/OAuth. Desktop local folders, watching and selected-Space sync followed.

The native **v0.9.1 prerelease** is available for Windows Rust/egui and macOS SwiftUI, with account/settings navigation and signed GitHub updating. Existing 0.8.0 installations need one manual upgrade. Advanced browser features continue to be ported; see the desktop guide for differences and signing limits.

Registration supports an adult self-declaration and versioned terms. Account settings include profile correction, private portable export and queued permanent deletion; see [your account and data](./account-data). Instance policies, provider contracts, backup/log retention and deployment remain operator responsibilities.

Phase 9 browser milestones add daily notes, Markdown templates, typed YAML properties and a conflict-safe JSON Canvas editor, followed by callouts, highlighted code, KaTeX, on-demand Mermaid, same-Space note embeds and bounded image/audio/PDF previews. See [authoring](./authoring), [canvas](./canvas) and [reading/media](./reading). Phase 9 also adds native authoring/Canvas/reading, a documented capability-limited declarative extension API and scoped browser reading CSS. See [extensions and appearance](./extensions). These complete the Phase 9 authoring scope; platform rendering differences are documented rather than hidden. Independent native note tabs, coordinated rename and some advanced graph/admin controls still use the browser.

Public managed Cloud deployment, trusted platform signing/notarization and final hardening are separate operational work. This repository does not ship the marketing homepage.

Phase 10 has delivered a static source hardening pass, the native 0.9.1 path/renderer patch, runtime dependency updates, advisory CI, broader distribution notices and isolated self-host startup/restart checks. See [operations](./operations) and [dependency review](./dependencies) for exact scope and remaining launch/maintenance work.
