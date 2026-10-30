# Security and privacy

Phases 1–8 protect accounts, sessions, owner/space-scoped knowledge, version history and a separate encrypted secrets store. TOTP, recovery codes, reauthentication, approvals and a secret audit log work. Scoped agent tokens, OAuth/PKCE and MCP now use the same permission boundary. Do not store SSH keys or passwords in ordinary note content.

## Current protections

Argon2id password hashing; 256-bit random sessions stored as hashes; seven-day expiry checked on every request; automatic session-ID rotation after fifteen minutes; revocation; signed CSRF tokens; exact-origin validation; HttpOnly and SameSite cookies; production Secure cookies; CSP; input bounds; IP rate limits and database-backed login lockout.

The first account claims the administrator role atomically. Disable registration once the intended users have accounts. Account messages use Resend; there are no external analytics or remote fonts. New accounts must verify email. See [email setup and recovery](./email).

Vault, note, search, tag, graph, backlink and attachment requests check the signed-in owner on the server. Another account receives 404 for those objects. Multipart uploads require the same Origin and signed CSRF token as JSON mutations, are limited to one 20 MiB file and remove partial chunks after failure. Downloads use attachment disposition and an inert content type. Markdown source and reading views skip raw HTML and remote image loading. The [space policy engine](./spaces) checks both current and historical spaces, omits hidden graph/link metadata, and rechecks write permissions inside transactions. MCP derives its principal from hashed bearer credentials; current grants are rechecked inside write transactions. No HTTP header enables the trusted-principal test adapter.

## Threat model

The application aims to resist remote unauthenticated access, CSRF, basic credential guessing, stolen old session IDs after rotation and cross-account session access. It assumes a trusted host, trusted TLS reverse proxy, safe key handling and a private database network. A compromised host administrator, database administrator, browser or extension is outside this boundary. This is not end-to-end encryption.

Rate limits are process-local and need shared storage before horizontal scaling. Account lockout trades some availability for guessing resistance. The MongoDB TTL monitor is not an authorization boundary; every active-session query also checks the timestamp.

## Master key and secrets

`HELIOUS_MASTER_KEY` must contain 32 cryptographically random bytes in hexadecimal form. Normal startup fails without it. It wraps random per-secret AES-256-GCM data keys and separately derives a purpose-specific CSRF signing key. Keep keys outside source control and back them up separately from MongoDB.

The [secrets guide](./secrets) documents authenticator setup, per-secret permissions, ten-minute single-use approvals, the audit boundary and the `rotate-keys` command. Keep previous master keys while any backup needs them. Database encryption does not protect against a compromised app host or browser.

For SSH agent workflows use a **per-host deploy key with minimal rights**, rather than a personal master SSH key. The secret service requires an explicit per-secret scope and current Space/secret policies for agents, and records accesses before releasing values. Browser access requires MFA and reauthentication. Notes mask secret references in Reading and never resolve them during rendering or export. Agent transport and token creation are available; see [AI connections](./mcp).

See the root `SECURITY.md` for the milestone checklist and operational assumptions.

## Revision retention

Edits and recoverable deletions retain plaintext snapshots and actor IDs in MongoDB. Restoration adds a new revision and returns content to its saved space; old Personal snapshots require their own permission even if a current note is in Code. There is no automatic pruning or individual permanent purge yet. Deleting a vault erases its history. See [History and recovery](./history).

Local folders use OS permissions rather than server Space policies. Native server cookies are held in the platform keyring; the Rust/Swift clients do not embed a webview. Sync is explicit per Space, uses content/revision guards and preserves conflicts; it never exports the secrets collection. See [desktop security and limits](./desktop).

## Account controls and security logs

[Account settings](./account-data) support profile correction, reauthenticated portable export and queued erasure. Exports contain plaintext Personal notes and must be protected like the original vault. Deletion ends access immediately; the background worker and separately operated backups/providers have different deletion timelines.

Minimal security events in MongoDB expire after 14 days through a TTL index. They record route patterns and IP addresses, without query strings or request bodies. Secret-access audit records also contain IP addresses and have a separate lifetime; the 14-day request-event TTL does not prune that audit. Operators must determine and enforce their audit, proxy/host log and backup retention before offering a hosted service.
