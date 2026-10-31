# Changelog

## 0.9.2 — Refresh macOS automatic update discovery

While automatic update checks are enabled, macOS refreshes GitHub release discovery every fifteen minutes instead of keeping the release feed chosen at startup indefinitely. Sparkle still controls its check/download schedule and verifies the signed archive; disabling automatic checks stops periodic discovery. Manual checks always rediscover releases, and startup/manual checks work independently of the periodic refresh. GitHub prereleases remain supported. No updater key, credential format or stored vault data changes.

## 0.9.1 — Native sync and dependency hardening

Native sync validates every remote path before downloading or changing files. Hidden components and generated directories (including case variants) use the same exclusion policy as local scanning, direct writes and recovery replay. A paired server cannot create an excluded configuration file before returning a sync error. Existing files, local history and conflict copies retain their stale-write guards. Back up first; preserved journals/configurations containing excluded paths are refused rather than silently rewritten.

Updated the native formula renderer for RUSTSEC-2026-0311 and added nested-input coverage. Updated JavaScript static serving, glob/minimatch, KaTeX and email rendering dependencies. Added production advisory CI, weekly RustSec checks, server/docs attribution, exact upstream notice fallbacks, build-context exclusions and an isolated self-hosting container smoke check. Added operations/restore/incident and dependency-scope guides. Cloud deployment and platform signing/notarization remain separate launch work.

## 0.8.1 — Native desktop rebuild and public app distribution

Application/self-hosting source and releases now live in RavoxX/helious-apps. Marketing code, illustrations and film remain private. AGENTS.md describes repository ownership, checks, Cloud availability and signing boundaries.

Added Rust/egui/eframe/wgpu Windows UI and SwiftUI/AppKit macOS UI over the guarded Rust vault engine, with clear navigation, native sign-in, local/server vaults, editor/reading previews, real-note graph, history drafts, selected-Space sync and appearance/editor settings. Cloud defaults to https://helious.work, which is not live yet. Browser/native feature differences are documented; Phase 9 remains unfinished.

Added signed GitHub updating, Windows signature/hash/version checks, macOS Sparkle archives, update preferences and version-tag release automation. Update signing is configured; trusted Authenticode/Developer ID/notarization are not. Old 0.8.0 apps need one manual upgrade.
