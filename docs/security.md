# Security and privacy

To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Protections

- **SQL guardrails.** Only `SELECT` and `WITH` queries are allowed by default. DDL/DML statements (`DROP`, `DELETE`, `INSERT`, etc.) are blocked. Injection patterns (UNION, comments, multi-statement, file ops, time-based attacks) are detected and rejected.
- **Tiered rate limiting.** Separate limits for read (120/min), write (30/min), and LLM (20/min) operations, configurable via `RATE_LIMIT_*_PER_MINUTE`.
- **Per-tool access control.** `MCP_TOOLS_ALLOW` / `MCP_TOOLS_DENY` restrict which tools are exposed, enforced at registration and inside `batch_execute` / `run_workflow`. See [configuration](configuration.md#per-tool-access-control).
- **Column redaction.** `MCP_REDACT_COLUMNS` masks or drops sensitive columns in every query result before it reaches the AI client or the in-server LLM. See [what it does and doesn't protect against](configuration.md#column-redaction).
- **Audit logging.** Every operation is logged with a risk level (low/medium/high). Sensitive fields are redacted automatically. Log files are created with owner-only read/write permissions.
- **Secret isolation.** API keys are never exposed to tool handlers. Error responses from Metabase are sanitized to prevent credential leakage.
- **Redirect protection.** API key headers are never forwarded on HTTP redirects.

## Data privacy

When you use the NLQ or insight tools (`nlq_to_sql`, `ask_data`, `generate_insights`, etc.), **your question, schema context and query result data are sent to the Anthropic API** for analysis. If your queries return sensitive data (PII, financial records, etc.), that data will be processed by Claude, so consider this before enabling these tools on databases with sensitive information. Columns listed in `MCP_REDACT_COLUMNS` are redacted before anything is sent.

Without `ANTHROPIC_API_KEY`, nothing is sent to Anthropic and those tools are disabled. See the [privacy policy](../README.md#privacy-policy) for the full statement.
