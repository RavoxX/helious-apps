# Encrypted secrets

Agents can store a new encrypted secret with MCP `create_secret` only after the owner explicitly
grants `secrets:create` on a writable Space and enables two-factor authentication. This is write-only:
the tool returns metadata, cannot overwrite existing secrets and grants no read access. Agent-created
secrets start with agent access disabled and approval required. The owner separately enables each
secret and grants its exact read scope when retrieval is appropriate. See [MCP setup](./mcp).

Secrets are available in each vault's **Secrets** tab. They are separate from Markdown notes, attachments, search, graph data, note history and exports. Use **Settings → Security & access** to set up an authenticator, manage recovery codes, review pending agent requests and read the secret audit log.

## Protect your account first

1. Enter your current password to start authenticator setup. Scan the QR code locally with an authenticator app, or enter the setup key. No QR service receives your key.
2. Confirm a six-digit code within ten minutes. Codes follow TOTP (SHA-1, 30-second intervals with one adjacent interval allowed for clock drift). A previously accepted interval cannot be reused.
3. Save the ten recovery codes outside Helious. They appear once and each works once. Only their SHA-256 hashes are stored. Leaving the page or window hides the displayed recovery codes.

Enabling or disabling an authenticator rotates the current session and signs out all other sessions. Future sign-ins require your password plus an unused authenticator or recovery code. Keep the server clock synchronized. Email password recovery **does not remove two-factor authentication**; you still need your authenticator or a recovery code.

Replacing recovery codes and disabling an authenticator require both your password and an unused factor. Delete all active secrets before disabling. There is no email-only MFA bypass or administrator recovery endpoint. Losing both your authenticator and recovery codes requires instance-owner recovery from a trusted backup; do not edit database authentication fields casually.

Five failed account reauthentication attempts block further attempts for 15 minutes. Security mutations also have per-IP route limits. A correct password does not reset the failed-factor counter.

## Store and reveal

Choose a vault and Space, select **Add secret**, and enter a name, kind and value. Supported kinds are password, API key, SSH key, environment snippet and other. Values may contain up to 65,536 UTF-8 bytes. Names are unique among active secrets in a vault, case-insensitively. Metadata is visible to the owner; do not put confidential values in names.

Saving, changing, deleting and revealing a secret requires reauthentication. The UI asks for the current password; the API also accepts an unused authenticator or recovery code. The browser session must already have passed two-factor authentication. Concurrent edits use an expected revision; refresh after a conflict. Changes invalidate outstanding approvals. Deletion removes the encrypted payload and retains a metadata tombstone and audit entries. Secret values have no undo/version history.

Revealed values hide after 30 seconds, on window blur or when the tab becomes hidden. They stay out of localStorage, persisted note drafts and the Query cache. Copy attempts to clear the clipboard after 30 seconds **only if its contents still match**. Browsers may deny clipboard reads/writes; Helious cannot clear clipboard history, screenshots, other apps' copies or browser memory reliably. Treat copied values accordingly.

Vault and custom Space deletion refuse to proceed while active secrets exist. The normal note editor never looks up secrets: <code v-pre>{{secret:prod-server-ssh}}</code> stays literal in source/export and is masked in Reading. This syntax does not detect or redact credentials pasted into normal notes.

## Agent policy and approvals

Agent authentication, scoped token issuance and MCP transport are available under **AI connections** in the workspace sidebar. `get_secret` requires an exact per-secret scope, current Space and secret policies, and approval where configured. The owner must have TOTP enabled. No request field can choose an agent identity. See [MCP setup](./mcp).

Agent reads will require all of: an explicit vault grant, an explicit Space grant, a current Space policy allowing agents, the secret's own **Allow explicitly scoped agent tokens** policy, and the exact `secrets:read:<secretId>` scope. `notes:read` does not grant secret access. Personal still defaults to no agent access. Agents can list only metadata for secrets they may read.

**Require approval** is enabled by default. An eligible read creates a pending request; repeated requests reuse the live request. The inbox refreshes every ten seconds. Approval requires owner reauthentication; denial does not. Requests expire exactly ten minutes after creation, even if approved later. Approval binds the agent identity, secret revision, Space policy revision and owner's authentication version. Changed permissions, account resets, expiry or a previous redemption prevent use. Redemption is atomic and single use. Agents with approval disabled still need all explicit grants and are audited.

