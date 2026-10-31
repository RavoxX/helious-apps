# Helious Apps

Public application and self-hosting source for Helious. The marketing website and its assets are maintained separately and are not included here.

- Windows: native Rust / egui / eframe interface with wgpu rendering.
- macOS: native SwiftUI / AppKit interface with a shared Rust vault engine.
- Server: Fastify, MongoDB, cookie authentication, scoped MCP and a browser workspace.
- Cloud sign-in defaults to https://helious.work; that hosted service is not live yet. Local folders work offline, and self-hosting works independently.

Read [AGENTS.md](AGENTS.md), [desktop setup](apps/docs/desktop.md), [Docker installation](apps/docs/deployment.md) and [security guidance](SECURITY.md). Native desktop previews are built by GitHub Actions; see the desktop guide for feature differences from the browser. No marketing homepage is shipped: the server redirects / to /app/.

Before opening registration, review [operations and restore recovery](apps/docs/operations.md) and [dependency/attribution scope](apps/docs/dependencies.md). Production advisories are checked in CI; image startup is tested with isolated synthetic data.

The browser workspace includes [daily notes, Markdown templates and typed YAML properties](apps/docs/authoring.md), plus [portable JSON Canvas boards](apps/docs/canvas.md) with cards, connections and conflict-safe saves. It also includes [rich reading/media](apps/docs/reading.md): callouts, highlighted code, math, on-demand diagrams and scoped note/image/audio/PDF embeds. Native 0.9 brings native authoring/Canvas/reading to Windows and macOS. [Permission-reviewed extensions and browser reading appearance](apps/docs/extensions.md) complete the Phase 9 authoring scope; see the platform guides for supported syntax and control differences.

## Self-host with Docker Compose

You need Git, Docker Engine with the Compose plugin (or Docker Desktop), a domain for remote access, and a Resend account with a verified sending domain. The production container requires working transactional email: accounts must verify their email before signing in.

```sh
git clone https://github.com/RavoxX/helious-apps.git
cd helious-apps
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env` for the last command. Edit `.env` before starting:

| Variable             | What to set                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `HELIOUS_MASTER_KEY` | A fresh 32-byte key encoded as **64 hexadecimal characters**. Keep it permanently and back it up separately from the database. |
| `PUBLIC_URL`         | Your exact public origin, such as `https://notes.example.com`. Verification, recovery and MCP use this URL.                    |
| `COOKIE_SECURE`      | `true` for an HTTPS deployment. The example's `false` is only for local HTTP evaluation.                                       |
| `RESEND_API_KEY`     | A private sending API key for your verified Resend domain.                                                                     |
| `EMAIL_FROM`         | A verified sender, for example `Helious <noreply@accounts.example.com>`.                                                       |
| `EMAIL_REPLY_TO`     | Optional monitored mailbox for replies.                                                                                        |
| `REGISTRATION_OPEN`  | Start with `true` to create your account; disable later to stop new registrations.                                             |
| `TRUST_PROXY`        | Only the actual reverse proxy's IP/CIDR, if used; leave empty without one.                                                     |

Generate the key locally with Node.js (or `openssl rand -hex 32`):

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Never commit `.env` or replace an existing master key to fix a startup problem. Verify the SPF/DKIM records Resend provides and configure DMARC; see [email setup](apps/docs/email.md).

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 helious
```

The first build compiles the server, browser workspace and docs into one image. Compose starts MongoDB 7 as a single-member replica set and waits for it to become writable. The app binds to **127.0.0.1:3000**; MongoDB has no public port. Check `http://localhost:3000/api/health` on the host. For local evaluation use `PUBLIC_URL=http://localhost:3000` and `COOKIE_SECURE=false`; a verified Resend sender is still required by production Compose.

For remote access, put Caddy or Nginx on the same host in front of the app. A minimal host Caddy configuration is:

```caddyfile
notes.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Point the domain's DNS to your server, allow HTTPS/HTTP for certificate provisioning, and keep port 3000 and MongoDB off the public network. A proxy running in another container needs its own internal routing configuration; its `127.0.0.1` does not refer to the app container. See [deployment](apps/docs/deployment.md) for Nginx and trusted-proxy details.

Open your configured URL, register, follow the verification email, then sign in and create a vault. The first registered account becomes administrator. The workspace is at `/app/`, docs at `/docs/`, API at `/api/` and MCP at `/mcp`. Native apps can connect through **Account → Self-hosted server** using the same HTTPS origin. The separate managed Helious Cloud service is optional and not required for self-hosting.

Registration defaults to an 18+ self-declaration checkbox, without collecting a date of birth or ID. Configure your instance's `TERMS_VERSION`, `TERMS_URL` and `PRIVACY_URL` after publishing its actual policies. Account settings provide display-name correction, a private portable ZIP export and reauthenticated permanent deletion. Read the [account/data guide](apps/docs/account-data.md) for limits, retention and operator responsibilities; these controls do not configure your external backups or establish legal compliance automatically.

## Backups and upgrades

MongoDB data and replica configuration live in the `mongo_data` and `mongo_config` named volumes. **Do not run `docker compose down -v` on an instance whose data you want to keep.** Back up the database, attachments, `.env` and every active/previous encryption key. Local desktop vaults need their own complete folder backup, including `.helious/` history; sync is not a backup.

Pause writes for a consistent database dump:

```sh
docker compose stop helious
docker compose exec mongo mongodump --db helious --archive=/tmp/helious.archive.gz --gzip
docker compose cp mongo:/tmp/helious.archive.gz ./helious.archive.gz
docker compose start helious
```

Encrypt backups and store a copy off-host. Test restoring to an isolated instance with the matching keys before relying on a backup. For upgrades, back up first, read migration notes, then run `git pull --ff-only` and `docker compose up --build -d` with the **same** volumes, Compose project name and keys. Detailed [backup/restore and upgrade instructions](apps/docs/deployment.md) include recovery precautions.

If startup fails, check the app/container logs and `/api/health`: missing master key/email settings, an unverified sender, or a MongoDB replica set that is not writable are common causes. Never paste secrets or email links into public issues. This source distribution does not configure your host's DNS, TLS, mail domain, backups or operator policies automatically.

## License

Helious Apps source is licensed under [Apache 2.0](LICENSE). You may self-host, modify and redistribute it under that license. Preserve the applicable license and notices when redistributing. Third-party libraries/fonts retain their own licenses; native installers include their notices. The Helious name/logo are not licensed as trademarks. The private marketing website and admin/operator materials are outside this repository.

The browser distribution includes the original [Manrope Open Font License](apps/web/public/licenses/Manrope-OFL.txt) at `/app/licenses/Manrope-OFL.txt`.

Browser builds generate `/app/licenses/THIRD-PARTY-NOTICES.txt` with runtime dependency license text and source links. Keep it and the bundled [KaTeX font notice](apps/web/public/licenses/KaTeX-fonts-LICENSE.txt) when redistributing. The build helper is `scripts/browser-notices.mjs`.
