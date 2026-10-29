# Security model — Phases 1–8

Report suspected vulnerabilities privately to the instance owner or repository maintainer. A public reporting address has not been configured. Do not publish credentials, private notes, or exploit details in public issues.

## Implemented boundary

The browser talks to Fastify on one origin. MongoDB stays on an internal Docker network. Passwords use Argon2id (64 MiB, three iterations, one lane). Session tokens are 256-bit random values; only SHA-256 hashes are stored. Sessions expire after seven days and rotate after fifteen minutes when used on authenticated routes. Expiry is checked on every request because MongoDB TTL cleanup is asynchronous. Logout and revocation delete the database record.

Cookies use HttpOnly, SameSite=Lax and Secure in production by default. The localhost Compose example explicitly turns Secure off for HTTP evaluation. Public production origins require HTTPS. JSON mutations require the configured Origin and a 256-bit CSRF header matching a signed HttpOnly cookie. The signing key is derived with HKDF from `HELIOUS_MASTER_KEY` for a distinct purpose. The master key is required on startup; Phase 6 uses separate AES-256-GCM envelope encryption for secrets and authenticator seeds.

Authentication has a 10-request / 15-minute IP rate limit and a five-failure / 15-minute account lockout. General API traffic is limited to 300 requests/minute/IP. Unknown accounts receive an Argon2 check against a dummy hash. Error messages on login do not distinguish missing accounts. Registration does report duplicate email addresses. Rate limits are per process; use a shared limiter before horizontal scaling. Lockout is an availability tradeoff: an attacker can temporarily lock an account by guessing its email.

The first inserted account to win an atomic singleton claim becomes administrator. Registration can then be disabled. Account lookup, session listing and revocation are scoped to the authenticated user. All stored emails are normalized to lowercase. Passwords are not normalized or trimmed. The browser uses no external tracking or remote fonts. Server-side account email uses Resend.

Knowledge routes authenticate before checking vault ownership; all note, search, tag, graph, backlink and attachment queries include the owner and vault scope. Foreign objects return 404. Atomic revision filters prevent lost updates. Paths reject traversal, control bytes, reserved device names and the internal config folder. Markdown source and reading views escape/skip raw HTML and do not fetch remote images. YAML expansion and metadata size are bounded. Notes are ordinary plaintext in MongoDB, not encrypted secrets.

Only the attachment upload route accepts multipart, with the same Origin and signed-CSRF checks. It streams a single file up to 20 MiB to GridFS, publishes only completed metadata and removes failed upload chunks. Downloads are forced attachments with an inert content type and nosniff. Vault deletion marks the vault deleting before cascading; it can be retried after interruption. A process crash during an upload can leave unreachable uploading metadata/chunks: automated stale-upload reclamation and storage quotas are future operational work. Back up MongoDB including GridFS.

## Email verification and recovery

New users require email verification and receive no session before confirming. Legacy users without the verification field are migrated to verified. `email_tokens` contains only hashes of 32-byte CSPRNG tokens, with explicit 30-minute expiry and atomic single use; one slot per user/type invalidates earlier links. Hash comparisons are constant time. Link requests use database-backed rolling address limits plus IP limits. Forgot-password responses are identical across known/unknown addresses, rate limiting and delivery failure; delivery is asynchronous so provider latency does not reveal account existence.

Password and verified-email changes increment an auth version and delete all browser sessions. Pending email changes require password reauthentication; the old address remains active until confirmation. Outstanding email links are invalidated on credential changes. Notifications are sent after changes and never include a password. Four React Email templates produce HTML and plain text through a replaceable EmailService and official Resend SDK. Production requires sender configuration; only development prints links. Request URLs are redacted from logs to avoid token leakage. See the email guide for operational limits and Resend setup.

All outgoing mail shares the three-per-address rolling limit. Security notifications wait in a durable MongoDB queue when the allowance is full or delivery fails. Worker leases coordinate processing, and delayed notices survive restarts. Queue records contain account notification metadata and a sign-in URL, never a verification/reset token or password. Provider timeouts can leave delivery uncertain; notifications are retried and may arrive late.

## Threats and assumptions

- MCP authenticates scoped bearer credentials independently of browser cookies. Tokens are hash-only, bound to a verified account version and explicit vault/Space/action grants. Writes recheck token and policy state inside the transaction. OAuth uses exact redirect/resource binding, S256, single-use codes and rotating refresh families; replay revokes the family. Registered client names are untrusted and consent displays the actual callback origin. See [MCP limits and setup](apps/docs/mcp.md).

