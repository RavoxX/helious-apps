# Accounts and REST API

The live source of truth is the generated <a href="/api/openapi.json">OpenAPI document</a>. All routes use the same origin; there is no wildcard CORS configuration. New accounts require email verification. See [email setup and recovery](./email).

| Method | Path                      | Purpose                                                    |
| ------ | ------------------------- | ---------------------------------------------------------- |
| GET    | `/api/health`             | Database-aware readiness                                   |
| GET    | `/api/auth/config`        | Registration availability                                  |
| GET    | `/api/auth/csrf`          | Signed cookie plus JSON CSRF token                         |
| POST   | `/api/auth/register`      | Name, email, password; create unverified account and email |
| POST   | `/api/auth/login`         | Email/password; create session                             |
| GET    | `/api/auth/me`            | Current safe user fields; rotate session after 15 minutes  |
| POST   | `/api/auth/logout`        | Delete current session and clear cookie                    |
| GET    | `/api/auth/sessions`      | Your active session metadata                               |
| DELETE | `/api/auth/sessions/:id`  | Revoke a session owned by you                              |
| PUT    | `/api/admin/registration` | Admin-only `{ "open": false }` toggle                      |

Registration sends email and creates no session. Additional endpoints:

| Method | Path                            | Input and purpose                                                 |
| ------ | ------------------------------- | ----------------------------------------------------------------- |
| POST   | `/api/auth/resend-verification` | `{email}`; new 30-minute verification link                        |
| POST   | `/api/auth/verify-email`        | `{token}`; verify email or confirm an address change              |
| POST   | `/api/auth/forgot-password`     | `{email}`; neutral response regardless of account existence       |
| POST   | `/api/auth/token-status`        | `{token}`; validate reset link without consuming it               |
| POST   | `/api/auth/reset-password`      | `{token,password}`; reset and revoke all sessions                 |
| POST   | `/api/account/email`            | Session and `{email,password}`; request a verified address change |

## Account policy, export and deletion

`GET /api/auth/config` also returns `minimumAge`, `terms` (`{version,url}` or null) and `privacyUrl`. When an adult declaration is configured, registration requires `ageConfirmed:true`. Versioned terms also require `termsAccepted:true` and the exact current `termsVersion`. These declarations do not verify age or identity. Email verification is still mandatory.

| Method | Path                         | Contract                                                                                                    |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| PATCH  | `/api/account/profile`       | `{name}` corrects the current account's display name                                                        |
| POST   | `/api/account/export`        | `{password,code?}` authorizes a single-use, five-minute session-bound ZIP link                              |
| GET    | `/api/account/export/:token` | Downloads that private ZIP once; credentials and secret values are excluded                                 |
| POST   | `/api/account/delete`        | `{password,code?,confirmation}` with `confirmation:"DELETE <exact-email>"`; revoke access and queue erasure |

Export/deletion require password plus an unused factor when MFA is enabled. Deletion returns 202 after freezing access; a worker handles retryable erasure. The last active administrator is protected. See [account/data operations](./account-data) for archive limits, external copies, backup handling and the distinction from a full data-access request.

## Browser request sequence

Fetch `/api/auth/csrf` with cookies enabled and read `csrfToken`. On each mutation include `X-CSRF-Token`, `Content-Type: application/json`, the exact configured `Origin`, and the signed cookie. Send `{}` for mutations without other fields. The browser supplies Origin automatically. For attachment uploads, send `FormData` and let the browser set multipart Content-Type; keep the CSRF header. Treat a 403 as a reason to refresh the CSRF token and try the action again.

```js
const { csrfToken } = await fetch('/api/auth/csrf').then((r) => r.json());
const result = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
  body: JSON.stringify({ email: 'you@example.com', password: 'your private passphrase' }),
});
```

Passwords must be 12–128 characters. Emails are lowercased. Name length is 1–80 trimmed characters. Responses never include password hashes or session credentials. Session cookies are HttpOnly; the UI stores no credential in localStorage.

## Account panel

Use **Sessions** to inspect and revoke other browsers. **Sign out** revokes the current browser. Administrators can close registration in **Account & server**. Password changes, TOTP and token management arrive in later milestones.

## Knowledge endpoints

All paths below require your session. `:v` is a vault ObjectId, `:n` a note ObjectId and `:a` an attachment ObjectId. Only the vault owner has access; foreign or missing objects return 404. Invalid input returns 400, duplicate paths and stale revisions return 409, metadata/graph limits return 422 and oversized uploads return 413.

