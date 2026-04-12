# metabase-mcp

[![npm version](https://img.shields.io/npm/v/@ai-1luvc0d3/metabase-mcp.svg)](https://www.npmjs.com/package/@ai-1luvc0d3/metabase-mcp)
[![npm downloads](https://img.shields.io/npm/dw/@ai-1luvc0d3/metabase-mcp.svg)](https://www.npmjs.com/package/@ai-1luvc0d3/metabase-mcp)
[![CI](https://github.com/1luvc0d3/metabase-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/1luvc0d3/metabase-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/@ai-1luvc0d3/metabase-mcp.svg)](https://nodejs.org)

The most feature-rich [MCP](https://modelcontextprotocol.io/) server for [Metabase](https://www.metabase.com/). Ask questions about your data in plain English, manage dashboards, and run SQL queries -- all through Claude.

## Why This One?

There are other Metabase MCP servers. Here's why this one is different:

| Feature | @ai-1luvc0d3/metabase-mcp | Others |
|---------|:--:|:--:|
| Purpose-built tools | **28** | 4-19 |
| Natural language to SQL | **Yes** | No |
| AI-powered insights & trend analysis | **Yes** | No |
| SQL injection protection | **Yes** | No |
| Rate limiting | **Tiered** | No |
| Audit logging with risk levels | **Yes** | No |
| Server modes (read/write/full) | **Yes** | No |
| Schema caching for fast NLQ | **Yes** | No |

## Features

- **28 tools** across read, write, NLQ, and insight categories
- **Natural language to SQL** -- ask questions, get SQL + results (powered by Claude)
- **SQL guardrails** -- injection detection, DDL/DML blocking, dangerous pattern enforcement
- **Tiered rate limiting** -- configurable per-minute limits for read, write, and LLM operations
- **Audit logging** -- every operation logged with risk assessment
- **Three server modes** -- `read` (safe default), `write`, or `full` (with AI insights)
- **Schema caching** -- fast NLQ context for large databases

## Quick Start

### One-click install (recommended)

1. Download the latest `metabase-mcp-*.mcpb` from [GitHub Releases](https://github.com/1luvc0d3/metabase-mcp/releases/latest)
2. Double-click to install in Claude Desktop
3. Enter your Metabase URL and API key when prompted — stored securely in the OS keychain

### Using npx

```bash
npx @ai-1luvc0d3/metabase-mcp
```

### Manual install

```bash
npm install -g @ai-1luvc0d3/metabase-mcp
metabase-mcp
```

### From source

```bash
git clone https://github.com/1luvc0d3/metabase-mcp.git
cd metabase-mcp
npm install
npm run build
npm start
```

## Configuration

Set environment variables or create a `.env` file (see `.env.example`):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `METABASE_URL` | Yes | - | Your Metabase instance URL |
| `METABASE_API_KEY` | Yes | - | Metabase API key |
| `MCP_MODE` | No | `read` | Server mode: `read`, `write`, or `full` |
| `ANTHROPIC_API_KEY` | No | - | Enables NLQ and insight tools |
| `METABASE_TIMEOUT` | No | `30000` | Request timeout (ms) |
| `METABASE_MAX_ROWS` | No | `10000` | Max rows returned per query |
| `LOG_LEVEL` | No | `info` | Logging: `debug`, `info`, `warn`, `error` |
| `RATE_LIMIT_REQUESTS_PER_MINUTE` | No | `60` | Rate limit threshold |

### Generate a Metabase API Key

1. Go to your Metabase instance
2. Navigate to **Admin** > **Settings** > **API Keys**
3. Click **Create API Key**
4. Copy the key and set it as `METABASE_API_KEY`

## Claude Desktop Integration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "metabase": {
      "command": "npx",
      "args": ["@ai-1luvc0d3/metabase-mcp"],
      "env": {
        "METABASE_URL": "https://your-metabase.example.com",
        "METABASE_API_KEY": "mb_your_api_key_here",
        "MCP_MODE": "read"
      }
    }
  }
}
```

## Server Modes

| Mode | Tools | Description |
|------|-------|-------------|
| `read` | 10 + NLQ | Read-only access to dashboards, cards, databases, queries |
| `write` | 20 + NLQ | Adds create/update/delete for cards, dashboards, collections |
| `full` | 28 | All tools including automated insights and trend analysis |

### Available Tools

**Read (always available)**
`list_dashboards`, `get_dashboard`, `list_cards`, `get_card`, `execute_card`, `list_databases`, `get_database_schema`, `execute_query`, `search_content`, `get_collections`

**Write (write/full modes)**
`create_card`, `update_card`, `delete_card`, `create_dashboard`, `update_dashboard`, `delete_dashboard`, `add_card_to_dashboard`, `remove_card_from_dashboard`, `create_collection`, `move_to_collection`

**NLQ (requires ANTHROPIC_API_KEY)**
`nlq_to_sql`, `explain_sql`, `optimize_sql`, `validate_sql`

**Insights (full mode + ANTHROPIC_API_KEY)**
`ask_data`, `generate_insights`, `compare_metrics`, `trend_analysis`

## Examples

### 1. Exploring your data

> **You**: What dashboards do we have related to customer retention?

Claude uses `search_content` to find retention-related dashboards, then `get_dashboard` to summarize the key metrics. You see a ranked list with the most relevant results.

> **You**: Run the "Monthly Active Users" card for the last 90 days

Claude calls `list_cards` to locate the card, then `execute_card` with the appropriate time filter. Results come back as a table you can ask follow-up questions about ("what was the biggest dip and when?").

### 2. Ad-hoc SQL with safety rails

> **You**: Show me the top 10 products by revenue last quarter from the sales database

Claude calls `list_databases` to find the sales database, `get_database_schema` to inspect the relevant tables, then generates and runs a `SELECT` query via `execute_query`. The query is validated against the SQL guardrails (no `DROP`/`DELETE`/`UNION`, single statement only) before execution. Audit log entry is written with the query and row count.

> **You**: DROP TABLE users

Request is blocked. Claude surfaces: *"Blocked SQL pattern detected: DROP — this operation is not allowed."* The block is logged as a high-risk audit event.

### 3. Natural language to SQL (requires ANTHROPIC_API_KEY)

> **You**: Which support agents closed the most tickets this week, and how does that compare to last week?

Claude uses `nlq_to_sql` with the database schema as context to generate a comparative SQL query. You can ask it to `explain_sql` in plain English before running, or `optimize_sql` to suggest performance improvements — all before hitting your database.

### 4. Saving a reusable query as a card (write mode)

> **You**: Save the MAU trend query we just ran as a card called "MAU — Last 90 Days" in the Growth collection

Claude calls `get_collections` to find "Growth", then `create_card` with your validated SQL. The card now lives in your Metabase library and can be re-executed by name in future conversations via `execute_card` — no LLM tokens spent on re-generating the query.

### 5. Automated insights on query results (full mode)

> **You**: Run last quarter's revenue query and tell me what's interesting

Claude uses `execute_query` to run the query, then `generate_insights` which asks the Claude API to identify trends, outliers, and recommendations. You get a structured summary: headline number, 3-5 bullet points, and suggested follow-up questions.

> **Note on data privacy**: `generate_insights`, `ask_data`, `compare_metrics`, and `trend_analysis` send query result rows to the Anthropic API for analysis. See [Data Privacy Note](#data-privacy-note) for details.

## Security

This server is designed for production use with multiple layers of protection:

- **SQL Guardrails**: Only `SELECT` and `WITH` queries are allowed by default. DDL/DML statements (`DROP`, `DELETE`, `INSERT`, etc.) are blocked. Injection patterns (UNION, comments, multi-statement, file ops, time-based attacks) are detected and rejected.
- **Tiered Rate Limiting**: Separate limits for read (120/min), write (30/min), and LLM (20/min) operations.
- **Audit Logging**: Every operation is logged with risk assessment (low/medium/high). Sensitive fields are automatically redacted. Log files are created with secure permissions (owner-only read/write).
- **Secret Isolation**: API keys are never exposed to tool handlers. Error responses from Metabase are sanitized to prevent credential leakage.
- **Redirect Protection**: API key headers are never forwarded on HTTP redirects.

### Data Privacy Note

When using NLQ or insight tools (`ask_data`, `generate_insights`, etc.), **query result data is sent to the Anthropic API** for analysis. If your queries return sensitive data (PII, financial records, etc.), that data will be processed by Claude. Consider this when enabling NLQ features on databases containing sensitive information.

## Development

```bash
npm install         # Install dependencies
npm run build       # Compile TypeScript
npm run dev         # Watch mode
npm test            # Run all tests
npm run type-check  # Type checking
npm run lint        # Linting
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## License

[MIT](LICENSE)
