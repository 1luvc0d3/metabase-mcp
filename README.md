# metabase-mcp

[![npm version](https://img.shields.io/npm/v/@ai-1luvc0d3/metabase-mcp.svg)](https://www.npmjs.com/package/@ai-1luvc0d3/metabase-mcp)
[![npm downloads](https://img.shields.io/npm/dw/@ai-1luvc0d3/metabase-mcp.svg)](https://www.npmjs.com/package/@ai-1luvc0d3/metabase-mcp)
[![CI](https://github.com/1luvc0d3/metabase-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/1luvc0d3/metabase-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/@ai-1luvc0d3/metabase-mcp.svg)](https://nodejs.org)
[![Glama score](https://glama.ai/mcp/servers/1luvc0d3/metabase-mcp/badges/score.svg)](https://glama.ai/mcp/servers/1luvc0d3/metabase-mcp)

An [MCP](https://modelcontextprotocol.io/) server for [Metabase](https://www.metabase.com/) with API-key auth and production guardrails. It lets Claude and other AI agents query, explore and build in Metabase on any edition and any version, including from CI and behind a VPN.

## Why this one?

Metabase ships an [official MCP server](https://www.metabase.com/docs/latest/ai/mcp). It's good, and if it fits your setup you should use it. This server is for the setups it doesn't fit, mostly **open-source and Starter Metabase**:

- **Headless on any plan.** Authenticates with a Metabase API key, so it works for agents, CI and VPN'd self-hosted instances. The official server's headless auth is Pro/Enterprise only.
- **Governance without an upgrade.** Read/write/full modes, per-tool allow/deny lists, column redaction, SQL guardrails, tiered rate limits and a risk-scored audit log, on any edition.
- **Composition.** `batch_execute` runs up to 20 operations in parallel; `run_workflow` chains steps with output references.
- **AI in the server.** NLQ-to-SQL, SQL explain/optimize, insights and trend analysis with your own Anthropic key.
- **Any Metabase version**, including pre-v0.60 instances that can't run the official MCP.

Choose the official server if you want OAuth per-user permissions, structured (MBQL) queries or inline charts, or if you're on Pro/Enterprise. → [Full comparison](docs/comparison.md)

## Quick start

You need a Metabase URL and an API key (**Admin** > **Settings** > **API Keys** > **Create API Key**).

**Claude Desktop (one-click):** download `metabase-mcp-*.mcpb` from the [latest release](https://github.com/1luvc0d3/metabase-mcp/releases/latest), double-click it, and enter your URL and key. They're stored in the OS keychain.

**Claude Code:**

```bash
claude mcp add metabase \
  -e METABASE_URL=https://your-metabase.example.com \
  -e METABASE_API_KEY=mb_your_api_key_here \
  -- npx -y @ai-1luvc0d3/metabase-mcp
```

**Any MCP client** (for example `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "metabase": {
      "command": "npx",
      "args": ["-y", "@ai-1luvc0d3/metabase-mcp"],
      "env": {
        "METABASE_URL": "https://your-metabase.example.com",
        "METABASE_API_KEY": "mb_your_api_key_here",
        "MCP_MODE": "read"
      }
    }
  }
}
```

**Shared server for a team (Docker):** run one container with one Metabase API key and give each person their own token. Policy, audit log and rate limits live on the server. → [docs/docker.md](docs/docker.md)

```bash
docker run -d -p 3000:3000 -e METABASE_URL=... -e METABASE_API_KEY=... \
  -e MCP_AUTH_TOKENS=alice:<token>,bob:<token> ghcr.io/1luvc0d3/metabase-mcp:latest
claude mcp add --transport http metabase http://<host>:3000/mcp --header "Authorization: Bearer <token>"
```

Then ask something like *"What dashboards do we have about customer retention?"*

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `METABASE_URL` | required | Your Metabase instance URL |
| `METABASE_API_KEY` | required | Metabase API key (or `METABASE_SESSION_TOKEN`) |
| `MCP_MODE` | `read` | `read`, `write` or `full` (see below) |
| `ANTHROPIC_API_KEY` | - | Enables the NLQ and insight tools |
| `MCP_TOOLS_ALLOW` / `MCP_TOOLS_DENY` | - | Expose only, or never expose, these tools |
| `MCP_REDACT_COLUMNS` | - | Columns to mask in query results, e.g. `email,phone*,*_ssn` |

All options, including timeouts, row limits, rate limits and redaction details: [docs/configuration.md](docs/configuration.md).

## Tools

| Mode | Tools | Adds |
|------|-------|------|
| `read` (default) | 12 | Dashboards, cards, databases, collections, search, SELECT-only SQL, `batch_execute`, `run_workflow` |
| `write` | 22 | Create, update and delete cards, dashboards and collections |
| `full` | 30 | AI insights, metric comparison and trend analysis |

With `ANTHROPIC_API_KEY` set, every mode also gets `nlq_to_sql`, `explain_sql`, `optimize_sql` and `validate_sql`.

Workflows chain tools in one call, passing results between steps:

```json
{
  "steps": [
    { "name": "find", "tool": "search_content", "args": { "query": "revenue", "type": "dashboard" } },
    { "name": "dash", "tool": "get_dashboard", "args": { "dashboard_id": "$find.results[0].id" } },
    { "name": "data", "tool": "execute_card", "args": { "card_id": "$dash.dashcards[0].card_id" } }
  ]
}
```

Full tool list and more examples: [docs/tools.md](docs/tools.md).

## Security

- **SQL guardrails:** only `SELECT`/`WITH`; DDL, DML and injection patterns are rejected
- **Access control:** server modes plus per-tool allow/deny lists, enforced inside batches and workflows too
- **Column redaction:** sensitive columns are masked before results reach the AI
- **Rate limits:** separate read, write and LLM tiers
- **Audit log:** every operation logged with a risk level
- **Secret handling:** API keys never reach tool handlers, Metabase errors are sanitized, and auth headers are never forwarded on redirects

Details and limits: [docs/security.md](docs/security.md). Report vulnerabilities via [SECURITY.md](SECURITY.md).

## Privacy policy

- **Collected:** nothing. No telemetry, analytics or usage data. Your Metabase URL and keys stay on your machine (in the OS keychain when installed as a Claude Desktop extension).
- **Transmitted:** Metabase API calls go straight from your machine to your own Metabase instance. The NLQ and insight tools send your question, schema context and query result samples to the Anthropic API ([privacy policy](https://www.anthropic.com/legal/privacy)); without an Anthropic key, nothing is sent to Anthropic. Columns in `MCP_REDACT_COLUMNS` are redacted first.
- **Retained:** nothing. Audit logs (if enabled with `AUDIT_LOG_FILE`) are written only to your local filesystem, with owner-only (`0600`) permissions.
- See also the [Metabase privacy policy](https://www.metabase.com/privacy).

## Troubleshooting

Connection errors, blocked SQL, rate limits and missing tools: [docs/troubleshooting.md](docs/troubleshooting.md).

## Contributing

```bash
npm install && npm run build   # build
npm test                       # unit + integration tests
npm run lint && npm run type-check
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Bugs and feature requests go in [Issues](https://github.com/1luvc0d3/metabase-mcp/issues); questions, feedback and production stories in [Discussions](https://github.com/1luvc0d3/metabase-mcp/discussions). If it's useful to you, a ⭐ helps.

## License

[MIT](LICENSE)
