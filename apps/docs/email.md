# Email verification and password recovery

New accounts must verify email before login or any authenticated API access. Registration sends a verification link and creates no session. Unverified login shows **Please verify your email** with a resend button. Legacy accounts without an `emailVerified` field are migrated to verified on startup; explicit unverified accounts are preserved.

## Configure Resend

1. Add a domain you control in Resend, optionally a sending subdomain such as `accounts.example.com`.
2. Add the exact SPF and DKIM DNS records supplied by Resend. Preserve your existing SPF policy; do not create conflicting SPF records. Add Return-Path/MX records if requested. Wait for verified status. DMARC is recommended.
3. Create a sending API key scoped to that domain. Set the server variables:

```dotenv
RESEND_API_KEY=re_your_private_key
EMAIL_FROM=Helious <noreply@accounts.example.com>
EMAIL_REPLY_TO=support@example.com
PUBLIC_URL=https://notes.example.com
```

`EMAIL_REPLY_TO` is optional. `PUBLIC_URL` is the exact HTTPS origin used for links. Production startup refuses missing credentials or sender. Keep keys out of Git and browser bundles. Disable open/click tracking for transactional emails in Resend. The Compose app has outbound network access for delivery; MongoDB stays on its internal network with no published port.

See Resend's [Node SDK guide](https://resend.com/docs/send-with-nodejs) and [domain verification guide](https://resend.com/docs/dashboard/domains/introduction). The swappable `EmailService` uses the official SDK. Four [React Email templates](https://react.email/docs/utilities/render) provide HTML and plain text, with a copyable URL below the button.

## Development and tests

With `NODE_ENV=development` and no API key, emails and links print to the server console. Open the printed link to verify your account before signing in. The temporary preview uses this mode. Treat the console as private: links are live development credentials. There is no verification bypass.

Tests inject an in-memory `EmailService`. Only the explicit ephemeral Playwright runner exposes its mock inbox; normal startup never registers test routes.

## Verification and email changes

Verification links use `/verify-email?token=...` and expire exactly 30 minutes after issuance. A valid link verifies the account and redirects to sign-in with a success message. Invalid, expired or used links show a request-new-link page. A re-request invalidates older tokens of that type.

In **Account & server → Change email address**, enter the new address and your current password. The old address stays active until you verify the new one. Confirmation switches the address, signs out all sessions, invalidates outstanding email tokens and notifies both addresses. If the new address has become unavailable, no switch occurs; request another address from your account.

## Forgot password

The login page links to a form that always responds **If an account exists, we sent you an email**. Unknown addresses, throttling and provider failures share that response. Delivery happens after the response so provider latency cannot reveal account existence. The page always explains checking spam and retrying delayed/unavailable delivery; logs record generic failures without provider internals. Registration, resend and email-change failures may display a generic delivery error directly.

Reset links use `/reset-password?token=...`, expire after exactly 30 minutes and can be used once. The new password must contain 12–128 characters; common prefixes and insufficient variety are rejected by both client and server. Several distinct words work well. Success revokes every browser session, cancels pending email changes and sends a password-changed notification. Review any existing agent/MCP tokens separately; those features are not yet implemented. Resetting a password does not verify an unverified account or disable an enrolled authenticator. You still need an authenticator or recovery code to sign in. See [account protection](./secrets#protect-your-account-first).

## Token storage and delivery limits

Tokens contain 32 CSPRNG bytes in base64url form. `email_tokens` stores only SHA-256 hashes, user/type, creation/expiry/used timestamps and a target address for email changes. One replaceable slot per user/type prevents concurrent re-requests from leaving two valid links. Atomic consumption checks expiry, purpose and unused state; hash equality uses constant-time comparison. A TTL index cleans up expired records, while application checks enforce expiry immediately.

All outgoing messages share a rolling allowance of three emails per normalized address per 15 minutes, plus ten link requests per IP per endpoint per 15 minutes. Rate records store hashed addresses. Security notifications that exceed the allowance wait in the durable `email_notifications` queue and send when a slot opens. A background worker checks every 30 seconds and retries delayed/failed notifications; the queue contains no verification/reset token or password. Notification delivery can be delayed by the email allowance or a provider outage. Back up this collection with the account data.

Session auth versions reject old credentials immediately after password/email changes, independently of deleting session records. Logs redact URLs; token pages use no-referrer and remove token query strings after reading them. Graceful shutdown waits for in-flight delivery. An abrupt process crash before a background email finishes may lose that delivery; request another link. Credential changes are not rolled back when notification delivery fails.
