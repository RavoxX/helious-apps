# Native desktop apps

Version 0.9.1 hardens the native sync path boundary and updates formula rendering. Incoming manifests containing hidden/generated components are refused before any download/write, including case variants of `node_modules` and `target`. Local scanning and non-internal writes use the same policy. Existing excluded files are left untouched. Back up the complete folder first; an old configuration or recovery journal containing excluded paths is preserved and refused rather than silently modified. Disconnect sync and review such metadata on a copy before attempting recovery.

Windows uses Rust/egui/eframe with wgpu rendering. macOS uses SwiftUI/AppKit with native navigation, folder picker, toolbar, text editor and Settings scene. A shared Rust engine handles guarded vault files, history, watching, OS-stored sessions and selected-Space sync. Neither interface embeds the website.

## Downloads and upgrading

Download from [Helious Apps releases](https://github.com/RavoxX/helious-apps/releases): Windows x64 EXE/MSI, universal macOS DMG (macOS 14+), and a ZIP used by the macOS updater. Verify files with SHA256SUMS.txt.

Old 0.8.0 webview builds need one manual upgrade before self-updating is available. Existing .md folders and .helious history/configuration remain compatible; back up both before upgrading. Native settings retain the com.helious.desktop app-data location and OS credential namespace.

Update signing is configured separately from platform signing. Windows Authenticode and macOS Developer ID/notarization are not configured. Windows may warn and macOS may block an unnotarized app; macOS bundles are ad-hoc signed.

## Navigation

- **Workspace:** local/server vaults, note search/creation, Markdown source, reading/split preview, explicit save and history drafts.
- **Canvas:** portable text/file/link/group boards, connections, history of draft edits, export and guarded saves.
- **Graph:** actual notes/links, bounded spatial-grid layout, pan/zoom, search and hover neighbor highlighting. The browser retains more extensive graph/analytics controls.
- **Sync:** selected-Space pairing and preserved conflict review.
- **Account:** visible Cloud/self-hosted sign-in, vault selection/creation and sign-out. Password/MFA, sessions, secrets and agent-token administration open the browser account panel.
- **Settings:** appearance, editor size/wrapping, extension permission/install controls, storage and updates. macOS also has its standard Settings window and Cmd+,.

Windows has no File/Edit application menu strip. Ctrl+O opens a folder; Ctrl+S saves; Ctrl+, opens Settings. macOS uses its normal system menu bar and native toolbar/editor behavior.

Native 0.9 adds daily notes/templates, typed properties, JSON Canvas boards, native rich reading/media and permission-reviewed declarative extensions. See [authoring](./authoring), [Canvas](./canvas), [reading](./reading) and [extensions](./extensions) for exact platform limits. Native/browser controls differ: coordinated rename, bookmarks, independent note tabs/panes, detailed analytics and advanced server administration remain in the browser. Native renderers support documented bounded syntax rather than every browser rendering dialect.

## Cloud and self-hosted sign-in

Helious Cloud defaults to **https://helious.work**, which the owner has not launched yet. Connection failure is a real offline error; no fake account/demo backend is substituted. Local folders work offline.

Choose Self-hosted server for your exact HTTPS origin without a path. HTTP is allowed only on loopback for development. Sign in with the server's verified email/password and an authenticator/recovery code if enabled. Registration/recovery use the normal server website. Passwords are not saved. Sessions stay in Windows Credential Manager or macOS Keychain, with no plaintext fallback. Existing server auth, Origin/CSRF, rotation and permissions still apply.

## Local data and sync

Open/create a normal folder. Imports start in Personal. Local Spaces organize files; they do not prevent other OS programs from reading a folder. Keep credentials in the separate server Secrets feature or OS tooling, never Markdown.

The .helious directory stores metadata, plain revision snapshots, journals and sync checkpoints. History is not automatically pruned. Hidden files, .git, .env, node_modules, target, symbolic links and Windows junctions are skipped. Saves reject unsafe paths, stale hashes and case collisions. Clean notes refresh after external changes; dirty notes keep their draft. Journal recovery preserves competing content as conflict copies.

Limits: 50,000 indexed files, 64 MiB indexed Markdown, 1 MiB Markdown saves and 20 MiB attachments; 100 changes / 32 MiB per coordinated write. Rapid external edits between watcher refreshes cannot all be recovered. Backups remain necessary.

Open a local vault, sign in, then map each intended local Space to a different server Space. Nothing is selected automatically; Personal on either side requires explicit confirmation. Pairing binds origin/account/vault/Spaces. Native sync currently runs on request while the app is open. Secrets, credentials, hidden/internal data and generated conflict copies are excluded. Private-path collisions block sync. Deletions propagate only from an established checkpoint. Per-file checkpoints make interrupted transfers resumable; the entire transfer is not atomic.

Competing edits preserve a file such as Note.conflict-20261029T120000Z-server-0123abcd.md. Review it before Use local version / Use server version. Stale resolutions are refused. Conflict copies stay excluded from sync until deliberately renamed. Server note writes retain attribution/history; attachment replacement retains device history and latest server bytes.

## Automatic updates

Windows checks this public repository's releases at startup and daily while running. Settings offers automatic checks, optional automatic installation, manual download and Update and restart. Ed25519-signed versioned metadata authenticates the exact repository URL, size and SHA-256. Corrupt downloads and downgrades are refused; unsaved drafts block restart.

macOS uses Sparkle 2 with a signed archive and verification before extraction. Update controls are in Settings and Check for updates in the app menu. Draft guards prevent unattended relaunch while editing. The 0.x channel accepts preview releases; Windows stable 1.x builds ignore prereleases. Public downloads need no embedded GitHub credentials.

## Building and releases

Use stable Rust 1.95+, Windows MSVC tools, NSIS 3 and WiX 3.14; macOS needs Xcode tools and both Apple Rust targets. Node 22 runs packaging scripts. eframe supplies winit/wgpu. craft-ui currently targets a different egui version and is not added as a conflicting dependency.

Run cargo test --locked --manifest-path apps/desktop/Cargo.toml -p helious-native. Windows development uses cargo run --manifest-path apps/desktop/Cargo.toml -p helious-windows. Package with pwsh apps/desktop/scripts/build-windows.ps1 or bash apps/desktop/scripts/build-macos.sh. The Node/Docker build checks source layout without compiling native apps.

The [desktop workflow](https://github.com/RavoxX/helious-apps/actions/workflows/desktop.yml) builds both platforms. Matching v* tags publish installers, ZIP, checksums, signed Windows metadata and Sparkle appcast. Keep desktop package.json and both Rust package versions consistent, update lockfiles/changelog, then tag after CI passes. Publication uses this repository's GITHUB_TOKEN.

Native Windows UI tests exercise navigation, accessible form labels, persisted settings, note creation/save/history/deletion confirmations and unsaved-draft protection. Shared-engine tests cover filesystem recovery, origin validation and signed-update rejection, including a Node-generated signer fixture. The OS credential and native selected-Space sync integration tests are run explicitly with `cargo test --manifest-path apps/desktop/Cargo.toml -p helious-native -- --ignored`; they use synthetic loopback sessions and require an unlocked OS credential store. The sync test checks Personal isolation, conflicting edits, stale decisions and fresh resolution. macOS CI compiles both architectures and packages the universal app; this is not a substitute for interactive macOS usability testing.

Installers bundle `THIRD-PARTY-NOTICES.txt` (on macOS, inside `Helious.app/Contents/Resources`). The packaging script collects license texts for the resolved native dependencies, font licenses and Sparkle. Missing license texts fail packaging. Helious Apps source uses Apache 2.0; preserve its LICENSE/NOTICE and third-party attributions when redistributing.

HELIOUS_UPDATE_PRIVATE_KEY is a PKCS#8 Ed25519 PEM in Actions secrets. Only apps/desktop/update-public-key.txt is committed. Keep a protected offline backup: losing the key prevents already installed apps from trusting future updates. Do not log or distribute it. Platform signing credentials are separate.
