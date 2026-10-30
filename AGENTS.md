# Helious Apps — agent guide

The native v0.8.1 prerelease is published with signed update feeds. Registration now supports an 18+ self-declaration (no identity/DOB verification) and versioned terms. Account settings include correction, portable export and queued deletion. Concrete operator/address/support details, legal review drafts and the separate-container/domain admin/support panel belong only in the private repository. Never copy its LEGAL-LAUNCH.md or PROJECT-STATUS.md into this public checkout. Do not claim the queued operator/admin work or Cloud deployment is complete. The owner selected Apache 2.0 for this public source; preserve LICENSE, NOTICE and third-party attributions.

## Repository boundaries

This is `https://github.com/RavoxX/helious-apps.git`, the public source and release repository for Helious applications and self-hosting. Keep native apps, API/server, web workspace, shared packages, deployment configuration and user/contributor documentation here.

The marketing website lives separately at `https://github.com/RavoxX/helious.git` (private). Do not import its homepage, landing components, product film, generated marketing illustrations, design briefs or marketing asset pipeline. Necessary application logos/icons may be included. All new application installers and update feeds belong in **this** repository's GitHub Releases.

Before editing, check this checkout's remote, branch and working-tree status. Never copy `.env`, `.local`, database backups, signing private keys, account cookies or credentials into source, artifacts or logs. Review tracked paths before public pushes. Do not force-push or replace published tags/installers for routine fixes; release a new version.

## Architecture and current priorities

- `apps/desktop/engine`: shared Rust vault/history/watch/session/sync engine and narrow Swift C bridge. Keep UI code out of it.
- `apps/desktop/windows`: Rust egui/eframe interface; winit/wgpu are supplied through eframe. No webview or Windows File/Edit application menu strip. Use labelled Workspace, Graph, Sync, Account and Settings destinations.
- `apps/desktop/macos`: SwiftUI/AppKit interface with native navigation, folder picker, toolbar, editor and Settings scene. Reuse the Rust engine through the documented C ABI without embedding browser UI.
- `apps/server`: existing Fastify/MongoDB authentication, knowledge, permissions, secrets and MCP API. Integrate changes rather than replacing auth.
- `apps/web`: the browser workspace for self-hosted/server accounts, separate from the native UI.
- `packages/core` and `packages/mcp`: shared TypeScript knowledge engine and official-SDK MCP implementation.
- `apps/docs`: application and self-hosting guides. `/` redirects to `/app/`; there is no marketing homepage in this distribution.

Account/data safeguards and the private operator/admin implementation have reached their tested checkpoint; actual Cloud/legal launch work remains separate. Phase 9 now has a first browser authoring milestone: templates, daily notes, typed YAML properties and conflict-safe `.canvas` editing. The native v0.8.1 UI does not yet expose these controls. Richer reading/media, native parity and the plugin boundary remain unfinished. The preserved private `codex/phase9-authoring-wip` branch must not be discarded or merged into this public history.

Managed Cloud defaults to **https://helious.work**. The owner explicitly said it is not live yet. Keep local folders usable offline, show actionable connection failures, and offer a custom self-hosted server origin. Never invent a successful deployment or sign-in.

## UX and compatibility

Keep Helious branding, labelled standard controls, keyboard access, light mode and near-black dark surfaces. Sign-in, account state and settings must be visible. Graphs use real notes and links. Avoid decorative gradients or fake feature/data claims.

Existing `.md` folders and `.helious/` metadata/history must remain compatible. Personal content requires explicit sync/agent selection. Preserve content-hash/revision guards and conflict copies; never silently overwrite competing edits. Secrets never become notes, graph/search data or sync files. Sessions belong in Windows Credential Manager/macOS Keychain, not plaintext settings. Native HTTP uses existing auth, CSRF, account verification and MFA.

## Development and verification

- Server/web: Node **22**, pnpm **10.28.2**, strict TypeScript. Use the lockfile; `npx --yes pnpm@10.28.2` is the fallback when global pnpm differs.
- Run relevant checks: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.
- Rust: stable, minimum 1.95. Workspace `apps/desktop/Cargo.toml`; `cargo +stable check/test --manifest-path apps/desktop/Cargo.toml`, `cargo +stable clippy --manifest-path apps/desktop/Cargo.toml --all-targets -- -D warnings`, `cargo +stable fmt --all --manifest-path apps/desktop/Cargo.toml --check`.
- Swift/macOS compilation and universal packaging require macOS. Use the desktop GitHub workflow; do not claim a native UI was run when only compilation or a browser fixture was checked.
- Update docs with behavior and limitations. Use synthetic accounts and temporary folders in tests. Run meaningful permission, filesystem, sync and updater verification tests for related changes.

## Releases and updater security

Use this repository's version-tag release workflow. Keep native package versions, macOS bundle version and release tags consistent. Publish immutable Windows installers and universal macOS builds, checksums and the updater's signed metadata/archive. Only public verification keys may be committed. Signing keys belong in GitHub Actions secrets and a protected, ignored backup; never print them.

Update discovery/downloads must use this repository's public release feed, validate versions and signatures, refuse downgrade/corrupt artifacts, and preserve unsaved drafts before installation/restart. Offer automatic checks and installation preferences. Do not embed repository credentials in distributed binaries. OS code signing/notarization and updater signatures are separate: document the actual configuration honestly. Old 0.8.0 builds need a manual upgrade before they can self-update.

Read `SECURITY.md` and the desktop/deployment guides before changing these boundaries. No public managed Cloud deployment is implied by a release or self-hosting image build.
