# Run one shared server with Docker

Instead of every person installing and configuring metabase-mcp on their own machine, an admin can run one container and everyone connects to it over HTTP. Policy lives on the server, so users can't change it by editing a local config:

- server mode, tool allow/deny lists, column redaction and SQL guardrails
- an audit log that records which person made each call
- rate limits for each person

## Choose how people access Metabase

| | Shared (default) | Passthrough (`MCP_AUTH_MODE=passthrough`) |
|---|---|---|
| Metabase credential | One API key on the server | Each person sends their own |
| Metabase permissions | Everyone sees what the shared key sees | Each person sees what their own credential sees |
| Who identifies people | The server, with a bearer token per person (`MCP_AUTH_TOKENS`) | Metabase, which checks each credential when a session opens |
| Audit `actor` | Token name, e.g. `alice` | Metabase email, or `api-key:<key name>` |
| Setup for each person | Admin hands out a token | Admin creates a Metabase API key (or the person uses a session token) |

Both modes enforce the server's policy (mode, tool lists, redaction, guardrails) on top of Metabase's permissions, give each person their own rate limits, and tie each session to whoever opened it: no one else can read from it or close it.

### Shared

Everyone shares **one Metabase API key**, which never leaves the server. Create it for a Metabase group that only has access to what you want to expose, then narrow it further with `MCP_MODE`, `MCP_TOOLS_ALLOW`/`MCP_TOOLS_DENY` and `MCP_REDACT_COLUMNS` (see [configuration](configuration.md)). Each person gets their own bearer token.

### Passthrough

The server holds **no Metabase credential**. Each request carries the person's own, and Metabase decides what they can see. When a session opens, the server asks Metabase who the credential belongs to (`GET /api/user/current`). A rejected credential gets `401`; if Metabase can't be reached the server answers `503`. The credential is kept in memory only while that person has an open session and never written to logs.

People send one of:

| Header | Credential |
|---|---|
| `X-API-Key: mb_...` | Metabase API key |
| `Authorization: Bearer mb_...` | Metabase API key (for clients that can only set `Authorization`) |
| `X-Metabase-Session: <token>` | Metabase session token |

**Metabase API keys belong to a group, not a person.** An API key acts as its own synthetic user with the permissions of the group it was created in. For per-person access with API keys, an admin creates one key per person (**Admin** > **Settings** > **API Keys**) in the group that matches that person's access; permissions are then per group, and the audit log names the key. A session token acts as the real person with their exact permissions, but it expires (14 days by default) and has to be replaced.

Passthrough refuses to start if `METABASE_API_KEY`, `METABASE_SESSION_TOKEN` or `MCP_AUTH_TOKENS` is set, so a request without a credential can never fall back to a server-side one.

## Start the server

```bash
curl -O https://raw.githubusercontent.com/1luvc0d3/metabase-mcp/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/1luvc0d3/metabase-mcp/main/.env.example
# Edit .env (see below)
docker compose up -d
curl http://localhost:3000/health
```

**Shared:** set `METABASE_URL`, `METABASE_API_KEY` and one token per person:

```bash
openssl rand -hex 32   # once per person
```

```bash
MCP_AUTH_TOKENS=alice:3f9c...,bob:a71e...,etl-bot:0d4b...
```

**Passthrough:** set `METABASE_URL` and `MCP_AUTH_MODE=passthrough`, and leave `METABASE_API_KEY` and `MCP_AUTH_TOKENS` unset.

Or without compose:

```bash
# Shared
docker run -d --name metabase-mcp -p 3000:3000 \
  -e METABASE_URL=https://metabase.example.com \
  -e METABASE_API_KEY=mb_... \
  -e MCP_AUTH_TOKENS=alice:...,bob:... \
  -v metabase-mcp-audit:/data \
  ghcr.io/1luvc0d3/metabase-mcp:latest

# Passthrough
docker run -d --name metabase-mcp -p 3000:3000 \
  -e METABASE_URL=https://metabase.example.com \
  -e MCP_AUTH_MODE=passthrough \
  -v metabase-mcp-audit:/data \
  ghcr.io/1luvc0d3/metabase-mcp:latest
```

