# Configuration

Set environment variables or create a `.env` file (see [`.env.example`](../.env.example)).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `METABASE_URL` | Yes | - | Your Metabase instance URL |
| `METABASE_API_KEY` | Yes* | - | Metabase API key (recommended) |
| `METABASE_SESSION_TOKEN` | Yes* | - | Metabase session token, sent as `X-Metabase-Session`. Use when you can't create an API key. Sessions expire (14 days by default), so prefer an API key for long-running setups |
| `MCP_MODE` | No | `read` | Server mode: `read`, `write`, or `full` |
| `ANTHROPIC_API_KEY` | No | - | Enables NLQ and insight tools |
| `METABASE_TIMEOUT` | No | `30000` | Request timeout (ms) |
| `METABASE_MAX_ROWS` | No | `10000` | Max rows returned per query |
| `LOG_LEVEL` | No | `info` | Logging: `debug`, `info`, `warn`, `error` |
| `AUDIT_LOG_FILE` | No | - | Write the audit log to this file (created with owner-only `0600` permissions) |
| `MCP_TOOLS_ALLOW` | No | - | Comma-separated allowlist — only these tools are exposed |
| `MCP_TOOLS_DENY` | No | - | Comma-separated denylist — these tools are never exposed (wins over allow) |
| `MCP_REDACT_COLUMNS` | No | - | Comma-separated column names to redact from query results (case-insensitive, `*` wildcard) |
| `MCP_REDACT_MODE` | No | `mask` | `mask` replaces values with `[REDACTED]`; `drop` removes the columns entirely |
| `RATE_LIMIT_READ_PER_MINUTE` | No | `120` | Read-tier rate limit |
| `RATE_LIMIT_WRITE_PER_MINUTE` | No | `30` | Write-tier rate limit |
| `RATE_LIMIT_LLM_PER_MINUTE` | No | `20` | LLM-tier rate limit |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | No | - | Legacy: sets the read tier when `RATE_LIMIT_READ_PER_MINUTE` is unset |

\* Set one of `METABASE_API_KEY` or `METABASE_SESSION_TOKEN`. If both are set, the API key is used.

## Generate a Metabase API key

1. Go to your Metabase instance
2. Navigate to **Admin** > **Settings** > **API Keys**
3. Click **Create API Key**
4. Copy the key and set it as `METABASE_API_KEY`

The key can only reach what its Metabase group can reach, so give it permissions for the databases you want to query and nothing more.

## Server modes

| Mode | Tools | Description |
|------|-------|-------------|
| `read` | 12 + NLQ | Read-only access, batch execution, and workflow pipelines |
| `write` | 22 + NLQ | Adds create/update/delete for cards, dashboards, collections |
| `full` | 30 | All tools including automated insights and trend analysis |

See [tools.md](tools.md) for the full list.

## Per-tool access control

Server modes give coarse control (read / write / full); `MCP_TOOLS_ALLOW` and `MCP_TOOLS_DENY` refine it per tool. Denied tools are not registered with the MCP client at all, and the same policy is enforced on operations nested inside `batch_execute` and `run_workflow` — a denied tool can't be reached through a batch or pipeline. Deny always wins over allow.

```bash
# Expose read tools but never raw SQL
MCP_MODE=read
MCP_TOOLS_DENY=execute_query
```

## Column redaction

`MCP_REDACT_COLUMNS` keeps chosen columns out of the AI's context while people keep full access to them in Metabase. Every query result is redacted inside the server, before it reaches the MCP client or the in-server LLM (NLQ and insight tools), including results from `batch_execute` and `run_workflow`.

```bash
# Mask emails, phone numbers and anything ending in _ssn
MCP_REDACT_COLUMNS=email,phone*,*_ssn
MCP_REDACT_MODE=mask   # or drop
```

- **mask** (default) keeps the column and replaces every value with `[REDACTED]`, so the agent knows the column exists and can still reason about the query's shape.
- **drop** removes the column from the result entirely.

Metabase metadata that would leak values is stripped for redacted columns too: column fingerprints (min/max/average statistics) in query results, cards and dashboards, timeseries insights, and the filter values Metabase returns with a dashboard. Each redaction is written to the audit log with the column names and cell count.

**What this protects against:** accidental exposure by a well-behaved agent, such as `SELECT *`, `SELECT email, name` or running a saved question that includes a sensitive column.

**What it doesn't:** matching is by result column name, so a query that renames a column (`SELECT email AS e`) or packs a row into one value (`row_to_json(u)`) gets around it, and so does an adversarial or prompt-injected agent. Aggregates come back under their own names (`max(salary)` returns a column called `max`), and Metabase suffixes duplicate names in joins (`email_2`) — use a wildcard like `email*` to catch those. For a hard boundary, restrict the API key's group with Metabase permissions or point it at database views without the sensitive columns.
