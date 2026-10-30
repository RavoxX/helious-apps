# Architecture

## Boundaries

One Node.js 22/Fastify container serves the React panel, VitePress docs and REST API from one origin. MongoDB 7 holds durable state; MCP HTTP shares the origin with a separate stdio bridge. The root redirects to /app/. Windows uses native Rust/egui and macOS native SwiftUI, with a shared Rust vault/session/sync engine.

| Folder          | Responsibility                                                      |
| --------------- | ------------------------------------------------------------------- |
| `apps/server`   | Validation, authorization, persistence, static serving              |
| `apps/web`      | React, TanStack Router/Query, Zustand, Tailwind tokens              |
| `apps/docs`     | VitePress contributor and user documentation                        |
| `apps/desktop`  | Native Rust/egui Windows and SwiftUI macOS apps, shared Rust engine |
| `packages/core` | Portable Markdown parser, paths, link/graph engine, search syntax   |
| `packages/mcp`  | Official MCP SDK, schemas, tools and stdio bridge                   |

## Data model

Accounts, vaults, notes, spaces, versions, GridFS and encrypted secrets are implemented through Phase 8, including agent tokens and OAuth.

The first Phase 9 browser authoring milestone reuses these stores: templates and daily notes are normal versioned Markdown, typed properties edit bounded YAML while preserving untouched nodes/body, and `.canvas` files use GridFS attachments through the existing session-only sync-file CAS routes. No new auth, storage collection or secret resolution is introduced. Canvas manager, surface, inspector forms and shared format validation are separate modules. See [authoring](./authoring) and [Canvas](./canvas) for limits and native differences.

| Collection                   | Shape and indexes                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                      | `_id`, normalized unique `email`, `name`, Argon2id `passwordHash`, `role`, `createdAt`                                                                                                            |
| `sessions`                   | `_id`, `userId`, unique `tokenHash`, `createdAt`, `rotatedAt`, `expiresAt`, bounded `userAgent`; TTL on expiry, index on user                                                                     |
| `settings`                   | Singleton `bootstrap` with immutable initial `adminId`; singleton `registration` with `registrationOpen`                                                                                          |
| `loginAttempts`              | Hashed email `_id`, atomic `failures`, `lockedUntil`, TTL `expiresAt`                                                                                                                             |
| `vaults`                     | Owner, name, active/deleting state, timestamps, transactional writeRevision and spaceSchema migration marker. Server vaults only.                                                                 |
| `spaces`                     | Owner/vault, unique normalized key, name, kind (personal/code/custom), agentAccess cap, optimistic revision, timestamps. Built-in Personal defaults to none.                                      |
| `notes`                      | Owner/vault/space, deleted flag, path/key, Markdown, parsed metadata/search text, revision and timestamps. Unique active-note vault/path index; owner/vault/space/deletion and full-text indexes. |
| `note_versions`              | Owner/vault/note/space, monotonic revision, full Markdown snapshot, path, action, actor kind/id, recordedAt. Unique note/revision; scoped history index. Insert-only except vault erasure.        |
| `secrets`                    | Separate collection: vault/space, name, ciphertext, nonce/tag, wrapped random data key, key version, per-secret policy; never indexed as note content                                             |
| `agent_tokens`               | Owner, label, hash only, allowed vaults/spaces/scopes/secret IDs, expiry, revocation, last use                                                                                                    |
| `secret_audit`               | Append-only actor/token, operation, target ID, IP, timestamp and outcome; never secret values                                                                                                     |
| `secret_approvals`           | Requested secret/token/user, status, expiry, approving user and decision timestamp                                                                                                                |
| `attachmentFiles` and GridFS | Owner/vault/space, path/key, MIME metadata, size, uploading/ready/deleting state. Bytes in attachments.files/chunks. Space policy checked before access and before publishing an upload.          |

Email authentication extends `users` with `emailVerified`, `verifiedAt`, `authVersion` and optional `pendingEmail`. Sessions capture `authVersion`, so password recovery invalidates every session even if a concurrent session insert races with deletion. The legacy-user migration only verifies accounts missing the verification field.

Phase 6 adds `totpEnabled` and transactional `securityRevision` to users, and `mfaVerifiedAt` to sessions. `security_credentials` holds encrypted TOTP seeds, last accepted time step, credential revision and hash-only recovery codes. `totp_enrollments` binds encrypted pending seeds to user/session/authVersion with a ten-minute TTL. `security_attempts` stores account reauthentication failures and lockout expiry. `secret_audit_heads` tracks each owner's sequence/hash. Secret values use separate random AES-256-GCM data keys, wrapped by a key-ID-based master key ring; no data is encrypted with the CSRF signing derivation.