The image runs as an unprivileged user, listens on port 3000, writes the audit log to `/data/audit.log` and has a health check on `/health`. It's published for `linux/amd64` and `linux/arm64`, tagged `latest`, `X.Y` and `X.Y.Z`.

In shared mode the server refuses to start on a non-localhost address without tokens. If a reverse proxy in front of it already authenticates every request, set `MCP_ALLOW_UNAUTHENTICATED=true`.

## Connect a client

The endpoint is `http://<host>:3000/mcp`.

**Claude Code**

```bash
# Shared: the person's server token
claude mcp add --transport http metabase http://mcp.internal:3000/mcp \
  --header "Authorization: Bearer <your token>"

# Passthrough: the person's own Metabase API key
claude mcp add --transport http metabase http://mcp.internal:3000/mcp \
  --header "X-API-Key: mb_<your key>"
```

**Claude (claude.ai, Desktop, Cowork, mobile) custom connectors** connect from Anthropic's cloud, not from your machine, so the server must be reachable from the public internet on HTTPS port 443. Servers inside a private network or VPN won't connect unless you allowlist Anthropic's IP addresses in your firewall. Put the container behind a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) rather than exposing port 3000 directly. Add the URL as a custom connector and set the request header `Authorization` to `Bearer <your token>` (shared) or `Bearer mb_<your key>` (passthrough), including the word `Bearer`. Request-header auth for custom connectors is [in beta for a limited set of organizations](https://claude.com/docs/connectors/custom/remote-mcp), and custom header names need Anthropic's approval, so use `Authorization` rather than `X-Metabase-Session`. If your organization doesn't have header auth yet, use Claude Code.

## Server settings

| Variable | Default in image | Description |
|----------|------------------|-------------|
| `MCP_AUTH_MODE` | `shared` | `shared` (one server-side Metabase key) or `passthrough` (each person's own credential) |
| `MCP_AUTH_TOKENS` | - | Shared mode: comma-separated `name:token` pairs, one per person. Required unless `MCP_ALLOW_UNAUTHENTICATED=true` |
| `MCP_AUTH_TOKEN` | - | Shared mode: legacy single token, treated as a user named `default` |
| `MCP_SESSION_IDLE_MINUTES` | `30` | Close sessions with no requests for this long |
| `MCP_ALLOW_UNAUTHENTICATED` | `false` | Shared mode: allow a non-localhost address with no tokens |
| `MCP_HTTP_PORT` | `3000` | Port inside the container |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind address |
| `MCP_CORS_ORIGIN` | - | Allowed CORS origin, for browser-based clients |
| `AUDIT_LOG_FILE` | `/data/audit.log` | Audit log path; mount a volume at `/data` to keep it |

Everything in [configuration](configuration.md) also applies. `ANTHROPIC_API_KEY` enables the NLQ and insight tools for everyone, billed to that one key.

## Operating it

- **Add or remove a person:** in shared mode, edit `MCP_AUTH_TOKENS` and restart (`docker compose up -d`); restarting closes open sessions, so clients have to reconnect. In passthrough mode, create or revoke their Metabase credential: no restart needed. A revoked credential can't open new sessions; an already open session keeps the credential, but Metabase rejects its calls.
- **Audit log:** one JSON event per line, with `actor` naming the person. A `session_open` event is written each time someone connects; in passthrough mode it includes their `metabaseUserId`. Read the log with `docker compose exec metabase-mcp cat /data/audit.log`.
- **Upgrade:** `docker compose pull && docker compose up -d`.
- **Rate limits** (`RATE_LIMIT_*_PER_MINUTE`) apply to each person separately. Metabase and Anthropic still see the combined traffic of everyone.
