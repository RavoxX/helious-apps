# Get started

After signing in, open **Settings → Security & access** (`/app/settings/security`) to enroll an authenticator and save recovery codes before adding credentials in a vault's **Secrets** tab. See [encrypted secrets and key rotation](./secrets). MFA is optional for ordinary notes and required for secrets.

## Docker installation

Install Docker with Compose, clone this repository and copy `.env.example` to `.env`. Generate a key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the 64-character value into `HELIOUS_MASTER_KEY`. Keep it private and back it up separately. Start the services:

Production also requires `RESEND_API_KEY` and `EMAIL_FROM` using a verified sender domain. `EMAIL_REPLY_TO` is optional. Follow [email setup](./email) before starting.

```sh
docker compose up --build -d
docker compose ps
```

Open `http://localhost:3000/app/`. Create an account with a password of at least 12 characters, verify your email, then sign in. The first account becomes administrator. Open **Account & server** to disable new registrations when ready.

The example is for local HTTP evaluation. For public access configure HTTPS, `PUBLIC_URL=https://your-host` and `COOKIE_SECURE=true` using the [deployment guide](./deployment). Do not expose MongoDB.

## Your first notes

Open **Vaults**, create a vault, then add `Overview.md` and `Decisions.md`. Write Markdown and use `[[Decisions]]` to connect them. Save explicitly; the app displays unsaved changes and rejects conflicting saves from another browser. Search with words or `tag:`, `path:` and `file:` filters. Attach files up to 20 MiB. See the [knowledge guide](./knowledge) for exact syntax and current limits.

## Local development

Use Node 22, pnpm 10.28.2 and a MongoDB 7 replica set. Follow the [database setup guide](./deployment#mongodb-replica-set), or use the self-contained preview below. Set `NODE_ENV=development`, `MONGO_URI=mongodb://127.0.0.1:27017/helious?replicaSet=rs0`, `COOKIE_SECURE=false`, and `PUBLIC_URL=http://localhost:5173` in `.env`. Set a random master key as above.

```sh
pnpm install
pnpm dev
```

Visit `http://localhost:5173/app/`. The web Vite server proxies API/MCP/OAuth to Fastify. Use the built self-contained preview below for the complete application and docs. Keep one browser origin and matching PUBLIC_URL throughout.

## Temporary preview without Docker

```sh
pnpm build
pnpm dev:preview
```

This starts a real, ephemeral MongoDB test process and serves the built site on port 3000. The first run downloads MongoDB. Accounts disappear when the process stops. A random preview key is generated in memory; it is never written to source or logs. Use Docker or your own MongoDB for durable data.

## Troubleshooting

- **Missing key:** set `HELIOUS_MASTER_KEY` to exactly 64 hexadecimal characters.
- **Origin/CSRF error:** open the site at the exact configured `PUBLIC_URL`, refresh, and retry. Hostnames and ports matter.
- **Sign-in loop on HTTP:** Secure cookies require HTTPS; explicitly set `COOKIE_SECURE=false` only for localhost evaluation.
- **Docker connection failed:** start Docker Desktop or the Docker daemon, then retry.
- **MongoDB cannot connect:** check service health and `MONGO_URI`. Compose uses hostname `mongo`; the host uses `127.0.0.1`.
- **Registration closed on a new instance:** temporarily enable `REGISTRATION_OPEN` to create the initial admin. Later changes in the admin panel are stored in MongoDB and take priority over this environment default.
- **Too many attempts:** wait 15 minutes. Do not disable production limits to bypass a lockout.

## AI connections

After creating a vault, open **AI connections** in the workspace sidebar. Create a scoped local-agent token or connect a remote tool through OAuth. Use the project memory form to create the Code Space conventions without replacing existing notes. See [MCP setup and tool reference](./mcp). The real desktop workspace now follows the homepage preview's left explorer, central note and right connections layout; mobile keeps accessible drawers and stacked panels.

For local Vite development, the API/MCP server must use the same canonical public origin. The built port-3000 preview serves all routes together. A remote MCP client requires a reachable HTTPS deployment, rather than a development proxy.

## Local folders and desktop apps

For offline use, open an ordinary Markdown folder in [Helious desktop](./desktop). No account is needed for local notes. To use a server vault or pair selected Spaces for sync, connect the desktop app to your existing verified account. Windows and universal macOS build artifacts are produced by the repository workflow; signing and public release publishing remain separate configuration.
