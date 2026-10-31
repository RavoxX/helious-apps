# Operating a Helious instance

## Before allowing real accounts

Use the [deployment guide](./deployment) for a persistent replica set, matching master keys and TLS. Run one application writer during an upgrade. The example's `COOKIE_SECURE=false` is for local HTTP only; remote instances need their canonical HTTPS `PUBLIC_URL`, secure cookies and a narrowly configured trusted proxy. Keep MongoDB off public interfaces. Restrict host administrator access separately from application accounts.

Before launch, record an operator, hosting region, provider contracts/DPAs, mail delivery/transfer arrangements, incident contact, backup policy and the instance's legal policies. Verify the sender domain's SPF/DKIM/DMARC, disable unnecessary mail tracking and perform a transactional delivery test with an owned test account. The public source does not supply a managed hosting deployment or certify regulatory compliance.

## Retention inventory

| Data                                               | Application behavior                                                                     | Operator action                                                                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Security events                                    | Minimal route/method/status, IP and account ID; 14-day MongoDB TTL, asynchronous removal | Check the TTL index and actual oldest record; do not promise exact deletion at the deadline                                                  |
| Sessions, email proofs, OAuth proofs and approvals | Expiry checked in code, with cleanup indexes where defined                               | Do not treat TTL cleanup as authorization; include restored copies in incident recovery                                                      |
| Notes, attachments and note history                | Retained for the account/vault until deletion; note revisions can retain old text        | Explain history to users; distinguish deleting a note from erasing an account                                                                |
| Secret access audit                                | Separate append-only/chained audit, potentially including IP addresses                   | Set a lawful retention policy; arbitrary row deletion breaks audit verification. Archive/rotate only with a reviewed chain-preserving design |
| Host/proxy/container logs                          | Outside database event TTL                                                               | Configure rotation and an explicit time-based deletion period; avoid query strings, message bodies and auth headers                          |
| Encrypted off-host backups                         | Outside live account erasure                                                             | Set expiry, access controls and restore reconciliation; retain only necessary generations                                                    |
| Local folders and account exports                  | User-owned copies outside server control                                                 | Tell users that server deletion cannot remove these copies                                                                                   |

Container log size limits alone are not a retention period. Confirm the behavior of the actual host, reverse proxy and mail provider instead of copying a blanket fourteen-day claim.

## Restore without reviving revoked access

1. Stop writers and restrict network access. Preserve the affected deployment and key material for recovery/incident handling; do not run an old application against a newer live database.
2. Restore the complete database into an isolated target with the matching active/previous master keys. Keep the public origin inaccessible. Never restore into a running preview or use `--drop` against an unverified database target.
3. Compare deletion/rights requests completed after the backup with a separately protected minimal erasure ledger. Reapply them before reopening. A restored `account_deletions` queue alone cannot remember requests made after that backup.
4. In the isolated database, increment every restored user's `authVersion` (`db.users.updateMany({}, {$inc: {authVersion: 1}})`) and remove all browser sessions (`db.sessions.deleteMany({})`). This deliberately requires everyone to sign in again and invalidates restored version-bound agent connections. Do not run these disruptive commands on a live instance as a routine health check.
5. Expire/remove pending `email_tokens`, `secret_approvals`, `totp_enrollments`, `oauth_requests`, `oauth_codes`, `oauth_refresh` and `account_exports` before reopening. Review restored agent tokens and regenerate recovery codes when compromise or a rollback may have revived consumed factors. Never remove `secret_audit` or its heads to make validation pass.
6. Start the current application while isolated; verify health/indexes, an owned account's MFA/sign-in, a synthetic note and attachment, a synthetic audited secret reveal and absence of deleted accounts. Confirm previous cookies, bearer tokens and proof links fail.
7. Record the backup time, restored revision, key IDs, revoked authorities, reconciled erasures and evidence. Reopen only after an operator has reviewed these checks.

These are operator steps, not an automatic restore feature. The private managed-service admin, support and audit stores need their own restore/revocation procedure; they are not included in this public repository.

## Incident response

Restrict affected entry points first, preserve minimal access-controlled evidence, identify impacted accounts/Spaces/secret access and keep a timeline. Revoke affected sessions, agent/OAuth credentials and exposed external deploy/API keys; key re-encryption alone does not revoke a stolen credential. Preserve master keys needed to decrypt legitimate backups. Fix and validate the cause on an isolated copy before reopening.

The controller must assess notification obligations, affected people and applicable deadlines using the facts of the incident and qualified advice. Follow the instance's privacy/security contact process; do not paste user notes, secrets, raw cookies or full dumps into public GitHub issues. Track follow-up actions and test the revised runbook.

## Release checks

Run the documented TypeScript and native checks, dependency advisory audits and isolated container smoke workflow. The smoke project has no published host ports, uses synthetic credentials and disposable volumes, and never reads `.env`; it checks built app/docs, unauthenticated denial, non-root/read-only runtime and restart persistence. It is not a backup restore drill or a production deployment.

Back up before changing versions. Never replace a published installer/tag: publish a new patch version and verify anonymous downloads, payload hashes and both platform update signatures. Windows Authenticode and macOS Developer ID/notarization are separate from updater signatures. Native GUI validation on macOS still requires an actual Mac session.

See [dependency/attribution review](./dependencies) for audit scope and remaining maintenance warnings.
