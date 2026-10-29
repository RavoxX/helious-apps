# Deployment, upgrades and backups

## One origin, HTTPS

Run `docker compose up --build -d`. The app publishes to `127.0.0.1:3000`; MongoDB has no host port. Set `PUBLIC_URL` to your exact HTTPS origin and `COOKIE_SECURE=true` before remote use. Set `TRUST_PROXY` only to the actual reverse proxy's IP/CIDR as observed by the app. Do not use `true` or trust the entire internet.

Host Caddy example:

```text
knowledge.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Nginx example (provision TLS certificates separately):

```nginx
server {
  listen 443 ssl;
  server_name knowledge.example.com;
  ssl_certificate /etc/letsencrypt/live/knowledge.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/knowledge.example.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
  }
}
```

Add an HTTP-to-HTTPS redirect on port 80. Restrict inbound access to the reverse proxy. The app runs as a non-root user, drops Linux capabilities, uses a read-only root, and writes temporary files only in `/tmp`. MongoDB uses named data/config volumes. Add authenticated MongoDB access before sharing the private network with other services.

## MongoDB replica set

Phase 3 uses transactions for coordinated note moves. MongoDB 7 must run as a replica set. The supplied Compose service starts `mongod --replSet rs0`; its healthcheck initializes the single member as `mongo:27017` on an empty configuration and waits for a writable primary. The app uses `mongodb://mongo:27017/helious?replicaSet=rs0`. Data and replica configuration remain in the named volumes. A single member enables transactions but does **not** provide high availability.

For a native local development instance, start MongoDB with your existing data path and the loopback-only setting below, then initialize it once:

```sh
mongod --dbpath /your/existing/data/path --replSet rs0 --bind_ip 127.0.0.1
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Use `MONGO_URI=mongodb://127.0.0.1:27017/helious?replicaSet=rs0`. The advertised member hostname must be reachable from the app; do not use the Compose-only hostname `mongo` for a native host process. For managed MongoDB, use the provider's replica-set connection string and network/access controls. The temporary preview handles its own ephemeral replica set.

## Back up

Pause application writes for a consistent backup. Run the dump inside the Mongo container so PowerShell does not corrupt binary output through text redirection:

```sh
docker compose stop helious
docker compose exec mongo mongodump --db helious --archive=/tmp/helious.archive.gz --gzip
docker compose cp mongo:/tmp/helious.archive.gz ./helious.archive.gz
docker compose start helious
```

Encrypt the archive and store a copy off-host. Back up `.env`/master key separately with strict access controls. The archive contains credential hashes and account data. Never commit it.

For a complete volume snapshot, stop MongoDB before copying the `mongo_data` and `mongo_config` volumes with your host's backup tooling. Live filesystem copies are not guaranteed consistent. Record the Compose project name and MongoDB version.

## Restore

Test on an isolated fresh deployment first:

```sh
docker compose stop helious
docker compose cp ./helious.archive.gz mongo:/tmp/helious.archive.gz
docker compose exec mongo mongorestore --archive=/tmp/helious.archive.gz --gzip --drop
docker compose start helious
```

`--drop` replaces collections in the dump: use only on the intended restore target. Restore the matching key and environment. Check `/api/health`, login and session revocation. A backup can reintroduce previously active sessions; revoke restored sessions before exposing the instance if needed.

Phase 6 backups must include `secrets`, `security_credentials`, `totp_enrollments`, `secret_approvals`, `secret_audit` and `secret_audit_heads`, alongside the rest of the database. Preserve the active and previous master keys separately. Test an authenticator sign-in and a synthetic secret reveal after restoration; startup refuses unknown key IDs. Old backups can reintroduce consumed recovery codes or approvals: expire restored approvals and revoke sessions in an isolated restore before reopening it, and replace recovery codes as appropriate. See [key rotation](./secrets#encryption-and-key-rotation).

## Upgrade

For Phase 6, keep your existing master key and the default `HELIOUS_MASTER_KEY_ID=v1` for the first startup. New accounts and existing accounts start without TOTP until they enroll. MFA is required only for the dedicated secrets feature. Stop older binaries before users enroll or store secrets; they do not enforce the new MFA boundary. Roll back with a full pre-upgrade database backup, not just an older app binary. The application now also checks active secrets before vault/Space deletion.

Back up first, read release/migration notes, build the new app image and restart the app with the same volumes and key. Keep MongoDB major upgrades separate and follow MongoDB's supported upgrade procedure. Index initialization, legacy email verification and the Phase 5 space/history migration are idempotent. Stop older app instances before upgrading to Phase 5. Unclassified content goes to Personal; current notes receive a labelled baseline. The active-note path index changes to support recovery. See [Spaces upgrade notes](./spaces#upgrade-from-phase-4). Rolling back the binary alone is unsafe; restore a full pre-upgrade backup.

### Upgrade an existing standalone Compose database to Phase 3

1. Stop the app and take a dump and offline volume backup using the instructions above.
2. Update the repository and Compose configuration. Keep the same Compose project name, named volumes and master key. Do not delete volumes.
3. Run `docker compose up -d mongo`. Compose recreates the Mongo container with `--replSet rs0`, preserving its data. The healthcheck initializes the replica configuration if it is missing.
4. Check `docker compose ps` and `docker compose exec mongo mongosh --quiet --eval 'db.hello().isWritablePrimary'`. Continue when the output is `true`.
5. Rebuild and start the app with `docker compose up --build -d helious`. The updated Compose URI includes `replicaSet=rs0`.
6. Check `/api/health`, sign in, create a note and test a rename with an inbound link. Confirm both changes persist after reload.

If an external database already belongs to a replica set, preserve its configuration and update only the application's connection string as needed. Do not reinitialize or rename an existing replica set. If note writes return “require a MongoDB replica set,” verify the server mode and URI before retrying. The application does not automatically convert external databases.

## Phase 7 upgrade and recovery

No new server environment variables are required. Preserve `PUBLIC_URL`, master keys and the existing MongoDB replica set. Local stdio clients use `HELIOUS_URL` and a scoped `HELIOUS_TOKEN`; these are client-process settings, never browser build variables. OAuth discovery and MCP enforce the canonical public origin, so preserve the Host header and forward the well-known, `/oauth/`, `/mcp` and `/app/` paths through the same HTTPS proxy.

Include `agent_tokens`, `agent_activity`, `oauth_clients`, `oauth_requests`, `oauth_codes` and `oauth_refresh` in database backups. After an incident restore, revoke restored agent connections and browser sessions before reopening access; expire restored codes/requests and refresh credentials as appropriate. Password recovery invalidates agent credentials through `authVersion`, but a database rollback can restore an older account version too. Stop older application binaries before enabling public MCP. Existing browser accounts/vaults require no new classification migration.

## Phase 8 desktop and server upgrades

No new server environment variables are needed. Upgrade the server before using desktop sync; older servers can still support account workflows but have no sync routes. Existing MongoDB notes and accounts require no new classification migration. Attachment hash/revision fields are optional and populated on demand. Keep the same replica set, master keys, public origin and backups.

Local vault backups are separate from MongoDB: back up the complete selected folder, including `.helious/` and its revision history, with Helious stopped. OS-stored sessions are not part of the vault and should be recreated by signing in. Restore a local backup into an isolated folder and review or stop its sync pairing before reconnecting; the restored checkpoint may refer to an older server state. Do not treat sync as a substitute for an independent backup. See [desktop recovery](./desktop#recovery-and-troubleshooting).
