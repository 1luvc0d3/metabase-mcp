# Troubleshooting

## "Cannot connect to Metabase" / 401 errors

- Check that `METABASE_URL` is correct and reachable: `curl $METABASE_URL/api/health`
- Check that `METABASE_API_KEY` is valid (regenerate it in **Admin** > **Settings** > **API Keys** if needed)
- The API key's group needs permissions for the databases you want to query
- Using `METABASE_SESSION_TOKEN`? Sessions expire (14 days by default); get a new token or switch to an API key

## "Blocked SQL pattern detected" errors

- Only `SELECT` and `WITH` queries are allowed by default
- Even inside a `SELECT`, patterns like `UNION SELECT`, SQL comments (`--`, `/* */`), `xp_cmdshell` and `INTO OUTFILE` are blocked
- DML (`INSERT`, `UPDATE`, `DELETE`) is blocked in `execute_query` in every mode, not just `read`. Write mode adds tools for Metabase content (cards, dashboards, collections), not for writing to your database

## "Rate limit exceeded" errors

- Default limits: 120 reads/min, 30 writes/min, 20 LLM calls/min
- Adjust with `RATE_LIMIT_READ_PER_MINUTE`, `RATE_LIMIT_WRITE_PER_MINUTE` and `RATE_LIMIT_LLM_PER_MINUTE`
- Or wait for the retry-after period shown in the error

## NLQ tools unavailable

- They need `ANTHROPIC_API_KEY`; check that it's set, starts with `sk-`, and has remaining credits
- Insight tools also need `MCP_MODE=full`

## Claude Desktop: extension installed but tools not appearing

- Fully quit and restart Claude Desktop
- Check the logs: `~/Library/Logs/Claude/mcp*.log` on macOS, `%APPDATA%\Claude\logs\mcp*.log` on Windows
- Check that `node --version` is 20 or newer