| Collection            | Purpose                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email_tokens`        | One replaceable slot per user/type: SHA-256 token hash, `expiresAt`, `usedAt`, `createdAt`, optional pending email. TTL cleanup plus explicit 30-minute expiry checks. |
| `email_rates`         | Atomic rolling allowance shared by all mail flows, maximum three sends per address in 15 minutes.                                                                      |
| `email_notifications` | Durable password/email-change notices awaiting an allowance or delivery retry. Contains rendered notification content, never a password or reset credential.           |

MongoDB indexes are initialized idempotently on startup. The bootstrap claim uses an atomic singleton upsert so concurrent signups select one initial administrator. Sessions contain hashes, never the browser credential. Public responses explicitly select safe user fields.

## Knowledge engine

`packages/core` is environment-independent TypeScript built before its consumers. Unified/remark parses CommonMark/GFM and frontmatter. The parser extracts local links without interpreting code or raw HTML as graph edges. YAML aliases, property nesting and note metadata are bounded. Paths use NFC and a lowercase uniqueness key for predictable desktop portability.

Every knowledge endpoint authenticates and verifies vault ownership before querying. Note creates, saves, moves and deletes use `withVaultWrite`: a MongoDB snapshot transaction first updates the active, owner-scoped vault document, then performs its note writes and majority commit. This serializes competing writers within a vault, including new notes that could change link resolution. A stale expected revision returns 409 without replacing stored content. Revision counters provide conflict detection, not historical recovery. Graph and backlink construction receive only scoped metadata, never a global note set. Graph processing now has explicit limits of 50,000 nodes, 200,000 local reference occurrences and 64 MiB of projected metadata; exceeded limits return 422.

The move planner records destination spans in parsed Markdown. It resolves links before and after a move, then changes only the spans needed to retain destinations. Wiki links can become root-qualified; Markdown links remain relative to their source. Repeated reference definitions are edited once. Aliases, fragments, titles and fenced code are preserved. The path, rewritten references, parsed metadata, search text and revisions commit together. Move planning is bounded to 10,000 notes and 16 MiB of Markdown per vault.

GridFS uploads stream with a 20 MiB limit. Metadata is reserved before upload and published only when ready. Failed uploads remove partial chunks. Vault deletion first marks the vault deleting, then removes its attachments and notes; note transactions conflict with that state change, while late uploads check state before publication. Interrupted deletion can be retried by ID.

**Decision: MongoDB replica sets are required for note writes starting in Phase 3.** Coordinated rename must not leave half-updated references after a failure. The default Compose deployment and temporary preview use a single-node replica set; external deployments can use a supported replica set or sharded cluster. A standalone server returns a clear 503 for note writes. This adds database setup complexity but gives note moves an atomic boundary. The driver manages transaction retries; operations within a transaction execute sequentially. See [MongoDB transaction documentation](https://www.mongodb.com/docs/drivers/node/v6.x/crud/transactions/) and the [upgrade instructions](./deployment#upgrade).

## Workspace state

CodeMirror editors and drafts are mounted per tab. Two independent notes can remain visible in a split; selection determines the target of commands and saves. Query invalidation refreshes clean editors after coordinated moves. Dirty editors preserve their source and retain their old revision, so a stale save cannot overwrite rewritten links.

Browser storage contains account-scoped bookmarks/hotkeys and account/vault-scoped tab IDs, pane assignments, pins and graph display/force/color preferences. Draft content is held in memory and guarded with a page-leave warning. It is not crash recovery or synchronization. The explorer paginates note metadata up to 10,000 entries; graph navigation can open a note outside that index by its authorized ID. Content is fetched per opened tab. Search remains server-side and bounded to 100 matches.

## Graph and analytics

The graph and analytics bundles are lazy-loaded inside Vaults. Sigma 3/Graphology render a directed graph with WebGL; a separate module worker runs D3 forces and transfers typed position arrays at a bounded cadence. Bulk Graphology updates avoid one event per node. Layout pauses in hidden tabs and settles after a bounded run. Reduced-motion mode applies a static worker result and disables camera transition durations. Native Sigma touch capture supports pan/pinch; node dragging pins the worker's node during movement.

The core graph filter applies literal title/path/tag queries, existing-file/attachment/orphan filters and bidirectional breadth-first local traversal (depth 1–5). Hidden nodes are removed before local traversal. Creation replay hides nodes/edges without restarting layout. Group colors, forces and display settings are scoped by account and vault in browser storage. The searchable list navigator provides keyboard access and a WebGL-unavailable fallback.

The server's full graph response extends the original note-only API with ready GridFS files and opaque unresolved nodes; it never includes note bodies. Snapshot data is loaded from owner-scoped metadata. Analytics reuses this graph for counts/rankings and aggregates `note_changes` for daily activity. That collection stores `{ownerId, vaultId, spaceId, noteId, action, at}`, indexed by owner/vault/time. Records commit with note mutations and are removed on vault deletion. This is user activity reporting, not the Phase 6 append-only secrets audit log. Activity begins in Phase 4; growth uses surviving notes' creation dates rather than invented historical snapshots.

Library references: [Sigma 3 source](https://github.com/jacomyal/sigma.js/tree/v3.0.3) and [D3 force simulation](https://d3js.org/d3-force/simulation). Space filtering and policy checks are implemented. MCP bearer authentication, OAuth consent and scoped activity are implemented.

## Security layers to preserve

Query services must accept an authorized vault/space scope. Preserve the same boundary when adding title suggestions, semantic retrieval and MCP. Personal is default-deny for agents; the current route and policy tests cover the implemented knowledge/history endpoints. Extend them before exposing new transports.

Never hydrate secrets into note rendering, export, search, graph, or Markdown sync. Phase 6 uses random per-secret data keys, AES-256-GCM encryption and master-key wrapping with immutable context. Authenticator seeds use separate contexts. See [Secrets](./secrets) for the key ring and audit limits.

## Build decisions

The browser reading pipeline uses Markdown AST transforms for callouts, scoped headings/footnotes and bounded embeds; lowlight produces escaped React code tokens, and KaTeX runs without trusted commands. Note embeds reuse the existing scoped API and core resolver, restricted to the containing note's Space. Attachment signatures select passive image/audio or local PDF.js canvas viewers. Mermaid is lazy, on-demand, serialized, strict and sanitized before conversion to a Blob image. CSP permits Blob images/media and a same-origin worker while retaining object/frame restrictions. See [reading](./reading) for resource limits and unsupported features. The web build generates third-party license/source notices before Vite; keep its helper in Docker build contexts and Turbo inputs.

Native desktop apps and MCP transports are implemented. This public distribution excludes the separate marketing website and operator/admin service. Platform signing/notarization and a managed Cloud deployment remain separate operational work.

## Space authorization and version storage

`vault-access.ts` centralizes principal resolution, owner/vault visibility, allowed space IDs and operation checks. The production resolver derives a user principal from verified cookie authentication. Core permission logic requires explicit vault/space/read/write grants for a trusted agent principal and intersects them with the current space cap; a test-only route adapter supplies such principals without creating a production token bypass. Administrative routes remain owner-only.

Collection reads apply space filters on the server. Graph construction resolves against owner-scoped metadata before removing hidden nodes and edges, recomputes degrees, and suppresses hidden tombstones that would otherwise become labelled missing nodes. Outgoing metadata and backlinks use the same permitted graph boundary. Local BFS remains client-side after authorization. Plain note contents are not a secret-redaction system.

Policy updates, note/space changes, soft deletion, restores, revision snapshots and activity writes share the vault transaction guard. Agent moves cannot rewrite an inaccessible note. History requires permission in both the head note and snapshot spaces; restores require write permissions in both and use the expected current revision. Restores copy content literally into the current path and return it to the saved space. New active notes can reuse tombstoned paths; recovery collisions fail atomically.

`migrateSpaces` runs once per legacy active vault, assigning unclassified content/activity to Personal and recording a baseline. Schema marker 5 avoids rescanning all current notes on every startup. Older writers must be stopped for the migration. Full database rollback requires a pre-upgrade backup. Snapshots are retained until vault deletion; there is no history pruning job yet. The UI uses [jsdiff](https://github.com/kpdecker/jsdiff) behind size/edit/time limits and a complete source fallback.

## Phase 7 connections and activity

`agent_tokens` stores only credential hashes, explicit vault/Space/action grants, account auth version, expiry and revocation. OAuth access records retain connection metadata until 30 days after family expiry (`cleanupAt` TTL); authentication still checks access expiry in code. `agent_activity` records IDs/action/token label/time with a 90-day TTL, without note bodies or credentials. IP-bearing secret audits have a separate lifetime. `oauth_clients`, `oauth_requests`, `oauth_codes` and `oauth_refresh` hold public registrations, hashed pending requests/codes and rotating hashed refresh families, with explicit expiry and TTL cleanup. Replay revocation and token writes serialize against the account's security revision.

The private MCP backend reuses the knowledge REST implementation through in-process injection; it never listens on another port. It rechecks the current bearer principal inside write transactions. Each HTTP request gets a fresh stateless official SDK transport. The stdio bridge forwards to that endpoint. Tools, resources and project-context prompts share the same Space policy intersection.

## Desktop transport and local storage

Windows uses an eframe/egui UI rendered by wgpu; macOS uses SwiftUI/AppKit with a narrow in-process C bridge to the shared Rust engine. Neither client loads remote documents in a privileged webview. The Windows worker thread and Swift bridge actor serialize filesystem, network and sync operations away from the UI. The browser retains its same-origin Fetch transport; native clients use the restricted Rust HTTP transport and OS credential store.

Local vault metadata lives in `.helious/vault.json`; revision snapshots live under `.helious/history/<fileId>/<revision>.json`. Plain note and attachment files remain at their normal paths. Native writes use expected content hashes, staged replacements, a vault lock and a persisted multi-file recovery journal. Native watchers invalidate the frontend's parsed index; unsaved editor drafts remain in memory. Current local Space assignments are metadata, not an OS sandbox. Local activity counts imported and subsequently indexed changes from the first open onward.

The shared sync planner compares local/server state against a per-path checkpoint, including content hashes and Space mappings. The native HTTP adapter keeps session cookies in the OS keyring. Pairings and checkpoints contain origin/account/vault IDs and file metadata, never cookies or passwords. Conflicts retain a separate local copy and require an explicit decision; compare-and-swap checks refuse stale decisions. See [desktop and sync](./desktop) for quotas, filesystem race limits and recovery behavior.
