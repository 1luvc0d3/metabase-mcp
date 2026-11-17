# Comparison with other Metabase MCP servers

## Metabase's official MCP server

Metabase ships an [official MCP server](https://www.metabase.com/docs/latest/ai/mcp) on every plan, and as of v65 (v64 LTS) it's broad: 23 tools covering questions, dashboards, collections, metrics, alerts and subscriptions, structured and SQL queries, and inline charts. It's good, and if it fits your setup you should use it.

| Capability | @ai-1luvc0d3/metabase-mcp | Metabase Official (v65) |
|---|:--:|:--:|
| Read dashboards / cards / databases | ✅ | ✅ |
| Create & update questions, dashboards, collections | ✅ | ✅ (plus metrics, segments, alerts, subscriptions, documents) |
| Structured (MBQL) queries | ❌ SQL only ([#45](https://github.com/1luvc0d3/metabase-mcp/issues/45)) | ✅ `execute_query` |
| Raw SQL execution | ✅ SELECT-only + guardrails | ✅ `execute_sql` (needs native-query permission) |
| Permanent delete of cards & dashboards | ✅ | ❌ archive only |
| Batch execution (parallel multi-op in one call) | ✅ | ❌ |
| Workflow pipelines (chained steps with output references) | ✅ | ❌ |
| NLQ → SQL + explain / optimize / validate (LLM in the server) | ✅ | ❌ (relies on the AI client) |
| Inline interactive charts rendered in the AI client | ❌ | ✅ |
| Per-tool access control | ✅ any edition (allow/deny lists, modes) | Pro/Enterprise (per group); OSS: instance on/off |
| Column redaction in query results | ✅ `MCP_REDACT_COLUMNS` | ❌ (relies on Metabase permissions) |
| SQL injection guardrails | ✅ | permission-based |
| Tiered rate limiting (read / write / LLM) | ✅ | not tiered |
| Audit log of tool calls | ✅ any edition, risk-scored | Pro/Enterprise (MCP analytics) |
| Headless auth (CI, agents, VPN'd self-hosted) | ✅ API key, any edition | Pro/Enterprise (JWT bearer) |
| OAuth per-user permission scoping | ❌ (API key) | ✅ |
| Works on Metabase &lt; v0.60 | ✅ | ❌ |

<sub>Official column per Metabase's docs for v65, checked November 2026.</sub>

Sources: [MCP docs](https://www.metabase.com/docs/latest/ai/mcp) (OAuth, JWT bearer on Pro/Enterprise), [usage controls](https://www.metabase.com/docs/latest/ai/usage-controls) (per-group tool access and MCP analytics on Pro/Enterprise).

## Other community servers

Several community Metabase MCP servers exist, some exposing far more of the raw REST API (90+ tools). This one makes a different trade: a curated tool surface with production controls. In our August 2026 audit, no other community server had SQL injection guardrails, tiered rate limiting, per-operation audit logging, or per-tool access control (enforced inside batch and workflow calls too); the official server offers tool access and audit logging only on Pro/Enterprise. If you want maximum raw API coverage, one of the broad-CRUD servers may fit better; if an agent is going to touch your BI unattended, safety rails are the feature.
