# Your account and data

Open **Account settings** from the profile menu. You can correct your display name, verify a replacement email address, prepare a portable export or request permanent account deletion. Password recovery, session controls and authenticator settings remain in their existing panels.

## Registration policy

Instances default to an **18+ self-declaration checkbox**. This records the declaration and timestamp, not a verified age. Helious does not request a date of birth, identification document or payment card for this check. The server rejects missing/false declarations when `REGISTRATION_MIN_AGE=18`.

An instance operator may set `REGISTRATION_MIN_AGE=0` only after determining an appropriate policy for that service. The isolated test preview uses 0; this does not disable production enforcement. A declaration alone is not a universal age-assurance or legal-compliance certification.

Publish your actual instance policies separately, then configure `TERMS_URL`, `PRIVACY_URL` and `TERMS_VERSION`. Versioned terms require a separate unchecked acceptance box; stale/missing acceptance is rejected by the server. The privacy link is a notice, not a bundled marketing-consent box. Existing accounts are not retroactively marked as having accepted new terms. Changes requiring renewed acceptance need an appropriate notice/acceptance process before launch; do not invent historical consent.

## Portable export

Enter your current password; if an authenticator is enabled, also enter an unused authenticator or recovery code. Choose **Prepare export**, then **Download ZIP**. The single-use link expires after five minutes, is bound to this account/session and is invalidated by preparing another export or changing credentials. A copied link cannot be used by another signed-in account. Keep it out of screenshots, logs and support reports.

The ZIP contains:

- `account.json`: profile and recorded policy declarations.
- `vaults/<vault-id>/files/`: current Markdown and attachments at their original relative paths.
- `records/*.ndjson`: vault/Space metadata, note history (including retained deleted content), activity, session metadata, agent connection metadata, and secret names/policies/audit information.

Each NDJSON line is an independent JSON record. Secret values/ciphertext, password hashes, authenticator seeds/recovery hashes and session/agent/OAuth credentials are excluded. This is a portable account export, not a consistent database backup or complete export from outside providers. Review provider-held records or other access/correction requests with the instance operator.

The server streams the ZIP with backpressure. The default raw-data limit is 1 GiB (`ACCOUNT_EXPORT_MAX_BYTES`), with at most 50,000 current note/attachment files. Very large accounts require operator assistance. A concurrent content edit/deletion, expired session, connection loss or size limit can interrupt a download; request a fresh link and discard an incomplete ZIP. ZIP downloads are private data and are not themselves encrypted. Store them securely.

## Permanent deletion

Export first, then expand **Delete account**, reauthenticate, and type `DELETE` followed by the exact account email. If MFA is enabled, both password and an unused factor are required. This confirmation also discards drafts in the current browser; separate device copies are unaffected.

The request atomically marks the account/vaults unavailable, advances the authentication version and revokes sessions, agent credentials and pending email links. Erasure is queued with a five-minute grace for in-flight requests, then a background worker retries interrupted cleanup across server notes, history, attachments/GridFS, secrets, authenticator credentials and owned activity. There is no undo flow. A healthy deployment normally completes within 24 hours. Investigate queued jobs and database/provider failures rather than silently dropping a request.

The last active administrator cannot delete their account until another active administrator is assigned. This prevents an instance from losing all administration. Changes to administrator roles must use the same `admin-guard` transaction lock as deletion.

The completion marker contains a user identifier/timestamps and expires after one day; it is not an archive of the deleted account. Separately operated support/legal records, security logs, downloaded exports, device vaults, external agent copies and backups have their own documented purposes/retention and may require separate action. Self-hosting operators must enforce their actual backup/provider retention and ensure a restored backup does not reactivate deleted accounts. Do not promise automatic deletion from systems this app does not control.

## Operator operations

Keep MongoDB as a replica set. New account mutations use transactions and existing reauthentication/CSRF checks. The worker runs every 30 seconds while the server is up. Monitor `account_deletions` for pending/running jobs and failed attempts; do not erase the job merely to hide an error. Restarting resumes eligible jobs; leases permit recovery after a crashed worker.

For access, correction, restriction or erasure that the self-service controls cannot complete, provide a monitored contact route, verify identity proportionately, track the applicable response deadline and document the decision. Do not request a copy of an identity document by default. Applicable law and the operator's circumstances determine the full response; this technical guide is not legal certification.