An approved `get_secret` flow will return a credential to the explicitly authorized agent. This is **not** invisible browser autofill and does not keep the approved value hidden from that agent. Prefer per-host deploy keys and narrowly scoped service credentials, with short lifetimes and minimal rights, over a personal master key.

## Encryption and key rotation

Every secret gets a fresh random 256-bit data key. AES-256-GCM encrypts the payload; a separate AES-256-GCM operation wraps that data key under the configured master key. Nonces are independent random 96-bit values and tags are 128 bits. Authenticated context binds owner, vault, Space and secret ID. Authenticator seeds and pending enrollment seeds use the same envelope machinery with separate contexts. The master key stays outside MongoDB.

Configuration:

| Variable                       | Purpose                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `HELIOUS_MASTER_KEY`           | Required active 32-byte key, as 64 hexadecimal characters; unchanged from previous phases  |
| `HELIOUS_MASTER_KEY_ID`        | Active key label; defaults to `v1`, 1–40 letters/digits/underscores/hyphens                |
| `HELIOUS_PREVIOUS_MASTER_KEYS` | Optional JSON object mapping up to ten previous IDs to their 64-hex keys; empty by default |

Use a secret manager or protected environment file. Never commit keys. Startup refuses records whose key IDs are missing from the configured ring. Keep encrypted MongoDB backups **and the corresponding keys**, protected separately. Losing keys loses encrypted values and authenticator seeds.

For a planned rotation:

1. Back up MongoDB and the existing keys. Stop older app instances and take a maintenance window. Generate a new key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Configure the new active key under a new ID, and put the old ID/key into `HELIOUS_PREVIOUS_MASTER_KEYS`. For example, the JSON shape is `{"v1":"<old-64-hex-key>"}`; replace the placeholder. Do not reuse an ID for a different key.
3. With the same database and environment, run `node apps/server/dist/rotate-keys.js --dry-run`. In Docker: `docker compose run --rm helious node apps/server/dist/rotate-keys.js --dry-run`.
4. Run the same command with `--apply`. It validates encrypted payloads and rewraps data keys, including authenticator and live enrollment records. The secret payload ciphertext is retained. Each committed rewrap is audited. No decrypted values or keys are printed. Compare-and-set guards skip concurrently changed records; repeat until a dry run reports zero rewraps and investigate any error.
5. Start all instances with the new active key. Replacing it also changes CSRF signing; refresh clients to obtain a new CSRF cookie. Key rotation alone does not revoke sessions or agent tokens. Revoke them separately in an incident.
6. Retain previous keys for every backup that still needs them. Remove a previous key from the live ring only after checking no live record uses it. Test backup restores in an isolated environment before retiring keys.

Dry run is the default when no flag is given. The command uses the normal server configuration, including production email settings. A failure can leave a mixture of old and new key IDs; keep both keys configured and rerun. Rewrapping does not revoke a stolen data key or undo an old backup disclosure; rotate the underlying credentials if compromise is suspected.

## Audit and threat model

Every service secret access attempt records actor identity, IP, timestamp, action, outcome and target IDs. Successful mutations, reads and approval consumption commit with their audit entry before returning a value. Failed access is recorded separately after rollback. Audit failure blocks value delivery. Logs exclude values, envelope contents, authenticator seeds, passwords and recovery codes. The owner can page through events in Security & access or `GET /api/security/audit`.

The service exposes no edit/delete audit API. Each owner's ordered entries form a SHA-256 hash chain with a stored head. This detects accidental modification when checked against a trusted head; it is **not immutable against a database or host administrator**, who can rewrite the chain. Retain protected external backups/anchors for independent evidence. Events survive vault deletion; TTL cleanup applies to approvals and enrollment attempts, not audit entries.

Envelope encryption protects a database-only disclosure while master keys remain separate. It is not end-to-end encryption. The server decrypts authorized values; a compromised host, master-key environment, browser session or same-origin script can expose data. MFA does not protect an already compromised server. JavaScript strings and browser state cannot be securely zeroized; temporary buffers are cleared where practical. Disk backups can retain deleted ciphertext. Use HTTPS, restrict database access, patch dependencies and minimize credentials stored here. See [Security](./security) for the wider deployment boundary.