| Method               | Path                                                   | Input / result                                                                        |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| GET / POST           | `/api/vaults`                                          | List your vaults / create with `{ "name": "Projects" }`                               |
| GET / PATCH / DELETE | `/api/vaults/:v`                                       | Read / rename with `name` / permanently delete content                                |
| GET                  | `/api/vaults/:v/notes`                                 | Metadata list: `limit` 1–100, `offset`, optional folder `path`; includes `total`      |
| POST                 | `/api/vaults/:v/notes`                                 | `{ "path": "Overview.md", "markdown": "# Overview" }`; returns note at revision 1     |
| GET                  | `/api/vaults/:v/notes/:n`                              | Markdown, revision, timestamps, tags and parsed metadata                              |
| PATCH                | `/api/vaults/:v/notes/:n`                              | Required `revision`; `path`, `markdown` and/or `spaceId`. Success increments revision |
| DELETE               | `/api/vaults/:v/notes/:n`                              | Required `{ "revision": 1 }`; recoverable soft deletion                               |
| GET                  | `/api/vaults/:v/search`                                | `q`, optional `limit` 1–100; metadata and plain-text snippets                         |
| GET                  | `/api/vaults/:v/tags`                                  | Normalized tags with note counts                                                      |
| GET                  | `/api/vaults/:v/graph`                                 | Nodes, aggregated directed edges, unresolved links                                    |
| GET                  | `/api/vaults/:v/analytics`                             | Counts, tags, most-linked notes, current-note growth, 365 days of UTC activity        |
| GET                  | `/api/vaults/:v/notes/:n/links`                        | Outgoing links with resolutions, and backlink note summaries                          |
| GET                  | `/api/vaults/:v/attachments`                           | Ready attachment metadata                                                             |
| POST                 | `/api/vaults/:v/attachments?path=Attachments/file.png` | One multipart file, up to 20 MiB                                                      |
| GET / DELETE         | `/api/vaults/:v/attachments/:a`                        | Download bytes / delete permanently                                                   |

Graph nodes contain `id`, `path`, `title`, `tags`, `incoming` and `outgoing`. Edges contain `source`, `target` and occurrence `count`. Unresolved links include source ID, target text, line and reason (`missing`, `ambiguous` or `invalid`). Link resolutions separately report `exists` and `fragmentExists`.

See [vaults, notes and search](./knowledge) for exact parsing rules, limits and current move/rename behavior. Space authorization and note version history are implemented. Agent token issuance and MCP authentication are implemented; see [AI connections](./mcp).

### Coordinated note moves