- Protect against unauthenticated API access, cookie theft through script access, session fixation, CSRF, credential guessing and cross-account session revocation.
- TLS terminates at a trusted reverse proxy. Trust only explicit proxy IPs/CIDRs. Never trust arbitrary forwarded IP headers. The app binds to loopback in Compose.
- A root or database administrator can access account data. This is not an end-to-end encrypted system. A compromised host or browser can act as its user.
- The private Docker MongoDB has no authentication by default and must never be exposed to untrusted networks. Add MongoDB authentication and an appropriate backup access policy for shared infrastructure.
- Same-origin XSS can act as a signed-in user. CSP blocks remote scripts and frames; inline styles are allowed for animation. Continue output escaping and avoid unsafe HTML in Markdown reading views.
- The secret service commits append-only audit events before value delivery. Its per-owner hash chain is not immutable against database administrators. Do not log request bodies, cookies, authorization values, or decrypted secrets.
- The required key is not stored in MongoDB. Replacing it invalidates CSRF cookies; sessions must be explicitly revoked if responding to a key compromise. Envelope encryption and audited data-key rewrapping are implemented; keep previous keys for backups.

## Review checklist (ASVS Level 2 orientation)

- [x] Native folder boundary, symlink/junction refusal, stale-write checks, recovery journal and OS-backed server credentials; sync excludes unselected Spaces and secrets.
- [x] Argon2id password hashes; input bounds; generic login errors.
- [x] Cryptographic session IDs; hashed persistence; TTL plus immediate expiry checks.
- [x] Automatic session rotation; logout and scoped revocation.
- [x] Signed CSRF tokens, exact Origin, JSON mutations, no permissive CORS.
- [x] Cookie flags and HTTPS configuration validation; CSP and security headers.
- [x] Per-IP limits and database-backed account lockout.
- [x] Explicit admin check and race-safe first-admin selection.
- [x] No master-key fallback in normal startup; no secrets in client bundles.
- [x] Non-root app image, dropped capabilities, read-only app root and private MongoDB network.
- [x] Owner/vault isolation tests across notes, search, tags, graph, backlinks and attachments.
- [x] Atomic revision conflict checks; bounded parser input; safe GridFS downloads and failed-upload cleanup.
- [ ] Validate the Docker image at runtime on a running Docker engine.
- [x] Phase 5: principal/policy intersection and route tests prove Personal isolation across search, graph, links, tags, attachments, analytics and historical versions; the public MCP transport uses the same boundary.
- [x] Phase 6: envelope encryption, per-secret grants, TOTP/recovery codes, reauthentication, single-use approvals, append-only audit service and key-rotation checks. See apps/docs/secrets.md for threat-model limits.
- [x] Phase 7: OAuth/PKCE, code and refresh replay, scoped MCP tools/resources/prompts, Personal isolation, secret approvals, bearer revocation and stdio integration tests.
- [ ] Phase 10: dependency audit, full security review, resilience and production release verification.

This checklist is development evidence, not a certification or a completed audit.

## Space and history invariants

Verified browser sessions act as their account owner. Agent principals carry explicit owner/vault/space/action grants, intersected with current space policies. Personal defaults to no agent access; Code is eligible only with explicit grants. The production MCP adapter authenticates scoped bearer credentials and accepts no client-selected principal. Write authorization, policy changes and revision/activity snapshots share the vault transaction. A move may not rewrite inaccessible notes. Historical reads/restores require permission in the current and saved spaces. Deleted content remains recoverable until vault deletion; it is not cryptographically erased. Upgrade with old writers stopped and a full database backup.

## Desktop boundary

The bundled Tauri webview cannot navigate to arbitrary remote pages or grant them IPC access. Native commands are limited to the main local window. Folder access starts with a user-selected native dialog or a registered recent folder, and relative paths reject traversal, reserved names, links and Windows reparse points. Native file operations use content guards, a process lock, immutable revision files and recovery journaling. These checks do not sandbox other programs running as the same OS user or defeat hostile filesystem races; local Space metadata is not an access-control boundary.

Native server requests use TLS except loopback development, reject redirects and limit responses. Session cookies remain in Windows Credential Manager/macOS Keychain and are never returned to the frontend. There is no plaintext fallback. Server sync requires owner cookie authentication and compares file identity, Space, hash and revision transactionally; MCP tokens cannot use it. Personal mappings require explicit UI confirmation, hidden/configuration files and secrets are excluded, and unresolved conflicts retain copies. `.helious/` and backups contain plain note history and must be protected with the folder's OS permissions. Local device/disk encryption remains the user's deployment responsibility.

Native tests cover stale saves, revision recovery, journal replay, locking, traversal/junction rejection and canonical server origins. The OS credential round-trip test uses a synthetic temporary keyring entry and is run explicitly where a native credential store is available. Browser tests exercise the desktop API contract and a real MongoDB-backed sync flow; they do not substitute for native platform interaction testing.
