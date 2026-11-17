# Run one shared server with Docker

Instead of every person installing and configuring metabase-mcp on their own machine, an admin can run one container and everyone connects to it over HTTP. Policy lives on the server, so users can't change it by editing a local config:

- one Metabase API key, which never leaves the server
- server mode, tool allow/deny lists, column redaction and SQL guardrails
- an audit log that records which person made each call
- rate limits for each person

## How access works

Everyone shares **one Metabase API key**. Each person sees whatever that key can see, and Metabase's per-user permissions don't apply. Create the key for a Metabase group that only has access to what you want to expose, then narrow it further with `MCP_MODE`, `MCP_TOOLS_ALLOW`/`MCP_TOOLS_DENY` and `MCP_REDACT_COLUMNS` (see [configuration](configuration.md)).

Each person gets **their own bearer token** (`MCP_AUTH_TOKENS`). The token's name is stamped on every audit event as `actor`, and each name has its own rate-limit buckets. A session belongs to the person who opened it, so another token can't read from it or close it.

## Start the server

```bash
curl -O https://raw.githubusercontent.com/1luvc0d3/metabase-mcp/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/1luvc0d3/metabase-mcp/main/.env.example
# Edit .env: set METABASE_URL, METABASE_API_KEY and MCP_AUTH_TOKENS
docker compose up -d
curl http://localhost:3000/health
```

Generate one token per person:

```bash
openssl rand -hex 32
```

```bash
MCP_AUTH_TOKENS=alice:3f9c...,bob:a71e...,etl-bot:0d4b...
```

Or without compose:

```bash
docker run -d --name metabase-mcp -p 3000:3000 \
  -e METABASE_URL=https://metabase.example.com \
  -e METABASE_API_KEY=mb_... \
  -e MCP_AUTH_TOKENS=alice:...,bob:... \
  -v metabase-mcp-audit:/data \
  ghcr.io/1luvc0d3/metabase-mcp:latest
```

The image runs as an unprivileged user, listens on port 3000, writes the audit log to `/data/audit.log` and has a health check on `/health`. It's published for `linux/amd64` and `linux/arm64`, tagged `latest`, `X.Y` and `X.Y.Z`.

The server refuses to start on a non-localhost address without tokens. If a reverse proxy in front of it already authenticates every request, set `MCP_ALLOW_UNAUTHENTICATED=true`.

## Connect a client

The endpoint is `http://<host>:3000/mcp`. Send the person's token as `Authorization: Bearer <token>`.

**Claude Code**

```bash
claude mcp add --transport http metabase http://mcp.internal:3000/mcp \
  --header "Authorization: Bearer <your token>"
```

**Claude (claude.ai, Desktop, Cowork) custom connectors** connect from Anthropic's cloud, not from your machine, so the server needs a public HTTPS address. Add the URL as a custom connector and put `Authorization: Bearer <your token>` under its request headers. Put the container behind a TLS-terminating reverse proxy (Caddy, nginx, a cloud load balancer) rather than exposing port 3000 directly.

## Server settings

| Variable | Default in image | Description |
|----------|------------------|-------------|
| `MCP_AUTH_TOKENS` | - | Comma-separated `name:token` pairs, one per person. Required unless `MCP_ALLOW_UNAUTHENTICATED=true` |
| `MCP_AUTH_TOKEN` | - | Legacy single token, treated as a user named `default` |
| `MCP_SESSION_IDLE_MINUTES` | `30` | Close sessions with no requests for this long |
| `MCP_ALLOW_UNAUTHENTICATED` | `false` | Allow a non-localhost address with no tokens |
| `MCP_HTTP_PORT` | `3000` | Port inside the container |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind address |
| `MCP_CORS_ORIGIN` | - | Allowed CORS origin, for browser-based clients |
| `AUDIT_LOG_FILE` | `/data/audit.log` | Audit log path; mount a volume at `/data` to keep it |

Everything in [configuration](configuration.md) also applies. `ANTHROPIC_API_KEY` enables the NLQ and insight tools for everyone, billed to that one key.

## Operating it

- **Add or remove a person:** edit `MCP_AUTH_TOKENS` and restart (`docker compose up -d`). Restarting closes open sessions, so clients have to reconnect.
- **Audit log:** one JSON event per line, with `actor` set to the token name. Read it with `docker compose exec metabase-mcp cat /data/audit.log`.
- **Upgrade:** `docker compose pull && docker compose up -d`.
- **Rate limits** (`RATE_LIMIT_*_PER_MINUTE`) apply to each person separately. Metabase and Anthropic still see the combined traffic of everyone.
