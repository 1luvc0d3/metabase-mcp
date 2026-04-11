# metabase-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that connects Claude to [Metabase](https://www.metabase.com/), enabling natural language data analysis, dashboard management, and SQL query execution.

## Features

- **28 tools** across read, write, NLQ, and insight categories
- **Natural language to SQL** conversion powered by Claude (optional)
- **SQL guardrails** with injection detection and blocked pattern enforcement
- **Rate limiting** and **audit logging** for security
- **Database schema caching** for fast NLQ context

## Quick Start

### Using npx (recommended)

```bash
npx @1luvc0d3/metabase-mcp
```

### Manual install

```bash
npm install -g @1luvc0d3/metabase-mcp
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
      "args": ["@1luvc0d3/metabase-mcp"],
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

## Security

- **SQL Guardrails**: Only `SELECT` and `WITH` queries are allowed by default. DDL/DML statements (`DROP`, `DELETE`, `INSERT`, etc.) are blocked.
- **Rate Limiting**: Configurable per-minute limits prevent abuse.
- **Audit Logging**: All operations are logged with risk assessment.

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