`PATCH /api/vaults/:v/notes/:n` accepts a new `path` with the expected `revision`. It returns `{note, updatedLinks, changedNotes}`. `updatedLinks` counts rewritten destination spans (shared reference definitions count once); `changedNotes` includes the moved note and every note whose references were rewritten. All modified notes increment their revisions and refresh parsed/search metadata in the same transaction. A stale revision or destination collision returns 409 and commits nothing. Move planning above 10,000 notes or 16 MiB of Markdown returns 422. A standalone MongoDB server returns 503 for note mutations; configure a [replica set](./deployment#mongodb-replica-set).

The links endpoint also returns `unlinkedMentions` (note summaries) and `mentionsTruncated`. These are case-insensitive literal title/filename matches in other notes' extracted text, excluding self and linked backlinks, limited to 100. All queries remain scoped to the authenticated vault owner.

### Graph exploration data

`GET /api/vaults/:v/graph?includeFiles=true` returns `{nodes, edges, unresolved}`. It adds to each node:

| Field       | Meaning                                                                |
| ----------- | ---------------------------------------------------------------------- |
| `kind`      | `note`, `attachment` or `missing`                                      |
| `createdAt` | ISO timestamp; unresolved nodes use their earliest referring note date |
| `wordCount` | Parsed words for notes, zero for other node kinds                      |

Note IDs remain ObjectIds. File IDs are `attachment:<ObjectId>` and unresolved IDs are opaque `missing:...` strings; neither is a note ID. Downloads use the attachment ObjectId and the existing authorized attachment route. Missing nodes are not stored notes and have no open endpoint. Attachment wiki links try the source folder, vault root and a unique filename; Markdown paths remain relative. Repeated edges aggregate into `count`. The response contains no Markdown bodies.

The default `includeFiles=false` preserves the original note-only graph format. Full graph and analytics processing supports up to 50,000 total nodes, 200,000 local link occurrences and 64 MiB of projected metadata, otherwise 422. The limits apply after owner scoping. Graph view filters and local depth operate on the authorized response in the client; they are not a replacement for server permissions.

### Analytics data

`GET /api/vaults/:v/analytics` returns `noteCount`, `words`, `links` (resolved reference occurrences), `orphans`, `unresolvedLinks`, `tags`, `mostLinked` (up to ten), `growth`, `activity`, `activitySince`, `generatedAt` and `agentActivityAvailable:false`.

Growth rows are `{date, added, total}` for surviving notes' creation days. Activity rows are `{date, count}` for recorded per-note create/update/move/delete/restore changes over the last 365 UTC calendar days. Automatic link rewrites count as changes too; rejected writes do not. Older edits are not backfilled. An empty vault returns zeros and empty arrays. Agent activity arrives with MCP. See the [analytics guide](./analytics) for metric definitions and historical limits.

## Spaces and retained revisions

Space-aware read collections accept an optional ObjectId `spaceId`: notes, search, tags, graph, analytics, attachments and deleted-notes. Without it, the server returns all permitted spaces. Note and attachment summaries include `spaceId`; real graph nodes do too. Create a note with optional `spaceId`, or add it to the attachment upload query. Omitting the destination creates in Personal. Paths stay unique across active notes in the vault, regardless of space.

| Method | Path                                                | Contract                                                                                            |
| ------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/vaults/:v/spaces`                             | Visible `spaces` with id/name/kind/agentAccess/revision, plus `canManage`                           |
| POST   | `/api/vaults/:v/spaces`                             | Owner-only `{name, agentAccess?}`; default none                                                     |
| PATCH  | `/api/vaults/:v/spaces/:s`                          | Owner-only `{revision, name?, agentAccess?}`; built-in names fixed                                  |
| DELETE | `/api/vaults/:v/spaces/:s`                          | Owner-only, never-used custom spaces only                                                           |
| GET    | `/api/vaults/:v/deleted-notes`                      | Up to 100 recent tombstones: id/path/spaceId/revision/deletedAt                                     |
| GET    | `/api/vaults/:v/notes/:n/history`                   | `offset`, `limit` 1–50; metadata, total, currentRevision, deleted, currentPath, currentSpaceId      |
| GET    | `/api/vaults/:v/notes/:n/history/:revision`         | One permitted `version`, including full Markdown                                                    |
| POST   | `/api/vaults/:v/notes/:n/history/:revision/restore` | `{revision: currentRevision}`; restore content and original space at current path as a new revision |

Policies are `none`, `read` or `read-write` and are ceilings on future token grants, not credentials. Both current-note and historical-space permissions apply to recovery. Stale saves/policies/restores and occupied recovery paths return 409 without partial changes. A denied/unknown space or note returns 404 without metadata. Vault and space administration is owner-only; trusted agent principals are tested against the same route service but no remote adapter exists yet. See [Spaces](./spaces) and [History](./history).

## Secrets and account protection

All routes below require a verified browser session and the normal Origin/CSRF rules for mutations. Secret routes additionally require enrolled TOTP and a session that passed MFA. They return `Cache-Control: no-store`. Agents use the separate scoped `/mcp` bearer transport.

| Method | Path                                   | Contract                                                                                             |
| ------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/security/status`                 | `totpEnabled`, `recoveryCodesRemaining`, `pendingApprovals`                                          |
| POST   | `/api/account/totp/setup`              | `{password}` → local QR `uri`, manual `secret`, ten-minute `expiresAt`; never cache these            |
| DELETE | `/api/account/totp/setup`              | `{}` discards this session's pending enrollment                                                      |
| POST   | `/api/account/totp/enable`             | `{code}` → ten `recoveryCodes` once; rotates session cookie and revokes other sessions               |
| POST   | `/api/account/totp/recovery-codes`     | `{password, code}` → replaces all recovery codes; requires both factors                              |
| POST   | `/api/account/totp/disable`            | `{password, code}`; refuses active secrets; rotates current session and revokes others               |
| GET    | `/api/vaults/:v/secrets`               | Optional `spaceId`; up to 100 `secrets` metadata records, no values/envelopes                        |
| POST   | `/api/vaults/:v/secrets`               | Secret fields plus reauthentication; 201 with metadata                                               |
| PATCH  | `/api/vaults/:v/secrets/:id`           | Secret metadata fields, expected `revision`, optional replacement `value`, reauthentication          |
| DELETE | `/api/vaults/:v/secrets/:id`           | `{revision, password?, code?}`; erases encrypted payload, retains tombstone and audit                |
| POST   | `/api/vaults/:v/secrets/:id/access`    | `{password?, code?}` → `{value, hideAfterSeconds:30}` only after committed audit                     |
| GET    | `/api/security/approvals`              | Owner's live pending `approvals`, up to 100; polls may refresh every ten seconds                     |
| POST   | `/api/security/approvals/:id/decision` | `{approved, password?, code?}`; approval requires reauthentication, denial only the session          |
| GET    | `/api/security/audit`                  | `limit` 1–100 (default 50), optional sequence `before` and `vaultId`; returns `events`, `nextBefore` |

Secret fields are `{name, kind, spaceId, value, agentAccess, requireApproval}`. `kind` is `password`, `api-key`, `ssh-key`, `env` or `other`. Name: 1–100 trimmed characters, unique among active vault secrets. Value: 1–65,536 UTF-8 bytes; required on creation. `agentAccess` defaults to `none` and accepts `none`/`read`; `requireApproval` defaults to true. Reauthentication accepts a password **or** an unused authenticator/recovery code in an already MFA-verified session. Update metadata fields are required except the two policy fields which retain their documented defaults if omitted; clients should send their intended policy explicitly. Expected revision conflicts return 409.

Login accepts an optional `code`. An enrolled account receives `TOTP_REQUIRED` after a correct password without a code, or `TOTP_INVALID` for an invalid/reused factor. Password reset keeps TOTP enabled. Audit entries contain IDs, actor, IP, timestamp, action/outcome and chain hashes; no plaintext values. See [Secrets](./secrets) for approval binding, key rotation, clipboard limitations and the threat model. Request schemas are also available in `/api/openapi.json`.

## AI connection API

Browser management routes require a verified session and Origin/CSRF on writes. They never accept a caller-selected agent identity.

| Method | Path                               | Contract                                                                                                    |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| GET    | `/api/agents/options`              | Current vault/Space choices and eligible secret metadata; no values                                         |
| GET    | `/api/agents/tokens`               | Metadata, latest record per OAuth family; no credentials                                                    |
| POST   | `/api/agents/tokens`               | `name`, `vaultIds`, `spaceIds`, `scopes`, `personalConsent`, `expiresInDays`, reauthentication → token once |
| DELETE | `/api/agents/tokens/:id`           | Revoke personal token or OAuth family and its refresh credentials                                           |
| GET    | `/api/agents/activity`             | Last 100 metadata events; optional vault/Space and `before` filters                                         |
| POST   | `/api/vaults/:id/project-template` | `{project,spaceId}` creates five Code Space memory notes atomically; 409 on any occupied path               |
| GET    | `/api/oauth/requests/:id`          | Claim current authorization request for the authenticated user                                              |
| POST   | `/api/oauth/consent`               | `{request,approved,vaultIds?,spaceIds?,scopes?,personalConsent?}` → registered callback URL                 |

`/mcp` accepts authenticated Streamable HTTP POST requests; GET/DELETE return 405 after authentication. OAuth discovery, dynamic registration, authorization, token exchange and revocation use the protocol described in [MCP setup](./mcp). They authenticate with bearer/PKCE credentials rather than browser-cookie CSRF. OpenAPI documents the management routes; MCP publishes its own strict tool schemas through `tools/list`.

## Desktop synchronization API

These routes require a verified owner session and normal Origin/CSRF on writes. They do not accept MCP bearer credentials. Secrets are never queried or returned. Existing attachment records gain optional `contentHash` and `revision` fields; legacy hashes are computed from their immutable GridFS bytes on demand.

| Method | Path                                                           | Contract                                                                                                                   |
| ------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/vaults/:id/sync/manifest?spaceIds=<comma-separated-ids>` | Explicit 1–100 owner Spaces → active note/attachment fingerprints; up to 10,000 files / 64 MiB Markdown; no content bodies |
| GET    | `/api/vaults/:id/sync/file?id=<file-id>&kind=note`             | One owner note and base64 bytes; use `kind=attachment` for a binary attachment                                             |
| POST   | `/api/vaults/:id/sync/file`                                    | `{path,kind,spaceId,expected,data}` → new fingerprint or null after deletion                                               |

A fingerprint is `{id,kind,path,spaceId,hash,revision}` with a SHA-256 content hash. `expected` must match the current fingerprint exactly, or be null for an absent path. `data` is canonical base64, or null for deletion; an empty string creates an empty file. Note data must be UTF-8 and at most 1 MiB. Attachments are limited to 20 MiB; the JSON body limit is 29 MiB. A mismatched fingerprint returns 409 without replacing content. Note writes and revision/activity snapshots commit together. Attachment bytes are staged in GridFS before metadata publication and cleaned up after failed compare-and-swap. Successful replacement removes superseded server bytes; local receiving history retains its previous copy.
